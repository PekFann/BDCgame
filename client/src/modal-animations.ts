const OPEN_MS = 250;
const CLOSE_MS = 200;

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

export function openAnimatedModal(root: HTMLElement, panel: HTMLElement): void {
  document.querySelectorAll(".card-modal").forEach((el) => {
    if (el === root) return;
    const other = el as HTMLElement;
    if (other.hidden) return;
    const otherPanel = other.querySelector(".modal-panel") as HTMLElement | null;
    if (otherPanel) forceCloseModal(other, otherPanel);
    else other.hidden = true;
  });

  const backdrop = getModalBackdrop(root);
  const openMs = root.classList.contains("game-start-modal") ? 500 : OPEN_MS;

  root.hidden = false;
  root.style.pointerEvents = "";
  root.classList.remove("is-closing");
  panel.classList.remove("is-closing");
  backdrop?.classList.remove("is-closing");
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
  setTimeout(done, openMs + 50);
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
  const closeMs = root.classList.contains("game-start-modal") ? 350 : CLOSE_MS;

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
  setTimeout(done, closeMs + 50);
}
