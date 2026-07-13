import type { PermissionMode, RoomAgent, Session, TimelineEvent } from "@/types/ui";
import {
  getPrimaryRoomAgent,
  getRoomAgent,
  getRoomAgentRuntimeId,
  getRoomAgentSessionView,
  isPrimaryRoomAgent,
  scopeEventToRoomAgent,
  updateRoomAgent,
  updateRoomAgentEvents,
} from "@/utils/collaborationRooms";

export interface RoomMutationOwner {
  roomAgentId: string;
  displayName: string;
  runtimeSessionId?: string;
  isPrimary: boolean;
  agent: RoomAgent;
  sessionView: Session;
}

export function resolveRoomMutationOwner(
  session: Session,
  selectedAgentIds?: readonly string[],
  fallbackPermissionMode: PermissionMode = session.permissionMode ?? "manual",
): RoomMutationOwner {
  const activeAgents = session.collaboration?.agents.filter((agent) => !agent.removedAt && !agent.archivedAt) ?? [];
  const candidateIds = session.collaboration
    ? Array.from(new Set((selectedAgentIds ?? session.collaboration.defaultRecipientIds).filter((id) => (
        activeAgents.some((agent) => agent.id === id)
      ))))
    : [getPrimaryRoomAgent(session, fallbackPermissionMode).id];
  if (candidateIds.length !== 1) {
    throw new Error(candidateIds.length === 0
      ? "请先选择一个 Agent 作为当前操作目标。"
      : "当前操作只能作用于一个 Agent，请在接收者中只保留一个目标。");
  }
  const roomAgentId = candidateIds[0];
  const agent = getRoomAgent(session, roomAgentId, fallbackPermissionMode);
  if (!agent) throw new Error("目标 Agent 不存在。");
  if (agent.provisioningError) throw new Error(`Agent“${agent.displayName}”尚未创建成功：${agent.provisioningError}`);
  if (agent.recoveryIssue) throw new Error(`Agent“${agent.displayName}”当前不可用：${agent.recoveryIssue.message}`);
  return {
    roomAgentId,
    displayName: agent.displayName,
    runtimeSessionId: getRoomAgentRuntimeId(session, roomAgentId) ?? undefined,
    isPrimary: isPrimaryRoomAgent(session, roomAgentId),
    agent,
    sessionView: getRoomAgentSessionView(session, roomAgentId),
  };
}

export function updateRoomMutationOwner(
  session: Session,
  roomAgentId: string,
  updater: (agent: RoomAgent) => RoomAgent,
  fallbackPermissionMode: PermissionMode = session.permissionMode ?? "manual",
): Session {
  if (session.collaboration) return updateRoomAgent(session, roomAgentId, updater);
  const primary = getPrimaryRoomAgent(session, fallbackPermissionMode);
  if (primary.id !== roomAgentId) return session;
  const next = updater(primary);
  return {
    ...session,
    runtimeSessionId: next.runtimeSessionId,
    officialSessionId: next.officialSessionId,
    skillRegistrySyncedAt: next.skillRegistrySyncedAt,
    skillForkParentSessionId: next.skillForkParentSessionId,
    kimiHistoryCacheVersion: next.kimiHistoryCacheVersion,
    officialCatalogConfirmedAt: next.officialCatalogConfirmedAt,
    swarmModeLockedAt: next.swarmModeLockedAt,
    swarmMode: next.swarmMode,
    swarmModeDesired: next.swarmModeDesired,
    model: next.modelAlias,
    permissionMode: next.permissionMode,
    planMode: next.planMode,
    modelSwitchedAt: next.modelSwitchedAt,
    switchedToModel: next.switchedToModel,
    officialGoal: next.officialGoal,
    btwRounds: next.btwRounds,
  };
}

export function appendRoomMutationEvent(
  session: Session,
  roomAgentId: string,
  event: TimelineEvent,
): Session {
  return updateRoomAgentEvents(session, roomAgentId, (events) => [
    ...events,
    scopeEventToRoomAgent(event, roomAgentId),
  ]);
}
