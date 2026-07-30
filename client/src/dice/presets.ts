import userOverrides from "./presets.user.json";
import { DEFAULT_FACE_IMAGES, mergeDicePreset } from "./presets-merge.js";
import type { DicePreset, DicePresetOverrides } from "./types.js";

export { DEFAULT_FACE_IMAGES };

export const DEFAULT_DICE_PRESET: DicePreset = {
  faceGradientStart: "#e53935",
  faceGradientEnd: "#b71c1c",
  borderColor: "#8b0000",
  borderWidthPx: 2,
  borderRadiusPx: 14,
  facePaddingPx: 10,
  pipColor: "#ffffff",
  pipSizePx: 17,
  pipSizeLargePx: 18,
  sceneSizePx: 110,
  sceneSizeLargePx: 140,
  perspectivePx: 600,
  perspectiveLargePx: 800,
  halfEdgePx: 55,
  halfEdgeLargePx: 70,
  tumbleDurationMs: 4000,
  tumbleSteps: 16,
  stepScale: 0.65,
  preRollStaticMs: 400,
  postLandHoldMs: 700,
  scaleOutMs: 450,
  breatheDurationMs: 700,
  breatheBrightnessMin: 1.06,
  breatheBrightnessMax: 1.14,
  scaleOutEasing: "cubic-bezier(0.4, 0, 0.2, 1)",
  soundDelayMs: 1000,
  faceImages: { ...DEFAULT_FACE_IMAGES },
};

const merged = mergeDicePreset(
  DEFAULT_DICE_PRESET,
  userOverrides as DicePresetOverrides
);

let runtimePreset: DicePreset = merged;

export function getDicePreset(): DicePreset {
  return runtimePreset;
}

export function setDicePreset(preset: DicePreset): void {
  runtimePreset = preset;
}

export function resetDicePreset(): void {
  runtimePreset = mergeDicePreset(DEFAULT_DICE_PRESET, userOverrides as DicePresetOverrides);
}

export const POST_LAND_HOLD_MS = merged.postLandHoldMs;
