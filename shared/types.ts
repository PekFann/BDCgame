export type CardType =
  | "action"
  | "instant"
  | "persistent_action"
  | "demon"
  | "event"
  | "triggered_reaction"
  | "dnc"
  | "cover";

export interface CardDefinition {
  id: string;
  name: string;
  deck: string;
  type: CardType;
  file: string;
  copies?: number;
  energyCost?: number;
  friendshipCost?: number;
  requiresFriendship?: boolean;
  cycleIcon?: boolean;
  instant?: boolean;
  persistent?: boolean;
  hp?: number;
  attack?: number;
  friendshipRequirement?: number;
  effectId: string;
  effect: string;
}

export type DncCyclePhase = "draw" | "manifest" | "day" | "night" | "triggers";

export interface DncDefinition {
  id: string;
  name: string;
  file: string;
  dayActions: number;
  nightActions: number;
  triggerDice: number[];
  eventDice: number[];
  phases: DncCyclePhase[];
  /** Relative vertical band heights (top→bottom), same order as `phases`. */
  phaseBandWeights?: number[];
}

export type Phase =
  | "setup"
  | "draw"
  | "manifest"
  | "day"
  | "night"
  | "triggers"
  | "game_over";

export type DrawChoice = "card_and_energy" | "friendship";

export interface CardInstance {
  instanceId: string;
  cardId: string;
}

export interface DemonState {
  instanceId: string;
  cardId: string;
  hp: number;
  maxHp: number;
  attack: number;
  revealed: boolean;
  isImp: boolean;
}

export interface PlayerState {
  id: string;
  slot: number;
  name: string;
  isHuman: boolean;
  isConnected: boolean;
  energy: number;
  friendship: number;
  hand: CardInstance[];
  persistentCards: CardInstance[];
  firstAidKit: boolean;
  restVote: boolean | null;
  drawChoice: DrawChoice | null;
  drawChoicesThisPhase: number;
  usedPhaseAction: boolean;
}

export interface PendingChoice {
  kind:
    | "pick_one"
    | "select_target"
    | "discard_cards"
    | "distribute_energy"
    | "rule_book"
    | "talk_it_out"
    | "event_pick_one"
    | "donut_bandit"
    | "haunted_pizza"
    | "pick_action_discard";
  /** Effect/card owner — pays costs and receives effects. */
  playerId: string;
  /** Who may resolve this choice; defaults to playerId. */
  controllerPlayerId?: string;
  cardInstanceId?: string;
  cardId?: string;
  options?: { id: string; label: string }[];
  minDiscard?: number;
  maxDiscard?: number;
  amount?: number;
  targets?: string[];
}

export interface PendingAiPlay {
  playerId: string;
  playerName: string;
  cardInstanceId: string;
  cardId: string;
}

export interface ManifestPreview {
  totalDamage: number;
  hpBefore: number;
  sources: { name: string; damage: number }[];
  skipped: boolean;
}

export type TriggerOutcome = "trigger" | "neutral" | "event";

export interface PendingRerollPrompt {
  roll: number;
  rollerId: string;
  context: "trigger" | "card" | "event_effect";
  queue: { playerId: string; isHuman: boolean; name: string }[];
  queueIndex: number;
  awaitingPlayerId: string | null;
}

export interface PendingCardRollResume {
  effectId: string;
  playerId: string;
  cardInstanceId?: string;
  targetId?: string;
}

export type PresentationHold =
  | { at: "post_draw"; choice: DrawChoice; playerId?: string }
  | { at: "post_rest"; reward: "draw" | "energy" }
  | { at: "manifest"; preview: ManifestPreview }
  | { at: "post_trigger_roll"; roll: number; outcome: TriggerOutcome; eventCardId?: string }
  | { at: "post_event_roll"; roll: number; effectId: string; playerId: string };

export interface GameModifiers {
  maxHandSize: number;
  maxEnergy: number;
  skipManifest: boolean;
  manifestDamageBlock: number;
  doubleDrawPhase: boolean;
  actionEnergyPenalty: number;
  caringGiftsBlocked: boolean;
  prayerBlocked: boolean;
  healingBlocked: boolean;
  handSizeReductionUntilCycle: number | null;
  energyCapUntilCycle: number | null;
  rageDoubleAttack: boolean;
  prideDoubleAttack: boolean;
  slothTripleAttack: boolean;
  noHealAtNight: boolean;
  overdramaticEyeRoll: boolean;
}

