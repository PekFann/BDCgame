import type {
  CardInstance,
  GameAction,
  PrivateGameState,
  PublicGameState,
} from "../../shared/types.js";
import { cardImg, cardName } from "./ws-client.js";
import { forceCloseCardModal, isCardModalOpen } from "./card-modal.js";
import { closeAnimatedModal, forceCloseModal, openAnimatedModal } from "./modal-animations.js";
import { humanControlsPending } from "./pending-choice-ui.js";

type SendFn = (action: GameAction) => void;
type Direction = "give" | "take";
type Resource = "cards" | "energy" | "friendship";
type Step = "direction" | "player" | "resource" | "amount" | "cards";

let modalEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;
let sessionKey: string | null = null;
let step: Step = "direction";
let direction: Direction | null = null;
let targetId: string | null = null;
let resource: Resource | null = null;
let amount = 1;
let selectedCardIds = new Set<string>();

function ensureModal(): { root: HTMLElement; panel: HTMLElement } {
  if (modalEl && panelEl) return { root: modalEl, panel: panelEl };

  modalEl = document.createElement("div");
  modalEl.id = "rule-book-modal";
  modalEl.className = "card-modal rule-book-modal";
  modalEl.hidden = true;
  modalEl.innerHTML = `
    <div class="card-modal-backdrop modal-overlay"></div>
    <div class="rule-book-panel modal-panel">
      <h3 class="rule-book-title card-modal-title"></h3>
      <p class="rule-book-hint card-modal-effect"></p>
      <div class="rule-book-body"></div>
      <div class="card-modal-buttons rule-book-actions"></div>
    </div>
  `;

  panelEl = modalEl.querySelector(".rule-book-panel") as HTMLElement;
  document.body.appendChild(modalEl);
  return { root: modalEl, panel: panelEl };
}

function resetWizard(): void {
  sessionKey = null;
  step = "direction";
  direction = null;
  targetId = null;
  resource = null;
  amount = 1;
  selectedCardIds = new Set();
}

function pendingSessionKey(pub: PublicGameState): string | null {
  const pending = pub.pendingChoice;
  if (!pending || pending.kind !== "rule_book") return null;
  return `${pending.playerId}:${pending.cardInstanceId ?? ""}:${(pending.targets ?? []).join(",")}`;
}

function sourcePlayer(
  pub: PublicGameState,
  casterId: string,
  dir: Direction,
  otherId: string
) {
  return pub.players.find((p) => p.id === (dir === "give" ? casterId : otherId));
}

function sourceHand(
  priv: PrivateGameState,
  casterId: string,
  dir: Direction,
  otherId: string
): CardInstance[] {
  const sourceId = dir === "give" ? casterId : otherId;
  return priv.teamHands.find((t) => t.playerId === sourceId)?.hand ?? [];
}

function maxAmount(
  pub: PublicGameState,
  casterId: string,
  dir: Direction,
  otherId: string,
  res: Resource
): number {
  const source = sourcePlayer(pub, casterId, dir, otherId);
  if (!source) return 0;
  if (res === "energy") return source.energy;
  if (res === "friendship") return source.friendship;
  return 0;
}

