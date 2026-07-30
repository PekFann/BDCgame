import { spawnBurst, spawnBurstComposition } from "./vfx/burst.js";
import { spawnFloater, spawnHtmlFloater } from "./vfx/floater.js";
import { ensureVfxLayer } from "./vfx/layer.js";
import { spawnParticles, stopParticleLoop } from "./vfx/particles.js";
import {
  CARD_ICON_URL,
  createDefaultBurstPreset,
  DEFAULT_VFX_PRESETS,
  ENERGY_ICON_URL,
  FRIENDSHIP_ICON_URL,
  HEALTH_ICON_URL,
  hasActiveComposition,
  VFX_PRESETS,
} from "./vfx/presets.js";
import { playSlotAnim } from "./vfx/slot-fx.js";
import type {
  BurstLayerPreset,
  BurstPreset,
  FloaterMotionStyle,
  FloaterPreset,
  ParticleMotionStyle,
  SlotAnimPreset,
  VfxAudioSettings,
  VfxEasingMode,
  VfxPlaybackMode,
  VfxPreset,
  VfxPresetId,
  VfxSoundId,
  VfxTintMode,
} from "./vfx/types.js";
import { DEFAULT_VFX_AUDIO } from "./vfx/types.js";
import { playVfxSound, VFX_SOUND_CATALOG } from "./audio.js";
import { cardImg } from "./ws-client.js";
import { ENERGY_ICON, FRIENDSHIP_ICON } from "./ui-icons.js";

const STORAGE_KEY = "bdc-vfx-editor-draft";
const MAX_UPLOAD_BYTES = 200_000;

const presetSelect = document.getElementById("vfx-preset-select") as HTMLSelectElement;
const anchorSelect = document.getElementById("vfx-anchor-select") as HTMLSelectElement;
const amountField = document.getElementById("vfx-amount-field") as HTMLLabelElement;
const amountInput = document.getElementById("vfx-amount") as HTMLInputElement;
const soloAiField = document.getElementById("vfx-solo-ai-field") as HTMLLabelElement;
const soloAiInput = document.getElementById("vfx-solo-ai") as HTMLInputElement;
const slidersEl = document.getElementById("vfx-sliders")!;
const jsonEl = document.getElementById("vfx-json") as HTMLTextAreaElement;
const stage = document.getElementById("vfx-stage") as HTMLElement;
const playBtn = document.getElementById("vfx-play") as HTMLButtonElement;
const uploadWarnEl = document.getElementById("vfx-upload-warn");
const statusEl = document.getElementById("vfx-status");

type DraftCatalog = Record<string, VfxPreset>;

let draft: DraftCatalog = loadDraft();
let activeLoopId: string | null = null;
let selectedLayerId: string | null = null;

function mergePresetEntry(id: string, saved: VfxPreset | undefined): VfxPreset {
  const defaults = DEFAULT_VFX_PRESETS[id];
  if (!defaults || !saved) return defaults ?? saved;
  if (defaults.type !== saved.type) return defaults;
  if (defaults.type === "burst" && saved.type === "burst") {
    return {
      ...defaults,
      ...saved,
      audio: { ...defaults.audio, ...saved.audio },
      preset: { ...defaults.preset, ...saved.preset },
      composition: saved.composition ?? defaults.composition,
    };
  }
  if (defaults.type === "floater" && saved.type === "floater") {
    return {
      ...defaults,
      ...saved,
      audio: { ...defaults.audio, ...saved.audio },
      preset: { ...defaults.preset, ...saved.preset },
    };
  }
  if (defaults.type === "slot" && saved.type === "slot") {
    return {
      ...defaults,
      ...saved,
      audio: { ...defaults.audio, ...saved.audio },
      preset: { ...defaults.preset, ...saved.preset },
    };
  }
  return defaults;
}

function loadDraft(): DraftCatalog {
  const merged: DraftCatalog = structuredClone(DEFAULT_VFX_PRESETS);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DraftCatalog;
      if (parsed && typeof parsed === "object") {
        for (const id of Object.keys(merged)) {
          merged[id] = mergePresetEntry(id, parsed[id]);
        }
      }
    }
  } catch {
    /* ignore */
  }
  return merged;
}

