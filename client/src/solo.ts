import type { CardInstance, PrivateGameState, PublicGameState } from "../../shared/types.js";
import {
  createSoloRoom,
  fetchPossessedOptions,
  GameClient,
  bindBoardAttachments,
  bindPlayerRoster,
  getHumanPlayerId,
  getTeamHand,
  renderBoard,
  renderBoardEventChoice,
  renderHand,
  renderHandLabel,
  renderPhaseActions,
  renderPossessedPanelActions,
  renderDiscussionButton,
  getHandCardVisualClass,
  type HandRenderContext,
} from "./ws-client.js";
import {
  getPrevHandIdsForPlayer,
  isDrawAnimating,
  resetDrawAnimationState,
  runDrawAnimations,
  setPrevHandIdsForPlayer,
  syncPrevHandIdsForPlayer,
} from "./card-animations.js";
import { ensureCardModal, handleCardModalActionError, openCardModal, refreshCardModalIfOpen } from "./card-modal.js";
import { closeDrawPhaseModalIfOpen, openDrawPhaseModalIfNeeded, refreshDrawPhaseModal } from "./draw-phase-modal.js";
import { renderDiscardPileSlot } from "./discard-pile-modal.js";
import {
  isGameIntroRunning,
  resetGameIntroOrchestrator,
  runGameIntroIfNeeded,
  shouldDeferGameRender,
  shouldKickOffIntro,
} from "./game-intro-orchestrator.js";
import {
  isGameIntroDismissed,
  onGameIntroDismissed,
  openGameStartModalIfNeeded,
  refreshGameStartModal,
  resetGameIntro,
  setGameIntroSend,
} from "./game-start-modal.js";
import { refreshTriggerRollModal, resetTriggerRollModal } from "./trigger-roll-modal.js";
import { resetTimeTravelModal } from "./time-travel-modal.js";
import { refreshTimeTravelModal, resetTimeTravelModal } from "./time-travel-modal.js";
import { refreshDemonTargetModal, resetDemonTargetModal } from "./demon-target-modal.js";
import { refreshHandDiscardModal, resetHandDiscardModal } from "./hand-discard-modal.js";
import { refreshCallForHelpModal, resetCallForHelpModal } from "./call-for-help-modal.js";
import { playBoardDamageVfx, resetBoardDamageVfx } from "./board-damage-vfx.js";
import { initFullscreenButton } from "./fullscreen.js";
import {
  ensureFriendshipBaseline,
  resetFriendshipVfxTracking,
  scheduleFriendshipGainVfx,
} from "./friendship-vfx.js";
import { isInputLocked } from "./input-lock.js";
import { handlePresentationUpdate, resetPresentationLock } from "./phase-orchestrator.js";
import { refreshPhaseToast, resetPhaseToast } from "./phase-toast.js";

const SOLO_BUILD = "2025-07-01-trigger-ux-polish";
console.info(`[bdc-solo] loaded ${SOLO_BUILD}`);

const client = new GameClient();
let roomId = "";
let gameStartedResolve: (() => void) | null = null;
let gameStartedReject: ((err: Error) => void) | null = null;
let selectedPlayerId = "";
let lastRenderedCycle = 0;
let drawIdleRetryScheduled = false;

function showSetupError(message: string): void {
  const el = document.getElementById("setupError")!;
  el.textContent = message;
  el.style.display = "block";
}

function clearSetupError(): void {
  const el = document.getElementById("setupError")!;
  el.textContent = "";
  el.style.display = "none";
  clearGameError();
}

function showGameError(message: string): void {
  const game = document.getElementById("game")!;
  let el = document.getElementById("gameError");
  if (!el) {
    el = document.createElement("p");
    el.id = "gameError";
    el.style.color = "var(--danger)";
    el.style.margin = "0 0 0.5rem";
    el.style.textAlign = "center";
    game.querySelector(".game-footer")?.prepend(el);
  }
  el.textContent = message;
  el.style.display = "block";
}

function clearGameError(): void {
  const el = document.getElementById("gameError");
  if (!el) return;
  el.textContent = "";
  el.style.display = "none";
}

