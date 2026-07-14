import { describe, expect, it } from "vitest";
import type { Session } from "@/types/ui";
import { createCollaborationStateFromSession } from "../collaborationRooms";
import { buildLocalSessionSearchMatches } from "../sessionSearch";

function roomFixture(): Session {
  const session: Session = {
    id: "room-1",
    engine: "kimi-code",
    runtimeSessionId: "runtime-primary",
    officialSessionId: "official-primary",
    model: "kimi-code/k2.5",
    title: "交叉审查",
    projectPath: "D:/work",
    createdAt: 1,
    updatedAt: 5,
    events: [],
    isLoading: false,
  };
  const collaboration = createCollaborationStateFromSession(session);
  const secondary = {
    id: "agent-reviewer",
    displayName: "Reviewer",
    mentionName: "reviewer",
    modelAlias: "openai/gpt-5",
    modelLabelSnapshot: "GPT-5",
    permissionMode: "manual" as const,
    runtimeSessionId: "runtime-reviewer",
    createdAt: 2,
  };
  return {
    ...session,
    collaboration: {
      ...collaboration,
      agents: [...collaboration.agents, secondary],
      agentEvents: {
        ...collaboration.agentEvents,
        [secondary.id]: [{
          id: "review-event",
          type: "assistant_message",
          timestamp: 4,
          content: "发现权限回滚问题",
          isThinking: false,
          isComplete: true,
          roomAgentId: secondary.id,
          agentTurnId: "review-turn",
        }],
      },
    },
  };
}

describe("sessionSearch", () => {
  it("indexes secondary Agent events with Agent and model ownership", () => {
    const matches = buildLocalSessionSearchMatches([roomFixture()], "权限回滚");
    expect(matches).toEqual([
      expect.objectContaining({
        eventId: "review-event",
        roomAgentId: "agent-reviewer",
        agentName: "Reviewer",
        modelLabel: "GPT-5",
        text: "发现权限回滚问题",
      }),
    ]);
  });

  it("keeps room-level recent results without inventing an Agent owner", () => {
    const matches = buildLocalSessionSearchMatches([roomFixture()], "");
    expect(matches[0]).toMatchObject({ kind: "最近对话", roomAgentCount: 2 });
    expect(matches[0].roomAgentId).toBeUndefined();
  });
});