function saveDraft(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
}

function currentId(): VfxPresetId {
  return presetSelect.value as VfxPresetId;
}

function currentEntry(): VfxPreset {
  return draft[currentId()];
}

function syncRuntimePreset(): void {
  const id = currentId();
  VFX_PRESETS[id] = structuredClone(currentEntry());
}

function updateJsonPreview(): void {
  jsonEl.value = JSON.stringify(currentEntry(), null, 2);
}

function setPlayButtonLabel(playing: boolean): void {
  playBtn.textContent = playing ? "Stop" : "Play";
}

function stopActiveLoop(): void {
  if (!activeLoopId) return;
  stopParticleLoop(activeLoopId);
  activeLoopId = null;
  setPlayButtonLabel(false);
}

type SliderSpec = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
};

const BURST_SLIDERS: SliderSpec[] = [
  { key: "particleSizeSolo", label: "Particle size (solo)", min: 16, max: 96, step: 1 },
  { key: "particleSizePhone", label: "Particle size (phone)", min: 16, max: 96, step: 1 },
  { key: "particleSizeSoloAiScale", label: "Solo AI size scale", min: 0.2, max: 1, step: 0.05 },
  { key: "countMin", label: "Count min", min: 1, max: 40, step: 1 },
  { key: "countMax", label: "Count max", min: 1, max: 60, step: 1 },
  { key: "countPerAmount", label: "Count per amount", min: 1, max: 20, step: 1 },
  { key: "durationMs", label: "Duration (ms)", min: 100, max: 2000, step: 10 },
  { key: "staggerMs", label: "Stagger (ms)", min: 0, max: 300, step: 5 },
  { key: "distanceMin", label: "Distance min", min: 20, max: 400, step: 5 },
  { key: "distanceMax", label: "Distance max", min: 40, max: 500, step: 5 },
  { key: "distanceSoloAiScale", label: "Solo AI distance scale", min: 0.2, max: 1, step: 0.05 },
  { key: "loopIntervalMs", label: "Loop interval (ms)", min: 100, max: 2000, step: 50 },
  { key: "endSlowdown", label: "End slowdown", min: 0, max: 100, step: 1 },
  { key: "fadeOutStart", label: "Fade-out start %", min: 40, max: 95, step: 1 },
  { key: "tintRevealMs", label: "Tint reveal (ms)", min: 50, max: 2000, step: 50 },
  { key: "blinkRadiusPx", label: "Blink radius (px)", min: 10, max: 300, step: 5 },
  { key: "scaleTargetPx", label: "Scale target (px)", min: 8, max: 160, step: 2 },
];

const FLOATER_SLIDERS: SliderSpec[] = [
  { key: "durationMs", label: "Duration (ms)", min: 200, max: 3000, step: 50 },
  { key: "anchorYRatio", label: "Anchor Y ratio", min: 0, max: 1, step: 0.05 },
  { key: "risePx", label: "Rise (px)", min: 0, max: 120, step: 2 },
  { key: "endSlowdown", label: "End slowdown", min: 0, max: 100, step: 1 },
  { key: "fadeOutStart", label: "Fade-out start %", min: 40, max: 95, step: 1 },
];

function ensureComposition(entry: Extract<VfxPreset, { type: "burst" }>): void {
  if (!entry.composition) entry.composition = { layers: [] };
}

function getEditingBurst(entry: Extract<VfxPreset, { type: "burst" }>): BurstPreset {
  if (selectedLayerId && entry.composition?.layers.length) {
    const layer = entry.composition.layers.find((l) => l.id === selectedLayerId);
    if (layer) return layer.preset;
  }
  return entry.preset;
}

