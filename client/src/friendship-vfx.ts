// Phone + solo only — do not import from tv.ts.
import type { PublicGameState } from "../../shared/types.js";
import { FRIENDSHIP_ICON } from "./ui-icons.js";

export type FriendshipVfxMode = "solo" | "phone";

const DURATION_MS = 550;
const BURST_STAGGER_MS = 60;
const FRIENDSHIP_ICON_URL = encodeURI(FRIENDSHIP_ICON);

/** Preload friendship icon so burst particles render immediately. */
new Image().src = FRIENDSHIP_ICON_URL;

/** Option IDs that grant friendship — snapshot before send so VFX detects the gain. */
export const FRIENDSHIP_GAIN_OPTION_IDS = new Set(["friendship", "friendship2", "friendship_all"]);

/** Card effectIds that grant friendship on direct PLAY_CARD (no pick-one). */
export const DIRECT_FRIENDSHIP_EFFECT_IDS = new Set(["good_old_days"]);

let prevFriendship: number | null = null;
/** Baseline captured on player action (card/draw click); takes priority over prevFriendship. */
let friendshipSnapshotAtAction: number | null = null;
/** Set on draw-phase friendship click; consumed on next scheduled check. */
let pendingDrawFriendshipGain: number | null = null;
let scheduleGen = 0;
let vfxLayer: HTMLElement | null = null;

function ensureVfxLayer(): HTMLElement {
  if (vfxLayer) return vfxLayer;
  vfxLayer = document.createElement("div");
  vfxLayer.id = "friendship-vfx-layer";
  document.body.appendChild(vfxLayer);
  return vfxLayer;
}

export function isFriendshipGainOption(optionId: string): boolean {
  return FRIENDSHIP_GAIN_OPTION_IDS.has(optionId);
}

export function markPendingDrawFriendshipGain(amount = 1): void {
  pendingDrawFriendshipGain = amount;
}

export function resetFriendshipVfxTracking(): void {
  prevFriendship = null;
  friendshipSnapshotAtAction = null;
  pendingDrawFriendshipGain = null;
  scheduleGen = 0;
}

export function ensureFriendshipBaseline(pub: PublicGameState, humanPlayerId: string): void {
  const human = pub.players.find((p) => p.id === humanPlayerId);
  if (human && prevFriendship === null) prevFriendship = human.friendship;
}

export function snapshotFriendshipBeforeChoice(pub: PublicGameState, humanPlayerId: string): void {
  const human = pub.players.find((p) => p.id === humanPlayerId);
  if (human) {
    friendshipSnapshotAtAction = human.friendship;
    prevFriendship = human.friendship;
  }
}

/** @deprecated Use ensureFriendshipBaseline or snapshotFriendshipBeforeChoice */
export function syncFriendshipBaseline(pub: PublicGameState, humanPlayerId: string): void {
  ensureFriendshipBaseline(pub, humanPlayerId);
}

export function checkFriendshipGainVfx(
  pub: PublicGameState,
  humanPlayerId: string,
  mode: FriendshipVfxMode
): void {
  const human = pub.players.find((p) => p.id === humanPlayerId);
  if (!human) return;

  if (pendingDrawFriendshipGain !== null) {
    const amount = pendingDrawFriendshipGain;
    pendingDrawFriendshipGain = null;
    if (import.meta.env.DEV) {
      console.debug("[friendship-vfx] draw pending", { amount, current: human.friendship });
    }
    runFriendshipGainVfx(amount, mode);
    prevFriendship = human.friendship;
    friendshipSnapshotAtAction = null;
    return;
  }

  const baseline = friendshipSnapshotAtAction ?? prevFriendship;
  const gained = baseline !== null && human.friendship > baseline ? human.friendship - baseline : 0;

  if (import.meta.env.DEV) {
    console.debug("[friendship-vfx]", {
      baseline,
      current: human.friendship,
      gained,
      actionSnapshot: friendshipSnapshotAtAction,
    });
  }

  if (gained > 0) {
    runFriendshipGainVfx(gained, mode);
    friendshipSnapshotAtAction = null;
  }

  prevFriendship = human.friendship;
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

function resolveAnchor(mode: FriendshipVfxMode): { rect: DOMRect; element: HTMLElement | null } {
  let el: HTMLElement | null = null;
  if (mode === "solo") {
    el = document.querySelector("#board .card-slot.possessed");
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
      console.debug("[friendship-vfx] anchor zero-size, using viewport fallback");
    }
  }
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.6;
  return { rect: new DOMRect(cx - 40, cy - 40, 80, 80), element: el };
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

export function runFriendshipGainVfx(amount: number, mode: FriendshipVfxMode): void {
  if (amount <= 0) return;

  const layer = ensureVfxLayer();
  const { rect, element } = resolveAnchor(mode);
  const count = Math.min(24, Math.max(8, amount * 6));
  const particles: HTMLElement[] = [];
  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height / 2;
  const particleSize = mode === "solo" ? 48 : 36;

  if (mode === "solo" && element?.classList.contains("possessed")) {
    pulsePossessed(element);
  }

  spawnGainFloater(layer, rect, amount);

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
    const distance = 120 + Math.random() * 160;
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
