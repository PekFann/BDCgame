import type { GameAction, PrivateGameState, PublicGameState } from "../../shared/types.js";
import { cardImg, cardName } from "./ws-client.js";
import { closeAnimatedModal, forceCloseModal, openAnimatedModal } from "./modal-animations.js";

type SendFn = (action: GameAction) => void;

let modalEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;

function ensureModal(): { root: HTMLElement; panel: HTMLElement } {
  if (modalEl && panelEl) return { root: modalEl, panel: panelEl };

  modalEl = document.createElement("div");
  modalEl.id = "lighthouse-modal";
  modalEl.className = "card-modal lighthouse-modal";
  modalEl.hidden = true;
  modalEl.innerHTML = `
    <div class="card-modal-backdrop modal-overlay"></div>
    <div class="lighthouse-panel modal-panel"></div>
  `;

  panelEl = modalEl.querySelector(".lighthouse-panel") as HTMLElement;
  document.body.appendChild(modalEl);
  return { root: modalEl, panel: panelEl };
}

export function isLighthouseModalOpen(): boolean {
  return modalEl !== null && !modalEl.hidden;
}

function ownerHand(priv: PrivateGameState, ownerId: string) {
  return priv.teamHands.find((t) => t.playerId === ownerId)?.hand ?? priv.hand;
}

function populatePanel(
  panel: HTMLElement,
  pub: PublicGameState,
  priv: PrivateGameState,
  send: SendFn
): void {
  const prompt = pub.pendingLighthousePrompt;
  if (!prompt?.awaitingPlayerId) return;

  const owner = pub.players.find((p) => p.id === prompt.awaitingPlayerId);
  if (!owner) return;

  const hand = ownerHand(priv, owner.id);
  const isProxy = !owner.isHuman;
  const title = isProxy
    ? `Choose a card for ${owner.name}`
    : "Discard 1 card to prevent 1 damage?";
  const effectCopy = isProxy
    ? `<strong>${owner.name}</strong> may discard 1 card to block 1 manifest damage. Pick a card below.`
    : `Discard 1 card to block 1 manifest damage before manifest hits.`;

  panel.innerHTML = `
    <h3 class="card-modal-title">${title}</h3>
    <p class="card-modal-effect">
      ${effectCopy}
    </p>
    <div class="lighthouse-hand-pick"></div>
    <div class="card-modal-buttons">
      <button class="btn secondary lighthouse-skip" type="button">Skip</button>
    </div>
  `;

  const pick = panel.querySelector(".lighthouse-hand-pick") as HTMLElement;
  for (const card of hand) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lighthouse-pick-card";
    btn.innerHTML = `<img src="${cardImg(card.cardId)}" alt="${cardName(card.cardId)}" />`;
    btn.addEventListener("click", () => {
      send({ type: "USE_LIGHTHOUSE", discardInstanceId: card.instanceId });
      forceCloseModal(modalEl!, panel);
    });
    pick.appendChild(btn);
  }

  panel.querySelector(".lighthouse-skip")?.addEventListener("click", () => {
    send({ type: "SKIP_LIGHTHOUSE" });
    forceCloseModal(modalEl!, panel);
  });
}

export function refreshLighthouseModal(
  pub: PublicGameState,
  priv: PrivateGameState | undefined,
  send: SendFn
): void {
  const { root, panel } = ensureModal();
  const prompt = pub.pendingLighthousePrompt;
  const canRespond = (priv?.legalActions ?? []).some(
    (a) => a.type === "USE_LIGHTHOUSE" || a.type === "SKIP_LIGHTHOUSE"
  );

  if (!prompt || !canRespond || !priv) {
    if (!root.hidden) closeAnimatedModal(root, panel, () => {});
    return;
  }

  populatePanel(panel, pub, priv, send);
  if (root.hidden) {
    openAnimatedModal(root, panel);
  } else {
    root.hidden = false;
    root.style.pointerEvents = "";
    panel.classList.remove("is-closing");
    root.classList.remove("is-closing");
    root.querySelector(".card-modal-backdrop, .modal-overlay")?.classList.remove("is-closing");
  }
}

export function resetLighthouseModal(): void {
  if (modalEl && panelEl && !modalEl.hidden) {
    forceCloseModal(modalEl, panelEl);
  }
}
