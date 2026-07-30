import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { WebSocketServer } from "ws";
import QRCode from "qrcode";
import { DEMON_IDS, POSSESSED_IDS } from "../shared/cards.js";
import { buildJoinUrl, createRoom, getLanIp, getRoom } from "./rooms.js";
import { broadcastRoom, handleMessage, removeClient } from "./ws.js";
import { toPublicState } from "./game/engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const VITE_DEV_PORT = Number(process.env.VITE_DEV_PORT) || 5173;

function resolveProjectRoot(): string {
  const candidates = [
    path.join(__dirname, "../.."),
    path.join(__dirname, "../../.."),
    path.join(__dirname, ".."),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return candidates[0];
}

const projectRoot = resolveProjectRoot();
const builtClientDir = path.join(projectRoot, "dist/client");
const sourceClientDir = path.join(projectRoot, "client");
const publicAssetsDir = path.join(projectRoot, "public");
const hasBuiltClient = existsSync(path.join(builtClientDir, "solo.html"));
const staticClientDir = hasBuiltClient ? builtClientDir : sourceClientDir;
const app = express();
app.use(express.json({ limit: "5mb" }));

app.use("/assets", express.static(path.join(publicAssetsDir, "assets")));
app.use("/Audios", express.static(path.join(publicAssetsDir, "Audios")));
app.use("/vfx", express.static(path.join(publicAssetsDir, "vfx")));
app.use("/dice", express.static(path.join(publicAssetsDir, "dice")));
app.use(express.static(staticClientDir));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/network", (_req, res) => {
  res.json({ lanIp: getLanIp(), port: PORT });
});

app.post("/api/rooms", (_req, res) => {
  const room = createRoom("multi");
  res.json({
    roomId: room.id,
    hostUrl: `/host.html?room=${room.id}`,
    tvUrl: `/tv.html?room=${room.id}`,
    joinUrls: Object.fromEntries([1, 2, 3, 4].map((s) => [s, buildJoinUrl(room.id, s, PORT)])),
  });
});

app.get("/api/solo", (_req, res) => {
  res.json({ possessed: POSSESSED_IDS, demons: DEMON_IDS });
});

app.post("/api/solo", (_req, res) => {
  const room = createRoom("solo");
  res.json({ roomId: room.id, possessed: POSSESSED_IDS, demons: DEMON_IDS });
});

app.get("/api/rooms/:id", (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: "Not found" });
  res.json({ public: toPublicState(room.game) });
});

app.get("/api/rooms/:id/qr/:slot", async (req, res) => {
  const url = buildJoinUrl(req.params.id, Number(req.params.slot), PORT);
  const png = await QRCode.toBuffer(url, { width: 256, margin: 1 });
  res.type("png").send(png);
});

const VFX_USER_PRESETS_PATH = path.join(projectRoot, "client/src/vfx/presets.user.json");
const DICE_USER_PRESETS_PATH = path.join(projectRoot, "client/src/dice/presets.user.json");
const VFX_CUSTOM_DIR = path.join(publicAssetsDir, "vfx/custom");
const DICE_CUSTOM_DIR = path.join(publicAssetsDir, "dice/custom");

type BurstLike = { iconUrl?: string };

function writeDataUrlIcon(
  dataUrl: string,
  fileBase: string,
  targetDir = VFX_CUSTOM_DIR,
  publicPrefix = "/vfx/custom"
): string | null {
  const m = dataUrl.match(/^data:image\/[\w+.-]+;base64,(.+)$/);
  if (!m) return null;
  mkdirSync(targetDir, { recursive: true });
  const filePath = path.join(targetDir, `${fileBase}.png`);
  writeFileSync(filePath, Buffer.from(m[1], "base64"));
  return `${publicPrefix}/${fileBase}.png`;
}

function inlineBurstIcons(preset: BurstLike, id: string): void {
  if (!preset.iconUrl?.startsWith("data:")) return;
  const url = writeDataUrlIcon(preset.iconUrl, id);
  if (url) preset.iconUrl = url;
}

function prepareVfxCatalogForSave(catalog: Record<string, unknown>): Record<string, unknown> {
  const out = structuredClone(catalog);
  for (const [presetId, raw] of Object.entries(out)) {
    const entry = raw as { type?: string; preset?: BurstLike; composition?: { layers?: { id: string; preset: BurstLike }[] } };
    if (entry.type !== "burst") continue;
    if (entry.preset) inlineBurstIcons(entry.preset, presetId);
    for (const layer of entry.composition?.layers ?? []) {
      inlineBurstIcons(layer.preset, `${presetId}_${layer.id}`);
    }
  }
  return out;
}

type DiceFaceImagesLike = Record<string, string | null | undefined>;

function prepareDicePresetForSave(preset: Record<string, unknown>): Record<string, unknown> {
  const out = structuredClone(preset);
  const faceImages = out.faceImages as DiceFaceImagesLike | undefined;
  if (!faceImages || typeof faceImages !== "object") return out;
  for (const face of ["1", "2", "3", "4", "5", "6"]) {
    const url = faceImages[face];
    if (typeof url === "string" && url.startsWith("data:")) {
      const saved = writeDataUrlIcon(url, `face${face}`, DICE_CUSTOM_DIR, "/dice/custom");
      if (saved) faceImages[face] = saved;
    }
  }
  return out;
}

app.post("/api/dev/vfx-presets", (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "Dev presets API is disabled in production" });
  }
  const catalog = req.body?.catalog;
  if (!catalog || typeof catalog !== "object") {
    return res.status(400).json({ error: "Expected { catalog: VfxPresetCatalog }" });
  }
  try {
    const prepared = prepareVfxCatalogForSave(catalog as Record<string, unknown>);
    writeFileSync(VFX_USER_PRESETS_PATH, `${JSON.stringify(prepared, null, 2)}\n`, "utf8");
    res.json({ ok: true, path: "client/src/vfx/presets.user.json" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Write failed" });
  }
});

app.post("/api/dev/dice-presets", (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "Dev presets API is disabled in production" });
  }
  const preset = req.body?.preset;
  if (!preset || typeof preset !== "object") {
    return res.status(400).json({ error: "Expected { preset: DicePreset }" });
  }
  try {
    const prepared = prepareDicePresetForSave(preset as Record<string, unknown>);
    writeFileSync(DICE_USER_PRESETS_PATH, `${JSON.stringify(prepared, null, 2)}\n`, "utf8");
    res.json({ ok: true, path: "client/src/dice/presets.user.json" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Write failed" });
  }
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    handleMessage(ws, data.toString(), PORT);
  });
  ws.on("close", () => removeClient(ws));
});

server.listen(PORT, "0.0.0.0", () => {
  const lan = getLanIp();
  console.log(`BDC server running at http://${lan}:${PORT}`);
  console.log(`API/WebSocket: http://${lan}:${PORT}`);
  if (hasBuiltClient) {
    console.log(`Solo (built):  http://${lan}:${PORT}/solo.html`);
    console.log(`TV/Host:       http://${lan}:${PORT}/host.html`);
  } else {
    console.log(`Solo (dev):    http://localhost:${VITE_DEV_PORT}/solo.html`);
    console.log(`TV/Host (dev): http://localhost:${VITE_DEV_PORT}/host.html`);
    console.log(`(Run "npm run build" to serve the client from port ${PORT})`);
  }
});

export { broadcastRoom };
