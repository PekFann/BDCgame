import type { DiscussionSuggestion, DrawChoice, GameAction, GameState, PlayerState } from "../../shared/types.js";
import { getCard } from "../../shared/cards.js";
import {
  canPlayCard,
  canPlayCardInCurrentPhase,
} from "./effects/primitives.js";
import { meetsFriendshipRequirement, canVoteRest } from "./rules.js";

export function getLegalActions(state: GameState, player: PlayerState): GameAction[] {
  const actions: GameAction[] = [];
  if (state.phase === "game_over" || !state.started) return actions;

  if (state.presentationHold && player.isHuman) {
    actions.push({ type: "ACK_PRESENTATION" });
    return actions;
  }

  if (state.presentationHold) return actions;

  if (
    state.phase === "draw" &&
    player.drawChoice === null &&
    state.introAcknowledged
  ) {
    actions.push({ type: "CHOOSE_DRAW", choice: "card_and_energy" });
    actions.push({ type: "CHOOSE_DRAW", choice: "friendship" });
  }

  if (canVoteRest(state, player)) {
    actions.push({ type: "REST_VOTE", vote: true });
  }

  if (
    state.phase === "triggers" &&
    state.lastDiceRoll === null &&
    !state.presentationHold &&
    (state.mode !== "solo" || player.isHuman)
  ) {
    actions.push({ type: "ROLL_DICE" });
  }

  if (
    (state.phase === "day" || state.phase === "night") &&
    !state.pendingChoice
  ) {
    actions.push({ type: "ADVANCE_PHASE" });
  }

  for (const card of player.hand) {
    const def = getCard(card.cardId);
    if (canPlayCardInCurrentPhase(state, def) && canPlayCard(state, player, card.cardId)) {
      actions.push({ type: "PLAY_CARD", cardInstanceId: card.instanceId });
    }
  }

  if (state.pendingChoice?.playerId === player.id) {
    if (state.pendingChoice.options) {
      for (const opt of state.pendingChoice.options) {
        actions.push({ type: "RESOLVE_PICK_ONE", optionId: opt.id });
      }
    }
    if (state.pendingChoice.targets) {
      for (const t of state.pendingChoice.targets) {
        actions.push({ type: "SELECT_TARGET", targetId: t });
      }
    }
    if (state.pendingChoice.kind === "discard_cards" && player.hand.length) {
      actions.push({
        type: "DISCARD_CARDS",
        cardInstanceIds: [player.hand[0].instanceId],
      });
    }
  }

  return actions;
}

function hasPlayableCard(state: GameState, player: PlayerState): boolean {
  return getLegalActions(state, player).some((a) => a.type === "PLAY_CARD");
}

export function pickAiDrawChoice(player: PlayerState): DrawChoice {
  return player.hand.length < 5 ? "card_and_energy" : "friendship";
}

export function pickSuggestedCard(state: GameState, player: PlayerState): string | null {
  const hand = player.hand.filter((c) => !state.declinedAiPlayIds.has(c.instanceId));
  const score = (cardId: string) => {
    const def = getCard(cardId);
    if (!canPlayCard(state, player, cardId)) return -1;
    if (!canPlayCardInCurrentPhase(state, def)) return -1;
    if (def.effectId === "resurrection" && state.possessedHp <= 0) return 100;
    if (!state.demonRevealed && def.effectId === "talk_it_out" && meetsFriendshipRequirement(state, player)) return 90;
    if (!state.demonRevealed && ["caring", "good_old_days", "tea_for_two"].includes(def.effectId)) return 70;
    if (state.possessedHp < state.possessedMaxHp * 0.4 && ["caring", "healthy_meal"].includes(def.effectId)) return 65;
    if (state.demonRevealed && ["prayer", "sharp_truth", "fast_and_pray"].includes(def.effectId)) return 60;
    if (def.instant && def.effectId === "healthy_meal" && player.energy <= 2) return 50;
    return def.cycleIcon ? 10 : 5;
  };
  hand.sort((a, b) => score(b.cardId) - score(a.cardId));
  const best = hand.find((c) => score(c.cardId) > 0);
  return best?.instanceId ?? null;
}

export function getDiscussionSuggestions(state: GameState): DiscussionSuggestion[] {
  if (state.phase !== "day" && state.phase !== "night") return [];

  const suggestions: DiscussionSuggestion[] = [];
  for (const player of state.players) {
    if (player.usedPhaseAction) continue;
    const instanceId = pickSuggestedCard(state, player);
    if (!instanceId) continue;
    const card = player.hand.find((c) => c.instanceId === instanceId);
    if (!card) continue;
    suggestions.push({
      playerId: player.id,
      playerName: player.name,
      cardInstanceId: instanceId,
      cardId: card.cardId,
    });
  }
  return suggestions;
}

export function pickAiAction(state: GameState, player: PlayerState): GameAction | null {
  if (state.pendingChoice?.playerId === player.id) {
    const pending = state.pendingChoice;
    if (pending.options?.length) {
      return { type: "RESOLVE_PICK_ONE", optionId: pending.options[0].id };
    }
    if (pending.targets?.length) {
      return { type: "SELECT_TARGET", targetId: pending.targets[0] };
    }
    if (pending.kind === "discard_cards" && player.hand.length) {
      return { type: "DISCARD_CARDS", cardInstanceIds: [player.hand[0].instanceId] };
    }
  }

  if (
    state.phase === "draw" &&
    player.drawChoice === null &&
    state.introAcknowledged
  ) {
    return { type: "CHOOSE_DRAW", choice: pickAiDrawChoice(player) };
  }

  if (
    state.phase === "triggers" &&
    state.lastDiceRoll === null &&
    !state.presentationHold &&
    state.mode !== "solo"
  ) {
    return { type: "ROLL_DICE" };
  }

  if (state.mode !== "solo") {
    const cardId = pickSuggestedCard(state, player);
    if (cardId && hasPlayableCard(state, player)) {
      return { type: "PLAY_CARD", cardInstanceId: cardId };
    }
  }

  if (canVoteRest(state, player)) {
    const shouldRest =
      (state.phase === "day" && player.hand.length <= 1) ||
      (state.phase === "night" && player.energy <= 1);
    if (shouldRest) return { type: "REST_VOTE", vote: true };
  }

  return null;
}

export function runAiTurns(state: GameState, apply: (playerId: string, action: GameAction) => void): void {
  let safety = 50;
  while (safety-- > 0) {
    if (
      state.phase === "game_over" ||
      state.presentationHold ||
      (state.pendingChoice?.playerId &&
        state.players.find((p) => p.id === state.pendingChoice!.playerId)?.isHuman)
    ) {
      break;
    }
    let acted = false;
    for (const player of state.players) {
      if (player.isHuman) continue;
      const action = pickAiAction(state, player);
      if (!action) continue;
      apply(player.id, action);
      acted = true;
      if (state.winner !== null) return;
      if (state.pendingChoice?.playerId === player.id) continue;
      break;
    }
    if (!acted) break;
  }
}
