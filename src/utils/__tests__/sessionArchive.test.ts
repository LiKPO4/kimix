import { describe, expect, it, vi } from "vitest";
import type { RoomAgent, Session } from "@/types/ui";
import {
  archiveCollaborationRoom,
  archiveSessionOfficialFirst,
  detachRoomAgentAsSession,
  formatRoomLifecycleOutcomes,
  getOfficialArchiveSessionId,
  getRelatedArchiveSessionIds,
  restoreCollaborationRoom,
  roomHasActiveAgentWork,
} from "../sessionArchive";
import {
  createCollaborationStateFromSession,
  resolveRoomRuntimeOwner,
  synchronizeCollaborationPrimaryMirror,
} from "../collaborationRooms";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "local-1",
    engine: "kimi-code",
    title: "会话",
    projectPath: "D:\\work\\demo",
    createdAt: 1,
    updatedAt: 1,
    events: [],
    isLoading: false,
    ...overrides,
  };
}

function room(): Session {
  const base = session({
    id: "room-1",
    runtimeSessionId: "runtime-primary",
    officialSessionId: "official-primary",
  });
  const initial = createCollaborationStateFromSession(base);
  const primary = {
    ...initial.agents[0],
    runtimeSessionId: "runtime-primary",
    officialSessionId: "official-primary",
  };
  const secondary: RoomAgent = {
    id: "agent-secondary",
    displayName: "Reviewer",
    mentionName: "reviewer",
    modelAlias: "openai/gpt-5",
    permissionMode: "manual",
    runtimeSessionId: "runtime-secondary",
    officialSessionId: "official-secondary",
    createdAt: 2,
  };
  return synchronizeCollaborationPrimaryMirror({
    ...base,
    collaboration: {
      ...initial,
      agents: [primary, secondary],
      defaultRecipientIds: [primary.id, secondary.id],
      focusedAgentId: secondary.id,
      agentEvents: {
        [primary.id]: [],
        [secondary.id]: [{
          id: "secondary-user",
          type: "user_message",
          timestamp: 10,
          content: "独立历史",
          roomAgentId: secondary.id,
          roomMessageId: "room-message-1",
          agentTurnId: "turn-secondary",
          recipientAgentIds: [secondary.id],
        }],
      },
      messages: [{
        id: "room-message-1",
        content: "独立历史",
        recipientAgentIds: [secondary.id],
        deliveries: {
          [secondary.id]: { status: "completed", agentTurnId: "turn-secondary" },
        },
        timestamp: 10,
      }],
    },
  });
}

