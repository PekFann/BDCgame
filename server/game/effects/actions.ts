import type { GameState, PendingChoice } from "../../../shared/types.js";
import { getCard } from "../../../shared/cards.js";
import { getPlayer, clearRestVotesIfPoolSpent, legalDamageTargets } from "../rules.js";
import { log } from "../util.js";
import {
  dealDamageToDemon,
  discardFromHand,
  drawForPlayer,
  gainEnergy,
  gainFriendship,
  healPossessed,
  canHealPossessed,
  payCardCosts,
  canPlayCardInCurrentPhase,
  removeFromHandToDiscard,
  revealDemon,
} from "./primitives.js";
import { beginDiceRoll, executeReroll } from "../dice-reroll.js";

export interface PlayContext {
  state: GameState;
  playerId: string;
  cardInstanceId: string;
  targetId?: string;
}

function pendingFromCard(
  partial: Omit<PendingChoice, "cardInstanceId" | "cardId">,
  cardInstanceId: string,
  cardId: string
): PendingChoice {
  return { ...partial, cardInstanceId, cardId };
}

export function startPlayCard(ctx: PlayContext): PendingChoice | null {
  const { state, playerId, cardInstanceId } = ctx;
  const player = getPlayer(state, playerId);
  const instance = player.hand.find((c) => c.instanceId === cardInstanceId);
  if (!instance) throw new Error("Card not in hand");
  const def = getCard(instance.cardId);

  if (!canPlayCardInCurrentPhase(state, def)) {
    throw new Error("Cannot play this card in the current phase");
  }

  if (def.effectId === "gifts" && !state.modifiers.caringGiftsBlocked && !canHealPossessed(state)) {
    throw new Error("Possessed health is full");
  }

  if (!payCardCosts(state, player, instance.cardId)) {
    throw new Error("Cannot pay card costs");
  }

  const usesPhaseAction = def.cycleIcon && !def.instant;
  if (usesPhaseAction) {
    if (state.phase === "day") {
      if (state.dayActionsRemaining <= 0) throw new Error("No day actions left");
      state.dayActionsRemaining--;
    } else if (state.phase === "night") {
      if (state.nightActionsRemaining <= 0) throw new Error("No night actions left");
      state.nightActionsRemaining--;
    } else if (!def.instant) {
      throw new Error("Cannot play phase action now");
    }
    player.usedPhaseAction = true;
    player.restVote = null;
    clearRestVotesIfPoolSpent(state);
  }

  if (def.persistent) {
    player.hand = player.hand.filter((c) => c.instanceId !== cardInstanceId);
    player.persistentCards.push(instance);
    log(state, `${player.name} plays ${def.name} (persistent).`);
  } else {
    removeFromHandToDiscard(state, player, cardInstanceId);
    log(state, `${player.name} plays ${def.name}.`);
  }

  if (def.effectId === "prayer") {
    state.prayerUsedThisPhase.add(playerId);
    return pendingFromCard(
      {
        kind: "pick_one",
        playerId,
        options: [
          { id: "draw", label: "Draw 2 cards" },
          { id: "damage", label: "Deal 1 damage to a demon (+1 if another Prayer)" },
        ],
      },
      cardInstanceId,
      instance.cardId
    );
  }
  if (def.effectId === "caring") {
    if (state.modifiers.caringGiftsBlocked) {
      log(state, "Caring has no effect.");
      return null;
    }
    return pendingFromCard(
      {
        kind: "pick_one",
        playerId,
        options: [
          { id: "friendship", label: "Gain 1 friendship" },
          { id: "heal", label: "Possessed gains 1 HP" },
        ],
      },
      cardInstanceId,
      instance.cardId
    );
  }
  if (def.effectId === "tea_for_two") {
    return pendingFromCard(
      {
        kind: "pick_one",
        playerId,
        options: [
          { id: "friendship2", label: "Gain 2 friendship" },
          { id: "heal2", label: "Possessed gains 2 HP" },
        ],
      },
      cardInstanceId,
      instance.cardId
    );
  }
  if (def.effectId === "gifts") {
    if (state.modifiers.caringGiftsBlocked) {
      log(state, "Gifts has no effect.");
      return null;
    }
    if (player.hand.length === 0) throw new Error("Need a card to discard");
    return pendingFromCard(
      { kind: "discard_cards", playerId, minDiscard: 1, maxDiscard: 1 },
      cardInstanceId,
      instance.cardId
    );
  }
  if (def.effectId === "good_old_days") {
    gainFriendship(player, 3);
    return null;
  }
  if (def.effectId === "lighthouse") return null;
  if (def.effectId === "dealing_with_past") {
    return pendingFromCard(
      { kind: "discard_cards", playerId, minDiscard: 0, maxDiscard: player.hand.length },
      cardInstanceId,
      instance.cardId
    );
  }
  if (def.effectId === "coffee_break") {
    return pendingFromCard(
      { kind: "distribute_energy", playerId, amount: 5 },
      cardInstanceId,
      instance.cardId
    );
  }
  if (def.effectId === "call_for_help") {
    if (state.actionDiscard.length === 0) return null;
    return pendingFromCard(
      {
        kind: "pick_action_discard",
        playerId,
        options: state.actionDiscard.map((c) => ({
          id: c.instanceId,
          label: getCard(c.cardId).name,
        })),
      },
      cardInstanceId,
      instance.cardId
    );
  }
  if (def.effectId === "healthy_meal") {
    gainEnergy(player, 3, state);
    return null;
  }
  if (def.effectId === "time_travel") {
    if (state.lastDiceRoll === null) throw new Error("No dice roll to reroll");
    if (player.hand.length > 0) {
      return pendingFromCard(
        { kind: "discard_cards", playerId, minDiscard: 1, maxDiscard: 1 },
        cardInstanceId,
        instance.cardId
      );
    }
    return null;
  }
  if (def.effectId === "talk_it_out") {
    beginDiceRoll(state, playerId, "card", { effectId: "talk_it_out", playerId });
    return null;
  }
  if (def.effectId === "sharp_truth") {
    spendFriendshipForSharpTruth(player);
    return selectDemonTarget(state, playerId, 3, instance.cardId, cardInstanceId);
  }
  if (def.effectId === "wild_card") {
    beginDiceRoll(state, playerId, "card", { effectId: "wild_card", playerId });
    return null;
  }
  if (def.effectId === "fast_and_pray") {
    if (player.hand.length === 0) throw new Error("Need a card to discard");
    return pendingFromCard(
      { kind: "discard_cards", playerId, minDiscard: 1, maxDiscard: 1, targets: demonTargets(state) },
      cardInstanceId,
      instance.cardId
    );
  }
  if (def.effectId === "rule_book") {
    return pendingFromCard(
      {
        kind: "rule_book",
        playerId,
        targets: state.players.filter((p) => p.id !== playerId).map((p) => p.id),
      },
      cardInstanceId,
      instance.cardId
    );
  }
  if (def.effectId === "instant_access") {
    beginDiceRoll(state, playerId, "card", { effectId: "instant_access", playerId });
    return null;
  }
  if (def.effectId === "resurrection") {
    return null;
  }
  if (def.effectId === "trumpet_of_victory") return null;
  if (def.effectId === "chain_broken") {
    beginDiceRoll(state, playerId, "card", {
      effectId: "chain_broken",
      playerId,
      cardInstanceId: instance.instanceId,
      targetId: ctx.targetId,
    });
    return null;
  }
  if (def.effectId === "contract_breaker") {
    const targets = legalDamageTargets(state);
    if (state.demon && targets.includes(state.demon.instanceId)) {
      dealDamageToDemon(state, state.demon.instanceId, state.possessedHp, playerId);
    } else {
      log(state, "Cannot damage demon while contract is hidden.");
    }
    return null;
  }

  return null;
}

