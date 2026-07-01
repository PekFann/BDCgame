import type { GameState, PendingCardRollResume } from "../../shared/types.js";
import {
  dealDamageToDemon,
  discardFromHand,
  drawForPlayer,
  gainFriendship,
  revealDemon,
} from "./effects/primitives.js";
import { getPlayer, legalDamageTargets } from "./rules.js";

function addDiscardToHand(state: GameState, player: { hand: { instanceId: string; cardId: string }[] }) {
  const card = state.actionDiscard.pop();
  if (card) player.hand.push(card);
}

function demonTargets(state: GameState): string[] {
  return legalDamageTargets(state);
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
    case "time_travel":
      break;
    default:
      break;
  }
}
