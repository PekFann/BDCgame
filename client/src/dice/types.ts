export type DiceFaceValue = 1 | 2 | 3 | 4 | 5 | 6;

export const DICE_FACE_VALUES: DiceFaceValue[] = [1, 2, 3, 4, 5, 6];

export type DiceFaceImages = Record<DiceFaceValue, string | null>;

export interface DicePreset {
  faceGradientStart: string;
  faceGradientEnd: string;
  borderColor: string;
  borderWidthPx: number;
  borderRadiusPx: number;
  facePaddingPx: number;
  pipColor: string;
  pipSizePx: number;
  pipSizeLargePx: number;
  sceneSizePx: number;
  sceneSizeLargePx: number;
  perspectivePx: number;
  perspectiveLargePx: number;
  halfEdgePx: number;
  halfEdgeLargePx: number;
  tumbleDurationMs: number;
  tumbleSteps: number;
  stepScale: number;
  preRollStaticMs: number;
  postLandHoldMs: number;
  scaleOutMs: number;
  breatheDurationMs: number;
  breatheBrightnessMin: number;
  breatheBrightnessMax: number;
  scaleOutEasing: string;
  soundDelayMs: number;
  faceImages: DiceFaceImages;
}

export type DicePresetOverrides = Partial<Omit<DicePreset, "faceImages">> & {
  faceImages?: Partial<DiceFaceImages>;
};
