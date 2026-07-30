import type { DrawChoice, PublicGameState } from "../../shared/types.js";
import { playVfxSound } from "./audio.js";
import { DEFAULT_VFX_AUDIO } from "./vfx/types.js";
import { spawnBurst, burstDurationMs } from "./vfx/burst.js";
import { spawnFloater, spawnHtmlFloater } from "./vfx/floater.js";
import { ensureVfxLayer } from "./vfx/layer.js";
import {
  CARD_ICON_URL,
  ENERGY_ICON_URL,
  FRIENDSHIP_ICON_URL,
  getBurstEntry,
  getBurstPreset,
  getFloaterPreset,
} from "./vfx/presets.js";
import { pulseElement } from "./vfx/slot-fx.js";

export type FriendshipVfxMode = "solo" | "phone";

export const AI_DRAW_SEQUENCE_GAP_MS = 800;
/** Option IDs that grant friendship — snapshot before send so VFX detects the gain. */
export const FRIENDSHIP_GAIN_OPTION_IDS = new Set(["friendship", "friendship2", "friendship_all"]);

/** Card effectIds that grant friendship on direct PLAY_CARD (no pick-one). */
export const DIRECT_FRIENDSHIP_EFFECT_IDS = new Set(["good_old_days"]);

const DIRECT_FRIENDSHIP_AMOUNTS: Record<string, number> = {
  good_old_days: 3,
};

const prevFriendshipByPlayer = new Map<string, number>();
/** Baseline captured on action click per beneficiary player. */
const friendshipSnapshotByPlayer = new Map<string, number>();
/** Set on draw-phase friendship click; consumed on next scheduled check. */
let pendingDrawFriendshipGain: number | null = null;
/** Explicit card/event friendship gains pending VFX (playerId → amount). */
const pendingFriendshipGains = new Map<string, number>();
let scheduleGen = 0;
let teamScheduleGen = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isFriendshipGainOption(optionId: string): boolean {
  return FRIENDSHIP_GAIN_OPTION_IDS.has(optionId);
}

/** Friendship amount granted by a pick-one option id. */
export function friendshipGainAmountForOption(optionId: string): number {
  if (optionId === "friendship2") return 2;
  if (optionId === "friendship" || optionId === "friendship_all") return 1;
  return 0;
}

export function directFriendshipGainAmount(effectId: string): number {
  return DIRECT_FRIENDSHIP_AMOUNTS[effectId] ?? 0;
}

export function markPendingDrawFriendshipGain(amount = 1): void {
  pendingDrawFriendshipGain = amount;
}

export function markPendingFriendshipGain(playerId: string, amount: number): void {
  if (!playerId || amount <= 0) return;
  pendingFriendshipGains.set(playerId, (pendingFriendshipGains.get(playerId) ?? 0) + amount);
}

/** Snapshot + mark pending gain for a friendship pick-one option. */
export function prepareFriendshipGainOption(
  pub: PublicGameState,
  beneficiaryPlayerId: string,
  optionId: string
): void {
  if (!isFriendshipGainOption(optionId)) return;

  if (optionId === "friendship_all") {
    for (const player of pub.players) {
      snapshotFriendshipBeforeChoice(pub, player.id);
      markPendingFriendshipGain(player.id, 1);
    }
    return;
  }

  const amount = friendshipGainAmountForOption(optionId);
  snapshotFriendshipBeforeChoice(pub, beneficiaryPlayerId);
  markPendingFriendshipGain(beneficiaryPlayerId, amount);
}

export function resetFriendshipVfxTracking(): void {
  prevFriendshipByPlayer.clear();
  friendshipSnapshotByPlayer.clear();
  pendingFriendshipGains.clear();
  pendingDrawFriendshipGain = null;
  scheduleGen = 0;
  teamScheduleGen = 0;
}

