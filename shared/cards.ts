import cardsData from "../data/cards.json" with { type: "json" };
import dncData from "../data/dnc.json" with { type: "json" };
import type { CardDefinition, DncDefinition } from "./types.js";

export const CARDS: Record<string, CardDefinition> = Object.fromEntries(
  (cardsData as CardDefinition[]).map((c) => [c.id, c])
);

export const DNC: Record<string, DncDefinition> = Object.fromEntries(
  (dncData as DncDefinition[]).map((d) => [d.id, d])
);

export function getCard(id: string): CardDefinition {
  const card = CARDS[id];
  if (!card) throw new Error(`Unknown card: ${id}`);
  return card;
}

export function assetUrl(file: string): string {
  return `/assets/${file.replace(/\\/g, "/")}`;
}

export const ACTION_DECK_COUNTS: Record<string, number> = {
  action_01: 12,
  action_02: 5,
  action_03: 3,
  action_04: 3,
  action_05: 3,
  action_06: 2,
  action_07: 2,
  action_08: 2,
  action_09: 3,
  action_10: 3,
  action_11: 2,
  action_12: 4,
  action_13: 4,
  action_14: 2,
  action_15: 1,
  action_16: 3,
  action_17: 1,
  action_18: 1,
  action_19: 1,
  action_20: 2,
  action_21: 1,
};

export const EVENT_DECK_IDS = [
  "event_01", "event_02", "event_03", "event_04", "event_05",
  "event_06", "event_07", "event_08", "event_09", "event_10",
  "event_11", "event_12", "event_13", "event_14", "event_15",
  "event_16", "event_17", "event_18", "event_19", "event_20",
  "event_21", "event_22", "event_23", "event_24",
];

export const POSSESSED_IDS = [
  "possessed_01", "possessed_02", "possessed_03", "possessed_04", "possessed_05",
  "possessed_06", "possessed_07", "possessed_08", "possessed_09", "possessed_10",
];

export const DEMON_IDS = [
  "dc_01", "dc_02", "dc_03", "dc_04", "dc_05", "dc_06", "dc_07",
  "dc_08", "dc_09", "dc_10", "dc_11", "dc_12", "dc_13",
];

export function listCardsByDeck(deck: string): CardDefinition[] {
  return Object.values(CARDS).filter((c) => c.deck === deck);
}
