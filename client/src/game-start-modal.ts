import type { GameAction, PublicGameState } from "../../shared/types.js";
import { closeDrawPhaseModalIfOpen } from "./draw-phase-modal.js";
import { closeAnimatedModal, forceCloseModal, openAnimatedModal } from "./modal-animations.js";

let modalEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;
let introDismissed = false;
let introSequenceComplete = false;
let introSend: ((action: GameAction) => void) | null = null;
const dismissListeners: (() => void)[] = [];

function ensureStartModal(): { root: HTMLElement; panel: HTMLElement } {
  if (modalEl && panelEl) return { root: modalEl, panel: panelEl };

  modalEl = document.createElement("div");
  modalEl.id = "game-start-modal";
  modalEl.className = "card-modal game-start-modal";
  modalEl.hidden = true;
  modalEl.innerHTML = `
    <div class="card-modal-backdrop modal-overlay"></div>
    <div class="game-start-panel modal-panel">
      <h2 class="game-start-title">Breaking Demon's Contract</h2>
      <p class="card-modal-effect">Save the Possessed. Break the contract.</p>
      <button class="btn game-start-btn" type="button">Start Game</button>
    </div>
  `;

  panelEl = modalEl.querySelector(".game-start-panel") as HTMLElement;
  panelEl.querySelector(".game-start-btn")?.addEventListener("click", () => {
    introDismissed = true;
    if (introSend) {
      introSend({ type: "ACK_GAME_INTRO" });
    } else if (import.meta.env.DEV) {
      console.error("ACK_GAME_INTRO not sent: game intro send handler was not configured.");
    }
    forceCloseModal(modalEl!, panelEl!);
    for (const cb of dismissListeners) cb();
  });

  document.body.appendChild(modalEl);
  return { root: modalEl, panel: panelEl };
}

export function setGameIntroSend(send: (action: GameAction) => void): void {
  introSend = send;
}

export function isGameIntroDismissed(): boolean {
  return introDismissed;
}

export function isGameIntroSequenceComplete(): boolean {
  return introSequenceComplete;
}

export function markGameIntroSequenceComplete(): void {
  introSequenceComplete = true;
}

export function markGameIntroDismissedFromServer(): void {
  introDismissed = true;
  introSequenceComplete = true;
}

export function resetGameIntro(): void {
  introDismissed = false;
  introSequenceComplete = false;
}

export function resetIntroSequenceOnly(): void {
  introSequenceComplete = false;
}

export function onGameIntroDismissed(cb: () => void): void {
  dismissListeners.push(cb);
}

function shouldShowGameStartModal(pub: PublicGameState): boolean {
  return (
    pub.started &&
    pub.cycle === 1 &&
    introSequenceComplete &&
    !introDismissed &&
    !pub.introAcknowledged
  );
}

export function openGameStartModalIfNeeded(pub: PublicGameState): void {
  if (!shouldShowGameStartModal(pub)) return;

  const { root, panel } = ensureStartModal();
  closeDrawPhaseModalIfOpen();
  if (root.hidden) {
    openAnimatedModal(root, panel);
  } else {
    root.hidden = false;
    root.style.pointerEvents = "";
    panel.classList.remove("is-closing");
    root.classList.remove("is-closing");
    getModalBackdrop(root)?.classList.remove("is-closing");
  }
}

function getModalBackdrop(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".card-modal-backdrop, .modal-overlay");
}

export function refreshGameStartModal(pub: PublicGameState): void {
  if (pub.introAcknowledged) {
    markGameIntroDismissedFromServer();
  }

  const { root, panel } = ensureStartModal();

  if (!shouldShowGameStartModal(pub)) {
    if (!root.hidden && introDismissed) {
      closeAnimatedModal(root, panel, () => {});
    }
    return;
  }

  openGameStartModalIfNeeded(pub);
}
