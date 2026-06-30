import { GameClient, renderBoard, renderBoardEventChoice } from "./ws-client.js";
import { handlePresentationUpdate } from "./phase-orchestrator.js";
import { isGameIntroRunning, runGameIntroIfNeeded, shouldDeferGameRender } from "./game-intro-orchestrator.js";

const params = new URLSearchParams(location.search);
const roomId = params.get("room") ?? "";

const client = new GameClient();
client.connect({ roomId, role: "tv" }).then(() => {
  client.onStateUpdate((pub) => {
    const board = document.getElementById("board")!;
    const send = (a: Parameters<typeof client.sendAction>[0]) => client.sendAction(a);

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
