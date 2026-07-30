import { DICE_FACE_VALUES } from "./types.js";
import type { DiceFaceImages, DicePreset, DicePresetOverrides } from "./types.js";

export const DEFAULT_FACE_IMAGES: DiceFaceImages = {
  1: null,
  2: null,
  3: null,
  4: null,
  5: null,
  6: null,
};

export function mergeDicePreset(base: DicePreset, overrides: DicePresetOverrides): DicePreset {
  const faceImages = { ...base.faceImages };
  if (overrides.faceImages) {
    for (const face of DICE_FACE_VALUES) {
      if (face in overrides.faceImages) {
        faceImages[face] = overrides.faceImages[face] ?? null;
      }
    }
  }
  const { faceImages: _omit, ...rest } = overrides;
  return { ...base, ...rest, faceImages };
}
