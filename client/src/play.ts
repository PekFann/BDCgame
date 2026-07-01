import type { CardInstance } from "../../shared/types.js";
import {
  GameClient,
  bindPlayerRoster,
  getTeamHand,
  renderCompactStatus,
  renderHand,
  renderHandLabel,
  renderPhaseActions,
  renderRestVoteBar,
} from "./ws-client.js";
import { getPrevHandIdsForPlayer, isDrawAnimating, runDrawAnimations, setPrevHandIdsForPlayer, syncPrevHandIdsForPlayer } from "./card-animations.js";
import { ensureCardModal, openCardModal, refreshCardModalIfOpen } from "./card-modal.js";
import { refreshDrawPhaseModal } from "./draw-phase-modal.js";
import { handlePresentationUpdate } from "./phase-orchestrator.js";
import { refreshTriggerRollModal } from "./trigger-roll-modal.js";
import { refreshTimeTravelModal } from "./time-travel-modal.js";
import { refreshDemonTargetModal } from "./demon-target-modal.js";
import { refreshHandDiscardModal } from "./hand-discard-modal.js";
import { initFullscreenButton } from "./fullscreen.js";
import { runFriendshipGainVfx } from "./friendship-vfx.js";
import { isInputLocked } from "./input-lock.js";
import {
  isGameIntroDismissed,
  onGameIntroDismissed,
  openGameStartModalIfNeeded,
  refreshGameStartModal,
  setGameIntroSend,
} from "./game-start-modal.js";
import {
  isGameIntroRunning,
  runGameIntroIfNeeded,
  shouldDeferGameRender,
} from "./game-intro-orchestrator.js";

const params = new URLSearchParams(location.search);
const roomId = params.get("room") ?? "";
const slot = Number(params.get("slot") ?? "1");
const name = params.get("name") ?? `Player ${slot}`;

const client = new GameClient();
let selectedPlayerId = "";
let prevHumanFriendship: number | null = null;
ensureCardModal();
initFullscreenButton();

function maybeTriggerFriendshipVfx(pub: PublicGameState, humanPlayerId: string): void {
  const human = pub.players.find((p) => p.id === humanPlayerId);
  if (!human) return;
  if (prevHumanFriendship !== null && human.friendship > prevHumanFriendship) {
    void runFriendshipGainVfx(human.friendship - prevHumanFriendship);
  }
  prevHumanFriendship = human.friendship;
}

function resolveViewingPlayerId(humanId: string, players: { id: string }[]): string {
  if (!selectedPlayerId) return humanId;
  if (players.some((p) => p.id === selectedPlayerId)) return selectedPlayerId;
  return humanId;
}

