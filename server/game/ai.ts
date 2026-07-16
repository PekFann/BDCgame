import type { DrawChoice, GameAction, GameState, PlayerState } from "../../shared/types.js";
import { getCard } from "../../shared/cards.js";
import {
  canHealPossessed,
  canPlayCard,
  canPlayCardInCurrentPhase,
} from "./effects/primitives.js";
import { canVoteRest } from "./rules.js";
import { pickSuggestedCard } from "./discussion-strategy.js";

export { pickSuggestedCard };

export function pendingControllerId(state: GameState): string | null {
  const pending = state.pendingChoice;
  if (!pending) return null;
  return pending.controllerPlayerId ?? pending.playerId;
}

/** Solo: human may play currently legal AI-owned cards. */
export function canPlayTeamCard(
  state: GameState,
  owner: PlayerState,
  cardInstanceId: string
): boolean {
  if (state.mode !== "solo") return false;
  if (state.phase !== "day" && state.phase !== "night") return false;
  if (state.pendingChoice || state.presentationHold) return false;
  if (owner.isHuman) return false;
  const instance = owner.hand.find((c) => c.instanceId === cardInstanceId);
  if (!instance) return false;
  const def = getCard(instance.cardId);
  if (def.effectId === "rule_book") return false;
  if (!canPlayCardInCurrentPhase(state, def)) return false;
  if (!canPlayCard(state, owner, instance.cardId)) return false;
  const usesPhaseAction = def.cycleIcon && !def.instant;
  if (usesPhaseAction && owner.usedPhaseAction) return false;
  if (def.effectId === "gifts") {
    if (state.modifiers.caringGiftsBlocked) return true;
    if (!canHealPossessed(state)) return false;
    if (owner.hand.length < 2) return false;
  }
  if (def.effectId === "fast_and_pray" && owner.hand.length < 2) return false;
  return true;
}

export function getLegalActions(state: GameState, player: PlayerState): GameAction[] {
  const actions: GameAction[] = [];
  if (state.phase === "game_over" || !state.started) return actions;

  if (state.pendingRerollPrompt && !state.pendingChoice) {
    const awaiting = state.pendingRerollPrompt.awaitingPlayerId;
    const canRespond =
      player.isHuman &&
      awaiting &&
      (awaiting === player.id || !state.players.find((p) => p.id === awaiting)?.isHuman);
    if (canRespond) {
      actions.push({ type: "ACCEPT_REROLL" });
      actions.push({ type: "DECLINE_REROLL" });
    }
    return actions;
  }

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
    !state.pendingRerollPrompt &&
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

  if (
    state.mode === "solo" &&
    player.isHuman &&
    !state.pendingChoice &&
    (state.phase === "day" || state.phase === "night")
  ) {
    for (const owner of state.players) {
      if (owner.isHuman) continue;
      for (const card of owner.hand) {
        if (canPlayTeamCard(state, owner, card.instanceId)) {
          actions.push({
            type: "PLAY_TEAM_CARD",
            ownerPlayerId: owner.id,
            cardInstanceId: card.instanceId,
          });
        }
      }
    }
  }

  const controllerId = pendingControllerId(state);
  if (controllerId === player.id && state.pendingChoice) {
    const pending = state.pendingChoice;
    const owner = state.players.find((p) => p.id === pending.playerId);
    if (pending.options) {
      for (const opt of pending.options) {
        actions.push({ type: "RESOLVE_PICK_ONE", optionId: opt.id });
      }
    }
    if (pending.targets) {
      for (const t of pending.targets) {
        actions.push({ type: "SELECT_TARGET", targetId: t });
      }
    }
    if (pending.kind === "discard_cards" && owner && owner.hand.length) {
      actions.push({
        type: "DISCARD_CARDS",
        cardInstanceIds: [owner.hand[0].instanceId],
      });
    }
    if (pending.kind === "distribute_energy") {
      actions.push({
        type: "DISTRIBUTE_ENERGY",
        distribution: buildEnergyDistribution(state, pending.amount ?? 5, pending.playerId),
      });
    }
    if (state.pendingRerollPrompt) return actions;
  }

  return actions;
}

/** Give all energy to the lowest-energy player; acting player wins ties. */
function buildEnergyDistribution(
  state: GameState,
  amount: number,
  preferPlayerId: string
): Record<string, number> {
  let best = state.players.find((p) => p.id === preferPlayerId) ?? state.players[0];
  for (const p of state.players) {
    if (p.energy < best.energy) best = p;
  }
  return { [best.id]: amount };
}

function hasPlayableCard(state: GameState, player: PlayerState): boolean {
  return getLegalActions(state, player).some((a) => a.type === "PLAY_CARD");
}

export function pickAiDrawChoice(player: PlayerState): DrawChoice {
  return player.hand.length < 5 ? "card_and_energy" : "friendship";
}

export function pickAiAction(state: GameState, player: PlayerState): GameAction | null {
  const prompt = state.pendingRerollPrompt;
  if (prompt?.awaitingPlayerId === player.id && !player.isHuman) {
    return { type: "DECLINE_REROLL" };
  }

  const controllerId = pendingControllerId(state);
  if (controllerId && controllerId !== player.id) {
    // Human (or another player) controls this pending — AI must not resolve it.
  } else if (state.pendingChoice?.playerId === player.id) {
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
    if (pending.kind === "distribute_energy") {
      return {
        type: "DISTRIBUTE_ENERGY",
        distribution: buildEnergyDistribution(state, pending.amount ?? 5, player.id),
      };
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
    if (state.phase === "game_over" || state.presentationHold) break;

    if (state.pendingRerollPrompt && !state.pendingChoice) {
      const awaitingId = state.pendingRerollPrompt.awaitingPlayerId;
      const awaiting = awaitingId ? state.players.find((p) => p.id === awaitingId) : undefined;
      if (awaiting && !awaiting.isHuman) {
        const human = state.players.find((p) => p.isHuman);
        if (human) {
          apply(human.id, { type: "DECLINE_REROLL" });
          if (state.winner !== null) return;
          continue;
        }
      }
      break;
    }

    const controllerId = pendingControllerId(state);
    if (controllerId && state.players.find((p) => p.id === controllerId)?.isHuman) {
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
