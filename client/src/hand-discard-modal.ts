import type { GameAction, PrivateGameState, PublicGameState } from "../../shared/types.js";
import { cardImg, cardName } from "./ws-client.js";
import { forceCloseCardModal, isCardModalOpen } from "./card-modal.js";
import { closeAnimatedModal, forceCloseModal, openAnimatedModal } from "./modal-animations.js";

type SendFn = (action: GameAction) => void;

let modalEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;

function ensureModal(): { root: HTMLElement; panel: HTMLElement } {
  if (modalEl && panelEl) return { root: modalEl, panel: panelEl };

  modalEl = document.createElement("div");
  modalEl.id = "hand-discard-modal";
  modalEl.className = "card-modal hand-discard-modal";
  modalEl.hidden = true;
  modalEl.innerHTML = `
    <div class="card-modal-backdrop modal-overlay"></div>
    <div class="hand-discard-panel modal-panel">
      <h3 class="hand-discard-title card-modal-title"></h3>
      <p class="hand-discard-hint card-modal-effect"></p>
      <div class="hand-discard-grid"></div>
    </div>
  `;

  panelEl = modalEl.querySelector(".hand-discard-panel") as HTMLElement;
  document.body.appendChild(modalEl);
  return { root: modalEl, panel: panelEl };
}

function discardTitle(pub: PublicGameState): string {
  const cardId = pub.pendingChoice?.cardId;
  if (cardId) return `${cardName(cardId)} — choose card to discard`;
  return "Choose card to discard";
}

function discardHint(pub: PublicGameState): string {
  const pending = pub.pendingChoice;
  if (!pending || pending.kind !== "discard_cards") return "";
  const min = pending.minDiscard ?? 1;
  const max = pending.maxDiscard ?? min;
  if (min === max) return `Discard ${min} card${min === 1 ? "" : "s"}.`;
  return `Discard ${min}–${max} cards.`;
}

export function isHandDiscardModalOpen(): boolean {
  return modalEl !== null && !modalEl.hidden;
}

export function refreshHandDiscardModal(
  pub: PublicGameState,
  priv: PrivateGameState | undefined,
  send: SendFn,
  humanPlayerId: string
): void {
  const { root, panel } = ensureModal();
  const pending = pub.pendingChoice;
  const canDiscard =
    pending?.kind === "discard_cards" &&
    pending.playerId === humanPlayerId &&
    (priv?.legalActions ?? []).some((a) => a.type === "DISCARD_CARDS");

  if (!canDiscard || !priv) {
    if (!root.hidden) closeAnimatedModal(root, panel, () => {});
    return;
  }

  if (isCardModalOpen()) forceCloseCardModal();

  const title = panel.querySelector(".hand-discard-title") as HTMLElement;
  const hint = panel.querySelector(".hand-discard-hint") as HTMLElement;
  const grid = panel.querySelector(".hand-discard-grid") as HTMLElement;

  title.textContent = discardTitle(pub);
  hint.textContent = discardHint(pub);

  grid.innerHTML = "";
  const min = pending!.minDiscard ?? 1;
  const max = pending!.maxDiscard ?? min;

  for (const card of priv.hand) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hand-discard-pick-card";
    btn.innerHTML = `<img src="${cardImg(card.cardId)}" alt="${cardName(card.cardId)}" />`;
    btn.addEventListener("click", () => {
      const ids = min === 1 && max === 1 ? [card.instanceId] : [card.instanceId];
      send({ type: "DISCARD_CARDS", cardInstanceIds: ids });
      forceCloseModal(root, panel);
    });
    grid.appendChild(btn);
  }

  if (root.hidden) openAnimatedModal(root, panel);
}

export function resetHandDiscardModal(): void {
  if (modalEl && panelEl && !modalEl.hidden) {
    forceCloseModal(modalEl, panelEl);
  }
}