function spendFriendshipForSharpTruth(player: { friendship: number }) {
  player.friendship = Math.max(0, player.friendship - 2);
}

export function resolvePickActionDiscard(state: GameState, playerId: string, instanceId: string): void {
  const player = getPlayer(state, playerId);
  const idx = state.actionDiscard.findIndex((c) => c.instanceId === instanceId);
  if (idx < 0) throw new Error("Card not in action discard");
  const [card] = state.actionDiscard.splice(idx, 1);
  player.hand.push(card);
  log(state, `${player.name} takes ${getCard(card.cardId).name} from the discard pile.`);
}

function demonTargets(state: GameState): string[] {
  return legalDamageTargets(state);
}

function selectDemonTarget(
  state: GameState,
  playerId: string,
  damage = 3,
  cardId?: string,
  cardInstanceId?: string
): PendingChoice {
  return {
    kind: "select_target",
    playerId,
    amount: damage,
    targets: demonTargets(state),
    cardId,
    cardInstanceId,
  };
}

export function resolvePickOne(state: GameState, playerId: string, optionId: string, lastEffect?: string): void {
  const player = getPlayer(state, playerId);
  const sourceCardId = state.pendingChoice?.cardId;
  const sourceInstanceId = state.pendingChoice?.cardInstanceId;
  if (optionId === "draw") {
    drawForPlayer(state, player, 2);
    log(state, `${player.name} draws 2 cards.`);
    if (!state.presentationHold) {
      state.presentationHold = {
        at: "post_draw",
        choice: "card_and_energy",
        playerId,
      };
    }
  }
  if (optionId === "damage") {
    if (state.modifiers.prayerBlocked) {
      log(state, "Prayer has no effect on demons.");
      return;
    }
    let dmg = 1;
    if (state.prayerUsedThisPhase.size > 1) dmg += 1;
    const targets = demonTargets(state);
    if (targets.length === 0) {
      log(state, "Cannot damage demon while contract is hidden.");
      return;
    }
    if (targets.length === 1) dealDamageToDemon(state, targets[0], dmg, playerId);
    else
      state.pendingChoice = {
        kind: "select_target",
        playerId,
        amount: dmg,
        targets,
        cardId: sourceCardId,
        cardInstanceId: sourceInstanceId,
      };
  }
  if (optionId === "friendship") gainFriendship(player, 1);
  if (optionId === "heal") {
    if (!canHealPossessed(state)) throw new Error("Possessed health is full");
    healPossessed(state, 1, playerId, true);
  }
  if (optionId === "friendship2") gainFriendship(player, 2);
  if (optionId === "heal2") {
    if (!canHealPossessed(state)) throw new Error("Possessed health is full");
    healPossessed(state, 2, playerId, true);
  }
}

