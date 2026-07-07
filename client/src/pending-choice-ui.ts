import type { PublicGameState } from "../../shared/types.js";

export const BOARD_EVENT_PENDING_KINDS = new Set([
  "event_pick_one",
  "donut_bandit",
  "haunted_pizza",
]);

export function isBoardMountedEventPending(
  pub: PublicGameState,
  humanPlayerId: string
): boolean {
  const pc = pub.pendingChoice;
  if (!pc || pc.playerId !== humanPlayerId) return false;
  return BOARD_EVENT_PENDING_KINDS.has(pc.kind);
}
