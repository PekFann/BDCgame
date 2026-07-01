import type { GameState, PlayerState } from "../../shared/types.js";
import { DNC, getCard } from "../../shared/cards.js";

export function defaultModifiers() {
  return {
    maxHandSize: 7,
    maxEnergy: 5,
    skipManifest: false,
    manifestDamageBlock: 0,
    doubleDrawPhase: false,
    actionEnergyPenalty: 0,
    caringGiftsBlocked: false,
    prayerBlocked: false,
    healingBlocked: false,
    handSizeReductionUntilCycle: null as number | null,
    energyCapUntilCycle: null as number | null,
    rageDoubleAttack: false,
    prideDoubleAttack: false,
    slothTripleAttack: false,
    noHealAtNight: false,
    overdramaticEyeRoll: false,
  };
}

export function getPossessedRequirement(state: GameState): number {
  return getCard(state.possessedId).friendshipRequirement ?? 0;
}

export function meetsFriendshipRequirement(state: GameState, player: PlayerState): boolean {
  return player.friendship >= getPossessedRequirement(state);
}

export function phaseActionsFull(state: GameState): boolean {
  if (!state.currentDncId) return false;
  const dnc = DNC[state.currentDncId];
  if (!dnc) return false;
  if (state.phase === "day") return state.dayActionsRemaining === dnc.dayActions;
  if (state.phase === "night") return state.nightActionsRemaining === dnc.nightActions;
  return false;
}

export function canVoteRest(state: GameState, player: PlayerState): boolean {
  if (state.phase !== "day" && state.phase !== "night") return false;
  if (player.restVote !== null) return false;
  return !player.usedPhaseAction && phaseActionsFull(state);
}

export function restEligiblePlayers(state: GameState): PlayerState[] {
  if (state.phase !== "day" && state.phase !== "night") return [];
  return state.players.filter((p) => !p.usedPhaseAction && phaseActionsFull(state));
}

export function clearRestVotesIfPoolSpent(state: GameState): void {
  if (phaseActionsFull(state)) return;
  for (const p of state.players) {
    p.restVote = null;
  }
}

export function getPlayer(state: GameState, playerId: string): PlayerState {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error("Player not found");
  return player;
}

export function getCardFromHand(player: PlayerState, instanceId: string) {
  const card = player.hand.find((c) => c.instanceId === instanceId);
  if (!card) throw new Error("Card not in hand");
  return card;
}

export function allDemons(state: GameState) {
  const demons = [];
  if (state.demon) demons.push(state.demon);
  demons.push(...state.imps);
  return demons;
}

export function findDemon(state: GameState, targetId: string) {
  if (state.demon?.instanceId === targetId) return state.demon;
  return state.imps.find((d) => d.instanceId === targetId) ?? null;
}

export function canTargetDemon(state: GameState, demon: { instanceId: string; cardId: string; revealed: boolean; isImp: boolean; hp: number }) {
  const def = getCard(demon.cardId);
  if (!demon.isImp && !state.demonRevealed) return false;
  if (def.effectId === "imp_selfish") {
    if (!state.demonRevealed && state.demon && state.demon.hp > 10) return false;
    if (state.demon && state.demon.hp > 10 && !demon.isImp) return false;
  }
  if (def.effectId === "imp_stubborn" && !demon.isImp) {
    const stubborn = state.imps.find((i) => getCard(i.cardId).effectId === "imp_stubborn" && i.hp > 0);
    if (stubborn) return false;
  }
  return demon.hp > 0;
}

export function legalDamageTargets(state: GameState): string[] {
  const ids: string[] = [];
  if (state.demon && canTargetDemon(state, state.demon)) {
    ids.push(state.demon.instanceId);
  }
  for (const imp of state.imps) {
    if (canTargetDemon(state, imp)) ids.push(imp.instanceId);
  }
  return ids;
}

export function getEffectiveAttack(state: GameState, demon: { attack: number; cardId: string }) {
  let attack = demon.attack;
  const def = getCard(demon.cardId);
  if (def.effectId === "demon_rage" && state.modifiers.rageDoubleAttack) attack *= 2;
  if (def.effectId === "demon_pride" && state.modifiers.prideDoubleAttack) attack *= 2;
  if (def.effectId === "demon_sloth" && state.modifiers.slothTripleAttack) attack *= 3;
  return attack;
}

export function resetCycleModifiers(state: GameState) {
  state.modifiers.rageDoubleAttack = false;
  state.modifiers.prideDoubleAttack = false;
  state.modifiers.slothTripleAttack = false;
  state.modifiers.skipManifest = false;
  state.modifiers.manifestDamageBlock = 0;
  state.modifiers.doubleDrawPhase = false;
  state.modifiers.actionEnergyPenalty = 0;
  state.modifiers.caringGiftsBlocked = false;
  state.modifiers.prayerBlocked = false;
  state.modifiers.healingBlocked = false;
  state.modifiers.noHealAtNight = false;
  state.modifiers.overdramaticEyeRoll = false;
  if (state.modifiers.handSizeReductionUntilCycle !== null && state.modifiers.handSizeReductionUntilCycle <= state.cycle) {
    state.modifiers.handSizeReductionUntilCycle = null;
    state.modifiers.maxHandSize = 7;
  }
  if (state.modifiers.energyCapUntilCycle !== null && state.modifiers.energyCapUntilCycle <= state.cycle) {
    state.modifiers.energyCapUntilCycle = null;
    state.modifiers.maxEnergy = 5;
  }
  if (state.demon && getCard(state.demon.cardId).effectId === "demon_hopelessness") {
    state.modifiers.maxHandSize = 4;
  }
}
