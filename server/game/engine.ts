import { randomUUID } from "crypto";
import {
  ACTION_DECK_COUNTS,
  DEMON_IDS,
  DNC,
  EVENT_DECK_IDS,
  getCard,
} from "../../shared/cards.js";
import type {
  DrawChoice,
  DncCyclePhase,
  GameAction,
  GameState,
  PlayerState,
  PresentationHold,
  PrivateGameState,
  PublicGameState,
} from "../../shared/types.js";
import {
  resolveDiscardEffect,
  resolveEnergyDistribution,
  resolvePickActionDiscard,
  resolvePickOne,
  resolveTarget,
  startPlayCard,
} from "./effects/actions.js";
import {
  applyManifest,
  applyPossessedTrigger,
  checkGameOver,
  computeManifestPreview,
  drawEventCard,
  drawForPlayer,
  gainEnergy,
  gainFriendship,
} from "./effects/primitives.js";
import { resolveEventPickOne } from "./effects/triggers.js";
import { defaultModifiers, getPossessedRequirement, meetsFriendshipRequirement, resetCycleModifiers, canVoteRest, restEligiblePlayers } from "./rules.js";
import { log, makeInstance, shuffle } from "./util.js";
import { canPlayTeamCard, getLegalActions, pendingControllerId, pickAiDrawChoice, runAiTurns } from "./ai.js";
import {
  advanceDncPhase,
  enterDncPhase,
  finishDncCyclePhases,
  getDncPhases,
  getDncPhaseWeights,
  resetDayNightVoteState,
} from "./phases.js";
import {
  acceptReroll,
  beginDiceRoll,
  completeRerollAfterDiscard,
  declineReroll,
  hasPendingReroll,
} from "./dice-reroll.js";
import { resumeCardRollEffect } from "./card-roll-resume.js";

export function createEmptyGame(mode: "solo" | "multi"): GameState {
  return {
    id: randomUUID(),
    mode,
    playerCount: 0,
    cycle: 0,
    maxCycles: 10,
    phase: "setup",
    dncDeck: [],
    currentDncId: null,
    dncPhaseIndex: 0,
    dayActionsRemaining: 0,
    nightActionsRemaining: 0,
    possessedId: "",
    possessedHp: 0,
    possessedMaxHp: 0,
    possessedBaseHp: 0,
    demon: null,
    imps: [],
    players: [],
    actionDeck: [],
    actionDiscard: [],
    eventDeck: [],
    eventDiscard: [],
    demonRevealed: false,
    modifiers: defaultModifiers(),
    pendingChoice: null,
    pendingAiPlay: null,
    lastDiceRoll: null,
    diceRollerId: null,
    winner: null,
    log: [],
    hostId: null,
    started: false,
    prayerUsedThisPhase: new Set(),
    restPollClosed: false,
    declinedAiPlayIds: new Set(),
    presentationHold: null,
    introAcknowledged: false,
    pendingRerollPrompt: null,
    pendingCardRollResume: null,
    pendingPostTriggerAdvance: false,
    pendingRerollTimeTravelId: null,
    lobbyPossessedId: null,
  };
}

export function setupPlayers(state: GameState, count: number, humanSlot = 0): void {
  state.playerCount = count;
  state.players = Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    slot: i,
    name: i === humanSlot ? "You" : `AI ${i + 1}`,
    isHuman: i === humanSlot,
    isConnected: true,
    energy: 5,
    friendship: 0,
    hand: [],
    persistentCards: [],
    firstAidKit: false,
    restVote: null,
    drawChoice: null,
    drawChoicesThisPhase: 0,
    usedPhaseAction: false,
  }));
}

