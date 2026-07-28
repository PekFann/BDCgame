import type { CardInstance, GameAction, PrivateGameState, PublicGameState } from "../../shared/types.js";
import {
  getHandInstanceIds,
  getPrevHandIdsForPlayer,
  isDrawAnimating,
  runDrawAnimations,
  setPrevHandIdsForPlayer,
} from "./card-animations.js";
import { runDicePresentation } from "./dice-animation.js";
import { runManifestAnimation } from "./manifest-animation.js";
import { showManifestToast } from "./phase-toast.js";
import {
  scheduleFriendshipGainVfx,
  scheduleTeamFriendshipGainVfx,
  runAiDrawChoiceSequence,
  runRestRewardSequence,
  showRestRewardFloater,
  AI_DRAW_SEQUENCE_GAP_MS,
  waitForFriendshipVfxComplete,
  type FriendshipVfxMode,
} from "./friendship-vfx.js";
import {
  isTriggerRollOutcomePresented,
  isTriggerRollPresentationRunning,
  runCardRollPresentationIfNeeded,
  isEventRollOutcomePresented,
  isCardRollOutcomePresented,
} from "./trigger-roll-modal.js";
import { getHandCardVisualClass, renderHand, type HandRenderContext } from "./ws-client.js";

type SendFn = (action: GameAction) => void;

let lastHoldKey = "";
let isPresenting = false;

export function isPhasePresenting(): boolean {
  return isPresenting;
}

export function resetPresentationLock(): void {
  lastHoldKey = "";
  isPresenting = false;
}

function holdKey(pub: PublicGameState): string {
  const h = pub.presentationHold;
  if (!h) return "";
  const phaseTag = `${pub.cycle}-${pub.dncPhaseIndex}`;
  if (h.at === "manifest") return `manifest-${phaseTag}`;
  if (h.at === "post_trigger_roll") return `trigger-${phaseTag}-${h.roll}-${h.outcome}`;
  if (h.at === "post_draw") {
    return `post_draw-${phaseTag}-${h.choice}-${h.playerId ?? ""}`;
  }
  if (h.at === "post_rest") return `post_rest-${phaseTag}-${h.reward}-${h.playerId ?? ""}`;
  if (h.at === "post_event_roll") return `event-roll-${phaseTag}-${h.roll}-${h.effectId}`;
  if (h.at === "post_card_roll") {
    return `card-roll-${phaseTag}-${h.roll}-${h.effectId}-${h.playerId}`;
  }
  return "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function ackPresentationIfHuman(ctx: PresentationContext): Promise<void> {
  if (ctx.mode === "solo" || ctx.mode === "play") {
    ctx.send({ type: "ACK_PRESENTATION" });
  }
}

export interface FocusedPlayerHand {
  hand: CardInstance[];
  handCtx: HandRenderContext;
  prevIds: Set<string>;
}

export interface PresentationContext {
  boardRoot?: HTMLElement;
  handRoot?: HTMLElement;
  prevHandIds: Set<string>;
  hand: CardInstance[];
  priv?: PrivateGameState;
  onRenderHand?: (hand: CardInstance[]) => void;
  handCtx?: HandRenderContext;
  send: SendFn;
  mode: "solo" | "tv" | "play";
  humanPlayerId?: string;
  friendshipVfxMode?: FriendshipVfxMode;
  getPub?: () => PublicGameState | null | undefined;
  /** Switch roster selection and return that player's hand for animation. */
  focusPlayerHand?: (playerId: string) => FocusedPlayerHand | null;
}

async function animatePlayerHandDraw(
  pub: PublicGameState,
  ctx: PresentationContext,
  playerId: string
): Promise<Set<string>> {
  while (isDrawAnimating()) {
    await sleep(50);
  }

  const focused = ctx.focusPlayerHand?.(playerId);
  const hand = focused?.hand ?? (playerId === ctx.humanPlayerId ? ctx.hand : []);
  const prevIds = focused?.prevIds ?? getPrevHandIdsForPlayer(playerId);
  const handCtx = focused?.handCtx ?? ctx.handCtx;

  if (!ctx.handRoot || !handCtx || hand.length === 0) {
    setPrevHandIdsForPlayer(playerId, hand);
    return getHandInstanceIds(hand);
  }

  const onRender = (handToShow: CardInstance[]) => {
    renderHand(ctx.handRoot!, handToShow, handCtx);
  };

  const hasNewCards = hand.some((c) => !prevIds.has(c.instanceId));
  if (hasNewCards) {
    await runDrawAnimations(
      ctx.handRoot,
      prevIds,
      hand,
      onRender,
      (card) => getHandCardVisualClass(pub.phase, card.cardId, pub),
      handCtx
    );
  } else {
    onRender(hand);
  }

  setPrevHandIdsForPlayer(playerId, hand);
  return getHandInstanceIds(hand);
}