function renderBurstControls(entry: Extract<VfxPreset, { type: "burst" }>, preset: BurstPreset): void {
  slidersEl.appendChild(
    makeSelect("Playback", preset.playbackMode, [
      { value: "once", label: "Once" },
      { value: "loop", label: "Loop" },
    ], (v) => {
      preset.playbackMode = v as VfxPlaybackMode;
      renderSliders();
    })
  );
  slidersEl.appendChild(
    makeSelect("Motion style", preset.motionStyle, [
      { value: "radial_burst", label: "Radial burst" },
      { value: "float_up", label: "Float up" },
      { value: "float_down", label: "Float down" },
      { value: "drift", label: "Drift" },
      { value: "scale_fade", label: "Scale fade (single)" },
      { value: "star_blink", label: "Star blink" },
    ], (v) => {
      preset.motionStyle = v as ParticleMotionStyle;
    })
  );
  slidersEl.appendChild(
    makeSelect("Tint mode", preset.tintMode ?? "none", [
      { value: "none", label: "None" },
      { value: "solid", label: "Solid overlay" },
      { value: "white_reveal", label: "White → color reveal" },
    ], (v) => {
      preset.tintMode = v as VfxTintMode;
      renderSliders();
    })
  );
  slidersEl.appendChild(
    makeSelect("Easing", preset.easing, [
      { value: "auto", label: "Auto (from slowdown)" },
      { value: "ease-out", label: "ease-out" },
      { value: "ease-in-out", label: "ease-in-out" },
      { value: "linear", label: "linear" },
    ], (v) => {
      preset.easing = v as VfxEasingMode;
    })
  );
  for (const spec of BURST_SLIDERS) {
    if (spec.key === "loopIntervalMs" && preset.playbackMode !== "loop") continue;
    if (spec.key === "tintRevealMs" && preset.tintMode !== "white_reveal") continue;
    if (spec.key === "blinkRadiusPx" && preset.motionStyle !== "star_blink") continue;
    if (spec.key === "scaleTargetPx" && preset.motionStyle !== "scale_fade") continue;
    if (
      (spec.key === "countMin" || spec.key === "countMax" || spec.key === "countPerAmount") &&
      preset.motionStyle === "scale_fade"
    ) {
      continue;
    }
    slidersEl.appendChild(makeRangeSlider(preset, spec));
  }
  slidersEl.appendChild(makeImageUpload(preset));
  slidersEl.appendChild(makeIconSelect(preset));
  slidersEl.appendChild(makeColorInput(preset, "glowColor", "Glow color"));
  if (preset.tintMode === "solid") slidersEl.appendChild(makeTintColorInput(preset));
}

function renderLayersPanel(entry: Extract<VfxPreset, { type: "burst" }>): void {
  ensureComposition(entry);
  const panel = document.createElement("div");
  panel.className = "vfx-layers-panel";
  const title = document.createElement("div");
  title.className = "vfx-layers-title";
  title.textContent = "Layers (play together)";
  panel.appendChild(title);

  const list = document.createElement("div");
  list.className = "vfx-layers-list";
  for (const layer of entry.composition!.layers) {
    list.appendChild(renderLayerRow(entry, layer));
  }
  panel.appendChild(list);

  const actions = document.createElement("div");
  actions.className = "vfx-layers-actions";
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn secondary";
  addBtn.textContent = "Add layer";
  addBtn.addEventListener("click", () => {
    const id = `layer_${Date.now()}`;
    entry.composition!.layers.push({
      id,
      label: `Layer ${entry.composition!.layers.length + 1}`,
      enabled: true,
      preset: createDefaultBurstPreset(entry.preset.iconUrl, entry.preset.glowColor),
    });
    selectedLayerId = id;
    saveDraft();
    renderSliders();
  });
  const baseBtn = document.createElement("button");
  baseBtn.type = "button";
  baseBtn.className = "btn secondary";
  baseBtn.textContent = "Edit base preset";
  baseBtn.addEventListener("click", () => {
    selectedLayerId = null;
    renderSliders();
  });
  actions.append(addBtn, baseBtn);
  panel.appendChild(actions);
  slidersEl.appendChild(panel);
}

