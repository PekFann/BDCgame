import { GameClient, renderBoard, renderBoardEventChoice } from "./ws-client.js";
import { countConnectedHumans } from "./lobby-ui.js";
import { handlePresentationUpdate } from "./phase-orchestrator.js";
import { isGameIntroRunning, runGameIntroIfNeeded, shouldDeferGameRender } from "./game-intro-orchestrator.js";

const params = new URLSearchParams(location.search);
const roomId = params.get("room") ?? "";

function renderTvLobby(board: HTMLElement, pub: Parameters<typeof countConnectedHumans>[0]): void {
  const humans = countConnectedHumans(pub);
  board.innerHTML = `
    <div class="tv-lobby glass-panel">
      <h2 class="tv-lobby-title">Breaking Demon's Contract</h2>
      <p class="tv-lobby-status">${humans} player${humans === 1 ? "" : "s"} connected</p>
      <p class="tv-lobby-hint">Scan a QR code with your phone. Player 1 picks Possessed on their phone, then press Start on your phone.</p>
      <p class="tv-lobby-demon">Demon contract: Random</p>
    </div>
  `;
}

const client = new GameClient();
client.connect({ roomId, role: "tv" }).then(() => {
  client.onStateUpdate((pub) => {
    const board = document.getElementById("board")!;
    const send = (a: Parameters<typeof client.sendAction>[0]) => client.sendAction(a);

    if (!pub.started) {
      renderTvLobby(board, pub);
      return;
    }

    if (isGameIntroRunning()) return;

    if (shouldDeferGameRender(pub)) {
      void runGameIntroIfNeeded(pub, {
        mode: "tv",
        boardRoot: board,
        hand: [],
        onRenderBoard: () => {
          renderBoard(board, pub);
          renderBoardEventChoice(board, pub, client.privateState ?? undefined, undefined);
        },
      });
      return;
    }

    renderBoard(board, pub);
    renderBoardEventChoice(board, pub, client.privateState ?? undefined, undefined);

    if (pub.presentationHold) {
      void handlePresentationUpdate(pub, {
        boardRoot: board,
        prevHandIds: new Set(),
        hand: [],
        send,
        mode: "tv",
      });
    }
  });
});
