import type { GameAction, PresentationHold, PublicGameState } from "../../shared/types.js";
import cardsData from "../../data/cards.json";
import { cardImg, cardName } from "./ws-client.js";

type TriggerHold = Extract<PresentationHold, { at: "post_trigger_roll" }>;

const cardDefs = Object.fromEntries(
  (cardsData as { id: string; name: string; effect?: string }[]).map((c) => [c.id, c])
);

const FACE_ROTATIONS: Record<number, string> = {
  1: "rotateX(0deg) rotateY(0deg)",
  2: "rotateX(-90deg) rotateY(0deg)",
  3: "rotateY(-90deg) rotateX(0deg)",
  4: "rotateY(90deg) rotateX(0deg)",
  5: "rotateX(90deg) rotateY(0deg)",
  6: "rotateX(180deg) rotateY(0deg)",
};

/** Tumble spin duration — decelerates into settle. */
const TUMBLE_DURATION_MS = 1650;
/** CSS settle transition length; keep in sync with `.dice-cube-3d.is-landed`. */
const SETTLE_DURATION_MS = 920;
/** Pause on landed face before the roll number is revealed. */
export const POST_LAND_HOLD_MS = 500;
const TUMBLE_STEPS = 16;

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

function buildTumblePath(): { rx: number; ry: number; rz: number }[] {
  const path: { rx: number; ry: number; rz: number }[] = [{ rx: 0, ry: 0, rz: 0 }];
  let rx = 0;
  let ry = 0;
  let rz = 0;
  for (let i = 0; i < TUMBLE_STEPS; i++) {
    const weight = 1 - i / TUMBLE_STEPS;
    const rxStep = (Math.floor(Math.random() * 3) + 1) * 90 * (0.55 + weight * 0.45);
    const ryStep = (Math.floor(Math.random() * 3) + 1) * 90 * (0.55 + weight * 0.45);
    const rzStep = (Math.floor(Math.random() * 2) + 1) * 45 * (0.5 + weight * 0.5);
    rx += rxStep;
    ry += ryStep;
    rz += rzStep;
    path.push({ rx, ry, rz });
  }
  return path;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export async function animatePhysicalDice(container: HTMLElement, finalRoll: number): Promise<void> {
  let cube = container.querySelector(".dice-cube-3d") as HTMLElement | null;
  const scene = container.querySelector(".dice-scene") as HTMLElement | null;
  if (!cube) {
    mountDiceScene(container, true);
    cube = container.querySelector(".dice-cube-3d") as HTMLElement | null;
  }
  if (!cube) return;

  cube.classList.add("is-tumbling");
  cube.classList.remove("is-landed", "is-holding");
  scene?.classList.remove("is-landed-pause");
  cube.style.transition = "none";

  const tumblePath = buildTumblePath();

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
      cube!.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`;
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });

  cube.classList.remove("is-tumbling");
  cube.classList.add("is-landed");
  scene?.classList.add("is-landed-pause");
  cube.style.transition = "";
  cube.style.transform = FACE_ROTATIONS[finalRoll] ?? FACE_ROTATIONS[1];
  await sleep(SETTLE_DURATION_MS);

  cube.classList.add("is-holding");
  await sleep(POST_LAND_HOLD_MS);
  cube.classList.remove("is-holding");
  scene?.classList.remove("is-landed-pause");
}

function revealRollNumber(panel: HTMLElement, roll: number): void {
  panel.innerHTML = `
    <h3 class="card-modal-title">Rolled</h3>
    <p class="dice-roll-result dice-roll-result--reveal">${roll}</p>
  `;
}

export async function runTriggerDiceAnimation(panel: HTMLElement, roll: number): Promise<void> {
  panel.innerHTML = `
    <h3 class="card-modal-title">Rolling…</h3>
    <div class="trigger-roll-dice-host"></div>
  `;
  const host = panel.querySelector(".trigger-roll-dice-host") as HTMLElement;
  mountDiceScene(host, true);
  await animatePhysicalDice(host, roll);
  revealRollNumber(panel, roll);
}

export function showRollResultWaiting(panel: HTMLElement, roll: number): void {
  panel.innerHTML = `
    <h3 class="card-modal-title">Rolled</h3>
    <p class="dice-roll-result">${roll}</p>
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
    panel.innerHTML = `
      <h3 class="card-modal-title">Rolling…</h3>
      <div class="trigger-roll-dice-host"></div>
    `;
    const host = panel.querySelector(".trigger-roll-dice-host") as HTMLElement;
    mountDiceScene(host, true);
    await animatePhysicalDice(host, hold.roll);
  }

  revealRollNumber(panel, hold.roll);
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
