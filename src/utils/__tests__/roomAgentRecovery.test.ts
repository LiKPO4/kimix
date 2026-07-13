import { describe, expect, it, vi } from "vitest";
import type { RoomAgent, Session } from "@/types/ui";
import { createCollaborationStateFromSession, getPrimaryRoomAgent } from "@/utils/collaborationRooms";
import {
  bindRecoveredRoomAgentRuntime,
  getRoomAgentRecoveryTargets,
  reconcileRoomAgentModelAvailability,
  resumeRoomAgentRuntime,
  setRoomAgentRecoveryIssue,
} from "@/utils/roomAgentRecovery";

function room(): Session {
  const base: Session = {
    id: "room-1",
    engine: "kimi-code",
    runtimeSessionId: "runtime-primary",
    officialSessionId: "official-primary",
    model: "kimi-code/k2.5",
    title: "Room",
    projectPath: "D:\\work\\demo",
    createdAt: 1,
    updatedAt: 2,
    events: [],
    isLoading: false,
  };
  const collaboration = createCollaborationStateFromSession(base);
  const secondary: RoomAgent = {
    id: "agent-2",
    displayName: "Reviewer",
    mentionName: "reviewer",
    modelAlias: "openai/gpt-5",
    permissionMode: "manual",
    runtimeSessionId: "runtime-secondary",
    officialSessionId: "official-secondary",
    createdAt: 3,
  };
  return {
    ...base,
    collaboration: {
      ...collaboration,
      agents: [...collaboration.agents, secondary],
      agentEvents: { ...collaboration.agentEvents, [secondary.id]: [] },
    },
  };
}

describe("roomAgentRecovery", () => {
  it("为每个 Agent 独立生成去重的 runtime/official 恢复候选", () => {
    const session = room();
    const primary = getPrimaryRoomAgent(session);
    expect(getRoomAgentRecoveryTargets(session)).toEqual([
      expect.objectContaining({
        roomAgentId: primary.id,
        sessionIds: ["runtime-primary", "official-primary"],
      }),
      expect.objectContaining({
        roomAgentId: "agent-2",
        sessionIds: ["runtime-secondary", "official-secondary"],
      }),
    ]);
  });

  it("resume 只在当前 Agent 的候选中回退，并拒绝错误项目", async () => {
    const session = room();
    const resume = vi.fn()
      .mockResolvedValueOnce({ success: true, data: { sessionId: "wrong", workDir: "D:\\other" } })
      .mockResolvedValueOnce({ success: true, data: { sessionId: "official-secondary", workDir: "D:\\work\\demo", model: "openai/gpt-5" } });
    await expect(resumeRoomAgentRuntime({
      session,
      roomAgentId: "agent-2",
      additionalWorkDirs: [],
      resume,
    })).resolves.toEqual({
      success: true,
      data: { sessionId: "official-secondary", workDir: "D:\\work\\demo", model: "openai/gpt-5" },
    });
    expect(resume.mock.calls.map(([request]) => request.sessionId)).toEqual(["runtime-secondary", "official-secondary"]);
  });

  it("允许把官方 already-exists 身份放在当前 Agent 候选之前重试", async () => {
    const session = room();
    const resume = vi.fn().mockResolvedValue({
      success: true,
      data: { sessionId: "already-existing", workDir: "D:\\work\\demo" },
    });
    await resumeRoomAgentRuntime({
      session,
      roomAgentId: "agent-2",
      additionalWorkDirs: [],
      preferredSessionIds: ["already-existing"],
      resume,
    });
    expect(resume).toHaveBeenCalledWith({ sessionId: "already-existing", additionalWorkDirs: [] });
  });

  it("恢复绑定只修改目标 Agent，保留另一个 Agent 的身份", () => {
    const session = room();
    const primary = getPrimaryRoomAgent(session);
    const next = bindRecoveredRoomAgentRuntime(session, "agent-2", {
      sessionId: "secondary-next",
      model: "openai/gpt-5",
    });
    expect(next.collaboration?.agents.find((agent) => agent.id === "agent-2")).toMatchObject({
      runtimeSessionId: "secondary-next",
      officialSessionId: "secondary-next",
    });
    expect(next.collaboration?.agents.find((agent) => agent.id === primary.id)).toMatchObject({
      runtimeSessionId: "runtime-primary",
      officialSessionId: "official-primary",
    });
  });

  it("一个 Agent 恢复失败时保留其历史，另一个 Agent 仍可完成绑定", () => {
    const session = room();
    const failedHistory = [{
      id: "secondary-history",
      type: "assistant_message" as const,
      timestamp: 10,
      content: "Keep me",
      isThinking: false,
      isComplete: true,
      roomAgentId: "agent-2",
    }];
    const withHistory: Session = {
      ...session,
      collaboration: {
        ...session.collaboration!,
        agentEvents: {
          ...session.collaboration!.agentEvents,
          "agent-2": failedHistory,
        },
      },
    };
    const failed = setRoomAgentRecoveryIssue(withHistory, "agent-2", {
      status: "error",
      message: "恢复 Agent 历史失败",
      updatedAt: 100,
    });
    const primary = getPrimaryRoomAgent(failed);
    const recoveredPrimary = bindRecoveredRoomAgentRuntime(failed, primary.id, {
      sessionId: "primary-next",
      model: "kimi-code/k2.5",
    });

    expect(recoveredPrimary.collaboration?.agentEvents["agent-2"]).toEqual(failedHistory);
    expect(recoveredPrimary.collaboration?.agents.find((agent) => agent.id === "agent-2")?.recoveryIssue?.status).toBe("error");
    expect(recoveredPrimary.collaboration?.agents.find((agent) => agent.id === primary.id)?.runtimeSessionId).toBe("primary-next");
  });

  it("模型目录缺失时标记 unavailable，恢复后只清理该状态", () => {
    const session = room();
    const unavailable = reconcileRoomAgentModelAvailability(session, new Set(["kimi-code/k2.5"]), 100);
    expect(unavailable.collaboration?.agents.find((agent) => agent.id === "agent-2")?.recoveryIssue).toEqual({
      status: "unavailable",
      message: "模型 openai/gpt-5 当前不可用，请恢复对应 Provider 或为该 Agent 重新选择模型。",
      updatedAt: 100,
    });
    const recovered = reconcileRoomAgentModelAvailability(unavailable, new Set(["kimi-code/k2.5", "openai/gpt-5"]), 200);
    expect(recovered.collaboration?.agents.find((agent) => agent.id === "agent-2")?.recoveryIssue).toBeUndefined();
  });
});
