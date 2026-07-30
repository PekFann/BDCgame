const OPEN_MS = 500;
const CLOSE_MS = 500;

export type OpenAnimatedModalOptions = {
  /** Modal element ids that should stay open (not force-closed). */
  preserveModalIds?: string[];
  /** Show immediately without is-opening fade/scale. */
  skipAnimation?: boolean;
};

function getModalBackdrop(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".card-modal-backdrop, .modal-overlay");
}

export function forceCloseModal(root: HTMLElement, panel: HTMLElement): void {
  root.hidden = true;
  root.style.pointerEvents = "";
  root.classList.remove("is-opening", "is-closing");
  panel.classList.remove("is-opening", "is-closing");
  getModalBackdrop(root)?.classList.remove("is-opening", "is-closing");
}

export function openAnimatedModal(
  root: HTMLElement,
  panel: HTMLElement,
  options?: OpenAnimatedModalOptions
): void {
  const preserve = new Set(options?.preserveModalIds ?? []);

  document.querySelectorAll(".card-modal").forEach((el) => {
    if (el === root) return;
    const other = el as HTMLElement;
    if (other.hidden) return;
    if (other.id && preserve.has(other.id)) return;
    const otherPanel = other.querySelector(".modal-panel") as HTMLElement | null;
    if (otherPanel) forceCloseModal(other, otherPanel);
    else other.hidden = true;
  });

  const backdrop = getModalBackdrop(root);

  root.hidden = false;
  root.style.pointerEvents = "";
  root.classList.remove("is-closing");
  panel.classList.remove("is-closing");
  backdrop?.classList.remove("is-closing");

  if (options?.skipAnimation) {
    root.classList.remove("is-opening");
    panel.classList.remove("is-opening");
    backdrop?.classList.remove("is-opening");
    return;
  }

  panel.classList.add("is-opening");
  root.classList.add("is-opening");
  backdrop?.classList.add("is-opening");

  const done = () => {
    panel.classList.remove("is-opening");
    root.classList.remove("is-opening");
    backdrop?.classList.remove("is-opening");
  };
  panel.addEventListener("animationend", done, { once: true });
  backdrop?.addEventListener("animationend", done, { once: true });
  setTimeout(done, OPEN_MS + 50);
}

export function closeAnimatedModal(
  root: HTMLElement,
  panel: HTMLElement,
  onClosed: () => void
): void {
  if (root.hidden) {
    onClosed();
    return;
  }
  if (root.classList.contains("is-closing")) return;

  const backdrop = getModalBackdrop(root);

  root.style.pointerEvents = "none";
  root.classList.add("is-closing");
  panel.classList.add("is-closing");
  backdrop?.classList.add("is-closing");

  const done = () => {
    root.hidden = true;
    root.style.pointerEvents = "";
    root.classList.remove("is-closing");
    panel.classList.remove("is-closing");
    backdrop?.classList.remove("is-closing");
    onClosed();
  };
  panel.addEventListener("animationend", done, { once: true });
  backdrop?.addEventListener("animationend", done, { once: true });
  setTimeout(done, CLOSE_MS + 50);
}
