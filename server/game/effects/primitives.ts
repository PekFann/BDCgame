import type { CardDefinition, ManifestPreview } from "../../../shared/types.js";
import type { GameState, PlayerState } from "../../../shared/types.js";
import { getCard } from "../../../shared/cards.js";
import { findDemon, getEffectiveAttack, getPlayer, meetsFriendshipRequirement, canTargetDemon, legalDamageTargets } from "../rules.js";
import { clamp, log, makeInstance, rollD6 } from "../util.js";
import { resolveEventEffect, resolveTriggerEffect } from "./triggers.js";

export function drawFromActionDeck(state: GameState, count: number): void {
  const player = state.players.find((p) => p.id === state.pendingChoice?.playerId);
  for (let i = 0; i < count; i++) {
    if (state.actionDeck.length === 0) {
      state.actionDeck = state.actionDiscard.splice(0);
      if (state.actionDeck.length === 0) break;
    }
    const card = state.actionDeck.pop()!;
    if (player) addToHand(state, player, card);
  }
}

export function addToHand(state: GameState, player: PlayerState, card: { instanceId: string; cardId: string }): void {
  player.hand.push(card);
  while (player.hand.length > state.modifiers.maxHandSize) {
    const discarded = player.hand.pop()!;
    state.actionDiscard.push(discarded);
    log(state, `${player.name} discards excess card.`);
  }
}

export function discardFromHand(state: GameState, player: PlayerState, instanceIds: string[]): void {
  for (const id of instanceIds) {
    const idx = player.hand.findIndex((c) => c.instanceId === id);
    if (idx >= 0) {
      const [card] = player.hand.splice(idx, 1);
      state.actionDiscard.push(card);
    }
  }
}

export function removeFromHandToDiscard(state: GameState, player: PlayerState, instanceId: string) {
  const idx = player.hand.findIndex((c) => c.instanceId === instanceId);
  if (idx >= 0) {
    const [card] = player.hand.splice(idx, 1);
    state.actionDiscard.push(card);
    return card;
  }
  return null;
}

export function gainEnergy(player: PlayerState, amount: number, state: GameState): void {
  const cap = state.modifiers.energyCapUntilCycle ? Math.min(state.modifiers.maxEnergy, 4) : state.modifiers.maxEnergy;
  player.energy = clamp(player.energy + amount, 0, cap);
}

export function spendEnergy(player: PlayerState, amount: number): boolean {
  if (player.energy < amount) return false;
  player.energy -= amount;
  return true;
}

export function gainFriendship(player: PlayerState, amount: number): void {
  player.friendship = Math.max(0, player.friendship + amount);
}

export function spendFriendship(player: PlayerState, amount: number): boolean {
  if (player.friendship < amount) return false;
  player.friendship -= amount;
  return true;
}

export function healPossessed(state: GameState, amount: number, sourcePlayerId?: string, viaAction = false): void {
  if (state.modifiers.healingBlocked) {
    log(state, "Healing is blocked.");
    return;
  }
  if (state.phase === "night" && state.modifiers.noHealAtNight) {
    log(state, "Possessed cannot heal during Night.");
    return;
  }
  const before = state.possessedHp;
  state.possessedHp = clamp(state.possessedHp + amount, 0, state.possessedMaxHp);
  const healed = state.possessedHp - before;
  if (healed > 0) {
    log(state, `Possessed heals ${healed} HP.`);
    if (state.demon && getCard(state.demon.cardId).effectId === "demon_greed") {
      state.demon.hp = clamp(state.demon.hp + healed, 0, state.demon.maxHp);
      log(state, "Greed gains the same HP.");
    }
    if (viaAction && sourcePlayerId && state.demon && getCard(state.demon.cardId).effectId === "demon_jealousy") {
      const player = getPlayer(state, sourcePlayerId);
      gainFriendship(player, -1);
      log(state, `${player.name} loses 1 friendship (Jealousy).`);
    }
  }
}