export function startGame(state: GameState, possessedId: string): void {
  const possessed = getCard(possessedId);
  const baseHp = possessed.hp ?? 10;
  state.possessedId = possessedId;
  state.possessedBaseHp = baseHp;
  state.possessedHp = baseHp;
  state.possessedMaxHp = baseHp;

  const demonId = DEMON_IDS[Math.floor(Math.random() * DEMON_IDS.length)];
  const demonDef = getCard(demonId);
  state.demon = {
    instanceId: randomUUID(),
    cardId: demonId,
    hp: demonDef.hp ?? 20,
    maxHp: demonDef.hp ?? 20,
    attack: demonDef.attack ?? 2,
    revealed: false,
    isImp: false,
  };
  state.demonRevealed = false;

  const actionCards = Object.entries(ACTION_DECK_COUNTS).flatMap(([id, copies]) =>
    Array.from({ length: copies }, () => makeInstance(id))
  );
  state.actionDeck = shuffle(actionCards);
  state.eventDeck = shuffle(EVENT_DECK_IDS.map((id) => makeInstance(id)));

  const dncIds = shuffle([...Object.keys(DNC)]);
  state.dncDeck = dncIds;

  const startingHand =
    state.playerCount <= 2 ? 5 : state.playerCount === 3 ? 4 : 3;
  for (const player of state.players) {
    drawForPlayer(state, player, startingHand);
  }

  state.started = true;
  state.cycle = 1;
  state.introAcknowledged = false;
  beginCycle(state);
  log(state, `Game started. Save ${possessed.name}!`);
}

function beginCycle(state: GameState): void {
  resetCycleModifiers(state);
  state.prayerUsedThisPhase = new Set();
  state.declinedAiPlayIds = new Set();
  if (state.dncDeck.length === 0) {
    endGameLoss(state);
    return;
  }
  const dncId = state.dncDeck.shift()!;
  state.currentDncId = dncId;
  const dnc = DNC[dncId];
  state.presentationHold = null;
  for (const p of state.players) {
    p.restVote = null;
    p.usedPhaseAction = false;
  }
  state.restPollClosed = false;
  log(state, `Diurnal Cycle ${state.cycle} begins (${dnc.name}).`);
  enterDncPhase(state, 0);
}

function resolveAiRerollQueue(state: GameState): void {
  let safety = 12;
  while (safety-- > 0 && hasPendingReroll(state) && !state.pendingChoice) {
    const awaitingId = state.pendingRerollPrompt?.awaitingPlayerId;
    if (!awaitingId) break;
    const awaiting = state.players.find((p) => p.id === awaitingId);
    if (!awaiting || awaiting.isHuman) break;
    const human = state.players.find((p) => p.isHuman);
    if (!human) break;
    try {
      declineReroll(state, human.id);
    } catch {
      break;
    }
  }
}

export function processAi(state: GameState): void {
  if (state.phase === "game_over") return;
  if (state.pendingAiPlay) return;
  if (state.presentationHold) return;

  resolveAiRerollQueue(state);

  if (hasPendingReroll(state)) return;
  runAiTurns(state, (playerId, action) => {
    try {
      applyActionInternal(state, playerId, action);
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`AI action failed for ${playerId}:`, (err as Error).message);
      }
    }
  });
  if (state.pendingAiPlay) return;
  if (!state.introAcknowledged && state.cycle === 1) return;
  resolveAiDrawChoices(state);
  tryAdvanceFromDrawPhase(state);
  maybeAdvancePhase(state);
}

function prepareRosterForStart(state: GameState): void {
  const connectedHumans = state.players
    .filter((p) => p.isHuman && p.isConnected)
    .sort((a, b) => a.slot - b.slot);
  if (connectedHumans.length === 0) {
    throw new Error("No player joined");
  }
  const playerCount = Math.max(1, Math.min(4, connectedHumans.length));
  state.playerCount = playerCount;
  state.players = connectedHumans.slice(0, playerCount).map((p, i) => ({
    ...p,
    slot: i,
  }));
}

