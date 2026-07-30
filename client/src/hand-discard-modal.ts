import type { GameAction, PrivateGameState, PublicGameState } from "../../shared/types.js";
import cardsData from "../../data/cards.json";
import { cardImg, cardName } from "./ws-client.js";
import { forceCloseCardModal, isCardModalOpen } from "./card-modal.js";
import { isGiftsDiscardPending, snapshotPossessedHpBeforeHeal } from "./heal-vfx.js";
import { closeAnimatedModal, forceCloseModal, openAnimatedModal } from "./modal-animations.js";
import { humanControlsPending, pendingOwnerHand } from "./pending-choice-ui.js";

type SendFn = (action: GameAction) => void;

const cardEffectById = Object.fromEntries(
  (cardsData as { id: string; effectId?: string }[]).map((c) => [c.id, c.effectId ?? ""])
);

function isTimeTravelCardId(cardId: string): boolean {
  return cardEffectById[cardId] === "time_travel";
}

let modalEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;
let keepSelected = new Set<string>();

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
      <div class="hand-discard-actions card-modal-buttons" hidden></div>
    </div>
  `;

  panelEl = modalEl.querySelector(".hand-discard-panel") as HTMLElement;
  document.body.appendChild(modalEl);
  return { root: modalEl, panel: panelEl };
}

function discardTitle(pub: PublicGameState): string {
  const pending = pub.pendingChoice;
  const cardId = pending?.cardId;
  const owner = pub.players.find((p) => p.id === pending?.playerId);
  const ownerLabel = owner && !owner.isHuman ? `${owner.name} — ` : "";
  if (pending?.kind === "keep_cards" && cardId) {
    return `${ownerLabel}${cardName(cardId)} — choose cards to keep`;
  }
  if (cardId) return `${ownerLabel}${cardName(cardId)} — choose card to discard`;
  return `${ownerLabel}Choose card to discard`;
}

function discardHint(pub: PublicGameState): string {
  const pending = pub.pendingChoice;
  if (!pending) return "";
  if (pending.kind === "keep_cards") {
    const min = pending.minKeep ?? 2;
    const max = pending.maxKeep ?? min;
    if (min === max) return `Choose ${min} card${min === 1 ? "" : "s"} to keep. They will be added to your hand.`;
    return `Choose ${min}–${max} cards to keep. They will be added to your hand.`;
  }
  if (pending.kind !== "discard_cards") return "";
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
    humanControlsPending(pub, humanPlayerId) &&
    (priv?.legalActions ?? []).some((a) => a.type === "DISCARD_CARDS");
  const canKeep =
    pending?.kind === "keep_cards" &&
    humanControlsPending(pub, humanPlayerId) &&
    (priv?.legalActions ?? []).some((a) => a.type === "KEEP_CARDS");

  if ((!canDiscard && !canKeep) || !priv) {
    keepSelected.clear();
    if (!root.hidden) closeAnimatedModal(root, panel, () => {});
    return;
  }

  if (isCardModalOpen()) forceCloseCardModal();

  const title = panel.querySelector(".hand-discard-title") as HTMLElement;
  const hint = panel.querySelector(".hand-discard-hint") as HTMLElement;
  const grid = panel.querySelector(".hand-discard-grid") as HTMLElement;
  const actions = panel.querySelector(".hand-discard-actions") as HTMLElement;

  title.textContent = discardTitle(pub);
  hint.textContent = discardHint(pub);
  grid.innerHTML = "";
  actions.innerHTML = "";
  actions.hidden = true;

  if (canKeep && pending?.kind === "keep_cards") {
    const min = pending.minKeep ?? 2;
    const max = pending.maxKeep ?? min;
    const options = pending.options ?? [];
    const validIds = new Set(options.map((o) => o.id));
    for (const id of [...keepSelected]) {
      if (!validIds.has(id)) keepSelected.delete(id);
    }

    for (const opt of options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hand-discard-pick-card";
      if (keepSelected.has(opt.id)) btn.classList.add("is-selected");
      const cardId = opt.cardId ?? opt.id;
      btn.innerHTML = `<img src="${cardImg(cardId)}" alt="${opt.label}" />`;
      btn.addEventListener("click", () => {
        if (keepSelected.has(opt.id)) {
          keepSelected.delete(opt.id);
        } else if (keepSelected.size < max) {
          keepSelected.add(opt.id);
        } else if (max === 1) {
          keepSelected.clear();
          keepSelected.add(opt.id);
        }
        refreshHandDiscardModal(pub, priv, send, humanPlayerId);
      });
      grid.appendChild(btn);
    }

    actions.hidden = false;
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "btn";
    confirm.textContent = `Keep ${keepSelected.size}/${max}`;
    confirm.disabled = keepSelected.size < min || keepSelected.size > max;
    confirm.addEventListener("click", () => {
      if (keepSelected.size < min || keepSelected.size > max) return;
      send({ type: "KEEP_CARDS", cardInstanceIds: [...keepSelected] });
      keepSelected.clear();
      forceCloseModal(root, panel);
    });
    actions.appendChild(confirm);
  } else {
    keepSelected.clear();
    const min = pending!.minDiscard ?? 1;
    const max = pending!.maxDiscard ?? min;
    const ownerHand = pendingOwnerHand(pub, priv);
    const excludeTimeTravel = pending!.cardId === "action_11";
    const cards = excludeTimeTravel
      ? ownerHand.filter((c) => !isTimeTravelCardId(c.cardId))
      : ownerHand;

    for (const card of cards) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hand-discard-pick-card";
      btn.innerHTML = `<img src="${cardImg(card.cardId)}" alt="${cardName(card.cardId)}" />`;
      btn.addEventListener("click", () => {
        const ids = min === 1 && max === 1 ? [card.instanceId] : [card.instanceId];
        if (isGiftsDiscardPending(pub)) {
          snapshotPossessedHpBeforeHeal(pub);
        }
        send({ type: "DISCARD_CARDS", cardInstanceIds: ids });
        forceCloseModal(root, panel);
      });
      grid.appendChild(btn);
    }
  }

  if (root.hidden) {
    const preserveTrigger =
      !!pub.pendingRerollPrompt || pending?.cardId === "action_11";
    openAnimatedModal(
      root,
      panel,
      preserveTrigger ? { preserveModalIds: ["trigger-roll-modal"] } : undefined
    );
  }
}

export function resetHandDiscardModal(): void {
  keepSelected.clear();
  if (modalEl && panelEl && !modalEl.hidden) {
    forceCloseModal(modalEl, panelEl);
  }
}
