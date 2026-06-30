import type { GameState } from "../../../shared/types.js";
import { getPlayer } from "../rules.js";
import {
  dealDamageToAllDemons,
  damagePossessed,
  discardFromHand,
  drawForPlayer,
  gainEnergy,
  gainFriendship,
  rollAndStore,
} from "./primitives.js";
import { log, rollD6 } from "../util.js";

export function resolveTriggerEffect(state: GameState, effectId: string, rollerId: string): void {
  const roller = getPlayer(state, rollerId);
  switch (effectId) {
    case "trigger_sarah":
      state.modifiers.caringGiftsBlocked = true;
      log(state, "Caring and Gifts blocked until end of cycle.");
      break;
    case "trigger_emma":
      if (roller.hand.length > 0) {
        const ids = roller.hand.slice(-2).map((c) => c.instanceId);
        discardFromHand(state, roller, ids);
        log(state, `${roller.name} discards 2 cards.`);
      }
      break;
    case "trigger_sophia":
      gainFriendship(roller, -1);
      log(state, `${roller.name} loses 1 friendship.`);
      break;
    case "trigger_victoria":
      state.modifiers.actionEnergyPenalty = 1;
      log(state, "All actions cost +1 energy until end of cycle.");
      break;
    case "trigger_zoey":
      state.modifiers.prayerBlocked = true;
      log(state, "Prayer has no effect on demons until end of cycle.");
      break;
    case "trigger_rosy_boo": {
      const roll = rollD6();
      log(state, `Rosy Boo trigger rolls ${roll}.`);
      for (let i = 0; i < roll; i++) {
        if (state.actionDeck.length === 0) break;
        state.actionDiscard.push(state.actionDeck.pop()!);
      }
      break;
    }
    case "trigger_puddle": {
      if (state.possessedHp < 9 && state.demon) {
        const gain = 9 - state.possessedHp;
        state.demon.hp = Math.min(state.demon.maxHp, state.demon.hp + gain);
        for (const imp of state.imps) {
          imp.hp = Math.min(imp.maxHp, imp.hp + gain);
        }
        log(state, `Demons gain ${gain} HP.`);
      }
      break;
    }
    case "trigger_jonathan":
      roller.energy = Math.max(0, roller.energy - 1);
      log(state, `${roller.name} loses 1 energy.`);
      break;
    case "trigger_wilson":
      state.possessedHp = Math.min(state.possessedMaxHp, state.possessedHp + 1);
      log(state, "Wilson gains 1 HP.");
      break;
    case "trigger_ash": {
      const atk = state.demon?.attack ?? 1;
      const ids = roller.hand.slice(-atk).map((c) => c.instanceId);
      discardFromHand(state, roller, ids);
      log(state, `${roller.name} discards ${ids.length} cards.`);
      break;
    }
  }
}

export function resolveEventEffect(
  state: GameState,
  effectId: string,
  playerId: string,
  cardId?: string
): void {
  const player = getPlayer(state, playerId);
  switch (effectId) {
    case "event_poop_patrol":
      state.modifiers.maxHandSize = 4;
      state.modifiers.handSizeReductionUntilCycle = state.cycle + 1;
      log(state, "Max hand size is 4 until end of next cycle.");
      break;
    case "event_throne":
      state.modifiers.maxEnergy = 4;
      state.modifiers.energyCapUntilCycle = state.cycle + 1;
      for (const p of state.players) p.energy = Math.min(p.energy, 4);
      log(state, "Energy capped at 4 until end of next cycle.");
      break;
    case "event_donut_bandit":
      state.pendingChoice = {
        kind: "donut_bandit",
        playerId,
        cardId,
        options: [
          { id: "lose_energy", label: "You lose 2 energy" },
          { id: "lose_friendship", label: "Each player loses 1 friendship" },
        ],
      };
      break;
    case "event_haunted_pizza":
      state.pendingChoice = {
        kind: "haunted_pizza",
        playerId,
        cardId,
        options: [
          { id: "possessed_damage", label: "Possessed loses 2 HP" },
          { id: "lose_energy", label: "Each player loses 1 energy" },
        ],
      };
      break;
    case "event_divine_descent":
      state.modifiers.skipManifest = true;
      log(state, "Demons skip manifest this cycle.");
      break;
    case "event_eye_roll":
      state.modifiers.manifestDamageBlock = 2;
      log(state, "Next manifest damage reduced by 2.");
      break;
    case "event_cat_video":
      for (const p of state.players) gainEnergy(p, 2, state);
      log(state, "All players gain 2 energy.");
      break;
    case "event_morphin": {
      const roll = rollAndStore(state, playerId);
      dealDamageToAllDemons(state, roll <= 3 ? 1 : 3);
      break;
    }
    case "event_dragon": {
      const roll = rollAndStore(state, playerId);
      if (roll <= 3) {
        for (const p of state.players) gainEnergy(p, 1, state);
      } else {
        for (const p of state.players) gainFriendship(p, 1);
      }
      break;
    }
    case "event_double_doom":
      state.modifiers.doubleDrawPhase = true;
      log(state, "Next draw phase draws twice.");
      break;
    case "event_lost_sock":
      for (const p of state.players) drawForPlayer(state, p, 1);
      log(state, "Each player draws 1 card.");
      break;
    case "event_unicorn":
      state.pendingChoice = {
        kind: "event_pick_one",
        playerId,
        cardId,
        options: [
          { id: "friendship", label: "You gain 2 friendship" },
          { id: "energy_all", label: "Each player gains 1 energy" },
        ],
      };
      break;
    case "event_rubber_duck":
      state.pendingChoice = {
        kind: "event_pick_one",
        playerId,
        cardId,
        options: [
          { id: "energy", label: "You gain 3 energy" },
          { id: "friendship_all", label: "Each player gains 1 friendship" },
        ],
      };
      break;
    case "event_phantom_fart": {
      const roll = rollAndStore(state, playerId);
      if (roll <= 3) {
        for (const p of state.players) gainFriendship(p, -1);
      } else {
        dealDamageToAllDemons(state, 2);
      }
      break;
    }
    case "event_wrong_spell": {
      const roll = rollAndStore(state, playerId);
      if (roll <= 3) damagePossessed(state, 1);
      else for (const p of state.players) gainEnergy(p, 1, state);
      break;
    }
    case "event_lost_hours": {
      const roll = rollAndStore(state, playerId);
      if (roll <= 3 && state.dncDeck.length > 0) {
        state.dncDeck.pop();
        log(state, "Current Diurnal Cycle discarded.");
      }
      break;
    }
  }
}

export function resolveEventPickOne(state: GameState, playerId: string, optionId: string, kind: string): void {
  const player = getPlayer(state, playerId);
  if (kind === "donut_bandit") {
    if (optionId === "lose_energy") gainEnergy(player, -2, state);
    else for (const p of state.players) gainFriendship(p, -1);
  } else if (kind === "haunted_pizza") {
    if (optionId === "possessed_damage") damagePossessed(state, 2);
    else for (const p of state.players) gainEnergy(p, -1, state);
  } else if (kind === "event_pick_one") {
    if (optionId === "friendship") gainFriendship(player, 2);
    else if (optionId === "energy") gainEnergy(player, 3, state);
    else if (optionId === "energy_all") for (const p of state.players) gainEnergy(p, 1, state);
    else if (optionId === "friendship_all") for (const p of state.players) gainFriendship(p, 1);
  }
}
