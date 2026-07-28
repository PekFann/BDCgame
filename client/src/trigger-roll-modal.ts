import type { GameAction, PrivateGameState, PublicGameState } from "../../shared/types.js";
import { closeDrawPhaseModalIfOpen } from "./draw-phase-modal.js";
import {
  clearTriggerRollPresentation,
  hasLandedDiceHost,
  resetTriggerRollDiceHost,
  runTriggerDiceAnimation,
  runTriggerRollModalPresentation,
  runEventRollModalPresentation,
  runCardRollModalPresentation,
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
let eventRollPresentedKey = "";
let cardRollPresentedKey = "";
let resolvingPollId: ReturnType<typeof setInterval> | null = null;

function clearResolvingPoll(): void {
  if (resolvingPollId !== null) {
    clearInterval(resolvingPollId);
    resolvingPollId = null;
  }
}

function scheduleResolvingPoll(
  getPub: () => PublicGameState | null | undefined,
  send: SendFn
): void {
  if (resolvingPollId !== null) return;
  let attempts = 0;
  resolvingPollId = setInterval(() => {
    attempts += 1;
    const pub = getPub();
    if (!pub) return;
    if (
      pub.presentationHold?.at === "post_trigger_roll" ||
      pub.presentationHold?.at === "post_event_roll" ||
      pub.presentationHold?.at === "post_card_roll"
    ) {
      clearResolvingPoll();
      if (pub.presentationHold.at === "post_trigger_roll") {
        void runTriggerRollPresentationIfNeeded(pub, send);
      } else if (pub.presentationHold.at === "post_event_roll") {
        void runEventRollPresentationIfNeeded(pub, send);
      } else {
        void runCardRollPresentationIfNeeded(pub, send);
      }
      return;
    }
    if (attempts >= 40) clearResolvingPoll();
  }, 200);
}

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

function eventRollOutcomeKey(pub: PublicGameState): string {
  const h = pub.presentationHold;
  if (h?.at !== "post_event_roll") return "";
  return `${pub.cycle}-${pub.dncPhaseIndex}-${h.roll}-${h.effectId}`;
}

function cardRollOutcomeKey(pub: PublicGameState): string {
  const h = pub.presentationHold;
  if (h?.at !== "post_card_roll") return "";
  return `${pub.cycle}-${pub.dncPhaseIndex}-${h.roll}-${h.effectId}-${h.playerId}`;
}

export function isCardRollOutcomePresented(pub: PublicGameState): boolean {
  const key = cardRollOutcomeKey(pub);
  return key !== "" && key === cardRollPresentedKey;
}

export function isEventRollOutcomePresented(pub: PublicGameState): boolean {
  const key = eventRollOutcomeKey(pub);
  return key !== "" && key === eventRollPresentedKey;
}

export function isTriggerRollOutcomePresented(pub: PublicGameState): boolean {
  const key = outcomeKey(pub);
  return key !== "" && key === outcomePresentedKey;
}

function rollContext(pub: PublicGameState): string {
  if (pub.pendingRerollPrompt?.context) return pub.pendingRerollPrompt.context;
  if (pub.presentationHold?.at === "post_card_roll") return "card";
  return "trigger";
}

function isCardRollFlowActive(pub: PublicGameState): boolean {
  return (
    pub.presentationHold?.at === "post_card_roll" || pub.pendingRerollPrompt?.context === "card"
  );
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
  const context = rollContext(pub);
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
    pub.presentationHold?.at === "post_trigger_roll" ||
    pub.presentationHold?.at === "post_event_roll"
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
  send: SendFn,
  getPub?: () => PublicGameState | null | undefined,
  onDiceAnimComplete?: (pub: PublicGameState) => void
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

    if (context === "card") {
      clearTriggerRollPresentation(panel);
      resetTriggerRollDiceHost(panel);
    }

    await runTriggerDiceAnimation(panel, roll, { revealNumber: false });
    completedDiceAnimKey = key;

    const latest = getPub?.() ?? pub;
    if (
      rollSent &&
      !latest.pendingRerollPrompt &&
      latest.presentationHold?.at !== "post_trigger_roll" &&
      latest.presentationHold?.at !== "post_event_roll" &&
      latest.presentationHold?.at !== "post_card_roll"
    ) {
      showRollResultWaiting(panel, roll);
      scheduleResolvingPoll(getPub ?? (() => pub), send);
    }
  } finally {
    diceAnimRunning = false;
    presentationRunning = false;
  }

  onDiceAnimComplete?.(getPub?.() ?? pub);
}

function showPrompt(panel: HTMLElement, send: SendFn): void {
  panel.classList.remove("trigger-roll-panel--event-only");
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

  // Lock synchronously so refresh + orchestrator cannot both start a tumble.
  presentationRunning = true;
  if (key) outcomePresentedKey = key;
  try {
    const { root, panel } = ensureTriggerRollModal();
    if (root.hidden) openAnimatedModal(root, panel);

    // Skip re-tumble if Path A already animated this roll (e.g. before Time Travel Keep).
    const animDone =
      completedDiceAnimKey === diceAnimKey(pub, hold.roll, rollContext(pub));
    const skipDice = hasLandedDiceHost(panel, hold.roll) || animDone;
    const { handoffToDice } = await runTriggerRollModalPresentation(panel, pub, hold, {
      skipDice,
      send,
    });
    completedDiceAnimKey = diceAnimKey(pub, hold.roll, rollContext(pub));
    if (!handoffToDice) {
      forceCloseModal(root, panel);
    }
    rollSent = false;
    clearResolvingPoll();
  } catch (err) {
    if (key && outcomePresentedKey === key) outcomePresentedKey = "";
    throw err;
  } finally {
    presentationRunning = false;
  }
  return true;
}

