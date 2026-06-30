import type { WebSocket } from "ws";
import type { GameAction } from "../shared/types.js";
import { applyAction, toPrivateState, toPublicState } from "./game/engine.js";
import { assignPlayerSlot, buildJoinUrl, getRoom, type Room } from "./rooms.js";

interface Client {
  ws: WebSocket;
  roomId: string;
  role: "tv" | "player" | "host" | "solo";
  slot?: number;
  playerId?: string;
}

const clients = new Map<WebSocket, Client>();

export function registerClient(ws: WebSocket, roomId: string, role: Client["role"], slot?: number, playerId?: string): void {
  clients.set(ws, { ws, roomId, role, slot, playerId });
}

export function removeClient(ws: WebSocket): void {
  const client = clients.get(ws);
  if (client) {
    const room = getRoom(client.roomId);
    if (room && client.playerId) {
      const player = room.game.players.find((p) => p.id === client.playerId);
      if (player) player.isConnected = false;
      broadcastRoom(room);
    }
  }
  clients.delete(ws);
}

export function broadcastRoom(room: Room): void {
  for (const [ws, client] of clients) {
    if (client.roomId !== room.id) continue;
    sendState(ws, room, client.playerId);
  }
}

function sendState(ws: WebSocket, room: Room, playerId?: string): void {
  const payload: Record<string, unknown> = {
    type: "STATE",
    public: toPublicState(room.game),
  };
  if (playerId) {
    try {
      payload.private = toPrivateState(room.game, playerId);
    } catch {
      /* viewer without player */
    }
  }
  ws.send(JSON.stringify(payload));
}

export function handleMessage(ws: WebSocket, raw: string, port: number): void {
  const msg = JSON.parse(raw) as Record<string, unknown>;
  const client = clients.get(ws);

  if (msg.type === "JOIN") {
    const roomId = msg.roomId as string;
    const role = msg.role as Client["role"];
    const room = getRoom(roomId);
    if (!room) {
      ws.send(JSON.stringify({ type: "ERROR", message: "Room not found" }));
      return;
    }

    if (role === "player") {
      const slot = Number(msg.slot);
      const name = (msg.name as string) || `Player ${slot}`;
      const { playerId } = assignPlayerSlot(room, slot, name);
      registerClient(ws, roomId, role, slot, playerId);
    } else {
      registerClient(ws, roomId, role);
    }

    ws.send(
      JSON.stringify({
        type: "ROOM",
        roomId,
        joinUrls: Object.fromEntries([1, 2, 3, 4].map((s) => [s, buildJoinUrl(roomId, s, port)])),
        tvUrl: `/tv.html?room=${roomId}`,
        public: toPublicState(room.game),
      })
    );
    broadcastRoom(room);
    return;
  }

  if (!client) {
    ws.send(JSON.stringify({ type: "ERROR", message: "Not joined" }));
    return;
  }

  const room = getRoom(client.roomId);
  if (!room) return;

  if (msg.type === "ACTION" && client.playerId) {
    try {
      applyAction(room.game, client.playerId, msg.action as GameAction);
      broadcastRoom(room);
    } catch (err) {
      ws.send(JSON.stringify({ type: "ERROR", message: (err as Error).message }));
    }
    return;
  }

  if (msg.type === "START" && (client.role === "host" || client.role === "tv" || client.role === "player")) {
    const possessedId = msg.possessedId as string;
    const playerCount = Number(msg.playerCount) || 2;
    const human = room.game.players.find((p) => p.isHuman) ?? room.game.players[0];
    if (!human) {
      ws.send(JSON.stringify({ type: "ERROR", message: "No player joined" }));
      return;
    }
    try {
      applyAction(room.game, human.id, {
        type: "START_GAME",
        possessedId,
        playerCount: Math.max(2, Math.min(4, playerCount)),
      });
      broadcastRoom(room);
    } catch (err) {
      ws.send(JSON.stringify({ type: "ERROR", message: (err as Error).message }));
    }
  }
}
