import { DNC, getCard } from "../../shared/cards.js";
import type { GameState, Phase } from "../../shared/types.js";
import { computeManifestPreview } from "./effects/primitives.js";
import { log } from "./util.js";

export function getDncPhases(state: GameState): Phase[] {
  if (!state.currentDncId) return [];
  return DNC[state.currentDncId]?.phases ?? [];
}

export function resetDayNightVoteState(state: GameState): void {
  state.restPollClosed = false;
  for (const p of state.players) {
    p.restVote = null;
    p.usedPhaseAction = false;
  }
}

function applyDemonAddictionNight(state: GameState): void {
  if (state.phase !== "night") return;
  if (state.demon && getCard(state.demon.cardId).effectId === "demon_addiction" && state.demon.hp <= 10) {
    state.demon.hp = Math.min(state.demon.maxHp, state.demon.hp + 2);
    log(state, "Addiction gains 2 HP.");
  }
}

function phaseEntryLog(state: GameState, phase: Phase): string {
  const dnc = state.currentDncId ? DNC[state.currentDncId] : null;
  switch (phase) {
    case "draw":
      return "Draw phase.";
    case "manifest":
      return "Manifestation phase.";
    case "day":
      return `Day phase (${dnc?.dayActions ?? state.dayActionsRemaining} actions).`;
    case "night":
      return `Night phase (${dnc?.nightActions ?? state.nightActionsRemaining} actions).`;
    case "triggers":
      return "Triggers & Events — roll dice.";
    default:
      return `${phase} phase.`;
  }
}

function preparePhaseEntry(state: GameState, phase: Phase): void {
  const dnc = state.currentDncId ? DNC[state.currentDncId] : null;

  switch (phase) {
    case "draw":
      for (const p of state.players) {
        p.drawChoice = null;
        p.drawChoicesThisPhase = 0;
      }
      break;
    case "day":
      if (dnc) state.dayActionsRemaining = dnc.dayActions;
      resetDayNightVoteState(state);
      break;
    case "night":
      if (dnc) state.nightActionsRemaining = dnc.nightActions;
      resetDayNightVoteState(state);
      applyDemonAddictionNight(state);
      break;
    case "triggers":
      state.lastDiceRoll = null;
      break;
    case "manifest":
      state.presentationHold = { at: "manifest", preview: computeManifestPreview(state) };
      break;
  }
}

export function enterDncPhase(state: GameState, index: number): void {
  const phases = getDncPhases(state);
  if (index < 0 || index >= phases.length) return;

  state.dncPhaseIndex = index;
  state.phase = phases[index];
  preparePhaseEntry(state, phases[index]);
  log(state, phaseEntryLog(state, phases[index]));
}

export function advanceDncPhase(state: GameState): void {
  const phases = getDncPhases(state);
  const next = state.dncPhaseIndex + 1;
  if (next >= phases.length) return;
  enterDncPhase(state, next);
}

export function finishDncCyclePhases(state: GameState): boolean {
  const phases = getDncPhases(state);
  return state.dncPhaseIndex >= phases.length - 1;
}
