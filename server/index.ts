import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { WebSocketServer } from "ws";
import QRCode from "qrcode";
import { POSSESSED_IDS } from "../shared/cards.js";
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
app.use(express.json());

app.use("/assets", express.static(path.join(publicAssetsDir, "assets")));
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
  res.json({ possessed: POSSESSED_IDS });
});

app.post("/api/solo", (_req, res) => {
  const room = createRoom("solo");
  res.json({ roomId: room.id, possessed: POSSESSED_IDS });
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
