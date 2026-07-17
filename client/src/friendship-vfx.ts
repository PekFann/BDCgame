// Phone + solo only — do not import from tv.ts.
import type { DrawChoice, PublicGameState } from "../../shared/types.js";
import { ENERGY_ICON, FRIENDSHIP_ICON } from "./ui-icons.js";

export type FriendshipVfxMode = "solo" | "phone";

const DURATION_MS = 550;
const BURST_STAGGER_MS = 60;
const DRAW_FLOATER_MS = 900;
const AI_DRAW_SEQUENCE_GAP_MS = 800;
const FRIENDSHIP_ICON_URL = encodeURI(FRIENDSHIP_ICON);
const ENERGY_ICON_URL = encodeURI(ENERGY_ICON);

/** Preload friendship icon so burst particles render immediately. */
new Image().src = FRIENDSHIP_ICON_URL;
new Image().src = ENERGY_ICON_URL;

/** Option IDs that grant friendship — snapshot before send so VFX detects the gain. */
export const FRIENDSHIP_GAIN_OPTION_IDS = new Set(["friendship", "friendship2", "friendship_all"]);

/** Card effectIds that grant friendship on direct PLAY_CARD (no pick-one). */
export const DIRECT_FRIENDSHIP_EFFECT_IDS = new Set(["good_old_days"]);

const prevFriendshipByPlayer = new Map<string, number>();
/** Baseline captured on human action (card/draw click); takes priority for that player. */
let friendshipSnapshotAtAction: number | null = null;
/** Set on draw-phase friendship click; consumed on next scheduled check. */
let pendingDrawFriendshipGain: number | null = null;
let scheduleGen = 0;
let teamScheduleGen = 0;
let vfxLayer: HTMLElement | null = null;

