import type { RoomAgentDelivery, RoomUserMessage, Session, TimelineEvent } from "@/types/ui";
import { getRoomAgentEvents, getRoomAgents, scopeEventToRoomAgent } from "@/utils/collaborationRooms";
import {
  isOfficialUserEventIdUniqueToDelivery,
  resolveRoomDeliveryUserEvents,
} from "@/utils/roomDeliveryIdentity";

const OPEN_DELIVERY_STATUSES = new Set<RoomAgentDelivery["status"]>([
  "queued",
  "sending",
  "accepted",
  "running",
  "waiting_approval",
  "waiting_question",
]);

/**
 * Identity-preserving projection cache (plan A4).
 * Source event refs from storage are stable across flushes for untouched history;
 * only projection spreads used to break that. Cache by source object + projection signature.
 */
const projectedEventCache = new WeakMap<TimelineEvent, Map<string, TimelineEvent>>();
const projectedRoomUserMessageCache = new WeakMap<RoomUserMessage, TimelineEvent>();

function projectionSignature(
  roomAgentId: string,
  roomMessageId: string,
  agentTurnId = "",
  recipientAgentIds = "",
  roomDeliveryStatus = "",
): string {
  return `${roomAgentId}\u0000${roomMessageId}\u0000${agentTurnId}\u0000${recipientAgentIds}\u0000${roomDeliveryStatus}`;
}

function rememberProjectedEvent(
  source: TimelineEvent,
  signature: string,
  create: () => TimelineEvent,
): TimelineEvent {
  let bySignature = projectedEventCache.get(source);
  if (!bySignature) {
    bySignature = new Map();
    projectedEventCache.set(source, bySignature);
  }
  const cached = bySignature.get(signature);
  if (cached) return cached;
  const created = create();
  bySignature.set(signature, created);
  return created;
}

function projectScopedDeliveryEvent(
  source: TimelineEvent,
  roomAgentId: string,
  roomMessageId: string,
  agentTurnId: string,
): TimelineEvent {
  const signature = projectionSignature(roomAgentId, roomMessageId, agentTurnId);
  return rememberProjectedEvent(source, signature, () => {
    const scoped = scopeEventToRoomAgent(source, roomAgentId);
    if (
      scoped.roomAgentId === roomAgentId &&
      scoped.roomMessageId === roomMessageId &&
      scoped.agentTurnId === agentTurnId
    ) {
      return scoped;
    }
    return {
      ...scoped,
      roomMessageId,
      agentTurnId,
    };
  });
}

function projectRoomUserMessageEvent(message: RoomUserMessage): TimelineEvent {
  const cached = projectedRoomUserMessageCache.get(message);
  if (cached) return cached;
  const event: TimelineEvent = {
    id: message.id,
    type: "user_message",
    timestamp: message.timestamp,
    content: message.content,
    images: message.images,
    roomMessageId: message.id,
    recipientAgentIds: message.recipientAgentIds,
  };
  projectedRoomUserMessageCache.set(message, event);
  return event;
}

function deliveryEvents(
  session: Session,
  message: RoomUserMessage,
  roomAgentId: string,
  delivery: RoomAgentDelivery,
  claimedEventKeys: ReadonlySet<string>,
): { events: TimelineEvent[]; claimedEventKeys: string[] } {
  const events = getRoomAgentEvents(session, roomAgentId);
  const officialIdIsUnique = isOfficialUserEventIdUniqueToDelivery(
    session.collaboration?.messages ?? [],
    roomAgentId,
    delivery.officialUserEventId,
  );
  const resolution = resolveRoomDeliveryUserEvents(events, message, delivery, officialIdIsUnique);
  const matchingUserIndexes = [
    ...resolution.transactionIndexes,
    ...resolution.legacyOfficialIndexes,
  ].filter((index) => !claimedEventKeys.has(roomAgentEventClaimKey(roomAgentId, events[index].id)));
  const startIndex = matchingUserIndexes[0] ?? -1;
  const matchingUserEventIds = matchingUserIndexes.map((index) => events[index].id);
  const explicitlyBound = resolution.hasTransactionConflict
    ? []
    : events.filter((event) => (
        !claimedEventKeys.has(roomAgentEventClaimKey(roomAgentId, event.id)) &&
        event.agentTurnId === delivery.agentTurnId
      ));
  const source = explicitlyBound.length > 0
    ? explicitlyBound.filter((event) => event.type !== "user_message")
    : (() => {
        if (startIndex < 0) return [];
        const nextUserIndex = events.findIndex((event, index) => index > startIndex && event.type === "user_message");
        return events
          .slice(startIndex + 1, nextUserIndex < 0 ? events.length : nextUserIndex)
          .filter((event) => !claimedEventKeys.has(roomAgentEventClaimKey(roomAgentId, event.id)));
      })();

  return {
    events: source.map((event) => projectScopedDeliveryEvent(
      event,
      roomAgentId,
      message.id,
      delivery.agentTurnId,
    )),
    claimedEventKeys: Array.from(new Set([
      ...matchingUserEventIds,
      ...(startIndex >= 0 ? [events[startIndex].id] : []),
      ...source.map((event) => event.id),
    ].map((eventId) => roomAgentEventClaimKey(roomAgentId, eventId)))),
  };
}

