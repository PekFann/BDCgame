import type { GameAction, PresentationHold, PublicGameState } from "../../shared/types.js";
import cardsData from "../../data/cards.json";
import { cardImg, cardName } from "./ws-client.js";

type TriggerHold = Extract<PresentationHold, { at: "post_trigger_roll" }>;

const cardDefs = Object.fromEntries(
  (cardsData as { id: string; name: string; effect?: string }[]).map((c) => [c.id, c])
);

/** Canonical face angles in rotateX → rotateY → rotateZ order (matches tumble transform). */
const FACE_ANGLES: Record<number, { rx: number; ry: number; rz: number }> = {
  1: { rx: 0, ry: 0, rz: 0 },
  2: { rx: -90, ry: 0, rz: 0 },
  3: { rx: 0, ry: -90, rz: 0 },
  4: { rx: 0, ry: 90, rz: 0 },
  5: { rx: 90, ry: 0, rz: 0 },
  6: { rx: 180, ry: 0, rz: 0 },
};

function faceTransform({ rx, ry, rz }: { rx: number; ry: number; rz: number }): string {
  return `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`;
}

/** Smallest forward delta (0–360) from `from` to an angle congruent with `target`. */
function alignAngleForward(from: number, target: number): number {
  const delta = ((((target - from) % 360) + 360) % 360);
  return from + delta;
}

/** Tumble spin duration — decelerates into settle. */
const TUMBLE_DURATION_MS = 4000;
/** Scale-out animation length; keep in sync with `.dice-scene--scale-out`. */
const SCALE_OUT_MS = 450;
/** Pause on landed face before scale-out. */
export const POST_LAND_HOLD_MS = 700;
const TUMBLE_STEPS = 16;
/** Soften per-step spin so motion reads as a slower roll. */
const STEP_SCALE = 0.65;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function createDiceCubeMarkup(): string {
  const faces = [
    { cls: "dice-face-front", value: 1 },
    { cls: "dice-face-back", value: 6 },
    { cls: "dice-face-right", value: 3 },
    { cls: "dice-face-left", value: 4 },
    { cls: "dice-face-top", value: 2 },
    { cls: "dice-face-bottom", value: 5 },
  ];
  const pips = Array.from({ length: 9 }, (_, i) => `<span class="dice-pip pip-${i + 1}"></span>`).join("");
  return faces
    .map((f) => `<div class="dice-face ${f.cls}" data-value="${f.value}">${pips}</div>`)
    .join("");
}

export function mountDiceScene(container: HTMLElement, large = false): HTMLElement {
  container.innerHTML = `
    <div class="dice-scene${large ? " dice-scene--large" : ""}">
      <div class="dice-cube-3d">${createDiceCubeMarkup()}</div>
    </div>
  `;
  return container.querySelector(".dice-cube-3d") as HTMLElement;
}

function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

