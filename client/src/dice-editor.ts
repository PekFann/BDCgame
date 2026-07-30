import {
  animatePhysicalDice,
  lockDiceToFace,
  mountDiceScene,
  previewDiceFace,
  resetDiceHostForRoll,
  scaleDownDiceScene,
} from "./dice-animation.js";
import { applyDicePreset } from "./dice/apply-styles.js";
import { DEFAULT_DICE_PRESET, getDicePreset, setDicePreset } from "./dice/presets.js";
import { DEFAULT_FACE_IMAGES } from "./dice/presets-merge.js";
import type { DicePreset } from "./dice/types.js";
import { DICE_FACE_VALUES } from "./dice/types.js";

const STORAGE_KEY = "bdc-dice-editor-draft";
const MAX_UPLOAD_BYTES = 200_000;

const GEOMETRY_KEYS = new Set<keyof DicePreset>([
  "sceneSizePx",
  "sceneSizeLargePx",
  "perspectivePx",
  "perspectiveLargePx",
  "halfEdgePx",
  "halfEdgeLargePx",
  "pipSizePx",
  "pipSizeLargePx",
  "facePaddingPx",
]);

const faceSelect = document.getElementById("dice-face-select") as HTMLSelectElement;
const largePreviewInput = document.getElementById("dice-large-preview") as HTMLInputElement;
const playHoldInput = document.getElementById("dice-play-hold") as HTMLInputElement;
const playScaleOutInput = document.getElementById("dice-play-scale-out") as HTMLInputElement;
const slidersEl = document.getElementById("dice-sliders")!;
const faceTexturesEl = document.getElementById("dice-face-textures")!;
const jsonEl = document.getElementById("dice-json") as HTMLTextAreaElement;
const stage = document.getElementById("dice-stage") as HTMLElement;
const host = document.getElementById("dice-host") as HTMLElement;
const playBtn = document.getElementById("dice-play") as HTMLButtonElement;
const statusEl = document.getElementById("dice-status");
const uploadWarnEl = document.getElementById("dice-upload-warn");

type SliderSpec = {
  key: keyof DicePreset;
  label: string;
  min: number;
  max: number;
  step: number;
};

type ColorSpec = {
  key: keyof DicePreset;
  label: string;
};

const APPEARANCE_COLORS: ColorSpec[] = [
  { key: "faceGradientStart", label: "Face gradient start" },
  { key: "faceGradientEnd", label: "Face gradient end" },
  { key: "borderColor", label: "Border color" },
  { key: "pipColor", label: "Pip color" },
];

const SLIDER_GROUPS: { title: string; sliders: SliderSpec[] }[] = [
  {
    title: "Appearance",
    sliders: [
      { key: "borderWidthPx", label: "Border width (px)", min: 0, max: 8, step: 1 },
      { key: "borderRadiusPx", label: "Border radius (px)", min: 0, max: 32, step: 1 },
      { key: "facePaddingPx", label: "Face padding (px)", min: 0, max: 24, step: 1 },
      { key: "pipSizePx", label: "Pip size (px)", min: 6, max: 32, step: 1 },
      { key: "pipSizeLargePx", label: "Pip size large (px)", min: 6, max: 36, step: 1 },
    ],
  },
  {
    title: "Geometry",
    sliders: [
      { key: "sceneSizePx", label: "Scene size (px)", min: 60, max: 200, step: 2 },
      { key: "sceneSizeLargePx", label: "Scene size large (px)", min: 80, max: 240, step: 2 },
      { key: "perspectivePx", label: "Perspective (px)", min: 200, max: 1200, step: 10 },
      { key: "perspectiveLargePx", label: "Perspective large (px)", min: 200, max: 1400, step: 10 },
      { key: "halfEdgePx", label: "Half edge (px)", min: 20, max: 120, step: 1 },
      { key: "halfEdgeLargePx", label: "Half edge large (px)", min: 30, max: 140, step: 1 },
    ],
  },
  {
    title: "Animation",
    sliders: [
      { key: "tumbleDurationMs", label: "Tumble duration (ms)", min: 500, max: 8000, step: 100 },
      { key: "tumbleSteps", label: "Tumble steps", min: 4, max: 32, step: 1 },
      { key: "stepScale", label: "Step scale", min: 0.2, max: 1.5, step: 0.05 },
      { key: "preRollStaticMs", label: "Pre-roll static (ms)", min: 0, max: 2000, step: 50 },
      { key: "postLandHoldMs", label: "Post-land hold (ms)", min: 0, max: 3000, step: 50 },
      { key: "scaleOutMs", label: "Scale-out (ms)", min: 100, max: 2000, step: 50 },
      { key: "breatheDurationMs", label: "Breathe duration (ms)", min: 100, max: 3000, step: 50 },
      { key: "breatheBrightnessMin", label: "Breathe brightness min", min: 0.8, max: 1.5, step: 0.01 },
      { key: "breatheBrightnessMax", label: "Breathe brightness max", min: 0.8, max: 1.8, step: 0.01 },
    ],
  },
  {
    title: "Audio",
    sliders: [{ key: "soundDelayMs", label: "Sound delay (ms)", min: 0, max: 3000, step: 50 }],
  },
];

