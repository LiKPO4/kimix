import type { RoomAgentActivity, Session } from "@/types/ui";
import { isKimiCodeSessionMissingError } from "./kimiCodeSessionRecovery";
import {
  getPrimaryRoomAgent,
  getRoomAgent,
  getRoomAgentEvents,
  synchronizeCollaborationPrimaryMirror,
} from "./collaborationRooms";

export type OfficialArchiveResult = { success: true; data: void } | { success: false; error: string };

const ROOM_LIFECYCLE_ACTIVE_STATUSES = new Set([
  "creating",
  "queued",
  "sending",
  "accepted",
  "running",
  "waiting_approval",
  "waiting_question",
  "indeterminate",
]);

export function roomHasActiveAgentWork(
  session: Session,
  activities: Iterable<RoomAgentActivity> = [],
) {
  if (!session.collaboration) return false;
  if ([...activities].some((activity) => (
    activity.roomId === session.id && ROOM_LIFECYCLE_ACTIVE_STATUSES.has(activity.status)
  ))) return true;
  return session.collaboration.messages.some((message) => Object.values(message.deliveries).some((delivery) => (
    ROOM_LIFECYCLE_ACTIVE_STATUSES.has(delivery.status)
  )));
}

export function getOfficialArchiveSessionId(session: Session) {
  if (session.longTask?.executorSessionId) return session.longTask.executorSessionId;
  if (session.collaboration) {
    const primary = getPrimaryRoomAgent(session);
    return primary.runtimeSessionId ?? primary.officialSessionId ?? session.runtimeSessionId ?? session.officialSessionId ?? null;
  }
  return session.runtimeSessionId ?? session.officialSessionId ?? (session.id.startsWith("local-") ? null : session.id);
}

export function getRoomAgentOfficialSessionId(session: Session, roomAgentId: string) {
  const agent = getRoomAgent(session, roomAgentId);
  if (!agent) return null;
  if (agent.runtimeSessionId || agent.officialSessionId) return agent.runtimeSessionId ?? agent.officialSessionId ?? null;
  return getPrimaryRoomAgent(session).id === roomAgentId ? getOfficialArchiveSessionId(session) : null;
}

export function getRelatedArchiveSessionIds(sessions: Session[], target: Session): string[] {
  const targetIds = new Set([
    target.id,
    target.runtimeSessionId,
    target.officialSessionId,
    target.longTask?.executorSessionId,
    target.longTask?.reviewerSessionId,
    ...(target.collaboration?.agents.flatMap((agent) => [agent.runtimeSessionId, agent.officialSessionId]) ?? []),
  ].filter((id): id is string => Boolean(id)));
  return sessions.filter((session) => [
    session.id,
    session.runtimeSessionId,
    session.officialSessionId,
    session.longTask?.executorSessionId,
    session.longTask?.reviewerSessionId,
    ...(session.collaboration?.agents.flatMap((agent) => [agent.runtimeSessionId, agent.officialSessionId]) ?? []),
  ].some((id) => Boolean(id && targetIds.has(id)))).map((session) => session.id);
}

export type RoomAgentLifecycleOutcome = {
  roomAgentId: string;
  displayName: string;
  officialSessionId?: string;
  success: boolean;
  error?: string;
};

export type RoomLifecycleResult = {
  success: boolean;
  partial: boolean;
  session: Session;
  outcomes: RoomAgentLifecycleOutcome[];
  error?: string;
};

type OfficialLifecycleResult = { success: true; data?: unknown } | { success: false; error: string };

