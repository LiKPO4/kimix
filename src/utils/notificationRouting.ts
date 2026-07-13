import type { Session, TimelineEvent } from "@/types/ui";
import { getRoomAgent, getRoomAgentEvents, resolveRoomRuntimeOwner } from "@/utils/collaborationRooms";

type ApprovalRequest = Extract<TimelineEvent, { type: "approval_request" }>;

export function findNotificationSession(sessions: Session[], sessionId: string) {
  const direct = sessions.find((session) => (
    session.id === sessionId || session.runtimeSessionId === sessionId || session.officialSessionId === sessionId
  ));
  if (direct) return direct;
  const owner = resolveRoomRuntimeOwner(sessions, sessionId);
  return owner ? sessions.find((session) => session.id === owner.roomId) : undefined;
}

export type NotificationClickTarget = {
  sessionId: string;
  roomAgentId?: string;
  agentTurnId?: string;
  eventId?: string;
};

export function resolveNotificationClickTarget(sessions: Session[], payload: NotificationClickTarget) {
  const runtimeOwner = resolveRoomRuntimeOwner(sessions, payload.sessionId);
  const session = findNotificationSession(sessions, payload.sessionId);
  if (!session) return null;
  const roomAgentId = payload.roomAgentId ?? runtimeOwner?.roomAgentId;
  const events = roomAgentId ? getRoomAgentEvents(session, roomAgentId) : session.events;
  const exactEvent = payload.eventId ? events.find((event) => event.id === payload.eventId) : undefined;
  const turnEvents = payload.agentTurnId
    ? events.filter((event) => event.agentTurnId === payload.agentTurnId)
    : [];
  const turnEvent = [...turnEvents].reverse().find((event) => event.type === "assistant_message")
    ?? [...turnEvents].reverse().find((event) => event.type === "approval_request" || event.type === "question_request")
    ?? turnEvents[turnEvents.length - 1];
  return {
    session,
    roomAgentId,
    agentTurnId: payload.agentTurnId,
    eventId: exactEvent?.id ?? turnEvent?.id,
  };
}

export function focusNotificationRoomAgent(session: Session, roomAgentId?: string): Session {
  if (!session.collaboration || !roomAgentId) return session;
  const agent = getRoomAgent(session, roomAgentId);
  if (!agent || agent.removedAt || agent.archivedAt) return session;
  if (
    session.collaboration.focusedAgentId === roomAgentId &&
    session.collaboration.defaultRecipientIds.length === 1 &&
    session.collaboration.defaultRecipientIds[0] === roomAgentId
  ) return session;
  return {
    ...session,
    collaboration: {
      ...session.collaboration,
      defaultRecipientIds: [roomAgentId],
      focusedAgentId: roomAgentId,
    },
  };
}

export function approvalRequestNotificationKey(event: ApprovalRequest) {
  return event.requestId || event.id;
}

export function summarizeApprovalRequest(event: ApprovalRequest) {
  return event.display?.title || event.description || event.details || event.toolName || "工具操作等待审批";
}