let draft: DicePreset = loadDraft();
let playing = false;

function loadDraft(): DicePreset {
  const base = structuredClone(getDicePreset());
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DicePreset>;
      if (parsed && typeof parsed === "object") {
        return {
          ...base,
          ...parsed,
          faceImages: { ...base.faceImages, ...(parsed.faceImages ?? {}) },
        };
      }
    }
  } catch {
    /* ignore */
  }
  return base;
}

function saveDraft(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
}

function syncRuntime(): void {
  setDicePreset(draft);
  applyDicePreset(stage, draft);
}

function selectedRoll(): number {
  return Math.max(1, Math.min(6, parseInt(faceSelect.value, 10) || 6));
}

function updateJsonPreview(): void {
  jsonEl.value = JSON.stringify(draft, null, 2);
}

function showStatus(message: string, isError = false): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.hidden = false;
  statusEl.classList.toggle("is-error", isError);
}

function showUploadWarn(message: string, isError = false): void {
  if (!uploadWarnEl) return;
  uploadWarnEl.textContent = message;
  uploadWarnEl.hidden = !message;
  uploadWarnEl.classList.toggle("is-error", isError);
}

function remountCube(): void {
  const roll = selectedRoll();
  host.innerHTML = "";
  delete host.dataset.diceLanded;
  delete host.dataset.diceRoll;
  delete host.dataset.diceScaledOut;
  mountDiceScene(host, largePreviewInput.checked);
  lockDiceToFace(host, roll);
}

function previewSelectedFace(): void {
  syncRuntime();
  previewDiceFace(host, selectedRoll(), largePreviewInput.checked);
}

function prepareHostForPlay(roll: number): void {
  syncRuntime();
  if (!host.querySelector(".dice-scene")) {
    mountDiceScene(host, largePreviewInput.checked);
    lockDiceToFace(host, roll);
    return;
  }
  resetDiceHostForRoll(host);
  if (host.dataset.diceRoll !== String(roll)) {
    lockDiceToFace(host, roll);
  }
  if (host.dataset.diceLanded === "1" && host.dataset.diceRoll === String(roll)) {
    delete host.dataset.diceLanded;
  }
}

function makeColorInput(spec: ColorSpec): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "dice-field";
  const label = document.createElement("label");
  const span = document.createElement("span");
  span.textContent = spec.label;
  const input = document.createElement("input");
  input.type = "color";
  input.value = String(draft[spec.key]);
  input.addEventListener("input", () => {
    (draft[spec.key] as string) = input.value;
    saveDraft();
    syncRuntime();
    updateJsonPreview();
  });
  label.append(span, input);
  wrap.appendChild(label);
  return wrap;
}

function makeSlider(spec: SliderSpec): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "dice-slider";
  const label = document.createElement("label");
  const value = Number(draft[spec.key]);
  label.innerHTML = `<span>${spec.label}</span><span class="dice-slider-val">${value}</span>`;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.value = String(value);
  input.addEventListener("input", () => {
    const next = spec.step < 1 ? parseFloat(input.value) : parseInt(input.value, 10);
    (draft[spec.key] as number) = next;
    const valEl = label.querySelector(".dice-slider-val");
    if (valEl) valEl.textContent = String(next);
    saveDraft();
    syncRuntime();
    updateJsonPreview();
    if (GEOMETRY_KEYS.has(spec.key)) {
      remountCube();
    }
  });
  wrap.append(label, input);
  return wrap;
}

