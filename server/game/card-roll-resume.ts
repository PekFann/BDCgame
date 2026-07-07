import type { GameState, PendingCardRollResume } from "../../shared/types.js";
import { DNC } from "../../shared/cards.js";
import {
  dealDamageToAllDemons,
  dealDamageToDemon,
  damagePossessed,
  discardFromHand,
  drawForPlayer,
  gainEnergy,
  gainFriendship,
  revealDemon,
} from "./effects/primitives.js";
import { getPlayer, legalDamageTargets } from "./rules.js";
import { enterDncPhase } from "./phases.js";
import { log } from "./util.js";

function addDiscardToHand(state: GameState, player: { hand: { instanceId: string; cardId: string }[] }) {
  const card = state.actionDiscard.pop();
  if (card) player.hand.push(card);
}

function demonTargets(state: GameState): string[] {
  return legalDamageTargets(state);
}

function skipToNextDncCard(state: GameState): void {
  log(state, "Current Diurnal Cycle discarded.");
  if (state.dncDeck.length === 0) {
    state.winner = "demons";
    state.phase = "game_over";
    log(state, "Time has run out. The contract holds.");
    return;
  }
  const dncId = state.dncDeck.shift()!;
  state.currentDncId = dncId;
  state.dncPhaseIndex = 0;
  state.presentationHold = null;
  state.lastDiceRoll = null;
  log(state, `New Diurnal Cycle begins (${DNC[dncId].name}).`);
  enterDncPhase(state, 0);
}

export function resumeCardRollEffect(state: GameState, resume: PendingCardRollResume): void {
  const roll = state.lastDiceRoll ?? 1;
  const player = getPlayer(state, resume.playerId);

  switch (resume.effectId) {
    case "talk_it_out":
      if (roll <= 4) revealDemon(state);
      else gainFriendship(player, -1);
      break;
    case "wild_card":
      if (roll <= 3) {
        discardFromHand(state, player, player.hand.map((c) => c.instanceId));
        drawForPlayer(state, player, 5);
      } else {
        drawForPlayer(state, player, 5);
        if (player.hand.length > 2) {
          const excess = player.hand.splice(2);
          state.actionDiscard.push(...excess);
        }
      }
      break;
    case "instant_access":
      if (roll <= 3 && state.actionDiscard.length > 0) addDiscardToHand(state, player);
      else drawForPlayer(state, player, 1);
      break;
    case "chain_broken":
      if (resume.targetId) {
        dealDamageToDemon(state, resume.targetId, roll, resume.playerId);
      } else {
        const targets = demonTargets(state);
        if (targets.length === 1) {
          dealDamageToDemon(state, targets[0], roll, resume.playerId);
        } else {
          state.pendingChoice = {
            kind: "select_target",
            playerId: resume.playerId,
            amount: roll,
            targets,
            cardId: "action_20",
            cardInstanceId: resume.cardInstanceId,
          };
        }
      }
      break;
    case "event_morphin":
      dealDamageToAllDemons(state, roll <= 3 ? 1 : 3);
      log(state, `Morphin' Time: ${roll <= 3 ? 1 : 3} damage to all demons.`);
      break;
    case "event_dragon":
      if (roll <= 3) {
        for (const p of state.players) gainEnergy(p, 1, state);
        log(state, "Pocket-Sized Dragon: all players gain 1 energy.");
      } else {
        for (const p of state.players) gainFriendship(p, 1);
        log(state, "Pocket-Sized Dragon: all players gain 1 friendship.");
      }
      break;
    case "event_phantom_fart":
      if (roll <= 3) {
        for (const p of state.players) gainFriendship(p, -1);
        log(state, "Phantom Fart: all players lose 1 friendship.");
      } else {
        dealDamageToAllDemons(state, 2);
        log(state, "Phantom Fart: demons take 2 damage.");
      }
      break;
    case "event_wrong_spell":
      if (roll <= 3) {
        damagePossessed(state, 1);
        log(state, "Wrong Spell: Possessed loses 1 HP.");
      } else {
        for (const p of state.players) gainEnergy(p, 1, state);
        log(state, "Wrong Spell: all players gain 1 energy.");
      }
      break;
    case "event_lost_hours":
      if (roll <= 3) {
        skipToNextDncCard(state);
        state.pendingPostTriggerAdvance = false;
      } else {
        log(state, "Lost Hours: no effect.");
      }
      break;
    case "time_travel":
      break;
    default:
      break;
  }
}