export function ensureFriendshipBaseline(pub: PublicGameState, humanPlayerId: string): void {
  for (const player of pub.players) {
    if (!prevFriendshipByPlayer.has(player.id)) {
      prevFriendshipByPlayer.set(player.id, player.friendship);
    }
  }
  const human = pub.players.find((p) => p.id === humanPlayerId);
  if (human && !prevFriendshipByPlayer.has(humanPlayerId)) {
    prevFriendshipByPlayer.set(humanPlayerId, human.friendship);
  }
}

export function snapshotFriendshipBeforeChoice(pub: PublicGameState, playerId: string): void {
  const player = pub.players.find((p) => p.id === playerId);
  if (player) {
    friendshipSnapshotByPlayer.set(playerId, player.friendship);
    prevFriendshipByPlayer.set(playerId, player.friendship);
  }
}

/** @deprecated Use ensureFriendshipBaseline or snapshotFriendshipBeforeChoice */
export function syncFriendshipBaseline(pub: PublicGameState, humanPlayerId: string): void {
  ensureFriendshipBaseline(pub, humanPlayerId);
}

function resolveAnchorForPlayer(
  playerId: string,
  mode: FriendshipVfxMode,
  humanPlayerId: string
): { rect: DOMRect; element: HTMLElement | null } {
  let el: HTMLElement | null = null;
  if (mode === "solo") {
    if (playerId === humanPlayerId) {
      el = document.querySelector("#board .card-slot.possessed");
    } else {
      el = document.querySelector(
        `#board .player-roster-row[data-player-id="${playerId}"] .roster-stat[title='Friendship']`
      );
    }
  } else {
    el =
      document.querySelector("#mini-board .player-roster-row.is-human .roster-stat[title='Friendship']") ??
      document.querySelector("#mini-board .player-roster-row.is-human") ??
      document.getElementById("mini-board");
  }
  if (el) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { rect, element: el };
    }
    if (import.meta.env.DEV) {
      console.debug("[friendship-vfx] anchor zero-size, using viewport fallback", { playerId });
    }
  }
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.6;
  return { rect: new DOMRect(cx - 40, cy - 40, 80, 80), element: el };
}

function resolveRosterRowAnchor(playerId: string): { rect: DOMRect; element: HTMLElement | null } {
  const el = document.querySelector(
    `#board .player-roster-row[data-player-id="${playerId}"]`
  ) as HTMLElement | null;
  if (el) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { rect, element: el };
    }
  }
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.7;
  return { rect: new DOMRect(cx - 60, cy - 20, 120, 40), element: el };
}

function runFriendshipGainVfxForPlayer(
  amount: number,
  mode: FriendshipVfxMode,
  playerId: string,
  humanPlayerId: string,
  options?: { skipTextFloater?: boolean }
): void {
  if (amount <= 0) return;

  const burstEntry = getBurstEntry("friendship_burst");
  const burstPreset = burstEntry?.preset ?? getBurstPreset("friendship_burst");
  const floaterPreset = getFloaterPreset("friendship_floater");
  const audio = burstEntry?.audio ?? DEFAULT_VFX_AUDIO;
  playVfxSound(audio.soundId, audio.soundDelayMs);

  const layer = ensureVfxLayer();
  const { rect, element } = resolveAnchorForPlayer(playerId, mode, humanPlayerId);
  const isSoloAi = mode === "solo" && playerId !== humanPlayerId;

  if (mode === "solo" && element?.classList.contains("possessed")) {
    pulseElement(element, "possessed--friendship-hit", 600);
  } else if (mode === "solo" && element?.classList.contains("roster-stat")) {
    pulseElement(element, "roster-stat--friendship-hit", 600);
  }

  if (!options?.skipTextFloater) {
    spawnFloater(layer, rect, amount, floaterPreset);
  }

  spawnBurst(layer, rect, amount, burstPreset, { mode, soloAi: isSoloAi }, burstEntry?.composition);
}

/** @deprecated Use runFriendshipGainVfxForPlayer via team check helpers. */
export function runFriendshipGainVfx(amount: number, mode: FriendshipVfxMode): void {
  const humanRow = document.querySelector("#board .player-roster-row.is-human") as HTMLElement | null;
  const humanId = humanRow?.dataset.playerId ?? "";
  runFriendshipGainVfxForPlayer(amount, mode, humanId, humanId);
}