export interface GameState {
  id: string;
  mode: "solo" | "multi";
  playerCount: number;
  cycle: number;
  maxCycles: number;
  phase: Phase;
  dncDeck: string[];
  currentDncId: string | null;
  dncPhaseIndex: number;
  dayActionsRemaining: number;
  nightActionsRemaining: number;
  possessedId: string;
  possessedHp: number;
  possessedMaxHp: number;
  possessedBaseHp: number;
  demon: DemonState | null;
  imps: DemonState[];
  players: PlayerState[];
  actionDeck: CardInstance[];
  actionDiscard: CardInstance[];
  eventDeck: CardInstance[];
  eventDiscard: CardInstance[];
  demonRevealed: boolean;
  modifiers: GameModifiers;
  pendingChoice: PendingChoice | null;
  pendingAiPlay: PendingAiPlay | null;
  lastDiceRoll: number | null;
  diceRollerId: string | null;
  winner: "players" | "demons" | null;
  log: string[];
  hostId: string | null;
  started: boolean;
  prayerUsedThisPhase: Set<string>;
  restPollClosed: boolean;
  declinedAiPlayIds: Set<string>;
  presentationHold: PresentationHold | null;
  introAcknowledged: boolean;
  pendingRerollPrompt: PendingRerollPrompt | null;
  pendingCardRollResume: PendingCardRollResume | null;
  pendingPostTriggerAdvance: boolean;
  pendingRerollTimeTravelId: string | null;
  lobbyPossessedId: string | null;
}

export interface PublicPlayerState {
  id: string;
  slot: number;
  name: string;
  isHuman: boolean;
  isConnected: boolean;
  energy: number;
  friendship: number;
  handCount: number;
  persistentCount: number;
  persistentCards: CardInstance[];
  restVote: boolean | null;
  drawChoice: DrawChoice | null;
  usedPhaseAction: boolean;
}

export interface PublicGameState {
  id: string;
  mode: "solo" | "multi";
  playerCount: number;
  cycle: number;
  maxCycles: number;
  phase: Phase;
  currentDncId: string | null;
  dncPhaseIndex: number;
  dayActionsRemaining: number;
  nightActionsRemaining: number;
  possessedId: string;
  possessedHp: number;
  possessedMaxHp: number;
  possessedBaseHp: number;
  demon: DemonState | null;
  imps: DemonState[];
  players: PublicPlayerState[];
  actionDeckCount: number;
  actionDiscardCount: number;
  actionDiscard: CardInstance[];
  eventDeckCount: number;
  eventDiscardCount: number;
  demonRevealed: boolean;
  modifiers: GameModifiers;
  pendingChoice: PendingChoice | null;
  pendingAiPlay: PendingAiPlay | null;
  lastDiceRoll: number | null;
  winner: "players" | "demons" | null;
  log: string[];
  started: boolean;
  restPollClosed: boolean;
  presentationHold: PresentationHold | null;
  introAcknowledged: boolean;
  currentDncDayTotal: number;
  currentDncNightTotal: number;
  currentDncPhases: DncCyclePhase[];
  currentDncPhaseWeights: number[];
  pendingRerollPrompt: PendingRerollPrompt | null;
  lobbyPossessedId: string | null;
  connectedHumanCount: number;
}

export interface TeamHandView {
  playerId: string;
  name: string;
  isHuman: boolean;
  hand: CardInstance[];
}

export interface PrivateGameState {
  hand: CardInstance[];
  persistentCards: CardInstance[];
  firstAidKit: boolean;
  legalActions: GameAction[];
  teamHands: TeamHandView[];
}

export type GameAction =
  | { type: "START_GAME"; possessedId: string; playerCount: number }
  | { type: "SET_LOBBY_POSSESSED"; possessedId: string }
  | { type: "CHOOSE_DRAW"; choice: DrawChoice }
  | { type: "PLAY_CARD"; cardInstanceId: string; targetId?: string; pickOptionId?: string }
  | {
      type: "PLAY_TEAM_CARD";
      ownerPlayerId: string;
      cardInstanceId: string;
      targetId?: string;
      pickOptionId?: string;
    }
  | { type: "REST_VOTE"; vote: boolean }
  | { type: "ADVANCE_PHASE" }
  | { type: "RESOLVE_PICK_ONE"; optionId: string }
  | { type: "SELECT_TARGET"; targetId: string }
  | { type: "DISCARD_CARDS"; cardInstanceIds: string[] }
  | { type: "DISTRIBUTE_ENERGY"; distribution: Record<string, number> }
  | { type: "RULE_BOOK_TRANSFER"; targetId: string; energy?: number; friendship?: number; cards?: string[] }
  | { type: "ROLL_DICE" }
  | { type: "CONFIRM_AI_PLAY" }
  | { type: "SKIP_AI_PLAY" }
  | { type: "ACK_PRESENTATION" }
  | { type: "ACK_GAME_INTRO" }
  | { type: "ACCEPT_REROLL" }
  | { type: "DECLINE_REROLL" }
  | { type: "USE_LIGHTHOUSE"; discardInstanceId: string };

export interface RoomInfo {
  id: string;
  slots: { slot: number; name: string | null; connected: boolean }[];
  started: boolean;
  joinUrls: Record<number, string>;
  tvUrl: string;
  hostUrl: string;
}

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}