function renderLayerRow(
  entry: Extract<VfxPreset, { type: "burst" }>,
  layer: BurstLayerPreset
): HTMLElement {
  const row = document.createElement("div");
  row.className = "vfx-layer-row";
  if (layer.id === selectedLayerId) row.classList.add("is-selected");
  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = layer.enabled;
  check.addEventListener("change", () => {
    layer.enabled = check.checked;
    saveDraft();
    updateJsonPreview();
  });
  const name = document.createElement("button");
  name.type = "button";
  name.className = "vfx-layer-name";
  name.textContent = layer.label;
  name.addEventListener("click", () => {
    selectedLayerId = layer.id;
    renderSliders();
  });
  const dup = document.createElement("button");
  dup.type = "button";
  dup.className = "btn secondary vfx-layer-dup";
  dup.textContent = "Dup";
  dup.addEventListener("click", () => {
    const id = `layer_${Date.now()}`;
    entry.composition!.layers.push({
      id,
      label: `${layer.label} copy`,
      enabled: true,
      preset: structuredClone(layer.preset),
    });
    selectedLayerId = id;
    saveDraft();
    renderSliders();
  });
  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn secondary vfx-layer-del";
  del.textContent = "×";
  del.addEventListener("click", () => {
    entry.composition!.layers = entry.composition!.layers.filter((l) => l.id !== layer.id);
    if (selectedLayerId === layer.id) selectedLayerId = null;
    saveDraft();
    renderSliders();
  });
  row.append(check, name, dup, del);
  return row;
}

function renderSliders(): void {
  stopActiveLoop();
  slidersEl.innerHTML = "";
  const entry = currentEntry();

  if (entry.type === "burst") {
    renderLayersPanel(entry);
    renderBurstControls(entry, getEditingBurst(entry));
  } else if (entry.type === "floater") {
    slidersEl.appendChild(
      makeSelect("Motion style", entry.preset.motionStyle, [
        { value: "float_up", label: "Float up" },
        { value: "float_down", label: "Float down" },
        { value: "none", label: "None" },
      ], (v) => {
        entry.preset.motionStyle = v as FloaterMotionStyle;
      })
    );
    slidersEl.appendChild(
      makeSelect("Easing", entry.preset.easing, [
        { value: "auto", label: "Auto (from slowdown)" },
        { value: "ease-out", label: "ease-out" },
        { value: "ease-in-out", label: "ease-in-out" },
        { value: "linear", label: "linear" },
      ], (v) => {
        entry.preset.easing = v as VfxEasingMode;
      })
    );
    slidersEl.appendChild(makeTextInput(entry.preset, "textPrefix", "Text prefix"));
    slidersEl.appendChild(makeTextInput(entry.preset, "color", "Color"));
    slidersEl.appendChild(makeTextInput(entry.preset, "fontSize", "Font size"));
    for (const spec of FLOATER_SLIDERS) {
      if (spec.key === "risePx" && entry.preset.risePx === undefined) continue;
      slidersEl.appendChild(makeRangeSlider(entry.preset, spec));
    }
  } else if (entry.type === "slot") {
    slidersEl.appendChild(
      makeRangeSlider(entry.preset, {
        key: "durationMs",
        label: "Duration (ms)",
        min: 0,
        max: 3000,
        step: 10,
      })
    );
  }

  renderAudioControls(entry);

  updateJsonPreview();
  updateContextualFields();
}

function ensureAudio(entry: VfxPreset): VfxAudioSettings {
  if (!entry.audio) entry.audio = { ...DEFAULT_VFX_AUDIO };
  return entry.audio;
}

