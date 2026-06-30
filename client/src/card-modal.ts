import type { CardInstance, GameAction, PrivateGameState, PublicGameState } from "../../shared/types.js";
import cardsData from "../../data/cards.json";
import { CARD_PICK_ONE_OPTIONS, isPickOneEffect } from "./card-play-options.js";
import { closeAnimatedModal, forceCloseModal, openAnimatedModal } from "./modal-animations.js";
import { cardImg, cardName } from "./ws-client.js";

type SendFn = (action: GameAction) => void;
type ModalMode = "preview" | "resolve";

interface CardDef {
  id: string;
  name: string;
  type?: string;
  effectId?: string;
  energyCost?: number;
  friendshipCost?: number;
  effect?: string;
}

export interface CardModalContext {
  pub: PublicGameState;
  priv: PrivateGameState;
  send: SendFn;
  humanPlayerId: string;
}

const cardDefs = Object.fromEntries((cardsData as CardDef[]).map((c) => [c.id, c]));

let modalEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;
let modalMode: ModalMode = "preview";
let openInstanceId: string | null = null;
let openCardId: string | null = null;
let resolvingCardId: string | null = null;
let humanPlayerId = "";
let isClosing = false;

function getPanel(): HTMLElement {
  return panelEl ?? modalEl!.querySelector(".card-modal-layout")!;
}

export function canPrayerDealDamage(pub: PublicGameState): boolean {
  const impsAlive = pub.imps.some((i) => i.hp > 0);
  const demonTargetable = pub.demonRevealed && pub.demon !== null && pub.demon.hp > 0;
  return impsAlive || demonTargetable;
}

function isOptionDisabled(pub: PublicGameState, effectId: string | undefined, optionId: string): boolean {
  if (effectId === "prayer" && optionId === "damage") {
    return !canPrayerDealDamage(pub);
  }
  return false;
}

export function ensureCardModal(): HTMLElement {
  if (modalEl) return modalEl;

  modalEl = document.createElement("div");
  modalEl.id = "card-modal";
  modalEl.className = "card-modal";
  modalEl.hidden = true;
  modalEl.innerHTML = `
    <div class="card-modal-backdrop modal-overlay" data-close></div>
    <div class="card-modal-layout modal-panel">
      <img class="card-modal-img" alt="" />
      <aside class="card-modal-actions">
        <h3 class="card-modal-title"></h3>
        <p class="card-modal-meta"></p>
        <p class="card-modal-effect"></p>
        <div class="card-modal-buttons"></div>
      </aside>
    </div>
  `;

  panelEl = modalEl.querySelector(".card-modal-layout") as HTMLElement;
  modalEl.querySelector("[data-close]")?.addEventListener("click", () => closeCardModal());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalEl && !modalEl.hidden && !isClosing) closeCardModal();
  });

  document.body.appendChild(modalEl);
  return modalEl;
}

function resetModalState(): void {
  delete modalEl?.dataset.mode;
  modalMode = "preview";
  openInstanceId = null;
  openCardId = null;
  resolvingCardId = null;
  isClosing = false;
}

export function closeCardModal(): void {
  if (!modalEl || modalEl.hidden || isClosing) {
    if (modalEl?.hidden) resetModalState();
    return;
  }
  isClosing = true;
  closeAnimatedModal(modalEl, getPanel(), resetModalState);
}

export function forceCloseCardModal(): void {
  if (!modalEl) return;
  forceCloseModal(modalEl, getPanel());
  resetModalState();
}

export function isCardModalOpen(): boolean {
  return modalEl !== null && !modalEl.hidden;
}

export function isCardModalBlockingPendingActions(): boolean {
  return isCardModalOpen() && modalMode === "resolve";
}

export function getOpenCardInstanceId(): string | null {
  return openInstanceId;
}

function canPlayCard(priv: PrivateGameState, instanceId: string): boolean {
  return priv.legalActions.some(
    (a) => a.type === "PLAY_CARD" && a.cardInstanceId === instanceId
  );
}

function pendingBelongsToHuman(pub: PublicGameState): boolean {
  const pending = pub.pendingChoice;
  return !!pending && pending.playerId === humanPlayerId;
}

function renderCardContent(el: HTMLElement, cardId: string): void {
  const def = cardDefs[cardId];
  const img = el.querySelector(".card-modal-img") as HTMLImageElement;
  const title = el.querySelector(".card-modal-title")!;
  const meta = el.querySelector(".card-modal-meta")!;
  const effect = el.querySelector(".card-modal-effect")!;

  img.src = cardImg(cardId);
  img.alt = cardName(cardId);
  title.textContent = def?.name ?? cardName(cardId);

  const parts: string[] = [];
  if (def?.type) parts.push(def.type.replace(/_/g, " "));
  if (def?.energyCost) parts.push(`Energy ${def.energyCost}`);
  if (def?.friendshipCost) parts.push(`Friendship ${def.friendshipCost}`);
  meta.textContent = parts.join(" · ") || "Card";
  effect.textContent = def?.effect ?? "";
}