function applyActionInternal(state: GameState, playerId: string, action: GameAction): void {
  switch (action.type) {
    case "SET_LOBBY_POSSESSED": {
      if (state.started) throw new Error("Game already started");
      const player = state.players.find((p) => p.id === playerId);
      if (!player?.isHuman || player.slot !== 0) {
        throw new Error("Only Player 1 can choose Possessed");
      }
      state.lobbyPossessedId = action.possessedId;
      return;
    }
    case "START_GAME":
      if (state.mode === "solo") {
        if (state.players.length === 0) {
          setupPlayers(state, action.playerCount, 0);
        } else {
          state.playerCount = action.playerCount;
          state.players = state.players.slice(0, action.playerCount);
          for (const p of state.players) {
            if (!p.isHuman) {
              p.name = `AI ${p.slot + 1}`;
              p.isConnected = true;
            }
          }
        }
      } else if (state.players.length === 0) {
        setupPlayers(state, action.playerCount, 0);
      } else {
        prepareRosterForStart(state);
      }
      const possessedId = action.possessedId || state.lobbyPossessedId;
      if (!possessedId) throw new Error("Player 1 must choose Possessed");
      startGame(state, possessedId);
      return;
    case "CHOOSE_DRAW":
      handleDrawChoice(state, playerId, action.choice);
      break;
    case "PLAY_CARD": {
      state.pendingChoice =
        startPlayCard({
          state,
          playerId,
          cardInstanceId: action.cardInstanceId,
          targetId: action.targetId,
        }) ?? null;
      stampSoloController(state);
      if (action.pickOptionId && state.pendingChoice?.kind === "pick_one") {
        resolvePickOne(state, playerId, action.pickOptionId);
        stampSoloController(state);
      }
      if (action.pickOptionId && state.pendingChoice?.kind === "pick_one") {
        state.pendingChoice = null;
      }
      break;
    }
    case "PLAY_TEAM_CARD":
      handlePlayTeamCard(
        state,
        playerId,
        action.ownerPlayerId,
        action.cardInstanceId,
        action.targetId,
        action.pickOptionId
      );
      break;
    case "CONFIRM_AI_PLAY":
      handleConfirmAiPlay(state, playerId);
      break;
    case "SKIP_AI_PLAY":
      handleSkipAiPlay(state, playerId);
      break;
    case "REST_VOTE":
      handleRestVote(state, playerId, action.vote);
      break;
    case "ADVANCE_PHASE":
      advancePhase(state);
      break;
    case "RESOLVE_PICK_ONE": {
      const ownerId = assertPendingController(state, playerId);
      const kind = state.pendingChoice?.kind;
      if (kind === "donut_bandit" || kind === "haunted_pizza" || kind === "event_pick_one") {
        resolveEventPickOne(state, ownerId, action.optionId, kind);
      } else if (kind === "pick_action_discard") {
        resolvePickActionDiscard(state, ownerId, action.optionId);
      } else {
        resolvePickOne(state, ownerId, action.optionId);
      }
      // Nested pending may have been set by resolvers before clear — preserve if still set.
      if (state.pendingChoice?.kind === kind) {
        state.pendingChoice = null;
      }
      stampSoloController(state);
      break;
    }
    case "SELECT_TARGET": {
      const ownerId = assertPendingController(state, playerId);
      resolveTarget(state, ownerId, action.targetId, state.pendingChoice?.amount ?? 1);
      state.pendingChoice = null;
      stampSoloController(state);
      break;
    }
    case "DISCARD_CARDS": {
      const ownerId = assertPendingController(state, playerId);
      if (hasPendingReroll(state) && state.pendingChoice?.kind === "discard_cards") {
        completeRerollAfterDiscard(state, ownerId, action.cardInstanceIds);
        state.pendingChoice = null;
      } else {
        resolveDiscardEffect(state, ownerId, action.cardInstanceIds);
        if (state.pendingChoice?.kind === "discard_cards") {
          state.pendingChoice = null;
        }
      }
      stampSoloController(state);
      break;
    }
    case "DISTRIBUTE_ENERGY":
      assertPendingController(state, playerId);
      resolveEnergyDistribution(state, action.distribution);
      state.pendingChoice = null;
      break;
    case "ROLL_DICE":
      handleTriggerRoll(state, playerId);
      break;
    case "ACK_PRESENTATION":
      handleAckPresentation(state, playerId);
      break;
    case "ACK_GAME_INTRO":
      handleAckGameIntro(state, playerId);
      break;
    case "ACCEPT_REROLL":
      acceptReroll(state, playerId);
      break;
    case "DECLINE_REROLL":
      declineReroll(state, playerId);
      break;
    case "USE_LIGHTHOUSE":
      handleUseLighthouse(state, playerId, action.discardInstanceId);
      break;
    default:
      break;
  }
  maybeAdvanceAfterDeferredEventRoll(state);
  resolveAiRerollQueue(state);
  maybeAdvancePhase(state);
}

function maybeAdvanceAfterDeferredEventRoll(state: GameState): void {
  if (!state.pendingPostTriggerAdvance) return;
  if (hasPendingReroll(state)) return;
  if (state.pendingChoice) return;
  state.pendingPostTriggerAdvance = false;
  state.lastDiceRoll = null;
  if (finishDncCyclePhases(state)) {
    endCycleOrContinue(state);
  } else {
    advanceDncPhase(state);
  }
}

