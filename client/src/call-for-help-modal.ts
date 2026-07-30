import type { GameAction, PublicGameState } from "../../shared/types.js";
import { cardImg, cardName } from "./ws-client.js";
import { forceCloseCardModal, isCardModalOpen } from "./card-modal.js";
import { closeAnimatedModal, forceCloseModal, openAnimatedModal } from "./modal-animations.js";
import { humanControlsPending } from "./pending-choice-ui.js";

type SendFn = (action: GameAction) => void;

let modalEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;

function ensureModal(): { root: HTMLElement; panel: HTMLElement } {
  if (modalEl && panelEl) return { root: modalEl, panel: panelEl };

  modalEl = document.createElement("div");
  modalEl.id = "call-for-help-modal";
  modalEl.className = "card-modal call-for-help-modal";
  modalEl.hidden = true;
  modalEl.innerHTML = `
    <div class="card-modal-backdrop modal-overlay"></div>
    <div class="call-for-help-panel modal-panel">
      <h3 class="call-for-help-title card-modal-title"></h3>
      <p class="call-for-help-hint card-modal-effect"></p>
      <div class="call-for-help-grid"></div>
    </div>
  `;

  panelEl = modalEl.querySelector(".call-for-help-panel") as HTMLElement;
  document.body.appendChild(modalEl);
  return { root: modalEl, panel: panelEl };
}

export function isCallForHelpModalOpen(): boolean {
  return modalEl !== null && !modalEl.hidden;
}

export function refreshCallForHelpModal(
  pub: PublicGameState,
  send: SendFn,
  humanPlayerId: string
): void {
  const { root, panel } = ensureModal();
  const pending = pub.pendingChoice;
  const canPick =
    pending?.kind === "pick_action_discard" &&
    humanControlsPending(pub, humanPlayerId) &&
    (pending.options?.length ?? 0) > 0;

  if (!canPick) {
    if (!root.hidden) closeAnimatedModal(root, panel, () => {});
    return;
  }

  if (isCardModalOpen()) forceCloseCardModal();

  const title = panel.querySelector(".call-for-help-title") as HTMLElement;
  const hint = panel.querySelector(".call-for-help-hint") as HTMLElement;
  const grid = panel.querySelector(".call-for-help-grid") as HTMLElement;
  const owner = pub.players.find((p) => p.id === pending!.playerId);
  const ownerLabel = owner && !owner.isHuman ? `${owner.name} — ` : "";
  const fromDeck = pending!.searchPile === "deck";
  const pileLabel = fromDeck ? "deck" : "discard";

  title.textContent = pending!.cardId
    ? `${ownerLabel}${cardName(pending!.cardId)} — pick from ${pileLabel}`
    : `${ownerLabel}Call for Help — pick from discard`;
  hint.textContent = fromDeck
    ? "Choose a card from the Action Deck."
    : "Choose a card from the Discard Pile.";

  grid.innerHTML = "";

  if (fromDeck) {
    for (const opt of pending!.options ?? []) {
      const cid = opt.cardId;
      if (!cid) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "call-for-help-pick-card";
      btn.innerHTML = `<img src="${cardImg(cid)}" alt="${opt.label}" />`;
      btn.addEventListener("click", () => {
        send({ type: "RESOLVE_PICK_ONE", optionId: opt.id });
        forceCloseModal(root, panel);
      });
      grid.appendChild(btn);
    }
  } else {
    const discard = pub.actionDiscard ?? [];
    for (const card of discard) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "call-for-help-pick-card";
      btn.innerHTML = `<img src="${cardImg(card.cardId)}" alt="${cardName(card.cardId)}" />`;
      btn.addEventListener("click", () => {
        send({ type: "RESOLVE_PICK_ONE", optionId: card.instanceId });
        forceCloseModal(root, panel);
      });
      grid.appendChild(btn);
    }
  }

  if (root.hidden) openAnimatedModal(root, panel);
}

export function resetCallForHelpModal(): void {
  if (modalEl && panelEl && !modalEl.hidden) {
    forceCloseModal(modalEl, panelEl);
  }
}
