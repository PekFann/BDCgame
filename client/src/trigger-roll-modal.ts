import type { GameAction, PrivateGameState, PublicGameState } from "../../shared/types.js";

import { closeDrawPhaseModalIfOpen } from "./draw-phase-modal.js";

import { runTriggerRollModalPresentation } from "./dice-animation.js";

import { isGameIntroDismissed } from "./game-start-modal.js";

import { closeAnimatedModal, forceCloseModal, openAnimatedModal } from "./modal-animations.js";



type SendFn = (action: GameAction) => void;



let modalEl: HTMLElement | null = null;

let panelEl: HTMLElement | null = null;

let presentationRunning = false;

let rollSent = false;



function ensureTriggerRollModal(): { root: HTMLElement; panel: HTMLElement } {

  if (modalEl && panelEl) return { root: modalEl, panel: panelEl };



  modalEl = document.createElement("div");

  modalEl.id = "trigger-roll-modal";

  modalEl.className = "card-modal trigger-roll-modal";

  modalEl.hidden = true;

  modalEl.innerHTML = `

    <div class="card-modal-backdrop modal-overlay"></div>

    <div class="trigger-roll-panel modal-panel"></div>

  `;



  panelEl = modalEl.querySelector(".trigger-roll-panel") as HTMLElement;

  document.body.appendChild(modalEl);

  return { root: modalEl, panel: panelEl };

}



function introAllowsTriggerModal(pub: PublicGameState): boolean {

  return isGameIntroDismissed() || pub.introAcknowledged;

}



export function isTriggerRollModalOpen(): boolean {

  return modalEl !== null && !modalEl.hidden;

}



export function isTriggerRollAwaitingResult(pub: PublicGameState): boolean {

  return (

    rollSent ||

    presentationRunning ||

    pub.presentationHold?.at === "post_trigger_roll"

  );

}



export function shouldShowTriggerRollModal(

  pub: PublicGameState,

  priv: PrivateGameState | undefined

): boolean {

  return (

    pub.phase === "triggers" &&

    pub.started &&

    introAllowsTriggerModal(pub) &&

    !pub.presentationHold &&

    (priv?.legalActions ?? []).some((a) => a.type === "ROLL_DICE")

  );

}



export function isTriggerRollModalResponsible(

  pub: PublicGameState,

  priv: PrivateGameState | undefined

): boolean {

  return shouldShowTriggerRollModal(pub, priv) || isTriggerRollModalOpen() || presentationRunning;

}



function showPrompt(panel: HTMLElement, send: SendFn): void {

  panel.innerHTML = `

    <h3 class="card-modal-title">Triggers &amp; Events</h3>

    <p class="card-modal-effect">Roll the dice to resolve possessed triggers or draw an event card.</p>

    <div class="card-modal-buttons">

      <button class="btn trigger-roll-btn" type="button">Roll Dice</button>

    </div>

  `;

  const btn = panel.querySelector(".trigger-roll-btn") as HTMLButtonElement;

  btn?.addEventListener("click", () => {

    rollSent = true;

    btn.disabled = true;

    btn.textContent = "Rolling…";

    send({ type: "ROLL_DICE" });

  });

}



export async function runTriggerRollPresentationIfNeeded(

  pub: PublicGameState

): Promise<boolean> {

  const hold = pub.presentationHold;

  if (hold?.at !== "post_trigger_roll" || presentationRunning) return false;



  const { root, panel } = ensureTriggerRollModal();

  if (root.hidden) openAnimatedModal(root, panel);



  presentationRunning = true;

  try {

    await runTriggerRollModalPresentation(panel, pub, hold);

    forceCloseModal(root, panel);

  } finally {

    presentationRunning = false;

    rollSent = false;

  }

  return true;

}



export function refreshTriggerRollModal(

  pub: PublicGameState,

  priv: PrivateGameState | undefined,

  send: SendFn

): void {

  const { root, panel } = ensureTriggerRollModal();



  if (pub.presentationHold?.at === "post_trigger_roll") {
    if (root.hidden) openAnimatedModal(root, panel);
    return;
  }

  if (!shouldShowTriggerRollModal(pub, priv)) {
    if (isTriggerRollAwaitingResult(pub)) return;

    if (!root.hidden && !presentationRunning) {

      closeAnimatedModal(root, panel, () => {});

      rollSent = false;

    }

    return;

  }



  closeDrawPhaseModalIfOpen();
  showPrompt(panel, send);
  if (root.hidden) {
    openAnimatedModal(root, panel);
  } else {
    root.hidden = false;
    root.style.pointerEvents = "";
    panel.classList.remove("is-closing");
    root.classList.remove("is-closing");
    root.querySelector(".card-modal-backdrop, .modal-overlay")?.classList.remove("is-closing");
  }

}



export function isTriggerRollPresentationRunning(): boolean {
  return presentationRunning;
}

export function resetTriggerRollModal(): void {

  rollSent = false;

  presentationRunning = false;

  if (modalEl && panelEl && !modalEl.hidden) {

    forceCloseModal(modalEl, panelEl);

  }

}


