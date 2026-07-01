import { DNC, getCard } from "../../shared/cards.js";
import type { GameState, PendingRerollPrompt, PendingCardRollResume, TriggerOutcome } from "../../shared/types.js";
import { resumeCardRollEffect } from "./card-roll-resume.js";
import { discardFromHand, peekEventCardId, removeFromHandToDiscard } from "./effects/primitives.js";
import { getPlayer } from "./rules.js";
import { log, rollD6 } from "./util.js";

function findTimeTravelInstance(player: { hand: { instanceId: string; cardId: string }[] }) {
  return player.hand.find((c) => getCard(c.cardId).effectId === "time_travel");
}

export function getTimeTravelEligiblePlayers(state: GameState) {
  return state.players.filter((p) => findTimeTravelInstance(p));
}

function buildRerollQueue(state: GameState, rollerId: string) {
  const eligible = getTimeTravelEligiblePlayers(state);
  const roller = eligible.find((p) => p.id === rollerId);
  const others = eligible.filter((p) => p.id !== rollerId);
  const ordered = roller ? [roller, ...others] : others;
  return ordered.map((p) => ({ playerId: p.id, isHuman: p.isHuman, name: p.name }));
}

function currentAwaiting(prompt: PendingRerollPrompt): string | null {
  if (prompt.queueIndex >= prompt.queue.length) return null;
  return prompt.queue[prompt.queueIndex]?.playerId ?? null;
}

export function finalizeTriggerRollPresentation(state: GameState): void {
  const roll = state.lastDiceRoll;
  if (roll === null) return;
  const dnc = state.currentDncId ? DNC[state.currentDncId] : null;
  let outcome: TriggerOutcome = "neutral";
  let eventCardId: string | undefined;
  if (dnc?.triggerDice.includes(roll)) {
    outcome = "trigger";
  } else if (dnc?.eventDice.includes(roll)) {
    eventCardId = peekEventCardId(state) ?? undefined;
    outcome = "event";
  }
  state.presentationHold = { at: "post_trigger_roll", roll, outcome, eventCardId };
}

function finalizeDiceRoll(state: GameState): void {
  state.pendingRerollPrompt = null;
  state.pendingRerollTimeTravelId = null;
  if (state.pendingCardRollResume) {
    const resume = state.pendingCardRollResume;
    state.pendingCardRollResume = null;
    resumeCardRollEffect(state, resume);
    return;
  }
  if (state.phase === "triggers") {
    finalizeTriggerRollPresentation(state);
  }
}

function startRerollOffers(state: GameState, rollerId: string, context: PendingRerollPrompt["context"]): void {
  const queue = buildRerollQueue(state, rollerId);
  if (queue.length === 0) {
    finalizeDiceRoll(state);
    return;
  }
  state.pendingRerollPrompt = {
    roll: state.lastDiceRoll!,
    rollerId,
    context,
    queue,
    queueIndex: 0,
    awaitingPlayerId: queue[0]?.playerId ?? null,
  };
}

export function beginDiceRoll(
  state: GameState,
  rollerId: string,
  context: PendingRerollPrompt["context"],
  resume?: PendingCardRollResume
): number {
  const roll = rollD6();
  state.lastDiceRoll = roll;
  state.diceRollerId = rollerId;
  state.pendingCardRollResume = resume ?? null;
  log(state, `${getPlayer(state, rollerId).name} rolls ${roll}.`);
  startRerollOffers(state, rollerId, context);
  return roll;
}

function pickAiDiscardId(player: { hand: { instanceId: string; cardId: string }[] }): string | null {
  return player.hand[0]?.instanceId ?? null;
}

export function executeReroll(state: GameState, playerId: string): void {
  const roll = rollD6();
  state.lastDiceRoll = roll;
  state.diceRollerId = playerId;
  log(state, `${getPlayer(state, playerId).name} rerolls: ${roll}.`);
  state.pendingRerollPrompt = null;
  state.pendingRerollTimeTravelId = null;
  finalizeDiceRoll(state);
}

export function completeRerollAfterDiscard(
  state: GameState,
  playerId: string,
  discardIds: string[]
): void {
  discardFromHand(state, getPlayer(state, playerId), discardIds);
  executeReroll(state, playerId);
}

function consumeTimeTravel(state: GameState, playerId: string): void {
  const player = getPlayer(state, playerId);
  const tt = findTimeTravelInstance(player);
  if (!tt) return;
  removeFromHandToDiscard(state, player, tt.instanceId);
  log(state, `${player.name} uses Time Travel.`);
}

export function acceptReroll(state: GameState, actingHumanId: string): void {
  const prompt = state.pendingRerollPrompt;
  if (!prompt?.awaitingPlayerId) throw new Error("No reroll offer active");
  const targetId = prompt.awaitingPlayerId;
  const target = getPlayer(state, targetId);
  const human = getPlayer(state, actingHumanId);
  if (!human.isHuman) throw new Error("Only human can respond to reroll offers");

  if (target.isHuman && targetId !== actingHumanId) {
    throw new Error("Not your reroll offer");
  }

  if (!findTimeTravelInstance(target)) {
    declineReroll(state, actingHumanId);
    return;
  }

  consumeTimeTravel(state, targetId);
  const playerAfter = getPlayer(state, targetId);

  if (playerAfter.hand.length === 0) {
    executeReroll(state, targetId);
    return;
  }

  if (playerAfter.isHuman) {
    state.pendingChoice = {
      kind: "discard_cards",
      playerId: targetId,
      minDiscard: 1,
      maxDiscard: 1,
      cardId: "action_11",
    };
    return;
  }

  const discardId = pickAiDiscardId(playerAfter);
  if (discardId) {
    completeRerollAfterDiscard(state, targetId, [discardId]);
  } else {
    executeReroll(state, targetId);
  }
}

export function declineReroll(state: GameState, actingHumanId: string): void {
  const prompt = state.pendingRerollPrompt;
  if (!prompt) throw new Error("No reroll offer active");
  const human = getPlayer(state, actingHumanId);
  if (!human.isHuman) throw new Error("Only human can respond");

  const awaiting = prompt.awaitingPlayerId;
  if (!awaiting) throw new Error("No reroll awaiting");

  const target = getPlayer(state, awaiting);
  if (target.isHuman && awaiting !== actingHumanId) {
    throw new Error("Not your reroll offer");
  }

  prompt.queueIndex += 1;
  prompt.awaitingPlayerId = currentAwaiting(prompt);
  if (!prompt.awaitingPlayerId) {
    finalizeDiceRoll(state);
  }
}

export function hasPendingReroll(state: GameState): boolean {
  return state.pendingRerollPrompt !== null;
}