function renderWizard(
  pub: PublicGameState,
  priv: PrivateGameState,
  send: SendFn,
  humanPlayerId: string
): void {
  const { panel } = ensureModal();
  const pending = pub.pendingChoice!;
  const casterId = pending.playerId;
  const title = panel.querySelector(".rule-book-title") as HTMLElement;
  const hint = panel.querySelector(".rule-book-hint") as HTMLElement;
  const body = panel.querySelector(".rule-book-body") as HTMLElement;
  const actions = panel.querySelector(".rule-book-actions") as HTMLElement;

  title.textContent = pending.cardId
    ? `${cardName(pending.cardId)}`
    : "Rule Book";
  body.innerHTML = "";
  actions.innerHTML = "";

  if (step === "direction") {
    hint.textContent = "Give to another player, or take from them?";
    for (const dir of ["give", "take"] as Direction[]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn";
      btn.textContent = dir === "give" ? "Give" : "Take";
      btn.addEventListener("click", () => {
        direction = dir;
        step = "player";
        renderWizard(pub, priv, send, humanPlayerId);
      });
      actions.appendChild(btn);
    }
    return;
  }

  if (step === "player") {
    hint.textContent =
      direction === "give" ? "Choose who receives the transfer." : "Choose who you take from.";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn secondary";
    back.textContent = "Back";
    back.addEventListener("click", () => {
      step = "direction";
      direction = null;
      renderWizard(pub, priv, send, humanPlayerId);
    });
    actions.appendChild(back);

    for (const tid of pending.targets ?? []) {
      const player = pub.players.find((p) => p.id === tid);
      if (!player) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn";
      btn.textContent = player.name;
      btn.addEventListener("click", () => {
        targetId = tid;
        step = "resource";
        renderWizard(pub, priv, send, humanPlayerId);
      });
      actions.appendChild(btn);
    }
    return;
  }

  if (step === "resource") {
    const other = pub.players.find((p) => p.id === targetId);
    hint.textContent = `${direction === "give" ? "Give to" : "Take from"} ${other?.name ?? "player"} — choose a resource.`;
    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn secondary";
    back.textContent = "Back";
    back.addEventListener("click", () => {
      step = "player";
      targetId = null;
      resource = null;
      renderWizard(pub, priv, send, humanPlayerId);
    });
    actions.appendChild(back);

    for (const res of ["cards", "energy", "friendship"] as Resource[]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn";
      btn.textContent = res === "cards" ? "Cards" : res === "energy" ? "Energy" : "Friendship";
      btn.addEventListener("click", () => {
        resource = res;
        selectedCardIds = new Set();
        if (res === "cards") {
          step = "cards";
        } else {
          amount = Math.min(1, maxAmount(pub, casterId, direction!, targetId!, res));
          step = "amount";
        }
        renderWizard(pub, priv, send, humanPlayerId);
      });
      actions.appendChild(btn);
    }
    return;
  }

  if (step === "amount" && direction && targetId && resource && resource !== "cards") {
    const max = maxAmount(pub, casterId, direction, targetId, resource);
    const other = pub.players.find((p) => p.id === targetId);
    hint.textContent = `${direction === "give" ? "Give" : "Take"} ${resource} ${
      direction === "give" ? "to" : "from"
    } ${other?.name ?? "player"} (max ${max}).`;

    const stepper = document.createElement("div");
    stepper.className = "rule-book-stepper";
    stepper.innerHTML = `
      <button type="button" class="btn secondary rule-book-dec" aria-label="Less">−</button>
      <span class="rule-book-value">${amount}</span>
      <button type="button" class="btn secondary rule-book-inc" aria-label="More">+</button>
    `;
    body.appendChild(stepper);
    const dec = stepper.querySelector(".rule-book-dec") as HTMLButtonElement;
    const inc = stepper.querySelector(".rule-book-inc") as HTMLButtonElement;
    const valueEl = stepper.querySelector(".rule-book-value") as HTMLElement;
    dec.disabled = amount <= 1 || max < 1;
    inc.disabled = amount >= max;
    dec.addEventListener("click", () => {
      if (amount <= 1) return;
      amount -= 1;
      valueEl.textContent = String(amount);
      dec.disabled = amount <= 1;
      inc.disabled = amount >= max;
      confirm.disabled = amount < 1 || max < 1;
    });
    inc.addEventListener("click", () => {
      if (amount >= max) return;
      amount += 1;
      valueEl.textContent = String(amount);
      dec.disabled = amount <= 1;
      inc.disabled = amount >= max;
      confirm.disabled = amount < 1 || max < 1;
    });

    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn secondary";
    back.textContent = "Back";
    back.addEventListener("click", () => {
      step = "resource";
      resource = null;
      renderWizard(pub, priv, send, humanPlayerId);
    });
    actions.appendChild(back);

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "btn";
    confirm.textContent = "Confirm";
    confirm.disabled = amount < 1 || max < 1;
    confirm.addEventListener("click", () => {
      if (!direction || !targetId || !resource || amount < 1) return;
      send({
        type: "RULE_BOOK_TRANSFER",
        direction,
        targetId,
        resource,
        amount,
      });
      resetWizard();
      if (modalEl && panelEl) forceCloseModal(modalEl, panelEl);
    });
    actions.appendChild(confirm);
    return;
  }

  if (step === "cards" && direction && targetId) {
    const other = pub.players.find((p) => p.id === targetId);
    const hand = sourceHand(priv, casterId, direction, targetId);
    hint.textContent = `${direction === "give" ? "Give cards to" : "Take cards from"} ${
      other?.name ?? "player"
    }. Select one or more, then Confirm.`;

    const grid = document.createElement("div");
    grid.className = "rule-book-card-grid";
    for (const card of hand) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `rule-book-pick-card${selectedCardIds.has(card.instanceId) ? " is-selected" : ""}`;
      btn.innerHTML = `<img src="${cardImg(card.cardId)}" alt="${cardName(card.cardId)}" />`;
      btn.addEventListener("click", () => {
        if (selectedCardIds.has(card.instanceId)) selectedCardIds.delete(card.instanceId);
        else selectedCardIds.add(card.instanceId);
        renderWizard(pub, priv, send, humanPlayerId);
      });
      grid.appendChild(btn);
    }
    body.appendChild(grid);

    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn secondary";
    back.textContent = "Back";
    back.addEventListener("click", () => {
      step = "resource";
      resource = null;
      selectedCardIds = new Set();
      renderWizard(pub, priv, send, humanPlayerId);
    });
    actions.appendChild(back);

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "btn";
    confirm.textContent = `Confirm (${selectedCardIds.size})`;
    confirm.disabled = selectedCardIds.size === 0 || hand.length === 0;
    confirm.addEventListener("click", () => {
      if (!direction || !targetId || selectedCardIds.size === 0) return;
      send({
        type: "RULE_BOOK_TRANSFER",
        direction,
        targetId,
        resource: "cards",
        cardInstanceIds: [...selectedCardIds],
      });
      resetWizard();
      if (modalEl && panelEl) forceCloseModal(modalEl, panelEl);
    });
    actions.appendChild(confirm);
  }
}

export function isRuleBookModalOpen(): boolean {
  return modalEl !== null && !modalEl.hidden;
}

export function refreshRuleBookModal(
  pub: PublicGameState,
  priv: PrivateGameState | undefined,
  send: SendFn,
  humanPlayerId: string
): void {
  const { root, panel } = ensureModal();
  const pending = pub.pendingChoice;
  const canUse =
    pending?.kind === "rule_book" &&
    humanControlsPending(pub, humanPlayerId) &&
    !!priv &&
    (priv.legalActions ?? []).some((a) => a.type === "RULE_BOOK_TRANSFER");

  if (!canUse || !priv) {
    if (!root.hidden) {
      closeAnimatedModal(root, panel, () => {});
      resetWizard();
    }
    return;
  }

  if (isCardModalOpen()) forceCloseCardModal();

  const key = pendingSessionKey(pub);
  if (key !== sessionKey) {
    resetWizard();
    sessionKey = key;
  }

  renderWizard(pub, priv, send, humanPlayerId);
  if (root.hidden) openAnimatedModal(root, panel);
}

export function resetRuleBookModal(): void {
  resetWizard();
  if (modalEl && panelEl && !modalEl.hidden) {
    forceCloseModal(modalEl, panelEl);
  }
}