async function runRoomLifecycle(
  session: Session,
  operation: "archive" | "restore",
  mutateOfficial: (sessionId: string) => Promise<OfficialLifecycleResult>,
  now = Date.now(),
): Promise<RoomLifecycleResult> {
  if (!session.collaboration) {
    return { success: false, partial: false, session, outcomes: [], error: "当前会话不是多 Agent 房间" };
  }
  const activeAgents = session.collaboration.agents.filter((agent) => !agent.removedAt);
  const targets = activeAgents.filter((agent) => operation === "archive"
    ? !agent.archivedAt
    : Boolean(agent.archivedAt || session.archivedAt));
  const settled = await Promise.allSettled(targets.map(async (agent): Promise<RoomAgentLifecycleOutcome> => {
    const officialSessionId = getRoomAgentOfficialSessionId(session, agent.id);
    if (!officialSessionId) {
      return {
        roomAgentId: agent.id,
        displayName: agent.displayName,
        success: false,
        error: "没有可操作的官方会话",
      };
    }
    try {
      const result = await mutateOfficial(officialSessionId);
      if (!result.success) {
        if (operation === "archive" && isKimiCodeSessionMissingError(result.error)) {
          return { roomAgentId: agent.id, displayName: agent.displayName, officialSessionId, success: true };
        }
        return { roomAgentId: agent.id, displayName: agent.displayName, officialSessionId, success: false, error: result.error };
      }
      return { roomAgentId: agent.id, displayName: agent.displayName, officialSessionId, success: true };
    } catch (error) {
      if (operation === "archive" && isKimiCodeSessionMissingError(error)) {
        return { roomAgentId: agent.id, displayName: agent.displayName, officialSessionId, success: true };
      }
      return {
        roomAgentId: agent.id,
        displayName: agent.displayName,
        officialSessionId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));
  const outcomes = settled.map((result, index): RoomAgentLifecycleOutcome => {
    if (result.status === "fulfilled") return result.value;
    const agent = targets[index];
    return {
      roomAgentId: agent.id,
      displayName: agent.displayName,
      officialSessionId: getRoomAgentOfficialSessionId(session, agent.id) ?? undefined,
      success: false,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });
  const outcomesByAgent = new Map(outcomes.map((outcome) => [outcome.roomAgentId, outcome]));
  let next: Session = {
    ...session,
    collaboration: {
      ...session.collaboration,
      agents: session.collaboration.agents.map((agent) => {
        const outcome = outcomesByAgent.get(agent.id);
        if (!outcome) return agent;
        if (outcome.success) {
          return {
            ...agent,
            archivedAt: operation === "archive" ? now : undefined,
            lifecycleIssue: undefined,
          };
        }
        return {
          ...agent,
          lifecycleIssue: {
            operation,
            message: outcome.error ?? `${operation === "archive" ? "归档" : "恢复"}失败`,
            updatedAt: now,
          },
        };
      }),
    },
    updatedAt: now,
  };
  next = synchronizeCollaborationPrimaryMirror(next);
  const remainingAgents = next.collaboration!.agents.filter((agent) => !agent.removedAt);
  const allArchived = remainingAgents.length > 0 && remainingAgents.every((agent) => Boolean(agent.archivedAt));
  const allRestored = remainingAgents.every((agent) => !agent.archivedAt);
  const anySuccess = outcomes.some((outcome) => outcome.success);
  next = {
    ...next,
    archivedAt: operation === "archive"
      ? (allArchived ? now : undefined)
      : (anySuccess || allRestored ? undefined : session.archivedAt),
    updatedAt: now,
  };
  const success = operation === "archive" ? allArchived : allRestored;
  const partial = operation === "archive"
    ? remainingAgents.some((agent) => Boolean(agent.archivedAt)) && !allArchived
    : remainingAgents.some((agent) => !agent.archivedAt) && !allRestored;
  const failures = outcomes.filter((outcome) => !outcome.success);
  return {
    success,
    partial,
    session: next,
    outcomes,
    error: failures.length > 0
      ? failures.map((failure) => `${failure.displayName}：${failure.error ?? "未知错误"}`).join("；")
      : undefined,
  };
}

export function archiveCollaborationRoom(
  session: Session,
  archiveOfficial: (sessionId: string) => Promise<OfficialLifecycleResult>,
  now = Date.now(),
) {
  return runRoomLifecycle(session, "archive", archiveOfficial, now);
}

export function restoreCollaborationRoom(
  session: Session,
  restoreOfficial: (sessionId: string) => Promise<OfficialLifecycleResult>,
  now = Date.now(),
) {
  return runRoomLifecycle(session, "restore", restoreOfficial, now);
}

function stripRoomScope(event: Session["events"][number]): Session["events"][number] {
  const {
    roomAgentId: _roomAgentId,
    roomMessageId: _roomMessageId,
    agentTurnId: _agentTurnId,
    recipientAgentIds: _recipientAgentIds,
    ...rest
  } = event;
  return {
    ...rest,
    ...(event.type === "subagent" ? { events: event.events.map(stripRoomScope) } : {}),
  } as Session["events"][number];
}

export function detachRoomAgentAsSession(
  session: Session,
  roomAgentId: string,
  existingSessionIds: ReadonlySet<string>,
  now = Date.now(),
  activities: Iterable<RoomAgentActivity> = [],
): { room: Session; detached: Session } {
  if (!session.collaboration) throw new Error("当前会话不是多 Agent 房间");
  if (roomHasActiveAgentWork(session, activities)) throw new Error("房间仍有 Agent 在运行，暂时不能移出成员");
  if (session.collaboration.primaryAgentId === roomAgentId) throw new Error("兼容 primary Agent 不能直接移出房间");
  const agent = getRoomAgent(session, roomAgentId);
  if (!agent || agent.removedAt) throw new Error("Agent 不存在或已移出房间");
  if (agent.archivedAt) throw new Error("请先恢复该 Agent，再将其移出房间");
  let detachedId = agent.officialSessionId ?? agent.runtimeSessionId ?? `kimix-detached-${crypto.randomUUID()}`;
  while (existingSessionIds.has(detachedId)) detachedId = `kimix-detached-${crypto.randomUUID()}`;
  const detached: Session = {
    id: detachedId,
    engine: session.engine,
    runtimeSessionId: agent.runtimeSessionId,
    officialSessionId: agent.officialSessionId,
    skillRegistrySyncedAt: agent.skillRegistrySyncedAt,
    skillForkParentSessionId: agent.skillForkParentSessionId,
    kimiHistoryCacheVersion: agent.kimiHistoryCacheVersion,
    officialCatalogConfirmedAt: agent.officialCatalogConfirmedAt,
    swarmModeLockedAt: agent.swarmModeLockedAt,
    swarmMode: agent.swarmMode,
    swarmModeDesired: agent.swarmModeDesired,
    model: agent.modelAlias,
    modelSwitchedAt: agent.modelSwitchedAt,
    switchedToModel: agent.switchedToModel,
    title: agent.displayName,
    projectPath: session.projectPath,
    createdAt: agent.createdAt,
    updatedAt: now,
    btwRounds: agent.btwRounds,
    officialGoal: agent.officialGoal,
    events: getRoomAgentEvents(session, roomAgentId).map(stripRoomScope),
    isLoading: false,
  };
  let room: Session = {
    ...session,
    collaboration: {
      ...session.collaboration,
      defaultRecipientIds: session.collaboration.defaultRecipientIds.filter((id) => id !== roomAgentId),
      focusedAgentId: session.collaboration.focusedAgentId === roomAgentId
        ? session.collaboration.primaryAgentId
        : session.collaboration.focusedAgentId,
      agents: session.collaboration.agents.map((candidate) => candidate.id === roomAgentId ? {
        ...candidate,
        runtimeSessionId: undefined,
        officialSessionId: undefined,
        skillRegistrySyncedAt: undefined,
        skillForkParentSessionId: undefined,
        officialCatalogConfirmedAt: undefined,
        missingSince: undefined,
        recoveryIssue: undefined,
        lifecycleIssue: undefined,
        removedAt: now,
      } : candidate),
    },
    updatedAt: now,
  };
  if (room.collaboration!.defaultRecipientIds.length === 0) {
    room = {
      ...room,
      collaboration: {
        ...room.collaboration!,
        defaultRecipientIds: [room.collaboration!.primaryAgentId],
      },
    };
  }
  return { room: synchronizeCollaborationPrimaryMirror(room), detached };
}

export async function archiveSessionOfficialFirst(
  session: Session,
  archiveOfficial: (sessionId: string) => Promise<OfficialArchiveResult>,
  archiveLocal: (sessionId: string) => void,
): Promise<{ success: true } | { success: false; error: string }> {
  if (session.engine === "kimi-code") {
    const officialSessionId = getOfficialArchiveSessionId(session);
    if (!officialSessionId) return { success: false, error: "没有可归档的官方会话" };
    try {
      const result = await archiveOfficial(officialSessionId);
      if (!result.success) {
        if (isKimiCodeSessionMissingError(result.error)) {
          archiveLocal(session.id);
          return { success: true };
        }
        return result;
      }
    } catch (error) {
      if (isKimiCodeSessionMissingError(error)) {
        archiveLocal(session.id);
        return { success: true };
      }
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  archiveLocal(session.id);
  return { success: true };
}
