import type { DiscussionSuggestion, GameState, PlayerState } from "../../shared/types.js";
import { getCard } from "../../shared/cards.js";
import { canPlayCard, canPlayCardInCurrentPhase } from "./effects/primitives.js";
import { getPossessedRequirement, meetsFriendshipRequirement } from "./rules.js";

export type DiscussionCategory = DiscussionSuggestion["category"];

export interface CardSuggestionScore {
  score: number;
  rationale: string;
  category: DiscussionCategory;
}

function hpRatio(state: GameState): number {
  if (state.possessedMaxHp <= 0) return 1;
  return state.possessedHp / state.possessedMaxHp;
}

function impsAlive(state: GameState): boolean {
  return state.imps.some((i) => i.hp > 0);
}

function teamFriendshipLow(state: GameState): boolean {
  const req = getPossessedRequirement(state);
  if (req <= 0) return false;
  return state.players.every((p) => p.friendship < req);
}

function healBlocked(state: GameState): boolean {
  return state.modifiers.healingBlocked || (state.phase === "night" && state.modifiers.noHealAtNight);
}

function scoreCardSuggestion(
  state: GameState,
  player: PlayerState,
  cardId: string
): CardSuggestionScore | null {
  const def = getCard(cardId);
  if (!canPlayCard(state, player, cardId)) return null;
  if (!canPlayCardInCurrentPhase(state, def)) return null;

  const effectId = def.effectId;
  const ratio = hpRatio(state);
  const isDay = state.phase === "day";
  const isNight = state.phase === "night";
  const actionsLeft = isDay ? state.dayActionsRemaining : isNight ? state.nightActionsRemaining : 0;

  if (effectId === "resurrection" && state.possessedHp <= 0) {
    return { score: 100, rationale: "Possessed is down — revive now", category: "heal" };
  }

  if (effectId === "caring" && state.modifiers.caringGiftsBlocked) return null;
  if (effectId === "gifts") {
    if (state.modifiers.caringGiftsBlocked) return null;
    if (player.hand.length === 0) return null;
  }
  if (effectId === "prayer" && state.modifiers.prayerBlocked) return null;

  if (effectId === "talk_it_out" && !state.demonRevealed && meetsFriendshipRequirement(state, player)) {
    return { score: 92, rationale: "Roll to reveal the demon", category: "reveal" };
  }

  if (!state.demonRevealed) {
    if (["good_old_days", "tea_for_two", "caring"].includes(effectId)) {
      if (teamFriendshipLow(state)) {
        return {
          score: 88,
          rationale: "Build friendship for possessed requirement",
          category: "friendship",
        };
      }
      if (ratio < 0.5 && !healBlocked(state) && ["caring", "tea_for_two"].includes(effectId)) {
        return { score: 82, rationale: "Heal possessed while demon is hidden", category: "heal" };
      }
      if (effectId === "good_old_days") {
        return { score: 75, rationale: "Gain friendship before revealing demon", category: "friendship" };
      }
    }
  }

  if (ratio < 0.4 && !healBlocked(state)) {
    if (["caring", "gifts", "tea_for_two"].includes(effectId)) {
      return { score: 85, rationale: "Possessed HP is critical — heal", category: "heal" };
    }
    if (effectId === "healthy_meal") {
      return { score: 70, rationale: "Refuel to play more heal cards", category: "energy" };
    }
  }

  if (state.demonRevealed) {
    if (["prayer", "sharp_truth", "fast_and_pray", "dealing_with_past", "chain_broken"].includes(effectId)) {
      const demonUp = state.demon !== null && state.demon.hp > 0;
      const targets = demonUp || impsAlive(state);
      if (targets) {
        if (effectId === "prayer" && impsAlive(state)) {
          return { score: 80, rationale: "Damage imps or demon with Prayer", category: "damage" };
        }
        if (effectId === "fast_and_pray") {
          return { score: 78, rationale: "Heavy hit on a demon", category: "damage" };
        }
        if (effectId === "sharp_truth") {
          return { score: 76, rationale: "Spend friendship for 3 damage", category: "damage" };
        }
        if (effectId === "dealing_with_past") {
          return { score: 74, rationale: "Discard and deal 2+ damage", category: "damage" };
        }
        if (effectId === "chain_broken") {
          return { score: 72, rationale: "Roll for demon damage", category: "damage" };
        }
      }
    }
    if (effectId === "contract_breaker" && state.possessedHp > 0) {
      return {
        score: 68,
        rationale: "Big damage based on possessed HP",
        category: "damage",
      };
    }
  }

  if (player.energy <= 2 && effectId === "healthy_meal") {
    return { score: 65, rationale: "Low energy — gain 3 energy", category: "energy" };
  }

  if (effectId === "coffee_break" && state.players.some((p) => p.energy <= 2)) {
    return { score: 62, rationale: "Share energy across the team", category: "energy" };
  }

  if (effectId === "call_for_help" && state.actionDiscard.length > 0) {
    return { score: 55, rationale: "Recover a card from discard", category: "utility" };
  }

  if (effectId === "lighthouse" || effectId === "trumpet_of_victory") {
    return { score: 45, rationale: "Persistent help for future cycles", category: "utility" };
  }

  if (def.instant && !def.cycleIcon) {
    return { score: 25, rationale: "Instant utility play", category: "utility" };
  }

  if (def.cycleIcon && actionsLeft > 0) {
    return { score: 30, rationale: "Use a day/night action", category: "utility" };
  }

  return null;
}

export function pickSuggestedCard(state: GameState, player: PlayerState): string | null {
  const hand = player.hand.filter((c) => !state.declinedAiPlayIds.has(c.instanceId));
  let bestId: string | null = null;
  let bestScore = -1;

  for (const card of hand) {
    const result = scoreCardSuggestion(state, player, card.cardId);
    if (!result || result.score <= bestScore) continue;
    bestScore = result.score;
    bestId = card.instanceId;
  }

  return bestId;
}

export function getDiscussionSuggestions(state: GameState): DiscussionSuggestion[] {
  if (state.phase !== "day" && state.phase !== "night") return [];

  const suggestions: DiscussionSuggestion[] = [];

  for (const player of state.players) {
    if (player.isHuman) continue;
    if (player.usedPhaseAction) continue;

    const hand = player.hand.filter((c) => !state.declinedAiPlayIds.has(c.instanceId));
    let best: DiscussionSuggestion | null = null;

    for (const card of hand) {
      const scored = scoreCardSuggestion(state, player, card.cardId);
      if (!scored) continue;
      const def = getCard(card.cardId);
      const entry: DiscussionSuggestion = {
        playerId: player.id,
        playerName: player.name,
        cardInstanceId: card.instanceId,
        cardId: card.cardId,
        score: scored.score,
        rationale: scored.rationale,
        category: scored.category,
        energyCost: def.energyCost ?? 0,
        friendshipCost: def.friendshipCost ?? 0,
      };
      if (!best || entry.score > best.score) best = entry;
    }

    if (best) suggestions.push(best);
  }

  suggestions.sort((a, b) => b.score - a.score);
  return suggestions;
}
