import { resolveVfxEase } from "./easing.js";
import { ensureFadeKeyframes } from "./fade-keyframes.js";
import type { FloaterPreset } from "./types.js";

export interface SpawnFloaterOptions {
  innerHTML?: string;
  anchorYRatio?: number;
}

function applyFloaterMotion(el: HTMLElement, preset: FloaterPreset): void {
  const rise = preset.risePx ?? 48;
  let floatY = 0;
  if (preset.motionStyle === "float_up") floatY = -rise;
  else if (preset.motionStyle === "float_down") floatY = rise;

  const fadePct = Math.min(95, Math.max(5, Math.round(preset.fadeOutStart ?? 70)));
  const fadeName = ensureFadeKeyframes(fadePct);
  el.style.setProperty("--vfx-duration", `${preset.durationMs}ms`);
  el.style.setProperty("--vfx-ease", resolveVfxEase(preset.easing, preset.endSlowdown));
  el.style.setProperty("--float-y", `${floatY}px`);
  el.style.setProperty("--fade-out-start", String(fadePct / 100));
  el.style.animation = `vfxFloaterMove var(--vfx-duration) var(--vfx-ease) forwards, ${fadeName} var(--vfx-duration) var(--vfx-ease) forwards`;
}

export function spawnFloater(
  layer: HTMLElement,
  anchor: DOMRect,
  amount: number,
  preset: FloaterPreset,
  options: SpawnFloaterOptions = {}
): HTMLElement {
  const yRatio = options.anchorYRatio ?? preset.anchorYRatio;
  const tag =
    preset.className === "draw-reward-float" || preset.className === "manifest-damage-float"
      ? "div"
      : "span";
  const el = document.createElement(tag);
  el.className = preset.className;
  if (options.innerHTML) {
    el.innerHTML = options.innerHTML;
  } else {
    el.textContent = `${preset.textPrefix}${amount}`;
  }
  if (preset.color) el.style.color = preset.color;
  if (preset.fontSize) el.style.fontSize = preset.fontSize;
  el.style.left = `${anchor.left + anchor.width / 2}px`;
  el.style.top = `${anchor.top + anchor.height * yRatio}px`;
  applyFloaterMotion(el, preset);
  layer.appendChild(el);
  setTimeout(() => el.remove(), preset.durationMs + 50);
  return el;
}

export function spawnHtmlFloater(
  layer: HTMLElement,
  anchor: DOMRect,
  innerHTML: string,
  preset: FloaterPreset,
  anchorYRatio?: number
): HTMLElement {
  return spawnFloater(layer, anchor, 0, preset, {
    innerHTML,
    anchorYRatio: anchorYRatio ?? preset.anchorYRatio,
  });
}
