import type { GameAction, PublicGameState } from "../../shared/types.js";
import { isGameIntroDismissed } from "./game-start-modal.js";
import { closeAnimatedModal, forceCloseModal, openAnimatedModal } from "./modal-animations.js";

type SendFn = (action: GameAction) => void;

let modalEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;

function ensureDrawModal(): { root: HTMLElement; panel: HTMLElement } {
  if (modalEl && panelEl) return { root: modalEl, panel: panelEl };

  modalEl = document.createElement("div");
  modalEl.id = "draw-phase-modal";
  modalEl.className = "card-modal draw-phase-modal";
  modalEl.hidden = true;
  modalEl.innerHTML = `
    <div class="card-modal-backdrop modal-overlay"></div>
    <div class="draw-phase-panel modal-panel">
      <h3 class="card-modal-title">Draw Phase</h3>
      <p class="card-modal-effect">Choose how to start your turn.</p>
      <div class="card-modal-buttons"></div>
    </div>
  `;

  panelEl = modalEl.querySelector(".draw-phase-panel") as HTMLElement;
  document.body.appendChild(modalEl);
  return { root: modalEl, panel: panelEl };
}

function populateDrawButtons(panel: HTMLElement, send: SendFn): void {
  const buttons = panel.querySelector(".card-modal-buttons")!;
  buttons.innerHTML = "";
  const addBtn = (label: string, choice: "card_and_energy" | "friendship") => {
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = label;
    btn.onclick = () => {
      send({ type: "CHOOSE_DRAW", choice });
      if (modalEl && panelEl) forceCloseModal(modalEl, panelEl);
    };
    buttons.appendChild(btn);
  };
  addBtn("Draw card + energy", "card_and_energy");
  addBtn("Gain friendship", "friendship");
}

export function closeDrawPhaseModal(): void {
  if (!modalEl || !panelEl) return;
  closeAnimatedModal(modalEl, panelEl, () => {});
}

export function closeDrawPhaseModalIfOpen(): void {
  closeDrawPhaseModal();
}

export function isDrawPhaseModalOpen(): boolean {
  return modalEl !== null && !modalEl.hidden;
}

export function shouldShowDrawPhaseModal(
  pub: PublicGameState,
  humanPlayerId: string
): boolean {
  const human = pub.players.find((p) => p.id === humanPlayerId);
  return (
    pub.phase === "draw" &&
    pub.started &&
    (isGameIntroDismissed() || pub.introAcknowledged) &&
    !!human &&
    human.drawChoice === null
  );
}

function getModalBackdrop(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".card-modal-backdrop, .modal-overlay");
}

function revealDrawModal(root: HTMLElement, panel: HTMLElement): void {
  root.hidden = false;
  root.style.pointerEvents = "";
  panel.classList.remove("is-closing");
  root.classList.remove("is-closing");
  getModalBackdrop(root)?.classList.remove("is-closing");
}

export function openDrawPhaseModalIfNeeded(
  pub: PublicGameState,
  humanPlayerId: string,
  send: SendFn
): void {
  if (!isGameIntroDismissed() && !pub.introAcknowledged) return;
  if (!shouldShowDrawPhaseModal(pub, humanPlayerId)) return;

  const { root, panel } = ensureDrawModal();
  populateDrawButtons(panel, send);
  if (root.hidden) {
    openAnimatedModal(root, panel);
  } else {
    revealDrawModal(root, panel);
  }
}

export function refreshDrawPhaseModal(
  pub: PublicGameState,
  humanPlayerId: string,
  send: SendFn
): void {
  const { root, panel } = ensureDrawModal();

  if (!isGameIntroDismissed() && !pub.introAcknowledged) {
    if (!root.hidden) closeDrawPhaseModal();
    return;
  }

  if (!shouldShowDrawPhaseModal(pub, humanPlayerId)) {
    if (!root.hidden) closeDrawPhaseModal();
    return;
  }

  openDrawPhaseModalIfNeeded(pub, humanPlayerId, send);
}
