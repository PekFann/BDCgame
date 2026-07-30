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
  whenDiceAnimSettled,
} from "./dice-animation.js";
import { closeAnimatedModal, forceCloseModal, openAnimatedModal } from "./modal-animations.js";

type SendFn = (action: GameAction) => void;
type DiceFamily = "phase" | "card";

let modalEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;
let presentationRunning = false;
let rollSent = false;
let diceAnimRunning = false;

/** Trigger + event_effect rolls share phase anim state. */
let phaseDiceAnimKey: string | null = null;
/** Card rolls (Wild Card, Talk It Out, etc.) use separate anim state. */
let cardDiceAnimKey: string | null = null;

let outcomePresentedKey = "";
let eventRollPresentedKey = "";
let cardRollPresentedKey = "";

let lastTrackedPhaseRoll: number | null = null;
let lastTrackedPhaseContext: string | null = null;
let lastTrackedCardRoll: number | null = null;

/** After TT Accept: wait for the post-reroll tumble; do not clear anim keys during discard. */
let forceFreshDiceAfterAccept = false;
let acceptedRerollBaselineRoll: number | null = null;

let resolvingPollId: ReturnType<typeof setInterval> | null = null;
let eventRollRefreshRetryScheduled = false;
let cardRollRefreshRetryScheduled = false;
let triggerRollRefreshRetryScheduled = false;

function isTimeTravelDiscardPending(pub: PublicGameState): boolean {
  return pub.pendingChoice?.kind === "discard_cards" && !!pub.pendingRerollPrompt;
}

function diceFamily(context: string): DiceFamily {
  return context === "card" ? "card" : "phase";
}

function getCompletedDiceAnimKey(context: string): string | null {
  return diceFamily(context) === "card" ? cardDiceAnimKey : phaseDiceAnimKey;
}

function setCompletedDiceAnimKey(context: string, key: string | null): void {
  if (diceFamily(context) === "card") {
    cardDiceAnimKey = key;
  } else {
    phaseDiceAnimKey = key;
  }
}

function resetFamilyPresentationState(family: DiceFamily, panel?: HTMLElement | null): void {
  if (family === "card") {
    cardDiceAnimKey = null;
    cardRollPresentedKey = "";
    lastTrackedCardRoll = null;
  } else {
    phaseDiceAnimKey = null;
    outcomePresentedKey = "";
    eventRollPresentedKey = "";
    lastTrackedPhaseRoll = null;
    lastTrackedPhaseContext = null;
  }
  const p = panel ?? panelEl;
  if (p) {
    clearTriggerRollPresentation(p);
    resetTriggerRollDiceHost(p);
  }
}

/** Clear phase (trigger/event) dice anim so a new event tumble can start after handoff. */
export function clearPhaseDiceAnimState(): void {
  phaseDiceAnimKey = null;
  lastTrackedPhaseRoll = null;
  lastTrackedPhaseContext = null;
}

/** Call when the player accepts Time Travel so the next (post-reroll) tumble runs fresh. */
export function notifyRerollAccepted(_context?: string, roll?: number): void {
  forceFreshDiceAfterAccept = true;
  acceptedRerollBaselineRoll = roll ?? null;
  // Do not clear completed keys/host here — pendingRerollPrompt still holds the old roll
  // during discard; clearing would restart a hidden tumble and block the real reroll.
}

function syncTrackedRoll(pub: PublicGameState, panel: HTMLElement): void {
  const roll = currentRoll(pub);
  const context = rollContext(pub);
  if (roll === null) return;

  const family = diceFamily(context);
  if (family === "card") {
    if (lastTrackedCardRoll !== null && lastTrackedCardRoll !== roll) {
      resetFamilyPresentationState("card", panel);
    }
    lastTrackedCardRoll = roll;
    return;
  }

  // Phase family: only reset on roll number change (not trigger ↔ event_effect alias).
  if (lastTrackedPhaseRoll !== null && lastTrackedPhaseRoll !== roll) {
    resetFamilyPresentationState("phase", panel);
  }
  lastTrackedPhaseRoll = roll;
  lastTrackedPhaseContext = context;
}

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
        void runTriggerRollPresentationIfNeeded(pub, send, getPub);
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

/** Reopen without fade when a landed die is already in the panel (avoids flash after TT). */
function openTriggerModalIfHidden(
  root: HTMLElement,
  panel: HTMLElement,
  roll: number | null
): void {
  if (!root.hidden) return;
  const skipAnimation = roll !== null && hasLandedDiceHost(panel, roll);
  openAnimatedModal(root, panel, { skipAnimation });
}