export function damagePossessed(state: GameState, amount: number, source?: string): void {
  if (amount <= 0) return;
  state.possessedHp = Math.max(0, state.possessedHp - amount);
  log(state, `Possessed takes ${amount} damage${source ? ` (${source})` : ""}.`);
  if (state.possessedHp <= 5 && state.demon && getCard(state.demon.cardId).effectId === "demon_pride") {
    state.modifiers.prideDoubleAttack = true;
    log(state, "Pride's attack doubles.");
  }
  if (state.demon && getCard(state.demon.cardId).effectId === "demon_rejection") {
    const richest = [...state.players].sort((a, b) => b.hand.length - a.hand.length)[0];
    if (richest && richest.hand.length > 0) {
      const toDiscard = richest.hand.splice(-2);
      state.actionDiscard.push(...toDiscard);
      log(state, `${richest.name} discards 2 cards (Rejection).`);
    }
  }
  if (state.demon && getCard(state.demon.cardId).effectId === "demon_anxiety") {
    state.possessedMaxHp = Math.max(1, state.possessedMaxHp - 1);
    log(state, "Possessed max HP decreases by 1 (Anxiety).");
  }
  if (state.imps.some((i) => getCard(i.cardId).effectId === "imp_self_doubt")) {
    applyPossessedTrigger(state, state.diceRollerId ?? state.players[0].id);
  }
  if (state.possessedHp <= 0 && tryAutoResurrection(state)) return;
  checkGameOver(state);
}

export function tryAutoResurrection(state: GameState): boolean {
  if (state.possessedHp > 0) return false;

  const candidates = state.players
    .filter((p) =>
      p.hand.some((c) => getCard(c.cardId).effectId === "resurrection") &&
      meetsFriendshipRequirement(state, p)
    )
    .sort((a, b) => {
      if (a.isHuman !== b.isHuman) return a.isHuman ? -1 : 1;
      return a.slot - b.slot;
    });

  const player = candidates[0];
  if (!player) return false;

  const card = player.hand.find((c) => getCard(c.cardId).effectId === "resurrection");
  if (!card) return false;

  removeFromHandToDiscard(state, player, card.instanceId);
  state.possessedHp = 1;
  log(state, `${player.name}'s Resurrection saves the Possessed!`);
  return true;
}

export function dealDamageToDemon(state: GameState, targetId: string, amount: number, sourcePlayerId?: string): void {
  if (amount <= 0) return;
  const demon = findDemon(state, targetId);
  if (!demon || demon.hp <= 0) return;
  if (!canTargetDemon(state, demon)) {
    log(state, "That demon cannot be targeted.");
    return;
  }
  demon.hp = Math.max(0, demon.hp - amount);
  log(state, `${getCard(demon.cardId).name} takes ${amount} damage.`);
  if (!demon.isImp && getCard(demon.cardId).effectId === "demon_rage") {
    state.modifiers.rageDoubleAttack = true;
    log(state, "Rage doubles its attack.");
  }
  if (demon.hp <= 0) {
    log(state, `${getCard(demon.cardId).name} is destroyed.`);
    if (demon.isImp) {
      state.imps = state.imps.filter((i) => i.instanceId !== demon.instanceId);
      if (getCard(demon.cardId).effectId === "imp_sudden_sadness") {
        state.modifiers.healingBlocked = false;
      }
    } else {
      state.winner = "players";
      state.phase = "game_over";
      log(state, "The demon is defeated! You win!");
    }
  }
}

export function dealDamageToAllDemons(state: GameState, amount: number): void {
  for (const id of legalDamageTargets(state)) {
    dealDamageToDemon(state, id, amount);
  }
}

export function revealDemon(state: GameState): void {
  if (!state.demon || state.demonRevealed) return;
  state.demonRevealed = true;
  state.demon.revealed = true;
  log(state, "The Demon's Contract is revealed!");
  applyDemonPassive(state);
}

export function applyDemonPassive(state: GameState): void {
  if (!state.demon) return;
  const effect = getCard(state.demon.cardId).effectId;
  if (effect === "demon_hopelessness") state.modifiers.maxHandSize = 4;
  if (effect === "demon_bitterness" && state.demon.hp <= 10) {
    state.modifiers.caringGiftsBlocked = true;
  }
}

export function drawEventCard(state: GameState, playerId: string): void {
  if (state.eventDeck.length === 0) {
    state.eventDeck = state.eventDiscard.splice(0);
  }
  if (state.eventDeck.length === 0) return;
  const card = state.eventDeck.pop()!;
  const def = getCard(card.cardId);
  log(state, `Event drawn: ${def.name}`);
  resolveEventCard(state, card, playerId);
}

