import { createRoom, fetchPossessedOptions, GameClient } from "./ws-client.js";

const client = new GameClient();
let roomId = "";

function showSetupError(message: string): void {
  const status = document.getElementById("status")!;
  status.textContent = message;
  status.style.color = "var(--danger)";
}

async function init() {
  const { roomId: id, joinUrls } = await createRoom();
  roomId = id;
  document.getElementById("status")!.textContent = `Room: ${roomId}`;

  const qr = document.getElementById("qr")!;
  qr.innerHTML = [1, 2, 3, 4]
    .map(
      (slot) => `
    <div class="qr-item">
      <p>Player ${slot}</p>
      <img src="/api/rooms/${roomId}/qr/${slot}" alt="QR ${slot}" />
      <p style="font-size:0.75rem;word-break:break-all">${joinUrls[slot]}</p>
    </div>`
    )
    .join("");

  const possessedSelect = document.getElementById("possessed") as HTMLSelectElement;
  const startBtn = document.getElementById("startBtn") as HTMLButtonElement;
  try {
    const options = await fetchPossessedOptions();
    possessedSelect.innerHTML = options.map((o) => `<option value="${o.id}">${o.name}</option>`).join("");
  } catch (err) {
    showSetupError((err as Error).message);
    startBtn.disabled = true;
  }

  await client.connect({ roomId, role: "host" });

  document.getElementById("openTv")!.addEventListener("click", () => {
    window.open(`/tv.html?room=${roomId}`, "_blank");
  });

  startBtn.addEventListener("click", () => {
    const possessedId = possessedSelect.value;
    if (!possessedId) {
      showSetupError("Please select a Possessed character.");
      return;
    }
    const playerCount = Number((document.getElementById("playerCount") as HTMLSelectElement).value);
    client.startGame(possessedId, playerCount);
    alert("Game started! Open TV view and have players scan QR codes.");
  });
}

init();