export async function runEventRollPresentationIfNeeded(
  pub: PublicGameState,
  send?: SendFn
): Promise<boolean> {
  const hold = pub.presentationHold;
  if (hold?.at !== "post_event_roll" || presentationRunning) return false;

  const key = eventRollOutcomeKey(pub);
  if (key && key === eventRollPresentedKey) return false;

  presentationRunning = true;
  if (key) eventRollPresentedKey = key;
  try {
    const { root, panel } = ensureTriggerRollModal();
    if (root.hidden) openAnimatedModal(root, panel);

    const animDone =
      completedDiceAnimKey === diceAnimKey(pub, hold.roll, rollContext(pub));
    const skipDice = hasLandedDiceHost(panel, hold.roll) || animDone;
    await runEventRollModalPresentation(panel, hold, { skipDice, send });
    completedDiceAnimKey = diceAnimKey(pub, hold.roll, rollContext(pub));
    forceCloseModal(root, panel);
    rollSent = false;
  } catch (err) {
    if (key && eventRollPresentedKey === key) eventRollPresentedKey = "";
    throw err;
  } finally {
    presentationRunning = false;
  }
  return true;
}

export async function runCardRollPresentationIfNeeded(
  pub: PublicGameState,
  send?: SendFn
): Promise<boolean> {
  const hold = pub.presentationHold;
  if (hold?.at !== "post_card_roll" || presentationRunning) return false;

  const key = cardRollOutcomeKey(pub);
  if (key && key === cardRollPresentedKey) return false;

  presentationRunning = true;
  if (key) cardRollPresentedKey = key;
  try {
    const { root, panel } = ensureTriggerRollModal();
    if (root.hidden) openAnimatedModal(root, panel);

    clearTriggerRollPresentation(panel);
    resetTriggerRollDiceHost(panel);
    await runCardRollModalPresentation(panel, hold, {
      skipDice: false,
      send,
      discardCount: pub.actionDiscard?.length ?? 0,
    });
    forceCloseModal(root, panel);
    rollSent = false;
  } catch (err) {
    if (key && cardRollPresentedKey === key) cardRollPresentedKey = "";
    throw err;
  } finally {
    presentationRunning = false;
  }
  return true;
}

export function refreshTriggerRollModal(
  pub: PublicGameState,
  priv: PrivateGameState | undefined,
  send: SendFn,
  getPub?: () => PublicGameState | null | undefined,
  onDiceAnimComplete?: (pub: PublicGameState) => void
): void {
  const { root, panel } = ensureTriggerRollModal();

  if (pub.phase !== "triggers" && !isCardRollFlowActive(pub)) {
    clearResolvingPoll();
    resetTriggerRollClientFlags();
    outcomePresentedKey = "";
    eventRollPresentedKey = "";
    cardRollPresentedKey = "";
    if (!root.hidden && !presentationRunning && !diceAnimRunning) {
      closeAnimatedModal(root, panel, () => {});
    }
    return;
  }

  if (pub.presentationHold?.at === "post_card_roll") {
    clearResolvingPoll();
    if (isCardRollOutcomePresented(pub)) return;
    if (root.hidden) openAnimatedModal(root, panel);
    if (!isTriggerRollPresentationRunning() && !isCardRollOutcomePresented(pub)) {
      void runCardRollPresentationIfNeeded(pub, send);
    }
    return;
  }

  if (pub.phase !== "triggers") {
    const roll = currentRoll(pub);
    if (pub.pendingRerollPrompt?.context === "card" && roll !== null) {
      if (root.hidden) openAnimatedModal(root, panel);
      const key = diceAnimKey(pub, roll, "card");
      if (!diceAnimRunning) {
        if (completedDiceAnimKey === key) {
          if (
            pub.pendingRerollPrompt &&
            !panel.querySelector(".trigger-roll-resolving") &&
            !panel.querySelector(".card-modal-buttons")
          ) {
            showRollResultWaiting(panel, roll);
          }
          onDiceAnimComplete?.(pub);
        } else {
          void runDiceAnimIfNeeded(pub, panel, send, getPub, onDiceAnimComplete);
        }
      }
    }
    return;
  }

  if (pub.presentationHold?.at === "post_trigger_roll") {
    clearResolvingPoll();
    if (isTriggerRollOutcomePresented(pub)) return;
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

  if (pub.presentationHold?.at === "post_event_roll") {
    clearResolvingPoll();
    if (isEventRollOutcomePresented(pub)) return;
    if (root.hidden) openAnimatedModal(root, panel);
    if (!isTriggerRollPresentationRunning() && !isEventRollOutcomePresented(pub)) {
      void runEventRollPresentationIfNeeded(pub, send);
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
          scheduleResolvingPoll(getPub ?? (() => pub), send);
        }
        onDiceAnimComplete?.(pub);
      } else {
        void runDiceAnimIfNeeded(pub, panel, send, getPub, onDiceAnimComplete);
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
  clearResolvingPoll();
}

export function resetTriggerRollModal(): void {
  resetTriggerRollClientFlags();
  outcomePresentedKey = "";
  eventRollPresentedKey = "";
  cardRollPresentedKey = "";
  panelEl?.classList.remove("trigger-roll-panel--event-only");
  if (panelEl) {
    clearTriggerRollPresentation(panelEl);
    resetTriggerRollDiceHost(panelEl);
  }
  if (modalEl && panelEl && !modalEl.hidden) {
    forceCloseModal(modalEl, panelEl);
  }
}