function roomAgentEventClaimKey(roomAgentId: string, eventId: string): string {
  return JSON.stringify([roomAgentId, eventId]);
}

function deliveryFallbackEvents(
  message: RoomUserMessage,
  roomAgentId: string,
  delivery: RoomAgentDelivery,
): TimelineEvent[] {
  if (delivery.status === "failed" || delivery.status === "indeterminate") {
    return [{
      id: `${delivery.agentTurnId}:error`,
      type: "error",
      timestamp: message.timestamp,
      message: delivery.error || (delivery.status === "indeterminate"
        ? "无法确认该 Agent 是否已接收消息，Kimix 未自动重发。"
        : "该 Agent 未能接收这条消息。"),
      source: "ui",
      roomAgentId,
      roomMessageId: message.id,
      agentTurnId: delivery.agentTurnId,
    }];
  }
  if (!OPEN_DELIVERY_STATUSES.has(delivery.status)) return [];
  return [{
    id: `assistant:${delivery.agentTurnId}`,
    type: "assistant_message",
    timestamp: message.timestamp,
    content: "",
    isThinking: false,
    isComplete: false,
    roomAgentId,
    roomMessageId: message.id,
    agentTurnId: delivery.agentTurnId,
    roomDeliveryStatus: delivery.status,
  }];
}

export function projectCollaborationTimeline(session: Session): TimelineEvent[] {
  const collaboration = session.collaboration;
  if (!collaboration) return session.events;

  const claimedEventKeys = new Set<string>();
  const groups: Array<{ timestamp: number; order: number; events: TimelineEvent[] }> = [];
  let order = 0;
  for (const message of collaboration.messages) {
    const events: TimelineEvent[] = [projectRoomUserMessageEvent(message)];

    for (const roomAgentId of message.recipientAgentIds) {
      const delivery = message.deliveries[roomAgentId];
      if (!delivery) continue;
      const projection = deliveryEvents(session, message, roomAgentId, delivery, claimedEventKeys);
      projection.claimedEventKeys.forEach((key) => claimedEventKeys.add(key));
      events.push(...(projection.events.length > 0
        ? projection.events
        : deliveryFallbackEvents(message, roomAgentId, delivery)));
    }
    groups.push({ timestamp: message.timestamp, order: order++, events });
  }

  for (const agent of getRoomAgents(session)) {
    const unclaimed = getRoomAgentEvents(session, agent.id).filter((event) => (
      !claimedEventKeys.has(roomAgentEventClaimKey(agent.id, event.id))
    ));
    let segment: TimelineEvent[] = [];
    const flushSegment = () => {
      if (segment.length === 0) return;
      const first = segment[0];
      const firstUser = first.type === "user_message" ? first : null;
      const roomMessageId = firstUser?.roomMessageId ?? `unmatched-room:${agent.id}:${first.id}`;
      const agentTurnId = first.agentTurnId ?? `unmatched-turn:${agent.id}:${first.id}`;
      const events = segment.map((event, index) => {
        if (index === 0 && event.type === "user_message") {
          const signature = projectionSignature(agent.id, roomMessageId, "", agent.id);
          return rememberProjectedEvent(event, signature, () => {
            const scoped = scopeEventToRoomAgent(event, agent.id);
            if (
              scoped.type === "user_message" &&
              scoped.roomMessageId === roomMessageId &&
              scoped.recipientAgentIds?.length === 1 &&
              scoped.recipientAgentIds[0] === agent.id
            ) {
              return scoped;
            }
            return {
              ...scoped,
              roomMessageId,
              recipientAgentIds: [agent.id],
            };
          });
        }
        const resolvedRoomMessageId = event.roomMessageId ?? roomMessageId;
        const resolvedAgentTurnId = event.agentTurnId ?? agentTurnId;
        return projectScopedDeliveryEvent(event, agent.id, resolvedRoomMessageId, resolvedAgentTurnId);
      });
      groups.push({ timestamp: first.timestamp, order: order++, events });
      segment = [];
    };
    for (const event of unclaimed) {
      if (event.type === "user_message" && segment.length > 0) flushSegment();
      segment.push(event);
    }
    flushSegment();
  }

  return groups
    .sort((left, right) => left.timestamp - right.timestamp || left.order - right.order)
    .flatMap((group) => group.events);
}