export async function handlePresentationUpdate(
  pub: PublicGameState,
  ctx: PresentationContext
): Promise<Set<string>> {
  const hold = pub.presentationHold;
  if (!hold) {
    resetPresentationLock();
    return ctx.prevHandIds;
  }

  const key = holdKey(pub);
  if (isPresenting) return ctx.prevHandIds;

  if (key === lastHoldKey) {
    if (hold.at === "manifest" && pub.pendingLighthousePrompt) {
      return ctx.prevHandIds;
    }
    if (hold.at === "post_trigger_roll" && ctx.mode !== "tv") {
      if (isTriggerRollOutcomePresented(pub)) {
        return ctx.prevHandIds;
      }
    } else if (hold.at === "post_event_roll" && ctx.mode !== "tv") {
      if (isEventRollOutcomePresented(pub)) {
        return ctx.prevHandIds;
      }
    } else if (hold.at === "post_card_roll" && ctx.mode !== "tv") {
      if (isCardRollOutcomePresented(pub)) {
        return ctx.prevHandIds;
      }
    } else {
      await ackPresentationIfHuman(ctx);
      return ctx.prevHandIds;
    }
  }

  isPresenting = true;

  try {
    if (hold.at === "manifest") {
      if (pub.pendingLighthousePrompt) {
        return ctx.prevHandIds;
      }
      while (isDrawAnimating()) {
        await sleep(50);
      }
      if (ctx.mode !== "tv") {
        showManifestToast(hold.preview);
        await sleep(1500);
      }
      if (ctx.boardRoot && !hold.preview.skipped) {
        await runManifestAnimation(ctx.boardRoot, hold.preview);
      }
      await ackPresentationIfHuman(ctx);
      lastHoldKey = key;
      return ctx.prevHandIds;
    }

    if (hold.at === "post_trigger_roll") {
      if (ctx.mode !== "tv") {
        lastHoldKey = key;
        return ctx.prevHandIds;
      }
      try {
        if (ctx.boardRoot) {
          await runDicePresentation(ctx.boardRoot, pub, hold);
        }
        lastHoldKey = key;
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn("Dice presentation failed:", err);
        }
      }
      return ctx.prevHandIds;
    }

    if (hold.at === "post_event_roll") {
      lastHoldKey = key;
      return ctx.prevHandIds;
    }

    if (hold.at === "post_card_roll") {
      try {
        if (ctx.mode !== "tv") {
          while (isTriggerRollPresentationRunning()) {
            await sleep(50);
          }
          const presented = await runCardRollPresentationIfNeeded(pub, ctx.send);
          if (presented || isCardRollOutcomePresented(pub)) {
            lastHoldKey = key;
          }
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn("Card roll presentation failed:", err);
        }
      }
      return ctx.prevHandIds;
    }

    if (hold.at === "post_draw") {
      while (isDrawAnimating()) {
        await sleep(50);
      }
      if (hold.choice === "friendship") {
        if (ctx.humanPlayerId && ctx.friendshipVfxMode) {
          const scheduleVfx =
            ctx.friendshipVfxMode === "solo"
              ? scheduleTeamFriendshipGainVfx
              : scheduleFriendshipGainVfx;
          scheduleVfx(
            ctx.getPub ?? (() => pub),
            ctx.humanPlayerId,
            ctx.friendshipVfxMode
          );
          await waitForFriendshipVfxComplete();
        } else {
          await sleep(1200);
        }
        // Only replay AI draw-phase floaters during the actual draw phase (not Prayer/effect draws).
        if (ctx.mode === "solo" && ctx.humanPlayerId && pub.phase === "draw") {
          await runAiDrawChoiceSequence(ctx.getPub?.() ?? pub, ctx.humanPlayerId);
        }
        await ackPresentationIfHuman(ctx);
        lastHoldKey = key;
        return ctx.prevHandIds;
      }

      const drawPlayerId = hold.playerId ?? ctx.humanPlayerId ?? "";
      const ids = drawPlayerId
        ? await animatePlayerHandDraw(pub, ctx, drawPlayerId)
        : ctx.prevHandIds;
      await sleep(400);
      if (ctx.mode === "solo" && ctx.humanPlayerId && pub.phase === "draw") {
        await runAiDrawChoiceSequence(ctx.getPub?.() ?? pub, ctx.humanPlayerId);
      }
      await ackPresentationIfHuman(ctx);
      lastHoldKey = key;
      return ids;
    }

    if (hold.at === "post_rest") {
      while (isDrawAnimating()) {
        await sleep(50);
      }
      if (ctx.mode !== "tv") {
        const sequenceIds = hold.playerId ? [hold.playerId] : undefined;
        const humanId = ctx.humanPlayerId ?? "";
        const latestPub = ctx.getPub?.() ?? pub;

        // Solo day Rest: card +1 floater, then deal anim, per player; end on player 1.
        if (ctx.mode === "solo" && hold.reward === "draw" && humanId) {
          const players = [...latestPub.players].sort((a, b) => a.slot - b.slot);
          for (const player of players) {
            showRestRewardFloater(player.id, "draw", humanId);
            await sleep(AI_DRAW_SEQUENCE_GAP_MS);
            await animatePlayerHandDraw(latestPub, ctx, player.id);
            await sleep(250);
          }
          const player1Id = players[0]?.id ?? humanId;
          const focused = ctx.focusPlayerHand?.(player1Id);
          if (focused && ctx.handRoot) {
            renderHand(ctx.handRoot, focused.hand, focused.handCtx);
          }
        } else {
          if (humanId) {
            await runRestRewardSequence(latestPub, hold.reward, humanId, sequenceIds);
          } else {
            await sleep(600);
          }

          if (hold.reward === "draw") {
            if (ctx.mode === "play" && ctx.humanPlayerId) {
              await animatePlayerHandDraw(pub, ctx, ctx.humanPlayerId);
            }
          }
        }
      } else if (hold.reward === "energy") {
        await sleep(600);
      }
      await ackPresentationIfHuman(ctx);
      lastHoldKey = key;
      return ctx.prevHandIds;
    }

    await ackPresentationIfHuman(ctx);
    lastHoldKey = key;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn("Presentation failed:", err);
    }
    if (ctx.mode === "solo" || ctx.mode === "play") {
      ctx.send({ type: "ACK_PRESENTATION" });
      lastHoldKey = key;
    }
  } finally {
    isPresenting = false;
  }

  return ctx.prevHandIds;
}
