import type { GameAction, PrivateGameState, PublicGameState } from "../../shared/types.js";
import { cardImg, cardName } from "./ws-client.js";
import { closeAnimatedModal, forceCloseModal, openAnimatedModal } from "./modal-animations.js";

type SendFn = (action: GameAction) => void;

let modalEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;

function ensureModal(): { root: HTMLElement; panel: HTMLElement } {
  if (modalEl && panelEl) return { root: modalEl, panel: panelEl };

  modalEl = document.createElement("div");
  modalEl.id = "demon-target-modal";
  modalEl.className = "card-modal demon-target-modal";
  modalEl.hidden = true;
  modalEl.innerHTML = `
    <div class="card-modal-backdrop modal-overlay"></div>
    <div class="demon-target-panel modal-panel"></div>
  `;

  panelEl = modalEl.querySelector(".demon-target-panel") as HTMLElement;
  document.body.appendChild(modalEl);
  return { root: modalEl, panel: panelEl };
}

function findTargetHp(pub: PublicGameState, targetId: string): number | null {
  if (pub.demon?.instanceId === targetId) return pub.demon.hp;
  const imp = pub.imps.find((i) => i.instanceId === targetId);
  return imp?.hp ?? null;
}

function isImp(pub: PublicGameState, targetId: string): boolean {
  return pub.imps.some((i) => i.instanceId === targetId);
}

function targetCardId(pub: PublicGameState, targetId: string): string {
  if (pub.demon?.instanceId === targetId) return pub.demon.cardId;
  return pub.imps.find((i) => i.instanceId === targetId)?.cardId ?? "dc_cover";
}

export function isDemonTargetModalOpen(): boolean {
  return modalEl !== null && !modalEl.hidden;
}

export function refreshDemonTargetModal(
  pub: PublicGameState,
  priv: PrivateGameState | undefined,
  send: SendFn
): void {
  const { root, panel } = ensureModal();
  const pending = pub.pendingChoice;
  const canTarget =
    pending?.kind === "select_target" &&
    (pending.targets?.length ?? 0) > 1 &&
    (priv?.legalActions ?? []).some((a) => a.type === "SELECT_TARGET");

  if (!canTarget || !pending?.targets) {
    if (!root.hidden) closeAnimatedModal(root, panel, () => {});
    return;
  }

  const dmg = pending.amount ?? 1;
  panel.innerHTML = `
    <h3 class="card-modal-title">Choose a target</h3>
    <p class="card-modal-effect">Deal ${dmg} damage to a demon.</p>
    <div class="demon-target-grid"></div>
  `;

  const grid = panel.querySelector(".demon-target-grid") as HTMLElement;
  for (const targetId of pending.targets) {
    const cardId = targetCardId(pub, targetId);
    const hp = findTargetHp(pub, targetId);
    const imp = isImp(pub, targetId);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `demon-target-card${imp ? " is-imp" : ""}`;
    btn.innerHTML = `
      <img src="${cardImg(cardId)}" alt="${cardName(cardId)}" />
      <span class="demon-target-name">${cardName(cardId)}</span>
      ${hp != null ? `<span class="demon-target-hp">HP ${hp}</span>` : ""}
      <span class="demon-target-dmg">${dmg} dmg</span>
    `;
    btn.addEventListener("click", () => {
      send({ type: "SELECT_TARGET", targetId });
      forceCloseModal(root, panel);
    });
    grid.appendChild(btn);
  }

  if (root.hidden) openAnimatedModal(root, panel);
}

export function resetDemonTargetModal(): void {
  if (modalEl && panelEl && !modalEl.hidden) {
    forceCloseModal(modalEl, panelEl);
  }
}