function showGame(): void {
  document.getElementById("setup")!.style.display = "none";
  document.getElementById("game")!.style.display = "grid";
  document.body.classList.add("game-view");
  ensureCardModal();
  initFullscreenButton(document.getElementById("game"));
}

function resolveViewingPlayerId(pub: PublicGameState, humanPlayerId: string): string {
  if (!selectedPlayerId) return humanPlayerId;
  if (pub.players.some((p) => p.id === selectedPlayerId)) return selectedPlayerId;
  return humanPlayerId;
}

function scheduleHandRerenderWhenDrawIdle(
  humanPlayerId: string,
  send: (a: Parameters<typeof client.sendAction>[0]) => void
): void {
  if (drawIdleRetryScheduled) return;
  drawIdleRetryScheduled = true;
  void (async () => {
    while (isDrawAnimating()) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    drawIdleRetryScheduled = false;
    const pub = client.publicState;
    const priv = client.privateState ?? undefined;
    if (pub?.started && priv) {
      renderSelectedHand(pub, priv, humanPlayerId, send);
    }
  })();
}

function closeStalePhaseModals(pub: PublicGameState): void {
  if (pub.phase !== "draw") {
    closeDrawPhaseModalIfOpen();
  }
  if (pub.phase !== "triggers") {
    resetTriggerRollModal();
    resetTimeTravelModal();
  }
}

function renderBoardWithRoster(
  pub: PublicGameState,
  humanPlayerId: string,
  priv?: PrivateGameState,
  send?: (a: Parameters<typeof client.sendAction>[0]) => void
): void {
  const board = document.getElementById("board")!;
  const viewingId = resolveViewingPlayerId(pub, humanPlayerId);
  renderBoard(board, pub, viewingId, humanPlayerId);
  playBoardDamageVfx(board, pub);
  bindPlayerRoster(board, (playerId) => {
    selectedPlayerId = playerId;
    renderGameUI();
  });
  if (priv && send) {
    bindBoardAttachments(board, pub, priv, humanPlayerId, send);
  }
  if (priv) {
    renderBoardEventChoice(board, pub, priv, humanPlayerId, send);
  }
  scheduleFriendshipGainVfx(() => client.publicState, humanPlayerId, "solo");
}

function renderFooterChrome(
  pub: PublicGameState,
  priv: PrivateGameState,
  send: (a: Parameters<typeof client.sendAction>[0]) => void,
  humanPlayerId: string
): void {
  const discardSlot = document.getElementById("hand-discard");
  if (discardSlot) {
    renderDiscardPileSlot(discardSlot, pub, () => client.publicState);
  }
  renderDiscussionButton(document.getElementById("hand-discussion")!, pub, priv, send);
  const possessedActions = document.getElementById("possessed-actions");
  if (possessedActions) {
    renderPossessedPanelActions(possessedActions, pub, priv, humanPlayerId, send);
  }
}