function buildTumblePath(finalRoll: number): { rx: number; ry: number; rz: number }[] {
  const path: { rx: number; ry: number; rz: number }[] = [{ rx: 0, ry: 0, rz: 0 }];
  let rx = 0;
  let ry = 0;
  let rz = 0;
  for (let i = 0; i < TUMBLE_STEPS; i++) {
    const weight = 1 - i / TUMBLE_STEPS;
    const rxStep = (Math.floor(Math.random() * 3) + 1) * 90 * (0.55 + weight * 0.45) * STEP_SCALE;
    const ryStep = (Math.floor(Math.random() * 3) + 1) * 90 * (0.55 + weight * 0.45) * STEP_SCALE;
    const rzStep = (Math.floor(Math.random() * 2) + 1) * 45 * (0.5 + weight * 0.5) * STEP_SCALE;
    rx += rxStep;
    ry += ryStep;
    rz += rzStep;
    path.push({ rx, ry, rz });
  }
  const face = FACE_ANGLES[finalRoll] ?? FACE_ANGLES[1];
  path.push({
    rx: alignAngleForward(rx, face.rx),
    ry: alignAngleForward(ry, face.ry),
    rz: alignAngleForward(rz, face.rz),
  });
  return path;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export async function animatePhysicalDice(container: HTMLElement, finalRoll: number): Promise<void> {
  let cube = container.querySelector(".dice-cube-3d") as HTMLElement | null;
  if (!cube) {
    mountDiceScene(container, true);
    cube = container.querySelector(".dice-cube-3d") as HTMLElement | null;
  }
  if (!cube) return;
  const scene = container.querySelector(".dice-scene") as HTMLElement | null;

  cube.classList.add("is-tumbling");
  cube.classList.remove("is-landed", "is-holding");
  scene?.classList.remove("is-landed-pause", "dice-scene--scale-out");
  if (scene) {
    delete scene.dataset.diceScaledOut;
    scene.style.visibility = "";
  }
  container.classList.remove("dice-host--scale-out", "is-collapsed");
  delete container.dataset.diceScaledOut;
  container.style.visibility = "";
  cube.style.transition = "none";

  const tumblePath = buildTumblePath(finalRoll);

  await new Promise<void>((resolve) => {
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / TUMBLE_DURATION_MS);
      const eased = easeOutQuart(t);
      const pathIndex = eased * (tumblePath.length - 1);
      const i0 = Math.floor(pathIndex);
      const i1 = Math.min(tumblePath.length - 1, i0 + 1);
      const frac = pathIndex - i0;
      const a0 = tumblePath[i0];
      const a1 = tumblePath[i1];
      const rx = lerpAngle(a0.rx, a1.rx, frac);
      const ry = lerpAngle(a0.ry, a1.ry, frac);
      const rz = lerpAngle(a0.rz, a1.rz, frac);
      cube!.style.transform = faceTransform({ rx, ry, rz });
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });

  // Keep last tumble frame (already on final face); do not rewrite transform.
  cube.classList.remove("is-tumbling");
  cube.classList.add("is-landed");
  cube.style.transition = "none";

  cube.classList.add("is-holding");
  await sleep(POST_LAND_HOLD_MS);
  cube.classList.remove("is-holding");
}

