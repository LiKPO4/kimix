import { describe, expect, it } from "vitest";
import type { Session, TimelineEvent } from "@/types/ui";
import {
  buildContentVersion,
  buildRenderItems,
  buildSubagentRegressionDiagnosticData,
  findSubagentContentRegressionSnapshots,
  shouldRetryAsRoomDelivery,
} from "@/components/chat/ChatThread";
import type { CompletedTurnRenderCacheEntry, RenderItem } from "@/types/chatRender";

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

describe("shouldRetryAsRoomDelivery", () => {
  const scopedError: Extract<TimelineEvent, { type: "error" }> = {
    id: "error-1",
    type: "error",
    timestamp: 1,
    message: "Kimi Server WebSocket 已关闭",
    roomMessageId: "room-message-1",
    roomAgentId: "room-agent-1",
  };

  it("does not treat scoped metadata as proof of a collaboration room", () => {
    expect(shouldRetryAsRoomDelivery(false, scopedError)).toBe(false);
  });

  it("uses room delivery retry only for a real collaboration room", () => {
    expect(shouldRetryAsRoomDelivery(true, scopedError)).toBe(true);
  });
});

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

describe("question_request folding", () => {
  it("folds a resolved question into the assistant turn blocks instead of a standalone row", () => {
    const question = (id: string, status: "pending" | "answered", timestamp: number): TimelineEvent => ({
      id,
      type: "question_request",
      timestamp,
      requestId: id,
      rpcRequestId: `${id}-rpc`,
      toolCallId: "call-q",
      questions: [{ id: "q1", question: "反噬打谁？", options: [] }],
      status,
    });
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "改 bug" } as TimelineEvent,
      assistantEvent("先分析", { id: "assistant-1", timestamp: 2 }),
      question("q-resolved", "answered", 3),
      question("q-pending", "pending", 4),
    ];
    const items = buildRenderItems(events, "kimi-code");
    const questionRows = items.filter((item) => item.type === "event" && item.event.type === "question_request");
    // 已回答的提问折进过程流，只有待回答的保持独立可交互卡片。
    expect(questionRows.map((item) => (item.type === "event" ? item.event.id : ""))).toEqual(["q-pending"]);
    const assistantItem = items.find((item) => item.type === "event" && item.event.type === "assistant_message");
    const blocks = assistantItem?.type === "event" ? assistantItem.turnBlocks : undefined;
    expect(blocks?.some((block) => block.kind === "question" && block.question.id === "q-resolved")).toBe(true);
    expect(blocks?.some((block) => block.kind === "question" && block.question.id === "q-pending")).toBe(false);
  });
});

describe("buildRenderItems steer split", () => {
  const PRE_BODY = "第一轮正文完整段落，长度足够让 steer 成为轮间边界。";
  const POST_BODY = "引导后的第二轮正文，同样具备足够长度。";

  const steerSplitEvents = (): TimelineEvent[] => [
    { id: "user-1", type: "user_message", timestamp: 1, content: "原始问题", agentTurnId: "turn-1" } as TimelineEvent,
    assistantEvent(PRE_BODY, { id: "a-pre", timestamp: 2, agentTurnId: "turn-1", isComplete: true }),
    { id: "steer-1", type: "steer_message", timestamp: 3, content: "补充引导", status: "sent", agentTurnId: "turn-1" } as TimelineEvent,
    assistantEvent(POST_BODY, { id: "a-post", timestamp: 4, agentTurnId: "turn-1", isComplete: true }),
  ];

  const assistantItems = (items: RenderItem[]) => items.filter((item) => item.type === "event" && item.event.type === "assistant_message");

  it("splits the turn around the steer bubble, each body rendered exactly once", () => {
    const items = buildRenderItems(steerSplitEvents(), "kimi-code");
    // 顺序：user → 前段轮 → steer 气泡 → 后段轮
    const kinds = items.map((item) => (item.type === "event" ? item.event.type : item.type));
    expect(kinds).toEqual(["user_message", "assistant_message", "steer_message", "assistant_message"]);
    const bubbles = assistantItems(items);
    expect(JSON.stringify(bubbles[0])).toContain(PRE_BODY);
    expect(JSON.stringify(bubbles[1])).toContain(POST_BODY);
    expect(JSON.stringify(bubbles[0])).not.toContain(POST_BODY);
    expect(JSON.stringify(bubbles[1])).not.toContain(PRE_BODY);
  });

  it("caches pre- and post-steer segments under distinct keys and hits both on re-render (A5)", () => {
    const events = steerSplitEvents();
    const cache = new Map<string, CompletedTurnRenderCacheEntry>();
    const first = buildRenderItems(events, "kimi-code", undefined, false, undefined, cache);
    // 修复前两段轮共享一个 key 互相覆盖，size 恒为 1 且每遍双方都不命中。
    expect(cache.size).toBe(2);

    const second = buildRenderItems(events, "kimi-code", undefined, false, undefined, cache);
    expect(second).toEqual(first);
    // 缓存命中的证据：第二遍产出的轮条目与缓存内条目是同一对象引用（未重渲染）。
    const cachedItemRefs = new Set([...cache.values()].flatMap((entry) => entry.items));
    const secondBubbles = assistantItems(second);
    expect(secondBubbles.length).toBeGreaterThan(0);
    for (const bubble of secondBubbles) expect(cachedItemRefs.has(bubble)).toBe(true);
  });

  it("dedups a reconnect replay of the post-steer body without losing it", () => {
    // 重连重放：官方 resync 把后段正文以新事件 id 再投一次。turnBlocks 去重
    // （含 A3 反序升级）后仍只渲染一次，且内容不丢。
    const events = [
      ...steerSplitEvents(),
      assistantEvent(POST_BODY, { id: "a-post-replay", timestamp: 5, agentTurnId: "turn-1", isComplete: true }),
    ];
    const items = buildRenderItems(events, "kimi-code");
    const bubbles = assistantItems(items);
    expect(bubbles).toHaveLength(2);
    const postBubble = bubbles[1];
    const postBlocks = postBubble.type === "event" ? postBubble.turnBlocks : undefined;
    const textBlocks = (postBlocks ?? []).filter((block) => block.kind === "text" && block.content.includes(POST_BODY));
    expect(textBlocks).toHaveLength(1);
  });
});