function renderAudioControls(entry: VfxPreset): void {
  const audio = ensureAudio(entry);
  const section = document.createElement("div");
  section.className = "vfx-audio-section";
  const title = document.createElement("div");
  title.className = "vfx-layers-title";
  title.textContent = "Audio";
  section.appendChild(title);

  section.appendChild(
    makeSelect(
      "Sound",
      audio.soundId,
      VFX_SOUND_CATALOG.map((s) => ({ value: s.id, label: s.label })),
      (v) => {
        audio.soundId = v as VfxSoundId;
      }
    )
  );

  const delaySpec: SliderSpec = {
    key: "soundDelayMs",
    label: "Sound delay (ms)",
    min: 0,
    max: 2000,
    step: 50,
  };
  const delayWrap = document.createElement("div");
  delayWrap.className = "vfx-field";
  const delayLabel = document.createElement("label");
  delayLabel.innerHTML = `<span>${delaySpec.label}</span>`;
  const delayInput = document.createElement("input");
  delayInput.type = "range";
  delayInput.min = String(delaySpec.min);
  delayInput.max = String(delaySpec.max);
  delayInput.step = String(delaySpec.step);
  delayInput.value = String(audio.soundDelayMs);
  const delayValue = document.createElement("span");
  delayValue.className = "vfx-range-value";
  delayValue.textContent = `${audio.soundDelayMs} ms`;
  delayInput.addEventListener("input", () => {
    audio.soundDelayMs = Number(delayInput.value);
    delayValue.textContent = `${audio.soundDelayMs} ms`;
    saveDraft();
    updateJsonPreview();
  });
  delayLabel.appendChild(delayInput);
  delayLabel.appendChild(delayValue);
  delayWrap.appendChild(delayLabel);
  section.appendChild(delayWrap);

  slidersEl.appendChild(section);
}

function makeSelect(
  labelText: string,
  value: string,
  options: { value: string; label: string }[],
  onChange: (value: string) => void
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "vfx-field";
  const label = document.createElement("label");
  label.innerHTML = `<span>${labelText}</span>`;
  const select = document.createElement("select");
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    if (value === opt.value) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener("change", () => {
    onChange(select.value);
    saveDraft();
    updateJsonPreview();
  });
  label.appendChild(select);
  wrap.appendChild(label);
  return wrap;
}

function makeRangeSlider(
  preset: BurstPreset | FloaterPreset | SlotAnimPreset,
  spec: SliderSpec
): HTMLElement {
  const wrap = document.createElement("di" + "v");
  wrap.className = "vfx-slider";
  const value = (preset as Record<string, number>)[spec.key] ?? spec.min;
  const label = document.createElement("label");
  label.innerHTML = `<span>${spec.label}</span><span data-val>${value}</span>`;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.value = String(value);
  input.addEventListener("input", () => {
    const num = Number(input.value);
    (preset as Record<string, number>)[spec.key] = num;
    label.querySelector("[data-val]")!.textContent = String(num);
    saveDraft();
    updateJsonPreview();
  });
  wrap.append(label, input);
  return wrap;
}

function makeTextInput(
  preset: FloaterPreset,
  key: keyof FloaterPreset,
  labelText: string
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "vfx-field";
  const label = document.createElement("label");
  label.innerHTML = `<span>${labelText}</span>`;
  const input = document.createElement("input");
  input.type = "text";
  input.value = String(preset[key] ?? "");
  input.addEventListener("input", () => {
    (preset as Record<string, string>)[key] = input.value;
    saveDraft();
    updateJsonPreview();
  });
  label.appendChild(input);
  wrap.appendChild(label);
  return wrap;
}

function makeColorInput(
  preset: BurstPreset,
  key: "glowColor",
  labelText: string
): HTMLElement {
  const wrap = document.createElement("di" + "v");
  wrap.className = "vfx-field";
  const label = document.createElement("label");
  label.innerHTML = `<span>${labelText}</span>`;
  const input = document.createElement("input");
  input.type = "color";
  input.value = rgbaToHex(preset[key]);
  input.addEventListener("input", () => {
    preset[key] = hexToRgba(input.value, 0.9);
    saveDraft();
    updateJsonPreview();
  });
  label.appendChild(input);
  wrap.appendChild(label);
  return wrap;
}

function makeTintColorInput(preset: BurstPreset): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "vfx-field vfx-tint-row";
  const label = document.createElement("label");
  label.innerHTML = "<span>Tint overlay</span>";
  const row = document.createElement("div");
  row.className = "vfx-tint-controls";
  const input = document.createElement("input");
  input.type = "color";
  input.value = preset.tintColor ? rgbaToHex(preset.tintColor) : "#ec407a";
  input.addEventListener("input", () => {
    preset.tintColor = hexToRgba(input.value, 0.85);
    preset.tintMode = "solid";
    saveDraft();
    updateJsonPreview();
  });
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "btn secondary vfx-tint-clear";
  clearBtn.textContent = "Clear";
  clearBtn.addEventListener("click", () => {
    preset.tintColor = null;
    preset.tintMode = "none";
    saveDraft();
    updateJsonPreview();
    renderSliders();
  });
  row.append(input, clearBtn);
  label.appendChild(row);
  wrap.appendChild(label);
  return wrap;
}

