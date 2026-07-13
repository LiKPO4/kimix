import type { Session, TimelineEvent } from "@/types/ui";
import {
  getPrimaryRoomAgent,
  getRoomAgent,
  getRoomAgentEvents,
  scopeEventToRoomAgent,
  updateRoomAgent,
  updateRoomAgentEvents,
} from "@/utils/collaborationRooms";
import { preserveLocalUserMediaInCanonicalHistory } from "@/utils/eventMapper";
import { reconcileRunningKimiSnapshot } from "@/utils/kimiCodeSnapshotReplay";
import { applyCanonicalUndoHistory } from "@/utils/undoHistory";
import { getLastUsedModelFromEvents } from "@/utils/modelDisplay";
import { KIMI_HISTORY_CACHE_VERSION } from "@/utils/kimiHistoryCache";

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
  let messages = session.collaboration.messages.map((message) => {
    if (!message.recipientAgentIds.includes(roomAgentId)) return message;
    const delivery = message.deliveries[roomAgentId];
    if (!delivery) return message;

    let userIndex = canonicalEvents.findIndex((event) => (
      event.type === "user_message" && (
        event.id === delivery.officialUserEventId ||
        event.roomMessageId === message.id
      )
    ));

    // Only repair a previously known delivery identity. New room deliveries must
    // bind through explicit room/prompt metadata instead of text-and-time guessing.
    if (reason !== "undo" && userIndex < 0 && delivery.officialUserEventId) {
      const expectedText = normalizedMessageText(message.content);
      const candidates = userIndexes.filter((index) => {
        if (claimedUserIndexes.has(index)) return false;
        const event = canonicalEvents[index];
        return event.type === "user_message" &&
          normalizedMessageText(event.content) === expectedText &&
          Math.abs(event.timestamp - message.timestamp) <= 30_000;
      });
      if (candidates.length === 1) userIndex = candidates[0];
    }

    if (userIndex < 0 || claimedUserIndexes.has(userIndex)) return message;
    claimedUserIndexes.add(userIndex);
    bindings.push({ messageId: message.id, agentTurnId: delivery.agentTurnId, userIndex });
    const officialUserEventId = canonicalEvents[userIndex].id;
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
    next = {
      ...next,
      collaboration: {
        ...next.collaboration,
        messages: boundCanonical.messages,
      },
    };
  }
  const model = getLastUsedModelFromEvents(events);
  if (session.collaboration) {
    next = updateRoomAgent(next, roomAgentId, (current) => ({
      ...current,
      modelAlias: model ?? current.modelAlias,
      kimiHistoryCacheVersion: KIMI_HISTORY_CACHE_VERSION,
    }));
  } else {
    next = {
      ...next,
      model: model ?? next.model,
      kimiHistoryCacheVersion: KIMI_HISTORY_CACHE_VERSION,
    };
  }
  return {
    session: { ...next, updatedAt: Date.now() },
    events,
    applied: true,
  };
}
