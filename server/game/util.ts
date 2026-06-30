import { randomUUID } from "crypto";
import type { CardInstance } from "../../shared/types.js";

export function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function makeInstance(cardId: string): CardInstance {
  return { instanceId: randomUUID(), cardId };
}

export function rollD6(): number {
  return Math.floor(Math.random() * 6) + 1;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function log(state: { log: string[] }, message: string): void {
  state.log.push(message);
  if (state.log.length > 100) state.log.shift();
}
