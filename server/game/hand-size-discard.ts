import type { GameState } from "../../shared/types.js";
import { getPlayer } from "./rules.js";

/** Poop Patrol event card id — used so the discard modal shows the event name. */
export const POOP_PATROL_CARD_ID = "event_06";
export const RULE_BOOK_CARD_ID = "action_16";

export function isPoopPatrolDiscard(pending: GameState["pendingChoice"]): boolean {
  return pending?.kind === "discard_cards" && pending.cardId === POOP_PATROL_CARD_ID;
}

export function isRuleBookOverflowDiscard(pending: GameState["pendingChoice"]): boolean {
  return pending?.kind === "discard_cards" && pending.cardId === RULE_BOOK_CARD_ID;
}

export function isHandSizeDiscardPending(pending: GameState["pendingChoice"]): boolean {
  return isPoopPatrolDiscard(pending) || isRuleBookOverflowDiscard(pending);
}

function setHandSizeDiscardPending(state: GameState, playerId: string, cardId: string): void {
  state.pendingChoice = {
    kind: "discard_cards",
    playerId,
    minDiscard: 1,
    maxDiscard: 1,
    cardId,
  };
}

function firstOversizePlayerId(state: GameState, fromIndex = 0): string | null {
  const max = state.modifiers.maxHandSize;
  for (let i = fromIndex; i < state.players.length; i++) {
    if (state.players[i].hand.length > max) return state.players[i].id;
  }
  return null;
}

/** After Poop Patrol resolves: prompt the first player over max hand size, if any. */
export function startHandSizeDiscardIfNeeded(state: GameState): void {
  const nextId = firstOversizePlayerId(state, 0);
  if (!nextId) return;
  setHandSizeDiscardPending(state, nextId, POOP_PATROL_CARD_ID);
}

/**
 * After a Poop Patrol discard: re-prompt the same player if still oversize,
 * otherwise the next player in slot order who is oversize.
 */
export function continueHandSizeDiscard(state: GameState, afterPlayerId: string): void {
  continueHandSizeDiscardWithCard(state, afterPlayerId, POOP_PATROL_CARD_ID);
}

/** Prompt a single oversize player (e.g. Rule Book transfer recipient) to discard down to max. */
export function startOverflowDiscardForPlayer(
  state: GameState,
  playerId: string,
  cardId: string
): void {
  const player = getPlayer(state, playerId);
  if (player.hand.length <= state.modifiers.maxHandSize) return;
  setHandSizeDiscardPending(state, playerId, cardId);
}

export function continueHandSizeDiscardWithCard(
  state: GameState,
  afterPlayerId: string,
  cardId: string
): void {
  const max = state.modifiers.maxHandSize;
  const current = getPlayer(state, afterPlayerId);
  if (current.hand.length > max) {
    setHandSizeDiscardPending(state, afterPlayerId, cardId);
    return;
  }
  const idx = state.players.findIndex((p) => p.id === afterPlayerId);
  const nextId = firstOversizePlayerId(state, idx < 0 ? 0 : idx + 1);
  if (nextId) {
    setHandSizeDiscardPending(state, nextId, cardId);
  }
}
