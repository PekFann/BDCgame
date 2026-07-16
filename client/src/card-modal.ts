import type { CardInstance, GameAction, PrivateGameState, PublicGameState } from "../../shared/types.js";
import cardsData from "../../data/cards.json";
import { CARD_PICK_ONE_OPTIONS, isPickOneEffect } from "./card-play-options.js";
import { DIRECT_FRIENDSHIP_EFFECT_IDS, isFriendshipGainOption, snapshotFriendshipBeforeChoice } from "./friendship-vfx.js";
import { closeAnimatedModal, forceCloseModal, openAnimatedModal } from "./modal-animations.js";
import { humanControlsPending, isBoardMountedEventPending } from "./pending-choice-ui.js";
import { cardImg, cardName, getTeamHand } from "./ws-client.js";
import { isInputLocked } from "./input-lock.js";

type SendFn = (action: GameAction) => void;
type ModalMode = "preview" | "resolve";

function snapshotIfFriendshipGain(pub: PublicGameState, humanPlayerId: string, optionId: string): void {
  if (isFriendshipGainOption(optionId)) {
    snapshotFriendshipBeforeChoice(pub, humanPlayerId);
  }
}

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
  /** Card owner; defaults to human when omitted. */
  ownerPlayerId?: string;
}

const cardDefs = Object.fromEntries((cardsData as CardDef[]).map((c) => [c.id, c]));

let modalEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;
let modalMode: ModalMode = "preview";
let openInstanceId: string | null = null;
let openCardId: string | null = null;
let resolvingCardId: string | null = null;
let humanPlayerId = "";
let openOwnerPlayerId = "";
let isClosing = false;

function getPanel(): HTMLElement {
  return panelEl ?? modalEl!.querySelector(".card-modal-layout")!;
}

export function canPrayerDealDamage(pub: PublicGameState): boolean {
  const impsAlive = pub.imps.some((i) => i.hp > 0);
  const demonTargetable = pub.demonRevealed && pub.demon !== null && pub.demon.hp > 0;
  return impsAlive || demonTargetable;
}

export function canHealPossessed(pub: PublicGameState): boolean {
  if (pub.possessedHp >= pub.possessedMaxHp) return false;
  if (pub.modifiers.healingBlocked) return false;
  if (pub.phase === "night" && pub.modifiers.noHealAtNight) return false;
  return true;
}

function isHealOption(optionId: string): boolean {
  return optionId === "heal" || optionId === "heal2";
}

function appendHealFullNote(buttonsEl: HTMLElement, pub: PublicGameState): void {
  if (pub.possessedHp < pub.possessedMaxHp) return;
  const note = document.createElement("p");
  note.className = "card-modal-hint card-modal-heal-full-note";
  note.textContent = "Possessed health is full.";
  buttonsEl.appendChild(note);
}

