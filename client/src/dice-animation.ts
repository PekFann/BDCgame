import type { GameAction, PresentationHold, PublicGameState } from "../../shared/types.js";
import cardsData from "../../data/cards.json";
import { playDiceRollSoundDelayed, cancelPendingDiceRollSound } from "./audio.js";
import { isFriendshipGainOption, snapshotFriendshipBeforeChoice } from "./friendship-vfx.js";
import { cardImg, cardName, getHumanPlayerId } from "./ws-client.js";

type TriggerHold = Extract<PresentationHold, { at: "post_trigger_roll" }>;
type EventRollHold = Extract<PresentationHold, { at: "post_event_roll" }>;

interface CardDef {
  id: string;
  name: string;
  type?: string;
  effect?: string;
  effectId?: string;
  hp?: number;
  attack?: number;
  persistent?: boolean;
  instant?: boolean;
}

const cardDefs = Object.fromEntries((cardsData as CardDef[]).map((c) => [c.id, c]));

const EVENT_ROLL_EFFECT_IDS = new Set([
  "event_morphin",
  "event_dragon",
  "event_phantom_fart",
  "event_wrong_spell",
  "event_lost_hours",
]);

const EVENT_PICK_ONE_EFFECT_IDS = new Set([
  "event_donut_bandit",
  "event_haunted_pizza",
  "event_unicorn",
  "event_rubber_duck",
]);

/** Mirrors server pending options in server/game/effects/triggers.ts */
const EVENT_PICK_ONE_OPTIONS: Record<string, { id: string; label: string }[]> = {
  event_donut_bandit: [
    { id: "lose_energy", label: "You lose 2 energy" },
    { id: "lose_friendship", label: "Each player loses 1 friendship" },
  ],
  event_haunted_pizza: [
    { id: "possessed_damage", label: "Possessed loses 2 HP" },
    { id: "lose_energy", label: "Each player loses 1 energy" },
  ],
  event_unicorn: [
    { id: "friendship", label: "You gain 2 friendship" },
    { id: "energy_all", label: "Each player gains 1 energy" },
  ],
  event_rubber_duck: [
    { id: "energy", label: "You gain 3 energy" },
    { id: "friendship_all", label: "Each player gains 1 friendship" },
  ],
};

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

