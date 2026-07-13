import { describe, expect, it } from "vitest";
import type { Session, TimelineEvent } from "@/types/ui";
import { createCollaborationStateFromSession } from "../collaborationRooms";
import {
  approvalRequestNotificationKey,
  findNotificationSession,
  focusNotificationRoomAgent,
  resolveNotificationClickTarget,
  summarizeApprovalRequest,
} from "../notificationRouting";

function session(id: string, runtimeSessionId?: string, officialSessionId?: string): Session {
  return {
    id,
    runtimeSessionId,
    officialSessionId,
    title: id,
    projectPath: "D:\\work",
    createdAt: 1,
    updatedAt: 1,
    events: [],
    isLoading: false,
  };
}

describe("notification routing", () => {
  it("finds a visible session from local, runtime, or official identity", () => {
    const sessions = [session("local", "runtime", "official")];
    expect(findNotificationSession(sessions, "local")?.id).toBe("local");
    expect(findNotificationSession(sessions, "runtime")?.id).toBe("local");
    expect(findNotificationSession(sessions, "official")?.id).toBe("local");
    expect(findNotificationSession(sessions, "missing")).toBeUndefined();
  });

  it("uses the stable official request id for approval deduplication", () => {
    const approval = {
      id: "event-1",
      type: "approval_request" as const,
      timestamp: 1,
      requestId: "request-1",
      toolName: "Shell",
      description: "运行命令",
      details: "pnpm test",
      riskLevel: "medium" as const,
      status: "pending" as const,
    } satisfies TimelineEvent;
    expect(approvalRequestNotificationKey(approval)).toBe("request-1");
    expect(summarizeApprovalRequest(approval)).toBe("运行命令");
  });

  it("finds and focuses a secondary room Agent from runtime notification identity", () => {
    const primary = session("room", "runtime-primary", "official-primary");
    const collaboration = createCollaborationStateFromSession(primary);
    const assistant = {
      id: "assistant-secondary",
      type: "assistant_message" as const,
      timestamp: 4,
      content: "审查完成",
      isComplete: true,
      roomAgentId: "agent-secondary",
      agentTurnId: "turn-secondary",
    } satisfies TimelineEvent;
    const room: Session = {
      ...primary,
      collaboration: {
        ...collaboration,
        agents: [
          ...collaboration.agents,
          {
            id: "agent-secondary",
            displayName: "Reviewer",
            mentionName: "reviewer",
            modelAlias: "openai/gpt-5",
            permissionMode: "manual",
            runtimeSessionId: "runtime-secondary",
            officialSessionId: "official-secondary",
            createdAt: 3,
          },
        ],
        defaultRecipientIds: [collaboration.primaryAgentId],
        agentEvents: {
          ...collaboration.agentEvents,
          "agent-secondary": [assistant],
        },
      },
    };

    expect(findNotificationSession([room], "runtime-secondary")?.id).toBe("room");
    const target = resolveNotificationClickTarget([room], {
      sessionId: "runtime-secondary",
      roomAgentId: "agent-secondary",
      agentTurnId: "turn-secondary",
    });
    expect(target).toMatchObject({
      session: { id: "room" },
      roomAgentId: "agent-secondary",
      eventId: "assistant-secondary",
    });
    expect(focusNotificationRoomAgent(room, target?.roomAgentId).collaboration).toMatchObject({
      defaultRecipientIds: ["agent-secondary"],
      focusedAgentId: "agent-secondary",
    });
  });

  it("prefers the exact notification event over another event in the same turn", () => {
    const base = session("room");
    const collaboration = createCollaborationStateFromSession(base);
    const room: Session = {
      ...base,
      collaboration: {
        ...collaboration,
        agentEvents: {
          ...collaboration.agentEvents,
          [collaboration.primaryAgentId]: [
            {
              id: "approval-1",
              type: "approval_request",
              timestamp: 2,
              requestId: "request-1",
              toolName: "Shell",
              description: "运行测试",
              riskLevel: "medium",
              status: "pending",
              roomAgentId: collaboration.primaryAgentId,
              agentTurnId: "turn-1",
            },
            {
              id: "assistant-1",
              type: "assistant_message",
              timestamp: 3,
              content: "等待审批",
              isComplete: false,
              roomAgentId: collaboration.primaryAgentId,
              agentTurnId: "turn-1",
            },
          ],
        },
      },
    };
    const target = resolveNotificationClickTarget([room], {
      sessionId: room.id,
      roomAgentId: collaboration.primaryAgentId,
      agentTurnId: "turn-1",
      eventId: "approval-1",
    });
    expect(target?.eventId).toBe("approval-1");
  });
});
