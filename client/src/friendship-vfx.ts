import { FRIENDSHIP_ICON } from "./ws-client.js";
import { lockInput, unlockInput } from "./input-lock.js";

const LOCK_KEY = "friendship-vfx";
const DURATION_MS = 1200;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function anchorPoint(): { x: number; y: number } {
  const roster =
    document.querySelector(".player-roster-row.is-human .roster-stat[title='Friendship']") ??
    document.querySelector(".player-roster-row.is-human");
  if (roster) {
    const r = roster.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight * 0.75 };
}

export async function runFriendshipGainVfx(amount: number): Promise<void> {
  if (amount <= 0) return;

  lockInput(LOCK_KEY);
  const { x, y } = anchorPoint();
  const count = Math.min(12, Math.max(6, amount * 3));
  const particles: HTMLElement[] = [];

  for (let i = 0; i < count; i++) {
    const img = document.createElement("img");
    img.src = FRIENDSHIP_ICON;
    img.alt = "";
    img.className = "friendship-particle";
    img.style.left = `${x + (Math.random() - 0.5) * 48}px`;
    img.style.top = `${y}px`;
    img.style.setProperty("--drift-x", `${(Math.random() - 0.5) * 80}px`);
    img.style.setProperty("--rise", `${-90 - Math.random() * 70}px`);
    img.style.animationDelay = `${i * 45}ms`;
    document.body.appendChild(img);
    particles.push(img);
  }

  await sleep(DURATION_MS);

  for (const p of particles) p.remove();
  unlockInput(LOCK_KEY);
}