/** Tumble spin duration — ease in then ease out to settle. */
const TUMBLE_DURATION_MS = 4000;
/** Scale-out animation length; keep in sync with `.dice-scene--scale-out`. */
const SCALE_OUT_MS = 450;
/** Brief static hold before tumbling begins. */
const PRE_ROLL_STATIC_MS = 400;
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

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function buildTumblePath(
  finalRoll: number,
  startFace?: number
): { rx: number; ry: number; rz: number }[] {
  const startAngles =
    startFace !== undefined && FACE_ANGLES[startFace]
      ? FACE_ANGLES[startFace]
      : FACE_ANGLES[1];
  const path: { rx: number; ry: number; rz: number }[] = [
    { rx: startAngles.rx, ry: startAngles.ry, rz: startAngles.rz },
  ];
  let rx = startAngles.rx;
  let ry = startAngles.ry;
  let rz = startAngles.rz;
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

function markDiceLanded(container: HTMLElement, roll: number): void {
  const cube = container.querySelector(".dice-cube-3d");
  cube?.classList.remove("is-tumbling", "is-holding");
  cube?.classList.add("is-landed");
  if (cube instanceof HTMLElement) cube.style.transition = "none";
  container.dataset.diceRoll = String(roll);
  container.dataset.diceLanded = "1";
}

function lockDiceToFace(container: HTMLElement, roll: number): void {
  let cube = container.querySelector(".dice-cube-3d") as HTMLElement | null;
  if (!cube) {
    mountDiceScene(container, true);
    cube = container.querySelector(".dice-cube-3d") as HTMLElement | null;
  }
  if (!cube) return;
  const face = FACE_ANGLES[roll] ?? FACE_ANGLES[1];
  cube.style.transition = "none";
  cube.style.transform = faceTransform(face);
  markDiceLanded(container, roll);
}

export async function animatePhysicalDice(container: HTMLElement, finalRoll: number): Promise<void> {
  cancelPendingDiceRollSound();
  let cube = container.querySelector(".dice-cube-3d") as HTMLElement | null;
  if (!cube) {
    mountDiceScene(container, true);
    cube = container.querySelector(".dice-cube-3d") as HTMLElement | null;
  }
  if (!cube) return;
  const scene = container.querySelector(".dice-scene") as HTMLElement | null;

  scene?.classList.remove("is-landed-pause", "dice-scene--scale-out");
  if (scene) {
    delete scene.dataset.diceScaledOut;
    scene.style.visibility = "";
    scene.style.opacity = "";
    scene.style.transition = "";
  }
  container.classList.remove("dice-host--scale-out", "is-collapsed");
  delete container.dataset.diceScaledOut;
  container.style.visibility = "";
  cube.style.transition = "none";

  const previousRoll = container.dataset.diceRoll
    ? parseInt(container.dataset.diceRoll, 10)
    : NaN;
  const hasLandedPrior =
    container.dataset.diceLanded === "1" &&
    !Number.isNaN(previousRoll) &&
    previousRoll >= 1 &&
    previousRoll <= 6 &&
    previousRoll !== finalRoll;

  let startFace = finalRoll;
  if (hasLandedPrior) {
    startFace = previousRoll;
    lockDiceToFace(container, startFace);
    await sleep(PRE_ROLL_STATIC_MS);
  } else {
    const neutralFace = FACE_ANGLES[1];
    cube.style.transform = faceTransform(neutralFace);
  }

  cube = container.querySelector(".dice-cube-3d") as HTMLElement | null;
  if (!cube) return;

  cube.classList.add("is-tumbling");
  cube.classList.remove("is-landed", "is-holding");
  delete container.dataset.diceLanded;

  playDiceRollSoundDelayed(1000);
  const tumblePath = buildTumblePath(finalRoll, startFace);

  await new Promise<void>((resolve) => {
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / TUMBLE_DURATION_MS);
      const eased = easeInOutCubic(t);
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

  markDiceLanded(container, finalRoll);
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
  scene.style.opacity = "0";
  scene.style.pointerEvents = "none";

  const cube = container.querySelector(".dice-cube-3d");
  cube?.classList.remove("is-landed", "is-holding");

  if (container.classList.contains("trigger-roll-dice-host")) {
    container.classList.add("is-collapsed");
  }
}

function ensureTriggerRollHost(panel: HTMLElement): HTMLElement {
  let host = panel.querySelector(".trigger-roll-dice-host") as HTMLElement | null;
  if (!host) {
    const title = panel.querySelector(".card-modal-title");
    if (title) {
      title.insertAdjacentHTML("afterend", `<div class="trigger-roll-dice-host"></div>`);
      host = panel.querySelector(".trigger-roll-dice-host") as HTMLElement;
    } else {
      panel.innerHTML = `
    <h3 class="card-modal-title">Rolling…</h3>
    <div class="trigger-roll-dice-host"></div>
  `;
      host = panel.querySelector(".trigger-roll-dice-host") as HTMLElement;
    }
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
      scene.style.opacity = "";
      scene.style.pointerEvents = "";
    }
    await animatePhysicalDice(host, roll);
    host.dataset.diceLanded = "1";
  }

  if (options?.revealNumber === true) {
    await scaleDownDiceScene(host);
    revealRollNumber(panel, roll);
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

function snapDiceToRoll(host: HTMLElement, roll: number): void {
  if (!host.querySelector(".dice-scene")) {
    mountDiceScene(host, true);
  }
  lockDiceToFace(host, roll);
}

function clearTriggerRollPresentation(panel: HTMLElement): void {
  panel.querySelector(".trigger-roll-resolving")?.remove();
  panel.querySelector(".trigger-roll-detail")?.remove();
  panel.querySelector(".trigger-roll-outcome-host")?.remove();
  panel.querySelector(".trigger-roll-actions")?.remove();
}

function eventCardFooterHint(effectId: string, type?: string): string {
  if (type === "demon") return "This imp enters play when you continue.";
  if (effectId === "event_first_aid") return "You keep this card to absorb 1 demon damage.";
  if (EVENT_ROLL_EFFECT_IDS.has(effectId)) return "Roll dice to resolve.";
  if (EVENT_PICK_ONE_EFFECT_IDS.has(effectId)) return "Choose one option.";
  return "";
}

function eventCardRevealMarkup(cardId: string): string {
  const def = cardDefs[cardId];
  if (!def) return "";
  const hint = eventCardFooterHint(def.effectId ?? "", def.type);
  const impMeta =
    def.type === "demon"
      ? `<p class="card-modal-meta">Imp · ${def.hp ?? 1} HP · ${def.attack ?? 1} ATK${def.persistent ? " · Persistent" : ""}</p>`
      : "";
  return `
    <div class="trigger-event-reveal">
      <p class="trigger-event-reveal-label"><strong>Event card drawn!</strong></p>
      <img class="trigger-event-reveal-img" src="${cardImg(cardId)}" alt="${cardName(cardId)}" />
      <p class="card-modal-meta">${cardName(cardId)}</p>
      ${impMeta}
      <p class="card-modal-effect">${def.effect ?? ""}</p>
      ${hint ? `<p class="trigger-event-reveal-hint card-modal-hint">${hint}</p>` : ""}
    </div>`;
}

function isEventDrawRoll(roll: number): boolean {
  return roll === 5 || roll === 6;
}

function rollDetailMarkup(pub: PublicGameState, hold: TriggerHold): string {
  if (hold.outcome === "trigger") {
    const possessedName = cardName(pub.possessedId);
    const def = cardDefs[pub.possessedId];
    return `
      <p class="trigger-roll-detail-roll">Roll: <strong>${hold.roll}</strong></p>
      <p class="trigger-roll-outcome">
        <strong>${possessedName} triggered!</strong><br />
        <span class="card-modal-effect">${def?.effect ?? "Possessed ability activates."}</span>
      </p>`;
  }
  if (hold.outcome === "event" && isEventDrawRoll(hold.roll)) {
    return `
      <p class="trigger-roll-detail-roll">Roll: <strong>${hold.roll}</strong></p>
      <p class="trigger-roll-outcome">
        <strong>Event!</strong><br />
        <span class="card-modal-effect">Draw an event card to see what happens.</span>
      </p>`;
  }
  return `
    <p class="trigger-roll-detail-roll">Roll: <strong>${hold.roll}</strong></p>
    <p class="trigger-roll-outcome">
      <strong>No effect</strong><br />
      <span class="card-modal-effect">Proceeding to the next cycle.</span>
    </p>`;
}

export function eventRollOutcomeMarkup(effectId: string, roll: number): string {
  switch (effectId) {
    case "event_morphin": {
      const dmg = roll <= 3 ? 1 : 3;
      return `<p class="trigger-roll-outcome"><strong>Morphin' Time</strong><br /><span class="card-modal-effect">${dmg} damage to all demons.</span></p>`;
    }
    case "event_dragon":
      return roll <= 3
        ? `<p class="trigger-roll-outcome"><strong>Pocket-Sized Dragon</strong><br /><span class="card-modal-effect">All players gain 1 energy.</span></p>`
        : `<p class="trigger-roll-outcome"><strong>Pocket-Sized Dragon</strong><br /><span class="card-modal-effect">All players gain 1 friendship.</span></p>`;
    case "event_phantom_fart":
      return roll <= 3
        ? `<p class="trigger-roll-outcome"><strong>The Phantom Fart</strong><br /><span class="card-modal-effect">All players lose 1 friendship.</span></p>`
        : `<p class="trigger-roll-outcome"><strong>The Phantom Fart</strong><br /><span class="card-modal-effect">Demons take 2 damage.</span></p>`;
    case "event_wrong_spell":
      return roll <= 3
        ? `<p class="trigger-roll-outcome"><strong>Oops, Wrong Spell!</strong><br /><span class="card-modal-effect">Possessed loses 1 HP.</span></p>`
        : `<p class="trigger-roll-outcome"><strong>Oops, Wrong Spell!</strong><br /><span class="card-modal-effect">All players gain 1 energy.</span></p>`;
    case "event_lost_hours":
      return roll <= 3
        ? `<p class="trigger-roll-outcome"><strong>Lost Hours</strong><br /><span class="card-modal-effect">Current Diurnal Cycle is discarded.</span></p>`
        : `<p class="trigger-roll-outcome"><strong>Lost Hours</strong><br /><span class="card-modal-effect">No effect.</span></p>`;
    default:
      return `<p class="trigger-roll-outcome"><span class="card-modal-effect">Effect resolved.</span></p>`;
  }
}

function appendTriggerRollActions(panel: HTMLElement): HTMLElement {
  const actions = document.createElement("div");
  actions.className = "card-modal-buttons trigger-roll-actions";
  panel.appendChild(actions);
  return actions;
}

function waitForButtonClick(btn: HTMLButtonElement, send?: (a: GameAction) => void): Promise<void> {
  return new Promise((resolve) => {
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

function waitForOkClick(panel: HTMLElement, send?: (a: GameAction) => void): Promise<void> {
  const btn = panel.querySelector(".trigger-outcome-ok") as HTMLButtonElement | null;
  if (!btn) return Promise.resolve();
  return waitForButtonClick(btn, send);
}

const EVENT_CARD_SCALE_IN_MS = 650;
const EVENT_CARD_SCALE_OUT_MS = 450;

async function scaleOutEventCard(panel: HTMLElement): Promise<void> {
  const img = panel.querySelector(".trigger-event-reveal-img") as HTMLElement | null;
  const reveal = panel.querySelector(".trigger-event-reveal") as HTMLElement | null;
  if (img) {
    img.classList.remove("is-scaling-in");
    img.classList.add("is-scaling-out");
  } else if (reveal) {
    reveal.classList.add("is-scaling-out");
  }
  await sleep(EVENT_CARD_SCALE_OUT_MS);
}

function prepareRollingPanelForHandoff(panel: HTMLElement): void {
  panel.classList.remove("trigger-roll-panel--event-only");
  panel.querySelector(".trigger-roll-outcome-host")?.remove();
  panel.querySelector(".trigger-roll-detail")?.remove();
  panel.querySelector(".trigger-roll-actions")?.remove();
  panel.querySelector(".trigger-roll-dice-host")?.remove();

  let title = panel.querySelector(".card-modal-title") as HTMLElement | null;
  if (!title) {
    panel.insertAdjacentHTML("afterbegin", `<h3 class="card-modal-title">Rolling…</h3>`);
    title = panel.querySelector(".card-modal-title") as HTMLElement;
  } else {
    title.textContent = "Rolling…";
  }

  title.insertAdjacentHTML("afterend", `<div class="trigger-roll-dice-host"></div>`);
  const host = panel.querySelector(".trigger-roll-dice-host") as HTMLElement;
  mountDiceScene(host, true);
}

function isRollEffectEventCard(cardId: string | undefined): boolean {
  if (!cardId) return false;
  const effectId = cardDefs[cardId]?.effectId;
  return !!effectId && EVENT_ROLL_EFFECT_IDS.has(effectId);
}

async function ensureLandedDice(panel: HTMLElement, roll: number, skipDice?: boolean): Promise<void> {
  const existingHost = panel.querySelector(".trigger-roll-dice-host") as HTMLElement | null;
  if (existingHost && isDiceLandedForRoll(existingHost, roll)) {
    setRollTitle(panel, "Rolled");
    return;
  }
  if (!skipDice) {
    await runTriggerDiceAnimation(panel, roll, { revealNumber: false, reuseHost: true });
    return;
  }
  let host = existingHost;
  if (!host) {
    if (!panel.querySelector(".card-modal-title")) {
      panel.innerHTML = `<h3 class="card-modal-title">Rolled</h3><div class="trigger-roll-dice-host"></div>`;
    } else {
      const title = panel.querySelector(".card-modal-title");
      title?.insertAdjacentHTML("afterend", `<div class="trigger-roll-dice-host"></div>`);
    }
    host = panel.querySelector(".trigger-roll-dice-host") as HTMLElement;
  }
  if (!isDiceLandedForRoll(host, roll)) {
    snapDiceToRoll(host, roll);
  }
  setRollTitle(panel, "Rolled");
}

export async function runTriggerRollModalPresentation(
  panel: HTMLElement,
  pub: PublicGameState,
  hold: TriggerHold,
  options?: { skipDice?: boolean; send?: (a: GameAction) => void }
): Promise<{ handoffToDice: boolean }> {
  await ensureLandedDice(panel, hold.roll, options?.skipDice);
  setRollTitle(panel, "Rolled");
  clearTriggerRollPresentation(panel);

  const diceHost = panel.querySelector(".trigger-roll-dice-host") as HTMLElement | null;
  const detail = document.createElement("div");
  detail.className = "trigger-roll-detail";
  detail.innerHTML = rollDetailMarkup(pub, hold);
  diceHost?.insertAdjacentElement("afterend", detail);

  const outcomeHost = document.createElement("div");
  outcomeHost.className = "trigger-roll-outcome-host";
  outcomeHost.hidden = true;
  detail.insertAdjacentElement("afterend", outcomeHost);

  const actions = appendTriggerRollActions(panel);

  if (hold.outcome === "event" && hold.eventCardId && isEventDrawRoll(hold.roll)) {
    const drawBtn = document.createElement("button");
    drawBtn.className = "btn trigger-draw-event-btn";
    drawBtn.type = "button";
    drawBtn.textContent = "Draw Event Card";
    actions.appendChild(drawBtn);

    const handoffToDice = isRollEffectEventCard(hold.eventCardId);

    await new Promise<void>((resolve) => {
      drawBtn.addEventListener(
        "click",
        () => {
          void (async () => {
            if (diceHost) {
              await scaleDownDiceScene(diceHost);
            }
            detail.remove();
            panel.classList.add("trigger-roll-panel--event-only");
            setRollTitle(panel, "Event Card");
            outcomeHost.innerHTML = eventCardRevealMarkup(hold.eventCardId!);
            outcomeHost.hidden = false;
            const img = outcomeHost.querySelector(".trigger-event-reveal-img");
            img?.classList.add("is-scaling-in");
            await waitForPaint();
            diceHost?.remove();
            await sleep(EVENT_CARD_SCALE_IN_MS);

            drawBtn.remove();

            const effectId = cardDefs[hold.eventCardId!]?.effectId ?? "";
            const pickOptions = EVENT_PICK_ONE_OPTIONS[effectId];

            if (pickOptions?.length) {
              actions.classList.add("trigger-event-options");
              const optionBtns: HTMLButtonElement[] = [];
              for (const opt of pickOptions) {
                const btn = document.createElement("button");
                btn.className = "btn trigger-outcome-ok trigger-event-option-btn";
                btn.type = "button";
                btn.textContent = opt.label;
                btn.addEventListener(
                  "click",
                  () => {
                    for (const b of optionBtns) b.disabled = true;
                    if (isFriendshipGainOption(opt.id)) {
                      snapshotFriendshipBeforeChoice(pub, getHumanPlayerId(pub));
                    }
                    options?.send?.({ type: "ACK_PRESENTATION" });
                    options?.send?.({ type: "RESOLVE_PICK_ONE", optionId: opt.id });
                    resolve();
                  },
                  { once: true }
                );
                optionBtns.push(btn);
                actions.appendChild(btn);
              }
            } else {
              const continueBtn = document.createElement("button");
              continueBtn.className = "btn trigger-outcome-ok";
              continueBtn.type = "button";
              continueBtn.textContent = "Continue";
              actions.appendChild(continueBtn);

              continueBtn.addEventListener(
                "click",
                () => {
                  void (async () => {
                    if (handoffToDice) {
                      await scaleOutEventCard(panel);
                      prepareRollingPanelForHandoff(panel);
                    }
                    options?.send?.({ type: "ACK_PRESENTATION" });
                    resolve();
                  })();
                },
                { once: true }
              );
            }
          })();
        },
        { once: true }
      );
    });
    return { handoffToDice };
  }

  actions.innerHTML = `<button class="btn trigger-outcome-ok" type="button">Continue</button>`;
  await waitForOkClick(panel, options?.send);
  return { handoffToDice: false };
}

export async function runEventRollModalPresentation(
  panel: HTMLElement,
  hold: EventRollHold,
  options?: { skipDice?: boolean; send?: (a: GameAction) => void }
): Promise<void> {
  await ensureLandedDice(panel, hold.roll, options?.skipDice);
  setRollTitle(panel, "Rolled");
  clearTriggerRollPresentation(panel);

  const diceHost = panel.querySelector(".trigger-roll-dice-host");
  const detail = document.createElement("div");
  detail.className = "trigger-roll-detail";
  detail.innerHTML = `
    <p class="trigger-roll-detail-roll">Roll: <strong>${hold.roll}</strong></p>
    ${eventRollOutcomeMarkup(hold.effectId, hold.roll)}`;
  diceHost?.insertAdjacentElement("afterend", detail);

  const actions = appendTriggerRollActions(panel);
  actions.innerHTML = `<button class="btn trigger-outcome-ok" type="button">Continue</button>`;
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