export function resolveDiscardEffect(state: GameState, playerId: string, ids: string[], effectId?: string): void {
  const player = getPlayer(state, playerId);
  const sourceCardId = state.pendingChoice?.cardId;
  const sourceInstanceId = state.pendingChoice?.cardInstanceId;
  discardFromHand(state, player, ids);
  if (effectId === "gifts" || state.log[state.log.length - 2]?.includes("Gifts")) {
    healPossessed(state, 3, playerId, true);
  }
  if (effectId === "dealing_with_past" || ids.length >= 0) {
    const lastIdx = [...state.log].reverse().findIndex((l: string) => l.includes("Dealing with the Past"));
    if (lastIdx >= 0) {
      const dmg = 2 + ids.length;
      const targets = demonTargets(state);
      if (targets.length === 1) dealDamageToDemon(state, targets[0], dmg, playerId);
      else
        state.pendingChoice = {
          kind: "select_target",
          playerId,
          amount: dmg,
          targets,
          cardId: sourceCardId,
          cardInstanceId: sourceInstanceId,
        };
    }
  }
  if (effectId === "fast_and_pray") {
    const targets = demonTargets(state);
    if (targets.length === 1) dealDamageToDemon(state, targets[0], 5, playerId);
    else
      state.pendingChoice = {
        kind: "select_target",
        playerId,
        amount: 5,
        targets,
        cardId: sourceCardId,
        cardInstanceId: sourceInstanceId,
      };
  }
  if (effectId === "time_travel") {
    if (state.lastDiceRoll === null) throw new Error("No dice roll to reroll");
    executeReroll(state, playerId);
  }
}

export function resolveTarget(state: GameState, playerId: string, targetId: string, amount = 1): void {
  if (!legalDamageTargets(state).includes(targetId)) {
    log(state, "That demon cannot be targeted.");
    return;
  }
  dealDamageToDemon(state, targetId, amount ?? 1, playerId);
}

export function resolveEnergyDistribution(state: GameState, distribution: Record<string, number>): void {
  const pending = state.pendingChoice;
  if (!pending || pending.kind !== "distribute_energy") {
    throw new Error("No energy distribution pending");
  }
  const expected = pending.amount ?? 5;
  const playerIds = new Set(state.players.map((p) => p.id));
  let total = 0;
  for (const [pid, amt] of Object.entries(distribution)) {
    if (!playerIds.has(pid)) {
      throw new Error("Invalid player in energy distribution");
    }
    if (!Number.isInteger(amt) || amt < 0) {
      throw new Error("Invalid energy amount");
    }
    total += amt;
  }
  if (total !== expected) {
    throw new Error(`Must distribute exactly ${expected} energy`);
  }
  for (const [pid, amt] of Object.entries(distribution)) {
    if (amt > 0) gainEnergy(getPlayer(state, pid), amt, state);
  }
}
