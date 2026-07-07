import type { GameAction, PrivateGameState, PublicGameState } from "../../shared/types.js";
import cardsData from "../../data/cards.json";
import { isGameIntroDismissed } from "./game-start-modal.js";
import { forceCloseModal, openAnimatedModal } from "./modal-animations.js";
import { cardImg, cardName, formatPhaseActionLabel } from "./ws-client.js";

type SendFn = (action: GameAction) => void;

const cardEffectById = Object.fromEntries(
  (cardsData as { id: string; effect?: string }[]).map((c) => [c.id, c.effect ?? ""])
);

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
      <p class="discussion-hint">Pick a teammate's recommended play — uses their action and energy.</p>
      <div class="discussion-context"></div>
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

function buildContextBar(pub: PublicGameState): string {
  const demon = pub.demonRevealed ? "Demon revealed" : "Demon hidden";
  const hp = `Possessed ${pub.possessedHp}/${pub.possessedMaxHp} HP`;
  const phaseLabel =
    pub.phase === "day"
      ? formatPhaseActionLabel("day", pub.dayActionsRemaining, pub.currentDncDayTotal)
      : pub.phase === "night"
        ? formatPhaseActionLabel("night", pub.nightActionsRemaining, pub.currentDncNightTotal)
        : "";
  return [hp, demon, phaseLabel].filter(Boolean).join(" · ");
}

function formatCosts(energyCost: number, friendshipCost: number): string {
  const parts: string[] = [];
  if (energyCost > 0) parts.push(`E${energyCost}`);
  if (friendshipCost > 0) parts.push(`F${friendshipCost}`);
  return parts.length ? parts.join(" · ") : "Free";
}

function emptyMessage(pub: PublicGameState, priv: PrivateGameState): string {
  const aiUsedAction = pub.players.some((p) => !p.isHuman && p.usedPhaseAction);
  const allAiUsed = pub.players.filter((p) => !p.isHuman).every((p) => p.usedPhaseAction);
  if (allAiUsed && pub.players.some((p) => !p.isHuman)) {
    return "All teammates have used their phase action.";
  }
  if (aiUsedAction) {
    return "No playable teammate cards right now — check energy, friendship, or modifiers.";
  }
  return "No playable suggestions right now.";
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
  const contextEl = panel.querySelector(".discussion-context")!;
  const playBtn = panel.querySelector(".discussion-play-btn") as HTMLButtonElement;

  selectedKey = "";
  playBtn.disabled = true;
  contextEl.textContent = buildContextBar(pub);

  const suggestions = priv.discussionSuggestions;
  if (!suggestions.length) {
    grid.innerHTML = `<p class="discussion-empty">${emptyMessage(pub, priv)}</p>`;
  } else {
    grid.innerHTML = suggestions
      .map(
        (s, index) => `
      <button type="button" class="discussion-card discussion-card--${s.category}${index === 0 ? " discussion-card--top" : ""}" data-key="${s.playerId}:${s.cardInstanceId}" data-owner="${s.playerId}" data-instance="${s.cardInstanceId}">
        ${index === 0 ? `<span class="discussion-rank">Best pick</span>` : `<span class="discussion-rank discussion-rank-muted">#${index + 1}</span>`}
        <span class="discussion-card-owner">${s.playerName}</span>
        <img src="${cardImg(s.cardId)}" alt="${cardName(s.cardId)}" />
        <span class="discussion-card-name">${cardName(s.cardId)}</span>
        <span class="discussion-card-costs">${formatCosts(s.energyCost, s.friendshipCost)}</span>
        <span class="discussion-card-rationale">${s.rationale}</span>
        <span class="discussion-card-effect">${cardEffectById[s.cardId] ?? ""}</span>
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