export function resolveEventCard(state: GameState, card: { instanceId: string; cardId: string }, playerId: string): void {
  const def = getCard(card.cardId);
  if (def.type === "demon") {
    const imp = {
      instanceId: card.instanceId,
      cardId: card.cardId,
      hp: def.hp ?? 1,
      maxHp: def.hp ?? 1,
      attack: def.attack ?? 1,
      revealed: true,
      isImp: true,
    };
    state.imps.push(imp);
    log(state, `${def.name} enters play.`);
    return;
  }
  if (def.effectId === "event_first_aid") {
    getPlayer(state, playerId).firstAidKit = true;
    log(state, `${getPlayer(state, playerId).name} keeps First Aid Kit.`);
    return;
  }
  state.eventDiscard.push(card);
  resolveEventEffect(state, def.effectId, playerId, card.cardId);
}

export function applyPossessedTrigger(state: GameState, rollerId: string): void {
  const def = getCard(state.possessedId);
  log(state, `Possessed triggered: ${def.name}`);
  resolveTriggerEffect(state, def.effectId, rollerId);
}

export function peekEventCardId(state: GameState): string | null {
  if (state.eventDeck.length === 0) {
    if (state.eventDiscard.length === 0) return null;
    const reshuffled = [...state.eventDiscard];
    return reshuffled[reshuffled.length - 1]?.cardId ?? null;
  }
  return state.eventDeck[state.eventDeck.length - 1]?.cardId ?? null;
}

export function computeManifestPreview(state: GameState): ManifestPreview {
  const hpBefore = state.possessedHp;
  if (state.modifiers.skipManifest) {
    return { totalDamage: 0, hpBefore, sources: [], skipped: true };
  }

  const sources: { name: string; damage: number }[] = [];
  let block = state.modifiers.manifestDamageBlock;

  if (state.demon && state.demonRevealed) {
    if (state.demon.hp > 0) {
      let dmg = getEffectiveAttack(state, state.demon);
      if (block > 0) {
        const used = Math.min(block, dmg);
        dmg -= used;
        block -= used;
      }
      if (dmg > 0) sources.push({ name: getCard(state.demon.cardId).name, damage: dmg });
    }
  } else if (state.demon && !state.demonRevealed) {
    let dmg = 1;
    if (block > 0) {
      const used = Math.min(block, dmg);
      dmg -= used;
      block -= used;
    }
    if (dmg > 0) sources.push({ name: "Hidden Demon", damage: dmg });
    for (const imp of state.imps) {
      if (imp.hp <= 0) continue;
      let impDmg = getEffectiveAttack(state, imp);
      if (block > 0) {
        const used = Math.min(block, impDmg);
        impDmg -= used;
        block -= used;
      }
      if (impDmg > 0) sources.push({ name: getCard(imp.cardId).name, damage: impDmg });
    }
  } else {
    for (const imp of state.imps) {
      if (imp.hp <= 0) continue;
      let dmg = getEffectiveAttack(state, imp);
      if (block > 0) {
        const used = Math.min(block, dmg);
        dmg -= used;
        block -= used;
      }
      if (dmg > 0) sources.push({ name: getCard(imp.cardId).name, damage: dmg });
    }
  }

  const totalDamage = sources.reduce((s, x) => s + x.damage, 0);
  return { totalDamage, hpBefore, sources, skipped: false };
}

