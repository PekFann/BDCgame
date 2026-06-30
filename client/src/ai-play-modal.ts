import type { GameAction, PublicGameState } from "../../shared/types.js";
import cardsData from "../../data/cards.json";
import { isGameIntroDismissed } from "./game-start-modal.js";
import { forceCloseModal, openAnimatedModal } from "./modal-animations.js";
import { cardImg, cardName } from "./ws-client.js";

type SendFn = (action: GameAction) => void;

interface CardDef {
  id: string;
  effect?: string;
  energyCost?: number;
  friendshipCost?: number;
}

const cardDefs = Object.fromEntries((cardsData as CardDef[]).map((c) => [c.id, c]));

let modalEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;

function ensureAiPlayModal(): { root: HTMLElement; panel: HTMLElement } {
  if (modalEl && panelEl) return { root: modalEl, panel: panelEl };

  modalEl = document.createElement("div");
  modalEl.id = "ai-play-modal";
  modalEl.className = "card-modal ai-play-modal";
  modalEl.hidden = true;
  modalEl.innerHTML = `
    <div class="card-modal-backdrop modal-overlay"></div>
    <div class="ai-play-panel modal-panel">
      <h3 class="card-modal-title ai-play-heading"></h3>
      <div class="ai-play-card-preview">
        <img class="ai-play-card-img" alt="" />
      </div>
      <p class="card-modal-meta ai-play-meta"></p>
      <p class="card-modal-effect ai-play-effect"></p>
      <div class="card-modal-buttons"></div>
    </div>
  `;

  panelEl = modalEl.querySelector(".ai-play-panel") as HTMLElement;
  document.body.appendChild(modalEl);
  return { root: modalEl, panel: panelEl };
}

export function closeAiPlayModal(): void {
  if (!modalEl || !panelEl) return;
  forceCloseModal(modalEl, panelEl);
}

export function refreshAiPlayModal(pub: PublicGameState, send: SendFn): void {
  const pending = pub.pendingAiPlay;
  const { root, panel } = ensureAiPlayModal();

  const canShow =
    !!pending &&
    isGameIntroDismissed() &&
    pub.phase !== "draw";

  if (!canShow) {
    if (!root.hidden) closeAiPlayModal();
    return;
  }

  const def = cardDefs[pending.cardId];
  const heading = panel.querySelector(".ai-play-heading")!;
  const img = panel.querySelector(".ai-play-card-img") as HTMLImageElement;
  const meta = panel.querySelector(".ai-play-meta")!;
  const effect = panel.querySelector(".ai-play-effect")!;

  heading.textContent = `${pending.playerName} wants to play:`;
  img.src = cardImg(pending.cardId);
  img.alt = cardName(pending.cardId);
  meta.textContent = [
    cardName(pending.cardId),
    def?.energyCost ? `Energy ${def.energyCost}` : "",
    def?.friendshipCost ? `Friendship ${def.friendshipCost}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  effect.textContent = def?.effect ?? "";

  const buttons = panel.querySelector(".card-modal-buttons")!;
  if (!buttons.querySelector("button")) {
    buttons.innerHTML = "";
    const proceed = document.createElement("button");
    proceed.className = "btn";
    proceed.textContent = "Proceed";
    proceed.onclick = () => {
      send({ type: "CONFIRM_AI_PLAY" });
      closeAiPlayModal();
    };
    const cancel = document.createElement("button");
    cancel.className = "btn secondary";
    cancel.textContent = "Cancel";
    cancel.onclick = () => {
      send({ type: "SKIP_AI_PLAY" });
      closeAiPlayModal();
    };
    buttons.appendChild(proceed);
    buttons.appendChild(cancel);
  }

  openAnimatedModal(root, panel);
}
