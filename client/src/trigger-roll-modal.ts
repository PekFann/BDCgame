import type { GameAction, PrivateGameState, PublicGameState } from "../../shared/types.js";
import { closeDrawPhaseModalIfOpen } from "./draw-phase-modal.js";
import {
  hasLandedDiceHost,
  runTriggerDiceAnimation,
  runTriggerRollModalPresentation,
  showRollResultWaiting,
} from "./dice-animation.js";
import { isGameIntroDismissed } from "./game-start-modal.js";
import { closeAnimatedModal, forceCloseModal, openAnimatedModal } from "./modal-animations.js";

type SendFn = (action: GameAction) => void;

let modalEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;
let presentationRunning = false;
let rollSent = false;
let diceAnimRunning = false;
let completedDiceAnimKey: string | null = null;
let outcomePresentedKey = "";

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

function currentRoll(pub: PublicGameState): number | null {
  return pub.pendingRerollPrompt?.roll ?? pub.lastDiceRoll;
}

function diceAnimKey(pub: PublicGameState, roll: number, context = "trigger"): string {
  return `${pub.cycle}-${pub.dncPhaseIndex}-${roll}-${context}`;
}

function outcomeKey(pub: PublicGameState): string {
  const h = pub.presentationHold;
  if (h?.at !== "post_trigger_roll") return "";
  return `${pub.cycle}-${pub.dncPhaseIndex}-${h.roll}-${h.outcome}-${h.eventCardId ?? ""}`;
}

export function isTriggerRollOutcomePresented(pub: PublicGameState): boolean {
  const key = outcomeKey(pub);
  return key !== "" && key === outcomePresentedKey;
}

function rollContext(pub: PublicGameState): string {
  return pub.pendingRerollPrompt?.context ?? "trigger";
}

export function isTriggerRollModalOpen(): boolean {
  return modalEl !== null && !modalEl.hidden;
}

export function isTriggerDiceAnimDone(): boolean {
  return completedDiceAnimKey !== null && !diceAnimRunning;
}

export function isRerollDiceAnimReady(pub: PublicGameState): boolean {
  const prompt = pub.pendingRerollPrompt;
  const roll = prompt?.roll ?? pub.lastDiceRoll;
  if (roll === null) return isTriggerDiceAnimDone();
  const context = prompt?.context ?? "trigger";
  const key = diceAnimKey(pub, roll, context);
  return completedDiceAnimKey === key && !diceAnimRunning;
}

export function isTriggerRollAwaitingResult(pub: PublicGameState): boolean {
  if (pub.phase !== "triggers") return false;
  return (
    rollSent ||
    presentationRunning ||
    diceAnimRunning ||
    !!pub.pendingRerollPrompt ||
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
    !pub.pendingRerollPrompt &&
    !rollSent &&
    (priv?.legalActions ?? []).some((a) => a.type === "ROLL_DICE")
  );
}

export function isTriggerRollModalResponsible(
  pub: PublicGameState,
  priv: PrivateGameState | undefined
): boolean {
  return shouldShowTriggerRollModal(pub, priv) || isTriggerRollModalOpen() || presentationRunning || diceAnimRunning;
}

async function runDiceAnimIfNeeded(
  pub: PublicGameState,
  panel: HTMLElement,
  getPub?: () => PublicGameState | null | undefined
): Promise<void> {
  const roll = currentRoll(pub);
  if (roll === null) return;
  if (diceAnimRunning) return;

  const context = rollContext(pub);
  const key = diceAnimKey(pub, roll, context);
  if (completedDiceAnimKey === key) return;

  diceAnimRunning = true;
  presentationRunning = true;
  try {
    const { root } = ensureTriggerRollModal();
    if (root.hidden) openAnimatedModal(root, panel);

    await runTriggerDiceAnimation(panel, roll, { revealNumber: false });
    completedDiceAnimKey = key;

    const latest = getPub?.() ?? pub;
    if (
      rollSent &&
      !latest.pendingRerollPrompt &&
      latest.presentationHold?.at !== "post_trigger_roll"
    ) {
      showRollResultWaiting(panel, roll);
    }
  } finally {
    diceAnimRunning = false;
    presentationRunning = false;
  }
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
    completedDiceAnimKey = null;
    btn.disabled = true;
    btn.textContent = "Rolling…";
    send({ type: "ROLL_DICE" });
  });
}

