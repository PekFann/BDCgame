import { getCard } from "../../shared/cards.js";
import type { GameState } from "../../shared/types.js";
import { computeManifestPreview } from "./effects/primitives.js";
import { getPlayer } from "./rules.js";
import { log } from "./util.js";

function currentAwaiting(state: GameState): string | null {
  const prompt = state.pendingLighthousePrompt;
  if (!prompt) return null;
  if (prompt.queueIndex >= prompt.queue.length) return null;
  return prompt.queue[prompt.queueIndex]?.playerId ?? null;
}

function refreshManifestPreview(state: GameState): void {
  if (state.presentationHold?.at === "manifest") {
    state.presentationHold = { at: "manifest", preview: computeManifestPreview(state) };
  }
}

function advanceLighthouseQueue(state: GameState): void {
  const prompt = state.pendingLighthousePrompt;
  if (!prompt) return;
  prompt.queueIndex += 1;
  prompt.awaitingPlayerId = currentAwaiting(state);
  if (!prompt.awaitingPlayerId) {
    state.pendingLighthousePrompt = null;
  }
  refreshManifestPreview(state);
}

export function hasPendingLighthouse(state: GameState): boolean {
  return state.pendingLighthousePrompt !== null;
}

export function startLighthouseOffers(state: GameState): void {
  const queue = state.players
    .filter(
      (p) =>
        p.persistentCards.some((c) => getCard(c.cardId).effectId === "lighthouse") &&
        p.hand.length > 0
    )
    .map((p) => ({ playerId: p.id, isHuman: p.isHuman, name: p.name }));

  if (queue.length === 0) {
    state.pendingLighthousePrompt = null;
    return;
  }

  state.pendingLighthousePrompt = {
    queue,
    queueIndex: 0,
    awaitingPlayerId: queue[0]?.playerId ?? null,
  };
}

function assertLighthouseController(state: GameState, actingHumanId: string): string {
  const prompt = state.pendingLighthousePrompt;
  if (!prompt?.awaitingPlayerId) throw new Error("No lighthouse offer active");
  const human = getPlayer(state, actingHumanId);
  if (!human.isHuman) throw new Error("Only human can respond to lighthouse offers");

  const ownerId = prompt.awaitingPlayerId;
  const owner = getPlayer(state, ownerId);
  if (owner.isHuman && ownerId !== actingHumanId) {
    throw new Error("Not your lighthouse offer");
  }
  return ownerId;
}

export function useLighthouse(state: GameState, actingHumanId: string, discardInstanceId: string): void {
  if (state.phase !== "manifest" || state.presentationHold?.at !== "manifest") {
    throw new Error("Lighthouse can only be used during manifest");
  }
  const ownerId = assertLighthouseController(state, actingHumanId);
  const owner = getPlayer(state, ownerId);
  const hasLighthouse = owner.persistentCards.some((c) => getCard(c.cardId).effectId === "lighthouse");
  if (!hasLighthouse) throw new Error("No Lighthouse in play");
  const discard = owner.hand.find((c) => c.instanceId === discardInstanceId);
  if (!discard) throw new Error("Card not in hand");
  owner.hand = owner.hand.filter((c) => c.instanceId !== discardInstanceId);
  state.actionDiscard.push(discard);
  state.modifiers.manifestDamageBlock += 1;
  log(state, `${owner.name} uses Lighthouse to block 1 manifest damage.`);
  advanceLighthouseQueue(state);
}

export function skipLighthouse(state: GameState, actingHumanId: string): void {
  if (state.phase !== "manifest" || state.presentationHold?.at !== "manifest") {
    throw new Error("Lighthouse can only be skipped during manifest");
  }
  const ownerId = assertLighthouseController(state, actingHumanId);
  const owner = getPlayer(state, ownerId);
  log(state, `${owner.name} skips Lighthouse.`);
  advanceLighthouseQueue(state);
}