function advanceAfterTriggerRoll(state: GameState): void {
  state.lastDiceRoll = null;
  if (finishDncCyclePhases(state)) {
    endCycleOrContinue(state);
  } else {
    advanceDncPhase(state);
  }
}

function maybeAdvancePhase(_state: GameState): void {
  // Day/night end only via explicit ADVANCE_PHASE so instants remain playable at 0 actions.
}

function handleUseLighthouse(state: GameState, playerId: string, discardInstanceId: string): void {
  if (state.phase !== "manifest" || state.presentationHold?.at !== "manifest") {
    throw new Error("Lighthouse can only be used during manifest");
  }
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error("Player not found");
  const hasLighthouse = player.persistentCards.some((c) => getCard(c.cardId).effectId === "lighthouse");
  if (!hasLighthouse) throw new Error("No Lighthouse in play");
  const discard = player.hand.find((c) => c.instanceId === discardInstanceId);
  if (!discard) throw new Error("Card not in hand");
  player.hand = player.hand.filter((c) => c.instanceId !== discardInstanceId);
  state.actionDiscard.push(discard);
  state.modifiers.manifestDamageBlock += 1;
  log(state, `${player.name} uses Lighthouse to block 1 manifest damage.`);
  state.presentationHold = { at: "manifest", preview: computeManifestPreview(state) };
}

export function applyAction(state: GameState, playerId: string, action: GameAction): void {
  if (state.phase === "game_over") return;
  const isIntroAck = action.type === "ACK_GAME_INTRO";
  if (
    state.presentationHold &&
    action.type !== "ACK_PRESENTATION" &&
    action.type !== "USE_LIGHTHOUSE" &&
    !isIntroAck
  ) {
    throw new Error("Finish presentation first");
  }
  if (
    state.pendingAiPlay &&
    action.type !== "CONFIRM_AI_PLAY" &&
    action.type !== "SKIP_AI_PLAY" &&
    !isIntroAck
  ) {
    throw new Error("Resolve AI play first");
  }
  if (
    state.pendingChoice &&
    action.type !== "RESOLVE_PICK_ONE" &&
    action.type !== "SELECT_TARGET" &&
    action.type !== "DISCARD_CARDS" &&
    action.type !== "DISTRIBUTE_ENERGY" &&
    action.type !== "RULE_BOOK_TRANSFER" &&
    !isIntroAck
  ) {
    throw new Error("Resolve pending choice first");
  }
  if (
    hasPendingReroll(state) &&
    action.type !== "ACCEPT_REROLL" &&
    action.type !== "DECLINE_REROLL" &&
    action.type !== "DISCARD_CARDS" &&
    !isIntroAck
  ) {
    throw new Error("Resolve reroll offer first");
  }
  applyActionInternal(state, playerId, action);
  stampSoloController(state);
  processAi(state);
}

function applyPlayerDrawChoice(state: GameState, playerId: string, choice: DrawChoice): void {
  if (state.phase !== "draw") throw new Error("Not draw phase");
  if (!state.introAcknowledged && state.cycle === 1) throw new Error("Finish intro first");
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.drawChoice !== null) throw new Error("Already chose draw");

  const times = state.modifiers.doubleDrawPhase ? 2 : 1;
  state.modifiers.doubleDrawPhase = false;
  for (let t = 0; t < times; t++) {
    if (choice === "card_and_energy") {
      drawForPlayer(state, player, 1);
      gainEnergy(player, 1, state);
      log(state, `${player.name} draws 1 card and gains 1 energy.`);
    } else {
      gainFriendship(player, 1);
      log(state, `${player.name} gains 1 friendship.`);
    }
  }
  player.drawChoice = choice;

  if (player.isHuman) {
    state.presentationHold = { at: "post_draw", choice, playerId };
  }
}

function resolveAiDrawChoices(state: GameState): void {
  if (state.phase !== "draw") return;
  for (const player of state.players) {
    if (player.isHuman || player.drawChoice !== null) continue;
    try {
      applyPlayerDrawChoice(state, player.id, pickAiDrawChoice(player));
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`AI draw choice failed for ${player.name}:`, (err as Error).message);
      }
    }
  }
}