export function applyManifest(state: GameState): void {
  if (state.phase !== "manifest") {
    log(state, "Manifest damage skipped — not in manifest phase.");
    return;
  }
  if (state.modifiers.skipManifest) {
    log(state, "Demons do not manifest this cycle.");
    return;
  }
  for (const p of state.players) {
    if (p.persistentCards.some((c) => getCard(c.cardId).effectId === "trumpet_of_victory")) {
      healPossessed(state, 1);
    }
  }
  let block = state.modifiers.manifestDamageBlock;
  state.modifiers.manifestDamageBlock = 0;
  state.modifiers.overdramaticEyeRoll = false;

  const demons = [];
  if (state.demon && state.demonRevealed) demons.push(state.demon);
  else if (state.demon && !state.demonRevealed) {
    const hiddenAttack = 1;
    let dmg = hiddenAttack;
    if (block > 0) {
      const used = Math.min(block, dmg);
      dmg -= used;
      block -= used;
      log(state, `Blocked ${used} manifest damage.`);
    }
    if (dmg > 0) damagePossessed(state, dmg, "Hidden Demon");
    for (const imp of state.imps) demons.push(imp);
  } else {
    for (const imp of state.imps) demons.push(imp);
  }

  for (const demon of demons) {
    if (demon.hp <= 0) continue;
    let dmg = getEffectiveAttack(state, demon);
    if (block > 0) {
      const used = Math.min(block, dmg);
      dmg -= used;
      block -= used;
      log(state, `Blocked ${used} manifest damage.`);
    }
    if (dmg > 0) {
      damagePossessed(state, dmg, getCard(demon.cardId).name);
      if (getCard(demon.cardId).effectId === "imp_foolish") {
        for (let i = 0; i < 5; i++) {
          if (state.actionDeck.length === 0) break;
          state.actionDiscard.push(state.actionDeck.pop()!);
        }
        log(state, "Foolish Imp discards top 5 Action cards.");
      }
      if (getCard(demon.cardId).effectId === "imp_clumsy") {
        for (const p of state.players) {
          if (p.hand.length > 0) {
            state.actionDiscard.push(p.hand.pop()!);
          }
        }
        log(state, "Each player discards 1 card.");
      }
      if (state.demon && getCard(state.demon.cardId).effectId === "demon_suicidal") {
        if (state.dncDeck.length > 0) {
          state.dncDeck.pop();
          log(state, "Suicidal discards last Diurnal Cycle from stack.");
        }
      }
    }
  }
  checkGameOver(state);
}

export function runManifest(state: GameState): void {
  applyManifest(state);
}

export function checkGameOver(state: GameState): void {
  if (state.possessedHp <= 0) {
    state.winner = "demons";
    state.phase = "game_over";
    log(state, "The Possessed has fallen. You lose.");
  }
}

export function rollAndStore(state: GameState, playerId: string): number {
  const roll = rollD6();
  state.lastDiceRoll = roll;
  state.diceRollerId = playerId;
  log(state, `${getPlayer(state, playerId).name} rolls ${roll}.`);
  return roll;
}

export function canPlayCardInCurrentPhase(state: GameState, def: CardDefinition): boolean {
  if (state.phase === "game_over" || state.phase === "setup") return false;
  if (def.instant) return true;
  if (!def.cycleIcon) return false;
  if (state.phase === "day") return state.dayActionsRemaining > 0;
  if (state.phase === "night") return state.nightActionsRemaining > 0;
  return false;
}

export function canPlayCard(state: GameState, player: PlayerState, cardId: string): boolean {
  const def = getCard(cardId);
  const energyCost = (def.energyCost ?? 0) + state.modifiers.actionEnergyPenalty;
  if (player.energy < energyCost) return false;
  if ((def.friendshipCost ?? 0) > player.friendship) return false;
  if (def.requiresFriendship && !meetsFriendshipRequirement(state, player)) return false;
  if (def.effectId === "talk_it_out" && state.demonRevealed) return false;
  if (def.effectId === "resurrection") return false;
  if (def.effectId === "time_travel" && state.lastDiceRoll === null) return false;
  return true;
}

export function payCardCosts(state: GameState, player: PlayerState, cardId: string): boolean {
  const def = getCard(cardId);
  const energyCost = (def.energyCost ?? 0) + state.modifiers.actionEnergyPenalty;
  if (!spendEnergy(player, energyCost)) return false;
  if ((def.friendshipCost ?? 0) > 0) spendFriendship(player, def.friendshipCost!);
  return true;
}

export function drawForPlayer(state: GameState, player: PlayerState, count = 1): void {
  for (let i = 0; i < count; i++) {
    if (state.actionDeck.length === 0) {
      state.actionDeck = state.actionDiscard.splice(0);
    }
    if (state.actionDeck.length === 0) break;
    addToHand(state, player, state.actionDeck.pop()!);
  }
}

export function spawnImpFromDeck(state: GameState, cardId: string): void {
  const def = getCard(cardId);
  state.imps.push({
    instanceId: makeInstance(cardId).instanceId,
    cardId,
    hp: def.hp ?? 1,
    maxHp: def.hp ?? 1,
    attack: def.attack ?? 1,
    revealed: true,
    isImp: true,
  });
}