function renderModalButtons(
  buttonsEl: HTMLElement,
  pub: PublicGameState,
  priv: PrivateGameState,
  instanceId: string | null,
  cardId: string,
  send: SendFn
): void {
  buttonsEl.innerHTML = "";
  const def = cardDefs[cardId];

  const addBtn = (
    label: string,
    action: () => void,
    primary = false,
    disabled = false
  ) => {
    const btn = document.createElement("button");
    btn.className = primary ? "btn" : "btn secondary";
    if (disabled) btn.classList.add("disabled");
    btn.textContent = label;
    btn.disabled = disabled;
    if (!disabled) btn.onclick = action;
    buttonsEl.appendChild(btn);
  };

  const pending = pub.pendingChoice;
  const showPending = modalMode === "resolve" && pendingBelongsToHuman(pub);

  if (showPending && pending?.options) {
    for (const opt of pending.options) {
      const disabled = isOptionDisabled(pub, def?.effectId, opt.id);
      addBtn(
        opt.label,
        () => {
          send({ type: "RESOLVE_PICK_ONE", optionId: opt.id });
          if (opt.id !== "damage") forceCloseCardModal();
        },
        true,
        disabled
      );
    }
  } else if (showPending && pending?.targets) {
    for (const t of pending.targets) {
      addBtn(`Target demon (${pending.amount ?? 1} dmg)`, () => {
        send({ type: "SELECT_TARGET", targetId: t });
        forceCloseCardModal();
      }, true);
    }
  } else if (
    modalMode === "preview" &&
    instanceId &&
    canPlayCard(priv, instanceId) &&
    isPickOneEffect(def?.effectId)
  ) {
    const options = CARD_PICK_ONE_OPTIONS[def!.effectId!];
    for (const opt of options) {
      const disabled = isOptionDisabled(pub, def?.effectId, opt.id);
      addBtn(
        opt.label,
        () => {
          modalMode = "resolve";
          resolvingCardId = cardId;
          openCardId = cardId;
          send({
            type: "PLAY_CARD",
            cardInstanceId: instanceId,
            pickOptionId: opt.id,
          });
          if (opt.id === "draw") {
            forceCloseCardModal();
          }
        },
        true,
        disabled
      );
    }
  } else if (modalMode === "preview" && instanceId && canPlayCard(priv, instanceId)) {
    addBtn(
      "Play Card",
      () => {
        modalMode = "resolve";
        resolvingCardId = cardId;
        openCardId = cardId;
        send({ type: "PLAY_CARD", cardInstanceId: instanceId });
      },
      true
    );
  } else if (modalMode === "preview") {
    const hint = document.createElement("p");
    hint.className = "card-modal-hint";
    hint.textContent = "Cannot play this card right now.";
    buttonsEl.appendChild(hint);
  }

  addBtn("Cancel", closeCardModal);
}

function showModalAnimated(): void {
  const el = ensureCardModal();
  if (el.hidden) {
    openAnimatedModal(el, getPanel());
  }
}

function renderModal(ctx: CardModalContext, cardId: string, instanceId: string | null): void {
  const el = ensureCardModal();
  renderCardContent(el, cardId);
  const buttons = el.querySelector(".card-modal-buttons")!;
  renderModalButtons(buttons as HTMLElement, ctx.pub, ctx.priv, instanceId, cardId, ctx.send);
  el.dataset.mode = modalMode;
  showModalAnimated();
}

export function openCardModal(card: CardInstance, ctx: CardModalContext): void {
  humanPlayerId = ctx.humanPlayerId;
  modalMode = "preview";
  openInstanceId = card.instanceId;
  openCardId = card.cardId;
  resolvingCardId = null;
  isClosing = false;
  renderModal(ctx, card.cardId, card.instanceId);
}

export function refreshCardModalIfOpen(ctx: CardModalContext): void {
  if (!isCardModalOpen() || isClosing) return;

  humanPlayerId = ctx.humanPlayerId;
  const { pub, priv, send } = ctx;

  if (modalMode === "resolve" && resolvingCardId) {
    if (!pub.pendingChoice) {
      forceCloseCardModal();
      return;
    }
    if (!pendingBelongsToHuman(pub)) {
      forceCloseCardModal();
      return;
    }
    renderModal(ctx, resolvingCardId, openInstanceId);
    return;
  }

  if (!openInstanceId) {
    forceCloseCardModal();
    return;
  }

  const card = priv.hand.find((c) => c.instanceId === openInstanceId);
  if (!card) {
    forceCloseCardModal();
    return;
  }

  openCardId = card.cardId;
  renderModal(ctx, card.cardId, card.instanceId);
}
