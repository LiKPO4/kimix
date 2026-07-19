import type { Session, TimelineEvent } from "@/types/ui";
import {
  getPrimaryRoomAgent,
  getRoomAgent,
  getRoomAgentEvents,
  repairMissingRoomDeliveryAttemptIds,
  scopeEventToRoomAgent,
  updateRoomAgent,
  updateRoomAgentEvents,
} from "@/utils/collaborationRooms";
import { preserveLocalUserMediaInCanonicalHistory } from "@/utils/eventMapper";
import { reconcileRunningKimiSnapshot } from "@/utils/kimiCodeSnapshotReplay";
import { applyCanonicalUndoHistory } from "@/utils/undoHistory";
import { KIMI_HISTORY_CACHE_VERSION } from "@/utils/kimiHistoryCache";
import {
  isOfficialUserEventIdUniqueToDelivery,
  resolveRoomDeliveryUserEvents,
} from "@/utils/roomDeliveryIdentity";

export type AgentCanonicalHistoryReason = "startup" | "running-sample" | "undo" | "repair";

export interface ReconcileAgentCanonicalHistoryInput {
  session: Session;
  roomAgentId: string;
  expectedRuntimeSessionId?: string;
  canonicalEvents: TimelineEvent[];
  reason: AgentCanonicalHistoryReason;
}

export interface ReconcileAgentCanonicalHistoryResult {
  session: Session;
  events: TimelineEvent[];
  applied: boolean;
  discardedReason?: "agent-missing" | "runtime-changed";
}

/** Mark a Kimi history cache current only after its caller adopts canonical events. */
export function markAgentKimiHistoryCacheCurrent(session: Session, roomAgentId: string): Session {
  if (session.collaboration) {
    return updateRoomAgent(session, roomAgentId, (current) => ({
      ...current,
      kimiHistoryCacheVersion: KIMI_HISTORY_CACHE_VERSION,
    }));
  }
  return { ...session, kimiHistoryCacheVersion: KIMI_HISTORY_CACHE_VERSION };
}

function runtimeIdentityMatches(session: Session, roomAgentId: string, expectedRuntimeSessionId?: string): boolean {
  if (!expectedRuntimeSessionId) return true;
  const agent = getRoomAgent(session, roomAgentId);
  if (!agent) return false;
  const identities = [agent.runtimeSessionId, agent.officialSessionId];
  if (getPrimaryRoomAgent(session).id === roomAgentId) {
    identities.push(session.runtimeSessionId, session.officialSessionId, session.id);
  }
  const known = identities.filter((value): value is string => Boolean(value));
  return known.length === 0 || known.includes(expectedRuntimeSessionId);
}