function renderPhoneUI(): void {
  const pub = client.publicState;
  const priv = client.privateState ?? undefined;
  if (!pub || !priv) return;

  const human = pub.players.find((p) => p.slot === slot - 1);
  if (!human) return;

  maybeTriggerFriendshipVfx(pub, human.id);
  const send = (a: Parameters<typeof client.sendAction>[0]) => client.sendAction(a);
  setGameIntroSend(send);
  const viewingId = resolveViewingPlayerId(human.id, pub.players);
  const viewingPlayer = pub.players.find((p) => p.id === viewingId);
  const modalCtx = { pub, priv, send, humanPlayerId: human.id };

  const miniBoard = document.getElementById("mini-board")!;
  renderCompactStatus(miniBoard, pub, name, viewingId);
  bindPlayerRoster(miniBoard, (playerId) => {
    selectedPlayerId = playerId;
    renderPhoneUI();
  });

  const handEl = document.getElementById("hand")!;
  const handLabelEl = document.getElementById("hand-label")!;
  const handCtx = {
    phase: pub.phase,
    pub,
    priv,
    humanPlayerId: human.id,
    viewingPlayerId: viewingId,
    onCardClick: (card: CardInstance) => {
      if (isInputLocked()) return;
      if (viewingId !== human.id) return;
      openCardModal(card, modalCtx);
    },
  };

  try {
    if (isGameIntroRunning()) {
      return;
    }

    if (shouldDeferGameRender(pub)) {
      void runGameIntroIfNeeded(pub, {
        mode: "play",
        handRoot: handEl,
        hand: priv.hand,
        handCtx,
        onRenderHand: (handToShow) => renderHand(handEl, handToShow, handCtx),
        onComplete: () => {
          setPrevHandIdsForPlayer(human.id, priv.hand);
        },
      })
        .then((ids) => {
          if (ids) syncPrevHandIdsForPlayer(human.id, ids);
          const latestPub = client.publicState;
          if (latestPub) openGameStartModalIfNeeded(latestPub);
          renderPhoneUI();
        })
        .catch((err) => {
          console.error("Intro orchestration failed:", err);
          const latestPub = client.publicState;
          if (latestPub) openGameStartModalIfNeeded(latestPub);
          renderPhoneUI();
        });
      return;
    }

    const viewingHand = getTeamHand(priv, viewingId);
    renderHandLabel(handLabelEl, viewingPlayer?.name ?? name, viewingId === human.id);

    const prevIds = getPrevHandIdsForPlayer(viewingId);

    if (!isDrawAnimating()) {
      const newCardIds = new Set(
        viewingHand.filter((c) => !prevIds.has(c.instanceId)).map((c) => c.instanceId)
      );

      if (
        newCardIds.size > 0 &&
        (!pub.presentationHold || pub.presentationHold.at === "manifest") &&
        isGameIntroDismissed() &&
        viewingId === human.id
      ) {
        const capturedPrev = prevIds;
        const currentHand = viewingHand;
        void runDrawAnimations(
          handEl,
          capturedPrev,
          currentHand,
          (handToShow) => {
            renderHand(handEl, handToShow, handCtx);
          },
          undefined,
          handCtx
        ).then(() => {
          setPrevHandIdsForPlayer(viewingId, currentHand);
        });
      } else {
        renderHand(handEl, viewingHand, handCtx);
        const skipPrevSync =
          pub.presentationHold?.at === "manifest" && newCardIds.size > 0;
        if (!pub.presentationHold || !skipPrevSync) {
          setPrevHandIdsForPlayer(viewingId, viewingHand);
        }
      }
    }

    renderRestVoteBar(document.getElementById("rest-vote-bar")!, pub, priv, human.id, send);
    renderPhaseActions(document.getElementById("actions")!, pub, priv, send, { circular: true });
    refreshCardModalIfOpen(modalCtx);
    refreshDrawPhaseModal(pub, human.id, send);
    refreshTriggerRollModal(pub, priv, send);
    refreshTimeTravelModal(pub, priv, send);
    refreshHandDiscardModal(pub, priv, send, human.id);
    refreshDemonTargetModal(pub, priv, send);

    if (pub.presentationHold) {
      void handlePresentationUpdate(pub, {
        handRoot: handEl,
        prevHandIds: getPrevHandIdsForPlayer(viewingId),
        hand: viewingHand,
        priv,
        onRenderHand: (handToShow) => renderHand(handEl, handToShow, handCtx),
        handCtx,
        send,
        mode: "play",
      });
    }
  } finally {
    refreshGameStartModal(pub);
  }
}

client.connect({ roomId, role: "player", slot, name }).then(() => {
  onGameIntroDismissed(() => {
    const pub = client.publicState;
    const priv = client.privateState ?? undefined;
    if (!pub || !priv) return;
    const human = pub.players.find((p) => p.slot === slot - 1);
    if (!human) return;
    const send = (a: Parameters<typeof client.sendAction>[0]) => client.sendAction(a);
    refreshDrawPhaseModal(pub, human.id, send);
    refreshTriggerRollModal(pub, priv, send);
    refreshTimeTravelModal(pub, priv, send);
    refreshHandDiscardModal(pub, priv, send, human.id);
    refreshDemonTargetModal(pub, priv, send);
  });

  client.onStateUpdate((pub, priv) => {
    if (!priv) return;
    renderPhoneUI();
  });
});