function renderFaceTextures(): void {
  faceTexturesEl.innerHTML = "";
  const title = document.createElement("p");
  title.className = "dice-slider-group-title";
  title.textContent = "Face textures";
  faceTexturesEl.appendChild(title);

  for (const face of DICE_FACE_VALUES) {
    const row = document.createElement("div");
    row.className = "dice-face-upload-row";

    const label = document.createElement("label");
    label.className = "dice-field";
    const span = document.createElement("span");
    span.textContent = `Face ${face}`;
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.className = "dice-file-input";
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (file.size > MAX_UPLOAD_BYTES) {
        showUploadWarn(`Face ${face} image too large (max ${MAX_UPLOAD_BYTES / 1000}KB).`, true);
        fileInput.value = "";
        return;
      }
      showUploadWarn("");
      const reader = new FileReader();
      reader.onload = () => {
        draft.faceImages[face] = String(reader.result);
        saveDraft();
        syncRuntime();
        updateJsonPreview();
        remountCube();
        renderFaceTextures();
      };
      reader.readAsDataURL(file);
    });
    label.append(span, fileInput);

    const preview = document.createElement("img");
    preview.className = "dice-face-upload-preview";
    preview.alt = `Face ${face}`;
    if (draft.faceImages[face]) {
      preview.src = draft.faceImages[face]!;
    } else {
      preview.hidden = true;
    }

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "btn secondary dice-face-clear";
    clearBtn.textContent = "Clear";
    clearBtn.disabled = !draft.faceImages[face];
    clearBtn.addEventListener("click", () => {
      draft.faceImages[face] = null;
      saveDraft();
      syncRuntime();
      updateJsonPreview();
      remountCube();
      renderFaceTextures();
    });

    row.append(label, preview, clearBtn);
    faceTexturesEl.appendChild(row);
  }
}

function renderSliders(): void {
  slidersEl.innerHTML = "";
  const appearanceTitle = document.createElement("p");
  appearanceTitle.className = "dice-slider-group-title";
  appearanceTitle.textContent = "Appearance";
  slidersEl.appendChild(appearanceTitle);
  for (const spec of APPEARANCE_COLORS) {
    slidersEl.appendChild(makeColorInput(spec));
  }
  for (const group of SLIDER_GROUPS) {
    const title = document.createElement("p");
    title.className = "dice-slider-group-title";
    title.textContent = group.title;
    slidersEl.appendChild(title);
    for (const spec of group.sliders) {
      slidersEl.appendChild(makeSlider(spec));
    }
  }
}

async function playRoll(): Promise<void> {
  if (playing) return;
  playing = true;
  playBtn.disabled = true;
  try {
    const roll = selectedRoll();
    prepareHostForPlay(roll);
    await animatePhysicalDice(host, roll, {
      skipHold: !playHoldInput.checked,
      skipSound: true,
    });
    if (playScaleOutInput.checked) {
      await scaleDownDiceScene(host);
    }
  } finally {
    playing = false;
    playBtn.disabled = false;
  }
}

renderSliders();
renderFaceTextures();
syncRuntime();
remountCube();
updateJsonPreview();

faceSelect.addEventListener("change", () => {
  previewSelectedFace();
});

largePreviewInput.addEventListener("change", () => {
  remountCube();
});

playBtn.addEventListener("click", () => {
  void playRoll();
});

document.getElementById("dice-reset")!.addEventListener("click", () => {
  draft = {
    ...structuredClone(DEFAULT_DICE_PRESET),
    faceImages: { ...DEFAULT_FACE_IMAGES },
  };
  saveDraft();
  syncRuntime();
  renderSliders();
  renderFaceTextures();
  remountCube();
  updateJsonPreview();
  showStatus("Reset to defaults.");
});

document.getElementById("dice-copy")!.addEventListener("click", async () => {
  const text = jsonEl.value;
  try {
    await navigator.clipboard.writeText(text);
    showStatus("JSON copied to clipboard.");
  } catch {
    jsonEl.select();
    document.execCommand("copy");
    showStatus("JSON copied to clipboard.");
  }
});

document.getElementById("dice-save")!.addEventListener("click", async () => {
  saveDraft();
  try {
    const res = await fetch("/api/dev/dice-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset: draft }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; path?: string };
    if (!res.ok) throw new Error(data.error ?? "Save failed");
    setDicePreset(draft);
    showStatus(`Saved to ${data.path ?? "presets.user.json"}. Refresh or rely on HMR.`);
  } catch (err) {
    showStatus(err instanceof Error ? err.message : "Save failed", true);
  }
});
