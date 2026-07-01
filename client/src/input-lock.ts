const locks = new Set<string>();
let overlay: HTMLElement | null = null;

function ensureOverlay(): HTMLElement {
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "input-lock-overlay";
  overlay.className = "input-lock-overlay";
  overlay.hidden = true;
  document.body.appendChild(overlay);
  return overlay;
}

function syncOverlay(): void {
  const el = ensureOverlay();
  const active = locks.size > 0;
  el.hidden = !active;
  el.style.pointerEvents = active ? "auto" : "none";
}

export function lockInput(key: string): void {
  locks.add(key);
  syncOverlay();
}

export function unlockInput(key: string): void {
  locks.delete(key);
  syncOverlay();
}

export function isInputLocked(): boolean {
  return locks.size > 0;
}