function isOptionDisabled(pub: PublicGameState, effectId: string | undefined, optionId: string): boolean {
  if (effectId === "prayer" && optionId === "damage") {
    return !canPrayerDealDamage(pub);
  }
  if (isHealOption(optionId)) {
    return !canHealPossessed(pub);
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
  openOwnerPlayerId = "";
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

export function isCardModalBlockingPendingActions(pub?: PublicGameState): boolean {
  if (!isCardModalOpen() || modalMode !== "resolve") return false;
  if (pub && isBoardMountedEventPending(pub, humanPlayerId)) return false;
  return true;
}

export function handleCardModalActionError(): void {
  if (!isCardModalOpen() || modalMode !== "resolve") return;
  modalMode = "preview";
  resolvingCardId = null;
  if (modalEl) modalEl.dataset.mode = "preview";
}

export function getOpenCardInstanceId(): string | null {
  return openInstanceId;
}

function canPlayOwnCard(priv: PrivateGameState, instanceId: string): boolean {
  return priv.legalActions.some(
    (a) => a.type === "PLAY_CARD" && a.cardInstanceId === instanceId
  );
}

function canPlayTeamCard(
  priv: PrivateGameState,
  ownerPlayerId: string,
  instanceId: string
): boolean {
  return priv.legalActions.some(
    (a) =>
      a.type === "PLAY_TEAM_CARD" &&
      a.ownerPlayerId === ownerPlayerId &&
      a.cardInstanceId === instanceId
  );
}

function canPlayOpenCard(priv: PrivateGameState, instanceId: string): boolean {
  if (openOwnerPlayerId === humanPlayerId) return canPlayOwnCard(priv, instanceId);
  return canPlayTeamCard(priv, openOwnerPlayerId, instanceId);
}

function findOpenCard(priv: PrivateGameState): CardInstance | undefined {
  if (!openInstanceId) return undefined;
  return getTeamHand(priv, openOwnerPlayerId || humanPlayerId).find(
    (c) => c.instanceId === openInstanceId
  );
}

function playCardAction(instanceId: string, pickOptionId?: string): GameAction {
  if (openOwnerPlayerId !== humanPlayerId) {
    return {
      type: "PLAY_TEAM_CARD",
      ownerPlayerId: openOwnerPlayerId,
      cardInstanceId: instanceId,
      pickOptionId,
    };
  }
  return { type: "PLAY_CARD", cardInstanceId: instanceId, pickOptionId };
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
    if (!disabled) {
      btn.onclick = () => {
        if (isInputLocked()) return;
        action();
      };
    }
    buttonsEl.appendChild(btn);
  };

  const pending = pub.pendingChoice;
  const showPending =
    modalMode === "resolve" &&
    humanControlsPending(pub, humanPlayerId) &&
    !isBoardMountedEventPending(pub, humanPlayerId) &&
    (!pending?.cardInstanceId || pending.cardInstanceId === instanceId);

  if (showPending && pending?.options) {
    let showedHealNote = false;
    for (const opt of pending.options) {
      const disabled = isOptionDisabled(pub, def?.effectId, opt.id);
      addBtn(
        opt.label,
        () => {
          snapshotIfFriendshipGain(pub, humanPlayerId, opt.id);
          send({ type: "RESOLVE_PICK_ONE", optionId: opt.id });
          if (opt.id !== "damage") forceCloseCardModal();
        },
        true,
        disabled
      );
      if (!showedHealNote && isHealOption(opt.id) && disabled && pub.possessedHp >= pub.possessedMaxHp) {
        appendHealFullNote(buttonsEl, pub);
        showedHealNote = true;
      }
    }
  } else if (showPending && pending?.targets && pending.targets.length === 1) {
    const t = pending.targets[0];
    addBtn(`Target demon (${pending.amount ?? 1} dmg)`, () => {
      send({ type: "SELECT_TARGET", targetId: t });
      forceCloseCardModal();
    }, true);
  } else if (
    modalMode === "preview" &&
    instanceId &&
    canPlayOpenCard(priv, instanceId) &&
    isPickOneEffect(def?.effectId)
  ) {
    const options = CARD_PICK_ONE_OPTIONS[def!.effectId!];
    let showedHealNote = false;
    for (const opt of options) {
      const disabled = isOptionDisabled(pub, def?.effectId, opt.id);
      addBtn(
        opt.label,
        () => {
          snapshotIfFriendshipGain(pub, humanPlayerId, opt.id);
          send(playCardAction(instanceId, opt.id));
          if (opt.id === "draw") {
            forceCloseCardModal();
          }
        },
        true,
        disabled
      );
      if (!showedHealNote && isHealOption(opt.id) && disabled && pub.possessedHp >= pub.possessedMaxHp) {
        appendHealFullNote(buttonsEl, pub);
        showedHealNote = true;
      }
    }
  } else if (modalMode === "preview" && instanceId && canPlayOpenCard(priv, instanceId)) {
    const giftsBlocked = def?.effectId === "gifts" && !canHealPossessed(pub);
    addBtn(
      "Play Card",
      () => {
        if (def?.effectId && DIRECT_FRIENDSHIP_EFFECT_IDS.has(def.effectId)) {
          snapshotFriendshipBeforeChoice(pub, humanPlayerId);
        }
        send(playCardAction(instanceId));
      },
      true,
      giftsBlocked
    );
    if (giftsBlocked) appendHealFullNote(buttonsEl, pub);
  } else if (modalMode === "preview" && instanceId && findOpenCard(priv)) {
    const hint = document.createElement("p");
    hint.className = "card-modal-hint";
    if (pub.pendingChoice && humanControlsPending(pub, humanPlayerId) && !canPlayOpenCard(priv, instanceId)) {
      hint.textContent = isBoardMountedEventPending(pub, humanPlayerId)
        ? "Resolve the event choice on the board first."
        : "Resolve your pending choice first.";
    } else {
      hint.textContent = "Cannot play this card right now.";
    }
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
  if (isInputLocked()) return;
  humanPlayerId = ctx.humanPlayerId;
  openOwnerPlayerId = ctx.ownerPlayerId ?? ctx.humanPlayerId;
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
  if (ctx.ownerPlayerId) openOwnerPlayerId = ctx.ownerPlayerId;
  const { pub, priv } = ctx;

  if (!openInstanceId) {
    forceCloseCardModal();
    return;
  }

  const pending = pub.pendingChoice;
  const card = findOpenCard(priv);
  // After play, the card leaves the hand but resolve mode still needs the open card id.
  const cardId = card?.cardId ?? openCardId ?? resolvingCardId;
  if (!cardId) {
    forceCloseCardModal();
    return;
  }

  openCardId = cardId;

  const pendingForOpenCard =
    !!pending &&
    humanControlsPending(pub, humanPlayerId) &&
    pending.cardInstanceId === openInstanceId;

  if (modalMode === "preview" && pendingForOpenCard) {
    modalMode = "resolve";
    resolvingCardId = cardId;
    if (pending?.playerId) openOwnerPlayerId = pending.playerId;
    renderModal(ctx, cardId, openInstanceId);
    return;
  }

  if (modalMode === "resolve" && resolvingCardId) {
    if (!pending) {
      forceCloseCardModal();
      return;
    }
    if (!humanControlsPending(pub, humanPlayerId)) {
      forceCloseCardModal();
      return;
    }
    if (pending.cardInstanceId && pending.cardInstanceId !== openInstanceId) {
      modalMode = "preview";
      resolvingCardId = null;
      if (!card) {
        forceCloseCardModal();
        return;
      }
      renderModal(ctx, card.cardId, card.instanceId);
      return;
    }
    renderModal(ctx, resolvingCardId, openInstanceId);
    return;
  }

  if (!card) {
    forceCloseCardModal();
    return;
  }
  renderModal(ctx, card.cardId, card.instanceId);
}
