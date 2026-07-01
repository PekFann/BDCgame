import type { CardInstance, PublicGameState } from "../../shared/types.js";
import { cardImg, cardName } from "./ws-client.js";
import { closeAnimatedModal, forceCloseModal, openAnimatedModal } from "./modal-animations.js";

let modalEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;

function ensureDiscardModal(): { root: HTMLElement; panel: HTMLElement } {
  if (modalEl && panelEl) return { root: modalEl, panel: panelEl };

  modalEl = document.createElement("div");
  modalEl.id = "discard-pile-modal";
  modalEl.className = "card-modal discard-pile-modal";
  modalEl.hidden = true;
  modalEl.innerHTML = `
    <div class="card-modal-backdrop modal-overlay"></div>
    <div class="discard-pile-panel modal-panel">
      <h3 class="card-modal-title">Action Discard</h3>
      <p class="card-modal-meta discard-pile-subtitle"></p>
      <div class="discard-pile-grid"></div>
      <div class="card-modal-buttons">
        <button class="btn secondary discard-pile-close" type="button">Close</button>
      </div>
    </div>
  `;

  panelEl = modalEl.querySelector(".discard-pile-panel") as HTMLElement;
  panelEl.querySelector(".discard-pile-close")?.addEventListener("click", () => {
    if (modalEl && panelEl) forceCloseModal(modalEl, panelEl);
  });
  modalEl.querySelector(".card-modal-backdrop")?.addEventListener("click", () => {
    if (modalEl && panelEl) forceCloseModal(modalEl, panelEl);
  });

  document.body.appendChild(modalEl);
  return { root: modalEl, panel: panelEl };
}

function getActionDiscard(pub: PublicGameState): CardInstance[] {
  return pub.actionDiscard ?? [];
}

function getActionDiscardCount(pub: PublicGameState): number {
  const discard = getActionDiscard(pub);
  return discard.length > 0 ? discard.length : (pub.actionDiscardCount ?? 0);
}

export function openDiscardPileModal(pub: PublicGameState): void {
  const { root, panel } = ensureDiscardModal();
  const cards = [...getActionDiscard(pub)].reverse();
  const grid = panel.querySelector(".discard-pile-grid")!;
  const subtitle = panel.querySelector(".discard-pile-subtitle")!;

  subtitle.textContent =
    cards.length === 0
      ? "No cards in the discard pile."
      : `${cards.length} card${cards.length === 1 ? "" : "s"} — newest first`;

  if (cards.length === 0) {
    grid.innerHTML = `<p class="discard-pile-empty-msg">The discard pile is empty.</p>`;
  } else {
    grid.innerHTML = cards
      .map(
        (c) => `
      <figure>
        <img src="${cardImg(c.cardId)}" alt="${cardName(c.cardId)}" loading="lazy" />
        <figcaption>${cardName(c.cardId)}</figcaption>
      </figure>`
      )
      .join("");
  }

  openAnimatedModal(root, panel);
}

export function closeDiscardPileModal(): void {
  if (!modalEl || !panelEl) return;
  closeAnimatedModal(modalEl, panelEl, () => {});
}

export function renderDiscardPileSlot(el: HTMLElement, pub: PublicGameState): void {
  el.innerHTML = "";
  const discard = getActionDiscard(pub);
  const count = getActionDiscardCount(pub);
  const top = discard[discard.length - 1];

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = discard.length > 0 ? "hand-discard-pile" : "hand-discard-pile hand-discard-pile-empty";
  btn.title =
    count === 0
      ? "Browse action discard (empty)"
      : `Browse action discard (${count})`;

  if (discard.length > 0 && top) {
    btn.innerHTML = `
    <span class="hand-discard-stack">
      <span class="discard-card-back" aria-hidden="true"></span>
      <img class="discard-top-card" src="${cardImg(top.cardId)}" alt="" />
    </span>
    <span class="hand-discard-count">${count}</span>
  `;
  } else {
    btn.innerHTML = `
    <span class="hand-discard-stack hand-discard-stack-empty" aria-hidden="true">
      <span class="discard-card-back"></span>
    </span>
    <span class="hand-discard-empty-label">Discard</span>
  `;
  }

  btn.addEventListener("click", () => openDiscardPileModal(pub));
  el.appendChild(btn);
}
