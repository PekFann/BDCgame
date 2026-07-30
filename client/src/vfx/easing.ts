import type { VfxEasingMode } from "./types.js";

/** Map endSlowdown (0–100) to a CSS timing function when easing is "auto". */
export function resolveVfxEase(easing: VfxEasingMode, endSlowdown: number): string {
  if (easing !== "auto") return easing;
  const t = Math.min(100, Math.max(0, endSlowdown)) / 100;
  if (t <= 0.01) return "ease-out";
  if (t >= 0.99) return "cubic-bezier(0.05, 0.9, 0.1, 1)";
  if (t <= 0.5) {
    const u = t / 0.5;
    return `cubic-bezier(${lerp(0.25, 0.22, u)}, ${lerp(1, 1, u)}, ${lerp(0.45, 0.36, u)}, 1)`;
  }
  const u = (t - 0.5) / 0.5;
  return `cubic-bezier(${lerp(0.22, 0.05, u)}, ${lerp(1, 0.9, u)}, ${lerp(0.36, 0.1, u)}, 1)`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
