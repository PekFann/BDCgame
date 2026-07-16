import type { GameAction, PublicGameState } from "../../shared/types.js";
import { cardName } from "./ws-client.js";
import { forceCloseCardModal, isCardModalOpen } from "./card-modal.js";
import { closeAnimatedModal, forceCloseModal, openAnimatedModal } from "./modal-animations.js";
import { humanControlsPending } from "./pending-choice-ui.js";

type SendFn = (action: GameAction) => void;

let modalEl: HTMLElement | null = null;
let panelEl: HTMLElement | null = null;
/** Stable while the same distribute_energy pending is active. */
let sessionKey: string | null = null;
let allocations: Record<string, number> = {};

function ensureModal(): { root: HTMLElement; panel: HTMLElement } {
  if (modalEl && panelEl) return { root: modalEl, panel: panelEl };

  modalEl = document.createElement("div");
  modalEl.id = "coffee-break-modal";
  modalEl.className = "card-modal coffee-break-modal";
  modalEl.hidden = true;
  modalEl.innerHTML = `
    <div class="card-modal-backdrop modal-overlay"></div>
    <div class="coffee-break-panel modal-panel">
      <h3 class="coffee-break-title card-modal-title"></h3>
      <p class="coffee-break-hint card-modal-effect"></p>
      <div class="coffee-break-rows"></div>
      <div class="card-modal-buttons">
        <button class="btn coffee-break-confirm" type="button" disabled>Confirm</button>
      </div>
    </div>
  `;

  panelEl = modalEl.querySelector(".coffee-break-panel") as HTMLElement;
  document.body.appendChild(modalEl);
  return { root: modalEl, panel: panelEl };
}

function sumAllocations(): number {
  return Object.values(allocations).reduce((a, b) => a + b, 0);
}

function pendingSessionKey(pub: PublicGameState): string | null {
  const pending = pub.pendingChoice;
  if (!pending || pending.kind !== "distribute_energy") return null;
  return `${pending.playerId}:${pending.cardInstanceId ?? ""}:${pending.amount ?? 5}`;
}

function resetSession(): void {
  sessionKey = null;
  allocations = {};
}

function syncAllocationKeys(playerIds: string[]): void {
  const next: Record<string, number> = {};
  for (const id of playerIds) {
    next[id] = allocations[id] ?? 0;
  }
  allocations = next;
}

function renderRows(
  panel: HTMLElement,
  pub: PublicGameState,
  amount: number,
  send: SendFn
): void {
  const rows = panel.querySelector(".coffee-break-rows") as HTMLElement;
  const hint = panel.querySelector(".coffee-break-hint") as HTMLElement;
  const confirm = panel.querySelector(".coffee-break-confirm") as HTMLButtonElement;

  const assigned = sumAllocations();
  const remaining = amount - assigned;
  hint.textContent = `${remaining} of ${amount} energy left to distribute.`;

  rows.innerHTML = "";
  for (const player of pub.players) {
    const value = allocations[player.id] ?? 0;
    const row = document.createElement("div");
    row.className = "coffee-break-row";
    row.innerHTML = `
      <div class="coffee-break-row-info">
        <span class="coffee-break-row-name">${player.name}${player.isHuman ? " (you)" : ""}</span>
        <span class="coffee-break-row-energy">Energy ${player.energy}</span>
      </div>
      <div class="coffee-break-stepper">
        <button type="button" class="btn secondary coffee-break-dec" aria-label="Give less">−</button>
        <span class="coffee-break-value">${value}</span>
        <button type="button" class="btn secondary coffee-break-inc" aria-label="Give more">+</button>
      </div>
    `;
    const dec = row.querySelector(".coffee-break-dec") as HTMLButtonElement;
    const inc = row.querySelector(".coffee-break-inc") as HTMLButtonElement;
    dec.disabled = value <= 0;
    inc.disabled = remaining <= 0;
    dec.addEventListener("click", () => {
      if ((allocations[player.id] ?? 0) <= 0) return;
      allocations[player.id] = (allocations[player.id] ?? 0) - 1;
      renderRows(panel, pub, amount, send);
    });
    inc.addEventListener("click", () => {
      if (sumAllocations() >= amount) return;
      allocations[player.id] = (allocations[player.id] ?? 0) + 1;
      renderRows(panel, pub, amount, send);
    });
    rows.appendChild(row);
  }

  confirm.disabled = assigned !== amount;
  confirm.onclick = () => {
    if (sumAllocations() !== amount) return;
    const distribution: Record<string, number> = {};
    for (const [pid, amt] of Object.entries(allocations)) {
      if (amt > 0) distribution[pid] = amt;
    }
    send({ type: "DISTRIBUTE_ENERGY", distribution });
    resetSession();
    if (modalEl && panelEl) forceCloseModal(modalEl, panelEl);
  };
}

export function isCoffeeBreakModalOpen(): boolean {
  return modalEl !== null && !modalEl.hidden;
}

export function refreshCoffeeBreakModal(
  pub: PublicGameState,
  send: SendFn,
  humanPlayerId: string
): void {
  const { root, panel } = ensureModal();
  const pending = pub.pendingChoice;
  const canDistribute =
    pending?.kind === "distribute_energy" && humanControlsPending(pub, humanPlayerId);

  if (!canDistribute) {
    if (!root.hidden) {
      closeAnimatedModal(root, panel, () => {});
      resetSession();
    }
    return;
  }

  if (isCardModalOpen()) forceCloseCardModal();

  const amount = pending!.amount ?? 5;
  const key = pendingSessionKey(pub);
  if (key !== sessionKey) {
    sessionKey = key;
    allocations = {};
    syncAllocationKeys(pub.players.map((p) => p.id));
  } else {
    syncAllocationKeys(pub.players.map((p) => p.id));
  }

  const title = panel.querySelector(".coffee-break-title") as HTMLElement;
  title.textContent = pending!.cardId
    ? `${cardName(pending!.cardId)} — distribute energy`
    : "Coffee Break — distribute energy";

  renderRows(panel, pub, amount, send);

  if (root.hidden) openAnimatedModal(root, panel);
}

export function resetCoffeeBreakModal(): void {
  resetSession();
  if (modalEl && panelEl && !modalEl.hidden) {
    forceCloseModal(modalEl, panelEl);
  }
}
