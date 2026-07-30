import { getDicePreset } from "./presets.js";
import type { DicePreset } from "./types.js";

export function applyDicePreset(target?: HTMLElement | null, preset?: DicePreset): void {
  const el = target ?? document.documentElement;
  const p = preset ?? getDicePreset();

  el.style.setProperty("--dice-scene-size", `${p.sceneSizePx}px`);
  el.style.setProperty("--dice-scene-size-large", `${p.sceneSizeLargePx}px`);
  el.style.setProperty("--dice-perspective", `${p.perspectivePx}px`);
  el.style.setProperty("--dice-perspective-large", `${p.perspectiveLargePx}px`);
  el.style.setProperty("--dice-half-edge", `${p.halfEdgePx}px`);
  el.style.setProperty("--dice-half-edge-large", `${p.halfEdgeLargePx}px`);
  el.style.setProperty("--dice-face-start", p.faceGradientStart);
  el.style.setProperty("--dice-face-end", p.faceGradientEnd);
  el.style.setProperty("--dice-border-color", p.borderColor);
  el.style.setProperty("--dice-border-width", `${p.borderWidthPx}px`);
  el.style.setProperty("--dice-border-radius", `${p.borderRadiusPx}px`);
  el.style.setProperty("--dice-face-padding", `${p.facePaddingPx}px`);
  el.style.setProperty("--dice-pip-color", p.pipColor);
  el.style.setProperty("--dice-pip-size", `${p.pipSizePx}px`);
  el.style.setProperty("--dice-pip-size-large", `${p.pipSizeLargePx}px`);
  el.style.setProperty("--dice-scale-out-ms", `${p.scaleOutMs}ms`);
  el.style.setProperty("--dice-scale-out-easing", p.scaleOutEasing);
  el.style.setProperty("--dice-breathe-ms", `${p.breatheDurationMs}ms`);
  el.style.setProperty("--dice-breathe-brightness-min", String(p.breatheBrightnessMin));
  el.style.setProperty("--dice-breathe-brightness-max", String(p.breatheBrightnessMax));
}