describe("official-first session archive", () => {
  it("逐 Agent 格式化归档与恢复结果", () => {
    const outcomes = [
      { roomAgentId: "primary", displayName: "Implementer", success: true },
      { roomAgentId: "reviewer", displayName: "Reviewer", success: false, error: "Server unavailable" },
    ];
    expect(formatRoomLifecycleOutcomes("archive", outcomes))
      .toBe("归档结果：Implementer：成功；Reviewer：失败（Server unavailable）");
    expect(formatRoomLifecycleOutcomes("restore", []))
      .toBe("恢复结果：没有需要操作的 Agent");
  });

  it("归档所有共享同一官方 runtime id 的本地镜像", () => {
    const target = session({ id: "local-a", runtimeSessionId: "official-1" });
    const duplicate = session({ id: "local-b", officialSessionId: "official-1" });
    const unrelated = session({ id: "local-c", officialSessionId: "official-2" });
    expect(getRelatedArchiveSessionIds([target, duplicate, unrelated], target)).toEqual(["local-a", "local-b"]);
  });

  it("优先使用 runtime 或 official id", () => {
    expect(getOfficialArchiveSessionId(session({ runtimeSessionId: "runtime", officialSessionId: "official" }))).toBe("runtime");
    expect(getOfficialArchiveSessionId(session({ officialSessionId: "official" }))).toBe("official");
    expect(getOfficialArchiveSessionId(session())).toBeNull();
  });

  it("官方归档成功后才写入本地归档", async () => {
    const order: string[] = [];
    const result = await archiveSessionOfficialFirst(
      session({ officialSessionId: "official" }),
      async () => { order.push("official"); return { success: true, data: undefined }; },
      () => order.push("local"),
    );

    expect(result).toEqual({ success: true });
    expect(order).toEqual(["official", "local"]);
  });

  it("官方归档失败时不隐藏本地会话", async () => {
    const archiveLocal = vi.fn();
    const result = await archiveSessionOfficialFirst(
      session({ officialSessionId: "official" }),
      async () => ({ success: false, error: "WebSocket error" }),
      archiveLocal,
    );

    expect(result).toEqual({ success: false, error: "WebSocket error" });
    expect(archiveLocal).not.toHaveBeenCalled();
  });

  it("官方会话已不存在时按幂等成功隐藏本地镜像", async () => {
    const archiveLocal = vi.fn();
    const result = await archiveSessionOfficialFirst(
      session({ officialSessionId: "session_2c277849-ac4a-4489-9ecc-2af3c038ea37" }),
      async () => ({ success: false, error: "/api/v1/sessions/session_2c277849-ac4a-4489-9ecc-2af3c038ea37:archive: session session_2c277849-ac4a-4489-9ecc-2af3c038ea37 does not exist" }),
      archiveLocal,
    );

    expect(result).toEqual({ success: true });
    expect(archiveLocal).toHaveBeenCalledWith("local-1");
  });

  it("SDK-only 会话在 Server 不可用时回退到本地归档", async () => {
    const archiveLocal = vi.fn();
    const result = await archiveSessionOfficialFirst(
      session({ id: "sdk-session", runtimeSessionId: "sdk-session" }),
      async () => { throw new Error("Session not found on Kimi Server"); },
      archiveLocal,
    );

    expect(result).toEqual({ success: true });
    expect(archiveLocal).toHaveBeenCalledWith("sdk-session");
  });

  it("房间归档并行处理全部 Agent，全部成功后才归档房间", async () => {
    const archiveOfficial = vi.fn().mockResolvedValue({ success: true, data: undefined });
    const result = await archiveCollaborationRoom(room(), archiveOfficial, 100);

    expect(archiveOfficial.mock.calls.map(([id]) => id).sort()).toEqual(["runtime-primary", "runtime-secondary"]);
    expect(result.success).toBe(true);
    expect(result.partial).toBe(false);
    expect(result.session.archivedAt).toBe(100);
    expect(result.session.collaboration?.agents.every((agent) => agent.archivedAt === 100)).toBe(true);
  });

  it("部分归档失败时保持房间可见，并只重试失败 Agent", async () => {
    const first = await archiveCollaborationRoom(room(), async (id) => (
      id === "runtime-primary"
        ? { success: true as const, data: undefined }
        : { success: false as const, error: "reviewer archive failed" }
    ), 100);

    expect(first.success).toBe(false);
    expect(first.partial).toBe(true);
    expect(first.session.archivedAt).toBeUndefined();
    expect(first.session.collaboration?.agents[0].archivedAt).toBe(100);
    expect(first.session.collaboration?.agents[1].lifecycleIssue).toMatchObject({
      operation: "archive",
      message: "reviewer archive failed",
    });

    const retryOfficial = vi.fn().mockResolvedValue({ success: true, data: undefined });
    const retry = await archiveCollaborationRoom(first.session, retryOfficial, 200);

    expect(retryOfficial).toHaveBeenCalledTimes(1);
    expect(retryOfficial).toHaveBeenCalledWith("runtime-secondary");
    expect(retry.success).toBe(true);
    expect(retry.session.archivedAt).toBe(200);
    expect(retry.session.collaboration?.agents[1].lifecycleIssue).toBeUndefined();
  });

  it("部分恢复成功后立即显示房间，并保留失败 Agent 的可重试状态", async () => {
    const archived = await archiveCollaborationRoom(
      room(),
      async () => ({ success: true as const, data: undefined }),
      100,
    );
    const restored = await restoreCollaborationRoom(archived.session, async (id) => (
      id === "runtime-primary"
        ? { success: true as const, data: undefined }
        : { success: false as const, error: "reviewer restore failed" }
    ), 200);

    expect(restored.success).toBe(false);
    expect(restored.partial).toBe(true);
    expect(restored.session.archivedAt).toBeUndefined();
    expect(restored.session.collaboration?.agents[0].archivedAt).toBeUndefined();
    expect(restored.session.collaboration?.agents[1]).toMatchObject({
      archivedAt: 100,
      lifecycleIssue: { operation: "restore", message: "reviewer restore failed" },
    });

    const retryOfficial = vi.fn().mockResolvedValue({ success: true, data: undefined });
    const retry = await restoreCollaborationRoom(restored.session, retryOfficial, 300);
    expect(retryOfficial).toHaveBeenCalledTimes(1);
    expect(retryOfficial).toHaveBeenCalledWith("runtime-secondary");
    expect(retry.success).toBe(true);
    expect(retry.session.collaboration?.agents.every((agent) => !agent.archivedAt && !agent.lifecycleIssue)).toBe(true);
  });

  it("移出次要 Agent 时保留房间历史，并把官方会话转成独立会话", () => {
    const source = room();
    const secondary = source.collaboration!.agents[1];
    const result = detachRoomAgentAsSession(source, secondary.id, new Set([source.id]), 300);
    const removed = result.room.collaboration!.agents.find((agent) => agent.id === secondary.id)!;

    expect(removed).toMatchObject({ id: secondary.id, removedAt: 300 });
    expect(removed.runtimeSessionId).toBeUndefined();
    expect(removed.officialSessionId).toBeUndefined();
    expect(result.room.collaboration?.agentEvents[secondary.id]).toHaveLength(1);
    expect(result.detached).toMatchObject({
      id: "official-secondary",
      runtimeSessionId: "runtime-secondary",
      officialSessionId: "official-secondary",
      title: "Reviewer",
    });
    expect(result.detached.events[0]).not.toHaveProperty("roomAgentId");
    expect(result.detached.events[0]).not.toHaveProperty("roomMessageId");
    expect(result.detached.events[0]).not.toHaveProperty("agentTurnId");
    expect(result.room.collaboration?.defaultRecipientIds).not.toContain(secondary.id);
    expect(result.room.collaboration?.focusedAgentId).toBe(result.room.collaboration?.primaryAgentId);
    expect(resolveRoomRuntimeOwner([result.room, result.detached], "official-secondary")?.roomId).toBe(result.detached.id);
  });

  it("房间存在运行、排队或等待交互的 Agent 时阻止成员和归档身份变更", () => {
    const source = room();
    const secondary = source.collaboration!.agents[1];
    expect(roomHasActiveAgentWork(source)).toBe(false);
    expect(roomHasActiveAgentWork(source, [{
      roomId: source.id,
      roomAgentId: secondary.id,
      status: "accepted",
      updatedAt: 90,
    }])).toBe(true);
    expect(roomHasActiveAgentWork(source, [{
      roomId: source.id,
      roomAgentId: secondary.id,
      status: "waiting_approval",
      updatedAt: 100,
    }])).toBe(true);
    expect(() => detachRoomAgentAsSession(source, secondary.id, new Set([source.id]), 200, [{
      roomId: source.id,
      roomAgentId: secondary.id,
      status: "running",
      updatedAt: 100,
    }])).toThrow("房间仍有 Agent 在运行");
    const accepted = {
      ...source,
      collaboration: {
        ...source.collaboration!,
        messages: source.collaboration!.messages.map((message) => ({
          ...message,
          deliveries: {
            ...message.deliveries,
            [secondary.id]: { ...message.deliveries[secondary.id], status: "accepted" as const },
          },
        })),
      },
    };
    expect(roomHasActiveAgentWork(accepted)).toBe(true);
    const indeterminate = {
      ...source,
      collaboration: {
        ...source.collaboration!,
        messages: source.collaboration!.messages.map((message) => ({
          ...message,
          deliveries: {
            ...message.deliveries,
            [secondary.id]: { ...message.deliveries[secondary.id], status: "indeterminate" as const },
          },
        })),
      },
    };
    expect(roomHasActiveAgentWork(indeterminate)).toBe(true);
  });
});
