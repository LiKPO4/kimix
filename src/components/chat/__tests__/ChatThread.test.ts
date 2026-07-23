import { describe, expect, it } from "vitest";
import type { Session, TimelineEvent } from "@/types/ui";
import { buildContentVersion, buildRenderItems, buildSubagentRegressionDiagnosticData, findSubagentContentRegressionSnapshots } from "@/components/chat/ChatThread";
import type { RenderItem } from "@/types/chatRender";

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

describe("buildSubagentRegressionDiagnosticData", () => {
  it("exports only structural metadata by default", () => {
    Object.defineProperty(window, "api", {
      value: { detailedDiagnosticsEnabled: false },
      configurable: true,
    });
    const sourceEvents = [assistantEvent("private body"), subagentStub()];
    const data = buildSubagentRegressionDiagnosticData({
      key: "k",
      sessionId: "session-1",
      eventId: "assistant-1",
      topLevelAssistantSize: 12,
      sourceEvents,
    });
    expect(data).toMatchObject({
      sourceEventCount: 2,
      sourceEventTypes: { assistant_message: 1, subagent: 1 },
    });
    expect(data).not.toHaveProperty("snapshot");
  });

  it("includes the bounded event snapshot only after explicit opt-in", () => {
    Object.defineProperty(window, "api", {
      value: { detailedDiagnosticsEnabled: true },
      configurable: true,
    });
    const data = buildSubagentRegressionDiagnosticData({
      key: "k",
      sessionId: "session-1",
      eventId: "assistant-1",
      topLevelAssistantSize: 12,
      sourceEvents: [assistantEvent("private body")],
    });
    expect(data).toHaveProperty("snapshot", expect.stringContaining("private body"));
  });
});

describe("buildContentVersion", () => {
  it("includes session, timeline length, render items length and last item key", () => {
    const session = sessionStub([assistantEvent("hello")]);
    const event = assistantEvent("hello", { id: "assistant-1" });
    const items: RenderItem[] = [{ type: "event", event }];
    expect(buildContentVersion(session, session.events, items)).toMatch(
      /^session-1:0:1:1:assistant-1:5:0:e\d+$/
    );
  });

  it("changes when the last assistant message content grows", () => {
    const session = sessionStub();
    const base = assistantEvent("hi", { id: "assistant-1", isComplete: false });
    const itemsBefore: RenderItem[] = [{ type: "event", event: base }];
    const itemsAfter: RenderItem[] = [{ type: "event", event: { ...base, content: "hi there" } }];
    const before = buildContentVersion(session, session.events, itemsBefore);
    const after = buildContentVersion(session, session.events, itemsAfter);
    expect(after).not.toBe(before);
  });

  it("changes when the last assistant message thinking grows", () => {
    const session = sessionStub();
    const base = assistantEvent("", { id: "assistant-1", isComplete: false, isThinking: true });
    const itemsBefore: RenderItem[] = [{ type: "event", event: { ...base, thinking: "t" } }];
    const itemsAfter: RenderItem[] = [{ type: "event", event: { ...base, thinking: "thought" } }];
    const before = buildContentVersion(session, session.events, itemsBefore);
    const after = buildContentVersion(session, session.events, itemsAfter);
    expect(after).not.toBe(before);
  });

  it("changes when renderItems length changes even if timeline length stays the same", () => {
    const session = sessionStub([assistantEvent("hello", { id: "a" }), assistantEvent("world", { id: "b" })]);
    const singleItem: RenderItem[] = [{ type: "event", event: session.events[0] as Extract<TimelineEvent, { type: "assistant_message" }> }];
    const twoItems: RenderItem[] = [
      { type: "event", event: session.events[0] as Extract<TimelineEvent, { type: "assistant_message" }> },
      { type: "event", event: session.events[1] as Extract<TimelineEvent, { type: "assistant_message" }> },
    ];
    const before = buildContentVersion(session, session.events, singleItem);
    const after = buildContentVersion(session, session.events, twoItems);
    expect(after).not.toBe(before);
  });

  it("changes when same-length assistant content is corrected with a new event object", () => {
    const session = sessionStub();
    const beforeEvent = assistantEvent("abc", { id: "assistant-1" });
    const afterEvent = { ...beforeEvent, content: "xyz" };
    expect(buildContentVersion(session, [], [{ type: "event", event: beforeEvent }])).not.toBe(
      buildContentVersion(session, [], [{ type: "event", event: afterEvent }]),
    );
  });

  it("changes when a non-last rendered event object changes", () => {
    const session = sessionStub();
    const first = assistantEvent("first", { id: "assistant-1" });
    const last = assistantEvent("last", { id: "assistant-2" });
    const before: RenderItem[] = [{ type: "event", event: first }, { type: "event", event: last }];
    const after: RenderItem[] = [{ type: "event", event: { ...first, thinkingParts: [{ id: "p", timestamp: 1, text: "updated" }] } }, { type: "event", event: last }];
    expect(buildContentVersion(session, [], before)).not.toBe(buildContentVersion(session, [], after));
  });

  it("stays stable for identical inputs", () => {
    const session = sessionStub([assistantEvent("hello")]);
    const items: RenderItem[] = [{ type: "event", event: session.events[0] as Extract<TimelineEvent, { type: "assistant_message" }> }];
    expect(buildContentVersion(session, session.events, items)).toBe(buildContentVersion(session, session.events, items));
  });
});

