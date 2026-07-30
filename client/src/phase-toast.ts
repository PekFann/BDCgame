import type { ManifestPreview, Phase, PublicGameState } from "../../shared/types.js";

const PHASE_TOAST_CLASSES = [
  "phase-toast--draw",
  "phase-toast--day",
  "phase-toast--night",
  "phase-toast--triggers",
  "phase-toast--manifest",
  "phase-toast--cycle",
  "phase-toast--centered",
] as const;

const FADE_OUT_MS = 280;
const CYCLE_HOLD_MS = 2000;

let toastEl: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let fadeTimer: ReturnType<typeof setTimeout> | null = null;
let lastToastKey = "";

function ensureToast(): HTMLElement {
  if (toastEl) return toastEl;
  toastEl = document.createElement("div");
  toastEl.id = "phase-toast";
  toastEl.className = "phase-toast";
  toastEl.hidden = true;
  document.body.appendChild(toastEl);
  return toastEl;
}

function clearToastTimers(): void {
  if (hideTimer) clearTimeout(hideTimer);
  if (fadeTimer) clearTimeout(fadeTimer);
  hideTimer = null;
  fadeTimer = null;
}

function setToastPhaseClass(el: HTMLElement, phaseClass: string | null, centered = false): void {
  for (const cls of PHASE_TOAST_CLASSES) el.classList.remove(cls);
  if (phaseClass) el.classList.add(phaseClass);
  if (centered) el.classList.add("phase-toast--centered");
}

function phaseToastClass(phase: Phase | "cycle"): string {
  switch (phase) {
    case "draw":
      return "phase-toast--draw";
    case "day":
      return "phase-toast--day";
    case "night":
      return "phase-toast--night";
    case "triggers":
      return "phase-toast--triggers";
    case "manifest":
      return "phase-toast--manifest";
    case "cycle":
      return "phase-toast--cycle";
    default:
      return "phase-toast--day";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function showToast(
  title: string,
  detail: string,
  durationMs = 2000,
  options?: { phaseClass?: string; centered?: boolean }
): void {
  const el = ensureToast();
  clearToastTimers();

  el.textContent = "";
  setToastPhaseClass(el, options?.phaseClass ?? null, options?.centered ?? false);
  const heading = document.createElement("strong");
  heading.textContent = title;
  const sub = document.createElement("span");
  sub.className = "phase-toast-detail";
  sub.textContent = detail;
  el.appendChild(heading);
  if (detail) el.appendChild(sub);

  el.hidden = false;
  el.classList.remove("phase-toast-out");
  void el.offsetWidth;
  el.classList.add("phase-toast-in");

  hideTimer = setTimeout(() => {
    el.classList.remove("phase-toast-in");
    el.classList.add("phase-toast-out");
    fadeTimer = setTimeout(() => {
      el.hidden = true;
      el.classList.remove("phase-toast-out");
      setToastPhaseClass(el, null, false);
    }, FADE_OUT_MS);
  }, durationMs);
}

/** Show toast, hold for durationMs, fade out, then resolve. */
async function showToastAndWait(
  title: string,
  detail: string,
  durationMs: number,
  options?: { phaseClass?: string; centered?: boolean }
): Promise<void> {
  showToast(title, detail, durationMs, options);
  await sleep(durationMs + FADE_OUT_MS);
}

export async function showCycleStartToast(cycle: number): Promise<void> {
  await showToastAndWait(`Day ${cycle}`, "", CYCLE_HOLD_MS, {
    phaseClass: phaseToastClass("cycle"),
    centered: true,
  });
}

export function showManifestToast(preview: ManifestPreview): void {
  const cls = phaseToastClass("manifest");
  if (preview.skipped) {
    showToast("Demons Manifest", "Demons do not manifest this cycle.", 2000, { phaseClass: cls });
    return;
  }
  const n = preview.totalDamage;
  showToast("Demons Manifest!", `Demon deals ${n} damage to the possessed.`, 2000, {
    phaseClass: cls,
  });
}

export function refreshPhaseToast(pub: PublicGameState): void {
  if (pub.presentationHold?.at === "cycle_start") return;

  const key = `${pub.cycle}-${pub.phase}`;
  if (key === lastToastKey) return;
  lastToastKey = key;

  if (pub.phase === "draw") {
    showToast("Draw Phase", "Choose card + energy or gain friendship.", 2000, {
      phaseClass: phaseToastClass("draw"),
    });
    return;
  }
  if (pub.phase === "triggers") {
    showToast("Triggers & Events", "Roll the dice when prompted.", 2000, {
      phaseClass: phaseToastClass("triggers"),
    });
    return;
  }
  if (pub.phase === "manifest") {
    // Manifest has its own presentation toast via showManifestToast.
    return;
  }
  if (pub.phase !== "day" && pub.phase !== "night") return;

  if (pub.phase === "day") {
    showToast(
      "Day Phase",
      `${pub.dayActionsRemaining} action${pub.dayActionsRemaining === 1 ? "" : "s"} remaining`,
      2000,
      { phaseClass: phaseToastClass("day") }
    );
  } else {
    showToast(
      "Night Phase",
      `${pub.nightActionsRemaining} action${pub.nightActionsRemaining === 1 ? "" : "s"} remaining`,
      2000,
      { phaseClass: phaseToastClass("night") }
    );
  }
}

export function resetPhaseToast(): void {
  lastToastKey = "";
  clearToastTimers();
  if (toastEl) {
    toastEl.hidden = true;
    toastEl.classList.remove("phase-toast-in", "phase-toast-out");
    setToastPhaseClass(toastEl, null, false);
  }
}
