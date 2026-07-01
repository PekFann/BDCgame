import type { GameAction, PrivateGameState, PublicGameState } from "../../shared/types.js";
import { closeAnimatedModal, forceCloseModal, openAnimatedModal } from "./modal-animations.js";
import { isTriggerDiceAnimDone } from "./trigger-roll-modal.js";

type SendFn = (action: GameAction) => void;

let modalEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;

function ensureTimeTravelModal(): { root: HTMLElement; panel: HTMLElement } {
  if (modalEl && panelEl) return { root: modalEl, panel: panelEl };

  modalEl = document.createElement("div");
  modalEl.id = "time-travel-modal";
  modalEl.className = "card-modal time-travel-modal";
  modalEl.hidden = true;
  modalEl.innerHTML = `
    <div class="card-modal-backdrop modal-overlay"></div>
    <div class="time-travel-panel modal-panel"></div>
  `;

  panelEl = modalEl.querySelector(".time-travel-panel") as HTMLElement;
  document.body.appendChild(modalEl);
  return { root: modalEl, panel: panelEl };
}

export function isTimeTravelModalOpen(): boolean {
  return modalEl !== null && !modalEl.hidden;
}

function rollerName(pub: PublicGameState, rollerId: string): string {
  return pub.players.find((p) => p.id === rollerId)?.name ?? "Someone";
}

function populatePanel(
  panel: HTMLElement,
  pub: PublicGameState,
  priv: PrivateGameState,
  send: SendFn
): void {
  const prompt = pub.pendingRerollPrompt;
  if (!prompt?.awaitingPlayerId) return;

  const awaiting = pub.players.find((p) => p.id === prompt.awaitingPlayerId);
  if (!awaiting) return;

  const human = pub.players.find((p) => p.isHuman);
  const isOwnOffer = awaiting.isHuman && awaiting.id === human?.id;
  const rolledBy = rollerName(pub, prompt.rollerId);
  const contextLabel = prompt.context === "trigger" ? "trigger roll" : "card roll";

  let message: string;
  if (isOwnOffer) {
    message = `You rolled <strong>${prompt.roll}</strong> on the ${contextLabel}. Use Time Travel to reroll? (Discard 1 card.)`;
  } else {
    message = `<strong>${awaiting.name}</strong> can use Time Travel to reroll <strong>${rolledBy}</strong>'s ${contextLabel} of <strong>${prompt.roll}</strong>. Allow it? (${awaiting.name} discards 1 card.)`;
  }

  panel.innerHTML = `
    <h3 class="card-modal-title">Time Travel</h3>
    <p class="card-modal-effect time-travel-copy">${message}</p>
    <div class="card-modal-buttons">
      <button class="btn time-travel-accept" type="button">Reroll</button>
      <button class="btn secondary time-travel-decline" type="button">Keep ${prompt.roll}</button>
    </div>
  `;

  panel.querySelector(".time-travel-accept")?.addEventListener("click", () => {
    send({ type: "ACCEPT_REROLL" });
  });
  panel.querySelector(".time-travel-decline")?.addEventListener("click", () => {
    send({ type: "DECLINE_REROLL" });
  });
}

export function refreshTimeTravelModal(
  pub: PublicGameState,
  priv: PrivateGameState | undefined,
  send: SendFn
): void {
  const { root, panel } = ensureTimeTravelModal();
  const prompt = pub.pendingRerollPrompt;
  const canRespond = (priv?.legalActions ?? []).some(
    (a) => a.type === "ACCEPT_REROLL" || a.type === "DECLINE_REROLL"
  );

  if (!prompt || !canRespond || !priv) {
    if (!root.hidden) closeAnimatedModal(root, panel, () => {});
    return;
  }

  if (prompt.context === "trigger" && !isTriggerDiceAnimDone()) {
    if (!root.hidden) closeAnimatedModal(root, panel, () => {});
    return;
  }

  populatePanel(panel, pub, priv, send);
  if (root.hidden) {
    openAnimatedModal(root, panel);
  } else {
    root.hidden = false;
    root.style.pointerEvents = "";
    panel.classList.remove("is-closing");
    root.classList.remove("is-closing");
    root.querySelector(".card-modal-backdrop, .modal-overlay")?.classList.remove("is-closing");
  }
}

export function resetTimeTravelModal(): void {
  if (modalEl && panelEl && !modalEl.hidden) {
    forceCloseModal(modalEl, panelEl);
  }
}