function renderSelectedHand(
  pub: PublicGameState,
  priv: PrivateGameState,
  humanPlayerId: string,
  send: (a: Parameters<typeof client.sendAction>[0]) => void
): { handCtx: HandRenderContext } {
  const handEl = document.getElementById("hand")!;
  const handLabelEl = document.getElementById("hand-label")!;
  const viewingId = resolveViewingPlayerId(pub, humanPlayerId);
  const viewingPlayer = pub.players.find((p) => p.id === viewingId);
  const hand = getTeamHand(priv, viewingId);
  const modalCtx = { pub, priv, send, humanPlayerId };

  const handCtx: HandRenderContext = {
    phase: pub.phase,
    pub,
    priv,
    humanPlayerId,
    viewingPlayerId: viewingId,
    onCardClick: (card: CardInstance) => {
      if (isInputLocked()) return;
      if (viewingId !== humanPlayerId) return;
      openCardModal(card, modalCtx);
    },
  };

  renderHandLabel(handLabelEl, viewingPlayer?.name ?? "Player", viewingId === humanPlayerId);

  if (pub.presentationHold?.at === "post_draw") {
    return { handCtx };
  }

  const prevIds = getPrevHandIdsForPlayer(viewingId);

  if (isDrawAnimating()) {
    scheduleHandRerenderWhenDrawIdle(humanPlayerId, send);
    return { handCtx };
  }

  const newCardIds = hand.filter((c) => !prevIds.has(c.instanceId));
  const holdAllowsDrawAnim =
    !pub.presentationHold || pub.presentationHold.at === "manifest";
  const shouldAnimate =
    newCardIds.length > 0 &&
    holdAllowsDrawAnim &&
    isGameIntroDismissed() &&
    viewingId === humanPlayerId;

  if (shouldAnimate) {
    const capturedPrev = prevIds;
    const currentHand = hand;
    void runDrawAnimations(
      handEl,
      capturedPrev,
      currentHand,
      (handToShow) => renderHand(handEl, handToShow, handCtx),
      (card) => getHandCardVisualClass(pub.phase, card.cardId, pub),
      handCtx
    ).then(() => {
      setPrevHandIdsForPlayer(viewingId, currentHand);
    });
  } else {
    renderHand(handEl, hand, handCtx);
    const skipPrevSync = pub.presentationHold?.at === "manifest" && newCardIds.length > 0;
    if (!pub.presentationHold || !skipPrevSync) {
      setPrevHandIdsForPlayer(viewingId, hand);
    }
  }

  return { handCtx };
}

function refreshGameplayModals(
  pub: PublicGameState,
  priv: PrivateGameState,
  send: (a: Parameters<typeof client.sendAction>[0]) => void,
  humanPlayerId: string,
  modalCtx: { pub: PublicGameState; priv: PrivateGameState; send: (a: Parameters<typeof client.sendAction>[0]) => void; humanPlayerId: string }
): void {
  refreshCardModalIfOpen(modalCtx);
  refreshDrawPhaseModal(pub, humanPlayerId, send, "solo");
  refreshTriggerRollModal(pub, priv, send, () => client.publicState);
  refreshTimeTravelModal(pub, priv, send);
  refreshHandDiscardModal(pub, priv, send, humanPlayerId);
  refreshCallForHelpModal(pub, send, humanPlayerId);
  refreshDemonTargetModal(pub, priv, send);
  refreshPhaseToast(pub);
}

function kickOffIntroIfNeeded(
  pub: PublicGameState,
  priv: PrivateGameState,
  humanPlayerId: string,
  handEl: HTMLElement,
  send: (a: Parameters<typeof client.sendAction>[0]) => void,
  modalCtx: { pub: PublicGameState; priv: PrivateGameState; send: (a: Parameters<typeof client.sendAction>[0]) => void; humanPlayerId: string }
): void {
  if (!shouldKickOffIntro(pub) || priv.hand.length === 0) return;

  const introHandCtx: HandRenderContext = {
    phase: pub.phase,
    pub,
    priv,
    humanPlayerId,
    viewingPlayerId: humanPlayerId,
    onCardClick: (card: CardInstance) => {
      if (isInputLocked()) return;
      openCardModal(card, modalCtx);
    },
  };

  void runGameIntroIfNeeded(pub, {
    mode: "solo",
    boardRoot: document.getElementById("board")!,
    handRoot: handEl,
    hand: priv.hand,
    handCtx: introHandCtx,
    onRenderBoard: () => {
      const latestPub = client.publicState;
      const latestPriv = client.privateState ?? undefined;
      if (!latestPub || !latestPriv) return;
      renderBoardWithRoster(latestPub, humanPlayerId, latestPriv, send);
      renderFooterChrome(latestPub, latestPriv, send, humanPlayerId);
    },
    onRenderHand: (handToShow) => renderHand(handEl, handToShow, introHandCtx),
    onComplete: () => {
      setPrevHandIdsForPlayer(humanPlayerId, priv.hand);
    },
  })
    .then((ids) => {
      if (ids) syncPrevHandIdsForPlayer(humanPlayerId, ids);
      const latestPub = client.publicState;
      if (latestPub) openGameStartModalIfNeeded(latestPub);
      renderGameUI();
    })
    .catch((err) => {
      console.error("Intro orchestration failed:", err);
      const latestPub = client.publicState;
      if (latestPub) openGameStartModalIfNeeded(latestPub);
      renderGameUI();
    });
}

