import type { RoomAgentDelivery, RoomUserMessage, Session, TimelineEvent } from "@/types/ui";
import { getRoomAgentEvents, getRoomAgents, scopeEventToRoomAgent } from "@/utils/collaborationRooms";

const OPEN_DELIVERY_STATUSES = new Set<RoomAgentDelivery["status"]>([
  "queued",
  "sending",
  "accepted",
  "running",
  "waiting_approval",
  "waiting_question",
]);

function findDeliveryUserIndex(
  events: TimelineEvent[],
  message: RoomUserMessage,
  delivery: RoomAgentDelivery,
): number {
  return events.findIndex((event) => (
    event.type === "user_message" && (
      event.id === delivery.officialUserEventId ||
      event.roomMessageId === message.id
    )
  ));
}

function deliveryEvents(
  session: Session,
  message: RoomUserMessage,
  roomAgentId: string,
  delivery: RoomAgentDelivery,
): { events: TimelineEvent[]; claimedEventIds: string[] } {
  const events = getRoomAgentEvents(session, roomAgentId);
  const startIndex = findDeliveryUserIndex(events, message, delivery);
  const explicitlyBound = events.filter((event) => event.agentTurnId === delivery.agentTurnId);
  const source = explicitlyBound.length > 0
    ? explicitlyBound.filter((event) => event.type !== "user_message")
    : (() => {
        if (startIndex < 0) return [];
        const nextUserIndex = events.findIndex((event, index) => index > startIndex && event.type === "user_message");
        return events.slice(startIndex + 1, nextUserIndex < 0 ? events.length : nextUserIndex);
      })();

  return {
    events: source.map((event) => ({
      ...scopeEventToRoomAgent(event, roomAgentId),
      roomMessageId: message.id,
      agentTurnId: delivery.agentTurnId,
    })),
    claimedEventIds: [
      ...(startIndex >= 0 ? [events[startIndex].id] : []),
      ...source.map((event) => event.id),
    ],
  };
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

  const claimedEventIds = new Set<string>();
  const groups: Array<{ timestamp: number; order: number; events: TimelineEvent[] }> = [];
  let order = 0;
  for (const message of collaboration.messages) {
    const events: TimelineEvent[] = [{
      id: message.id,
      type: "user_message",
      timestamp: message.timestamp,
      content: message.content,
      images: message.images,
      roomMessageId: message.id,
      recipientAgentIds: message.recipientAgentIds,
    }];

    for (const roomAgentId of message.recipientAgentIds) {
      const delivery = message.deliveries[roomAgentId];
      if (!delivery) continue;
      const projection = deliveryEvents(session, message, roomAgentId, delivery);
      projection.claimedEventIds.forEach((id) => claimedEventIds.add(id));
      events.push(...(projection.events.length > 0
        ? projection.events
        : deliveryFallbackEvents(message, roomAgentId, delivery)));
    }
    groups.push({ timestamp: message.timestamp, order: order++, events });
  }

  for (const agent of getRoomAgents(session)) {
    const unclaimed = getRoomAgentEvents(session, agent.id).filter((event) => !claimedEventIds.has(event.id));
    let segment: TimelineEvent[] = [];
    const flushSegment = () => {
      if (segment.length === 0) return;
      const first = segment[0];
      const firstUser = first.type === "user_message" ? first : null;
      const roomMessageId = firstUser?.roomMessageId ?? `unmatched-room:${agent.id}:${first.id}`;
      const agentTurnId = first.agentTurnId ?? `unmatched-turn:${agent.id}:${first.id}`;
      const events = segment.map((event, index) => {
        const scoped = scopeEventToRoomAgent(event, agent.id);
        if (index === 0 && scoped.type === "user_message") {
          return {
            ...scoped,
            roomMessageId,
            recipientAgentIds: [agent.id],
          };
        }
        return {
          ...scoped,
          roomMessageId: scoped.roomMessageId ?? roomMessageId,
          agentTurnId: scoped.agentTurnId ?? agentTurnId,
        };
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
