import { describe, expect, it } from "vitest";
import type { Session, TimelineEvent } from "@/types/ui";
import { findSubagentContentRegressionSnapshots, type RenderItem } from "@/components/chat/ChatThread";

function sessionStub(events: TimelineEvent[] = []): Session {
  return {
    id: "session-1",
    title: "test",
    projectPath: "/",
    createdAt: 0,
    updatedAt: 0,
    events,
  };
}

function assistantEvent(
  content: string,
  overrides: Partial<Extract<TimelineEvent, { type: "assistant_message" }>> = {},
): Extract<TimelineEvent, { type: "assistant_message" }> {
  return {
    id: "assistant-1",
    type: "assistant_message",
    timestamp: 1,
    content,
    isThinking: false,
    isComplete: true,
    ...overrides,
  };
}

function subagentStub(overrides: Partial<Extract<TimelineEvent, { type: "subagent" }>> = {}): Extract<TimelineEvent, { type: "subagent" }> {
  return {
    id: "sub-1",
    type: "subagent",
    timestamp: 1,
    agentName: "coder",
    status: "completed",
    events: [],
    ...overrides,
  };
}

describe("findSubagentContentRegressionSnapshots", () => {
  it("returns an empty array when there is no subagent-backed assistant item", () => {
    const items: RenderItem[] = [{ type: "event", event: assistantEvent("hello") }];
    expect(findSubagentContentRegressionSnapshots(items, sessionStub())).toEqual([]);
  });

  it("returns a snapshot for a completed assistant item that surfaced subagent content", () => {
    const event = assistantEvent("surfaced body", { roomAgentId: "agent-a", agentTurnId: "turn-1" });
    const items: RenderItem[] = [{ type: "event", event, leadingSubagents: [subagentStub()] }];
    const session = sessionStub([event]);
    const snapshots = findSubagentContentRegressionSnapshots(items, session);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      key: "session-1:agent-a:turn-1",
      sessionId: "session-1",
      roomAgentId: "agent-a",
      agentTurnId: "turn-1",
      eventId: "assistant-1",
      topLevelAssistantSize: "surfaced body".length,
    });
    expect(snapshots[0].sourceEvents).toBe(session.events);
  });

  it("ignores incomplete assistant items", () => {
    const event = assistantEvent("streaming", { isComplete: false });
    const items: RenderItem[] = [{ type: "event", event, leadingSubagents: [subagentStub()] }];
    expect(findSubagentContentRegressionSnapshots(items, sessionStub())).toEqual([]);
  });

  it("ignores assistant items without content", () => {
    const event = assistantEvent("", { roomAgentId: "agent-a", agentTurnId: "turn-1" });
    const items: RenderItem[] = [{ type: "event", event, leadingSubagents: [subagentStub()] }];
    expect(findSubagentContentRegressionSnapshots(items, sessionStub())).toEqual([]);
  });

  it("deduplicates multiple matching regressions for the same key", () => {
    const event = assistantEvent("body", { roomAgentId: "agent-a", agentTurnId: "turn-1" });
    const items: RenderItem[] = [
      { type: "event", event, leadingSubagents: [subagentStub()] },
      { type: "event", event: { ...event, id: "assistant-2" }, leadingSubagents: [subagentStub()] },
    ];
    const snapshots = findSubagentContentRegressionSnapshots(items, sessionStub());
    expect(snapshots).toHaveLength(2);
    expect(new Set(snapshots.map((s) => s.key)).size).toBe(1);
  });
});
