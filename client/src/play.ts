import { initPlayerApp } from "./player-app.js";

const params = new URLSearchParams(location.search);
const roomId = params.get("room") ?? "";
const slot = Number(params.get("slot") ?? "1");
const name = params.get("name") ?? `Player ${slot}`;

initPlayerApp({ roomId, slot, name });