describe("buildRenderItems turn metrics", () => {
  it("does not render a context-only recovery snapshot as an Assistant footer", () => {
    const items = buildRenderItems([{
      id: "user", type: "user_message", timestamp: 1, content: "retry",
    }, assistantEvent("done", { timestamp: 2 }), {
      id: "context", type: "status_update", timestamp: 3,
      contextSize: 101_116, contextLimit: 500_000,
    }], "kimi-code");
    const assistantItem = items.find((item) => item.type === "event" && item.event.type === "assistant_message");

    expect(assistantItem?.type === "event" ? assistantItem.trailingStatuses : undefined).toEqual([]);
  });

  it("merges a later context update into real usage from the same turn", () => {
    const items = buildRenderItems([{
      id: "user", type: "user_message", timestamp: 1, content: "normal",
    }, assistantEvent("done", { timestamp: 2 }), {
      id: "usage", type: "status_update", timestamp: 3,
      message: "模型：grok-4.5", inputTokenCount: 136_110, tokenCount: 1_220,
    }, {
      id: "context", type: "status_update", timestamp: 4,
      contextSize: 101_116, contextLimit: 500_000,
    }], "kimi-code");
    const assistantItem = items.find((item) => item.type === "event" && item.event.type === "assistant_message");
    const status = assistantItem?.type === "event" ? assistantItem.trailingStatuses?.[0] : undefined;

    expect(status).toMatchObject({
      id: "context",
      message: "模型：grok-4.5",
      inputTokenCount: 136_110,
      tokenCount: 1_220,
      contextSize: 101_116,
      contextLimit: 500_000,
    });
  });

  it("surfaces model-only footer before usage.record arrives for room agents", () => {
    const items = buildRenderItems([{
      id: "user",
      type: "user_message",
      timestamp: 1,
      content: "explore",
      roomAgentId: "room-1",
      agentTurnId: "turn-1",
    }, {
      id: "assistant-1",
      type: "assistant_message",
      timestamp: 2,
      content: "done",
      isThinking: false,
      isComplete: true,
      model: "kimi-code/k3",
      roomAgentId: "room-1",
      agentTurnId: "turn-1",
    }], "kimi-code");
    const assistantItem = items.find((item) => item.type === "event" && item.event.type === "assistant_message");
    const trailing = assistantItem?.type === "event" ? assistantItem.trailingStatuses : undefined;
    expect(trailing?.[0]).toMatchObject({
      message: "模型：kimi-code/k3",
    });
  });
});