function tryAdvanceFromDrawPhase(state: GameState): void {
  if (state.phase !== "draw") return;
  if (!state.players.every((p) => p.drawChoice !== null)) return;
  if (state.presentationHold) return;

  log(state, "Draw phase complete.");
  if (finishDncCyclePhases(state)) {
    endCycleOrContinue(state);
  } else {
    advanceDncPhase(state);
  }
}

function handleAckGameIntro(state: GameState, playerId: string): void {
  const human = state.players.find((p) => p.id === playerId);
  if (!human?.isHuman) throw new Error("Only human can acknowledge intro");
  if (state.introAcknowledged) return;
  state.introAcknowledged = true;
}

function handleAckPresentation(state: GameState, playerId: string): void {
  const human = state.players.find((p) => p.id === playerId);
  if (!human?.isHuman) throw new Error("Only human can acknowledge presentation");
  const hold = state.presentationHold;
  if (!hold) return;

  if (hold.at === "manifest") {
    state.presentationHold = null;
    applyManifest(state);
    if (state.winner !== null) return;
    if (finishDncCyclePhases(state)) {
      endCycleOrContinue(state);
    } else {
      advanceDncPhase(state);
    }
    return;
  }

  if (hold.at === "post_trigger_roll") {
    resolveTriggerRollOutcome(state, playerId, hold);
    state.presentationHold = null;
    if (state.pendingChoice) {
      state.pendingPostTriggerAdvance = true;
    } else if (!state.pendingPostTriggerAdvance) {
      advanceAfterTriggerRoll(state);
    }
    return;
  }

  if (hold.at === "post_event_roll") {
    resumeCardRollEffect(state, {
      effectId: hold.effectId,
      playerId: hold.playerId,
    });
    state.presentationHold = null;
    maybeAdvanceAfterDeferredEventRoll(state);
    return;
  }

  if (hold.at === "post_draw") {
    state.presentationHold = null;
    tryAdvanceFromDrawPhase(state);
    return;
  }

  if (hold.at === "post_rest") {
    state.presentationHold = null;
    advancePhase(state);
  }
}

function resolveTriggerRollOutcome(
  state: GameState,
  playerId: string,
  hold: Extract<PresentationHold, { at: "post_trigger_roll" }>
): void {
  if (hold.outcome === "trigger") {
    applyPossessedTrigger(state, playerId);
    for (const imp of state.imps) {
      if (getCard(imp.cardId).effectId === "imp_impulsive") {
        state.possessedHp = Math.max(0, state.possessedHp - 1);
        log(state, "Impulsive Imp deals 1 damage.");
      }
    }
  } else if (hold.outcome === "event") {
    const deferred = drawEventCard(state, playerId);
    if (deferred && state.pendingCardRollResume) {
      state.pendingPostTriggerAdvance = true;
      beginDiceRoll(state, playerId, "event_effect", state.pendingCardRollResume);
    }
  }
}

function handleDrawChoice(state: GameState, playerId: string, choice: DrawChoice): void {
  applyPlayerDrawChoice(state, playerId, choice);
  resolveAiDrawChoices(state);
  tryAdvanceFromDrawPhase(state);
}

function stampSoloController(state: GameState): void {
  const pending = state.pendingChoice;
  if (!pending || state.mode !== "solo") return;
  const owner = state.players.find((p) => p.id === pending.playerId);
  if (!owner || owner.isHuman) return;
  const human = state.players.find((p) => p.isHuman);
  if (!human) return;
  pending.controllerPlayerId = human.id;
}

function assertPendingController(state: GameState, actorId: string): string {
  const pending = state.pendingChoice;
  if (!pending) throw new Error("No pending choice");
  const controllerId = pendingControllerId(state);
  if (controllerId !== actorId) throw new Error("Not your choice to resolve");
  return pending.playerId;
}