function paintStaticHand(
  pub: PublicGameState,
  priv: PrivateGameState,
  humanPlayerId: string,
  send: (a: Parameters<typeof client.sendAction>[0]) => void
): void {
  const handEl = document.getElementById("hand")!;
  const modalCtx = { pub, priv, send, humanPlayerId };
  const handCtx: HandRenderContext = {
    phase: pub.phase,
    pub,
    priv,
    humanPlayerId,
    viewingPlayerId: humanPlayerId,
    onCardClick: (card: CardInstance) => {
      if (isInputLocked()) return;
      openCardModal(card, modalCtx);
    },
  };
  renderHand(handEl, priv.hand, handCtx);
  setPrevHandIdsForPlayer(humanPlayerId, priv.hand);
}

function renderGameUI(): void {
  const pub = client.publicState;
  const priv = client.privateState ?? undefined;
  if (!pub || !priv) return;

  clearSetupError();
  const send = (a: Parameters<typeof client.sendAction>[0]) => client.sendAction(a);
  setGameIntroSend(send);
  const humanPlayerId = getHumanPlayerId(pub);
  ensureFriendshipBaseline(pub, humanPlayerId);
  const modalCtx = { pub, priv, send, humanPlayerId };
  const handEl = document.getElementById("hand")!;
  const actionsEl = document.getElementById("actions")!;

  try {
    if (isGameIntroRunning()) {
      return;
    }

    if (pub.cycle !== lastRenderedCycle) {
      if (lastRenderedCycle > 0) {
        selectedPlayerId = "";
        resetPresentationLock();
        resetTriggerRollModal();
        resetTimeTravelModal();
      }
      lastRenderedCycle = pub.cycle;
    }

    closeStalePhaseModals(pub);

    if (shouldDeferGameRender(pub)) {
      if (shouldKickOffIntro(pub) && priv.hand.length > 0) {
        kickOffIntroIfNeeded(pub, priv, humanPlayerId, handEl, send, modalCtx);
      } else {
        renderBoardWithRoster(pub, humanPlayerId, priv, send);
        renderFooterChrome(pub, priv, send, humanPlayerId);
        if (priv.hand.length > 0) {
          paintStaticHand(pub, priv, humanPlayerId, send);
        }
      }
      return;
    }

    renderBoardWithRoster(pub, humanPlayerId, priv, send);
    renderFooterChrome(pub, priv, send, humanPlayerId);
    renderPhaseActions(actionsEl, pub, priv, send, { humanPlayerId });

    const { handCtx } = renderSelectedHand(pub, priv, humanPlayerId, send);

    if (pub.presentationHold) {
      void handlePresentationUpdate(pub, {
        boardRoot: document.getElementById("board")!,
        handRoot: handEl,
        prevHandIds: getPrevHandIdsForPlayer(humanPlayerId),
        hand: getTeamHand(priv, resolveViewingPlayerId(pub, humanPlayerId)),
        priv,
        onRenderHand: (handToShow) => renderHand(handEl, handToShow, handCtx),
        handCtx,
        send,
        mode: "solo",
      }).then((ids) => {
        syncPrevHandIdsForPlayer(humanPlayerId, ids);
        const latestPub = client.publicState;
        const latestPriv = client.privateState ?? undefined;
        if (!latestPub || !latestPriv) return;
        renderSelectedHand(latestPub, latestPriv, humanPlayerId, send);
        refreshGameplayModals(latestPub, latestPriv, send, humanPlayerId, {
          pub: latestPub,
          priv: latestPriv,
          send,
          humanPlayerId,
        });
      });
    } else {
      refreshGameplayModals(pub, priv, send, humanPlayerId, modalCtx);
    }
  } finally {
    refreshGameStartModal(pub);
  }
}

