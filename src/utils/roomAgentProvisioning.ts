import type { PermissionMode, RoomAgent, RoomAgentActivity, Session } from "@/types/ui";
import {
  createCollaborationStateFromSession,
  getPrimaryRoomAgent,
  updateRoomAgent,
} from "@/utils/collaborationRooms";
import { roomHasActiveAgentWork } from "@/utils/sessionArchive";

export const MULTI_AGENT_ROOM_UI_GATE_KEY = "kimix_multi_agent_room_ui";
export const MAX_ROOM_AGENTS = 4;

export function isMultiAgentRoomUiEnabled() {
  try {
    return localStorage.getItem(MULTI_AGENT_ROOM_UI_GATE_KEY) === "1";
  } catch {
    return false;
  }
}

export type RoomAgentDraft = {
  displayName: string;
  mentionName: string;
  modelAlias: string;
  modelLabelSnapshot?: string;
  providerLabelSnapshot?: string;
  permissionMode: PermissionMode;
  planMode?: boolean;
};

function normalizeDisplayName(value: string) {
  const displayName = value.trim().replace(/\s+/g, " ");
  if (!displayName) throw new Error("请输入 Agent 名称");
  if (displayName.length > 40) throw new Error("Agent 名称不能超过 40 个字符");
  return displayName;
}

function normalizeMentionName(value: string) {
  const mentionName = value.trim().replace(/^@+/, "");
  if (!mentionName) throw new Error("请输入 @名称");
  if (!/^[\p{L}\p{N}._-]{1,32}$/u.test(mentionName)) {
    throw new Error("@名称只能包含文字、数字、点、下划线和连字符，最多 32 个字符");
  }
  return mentionName;
}

export function prepareRoomAgentProvisioning(
  session: Session,
  draft: RoomAgentDraft,
  activities: Iterable<RoomAgentActivity> = [],
  now = Date.now(),
  createId: () => string = () => `room-agent:${crypto.randomUUID()}`,
): { session: Session; agent: RoomAgent } {
  if (session.longTask) throw new Error("Long Task 暂不支持添加房间 Agent");
  if (session.engine && session.engine !== "kimi-code") throw new Error("当前会话类型不支持添加房间 Agent");
  if (roomHasActiveAgentWork(session, activities)) throw new Error("房间仍有 Agent 在运行，暂时不能添加成员");
  const collaboration = createCollaborationStateFromSession(session, draft.permissionMode);
  const activeAgents = collaboration.agents.filter((agent) => !agent.removedAt);
  if (activeAgents.length >= MAX_ROOM_AGENTS) throw new Error(`一个房间最多 ${MAX_ROOM_AGENTS} 个 Agent`);
  const displayName = normalizeDisplayName(draft.displayName);
  const mentionName = normalizeMentionName(draft.mentionName);
  if (activeAgents.some((agent) => agent.displayName.toLocaleLowerCase() === displayName.toLocaleLowerCase())) {
    throw new Error("Agent 名称已存在");
  }
  if (activeAgents.some((agent) => agent.mentionName.toLocaleLowerCase() === mentionName.toLocaleLowerCase())) {
    throw new Error("@名称已存在");
  }
  const modelAlias = draft.modelAlias.trim();
  if (!modelAlias) throw new Error("请选择模型");
  let id = createId();
  while (collaboration.agents.some((agent) => agent.id === id)) id = createId();
  const agent: RoomAgent = {
    id,
    displayName,
    mentionName,
    modelAlias,
    modelLabelSnapshot: draft.modelLabelSnapshot?.trim() || undefined,
    providerLabelSnapshot: draft.providerLabelSnapshot?.trim() || undefined,
    permissionMode: draft.permissionMode,
    planMode: draft.planMode,
    createdAt: now,
  };
  return {
    agent,
    session: {
      ...session,
      collaboration: {
        ...collaboration,
        focusedAgentId: agent.id,
        defaultRecipientIds: [agent.id],
        agents: [...collaboration.agents, agent],
        agentEvents: { ...collaboration.agentEvents, [agent.id]: [] },
      },
      updatedAt: now,
    },
  };
}

export function renameRoomAgent(
  session: Session,
  roomAgentId: string,
  input: Pick<RoomAgentDraft, "displayName" | "mentionName">,
  activities: Iterable<RoomAgentActivity> = [],
  now = Date.now(),
) {
  if (!session.collaboration) throw new Error("当前会话不是多 Agent 房间");
  if (roomHasActiveAgentWork(session, activities)) throw new Error("房间仍有 Agent 在运行，暂时不能修改成员身份");
  const current = session.collaboration.agents.find((agent) => agent.id === roomAgentId);
  if (!current || current.removedAt) throw new Error("Agent 不存在或已移出房间");
  if (current.archivedAt) throw new Error("请先恢复该 Agent，再修改名称");
  const displayName = normalizeDisplayName(input.displayName);
  const mentionName = normalizeMentionName(input.mentionName);
  const peers = session.collaboration.agents.filter((agent) => !agent.removedAt && agent.id !== roomAgentId);
  if (peers.some((agent) => agent.displayName.toLocaleLowerCase() === displayName.toLocaleLowerCase())) {
    throw new Error("Agent 名称已存在");
  }
  if (peers.some((agent) => agent.mentionName.toLocaleLowerCase() === mentionName.toLocaleLowerCase())) {
    throw new Error("@名称已存在");
  }
  return {
    ...updateRoomAgent(session, roomAgentId, (agent) => ({ ...agent, displayName, mentionName })),
    updatedAt: now,
  };
}

export function bindProvisionedRoomAgent(
  session: Session,
  roomAgentId: string,
  runtimeSessionId: string,
  modelAlias?: string | null,
  now = Date.now(),
) {
  return {
    ...updateRoomAgent(session, roomAgentId, (agent) => ({
      ...agent,
      runtimeSessionId,
      officialSessionId: runtimeSessionId,
      modelAlias: modelAlias ?? agent.modelAlias,
      provisioningError: undefined,
      missingSince: undefined,
      recoveryIssue: undefined,
    })),
    updatedAt: now,
  };
}

export function failRoomAgentProvisioning(
  session: Session,
  roomAgentId: string,
  error: string,
  now = Date.now(),
) {
  return {
    ...updateRoomAgent(session, roomAgentId, (agent) => ({
      ...agent,
      provisioningError: error.trim() || "创建官方 Agent 会话失败",
    })),
    updatedAt: now,
  };
}

export function getRoomPrimaryMetadataIdentity(session: Session) {
  const primary = getPrimaryRoomAgent(session);
  return primary.officialSessionId ?? primary.runtimeSessionId ?? session.officialSessionId ?? session.runtimeSessionId ?? null;
}
