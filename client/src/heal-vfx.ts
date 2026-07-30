// Phone + solo only — do not import from tv.ts.
import type { PublicGameState } from "../../shared/types.js";
import cardsData from "../../data/cards.json";
import { playVfxSound } from "./audio.js";
import { DEFAULT_VFX_AUDIO } from "./vfx/types.js";
import { spawnBurst, burstDurationMs } from "./vfx/burst.js";
import { spawnFloater, spawnHtmlFloater } from "./vfx/floater.js";
import { ensureVfxLayer } from "./vfx/layer.js";
import {
  CARD_ICON_URL,
  DRAW_FLOATER_MS,
  ENERGY_ICON_URL,
  FRIENDSHIP_ICON_URL,
  getBurstEntry,
  getBurstPreset,
  getFloaterPreset,
} from "./vfx/presets.js";
import { pulseElement } from "./vfx/slot-fx.js";

export type HealVfxMode = "solo" | "phone";

/** Option IDs that heal Possessed — snapshot before send so VFX detects the gain. */
export const HEAL_OPTION_IDS = new Set(["heal", "heal2"]);

let prevPossessedHp: number | null = null;
let healSnapshotAtAction: number | null = null;
let scheduleGen = 0;

export function isHealGainOption(optionId: string): boolean {
  return HEAL_OPTION_IDS.has(optionId);
}

const cardEffectIds = Object.fromEntries(
  (cardsData as { id: string; effectId?: string }[]).map((c) => [c.id, c.effectId])
);

export function isGiftsDiscardPending(pub: PublicGameState): boolean {
  const pending = pub.pendingChoice;
  if (pending?.kind !== "discard_cards" || !pending.cardId) return false;
  return cardEffectIds[pending.cardId] === "gifts";
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

function runPossessedHealVfx(amount: number, mode: HealVfxMode): void {
  if (amount <= 0) return;

  const burstEntry = getBurstEntry("heal_burst");
  const burstPreset = burstEntry?.preset ?? getBurstPreset("heal_burst");
  const floaterPreset = getFloaterPreset("friendship_floater");
  const audio = burstEntry?.audio ?? DEFAULT_VFX_AUDIO;
  playVfxSound(audio.soundId, audio.soundDelayMs);
  const layer = ensureVfxLayer();
  const { rect, element } = resolvePossessedAnchor(mode);

  if (element?.classList.contains("possessed")) {
    pulseElement(element, "possessed--heal-hit", 600);
  }

  spawnFloater(layer, rect, amount, floaterPreset);
  spawnBurst(layer, rect, amount, burstPreset, { mode }, burstEntry?.composition);
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

export function healVfxDurationMs(): number {
  return burstDurationMs(getBurstPreset("heal_burst"));
}
