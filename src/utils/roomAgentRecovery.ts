import type { RoomAgent, Session } from "@/types/ui";
import {
  getPrimaryRoomAgent,
  getRoomAgent,
  getRoomAgents,
  updateRoomAgent,
} from "@/utils/collaborationRooms";
import { isSamePath } from "@/utils/pathCase";

export interface RoomAgentRecoveryTarget {
  roomAgentId: string;
  sessionIds: string[];
  skillForkParentSessionId?: string;
  modelAlias: string | null;
}

export type ResumeRoomAgentResponse = {
  success: true;
  data: {
    sessionId: string;
    workDir: string;
    model?: string | null;
  };
} | {
  success: false;
  error: string;
};

export function getRoomAgentRecoveryTargets(session: Session): RoomAgentRecoveryTarget[] {
  const primary = getPrimaryRoomAgent(session);
  return getRoomAgents(session).filter((agent) => !agent.removedAt).map((agent) => ({
    roomAgentId: agent.id,
    sessionIds: Array.from(new Set([
      agent.runtimeSessionId,
      agent.officialSessionId,
      primary.id === agent.id ? session.runtimeSessionId : undefined,
      primary.id === agent.id ? session.officialSessionId : undefined,
      primary.id === agent.id && !session.collaboration && !session.id.startsWith("local-") ? session.id : undefined,
    ].filter((id): id is string => Boolean(id)))),
    skillForkParentSessionId: agent.skillForkParentSessionId,
    modelAlias: agent.modelAlias,
  }));
}

export async function resumeRoomAgentRuntime(input: {
  session: Session;
  roomAgentId: string;
  additionalWorkDirs: string[];
  preferredSessionIds?: string[];
  resume: (request: { sessionId: string; additionalWorkDirs: string[] }) => Promise<ResumeRoomAgentResponse>;
}): Promise<ResumeRoomAgentResponse> {
  const target = getRoomAgentRecoveryTargets(input.session).find((candidate) => candidate.roomAgentId === input.roomAgentId);
  const sessionIds = Array.from(new Set([
    ...(input.preferredSessionIds ?? []),
    ...(target?.sessionIds ?? []),
  ].filter(Boolean)));
  if (!target || sessionIds.length === 0) {
    return { success: false, error: "当前 Agent 尚未绑定可恢复的 Kimi Code session" };
  }
  let lastError = "未找到可恢复的 Kimi Code session";
  for (const sessionId of sessionIds) {
    const response = await input.resume({ sessionId, additionalWorkDirs: input.additionalWorkDirs });
    if (!response.success) {
      lastError = response.error;
      continue;
    }
    if (input.session.projectPath && !isSamePath(response.data.workDir, input.session.projectPath)) {
      lastError = "Recovered session belongs to another project";
      continue;
    }
    return response;
  }
  return { success: false, error: lastError };
}

export function bindRecoveredRoomAgentRuntime(
  session: Session,
  roomAgentId: string,
  recovered: { sessionId: string; model?: string | null },
): Session {
  const agent = getRoomAgent(session, roomAgentId);
  if (!agent) return session;
  if (!session.collaboration) {
    return {
      ...session,
      runtimeSessionId: recovered.sessionId,
      officialSessionId: recovered.sessionId,
      model: recovered.model ?? session.model,
      updatedAt: Date.now(),
    };
  }
  return {
    ...updateRoomAgent(session, roomAgentId, (current) => ({
      ...current,
      runtimeSessionId: recovered.sessionId,
      officialSessionId: recovered.sessionId,
      modelAlias: recovered.model ?? current.modelAlias,
      missingSince: undefined,
      recoveryIssue: current.recoveryIssue?.status === "unavailable" ? current.recoveryIssue : undefined,
    })),
    updatedAt: Date.now(),
  };
}

export function setRoomAgentRecoveryIssue(
  session: Session,
  roomAgentId: string,
  issue: RoomAgent["recoveryIssue"] | undefined,
): Session {
  if (!session.collaboration) return session;
  return updateRoomAgent(session, roomAgentId, (agent) => ({ ...agent, recoveryIssue: issue }));
}

export function reconcileRoomAgentModelAvailability(
  session: Session,
  availableModelAliases: ReadonlySet<string> | null,
  now = Date.now(),
): Session {
  if (!session.collaboration || !availableModelAliases) return session;
  let next = session;
  for (const agent of session.collaboration.agents) {
    if (agent.removedAt || !agent.modelAlias) continue;
    const available = availableModelAliases.has(agent.modelAlias);
    if (!available) {
      const message = `模型 ${agent.modelAlias} 当前不可用，请恢复对应 Provider 或为该 Agent 重新选择模型。`;
      if (agent.recoveryIssue?.status === "unavailable" && agent.recoveryIssue.message === message) continue;
      next = setRoomAgentRecoveryIssue(next, agent.id, {
        status: "unavailable",
        message,
        updatedAt: now,
      });
      continue;
    }
    if (agent.recoveryIssue?.status === "unavailable") {
      next = setRoomAgentRecoveryIssue(next, agent.id, undefined);
    }
  }
  return next;
}

export function roomAgentCanResume(session: Session, roomAgentId: string): boolean {
  const agent = getRoomAgent(session, roomAgentId);
  return Boolean(agent && !agent.removedAt && agent.recoveryIssue?.status !== "unavailable");
}

export function getPrimaryRecoveryTarget(session: Session): RoomAgentRecoveryTarget {
  const primary = getPrimaryRoomAgent(session);
  return getRoomAgentRecoveryTargets(session).find((target) => target.roomAgentId === primary.id) ?? {
    roomAgentId: primary.id,
    sessionIds: [],
    skillForkParentSessionId: primary.skillForkParentSessionId,
    modelAlias: primary.modelAlias,
  };
}