function handlePlayTeamCard(
  state: GameState,
  humanPlayerId: string,
  ownerPlayerId: string,
  cardInstanceId: string,
  targetId?: string,
  pickOptionId?: string
): void {
  const human = state.players.find((p) => p.id === humanPlayerId);
  if (!human?.isHuman) throw new Error("Only human can play teammate cards");
  if (state.mode !== "solo") throw new Error("Team card play is solo-only");
  if (state.phase !== "day" && state.phase !== "night") {
    throw new Error("Cannot play cards during this phase");
  }
  if (state.pendingChoice) throw new Error("Resolve pending choice first");
  if (state.presentationHold) throw new Error("Finish presentation first");

  const owner = state.players.find((p) => p.id === ownerPlayerId);
  if (!owner) throw new Error("Player not found");
  if (!canPlayTeamCard(state, owner, cardInstanceId)) {
    throw new Error("Cannot play that teammate card right now");
  }

  state.pendingChoice =
    startPlayCard({
      state,
      playerId: ownerPlayerId,
      cardInstanceId,
      targetId,
    }) ?? null;
  stampSoloController(state);

  if (pickOptionId && state.pendingChoice?.kind === "pick_one") {
    resolvePickOne(state, ownerPlayerId, pickOptionId);
    stampSoloController(state);
  }
  if (pickOptionId && state.pendingChoice?.kind === "pick_one") {
    state.pendingChoice = null;
  }
}

function handleConfirmAiPlay(state: GameState, playerId: string): void {
  if (!state.pendingAiPlay) throw new Error("No AI play pending");
  const human = state.players.find((p) => p.id === playerId);
  if (!human?.isHuman) throw new Error("Only human can confirm AI play");

  const pending = state.pendingAiPlay;
  state.pendingAiPlay = null;
  state.pendingChoice =
    startPlayCard({
      state,
      playerId: pending.playerId,
      cardInstanceId: pending.cardInstanceId,
    }) ?? null;
  stampSoloController(state);
}

function handleSkipAiPlay(state: GameState, playerId: string): void {
  if (!state.pendingAiPlay) throw new Error("No AI play pending");
  const human = state.players.find((p) => p.id === playerId);
  if (!human?.isHuman) throw new Error("Only human can skip AI play");

  state.declinedAiPlayIds.add(state.pendingAiPlay.cardInstanceId);
  log(state, `${state.pendingAiPlay.playerName}'s play was declined.`);
  state.pendingAiPlay = null;
}

function applySlothAfterRest(state: GameState): void {
  if (state.demon && getCard(state.demon.cardId).effectId === "demon_sloth") {
    state.modifiers.slothTripleAttack = true;
    log(state, "Sloth triples attack after Rest.");
  }
}

function applyGroupRestRewards(state: GameState): "draw" | "energy" {
  if (state.phase === "day") {
    for (const p of state.players) drawForPlayer(state, p, 1);
    log(state, "Group Rest: each player draws 1 card.");
    return "draw";
  }
  for (const p of state.players) gainEnergy(p, 1, state);
  log(state, "Group Rest: each player gains 1 energy.");
  return "energy";
}

function handleRestVote(state: GameState, playerId: string, vote: boolean): void {
  if (state.phase !== "day" && state.phase !== "night") {
    throw new Error("Cannot vote rest now");
  }
  if (!vote) throw new Error("Only Rest votes are supported");
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return;
  if (player.restVote !== null) throw new Error("Already voted");
  if (!canVoteRest(state, player)) throw new Error("Cannot vote rest now");

  player.restVote = true;
  log(state, `${player.name} votes to Rest.`);

  // Solo: one human Rest rests the whole table, then present draws before advancing.
  if (state.mode === "solo") {
    for (const p of state.players) p.restVote = true;
    const reward = applyGroupRestRewards(state);
    applySlothAfterRest(state);
    if (reward === "draw") {
      state.presentationHold = { at: "post_rest", reward: "draw" };
    } else {
      advancePhase(state);
    }
    return;
  }

  // 2-player multi: personal Rest reward immediately; phase does not advance.
  if (state.playerCount === 2) {
    if (state.phase === "day") {
      drawForPlayer(state, player, 1);
      log(state, `${player.name} Rests and draws 1 card.`);
      if (player.isHuman) {
        state.presentationHold = {
          at: "post_draw",
          choice: "card_and_energy",
          playerId: player.id,
        };
      }
    } else {
      gainEnergy(player, 1, state);
      log(state, `${player.name} Rests and gains 1 energy.`);
    }
    return;
  }

  // 3–4 player multi: wait for unanimous Rest among eligible players.
  const eligible = restEligiblePlayers(state);
  if (eligible.length > 0 && eligible.every((p) => p.restVote === true)) {
    const reward = applyGroupRestRewards(state);
    applySlothAfterRest(state);
    if (reward === "draw") {
      state.presentationHold = { at: "post_rest", reward: "draw" };
    } else {
      advancePhase(state);
    }
  }
}