function isDiceSceneScaledOut(container: HTMLElement): boolean {
  const scene = container.querySelector(".dice-scene") as HTMLElement | null;
  return scene?.dataset.diceScaledOut === "1" || container.dataset.diceScaledOut === "1";
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function setRollTitle(panel: HTMLElement, text: string): void {
  const title = panel.querySelector(".card-modal-title");
  if (title) title.textContent = text;
}

async function scaleDownDiceScene(container: HTMLElement): Promise<void> {
  if (isDiceSceneScaledOut(container)) return;

  const scene = container.querySelector(".dice-scene") as HTMLElement | null;
  if (!scene) return;

  await waitForPaint();

  scene.classList.add("dice-scene--scale-out");
  await sleep(SCALE_OUT_MS);
  scene.dataset.diceScaledOut = "1";
  container.dataset.diceScaledOut = "1";
  // Hide only after shrink completes — keep dice visible through the scale.
  scene.style.visibility = "hidden";

  const cube = container.querySelector(".dice-cube-3d");
  cube?.classList.remove("is-landed", "is-holding");

  if (container.classList.contains("trigger-roll-dice-host")) {
    container.classList.add("is-collapsed");
  }
}

function ensureTriggerRollHost(panel: HTMLElement): HTMLElement {
  let host = panel.querySelector(".trigger-roll-dice-host") as HTMLElement | null;
  if (!host) {
    panel.innerHTML = `
    <h3 class="card-modal-title">Rolling…</h3>
    <div class="trigger-roll-dice-host"></div>
  `;
    host = panel.querySelector(".trigger-roll-dice-host") as HTMLElement;
    mountDiceScene(host, true);
  }
  return host;
}

function isDiceLandedForRoll(host: HTMLElement, roll: number): boolean {
  return host.dataset.diceRoll === String(roll) && host.dataset.diceLanded === "1";
}

/** True when the modal already shows a landed cube for this roll (skip re-tumble). */
export function hasLandedDiceHost(panel: HTMLElement, roll: number): boolean {
  const host = panel.querySelector(".trigger-roll-dice-host") as HTMLElement | null;
  return !!host && isDiceLandedForRoll(host, roll);
}

function revealRollNumber(panel: HTMLElement, roll: number): void {
  panel.innerHTML = `
    <h3 class="card-modal-title">Rolled</h3>
    <p class="dice-roll-result dice-roll-result--reveal">${roll}</p>
  `;
}

export async function runTriggerDiceAnimation(
  panel: HTMLElement,
  roll: number,
  options?: { revealNumber?: boolean; reuseHost?: boolean }
): Promise<void> {
  const reuseHost = options?.reuseHost !== false;
  const existingHost = panel.querySelector(".trigger-roll-dice-host") as HTMLElement | null;
  const canReuse =
    reuseHost &&
    existingHost?.querySelector(".dice-scene") &&
    isDiceLandedForRoll(existingHost, roll);

  const host = canReuse && existingHost ? existingHost : ensureTriggerRollHost(panel);
  if (!canReuse) {
    setRollTitle(panel, "Rolling…");
  }

  if (!canReuse) {
    if (!existingHost?.querySelector(".dice-scene")) {
      mountDiceScene(host, true);
    }
    delete host.dataset.diceLanded;
    host.dataset.diceRoll = String(roll);
    delete host.dataset.diceScaledOut;
    host.classList.remove("dice-host--scale-out", "is-collapsed");
    host.style.visibility = "";
    const scene = host.querySelector(".dice-scene") as HTMLElement | null;
    if (scene) {
      delete scene.dataset.diceScaledOut;
      scene.classList.remove("dice-scene--scale-out");
      scene.style.visibility = "";
    }
    await animatePhysicalDice(host, roll);
    host.dataset.diceLanded = "1";
  }

  if (options?.revealNumber !== false) {
    await scaleDownDiceScene(host);
    setRollTitle(panel, "Rolled");
  }
}

export function showRollResultWaiting(panel: HTMLElement, roll: number): void {
  const host = panel.querySelector(".trigger-roll-dice-host");
  setRollTitle(panel, "Rolled");
  if (host) {
    panel.querySelector(".trigger-roll-resolving")?.remove();
    const resolving = document.createElement("p");
    resolving.className = "card-modal-effect trigger-roll-resolving";
    resolving.textContent = "Resolving…";
    host.insertAdjacentElement("afterend", resolving);
    return;
  }
  panel.innerHTML = `
    <h3 class="card-modal-title">Rolled</h3>
    <p class="dice-roll-result dice-roll-result--compact">${roll}</p>
    <p class="card-modal-effect trigger-roll-resolving">Resolving…</p>
  `;
}

function outcomeMarkup(pub: PublicGameState, hold: TriggerHold): string {
  if (hold.outcome === "trigger") {
    const possessedName = cardName(pub.possessedId);
    const def = cardDefs[pub.possessedId];
    return `
      <p class="trigger-roll-outcome">
        <strong>${possessedName} triggered!</strong><br />
        <span class="card-modal-effect">${def?.effect ?? "Possessed ability activates."}</span>
      </p>`;
  }
  if (hold.outcome === "event" && hold.eventCardId) {
    const def = cardDefs[hold.eventCardId];
    return `
      <div class="trigger-event-reveal">
        <p class="trigger-event-reveal-label"><strong>Event card drawn!</strong></p>
        <img class="trigger-event-reveal-img" src="${cardImg(hold.eventCardId)}" alt="${cardName(hold.eventCardId)}" />
        <p class="card-modal-meta">${cardName(hold.eventCardId)}</p>
        <p class="card-modal-effect">${def?.effect ?? ""}</p>
      </div>`;
  }
  return `
    <p class="trigger-roll-outcome">
      <strong>No effect</strong><br />
      <span class="card-modal-effect">Proceeding to the next cycle.</span>
    </p>`;
}

function waitForOkClick(panel: HTMLElement, send?: (a: GameAction) => void): Promise<void> {
  return new Promise((resolve) => {
    const btn = panel.querySelector(".trigger-outcome-ok") as HTMLButtonElement | null;
    if (!btn) {
      resolve();
      return;
    }
    btn.addEventListener(
      "click",
      () => {
        send?.({ type: "ACK_PRESENTATION" });
        resolve();
      },
      { once: true }
    );
  });
}

export async function runTriggerRollModalPresentation(
  panel: HTMLElement,
  pub: PublicGameState,
  hold: TriggerHold,
  options?: { skipDice?: boolean; send?: (a: GameAction) => void }
): Promise<void> {
  if (!options?.skipDice) {
    await runTriggerDiceAnimation(panel, hold.roll, { revealNumber: false, reuseHost: true });
    const host = panel.querySelector(".trigger-roll-dice-host") as HTMLElement | null;
    if (host) {
      await scaleDownDiceScene(host);
      setRollTitle(panel, "Rolled");
    }
  } else if (!panel.querySelector(".trigger-roll-dice-host")) {
    revealRollNumber(panel, hold.roll);
  } else {
    const host = panel.querySelector(".trigger-roll-dice-host") as HTMLElement;
    await scaleDownDiceScene(host);
    setRollTitle(panel, "Rolled");
  }

  panel.querySelector(".trigger-roll-resolving")?.remove();
  const outcomeHost = document.createElement("div");
  outcomeHost.className = "trigger-roll-outcome-host";
  outcomeHost.innerHTML = outcomeMarkup(pub, hold);
  panel.appendChild(outcomeHost);
  const buttons = document.createElement("div");
  buttons.className = "card-modal-buttons";
  buttons.innerHTML = `<button class="btn trigger-outcome-ok" type="button">Continue</button>`;
  panel.appendChild(buttons);

  await waitForOkClick(panel, options?.send);
}

function ensureDiceOverlay(boardRoot: HTMLElement): HTMLElement {
  let el = boardRoot.querySelector(".dice-overlay") as HTMLElement | null;
  if (!el) {
    el = document.createElement("div");
    el.className = "dice-overlay";
    boardRoot.appendChild(el);
  }
  return el;
}

async function showOutcomeToast(title: string, detail: string, ms: number): Promise<void> {
  const toast = document.createElement("div");
  toast.className = "phase-toast dice-outcome-toast";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const sub = document.createElement("span");
  sub.className = "phase-toast-detail";
  sub.textContent = detail;
  toast.appendChild(heading);
  toast.appendChild(sub);
  document.body.appendChild(toast);
  void toast.offsetWidth;
  toast.classList.add("phase-toast-in");
  await sleep(ms);
  toast.classList.remove("phase-toast-in");
  toast.classList.add("phase-toast-out");
  await sleep(280);
  toast.remove();
}

export async function runDicePresentation(
  boardRoot: HTMLElement,
  pub: PublicGameState,
  hold: TriggerHold
): Promise<void> {
  const overlay = ensureDiceOverlay(boardRoot);
  overlay.hidden = false;
  void overlay.offsetWidth;
  overlay.classList.add("dice-overlay-in");

  mountDiceScene(overlay, true);
  await animatePhysicalDice(overlay, hold.roll);
  await scaleDownDiceScene(overlay);

  if (hold.outcome === "trigger") {
    const possessedName = cardName(pub.possessedId);
    const def = cardDefs[pub.possessedId];
    await showOutcomeToast(
      `${possessedName} triggered!`,
      def?.effect ?? "Possessed ability activates.",
      1000
    );
  } else if (hold.outcome === "event" && hold.eventCardId) {
    const def = cardDefs[hold.eventCardId];
    const modal = document.createElement("div");
    modal.className = "card-modal event-reveal-modal";
    modal.innerHTML = `
      <div class="card-modal-backdrop modal-overlay"></div>
      <div class="event-reveal-panel modal-panel">
        <h3 class="card-modal-title">Event Card</h3>
        <img class="event-reveal-img" src="${cardImg(hold.eventCardId)}" alt="${cardName(hold.eventCardId)}" />
        <p class="card-modal-meta">${cardName(hold.eventCardId)}</p>
        <p class="card-modal-effect">${def?.effect ?? ""}</p>
      </div>
    `;
    document.body.appendChild(modal);
    void modal.offsetWidth;
    modal.hidden = false;
    modal.querySelector(".modal-panel")?.classList.add("is-opening");
    await sleep(1500);
    modal.remove();
  } else {
    await showOutcomeToast("No effect", "Proceeding to next cycle.", 1000);
  }

  overlay.classList.remove("dice-overlay-in");
  overlay.hidden = true;
  overlay.innerHTML = "";
}