function drawChoiceFloaterMarkup(choice: DrawChoice): string {
  if (choice === "friendship") {
    return `<span class="draw-reward-float-part">+1 <img class="draw-reward-float-icon" src="${FRIENDSHIP_ICON_URL}" alt="Friendship" /></span>`;
  }
  return `
    <span class="draw-reward-float-part">+1 <img class="draw-reward-float-icon" src="${CARD_ICON_URL}" alt="Card" /></span>
    <span class="draw-reward-float-part">+1 <img class="draw-reward-float-icon" src="${ENERGY_ICON_URL}" alt="Energy" /></span>
  `;
}

export function showDrawChoiceFloater(
  playerId: string,
  choice: DrawChoice,
  humanPlayerId: string
): void {
  const layer = ensureVfxLayer();
  const { rect, element } = resolveRosterRowAnchor(playerId);

  if (choice === "friendship") {
    const friendshipStat =
      (element?.querySelector(".roster-stat[title='Friendship']") as HTMLElement | null) ??
      resolveAnchorForPlayer(playerId, "solo", humanPlayerId).element;
    if (friendshipStat?.classList.contains("roster-stat")) {
      pulseElement(friendshipStat, "roster-stat--friendship-hit", 600);
    }
    // Particles only — the draw-reward float carries the +1 text.
    runFriendshipGainVfxForPlayer(1, "solo", playerId, humanPlayerId, { skipTextFloater: true });
  }

  spawnHtmlFloater(layer, rect, drawChoiceFloaterMarkup(choice), getFloaterPreset("draw_reward_floater"));
}

/** Show each AI draw choice one-by-one, then resolve. */
export async function runAiDrawChoiceSequence(
  pub: PublicGameState,
  humanPlayerId: string
): Promise<void> {
  const ais = [...pub.players]
    .filter((p) => p.id !== humanPlayerId && !p.isHuman && p.drawChoice !== null)
    .sort((a, b) => a.slot - b.slot);

  for (const player of ais) {
    if (!player.drawChoice) continue;
    // Sync baseline so later team checks don't re-fire this gain.
    prevFriendshipByPlayer.set(player.id, player.friendship);
    showDrawChoiceFloater(player.id, player.drawChoice, humanPlayerId);
    await sleep(AI_DRAW_SEQUENCE_GAP_MS);
  }
}

function restRewardFloaterMarkup(reward: "draw" | "energy"): string {
  if (reward === "energy") {
    return `<span class="draw-reward-float-part">+1 <img class="draw-reward-float-icon" src="${ENERGY_ICON_URL}" alt="Energy" /></span>`;
  }
  return `<span class="draw-reward-float-part">+1 <img class="draw-reward-float-icon" src="${CARD_ICON_URL}" alt="Card" /></span>`;
}

export function showRestRewardFloater(
  playerId: string,
  reward: "draw" | "energy",
  _humanPlayerId: string
): void {
  const layer = ensureVfxLayer();
  const { rect, element } = resolveRosterRowAnchor(playerId);

  if (reward === "energy") {
    const energyStat =
      (element?.querySelector(".roster-stat[title='Energy']") as HTMLElement | null) ??
      (document.querySelector(
        `#board .player-roster-row[data-player-id="${playerId}"] .roster-stat[title='Energy']`
      ) as HTMLElement | null);
    if (energyStat) pulseElement(energyStat, "roster-stat--friendship-hit", 600);
  }

  spawnHtmlFloater(layer, rect, restRewardFloaterMarkup(reward), getFloaterPreset("rest_reward_floater"));
}

/** Show each player's Rest reward one-by-one (draw-phase floater style). */
export async function runRestRewardSequence(
  pub: PublicGameState,
  reward: "draw" | "energy",
  humanPlayerId: string,
  playerIds?: string[]
): Promise<void> {
  const ids =
    playerIds ??
    [...pub.players]
      .sort((a, b) => a.slot - b.slot)
      .map((p) => p.id);

  for (const playerId of ids) {
    if (!pub.players.some((p) => p.id === playerId)) continue;
    showRestRewardFloater(playerId, reward, humanPlayerId);
    await sleep(AI_DRAW_SEQUENCE_GAP_MS);
  }
}

