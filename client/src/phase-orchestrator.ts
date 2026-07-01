import type { CardInstance, GameAction, PrivateGameState, PublicGameState } from "../../shared/types.js";
import { getHandInstanceIds, isDrawAnimating, runDrawAnimations } from "./card-animations.js";
import { runDicePresentation } from "./dice-animation.js";
import { runManifestAnimation } from "./manifest-animation.js";
import { runTriggerRollPresentationIfNeeded, isTriggerRollPresentationRunning, resetTriggerRollClientFlags } from "./trigger-roll-modal.js";
import { getHandCardVisualClass, type HandRenderContext } from "./ws-client.js";
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
  if (h.at === "post_draw") return `post_draw-${phaseTag}`;
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
    if (hold.at === "post_trigger_roll" && ctx.mode !== "tv") {
      resetTriggerRollClientFlags();
    }
    await ackPresentationIfHuman(ctx);
    return ctx.prevHandIds;
  }

  isPresenting = true;

  try {
    if (hold.at === "manifest") {
      while (isDrawAnimating()) {
        await sleep(50);
      }
      if (ctx.boardRoot) {
        await runManifestAnimation(ctx.boardRoot, hold.preview);
      }
      await ackPresentationIfHuman(ctx);
      lastHoldKey = key;
      return ctx.prevHandIds;
    }

    if (hold.at === "post_trigger_roll") {
      try {
        if (ctx.mode === "tv") {
          if (ctx.boardRoot) {
            await runDicePresentation(ctx.boardRoot, pub, hold);
          }
        } else {
          if (!isTriggerRollPresentationRunning()) {
            await runTriggerRollPresentationIfNeeded(pub);
          } else {
            while (isTriggerRollPresentationRunning()) {
              await sleep(50);
            }
          }
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn("Dice presentation failed:", err);
        }
      }
      await ackPresentationIfHuman(ctx);
      lastHoldKey = key;
      return ctx.prevHandIds;
    }

    if (hold.at === "post_draw") {
      while (isDrawAnimating()) {
        await sleep(50);
      }
      const prevIdsForAnim = new Set(ctx.prevHandIds);
      if (ctx.handRoot && ctx.onRenderHand && ctx.handCtx) {
        const hasNewCards = ctx.hand.some((c) => !prevIdsForAnim.has(c.instanceId));
        if (hasNewCards) {
          await runDrawAnimations(
            ctx.handRoot,
            prevIdsForAnim,
            ctx.hand,
            ctx.onRenderHand,
            (card) => getHandCardVisualClass(pub.phase, card.cardId),
            ctx.handCtx
          );
        } else {
          ctx.onRenderHand(ctx.hand);
        }
      }
      await sleep(1000);
      await ackPresentationIfHuman(ctx);
      lastHoldKey = key;
      return getHandInstanceIds(ctx.hand);
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