function handleTriggerRoll(state: GameState, playerId: string): void {
  if (state.phase !== "triggers") return;
  if (state.presentationHold || hasPendingReroll(state)) return;
  beginDiceRoll(state, playerId, "trigger");
}

function advancePhase(state: GameState): void {
  if (finishDncCyclePhases(state)) {
    endCycleOrContinue(state);
  } else {
    advanceDncPhase(state);
  }
}

function endCycleOrContinue(state: GameState): void {
  if (state.phase === "game_over") return;
  if (state.cycle >= state.maxCycles && state.winner === null) {
    endGameLoss(state);
    return;
  }
  if (state.cycle >= state.maxCycles) return;
  state.cycle++;
  beginCycle(state);
}

function endGameLoss(state: GameState): void {
  state.winner = "demons";
  state.phase = "game_over";
  log(state, "Time has run out. The contract holds.");
}

export function toPublicState(state: GameState): PublicGameState {
  return {
    id: state.id,
    mode: state.mode,
    playerCount: state.playerCount,
    cycle: state.cycle,
    maxCycles: state.maxCycles,
    phase: state.phase,
    currentDncId: state.currentDncId,
    dncPhaseIndex: state.dncPhaseIndex,
    dayActionsRemaining: state.dayActionsRemaining,
    nightActionsRemaining: state.nightActionsRemaining,
    possessedId: state.possessedId,
    possessedHp: state.possessedHp,
    possessedMaxHp: state.possessedMaxHp,
    possessedBaseHp: state.possessedBaseHp,
    demon: state.demon,
    imps: state.imps,
    players: state.players.map((p) => ({
      id: p.id,
      slot: p.slot,
      name: p.name,
      isHuman: p.isHuman,
      isConnected: p.isConnected,
      energy: p.energy,
      friendship: p.friendship,
      handCount: p.hand.length,
      persistentCount: p.persistentCards.length,
      persistentCards: p.persistentCards.map((c) => ({ instanceId: c.instanceId, cardId: c.cardId })),
      restVote: p.restVote,
      drawChoice: p.drawChoice,
      usedPhaseAction: p.usedPhaseAction,
    })),
    actionDeckCount: state.actionDeck.length,
    actionDiscardCount: state.actionDiscard.length,
    actionDiscard: state.actionDiscard,
    eventDeckCount: state.eventDeck.length,
    eventDiscardCount: state.eventDiscard.length,
    demonRevealed: state.demonRevealed,
    modifiers: state.modifiers,
    pendingChoice: state.pendingChoice,
    pendingAiPlay: state.pendingAiPlay,
    lastDiceRoll: state.lastDiceRoll,
    winner: state.winner,
    log: state.log.slice(-30),
    started: state.started,
    restPollClosed: state.restPollClosed,
    presentationHold: state.presentationHold,
    introAcknowledged: state.introAcknowledged,
    currentDncDayTotal: state.currentDncId ? (DNC[state.currentDncId]?.dayActions ?? 0) : 0,
    currentDncNightTotal: state.currentDncId ? (DNC[state.currentDncId]?.nightActions ?? 0) : 0,
    currentDncPhases: getDncPhases(state) as DncCyclePhase[],
    currentDncPhaseWeights: getDncPhaseWeights(state),
    pendingRerollPrompt: state.pendingRerollPrompt,
    lobbyPossessedId: state.lobbyPossessedId,
    connectedHumanCount: state.players.filter((p) => p.isHuman && p.isConnected).length,
  };
}

export function toPrivateState(state: GameState, playerId: string): PrivateGameState {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error("Player not found");
  return {
    hand: player.hand,
    persistentCards: player.persistentCards,
    firstAidKit: player.firstAidKit,
    legalActions: getLegalActions(state, player),
    teamHands: state.players.map((p) => ({
      playerId: p.id,
      name: p.name,
      isHuman: p.isHuman,
      hand: p.hand,
    })),
  };
}

export { meetsFriendshipRequirement, getPossessedRequirement };