function consumePendingCardGains(
  pub: PublicGameState,
  humanPlayerId: string,
  mode: FriendshipVfxMode,
  onlyHuman: boolean
): boolean {
  if (pendingFriendshipGains.size === 0) return false;

  const entries = [...pendingFriendshipGains.entries()];
  pendingFriendshipGains.clear();

  let fired = false;
  for (const [playerId, amount] of entries) {
    if (onlyHuman && playerId !== humanPlayerId) continue;
    if (!pub.players.some((p) => p.id === playerId)) continue;
    if (import.meta.env.DEV) {
      console.debug("[friendship-vfx] card pending", { playerId, amount });
    }
    runFriendshipGainVfxForPlayer(amount, mode, playerId, humanPlayerId);
    const player = pub.players.find((p) => p.id === playerId);
    if (player) prevFriendshipByPlayer.set(playerId, player.friendship);
    friendshipSnapshotByPlayer.delete(playerId);
    fired = true;
  }
  return fired;
}

export function checkTeamFriendshipGainVfx(
  pub: PublicGameState,
  humanPlayerId: string,
  mode: FriendshipVfxMode
): void {
  const human = pub.players.find((p) => p.id === humanPlayerId);
  if (!human) return;

  // During post_draw, the orchestrator owns AI presentation — only sync AI baselines.
  if (pub.presentationHold?.at === "post_draw") {
    if (pendingDrawFriendshipGain !== null) {
      const amount = pendingDrawFriendshipGain;
      pendingDrawFriendshipGain = null;
      runFriendshipGainVfxForPlayer(amount, mode, humanPlayerId, humanPlayerId);
      prevFriendshipByPlayer.set(humanPlayerId, human.friendship);
      friendshipSnapshotByPlayer.delete(humanPlayerId);
    } else if (consumePendingCardGains(pub, humanPlayerId, mode, true)) {
      // Card pending already advanced human baseline.
    } else {
      const prev = prevFriendshipByPlayer.get(humanPlayerId);
      const snapshot = friendshipSnapshotByPlayer.get(humanPlayerId);
      const baseline = snapshot ?? prev;
      const gained =
        baseline !== undefined && human.friendship > baseline ? human.friendship - baseline : 0;
      if (gained > 0) {
        runFriendshipGainVfxForPlayer(gained, mode, humanPlayerId, humanPlayerId);
      }
      prevFriendshipByPlayer.set(humanPlayerId, human.friendship);
      friendshipSnapshotByPlayer.delete(humanPlayerId);
    }
    for (const player of pub.players) {
      if (player.id !== humanPlayerId) {
        prevFriendshipByPlayer.set(player.id, player.friendship);
        friendshipSnapshotByPlayer.delete(player.id);
      }
    }
    pendingFriendshipGains.clear();
    return;
  }

  if (pendingDrawFriendshipGain !== null) {
    const amount = pendingDrawFriendshipGain;
    pendingDrawFriendshipGain = null;
    if (import.meta.env.DEV) {
      console.debug("[friendship-vfx] draw pending", { amount, current: human.friendship });
    }
    runFriendshipGainVfxForPlayer(amount, mode, humanPlayerId, humanPlayerId);
    prevFriendshipByPlayer.set(humanPlayerId, human.friendship);
    friendshipSnapshotByPlayer.delete(humanPlayerId);
    for (const player of pub.players) {
      if (player.id !== humanPlayerId) {
        prevFriendshipByPlayer.set(player.id, player.friendship);
        friendshipSnapshotByPlayer.delete(player.id);
      }
    }
    pendingFriendshipGains.clear();
    return;
  }

  if (consumePendingCardGains(pub, humanPlayerId, mode, false)) {
    // Advance all baselines so we don't double-fire from delta detection.
    for (const player of pub.players) {
      prevFriendshipByPlayer.set(player.id, player.friendship);
      friendshipSnapshotByPlayer.delete(player.id);
    }
    return;
  }

  for (const player of pub.players) {
    // AI friendship visuals come from pending marks or runAiDrawChoiceSequence — never raw delta
    // (AI draw resolves before the human's post_draw hold, which caused spurious day particles).
    if (player.id !== humanPlayerId) {
      prevFriendshipByPlayer.set(player.id, player.friendship);
      friendshipSnapshotByPlayer.delete(player.id);
      continue;
    }

    const prev = prevFriendshipByPlayer.get(player.id);
    const snapshot = friendshipSnapshotByPlayer.get(player.id);
    const baseline = snapshot ?? prev;
    const gained =
      baseline !== undefined && player.friendship > baseline ? player.friendship - baseline : 0;

    if (import.meta.env.DEV && gained > 0) {
      console.debug("[friendship-vfx]", {
        playerId: player.id,
        baseline,
        current: player.friendship,
        gained,
      });
    }

    if (gained > 0) {
      runFriendshipGainVfxForPlayer(gained, mode, player.id, humanPlayerId);
    }
    prevFriendshipByPlayer.set(player.id, player.friendship);
    friendshipSnapshotByPlayer.delete(player.id);
  }
}