function ensureVfxLayer(): HTMLElement {
  if (vfxLayer) return vfxLayer;
  vfxLayer = document.createElement("div");
  vfxLayer.id = "friendship-vfx-layer";
  document.body.appendChild(vfxLayer);
  return vfxLayer;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isFriendshipGainOption(optionId: string): boolean {
  return FRIENDSHIP_GAIN_OPTION_IDS.has(optionId);
}

export function markPendingDrawFriendshipGain(amount = 1): void {
  pendingDrawFriendshipGain = amount;
}

export function resetFriendshipVfxTracking(): void {
  prevFriendshipByPlayer.clear();
  friendshipSnapshotAtAction = null;
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

export function snapshotFriendshipBeforeChoice(pub: PublicGameState, humanPlayerId: string): void {
  const human = pub.players.find((p) => p.id === humanPlayerId);
  if (human) {
    friendshipSnapshotAtAction = human.friendship;
    prevFriendshipByPlayer.set(humanPlayerId, human.friendship);
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

function spawnGainFloater(layer: HTMLElement, rect: DOMRect, amount: number): void {
  const el = document.createElement("span");
  el.className = "friendship-gain-float";
  el.textContent = `+${amount}`;
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top = `${rect.top + rect.height * 0.2}px`;
  layer.appendChild(el);
  requestAnimationFrame(() => el.classList.add("friendship-gain-float--active"));
  setTimeout(() => el.remove(), 950);
}

function pulsePossessed(element: HTMLElement): void {
  element.classList.remove("possessed--friendship-hit");
  void element.offsetWidth;
  element.classList.add("possessed--friendship-hit");
  setTimeout(() => element.classList.remove("possessed--friendship-hit"), 600);
}

function pulseRosterStat(element: HTMLElement): void {
  element.classList.remove("roster-stat--friendship-hit");
  void element.offsetWidth;
  element.classList.add("roster-stat--friendship-hit");
  setTimeout(() => element.classList.remove("roster-stat--friendship-hit"), 600);
}

function runFriendshipGainVfxForPlayer(
  amount: number,
  mode: FriendshipVfxMode,
  playerId: string,
  humanPlayerId: string,
  options?: { skipTextFloater?: boolean }
): void {
  if (amount <= 0) return;

  const layer = ensureVfxLayer();
  const { rect, element } = resolveAnchorForPlayer(playerId, mode, humanPlayerId);
  const count = Math.min(24, Math.max(8, amount * 6));
  const particles: HTMLElement[] = [];
  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height / 2;
  const isSoloAi = mode === "solo" && playerId !== humanPlayerId;
  const particleSize = isSoloAi ? 48 * 0.75 : mode === "solo" ? 48 : 36;

  if (mode === "solo" && element?.classList.contains("possessed")) {
    pulsePossessed(element);
  } else if (mode === "solo" && element?.classList.contains("roster-stat")) {
    pulseRosterStat(element);
  }

  if (!options?.skipTextFloater) {
    spawnGainFloater(layer, rect, amount);
  }

  for (let i = 0; i < count; i++) {
    const img = document.createElement("img");
    img.src = FRIENDSHIP_ICON_URL;
    img.alt = "";
    img.decoding = "async";
    img.loading = "eager";
    img.className = `friendship-particle friendship-particle--burst friendship-particle--${mode}`;
    img.style.width = `${particleSize}px`;
    img.style.height = `${particleSize}px`;
    img.style.left = `${originX}px`;
    img.style.top = `${originY}px`;
    const angle = Math.random() * Math.PI * 2;
    let distance = 120 + Math.random() * 160;
    if (isSoloAi) distance *= 0.5;
    img.style.setProperty("--burst-x", `${Math.cos(angle) * distance}px`);
    img.style.setProperty("--burst-y", `${Math.sin(angle) * distance}px`);
    img.style.animationDelay = `${Math.random() * BURST_STAGGER_MS}ms`;
    layer.appendChild(img);
    particles.push(img);
  }

  setTimeout(() => {
    for (const p of particles) p.remove();
  }, DURATION_MS + BURST_STAGGER_MS);
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
    <span class="draw-reward-float-part">+1 <span class="draw-reward-float-card" aria-hidden="true">🂠</span></span>
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
      pulseRosterStat(friendshipStat);
    }
    // Particles only — the draw-reward float carries the +1 text.
    runFriendshipGainVfxForPlayer(1, "solo", playerId, humanPlayerId, { skipTextFloater: true });
  }

  const el = document.createElement("div");
  el.className = "draw-reward-float";
  el.innerHTML = drawChoiceFloaterMarkup(choice);
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top = `${rect.top + rect.height * 0.55}px`;
  layer.appendChild(el);
  requestAnimationFrame(() => el.classList.add("draw-reward-float--active"));
  setTimeout(() => el.remove(), DRAW_FLOATER_MS + 50);
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
      friendshipSnapshotAtAction = null;
    } else {
      const prev = prevFriendshipByPlayer.get(humanPlayerId);
      const baseline = friendshipSnapshotAtAction ?? prev;
      const gained =
        baseline !== undefined && human.friendship > baseline ? human.friendship - baseline : 0;
      if (gained > 0) {
        runFriendshipGainVfxForPlayer(gained, mode, humanPlayerId, humanPlayerId);
      }
      prevFriendshipByPlayer.set(humanPlayerId, human.friendship);
      friendshipSnapshotAtAction = null;
    }
    for (const player of pub.players) {
      if (player.id !== humanPlayerId) {
        prevFriendshipByPlayer.set(player.id, player.friendship);
      }
    }
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
    friendshipSnapshotAtAction = null;
    for (const player of pub.players) {
      if (player.id !== humanPlayerId) {
        prevFriendshipByPlayer.set(player.id, player.friendship);
      }
    }
    return;
  }

  for (const player of pub.players) {
    const prev = prevFriendshipByPlayer.get(player.id);
    const baseline =
      player.id === humanPlayerId && friendshipSnapshotAtAction !== null
        ? friendshipSnapshotAtAction
        : prev;
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
  }

  friendshipSnapshotAtAction = null;
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
    friendshipSnapshotAtAction = null;
    return;
  }

  const prev = prevFriendshipByPlayer.get(humanPlayerId);
  const baseline = friendshipSnapshotAtAction ?? prev;
  const gained =
    baseline !== undefined && human.friendship > baseline ? human.friendship - baseline : 0;

  if (gained > 0) {
    runFriendshipGainVfxForPlayer(gained, mode, humanPlayerId, humanPlayerId);
    friendshipSnapshotAtAction = null;
  }

  prevFriendshipByPlayer.set(humanPlayerId, human.friendship);
}

export function waitForFriendshipVfxComplete(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, DURATION_MS + BURST_STAGGER_MS + 100);
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
