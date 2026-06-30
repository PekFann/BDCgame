import type { GameAction, PrivateGameState, PublicGameState } from "../../shared/types.js";
import { isGameIntroDismissed } from "./game-start-modal.js";
import { forceCloseModal, openAnimatedModal } from "./modal-animations.js";
import { cardImg, cardName } from "./ws-client.js";

type SendFn = (action: GameAction) => void;

let modalEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;
let selectedKey = "";

function ensureDiscussionModal(): { root: HTMLElement; panel: HTMLElement } {
  if (modalEl && panelEl) return { root: modalEl, panel: panelEl };

  modalEl = document.createElement("div");
  modalEl.id = "discussion-modal";
  modalEl.className = "card-modal discussion-modal";
  modalEl.hidden = true;
  modalEl.innerHTML = `
    <div class="card-modal-backdrop modal-overlay"></div>
    <div class="discussion-panel modal-panel">
      <h3 class="card-modal-title">Team Discussion</h3>
      <p class="discussion-hint">Select one suggested card to play.</p>
      <div class="discussion-grid"></div>
      <div class="card-modal-buttons discussion-actions">
        <button class="btn discussion-play-btn" type="button" disabled>Play Selected</button>
        <button class="btn secondary discussion-close-btn" type="button">Close</button>
      </div>
    </div>
  `;

  panelEl = modalEl.querySelector(".discussion-panel") as HTMLElement;
  panelEl.querySelector(".discussion-close-btn")?.addEventListener("click", () => {
    closeDiscussionModal();
  });

  document.body.appendChild(modalEl);
  return { root: modalEl, panel: panelEl };
}

export function closeDiscussionModal(): void {
  if (!modalEl || !panelEl) return;
  selectedKey = "";
  forceCloseModal(modalEl, panelEl);
}

export function openDiscussionModal(
  pub: PublicGameState,
  priv: PrivateGameState,
  send: SendFn
): void {
  if (!isGameIntroDismissed()) return;
  if (pub.phase !== "day" && pub.phase !== "night") return;

  const { root, panel } = ensureDiscussionModal();
  const grid = panel.querySelector(".discussion-grid")!;
  const playBtn = panel.querySelector(".discussion-play-btn") as HTMLButtonElement;

  selectedKey = "";
  playBtn.disabled = true;

  const suggestions = priv.discussionSuggestions;
  if (!suggestions.length) {
    grid.innerHTML = `<p class="discussion-empty">No playable suggestions right now.</p>`;
  } else {
    grid.innerHTML = suggestions
      .map(
        (s) => `
      <button type="button" class="discussion-card" data-key="${s.playerId}:${s.cardInstanceId}" data-owner="${s.playerId}" data-instance="${s.cardInstanceId}">
        <span class="discussion-card-owner">${s.playerName}</span>
        <img src="${cardImg(s.cardId)}" alt="${cardName(s.cardId)}" />
        <span class="discussion-card-name">${cardName(s.cardId)}</span>
      </button>`
      )
      .join("");

    grid.querySelectorAll(".discussion-card").forEach((el) => {
      el.addEventListener("click", () => {
        grid.querySelectorAll(".discussion-card").forEach((c) => c.classList.remove("is-selected"));
        el.classList.add("is-selected");
        selectedKey = (el as HTMLElement).dataset.key!;
        playBtn.disabled = false;
      });
    });
  }

  playBtn.onclick = () => {
    const selected = grid.querySelector(".discussion-card.is-selected") as HTMLElement | null;
    if (!selected) return;
    send({
      type: "PLAY_DISCUSSED_CARD",
      ownerPlayerId: selected.dataset.owner!,
      cardInstanceId: selected.dataset.instance!,
    });
    closeDiscussionModal();
  };

  openAnimatedModal(root, panel);
}