function makeImageUpload(preset: BurstPreset): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "vfx-field";
  const label = document.createElement("label");
  label.innerHTML = "<span>Particle image</span>";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.className = "vfx-file-input";
  const preview = document.createElement("img");
  preview.className = "vfx-icon-preview";
  preview.alt = "Particle preview";
  if (preset.iconUrl) preview.src = preset.iconUrl;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      if (uploadWarnEl) {
        uploadWarnEl.textContent = `Image is ${Math.round(file.size / 1024)}KB — keep under ${MAX_UPLOAD_BYTES / 1000}KB for localStorage.`;
        uploadWarnEl.hidden = false;
      }
      return;
    }
    if (uploadWarnEl) uploadWarnEl.hidden = true;
    const reader = new FileReader();
    reader.onload = () => {
      preset.iconUrl = String(reader.result);
      preview.src = preset.iconUrl;
      saveDraft();
      updateJsonPreview();
    };
    reader.readAsDataURL(file);
  });
  label.append(fileInput, preview);
  wrap.appendChild(label);
  return wrap;
}

function makeIconSelect(preset: BurstPreset): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "vfx-field";
  const label = document.createElement("label");
  label.innerHTML = "<span>Built-in icon</span>";
  const select = document.createElement("select");
  const icons = [
    { value: FRIENDSHIP_ICON_URL, label: "Friendship" },
    { value: HEALTH_ICON_URL, label: "Health" },
    { value: ENERGY_ICON_URL, label: "Energy" },
    { value: CARD_ICON_URL, label: "Card" },
  ];
  for (const opt of icons) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    if (preset.iconUrl === opt.value) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener("change", () => {
    preset.iconUrl = select.value;
    saveDraft();
    updateJsonPreview();
    renderSliders();
  });
  label.appendChild(select);
  wrap.appendChild(label);
  return wrap;
}

