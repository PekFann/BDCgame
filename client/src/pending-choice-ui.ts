import type { CardInstance, PrivateGameState, PublicGameState } from "../../shared/types.js";

export const BOARD_EVENT_PENDING_KINDS = new Set([
  "event_pick_one",
  "donut_bandit",
  "haunted_pizza",
]);

export function humanControlsPending(
  pub: PublicGameState,
  humanPlayerId: string
): boolean {
  const pc = pub.pendingChoice;
  if (!pc) return false;
  const controllerId = pc.controllerPlayerId ?? pc.playerId;
  return controllerId === humanPlayerId;
}

export function pendingOwnerHand(
  pub: PublicGameState,
  priv: PrivateGameState
): CardInstance[] {
  const pc = pub.pendingChoice;
  if (!pc) return priv.hand;
  return priv.teamHands.find((t) => t.playerId === pc.playerId)?.hand ?? priv.hand;
}

export function isBoardMountedEventPending(
  pub: PublicGameState,
  humanPlayerId: string
): boolean {
  const pc = pub.pendingChoice;
  if (!pc || !humanControlsPending(pub, humanPlayerId)) return false;
  return BOARD_EVENT_PENDING_KINDS.has(pc.kind);
}
