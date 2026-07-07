// Phone + solo only — do not import from tv.ts.
import type { PublicGameState } from "../../shared/types.js";
import { FRIENDSHIP_ICON } from "./ws-client.js";

export type FriendshipVfxMode = "solo" | "phone";

const DURATION_MS = 1200;

let prevFriendship: number | null = null;
let scheduleGen = 0;

export function resetFriendshipVfxTracking(): void {
  prevFriendship = null;
  scheduleGen = 0;
}

export function ensureFriendshipBaseline(pub: PublicGameState, humanPlayerId: string): void {
  const human = pub.players.find((p) => p.id === humanPlayerId);
  if (human && prevFriendship === null) prevFriendship = human.friendship;
}

export function snapshotFriendshipBeforeChoice(pub: PublicGameState, humanPlayerId: string): void {
  const human = pub.players.find((p) => p.id === humanPlayerId);
  if (human) prevFriendship = human.friendship;
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
  if (prevFriendship !== null && human.friendship > prevFriendship) {
    runFriendshipGainVfx(human.friendship - prevFriendship, mode);
  }
  if (prevFriendship === null || human.friendship >= prevFriendship) {
    prevFriendship = human.friendship;
  }
}

export function runFriendshipGainVfxAfterDrawChoice(amount: number, mode: FriendshipVfxMode): void {
  if (amount <= 0) return;
  runFriendshipGainVfx(amount, mode);
  prevFriendship = (prevFriendship ?? 0) + amount;
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
      if (pub) checkFriendshipGainVfx(pub, humanPlayerId, mode);
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
    return { rect: el.getBoundingClientRect(), element: el };
  }
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.6;
  return { rect: new DOMRect(cx - 40, cy - 40, 80, 80), element: null };
}

function spawnGainFloater(rect: DOMRect, amount: number): void {
  const el = document.createElement("span");
  el.className = "friendship-gain-float";
  el.textContent = `+${amount}`;
  el.style.left = `${rect.left + rect.width / 2}px`;
  el.style.top = `${rect.top + rect.height * 0.2}px`;
  document.body.appendChild(el);
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

  const { rect, element } = resolveAnchor(mode);
  const count = Math.min(16, Math.max(4, amount * 4));
  const particles: HTMLElement[] = [];
  const spread = Math.max(rect.width * 0.8, 48);

  if (mode === "solo" && element?.classList.contains("possessed")) {
    pulsePossessed(element);
  }

  spawnGainFloater(rect, amount);

  for (let i = 0; i < count; i++) {
    const img = document.createElement("img");
    img.src = FRIENDSHIP_ICON;
    img.alt = "";
    img.className = `friendship-particle friendship-particle--${mode}`;
    const x = rect.left + rect.width / 2 + (Math.random() - 0.5) * spread;
    const y = rect.bottom - 8;
    img.style.left = `${x}px`;
    img.style.top = `${y}px`;
    img.style.setProperty("--drift-x", `${(Math.random() - 0.5) * 60}px`);
    img.style.setProperty("--rise", `${-70 - Math.random() * 90}px`);
    img.style.animationDelay = `${i * 40}ms`;
    document.body.appendChild(img);
    particles.push(img);
  }

  setTimeout(() => {
    for (const p of particles) p.remove();
  }, DURATION_MS + count * 40);
}
