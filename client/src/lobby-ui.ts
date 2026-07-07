import type { GameAction, PublicGameState } from "../../shared/types.js";
import { fetchPossessedOptions } from "./ws-client.js";

type SendFn = (action: GameAction) => void;

export function countConnectedHumans(pub: PublicGameState): number {
  return pub.connectedHumanCount ?? pub.players.filter((p) => p.isHuman && p.isConnected).length;
}

export function canStartLobbyGame(pub: PublicGameState): boolean {
  const humans = countConnectedHumans(pub);
  if (humans < 1) return false;
  return !!pub.lobbyPossessedId;
}

export async function renderLobbyPanel(
  container: HTMLElement,
  pub: PublicGameState,
  slot: number,
  send: SendFn,
  onStart: (possessedId: string) => void,
  onError?: (message: string) => void
): Promise<void> {
  const humans = countConnectedHumans(pub);
  const isPlayer1 = slot === 1;
  const possessedId = pub.lobbyPossessedId ?? "";

  container.innerHTML = `
    <div class="lobby-panel glass-panel">
      <h2 class="lobby-title">Waiting to start</h2>
      <p class="lobby-status">${humans} player${humans === 1 ? "" : "s"} connected</p>
      <p class="lobby-hint">${
        isPlayer1
          ? "You are Player 1 — choose Possessed, then tap Start."
          : humans > 0
            ? `Game will start as a ${humans}-player match. Tap Start on your phone when ready.`
            : "Scan a QR code on the host screen to join."
      }</p>
      ${
        isPlayer1
          ? `<label class="lobby-label">Possessed
              <select id="lobby-possessed" class="lobby-select">
                <option value="">Loading characters…</option>
              </select>
            </label>`
          : ""
      }
      <p class="lobby-demon-note">Demon contract: <strong>Random</strong></p>
      ${!isPlayer1 ? `<p class="lobby-wait-p1">Waiting for Player 1 to choose Possessed.</p>` : ""}
      <p id="lobby-error" class="lobby-error" style="display:none"></p>
      <button class="btn lobby-start-btn" type="button" id="lobby-start" disabled>Start Game</button>
    </div>
  `;

  const errEl = container.querySelector("#lobby-error") as HTMLElement;
  const showErr = (msg: string) => {
    if (onError) onError(msg);
    else if (errEl) {
      errEl.textContent = msg;
      errEl.style.display = "block";
    }
  };

  const startBtn = container.querySelector("#lobby-start") as HTMLButtonElement;
  let select: HTMLSelectElement | null = null;

  if (isPlayer1) {
    select = container.querySelector("#lobby-possessed") as HTMLSelectElement;
    try {
      const options = await fetchPossessedOptions();
      select.innerHTML = options
        .map((o) => `<option value="${o.id}">${o.name}</option>`)
        .join("");
      if (possessedId) select.value = possessedId;
      startBtn.disabled = !select.value;
      select.addEventListener("change", () => {
        send({ type: "SET_LOBBY_POSSESSED", possessedId: select!.value });
        startBtn.disabled = !select!.value;
        errEl.style.display = "none";
      });
      if (!possessedId && select.value) {
        send({ type: "SET_LOBBY_POSSESSED", possessedId: select.value });
      }
    } catch (err) {
      select.innerHTML = `<option value="">Could not load characters</option>`;
      startBtn.disabled = true;
      showErr((err as Error).message);
    }
  } else {
    startBtn.disabled = !canStartLobbyGame(pub);
  }

  startBtn.addEventListener("click", () => {
    if (isPlayer1) {
      const chosen = select?.value ?? "";
      if (!chosen) {
        showErr("Choose a Possessed character first.");
        return;
      }
      send({ type: "SET_LOBBY_POSSESSED", possessedId: chosen });
      onStart(chosen);
      return;
    }
    if (!canStartLobbyGame(pub)) {
      showErr("Player 1 must choose Possessed before starting.");
      return;
    }
    onStart(pub.lobbyPossessedId!);
  });
}