function introAllowsTriggerModal(pub: PublicGameState): boolean {
  // Server ack only — local dismiss alone must not auto-send ROLL_DICE.
  return !!pub.introAcknowledged;
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
  const hold = pub.presentationHold;
  if (hold?.at === "post_card_roll") return "card";
  if (hold?.at === "post_event_roll") return "event_effect";
  if (hold?.at === "post_trigger_roll") return "trigger";
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
  return (phaseDiceAnimKey !== null || cardDiceAnimKey !== null) && !diceAnimRunning;
}

export function isRerollDiceAnimReady(pub: PublicGameState): boolean {
  if (isTimeTravelDiscardPending(pub)) return false;
  if (forceFreshDiceAfterAccept) return false;
  const prompt = pub.pendingRerollPrompt;
  const roll = prompt?.roll ?? pub.lastDiceRoll;
  if (roll === null) return isTriggerDiceAnimDone();
  const context = rollContext(pub);
  const key = diceAnimKey(pub, roll, context);
  return getCompletedDiceAnimKey(context) === key && !diceAnimRunning;
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
  // TT discard keeps the old pendingRerollPrompt — do not re-tumble that roll.
  if (isTimeTravelDiscardPending(pub)) return;
  if (diceAnimRunning) return;

  const context = rollContext(pub);
  const key = diceAnimKey(pub, roll, context);
  const shouldForceFresh = forceFreshDiceAfterAccept;

  if (!shouldForceFresh && getCompletedDiceAnimKey(context) === key) return;

  if (shouldForceFresh) {
    setCompletedDiceAnimKey(context, null);
    clearTriggerRollPresentation(panel);
    resetTriggerRollDiceHost(panel);
  }

  diceAnimRunning = true;
  presentationRunning = true;
  try {
    const { root } = ensureTriggerRollModal();
    openTriggerModalIfHidden(root, panel, roll);

    const existingHost = panel.querySelector(".trigger-roll-dice-host") as HTMLElement | null;
    // Do not wipe a host already landed for this roll (avoids Path A → Path B double tumble).
    if (!hasLandedDiceHost(panel, roll) && (context === "card" || existingHost)) {
      clearTriggerRollPresentation(panel);
      resetTriggerRollDiceHost(panel);
    }

    await runTriggerDiceAnimation(panel, roll, { revealNumber: false });
    setCompletedDiceAnimKey(context, key);

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
    if (shouldForceFresh) {
      forceFreshDiceAfterAccept = false;
      acceptedRerollBaselineRoll = null;
    }
  }

  const after = getPub?.() ?? pub;
  // Path A finished while ACK already produced post_card_roll — present outcome without re-tumble.
  if (
    after.presentationHold?.at === "post_card_roll" &&
    !isCardRollOutcomePresented(after)
  ) {
    void runCardRollPresentationIfNeeded(after, send);
  }

  onDiceAnimComplete?.(after);
}

function showPrompt(panel: HTMLElement, send: SendFn): void {
  panel.classList.remove("trigger-roll-panel--event-only");
  if (rollSent) return;

  panel.innerHTML = `
    <h3 class="card-modal-title">Rolling…</h3>
    <div class="trigger-roll-dice-host"></div>
  `;
  rollSent = true;
  phaseDiceAnimKey = null;
  send({ type: "ROLL_DICE" });
}

function kickEventEffectFollowUp(
  send?: SendFn,
  getPub?: () => PublicGameState | null | undefined,
  onDiceAnimComplete?: (pub: PublicGameState) => void
): void {
  const latest = getPub?.() ?? null;
  if (!latest) return;

  if (latest.presentationHold?.at === "post_event_roll") {
    if (!isEventRollOutcomePresented(latest) && !presentationRunning) {
      void runEventRollPresentationIfNeeded(latest, send);
    }
    return;
  }

  if (latest.pendingRerollPrompt?.context === "event_effect") {
    const { root, panel } = ensureTriggerRollModal();
    const roll = currentRoll(latest);
    if (roll === null) return;
    openTriggerModalIfHidden(root, panel, roll);
    void runDiceAnimIfNeeded(latest, panel, send ?? (() => {}), getPub, onDiceAnimComplete);
  }
}

