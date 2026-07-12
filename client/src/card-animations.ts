import type { CardInstance } from "../../shared/types.js";

import { bindHandClickHandlers, cardImg, cardName, getHandCardVisualClass, type HandCardVisualClass } from "./ws-client.js";



const FLY_MS = 650;

const CARD_STAGGER_MS = 140;

const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";



let isAnimatingDraw = false;



export function isDrawAnimating(): boolean {

  return isAnimatingDraw;

}



export function resetDrawAnimationState(): void {

  isAnimatingDraw = false;

  prevHandIdsByPlayer.clear();

}



const prevHandIdsByPlayer = new Map<string, Set<string>>();



export function getHandInstanceIds(hand: CardInstance[]): Set<string> {

  return new Set(hand.map((c) => c.instanceId));

}



export function getPrevHandIdsForPlayer(playerId: string): Set<string> {

  return new Set(prevHandIdsByPlayer.get(playerId) ?? []);

}



export function setPrevHandIdsForPlayer(playerId: string, hand: CardInstance[]): void {

  prevHandIdsByPlayer.set(playerId, getHandInstanceIds(hand));

}



export function syncPrevHandIdsForPlayer(playerId: string, ids: Set<string>): void {

  prevHandIdsByPlayer.set(playerId, new Set(ids));

}



function sleep(ms: number): Promise<void> {

  return new Promise((resolve) => setTimeout(resolve, ms));

}



function waitForLayout(): Promise<void> {

  return new Promise((resolve) => {

    requestAnimationFrame(() => {

      requestAnimationFrame(() => resolve());

    });

  });

}



function createPlaceholderSlot(): HTMLElement {

  const div = document.createElement("div");

  div.className = "hand-card hand-slot-placeholder";

  return div;

}



function createHandCardElement(

  card: CardInstance,

  extraClass = "",

  cardClass: HandCardVisualClass = "unplayable"

): HTMLElement {

  const div = document.createElement("div");

  div.className = `hand-card ${cardClass} ${extraClass}`.trim();

  div.dataset.id = card.instanceId;

  const img = document.createElement("img");

  img.src = cardImg(card.cardId);

  img.alt = cardName(card.cardId);

  div.appendChild(img);

  return div;

}



async function spawnFlyingCardToSlot(

  card: CardInstance,

  handRoot: HTMLElement,

  targetSlot: Element,

  cardClass: HandCardVisualClass = "unplayable"

): Promise<void> {

  await waitForLayout();

  const to = targetSlot.getBoundingClientRect();

  const handRect = handRoot.getBoundingClientRect();



  const fly = document.createElement("img");

  fly.className = "flying-card";

  fly.src = cardImg(card.cardId);

  fly.alt = cardName(card.cardId);

  fly.style.width = `${to.width}px`;

  fly.style.height = `${to.height}px`;

  fly.style.transition = `transform ${FLY_MS}ms ${EASING}, opacity ${FLY_MS}ms ${EASING}`;



  const endX = to.left + to.width / 2;

  const endY = to.top + to.height / 2;

  const startY = handRect.bottom + Math.max(36, to.height * 0.45);



  fly.style.transform = `translate3d(${endX}px, ${startY}px, 0) translate(-50%, -50%)`;

  fly.style.opacity = "0.8";

  if (cardClass === "unplayable") {

    fly.style.filter = "grayscale(1) brightness(0.72)";

  }

  document.body.appendChild(fly);



  await waitForLayout();

  fly.style.transform = `translate3d(${endX}px, ${endY}px, 0) translate(-50%, -50%)`;

  fly.style.opacity = "1";



  await new Promise<void>((resolve) => {

    const done = () => {

      fly.remove();

      resolve();

    };

    fly.addEventListener("transitionend", done, { once: true });

    setTimeout(done, FLY_MS + 120);

  });

}



export async function runDrawAnimations(

  handRoot: HTMLElement,

  prevIds: Set<string>,

  hand: CardInstance[],

  onRenderHand: (handToShow: CardInstance[]) => void,

  getCardClass?: (card: CardInstance) => HandCardVisualClass,

  handCtx?: Parameters<typeof bindHandClickHandlers>[2]

): Promise<void> {

  const classify =

    getCardClass ??

    ((card) =>

      handCtx ? getHandCardVisualClass(handCtx.phase, card.cardId, handCtx.pub) : ("unplayable" as const));

  const newCards = hand.filter((c) => !prevIds.has(c.instanceId));

  if (!newCards.length || isAnimatingDraw) {

    onRenderHand(hand);

    return;

  }



  isAnimatingDraw = true;

  const existingHand = hand.filter((c) => prevIds.has(c.instanceId));



  try {

    onRenderHand(existingHand);



    for (let i = 0; i < newCards.length; i++) {

      const card = newCards[i];

      const placeholder = createPlaceholderSlot();

      handRoot.appendChild(placeholder);

      await waitForLayout();



      await spawnFlyingCardToSlot(card, handRoot, placeholder, classify(card));



      const dealt = createHandCardElement(card, "", classify(card));

      placeholder.replaceWith(dealt);



      if (i < newCards.length - 1) {

        await sleep(CARD_STAGGER_MS);

      }

    }



    if (handCtx) {

      bindHandClickHandlers(handRoot, hand, handCtx);

    }

  } finally {

    handRoot.querySelectorAll(".hand-slot-placeholder").forEach((el) => el.remove());

    isAnimatingDraw = false;

  }

}


