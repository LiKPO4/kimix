import type { Session, TimelineEvent } from "@/types/ui";
import {
  getPrimaryRoomAgent,
  getRoomAgent,
  getRoomAgentRuntimeId,
  updateRoomAgentEvents,
} from "@/utils/collaborationRooms";

export interface RoomEventOwner {
  roomAgentId: string;
  runtimeSessionId: string;
  displayName: string;
}

function resolveRoomEventAgentId(session: Session, event: TimelineEvent): string {
  if (event.roomAgentId) return event.roomAgentId;
  if (session.collaboration) {
    throw new Error("该房间事件缺少 Agent 所有者，已阻止发送到默认 Agent。");
  }
  return getPrimaryRoomAgent(session).id;
}

export function resolveRoomEventOwner(session: Session, event: TimelineEvent): RoomEventOwner {
  const roomAgentId = resolveRoomEventAgentId(session, event);
  const agent = getRoomAgent(session, roomAgentId);
  if (!agent) {
    throw new Error("该事件所属 Agent 已不存在，无法继续操作。");
  }
  if (agent.removedAt) {
    throw new Error(`Agent“${agent.displayName}”已移出房间，无法继续操作。`);
  }
  if (agent.archivedAt) {
    throw new Error(`Agent“${agent.displayName}”已归档，无法继续操作。`);
  }
  const runtimeSessionId = getRoomAgentRuntimeId(session, roomAgentId);
  if (!runtimeSessionId) {
    throw new Error(`Agent“${agent.displayName}”的运行会话尚未就绪。`);
  }
  return {
    roomAgentId,
    runtimeSessionId,
    displayName: agent.displayName,
  };
}

export function updateRoomEventForOwner(
  session: Session,
  roomAgentId: string,
  eventId: string,
  updater: (event: TimelineEvent) => TimelineEvent,
): Session {
  return updateRoomAgentEvents(session, roomAgentId, (events) => events.map((event) => (
    event.id === eventId ? updater(event) : event
  )));
}