function rgbaToHex(rgba: string): string {
  const m = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return "#ec407a";
  const r = Number(m[1]).toString(16).padStart(2, "0");
  const g = Number(m[2]).toString(16).padStart(2, "0");
  const b = Number(m[3]).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function updateContextualFields(): void {
  const entry = currentEntry();
  amountField.hidden = entry.type === "slot" && entry.preset.kind === "toggle_class";
  soloAiField.hidden = entry.type !== "burst";
  anchorSelect.disabled = false;

  if (entry.id.includes("manifest_hit") || entry.id === "possessed_perk_pulse") {
    anchorSelect.value = "possessed";
  } else if (
    entry.id.startsWith("demon_") ||
    entry.id === "manifest_lunge" ||
    entry.id === "board_flash"
  ) {
    anchorSelect.value = "demon";
  } else if (entry.id.includes("floater") && entry.id !== "damage_floater") {
    anchorSelect.value = "roster";
  }
}

function getAnchorEl(): HTMLElement {
  const key = anchorSelect.value;
  const el = stage.querySelector(`[data-vfx-anchor="${key}"]`) as HTMLElement | null;
  if (!el) throw new Error(`Missing anchor: ${key}`);
  if (key === "roster") {
    return (
      (el.querySelector(".roster-stat[title='Friendship']") as HTMLElement | null) ?? el
    );
  }
  return el;
}

function sampleFloaterHtml(id: VfxPresetId): string {
  if (id === "draw_reward_floater") {
    return `<span class="draw-reward-float-part">+1 <img class="draw-reward-float-icon" src="${CARD_ICON_URL}" alt="Card" /></span>`;
  }
  if (id === "rest_reward_floater") {
    return `<span class="draw-reward-float-part">+1 <img class="draw-reward-float-icon" src="${ENERGY_ICON_URL}" alt="Energy" /></span>`;
  }
  if (id === "manifest_damage_floater") {
    return `<span class="draw-reward-float-part">-3 <img class="draw-reward-float-icon" src="${HEALTH_ICON_URL}" alt="Health" /></span>`;
  }
  return "";
}

function playEffect(): void {
  syncRuntimePreset();
  const entry = currentEntry();
  const anchor = getAnchorEl();
  const rect = anchor.getBoundingClientRect();
  const layer = ensureVfxLayer();
  const amount = Math.max(1, Number(amountInput.value) || 1);
  const audio = entry.audio ?? DEFAULT_VFX_AUDIO;
  playVfxSound(audio.soundId, audio.soundDelayMs);

  if (entry.type === "burst") {
    const opts = { mode: "solo" as const, soloAi: soloAiInput.checked };
    if (hasActiveComposition(entry.composition)) {
      const result = spawnBurstComposition(layer, rect, amount, entry.composition!, opts);
      if (result.loopId) {
        activeLoopId = result.loopId;
        setPlayButtonLabel(true);
      }
      return;
    }
    if (entry.preset.playbackMode === "loop") {
      const result = spawnParticles(layer, rect, amount, entry.preset, opts);
      activeLoopId = result.loopId ?? null;
      setPlayButtonLabel(!!activeLoopId);
      return;
    }
    spawnBurst(layer, rect, amount, entry.preset, opts, entry.composition);
    return;
  }

  if (entry.type === "floater") {
    const html = sampleFloaterHtml(entry.id);
    if (html) {
      spawnHtmlFloater(layer, rect, html, entry.preset);
    } else {
      spawnFloater(layer, rect, amount, entry.preset);
    }
    return;
  }

  const slotTarget =
    entry.id === "board_flash"
      ? stage
      : entry.id === "manifest_hit" || entry.id === "possessed_perk_pulse"
        ? (stage.querySelector('[data-vfx-anchor="possessed"]') as HTMLElement)
        : (stage.querySelector('[data-vfx-anchor="demon"]') as HTMLElement);

  void playSlotAnim(slotTarget, entry.preset, stage);
}

function handlePlayClick(): void {
  if (activeLoopId) {
    stopActiveLoop();
    return;
  }
  playEffect();
}

function initStageImages(): void {
  const possessedImg = stage.querySelector(
    '[data-vfx-anchor="possessed"] img'
  ) as HTMLImageElement;
  const demonImg = stage.querySelector('[data-vfx-anchor="demon"] img') as HTMLImageElement;
  possessedImg.src = cardImg("possessed_01");
  demonImg.src = cardImg("dc_cover");
  for (const img of stage.querySelectorAll(".roster-stat-icon")) {
    const el = img as HTMLImageElement;
    if (el.alt === "Energy") el.src = ENERGY_ICON;
    if (el.alt === "Friendship") el.src = FRIENDSHIP_ICON;
  }
}

function populatePresetSelect(): void {
  presetSelect.innerHTML = "";
  for (const [id, entry] of Object.entries(draft)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = entry.label;
    presetSelect.appendChild(opt);
  }
}

populatePresetSelect();
initStageImages();
renderSliders();

presetSelect.addEventListener("change", () => {
  selectedLayerId = null;
  renderSliders();
});

playBtn.addEventListener("click", handlePlayClick);

document.getElementById("vfx-reset")!.addEventListener("click", () => {
  stopActiveLoop();
  const id = currentId();
  draft[id] = structuredClone(DEFAULT_VFX_PRESETS[id]);
  saveDraft();
  renderSliders();
});

document.getElementById("vfx-copy")!.addEventListener("click", async () => {
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

document.getElementById("vfx-save")!.addEventListener("click", async () => {
  saveDraft();
  try {
    const res = await fetch("/api/dev/vfx-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ catalog: draft }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; path?: string };
    if (!res.ok) throw new Error(data.error ?? "Save failed");
    showStatus(`Saved to ${data.path ?? "presets.user.json"}. Refresh or rely on HMR.`);
  } catch (err) {
    showStatus(err instanceof Error ? err.message : "Save failed", true);
  }
});

function showStatus(message: string, isError = false): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("is-error", isError);
  statusEl.hidden = false;
}
