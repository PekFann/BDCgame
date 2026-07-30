import { DNC, getCard } from "../../shared/cards.js";
import type {
  GameState,
  PendingCardRollResume,
  PendingRerollPrompt,
  TriggerOutcome,
} from "../../shared/types.js";
import { resumeCardRollEffect } from "./card-roll-resume.js";
import { discardFromHand, peekEventCardId, removeFromHandToDiscard } from "./effects/primitives.js";
import { isEventRollEffect } from "./effects/triggers.js";
import { getPlayer } from "./rules.js";
import { log, rollD6 } from "./util.js";

function isTimeTravelCard(cardId: string): boolean {
  return getCard(cardId).effectId === "time_travel";
}

function nonTimeTravelCards(hand: { instanceId: string; cardId: string }[]) {
  return hand.filter((c) => !isTimeTravelCard(c.cardId));
}

function findTimeTravelInstance(player: { hand: { instanceId: string; cardId: string }[] }) {
  return player.hand.find((c) => getCard(c.cardId).effectId === "time_travel");
}

export function getTimeTravelEligiblePlayers(state: GameState) {
  return state.players.filter((p) => findTimeTravelInstance(p));
}

function buildRerollQueue(
  state: GameState,
  rollerId: string,
  context: PendingRerollPrompt["context"]
) {
  const eligible = getTimeTravelEligiblePlayers(state);
  // Card rolls: only the roller may use Time Travel (avoids solo AI chain prompts).
  if (context === "card") {
    const roller = eligible.find((p) => p.id === rollerId);
    return roller
      ? [{ playerId: roller.id, isHuman: roller.isHuman, name: roller.name }]
      : [];
  }
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
    const hasHuman = state.players.some((p) => p.isHuman);
    if (hasHuman && isEventRollEffect(resume.effectId) && state.lastDiceRoll !== null) {
      state.presentationHold = {
        at: "post_event_roll",
        roll: state.lastDiceRoll,
        effectId: resume.effectId,
        playerId: resume.playerId,
      };
      return;
    }
    if (hasHuman && state.lastDiceRoll !== null) {
      state.presentationHold = {
        at: "post_card_roll",
        roll: state.lastDiceRoll,
        effectId: resume.effectId,
        playerId: resume.playerId,
        cardInstanceId: resume.cardInstanceId,
        targetId: resume.targetId,
      };
      return;
    }
    resumeCardRollEffect(state, resume);
    return;
  }
  if (state.phase === "triggers") {
    finalizeTriggerRollPresentation(state);
  }
}

function startRerollOffers(state: GameState, rollerId: string, context: PendingRerollPrompt["context"]): void {
  const queue = buildRerollQueue(state, rollerId, context);
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
  return nonTimeTravelCards(player.hand)[0]?.instanceId ?? null;
}

export function executeReroll(
  state: GameState,
  playerId: string,
  context: PendingRerollPrompt["context"] = "trigger"
): void {
  const roll = rollD6();
  state.lastDiceRoll = roll;
  state.diceRollerId = playerId;
  log(state, `${getPlayer(state, playerId).name} rerolls: ${roll}.`);
  state.pendingRerollPrompt = null;
  state.pendingRerollTimeTravelId = null;
  startRerollOffers(state, playerId, context);
}

export function completeRerollAfterDiscard(
  state: GameState,
  playerId: string,
  discardIds: string[]
): void {
  const context = state.pendingRerollPrompt?.context ?? "trigger";
  const player = getPlayer(state, playerId);
  for (const id of discardIds) {
    const card = player.hand.find((c) => c.instanceId === id);
    if (card && isTimeTravelCard(card.cardId)) {
      throw new Error("Cannot discard Time Travel for the reroll cost");
    }
  }
  discardFromHand(state, player, discardIds);
  executeReroll(state, playerId, context);
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
  const context = prompt.context;
  const eligible = nonTimeTravelCards(playerAfter.hand);

  if (eligible.length === 0) {
    executeReroll(state, targetId, context);
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
    executeReroll(state, targetId, context);
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
