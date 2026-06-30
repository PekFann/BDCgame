import { networkInterfaces } from "os";
import { randomUUID } from "crypto";
import type { GameState } from "../shared/types.js";
import { createEmptyGame } from "./game/engine.js";

export interface RoomConnection {
  wsId: string;
  role: "tv" | "player" | "host";
  slot?: number;
  playerId?: string;
  token: string;
}

export interface Room {
  id: string;
  game: GameState;
  connections: Map<string, RoomConnection>;
  createdAt: number;
}

const rooms = new Map<string, Room>();

export function getLanIp(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "localhost";
}

export function createRoom(mode: "solo" | "multi" = "multi"): Room {
  const id = randomUUID().slice(0, 8);
  const room: Room = {
    id,
    game: createEmptyGame(mode),
    connections: new Map(),
    createdAt: Date.now(),
  };
  rooms.set(id, room);
  return room;
}

export function getRoom(id: string): Room | undefined {
  return rooms.get(id);
}

export function getOrCreateSoloRoom(): Room {
  let solo = [...rooms.values()].find((r) => r.game.mode === "solo" && !r.game.started);
  if (!solo) solo = createRoom("solo");
  return solo;
}

export function getPublicBaseUrl(port: number): string {
  const external = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_BASE_URL;
  if (external) return external.replace(/\/$/, "");
  return `http://${getLanIp()}:${port}`;
}

export function buildJoinUrl(roomId: string, slot: number, port: number): string {
  return `${getPublicBaseUrl(port)}/play.html?room=${roomId}&slot=${slot}`;
}

export function assignPlayerSlot(room: Room, slot: number, name: string): { playerId: string; token: string } {
  const token = randomUUID();
  if (room.game.players.length === 0) {
    room.game.players = Array.from({ length: 4 }, (_, i) => ({
      id: randomUUID(),
      slot: i,
      name: `Player ${i + 1}`,
      isHuman: false,
      isConnected: false,
      energy: 5,
      friendship: 0,
      hand: [],
      persistentCards: [],
      firstAidKit: false,
      restVote: null,
      drawChoice: null,
      drawChoicesThisPhase: 0,
      usedPhaseAction: false,
    }));
  }
  const player = room.game.players.find((p) => p.slot === slot - 1);
  if (!player) throw new Error("Invalid slot");
  player.name = name;
  player.isHuman = true;
  player.isConnected = true;
  return { playerId: player.id, token };
}

export function listRooms(): string[] {
  return [...rooms.keys()];
}