export async function runTriggerRollPresentationIfNeeded(
  pub: PublicGameState,
  send?: SendFn
): Promise<boolean> {
  const hold = pub.presentationHold;
  if (hold?.at !== "post_trigger_roll" || presentationRunning) return false;

  const key = outcomeKey(pub);
  if (key && key === outcomePresentedKey) return false;

  const { root, panel } = ensureTriggerRollModal();
  if (root.hidden) openAnimatedModal(root, panel);

  presentationRunning = true;
  try {
    const context = rollContext(pub);
    const animKey = diceAnimKey(pub, hold.roll, context);
    // Prefer reusing a landed cube even if anim-key context drifted (avoids re-tumble hang).
    const skipDice = completedDiceAnimKey === animKey || hasLandedDiceHost(panel, hold.roll);
    await runTriggerRollModalPresentation(panel, pub, hold, { skipDice, send });
    outcomePresentedKey = key;
    forceCloseModal(root, panel);
    rollSent = false;
  } finally {
    presentationRunning = false;
  }
  return true;
}

export function refreshTriggerRollModal(
  pub: PublicGameState,
  priv: PrivateGameState | undefined,
  send: SendFn,
  getPub?: () => PublicGameState | null | undefined
): void {
  const { root, panel } = ensureTriggerRollModal();

  if (pub.phase !== "triggers") {
    resetTriggerRollClientFlags();
    outcomePresentedKey = "";
    if (!root.hidden && !presentationRunning && !diceAnimRunning) {
      closeAnimatedModal(root, panel, () => {});
    }
    return;
  }

  if (pub.presentationHold?.at === "post_trigger_roll") {
    if (root.hidden) openAnimatedModal(root, panel);
    // Retry until Continue/outcome is shown (guards against silent stalls on Resolving…).
    if (
      !isTriggerRollPresentationRunning() &&
      !isTriggerRollOutcomePresented(pub)
    ) {
      void runTriggerRollPresentationIfNeeded(pub, send);
    }
    return;
  }

  const roll = currentRoll(pub);
  if ((pub.pendingRerollPrompt || (rollSent && roll !== null)) && roll !== null) {
    if (root.hidden) openAnimatedModal(root, panel);
    const context = rollContext(pub);
    const key = diceAnimKey(pub, roll, context);
    if (!diceAnimRunning) {
      if (completedDiceAnimKey === key) {
        if (
          pub.pendingRerollPrompt &&
          !panel.querySelector(".trigger-roll-resolving") &&
          !panel.querySelector(".card-modal-buttons")
        ) {
          showRollResultWaiting(panel, roll);
        } else if (rollSent && !pub.pendingRerollPrompt) {
          showRollResultWaiting(panel, roll);
        }
      } else {
        void runDiceAnimIfNeeded(pub, panel, getPub);
      }
    }
    return;
  }

  if (!shouldShowTriggerRollModal(pub, priv)) {
    if (isTriggerRollAwaitingResult(pub)) return;
    if (!root.hidden && !presentationRunning && !diceAnimRunning) {
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
  return presentationRunning || diceAnimRunning;
}

export function resetTriggerRollClientFlags(): void {
  rollSent = false;
  presentationRunning = false;
  diceAnimRunning = false;
  completedDiceAnimKey = null;
}

export function resetTriggerRollModal(): void {
  resetTriggerRollClientFlags();
  outcomePresentedKey = "";
  if (modalEl && panelEl && !modalEl.hidden) {
    forceCloseModal(modalEl, panelEl);
  }
}
