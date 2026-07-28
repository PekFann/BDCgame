// Phone + solo only — do not import from tv.ts.
import type { PublicGameState } from "../../shared/types.js";
import cardsData from "../../data/cards.json";
import { playMagicPotionSound } from "./audio.js";
import { POSSESSED_HEALTH_ICON } from "./ui-icons.js";

export type HealVfxMode = "solo" | "phone";

const DURATION_MS = 550;
const BURST_STAGGER_MS = 60;
const HEALTH_ICON_URL = encodeURI(POSSESSED_HEALTH_ICON);

/** Option IDs that heal Possessed — snapshot before send so VFX detects the gain. */
export const HEAL_OPTION_IDS = new Set(["heal", "heal2"]);

const cardEffectIds = Object.fromEntries(
  (cardsData as { id: string; effectId?: string }[]).map((c) => [c.id, c.effectId])
);

export function isGiftsDiscardPending(pub: PublicGameState): boolean {
  const pending = pub.pendingChoice;
  if (pending?.kind !== "discard_cards" || !pending.cardId) return false;
  return cardEffectIds[pending.cardId] === "gifts";
}

new Image().src = HEALTH_ICON_URL;

let prevPossessedHp: number | null = null;
let healSnapshotAtAction: number | null = null;
let scheduleGen = 0;
let vfxLayer: HTMLElement | null = null;

function ensureVfxLayer(): HTMLElement {
  if (vfxLayer) return vfxLayer;
  vfxLayer = document.getElementById("friendship-vfx-layer") as HTMLElement | null;
  if (vfxLayer) return vfxLayer;
  vfxLayer = document.createElement("div");
  vfxLayer.id = "friendship-vfx-layer";
  document.body.appendChild(vfxLayer);
  return vfxLayer;
}

export function isHealGainOption(optionId: string): boolean {
  return HEAL_OPTION_IDS.has(optionId);
}

export function resetPossessedHealVfxTracking(): void {
  prevPossessedHp = null;
  healSnapshotAtAction = null;
  scheduleGen = 0;
}

export function ensurePossessedHealBaseline(pub: PublicGameState): void {
  if (prevPossessedHp === null) {
    prevPossessedHp = pub.possessedHp;
  }
}

export function snapshotPossessedHpBeforeHeal(pub: PublicGameState): void {
  healSnapshotAtAction = pub.possessedHp;
  prevPossessedHp = pub.possessedHp;
}

function resolvePossessedAnchor(mode: HealVfxMode): { rect: DOMRect; element: HTMLElement | null } {
  let el: HTMLElement | null = null;
  if (mode === "solo") {
    el = document.querySelector("#board .card-slot.possessed");
  } else {
    el =
      (document.querySelector("#mini-board .possessed-hp") as HTMLElement | null) ??
      (document.querySelector("#mini-board .stat") as HTMLElement | null) ??
      document.getElementById("mini-board");
  }
  if (el) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      return { rect, element: el };
    }
  }
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight * 0.45;
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
  element.classList.remove("possessed--heal-hit");
  void element.offsetWidth;
  element.classList.add("possessed--heal-hit");
  setTimeout(() => element.classList.remove("possessed--heal-hit"), 600);
}

function runPossessedHealVfx(amount: number, mode: HealVfxMode): void {
  if (amount <= 0) return;

  playMagicPotionSound();
  const layer = ensureVfxLayer();
  const { rect, element } = resolvePossessedAnchor(mode);
  const count = Math.min(24, Math.max(8, amount * 6));
  const particles: HTMLElement[] = [];
  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height / 2;
  const particleSize = mode === "solo" ? 48 : 36;

  if (element?.classList.contains("possessed")) {
    pulsePossessed(element);
  }

  spawnGainFloater(layer, rect, amount);

  for (let i = 0; i < count; i++) {
    const img = document.createElement("img");
    img.src = HEALTH_ICON_URL;
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

export function checkPossessedHealVfx(pub: PublicGameState, mode: HealVfxMode): void {
  const baseline = healSnapshotAtAction ?? prevPossessedHp;
  const gained =
    baseline !== null && pub.possessedHp > baseline ? pub.possessedHp - baseline : 0;

  if (gained > 0) {
    runPossessedHealVfx(gained, mode);
    healSnapshotAtAction = null;
  } else if (!isGiftsDiscardPending(pub)) {
    healSnapshotAtAction = null;
  }

  prevPossessedHp = pub.possessedHp;
}

export function schedulePossessedHealVfx(
  getPub: () => PublicGameState | null | undefined,
  mode: HealVfxMode
): void {
  const gen = ++scheduleGen;
  requestAnimationFrame(() => {
    if (gen !== scheduleGen) return;
    requestAnimationFrame(() => {
      if (gen !== scheduleGen) return;
      const pub = getPub();
      if (!pub) return;
      checkPossessedHealVfx(pub, mode);
    });
  });
}