function scheduleEventEffectFollowUp(
  send?: SendFn,
  getPub?: () => PublicGameState | null | undefined,
  onDiceAnimComplete?: (pub: PublicGameState) => void
): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      kickEventEffectFollowUp(send, getPub, onDiceAnimComplete);
    });
  });
}

export async function runTriggerRollPresentationIfNeeded(
  pub: PublicGameState,
  send?: SendFn,
  getPub?: () => PublicGameState | null | undefined,
  onDiceAnimComplete?: (pub: PublicGameState) => void
): Promise<boolean> {
  const hold = pub.presentationHold;
  if (hold?.at !== "post_trigger_roll" || presentationRunning) return false;

  const key = outcomeKey(pub);
  if (key && key === outcomePresentedKey) return false;

  // Lock synchronously so refresh + orchestrator cannot both start a tumble.
  presentationRunning = true;
  let handoffToDice = false;
  try {
    const { root, panel } = ensureTriggerRollModal();
    openTriggerModalIfHidden(root, panel, hold.roll);

    const diceHost = panel.querySelector(".trigger-roll-dice-host") as HTMLElement | null;
    if (diceHost) await whenDiceAnimSettled(diceHost);

    const context = rollContext(pub);
    // Skip re-tumble if Path A already animated this roll (e.g. before Time Travel Keep).
    const animDone = getCompletedDiceAnimKey(context) === diceAnimKey(pub, hold.roll, context);
    const skipDice = hasLandedDiceHost(panel, hold.roll) || animDone;
    const result = await runTriggerRollModalPresentation(panel, pub, hold, {
      skipDice,
      send,
      onEventHandoff: clearPhaseDiceAnimState,
    });
    handoffToDice = result.handoffToDice;
    // Do not stamp the old trigger roll as completed when handing off to event-effect dice —
    // that confused Path A / post_event_roll skipDice detection.
    if (!handoffToDice) {
      setCompletedDiceAnimKey(context, diceAnimKey(pub, hold.roll, context));
    }
    // Mark complete only after Continue / event flow finishes (ACK sent).
    if (key) outcomePresentedKey = key;
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

  if (handoffToDice) {
    scheduleEventEffectFollowUp(send, getPub, onDiceAnimComplete);
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
  try {
    const { root, panel } = ensureTriggerRollModal();
    openTriggerModalIfHidden(root, panel, hold.roll);

    const diceHost = panel.querySelector(".trigger-roll-dice-host") as HTMLElement | null;
    if (diceHost) await whenDiceAnimSettled(diceHost);

    const context = rollContext(pub);
    const animDone = getCompletedDiceAnimKey(context) === diceAnimKey(pub, hold.roll, context);
    const skipDice = hasLandedDiceHost(panel, hold.roll) || animDone;
    await runEventRollModalPresentation(panel, hold, { skipDice, send });
    setCompletedDiceAnimKey(context, diceAnimKey(pub, hold.roll, context));
    if (key) eventRollPresentedKey = key;
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
  try {
    const { root, panel } = ensureTriggerRollModal();
    openTriggerModalIfHidden(root, panel, hold.roll);

    const diceHost = panel.querySelector(".trigger-roll-dice-host") as HTMLElement | null;
    if (diceHost) await whenDiceAnimSettled(diceHost);

    const context = "card";
    const animDone = getCompletedDiceAnimKey(context) === diceAnimKey(pub, hold.roll, context);
    const skipDice = hasLandedDiceHost(panel, hold.roll) || animDone;
    // Keep landed Path A cube; only clear chrome (Resolving…, etc.).
    clearTriggerRollPresentation(panel);
    if (!skipDice) {
      resetTriggerRollDiceHost(panel);
    }
    await runCardRollModalPresentation(panel, hold, {
      skipDice,
      send,
      discardCount: pub.actionDiscard?.length ?? 0,
    });
    setCompletedDiceAnimKey(context, diceAnimKey(pub, hold.roll, context));
    if (key) cardRollPresentedKey = key;
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
  syncTrackedRoll(pub, panel);

  // Cycle toast window: phase may still be previous cycle's "triggers" — do not treat as active roll.
  if (pub.presentationHold?.at === "cycle_start") {
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

  // Cycle 1 intro gate: phase may already be triggers before ACK_GAME_INTRO.
  const holdAt = pub.presentationHold?.at;
  if (
    pub.cycle === 1 &&
    !pub.introAcknowledged &&
    holdAt !== "post_trigger_roll" &&
    holdAt !== "post_event_roll" &&
    holdAt !== "post_card_roll"
  ) {
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
    openTriggerModalIfHidden(root, panel, pub.presentationHold.roll);
    if (!isTriggerRollPresentationRunning() && !isCardRollOutcomePresented(pub)) {
      cardRollRefreshRetryScheduled = false;
      void runCardRollPresentationIfNeeded(pub, send);
    } else if (
      isTriggerRollPresentationRunning() &&
      !isCardRollOutcomePresented(pub) &&
      !cardRollRefreshRetryScheduled
    ) {
      cardRollRefreshRetryScheduled = true;
      requestAnimationFrame(() => {
        cardRollRefreshRetryScheduled = false;
        const latest = getPub?.() ?? pub;
        refreshTriggerRollModal(latest, priv, send, getPub, onDiceAnimComplete);
      });
    }
    return;
  }

  if (pub.phase !== "triggers") {
    const roll = currentRoll(pub);
    if (pub.pendingRerollPrompt?.context === "card" && roll !== null) {
      if (isTimeTravelDiscardPending(pub)) return;
      openTriggerModalIfHidden(root, panel, roll);
      const key = diceAnimKey(pub, roll, "card");
      if (!diceAnimRunning) {
        const shouldForce = forceFreshDiceAfterAccept;
        if (!shouldForce && getCompletedDiceAnimKey("card") === key) {
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
    openTriggerModalIfHidden(root, panel, pub.presentationHold.roll);
    if (
      !isTriggerRollPresentationRunning() &&
      !isTriggerRollOutcomePresented(pub)
    ) {
      triggerRollRefreshRetryScheduled = false;
      void runTriggerRollPresentationIfNeeded(pub, send, getPub, onDiceAnimComplete);
    } else if (
      isTriggerRollPresentationRunning() &&
      !isTriggerRollOutcomePresented(pub) &&
      !triggerRollRefreshRetryScheduled
    ) {
      triggerRollRefreshRetryScheduled = true;
      requestAnimationFrame(() => {
        triggerRollRefreshRetryScheduled = false;
        const latest = getPub?.() ?? pub;
        refreshTriggerRollModal(latest, priv, send, getPub, onDiceAnimComplete);
      });
    }
    return;
  }

  if (pub.presentationHold?.at === "post_event_roll") {
    clearResolvingPoll();
    if (isEventRollOutcomePresented(pub)) return;
    openTriggerModalIfHidden(root, panel, pub.presentationHold.roll);
    if (!isTriggerRollPresentationRunning() && !isEventRollOutcomePresented(pub)) {
      eventRollRefreshRetryScheduled = false;
      void runEventRollPresentationIfNeeded(pub, send);
    } else if (
      isTriggerRollPresentationRunning() &&
      !isEventRollOutcomePresented(pub) &&
      !eventRollRefreshRetryScheduled
    ) {
      // ACK→post_event_roll can land while trigger handoff presentation is still marked running.
      eventRollRefreshRetryScheduled = true;
      requestAnimationFrame(() => {
        eventRollRefreshRetryScheduled = false;
        const latest = getPub?.() ?? pub;
        refreshTriggerRollModal(latest, priv, send, getPub, onDiceAnimComplete);
      });
    }
    return;
  }

  const roll = currentRoll(pub);
  if ((pub.pendingRerollPrompt || (rollSent && roll !== null)) && roll !== null) {
    if (isTimeTravelDiscardPending(pub)) return;
    openTriggerModalIfHidden(root, panel, roll);
    const context = rollContext(pub);
    const key = diceAnimKey(pub, roll, context);
    if (!diceAnimRunning) {
      const shouldForce = forceFreshDiceAfterAccept;
      if (!shouldForce && getCompletedDiceAnimKey(context) === key) {
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

  // Server is source of truth: stuck rollSent must not block a legal ROLL_DICE after intro.
  if (
    pub.introAcknowledged &&
    currentRoll(pub) === null &&
    (priv?.legalActions ?? []).some((a) => a.type === "ROLL_DICE")
  ) {
    rollSent = false;
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
  phaseDiceAnimKey = null;
  cardDiceAnimKey = null;
  lastTrackedPhaseRoll = null;
  lastTrackedPhaseContext = null;
  lastTrackedCardRoll = null;
  forceFreshDiceAfterAccept = false;
  acceptedRerollBaselineRoll = null;
  eventRollRefreshRetryScheduled = false;
  cardRollRefreshRetryScheduled = false;
  triggerRollRefreshRetryScheduled = false;
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
