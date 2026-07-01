import type { CardInstance, GameAction, PublicGameState } from "../../shared/types.js";
import { runBoardHeroIntro } from "./board-intro-animation.js";
import { getHandInstanceIds, runDrawAnimations } from "./card-animations.js";
import {
  markGameIntroDismissedFromServer,
  markGameIntroSequenceComplete,
  isGameIntroSequenceComplete,
  openGameStartModalIfNeeded,
} from "./game-start-modal.js";
import { getHandCardVisualClass, type HandRenderContext } from "./ws-client.js";

type SendFn = (action: GameAction) => void;
type IntroMode = "solo" | "tv" | "play";

let introRunning = false;
let introStarted = false;

export function isGameIntroRunning(): boolean {
  return introRunning;
}

export function shouldDeferGameRender(pub: PublicGameState): boolean {
  if (pub.introAcknowledged) return false;
  if (isGameIntroSequenceComplete()) return false;
  return pub.started && pub.cycle === 1;
}

function needsIntro(pub: PublicGameState): boolean {
  if (!shouldDeferGameRender(pub)) return false;
  if (introRunning) return false;
  if (introStarted && isGameIntroSequenceComplete()) return false;
  if (introStarted && !isGameIntroSequenceComplete()) {
    introStarted = false;
  }
  return true;
}

export interface GameIntroContext {
  mode: IntroMode;
  boardRoot?: HTMLElement;
  handRoot?: HTMLElement;
  hand: CardInstance[];
  handCtx?: HandRenderContext;
  onRenderBoard?: () => void;
  onRenderHand?: (hand: CardInstance[]) => void;
  onComplete?: () => void;
}

export function resetGameIntroOrchestrator(): void {
  introRunning = false;
  introStarted = false;
}

export function shouldKickOffIntro(pub: PublicGameState): boolean {
  return needsIntro(pub) && !introRunning;
}

export async function runGameIntroIfNeeded(
  pub: PublicGameState,
  ctx: GameIntroContext
): Promise<Set<string> | null> {
  if (pub.introAcknowledged) {
    markGameIntroSequenceComplete();
    markGameIntroDismissedFromServer();
    return getHandInstanceIds(ctx.hand);
  }

  if (!needsIntro(pub) || introRunning) return null;
  if (ctx.hand.length === 0) return null;

  introStarted = true;
  introRunning = true;

  try {
    if (ctx.mode === "solo" || ctx.mode === "tv") {
      ctx.onRenderBoard?.();
      if (ctx.boardRoot) {
        await runBoardHeroIntro(ctx.boardRoot);
      }
    }

    if ((ctx.mode === "solo" || ctx.mode === "play") && ctx.handRoot && ctx.onRenderHand) {
      const emptyHand: CardInstance[] = [];
      ctx.onRenderHand(emptyHand);

      if (ctx.hand.length > 0) {
        await runDrawAnimations(
          ctx.handRoot,
          new Set(),
          ctx.hand,
          ctx.onRenderHand,
          (card) => getHandCardVisualClass(pub.phase, card.cardId, pub),
          ctx.handCtx
        );
      }
    }

    markGameIntroSequenceComplete();
    if (ctx.handRoot && ctx.handRoot.childElementCount === 0 && ctx.hand.length > 0 && ctx.onRenderHand) {
      ctx.onRenderHand(ctx.hand);
    }
    openGameStartModalIfNeeded(pub);
    ctx.onComplete?.();
    return getHandInstanceIds(ctx.hand);
  } catch (err) {
    console.error("Game intro sequence failed:", err);
    markGameIntroSequenceComplete();
    if (ctx.handRoot && ctx.handRoot.childElementCount === 0 && ctx.hand.length > 0 && ctx.onRenderHand) {
      ctx.onRenderHand(ctx.hand);
    }
    openGameStartModalIfNeeded(pub);
    ctx.onComplete?.();
    return getHandInstanceIds(ctx.hand);
  } finally {
    introRunning = false;
  }
}