export function checkFriendshipGainVfx(
  pub: PublicGameState,
  humanPlayerId: string,
  mode: FriendshipVfxMode
): void {
  if (mode === "solo") {
    checkTeamFriendshipGainVfx(pub, humanPlayerId, mode);
    return;
  }

  const human = pub.players.find((p) => p.id === humanPlayerId);
  if (!human) return;

  if (pendingDrawFriendshipGain !== null) {
    const amount = pendingDrawFriendshipGain;
    pendingDrawFriendshipGain = null;
    runFriendshipGainVfxForPlayer(amount, mode, humanPlayerId, humanPlayerId);
    prevFriendshipByPlayer.set(humanPlayerId, human.friendship);
    friendshipSnapshotByPlayer.delete(humanPlayerId);
    pendingFriendshipGains.delete(humanPlayerId);
    return;
  }

  if (consumePendingCardGains(pub, humanPlayerId, mode, true)) {
    return;
  }

  const prev = prevFriendshipByPlayer.get(humanPlayerId);
  const snapshot = friendshipSnapshotByPlayer.get(humanPlayerId);
  const baseline = snapshot ?? prev;
  const gained =
    baseline !== undefined && human.friendship > baseline ? human.friendship - baseline : 0;

  if (gained > 0) {
    runFriendshipGainVfxForPlayer(gained, mode, humanPlayerId, humanPlayerId);
  }

  prevFriendshipByPlayer.set(humanPlayerId, human.friendship);
  friendshipSnapshotByPlayer.delete(humanPlayerId);
}

export function waitForFriendshipVfxComplete(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, burstDurationMs(getBurstPreset("friendship_burst")) + 100);
  });
}

export function scheduleFriendshipGainVfx(
  getPub: () => PublicGameState | null | undefined,
  humanPlayerId: string,
  mode: FriendshipVfxMode
): void {
  const gen = ++scheduleGen;
  requestAnimationFrame(() => {
    if (gen !== scheduleGen) return;
    requestAnimationFrame(() => {
      if (gen !== scheduleGen) return;
      const pub = getPub();
      if (!pub) return;
      checkFriendshipGainVfx(pub, humanPlayerId, mode);
    });
  });
}

export function scheduleTeamFriendshipGainVfx(
  getPub: () => PublicGameState | null | undefined,
  humanPlayerId: string,
  mode: FriendshipVfxMode
): void {
  const gen = ++teamScheduleGen;
  requestAnimationFrame(() => {
    if (gen !== teamScheduleGen) return;
    requestAnimationFrame(() => {
      if (gen !== teamScheduleGen) return;
      const pub = getPub();
      if (!pub) return;
      checkTeamFriendshipGainVfx(pub, humanPlayerId, mode);
    });
  });
}
