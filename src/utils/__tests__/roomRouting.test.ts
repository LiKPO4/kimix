import { describe, expect, it } from "vitest";
import type { RoomAgent, Session } from "@/types/ui";
import { createCollaborationStateFromSession } from "../collaborationRooms";
import { resolveRoomPromptRoute } from "../roomRouting";

function room(): Session {
  const base: Session = {
    id: "room-1",
    engine: "kimi-code",
    model: "kimi-code/k2.5",
    title: "Room",
    projectPath: "D:/work/demo",
    createdAt: 1,
    updatedAt: 2,
    events: [],
    isLoading: false,
  };
  const collaboration = createCollaborationStateFromSession(base);
  const agents: RoomAgent[] = [
    collaboration.agents[0],
    {
      id: "agent-reviewer",
      displayName: "Reviewer",
      mentionName: "reviewer",
      modelAlias: "openai/gpt-5",
      permissionMode: "manual",
      createdAt: 3,
    },
    {
      id: "agent-auditor",
      displayName: "审计者",
      mentionName: "审计者",
      modelAlias: "anthropic/claude",
      permissionMode: "manual",
      createdAt: 4,
    },
  ];
  return {
    ...base,
    collaboration: {
      ...collaboration,
      agents,
      defaultRecipientIds: [agents[0].id],
      agentEvents: Object.fromEntries(agents.map((agent) => [agent.id, []])),
    },
  };
}

describe("roomRouting", () => {
  it("recognized mentions override defaults in textual order and are stripped only from outbound payload", () => {
    const result = resolveRoomPromptRoute(room(), "@审计者 @Reviewer 请交叉检查；保留 @unknown 原文");
    expect(result.recipientAgentIds).toEqual(["agent-auditor", "agent-reviewer"]);
    expect(result.matchedMentionNames).toEqual(["审计者", "reviewer"]);
    expect(result.outboundContent).toBe("请交叉检查；保留 @unknown 原文");
    expect(result.source).toBe("mention");
  });

  it("matching is case-insensitive, duplicate mentions dispatch once, and email-like text is not routing", () => {
    const result = resolveRoomPromptRoute(room(), "联系 a@reviewer.com，然后 @REVIEWER @reviewer 检查");
    expect(result.recipientAgentIds).toEqual(["agent-reviewer"]);
    expect(result.outboundContent).toBe("联系 a@reviewer.com，然后 检查");
  });

  it("without recognized mentions uses the frozen fallback selection and preserves content", () => {
    const source = room();
    const result = resolveRoomPromptRoute(source, "请分别检查 @plugin", ["agent-reviewer", "agent-auditor"]);
    expect(result.recipientAgentIds).toEqual(["agent-reviewer", "agent-auditor"]);
    expect(result.outboundContent).toBe("请分别检查 @plugin");
    expect(result.source).toBe("default");
  });
});