async function init() {
  resetGameIntro();
  resetGameIntroOrchestrator();
  resetPresentationLock();
  resetDrawAnimationState();
  resetTriggerRollModal();
  resetTimeTravelModal();
  resetDemonTargetModal();
  resetPhaseToast();
  lastRenderedCycle = 0;
  resetFriendshipVfxTracking();
  drawIdleRetryScheduled = false;
  selectedPlayerId = "";
  initFullscreenButton();

  const possessedSelect = document.getElementById("possessed") as HTMLSelectElement;
  const startBtn = document.getElementById("startBtn") as HTMLButtonElement;

  if (import.meta.env.DEV && location.port === "3000") {
    showSetupError(
      "Wrong URL for live development. Open http://localhost:5173/solo.html (Vite), not port 3000."
    );
    startBtn.disabled = true;
    possessedSelect.disabled = true;
    return;
  }

  client.onStateUpdate((pub, priv) => {
    if (pub.started) {
      showGame();
      gameStartedResolve?.();
      gameStartedResolve = null;
      gameStartedReject = null;
    }
    if (pub.started && priv) {
      renderGameUI();
    }
  });

  onGameIntroDismissed(() => {
    const pub = client.publicState;
    const priv = client.privateState ?? undefined;
    if (!pub || !priv) return;
    const send = (a: Parameters<typeof client.sendAction>[0]) => client.sendAction(a);
    const humanPlayerId = getHumanPlayerId(pub);
    openDrawPhaseModalIfNeeded(pub, humanPlayerId, send, "solo");
    refreshTriggerRollModal(pub, priv, send, () => client.publicState);
    refreshPhaseToast(pub);
    renderGameUI();
  });

  client.onErrorMessage((message) => {
    if (document.getElementById("game")?.style.display !== "none") {
      showGameError(message);
      const pub = client.publicState;
      const priv = client.privateState;
      if (pub && priv) {
        handleCardModalActionError();
        refreshCardModalIfOpen({
          pub,
          priv,
          send: (a) => client.sendAction(a),
          humanPlayerId: getHumanPlayerId(pub),
        });
      }
    } else {
      showSetupError(message);
    }
    startBtn.disabled = false;
    gameStartedReject?.(new Error(message));
    gameStartedResolve = null;
    gameStartedReject = null;
  });

  try {
    const options = await fetchPossessedOptions();
    possessedSelect.innerHTML = options
      .map((o) => `<option value="${o.id}">${o.name}</option>`)
      .join("");
    possessedSelect.disabled = false;
    startBtn.disabled = false;
  } catch (err) {
    showSetupError((err as Error).message);
  }

  startBtn.addEventListener("click", async () => {
    clearSetupError();
    const possessedId = possessedSelect.value;
    if (!possessedId) {
      showSetupError("Please select a Possessed character.");
      return;
    }

    startBtn.disabled = true;
    const playerCount = Number((document.getElementById("playerCount") as HTMLSelectElement).value);

    const startedPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Game start timed out. Check that the server is running.")),
        10000
      );
      gameStartedResolve = () => {
        clearTimeout(timeout);
        resolve();
      };
      gameStartedReject = (err) => {
        clearTimeout(timeout);
        reject(err);
      };
    });

    try {
      resetGameIntro();
      resetGameIntroOrchestrator();
      resetPresentationLock();
      resetDrawAnimationState();
      resetTriggerRollModal();
      resetTimeTravelModal();
      resetDemonTargetModal();
      resetHandDiscardModal();
      resetCallForHelpModal();
      resetBoardDamageVfx();
      resetPhaseToast();
      resetFriendshipVfxTracking();
      roomId = await createSoloRoom();
      await client.connect({ roomId, role: "solo", slot: 1, name: "You" });
      client.startGame(possessedId, playerCount);
      await startedPromise;
    } catch (err) {
      showSetupError((err as Error).message);
      startBtn.disabled = false;
      gameStartedResolve = null;
      gameStartedReject = null;
    }
  });
}

init();
