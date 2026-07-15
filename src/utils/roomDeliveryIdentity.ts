import type { RoomAgentDelivery, RoomUserMessage, TimelineEvent } from "@/types/ui";

function hasExplicitIdentity(event: TimelineEvent): boolean {
  return Boolean(event.roomMessageId || event.agentTurnId || event.dispatchAttemptId);
}

export interface RoomDeliveryUserEventResolution {
  transactionIndexes: number[];
  legacyOfficialIndexes: number[];
  hasTransactionConflict: boolean;
}

/**
 * Resolve canonical aliases without text or timestamp guessing. Complete room
 * message/turn ownership always wins over the identity-less official-ID
 * compatibility path.
 */
export function resolveRoomDeliveryUserEvents(
  events: readonly TimelineEvent[],
  message: RoomUserMessage,
  delivery: RoomAgentDelivery,
  allowLegacyOfficialId: boolean,
): RoomDeliveryUserEventResolution {
  const exactPairCandidates = events.flatMap((event, index) => {
    if (
      event.type !== "user_message" ||
      event.roomMessageId !== message.id ||
      event.agentTurnId !== delivery.agentTurnId
    ) return [];
    return [index];
  });
  const explicitAttemptIds = new Set(exactPairCandidates.flatMap((index) => {
    const attemptId = events[index].dispatchAttemptId;
    return attemptId ? [attemptId] : [];
  }));
  const transactionIndexes = delivery.dispatchAttemptId
    ? (() => {
        const hasMatchingAttempt = exactPairCandidates.some((index) => (
          events[index].dispatchAttemptId === delivery.dispatchAttemptId
        ));
        const hasMismatchedAttempt = exactPairCandidates.some((index) => (
          Boolean(events[index].dispatchAttemptId) &&
          events[index].dispatchAttemptId !== delivery.dispatchAttemptId
        ));
        if (hasMismatchedAttempt && !hasMatchingAttempt) return [];
        return exactPairCandidates.filter((index) => {
          const attemptId = events[index].dispatchAttemptId;
          if (hasMismatchedAttempt) return attemptId === delivery.dispatchAttemptId;
          return !attemptId || attemptId === delivery.dispatchAttemptId;
        });
      })()
    : explicitAttemptIds.size > 1
      ? []
      : exactPairCandidates;
  const hasTransactionConflict = delivery.dispatchAttemptId
    ? exactPairCandidates.some((index) => (
        Boolean(events[index].dispatchAttemptId) &&
        events[index].dispatchAttemptId !== delivery.dispatchAttemptId
      ))
    : explicitAttemptIds.size > 1;

  const legacyOfficialIndexes = allowLegacyOfficialId &&
    exactPairCandidates.length === 0 &&
    delivery.officialUserEventId
    ? events.flatMap((event, index) => (
        event.type === "user_message" &&
        !hasExplicitIdentity(event) &&
        event.id === delivery.officialUserEventId
          ? [index]
          : []
      ))
    : [];
  return { transactionIndexes, legacyOfficialIndexes, hasTransactionConflict };
}

export function isOfficialUserEventIdUniqueToDelivery(
  messages: readonly RoomUserMessage[],
  roomAgentId: string,
  officialUserEventId: string | undefined,
): boolean {
  if (!officialUserEventId) return false;
  let owners = 0;
  for (const message of messages) {
    const delivery = message.deliveries[roomAgentId];
    const ownsOfficialId = delivery?.officialUserEventId === officialUserEventId ||
      Boolean(delivery?.previousAttempts?.some((attempt) => (
        attempt.officialUserEventId === officialUserEventId
      )));
    if (!ownsOfficialId) continue;
    owners += 1;
    if (owners > 1) return false;
  }
  return owners === 1;
}
