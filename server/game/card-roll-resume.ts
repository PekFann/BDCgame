import type { GameState, PendingCardRollResume } from "../../shared/types.js";
import { DNC, getCard } from "../../shared/cards.js";
import {
  addToHand,
  dealDamageToAllDemons,
  dealDamageToDemon,
  damagePossessed,
  discardFromHand,
  drawCardsFromDeck,
  drawForPlayer,
  gainEnergy,
  gainFriendship,
  revealDemon,
} from "./effects/primitives.js";
import { getPlayer, legalDamageTargets } from "./rules.js";
import { enterDncPhase } from "./phases.js";
import { log } from "./util.js";

export const WILD_CARD_ID = "action_14";
const WILD_CARD_KEEP = 2;

export function isWildCardKeep(pending: GameState["pendingChoice"]): boolean {
  return pending?.kind === "keep_cards" && pending.cardId === WILD_CARD_ID;
}

/** After Wild Card 4–6: choose 2 of the drawn cards to add to the existing hand. */
export function startWildCardKeepPrompt(state: GameState, playerId: string, drawn: { instanceId: string; cardId: string }[]): void {
  if (drawn.length === 0) return;
  if (drawn.length <= WILD_CARD_KEEP) {
    const player = getPlayer(state, playerId);
    for (const card of drawn) addToHand(state, player, card);
    log(state, `${player.name} keeps ${drawn.length} drawn card${drawn.length === 1 ? "" : "s"}.`);
    state.pendingCardPool = null;
    return;
  }
  state.pendingCardPool = drawn;
  state.pendingChoice = {
    kind: "keep_cards",
    playerId,
    cardId: WILD_CARD_ID,
    minKeep: WILD_CARD_KEEP,
    maxKeep: WILD_CARD_KEEP,
    options: drawn.map((c) => ({
      id: c.instanceId,
      label: getCard(c.cardId).name,
      cardId: c.cardId,
    })),
  };
}

export function resolveKeepCards(state: GameState, playerId: string, keepIds: string[]): void {
  const pending = state.pendingChoice;
  if (!pending || pending.kind !== "keep_cards") throw new Error("No keep-cards choice pending");
  const pool = state.pendingCardPool ?? [];
  const minKeep = pending.minKeep ?? WILD_CARD_KEEP;
  const maxKeep = pending.maxKeep ?? minKeep;
  if (keepIds.length < minKeep || keepIds.length > maxKeep) {
    throw new Error(`Select ${minKeep === maxKeep ? minKeep : `${minKeep}–${maxKeep}`} cards to keep`);
  }
  const poolById = new Map(pool.map((c) => [c.instanceId, c]));
  for (const id of keepIds) {
    if (!poolById.has(id)) throw new Error("Invalid card selection");
  }
  const keepSet = new Set(keepIds);
  const player = getPlayer(state, playerId);
  for (const card of pool) {
    if (keepSet.has(card.instanceId)) addToHand(state, player, card);
    else state.actionDiscard.push(card);
  }
  log(state, `${player.name} keeps ${keepIds.length} cards and adds them to their hand.`);
  state.pendingCardPool = null;
  state.pendingChoice = null;
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
        log(state, `${player.name} discards their hand and draws 5 cards.`);
      } else {
        const drawn = drawCardsFromDeck(state, 5);
        log(state, `${player.name} draws ${drawn.length} cards to choose from.`);
        startWildCardKeepPrompt(state, resume.playerId, drawn);
      }
      break;
    case "instant_access":
      if (roll <= 3) {
        if (state.actionDiscard.length === 0) {
          log(state, "Instant Access: discard pile is empty.");
          break;
        }
        state.pendingChoice = {
          kind: "pick_action_discard",
          playerId: resume.playerId,
          cardId: "action_17",
          searchPile: "discard",
          options: state.actionDiscard.map((c) => ({
            id: c.instanceId,
            label: getCard(c.cardId).name,
            cardId: c.cardId,
          })),
        };
      } else {
        if (state.actionDeck.length === 0) {
          log(state, "Instant Access: action deck is empty.");
          break;
        }
        state.pendingChoice = {
          kind: "pick_action_discard",
          playerId: resume.playerId,
          cardId: "action_17",
          searchPile: "deck",
          options: state.actionDeck.map((c) => ({
            id: c.instanceId,
            label: getCard(c.cardId).name,
            cardId: c.cardId,
          })),
        };
      }
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
        for (const p of state.players) discardFromHand(state, p, p.hand.slice(0, 1).map((c) => c.instanceId));
        log(state, "Phantom Fart: each player discards 1 card.");
      } else {
        damagePossessed(state, 2, "Phantom Fart");
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
