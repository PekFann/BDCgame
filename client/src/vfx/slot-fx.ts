import type { SlotAnimPreset } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function playSlotAnim(
  target: HTMLElement,
  preset: SlotAnimPreset,
  boardRoot?: HTMLElement | null
): Promise<void> {
  if (preset.kind === "toggle_class") {
    for (const cls of preset.pendingClasses ?? []) {
      target.classList.add(cls);
    }
    for (const cls of preset.revealClasses ?? []) {
      target.classList.remove(cls);
    }
    const img = target.querySelector("img");
    if (img && preset.pendingClasses?.includes("hero-intro-pending")) {
      img.style.transform = "scale(0.35)";
      img.style.opacity = "0";
    }
    return;
  }

  if (preset.kind === "add_remove_class") {
    for (const cls of preset.addClasses ?? []) {
      target.classList.remove(cls);
    }
    void target.offsetWidth;
    for (const cls of preset.addClasses ?? []) {
      target.classList.add(cls);
    }
    await sleep(preset.durationMs);
    for (const cls of preset.removeClasses ?? []) {
      target.classList.remove(cls);
    }
    return;
  }

  if (preset.kind === "flash_overlay") {
    const root = boardRoot ?? target.closest("#board, .vfx-editor-stage") ?? target.parentElement;
    if (!root) return;
    const flash = document.createElement("div");
    flash.className = preset.flashClass ?? "board-flash";
    root.appendChild(flash);
    void flash.offsetWidth;
    flash.classList.add(preset.flashActiveClass ?? "board-flash-active");
    await sleep(preset.durationMs);
    flash.remove();
  }
}

export function pulseElement(element: HTMLElement, pulseClass: string, durationMs: number): void {
  element.classList.remove(pulseClass);
  void element.offsetWidth;
  element.classList.add(pulseClass);
  setTimeout(() => element.classList.remove(pulseClass), durationMs);
}
