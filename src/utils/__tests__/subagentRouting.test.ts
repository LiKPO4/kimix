import { describe, expect, it } from "vitest";
import type { Session } from "@/types/ui";
import { createCollaborationStateFromSession, getPrimaryRoomAgent, getRoomAgent } from "../collaborationRooms";
import { queueSubagentRouting, recordAppliedSubagentRouting } from "../subagentRouting";

function session(): Session {
  return {
    id: "session-1",
    engine: "kimi-code",
    model: "main-model",
    permissionMode: "auto",
    title: "测试",
    projectPath: "D:/project",
    createdAt: 1,
    updatedAt: 1,
    events: [],
  };
}

describe("subagentRouting", () => {
  it("queues and applies routing on a normal session", () => {
    const original = session();
    const primaryId = getPrimaryRoomAgent(original).id;
    const queued = queueSubagentRouting(original, primaryId, {
      modelAlias: "child-model",
      thinkingEffort: "high",
    }, "auto");
    expect(queued.subagentRoutingDesired).toEqual({ modelAlias: "child-model", thinkingEffort: "high" });

    const applied = recordAppliedSubagentRouting(queued, primaryId, {
      subagentModel: "child-model",
      subagentThinkingEffort: "high",
    }, "auto");
    expect(applied).toMatchObject({
      subagentModelAlias: "child-model",
      subagentThinkingEffort: "high",
      subagentRoutingDesired: undefined,
    });
  });

  it("updates only the selected room Agent", () => {
    const original = session();
    const collaboration = createCollaborationStateFromSession(original);
    const second = {
      id: "agent-2",
      displayName: "第二个",
      mentionName: "second",
      modelAlias: "other-model",
      permissionMode: "auto" as const,
      createdAt: 2,
    };
    const room: Session = {
      ...original,
      collaboration: {
        ...collaboration,
        defaultRecipientIds: [second.id],
        focusedAgentId: second.id,
        agents: [...collaboration.agents, second],
        agentEvents: { ...collaboration.agentEvents, [second.id]: [] },
      },
    };
    const queued = queueSubagentRouting(room, second.id, {
      modelAlias: "worker-model",
      thinkingEffort: null,
    }, "auto");

    expect(getRoomAgent(queued, second.id)?.subagentRoutingDesired).toEqual({
      modelAlias: "worker-model",
      thinkingEffort: null,
    });
    expect(getPrimaryRoomAgent(queued).subagentRoutingDesired).toBeUndefined();
  });
});