function normalizedMessageText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function bindCanonicalHistoryToRoomMessages(
  session: Session,
  roomAgentId: string,
  canonicalEvents: TimelineEvent[],
  reason: AgentCanonicalHistoryReason,
): { events: TimelineEvent[]; messages: NonNullable<Session["collaboration"]>["messages"] | null } {
  if (!session.collaboration) return { events: canonicalEvents, messages: null };

  const userIndexes = canonicalEvents.flatMap((event, index) => (
    event.type === "user_message" ? [index] : []
  ));
  const claimedUserIndexes = new Set<number>();
  const bindings: Array<{ messageId: string; agentTurnId: string; userIndex: number }> = [];
  const targetMessages = session.collaboration.messages.filter((message) => (
    message.recipientAgentIds.includes(roomAgentId) && Boolean(message.deliveries[roomAgentId])
  ));
  const identityLessTextCandidates = new Map(targetMessages.map((message) => {
    const expectedText = normalizedMessageText(message.outboundContent ?? message.content);
    const candidates = userIndexes.filter((index) => {
      const event = canonicalEvents[index];
      return event.type === "user_message" &&
        !event.roomMessageId &&
        !event.agentTurnId &&
        !event.dispatchAttemptId &&
        normalizedMessageText(event.content) === expectedText &&
        Math.abs(event.timestamp - message.timestamp) <= 30_000;
    });
    return [message.id, candidates] as const;
  }));
  let messages = session.collaboration.messages.map((message) => {
    if (!message.recipientAgentIds.includes(roomAgentId)) return message;
    const delivery = message.deliveries[roomAgentId];
    if (!delivery) return message;
    const officialIdIsUnique = isOfficialUserEventIdUniqueToDelivery(
      session.collaboration!.messages,
      roomAgentId,
      delivery.officialUserEventId,
    );
    const resolution = resolveRoomDeliveryUserEvents(
      canonicalEvents,
      message,
      delivery,
      officialIdIsUnique,
    );
    const transactionIndexes = resolution.transactionIndexes.filter((index) => !claimedUserIndexes.has(index));
    const legacyOfficialIndexes = resolution.legacyOfficialIndexes.filter((index) => !claimedUserIndexes.has(index));
    const transactionWithAttempt = transactionIndexes.filter((index) => (
      Boolean(canonicalEvents[index].dispatchAttemptId)
    ));
    let userIndex = transactionWithAttempt.at(-1) ??
      transactionIndexes.find((index) => canonicalEvents[index].id === delivery.officialUserEventId) ??
      transactionIndexes[0] ??
      legacyOfficialIndexes[0] ??
      -1;

    // The prompt API does not always return an official user-event ID. In that
    // case, bind only when content and time identify exactly one canonical event;
    // repeated identical prompts remain deliberately unbound instead of guessed.
    if (
      reason !== "undo" &&
      userIndex < 0 &&
      !resolution.hasTransactionConflict &&
      (!delivery.officialUserEventId || officialIdIsUnique)
    ) {
      const candidates = (identityLessTextCandidates.get(message.id) ?? [])
        .filter((index) => !claimedUserIndexes.has(index));
      if (candidates.length === 1) {
        const reverseOwners = targetMessages.filter((candidateMessage) => (
          (identityLessTextCandidates.get(candidateMessage.id) ?? []).includes(candidates[0])
        ));
        if (reverseOwners.length === 1) userIndex = candidates[0];
      }
    }

    if (userIndex < 0 || claimedUserIndexes.has(userIndex)) return message;
    claimedUserIndexes.add(userIndex);
    bindings.push({ messageId: message.id, agentTurnId: delivery.agentTurnId, userIndex });
    const canonicalUserEvent = canonicalEvents[userIndex];
    const officialUserEventId = canonicalUserEvent.id;
    if (delivery.officialUserEventId === officialUserEventId) return message;
    return {
      ...message,
      deliveries: {
        ...message.deliveries,
        [roomAgentId]: { ...delivery, officialUserEventId },
      },
    };
  });

  const events = [...canonicalEvents];
  for (const binding of bindings) {
    const nextUserIndex = canonicalEvents.findIndex((event, index) => (
      index > binding.userIndex && event.type === "user_message"
    ));
    const end = nextUserIndex < 0 ? canonicalEvents.length : nextUserIndex;
    for (let index = binding.userIndex; index < end; index += 1) {
      const event = events[index];
      if (event.roomMessageId && event.roomMessageId !== binding.messageId) continue;
      if (event.agentTurnId && event.agentTurnId !== binding.agentTurnId) continue;
      events[index] = {
        ...event,
        roomMessageId: binding.messageId,
        agentTurnId: binding.agentTurnId,
      };
    }
  }

  if (reason === "undo") {
    const survivingUserIds = new Set(events.flatMap((event) => (
      event.type === "user_message" ? [event.id] : []
    )));
    const survivingRoomMessageIds = new Set(events.flatMap((event) => (
      event.type === "user_message" && event.roomMessageId ? [event.roomMessageId] : []
    )));
    messages = messages.filter((message) => {
      if (message.recipientAgentIds.length !== 1 || message.recipientAgentIds[0] !== roomAgentId) return true;
      const delivery = message.deliveries[roomAgentId];
      if (!delivery?.officialUserEventId) return true;
      return survivingUserIds.has(delivery.officialUserEventId) || survivingRoomMessageIds.has(message.id);
    });
  }

  return { events, messages };
}

export function reconcileAgentCanonicalHistory({
  session,
  roomAgentId,
  expectedRuntimeSessionId,
  canonicalEvents,
  reason,
}: ReconcileAgentCanonicalHistoryInput): ReconcileAgentCanonicalHistoryResult {
  const agent = getRoomAgent(session, roomAgentId);
  if (!agent) {
    return { session, events: [], applied: false, discardedReason: "agent-missing" };
  }
  if (!runtimeIdentityMatches(session, roomAgentId, expectedRuntimeSessionId)) {
    return {
      session,
      events: getRoomAgentEvents(session, roomAgentId),
      applied: false,
      discardedReason: "runtime-changed",
    };
  }

  const localEvents = getRoomAgentEvents(session, roomAgentId);
  const scopedCanonical = canonicalEvents.map((event) => scopeEventToRoomAgent(event, roomAgentId));
  const boundCanonical = bindCanonicalHistoryToRoomMessages(session, roomAgentId, scopedCanonical, reason);
  const events = reason === "running-sample"
    ? reconcileRunningKimiSnapshot(localEvents, boundCanonical.events)
    : reason === "undo"
      ? applyCanonicalUndoHistory(localEvents, boundCanonical.events)
      : preserveLocalUserMediaInCanonicalHistory(localEvents, boundCanonical.events);

  let next = updateRoomAgentEvents(session, roomAgentId, () => events);
  if (next.collaboration && boundCanonical.messages) {
    const collaboration = repairMissingRoomDeliveryAttemptIds({
      ...next.collaboration,
      messages: boundCanonical.messages,
    });
    next = {
      ...next,
      collaboration,
    };
  }
  return {
    session: { ...next, updatedAt: Date.now() },
    events,
    applied: true,
  };
}
