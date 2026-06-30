import type { PresentationHold, PublicGameState } from "../../shared/types.js";
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
    .map(
      (f) =>
        `<div class="dice-face ${f.cls}" data-value="${f.value}">${pips}</div>`
    )
    .join("");
}

export function mountDiceScene(container: HTMLElement): HTMLElement {
  container.innerHTML = `
    <div class="dice-scene">
      <div class="dice-cube-3d">${createDiceCubeMarkup()}</div>
    </div>
  `;
  return container.querySelector(".dice-cube-3d") as HTMLElement;
}

export async function animatePhysicalDice(container: HTMLElement, finalRoll: number): Promise<void> {
  let cube = container.querySelector(".dice-cube-3d") as HTMLElement | null;
  if (!cube) {
    mountDiceScene(container);
    cube = container.querySelector(".dice-cube-3d") as HTMLElement | null;
  }
  if (!cube) return;

  cube.classList.add("is-tumbling");
  cube.classList.remove("is-landed");

  const tumbleSteps = 14;
  for (let i = 0; i < tumbleSteps; i++) {
    const rx = Math.floor(Math.random() * 4) * 90;
    const ry = Math.floor(Math.random() * 4) * 90;
    const rz = Math.floor(Math.random() * 3) * 45;
    cube.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`;
    await sleep(70 + i * 8);
  }

  cube.classList.remove("is-tumbling");
  cube.classList.add("is-landed");
  cube.style.transform = FACE_ROTATIONS[finalRoll] ?? FACE_ROTATIONS[1];
  await sleep(650);
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
      <p class="trigger-roll-outcome">
        <strong>Event card drawn!</strong><br />
        <img src="${cardImg(hold.eventCardId)}" alt="${cardName(hold.eventCardId)}" />
        <span class="card-modal-meta">${cardName(hold.eventCardId)}</span><br />
        <span class="card-modal-effect">${def?.effect ?? ""}</span>
      </p>`;
  }
  return `
    <p class="trigger-roll-outcome">
      <strong>No effect</strong><br />
      <span class="card-modal-effect">Proceeding to the next cycle.</span>
    </p>`;
}

export async function runTriggerRollModalPresentation(
  panel: HTMLElement,
  pub: PublicGameState,
  hold: TriggerHold
): Promise<void> {
  panel.innerHTML = `
    <h3 class="card-modal-title">Rolling…</h3>
    <div class="trigger-roll-dice-host"></div>
  `;
  const host = panel.querySelector(".trigger-roll-dice-host") as HTMLElement;
  mountDiceScene(host);
  await animatePhysicalDice(host, hold.roll);

  panel.innerHTML = `
    <h3 class="card-modal-title">Rolled ${hold.roll}</h3>
    ${outcomeMarkup(pub, hold)}
  `;
  await sleep(1200);
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

  mountDiceScene(overlay);
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
