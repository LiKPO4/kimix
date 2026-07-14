import { describe, expect, it } from "vitest";
import type { Session } from "@/types/ui";
import { createCollaborationStateFromSession } from "../collaborationRooms";
import { buildOfficialRoomMetadata } from "../roomSessionMetadata";
import { getOrphanRoomSessionInfo, recoverOrphanRoomsFromOfficialCatalog } from "../orphanRoomSessions";
import { reconcileOfficialSessionCatalog } from "../sessionCatalog";

function room(): Session {
  const base: Session = {
    id: "room-1",
    engine: "kimi-code",
    runtimeSessionId: "primary-session",
    officialSessionId: "primary-session",
    title: "交叉审查",
    projectPath: "D:/project",
    createdAt: 1,
    updatedAt: 1,
    events: [],
    isLoading: false,
  };
  const collaboration = createCollaborationStateFromSession(base);
  return {
    ...base,
    collaboration: {
      ...collaboration,
      agents: [
        collaboration.agents[0],
        {
          id: "reviewer-agent",
          displayName: "Reviewer",
          mentionName: "reviewer",
          modelAlias: "openai/gpt-5",
          permissionMode: "manual",
          runtimeSessionId: "reviewer-session",
          officialSessionId: "reviewer-session",
          createdAt: 2,
        },
      ],
      agentEvents: {
        ...collaboration.agentEvents,
        "reviewer-agent": [],
      },
    },
  };
}

const metadata = buildOfficialRoomMetadata({
  schemaVersion: 1,
  roomId: "room-1",
  roomAgentId: "reviewer-agent",
  primarySessionId: "primary-session",
});

describe("orphan room sessions", () => {
  it("识别带房间元数据但尚未绑定本地房间的官方会话", () => {
    expect(getOrphanRoomSessionInfo({ id: "reviewer-session", metadata }, [])).toEqual({
      reason: "unbound",
      roomId: "room-1",
      roomAgentId: "reviewer-agent",
    });
  });

  it("已绑定的房间 Agent 不进入待找回列表", () => {
    expect(getOrphanRoomSessionInfo({ id: "reviewer-session", metadata }, [room()])).toBeNull();
  });

  it("已作为独立镜像出现时仍保留在待找回入口", () => {
    const standalone: Session = {
      id: "reviewer-session",
      engine: "kimi-code",
      runtimeSessionId: "reviewer-session",
      officialSessionId: "reviewer-session",
      title: "Reviewer orphan",
      projectPath: "D:/project",
      createdAt: 2,
      updatedAt: 2,
      events: [],
      isLoading: false,
    };
    expect(getOrphanRoomSessionInfo({ id: "reviewer-session", metadata }, [standalone]))
      .toMatchObject({ reason: "unbound", roomId: "room-1", roomAgentId: "reviewer-agent" });
  });

  it("保留来源正确但 schema 异常的官方会话", () => {
    expect(getOrphanRoomSessionInfo({
      id: "broken-session",
      metadata: { ...metadata, kimixRoomSchemaVersion: 99 },
    }, [])).toEqual({ reason: "invalid_metadata" });
  });

  it("本地分组丢失时依据唯一官方 metadata 重建房间骨架", () => {
    const primary: Session = {
      id: "room-1",
      engine: "kimi-code",
      runtimeSessionId: "primary-session",
      officialSessionId: "primary-session",
      model: "opencode-go/deepseek-v4-pro",
      title: "交叉审查",
      projectPath: "D:/project",
      createdAt: 1,
      updatedAt: 2,
      events: [],
      isLoading: false,
    };
    const reviewer = {
      id: "reviewer-session",
      title: "Review",
      workDir: "D:/project",
      sessionDir: "D:/sessions/reviewer",
      createdAt: 3,
      updatedAt: 4,
      metadata,
    };

    const recovered = recoverOrphanRoomsFromOfficialCatalog([primary], [reviewer], "D:/project", 10);

    expect(recovered.recoveredRoomIds).toEqual(["room-1"]);
    expect(recovered.sessions[0].collaboration?.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayName: "deepseek-v4-pro" }),
      expect.objectContaining({
        id: "reviewer-agent",
        displayName: "Agent 2",
        runtimeSessionId: "reviewer-session",
        officialSessionId: "reviewer-session",
      }),
    ]));
    expect(recovered.sessions[0].collaboration?.agentEvents["reviewer-agent"]).toEqual([]);
    const reconciled = reconcileOfficialSessionCatalog(recovered.sessions, [reviewer], "D:/project", { source: "server" });
    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].collaboration?.agents[1]).toMatchObject({ officialSessionId: "reviewer-session" });
  });

  it("重复 Agent metadata 或未来 schema 会保持待找回而不自动合并", () => {
    const primary = { ...room(), collaboration: undefined };
    const duplicate = {
      id: "reviewer-session-2",
      workDir: "D:/project",
      sessionDir: "D:/sessions/reviewer-2",
      createdAt: 4,
      updatedAt: 4,
      metadata,
    };
    const original = { ...duplicate, id: "reviewer-session" };

    expect(recoverOrphanRoomsFromOfficialCatalog([primary], [original, duplicate], "D:/project").recoveredRoomIds).toEqual([]);
  });
});
