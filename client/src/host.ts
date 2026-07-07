import { createRoom, GameClient } from "./ws-client.js";



let roomId = "";

let redirecting = false;



function goToTvView(): void {

  if (!roomId || redirecting) return;

  redirecting = true;

  window.location.replace(`/tv.html?room=${roomId}`);

}



async function init() {

  const { roomId: id, joinUrls } = await createRoom();

  roomId = id;

  const statusEl = document.getElementById("status")!;

  statusEl.textContent = `Room: ${roomId} — waiting for players to start`;



  const qr = document.getElementById("qr")!;

  qr.innerHTML = [1, 2, 3, 4]

    .map(

      (slot) => `

    <div class="qr-item">

      <p>Player ${slot}</p>

      <img src="/api/rooms/${roomId}/qr/${slot}" alt="QR ${slot}" />

      <p class="qr-url">${joinUrls[slot]}</p>

    </div>`

    )

    .join("");



  document.getElementById("openTv")!.addEventListener("click", () => {

    goToTvView();

  });



  const client = new GameClient();

  client.onStateUpdate((pub) => {

    if (pub.started) goToTvView();

  });



  await client.connect({ roomId, role: "host" });

  if (client.publicState?.started) goToTvView();

}



init();

