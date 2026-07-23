import { describe, expect, it, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Session, TimelineEvent } from "@/types/ui";
import { useSessionStore } from "@/stores/sessionStore";
import {
  applyActiveTurnDraftDelta,
  getActiveTurnDraft,
  listActiveTurnDraftKeys,
  makeActiveTurnDraftKey,
  resetActiveTurnDraftStoreForTests,
} from "@/utils/activeTurnDraftStore";
import {
  coalesceStreamEventBatch,
  commitActiveTurnDraftsToBatch,
  hasSubagentEventScope,
  isDeferrableStreamEvent,
  useEventStream,
} from "../useEventStream";

function assistant(content: string, patch: Partial<Extract<TimelineEvent, { type: "assistant_message" }>> = {}): TimelineEvent {
  return {
    id: patch.id ?? crypto.randomUUID(),
    type: "assistant_message",
    timestamp: patch.timestamp ?? Date.now(),
    content,
    thinking: patch.thinking,
    thinkingParts: patch.thinkingParts,
    isThinking: patch.isThinking ?? false,
    isComplete: patch.isComplete ?? false,
    agentTurnId: patch.agentTurnId ?? "turn-1",
    roomAgentId: patch.roomAgentId ?? "agent-1",
    ...patch,
  };
}

describe("isDeferrableStreamEvent", () => {
  it("defers informational high-frequency events but not true boundaries", () => {
    const base = { id: "e1", timestamp: 1 };
    expect(isDeferrableStreamEvent({ ...base, type: "assistant_message", content: "a", isThinking: false, isComplete: false })).toBe(true);
    expect(isDeferrableStreamEvent({ ...base, type: "assistant_message", content: "a", isThinking: false, isComplete: true })).toBe(false);
    expect(isDeferrableStreamEvent({ ...base, type: "status_update", message: "Context: 50%" })).toBe(true);
    expect(isDeferrableStreamEvent({ ...base, type: "subagent", agentName: "w", status: "running", events: [] })).toBe(true);
    expect(isDeferrableStreamEvent({ ...base, type: "subagent", agentName: "w", status: "completed", events: [] })).toBe(false);
    // streaming tool-call arguments batch; completion stays immediate
    expect(isDeferrableStreamEvent({ ...base, type: "tool_call", toolCallId: "t", toolName: "Bash", status: "running", arguments: {} })).toBe(true);
    expect(isDeferrableStreamEvent({ ...base, type: "tool_call", toolCallId: "t", toolName: "Bash", status: "completed", arguments: {} })).toBe(false);
    expect(isDeferrableStreamEvent({ ...base, type: "approval_request", requestId: "r", toolName: "Bash", description: "d", details: "x", riskLevel: "low", status: "pending" })).toBe(false);
    expect(isDeferrableStreamEvent({ ...base, type: "error", message: "x" })).toBe(false);
  });
});

describe("coalesceStreamEventBatch", () => {
  it("combines adjacent assistant text and thinking deltas", () => {
    const result = coalesceStreamEventBatch([
      assistant("第一段", { thinking: "先想" }),
      assistant("第二段", { thinking: "再想" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "assistant_message",
      content: "第一段第二段",
      thinking: "先想再想",
      isComplete: false,
    });
  });

  it("never coalesces history replay from different stable snapshot messages", () => {
    const result = coalesceStreamEventBatch([
      assistant("第一条官方回复", {
        snapshotMessageId: "msg-000048",
        snapshotMessageIdStable: true,
      }),
      assistant("第二条官方回复", {
        snapshotMessageId: "msg-000051",
        snapshotMessageIdStable: true,
      }),
    ]);

    expect(result).toHaveLength(2);
    expect(result).toEqual([
      expect.objectContaining({ content: "第一条官方回复", snapshotMessageId: "msg-000048" }),
      expect.objectContaining({ content: "第二条官方回复", snapshotMessageId: "msg-000051" }),
    ]);
  });

  it("keeps terminal, tool-boundary, and different-turn events independent", () => {
    const tool: TimelineEvent = {
      id: "tool-1",
      type: "tool_call",
      timestamp: 3,
      toolCallId: "call-1",
      toolName: "Shell",
      status: "running",
      arguments: {},
      roomAgentId: "agent-1",
      agentTurnId: "turn-1",
    };
    const result = coalesceStreamEventBatch([
      assistant("A", { timestamp: 1 }),
      assistant("", { timestamp: 2, isComplete: true }),
      tool,
      assistant("B", { timestamp: 4 }),
      assistant("C", { timestamp: 5, agentTurnId: "turn-2" }),
    ]);

    expect(result).toHaveLength(5);
    expect(result.map((event) => event.type)).toEqual([
      "assistant_message",
      "assistant_message",
      "tool_call",
      "assistant_message",
      "assistant_message",
    ]);
  });
});

describe("commitActiveTurnDraftsToBatch", () => {
  beforeEach(() => {
    resetActiveTurnDraftStoreForTests();
  });

  it("materializes draft text ahead of a boundary event", () => {
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    applyActiveTurnDraftDelta(key, assistant("流式正文", { agentTurnId: "turn-1", roomAgentId: "agent-1" }) as Extract<TimelineEvent, { type: "assistant_message" }>);
    const batches = new Map<string, { roomId: string; roomAgentId: string; items: TimelineEvent[] }>();
    commitActiveTurnDraftsToBatch(batches, {
      sessionId: "session-1",
      roomAgentId: "agent-1",
      agentTurnId: "turn-1",
    });

    const batch = batches.get(JSON.stringify(["session-1", "agent-1"]));
    expect(batch?.items).toHaveLength(1);
    expect(batch?.items[0]).toMatchObject({
      type: "assistant_message",
      content: "流式正文",
      isComplete: false,
      agentTurnId: "turn-1",
    });
    expect(getActiveTurnDraft(key)).toBeNull();
  });

  it("preserves draft arrival order when more than one identity is committed to one batch", () => {
    const firstKey = makeActiveTurnDraftKey("session-1", "agent-1", "turn-local");
    const secondKey = makeActiveTurnDraftKey("session-1", "agent-1", "turn-official");
    applyActiveTurnDraftDelta(firstKey, assistant("你好", {
      agentTurnId: "turn-local",
      roomAgentId: "agent-1",
      roomMessageId: "message-local",
    }) as Extract<TimelineEvent, { type: "assistant_message" }>);
    applyActiveTurnDraftDelta(secondKey, assistant("霖江路。我会补上焦点归还。", {
      agentTurnId: "turn-official",
      roomAgentId: "agent-1",
      roomMessageId: "message-official",
    }) as Extract<TimelineEvent, { type: "assistant_message" }>);
    const boundary: TimelineEvent = {
      id: "tool-boundary",
      type: "tool_call",
      timestamp: 3,
      toolCallId: "call-1",
      toolName: "Edit",
      status: "running",
      arguments: {},
      roomAgentId: "agent-1",
      agentTurnId: "turn-official",
    };
    const batchKey = JSON.stringify(["session-1", "agent-1"]);
    const batches = new Map<string, { roomId: string; roomAgentId: string; items: TimelineEvent[] }>([[batchKey, {
      roomId: "session-1",
      roomAgentId: "agent-1",
      items: [boundary],
    }]]);

    commitActiveTurnDraftsToBatch(batches, {
      sessionId: "session-1",
      roomAgentId: "agent-1",
    });

    expect(batches.get(batchKey)?.items.map((event) => (
      event.type === "assistant_message" ? event.content : event.type
    ))).toEqual(["你好", "霖江路。我会补上焦点归还。", "tool_call"]);
  });
});

function renderHook<T>(callback: () => T) {
  const result = { current: null as unknown as T };
  function Wrapper() {
    result.current = callback();
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(Wrapper));
  });
  return {
    result,
    unmount() {
      act(() => {
        root.unmount();
      });
    },
  };
}

function subagentCard(agentId: string): TimelineEvent {
  return {
    id: `card-${agentId}`,
    type: "subagent",
    timestamp: 1,
    agentId,
    agentName: "explore",
    status: "running",
    events: [],
  };
}

function seedSession(events: TimelineEvent[]): Session {
  return {
    id: "session-1",
    engine: "kimi-code",
    title: "Swarm",
    projectPath: "D:/WORKS/test",
    createdAt: 1,
    updatedAt: 1,
    events,
    isLoading: false,
  } as Session;
}

describe("hasSubagentEventScope", () => {
  it("detects subagent-scoped events and exempts the main agent", () => {
    expect(hasSubagentEventScope(assistant("x", { agentId: "sub-1" }))).toBe(true);
    expect(hasSubagentEventScope(assistant("x", { agentId: "main" }))).toBe(false);
    expect(hasSubagentEventScope(assistant("x"))).toBe(false);
    expect(hasSubagentEventScope({ id: "s", type: "status_update", timestamp: 1, message: "m" })).toBe(false);
  });
});

describe("enqueueStreamEvent subagent scope attribution", () => {
  beforeEach(() => {
    resetActiveTurnDraftStoreForTests();
    useSessionStore.setState({ sessions: [seedSession([subagentCard("sub-1")])] });
  });

  afterEach(() => {
    resetActiveTurnDraftStoreForTests();
    useSessionStore.setState({ sessions: [] });
  });

  it("keeps subagent deltas out of the main turn draft (same agentTurnId key collision)", () => {
    const { result, unmount } = renderHook(() => useEventStream());
    const mainKey = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");

    act(() => {
      result.current.enqueueStreamEvent("session-1", assistant("你好", { id: "main-delta-1" }));
    });
    expect(getActiveTurnDraft(mainKey)?.content).toBe("你好");

    // Subagent delta inheriting the MAIN turn identity (App.tsx stamps the room
    // activity's activeTurnId onto every live delta). Pre-fix this appended the
    // subagent text into the main draft in arrival order.
    act(() => {
      result.current.enqueueStreamEvent("session-1", assistant("子代理输出", {
        id: "sub-delta-1",
        agentId: "sub-1",
      }));
    });

    expect(getActiveTurnDraft(mainKey)?.content).toBe("你好");
    expect(listActiveTurnDraftKeys()).toEqual([mainKey]);

    act(() => {
      result.current.flushStreamEvents();
    });
    const session = useSessionStore.getState().sessions[0];
    const card = session.events.find((event) => event.type === "subagent") as Extract<TimelineEvent, { type: "subagent" }>;
    expect(card.events.some((event) => event.type === "assistant_message" && event.content.includes("子代理输出"))).toBe(true);
    const mainAssistant = session.events.find((event) => event.type === "assistant_message") as Extract<TimelineEvent, { type: "assistant_message" }> | undefined;
    expect(mainAssistant?.content ?? "").not.toContain("子代理输出");
    unmount();
  });

  it("does not clear the main turn draft on a subagent authoritative frame", () => {
    const { result, unmount } = renderHook(() => useEventStream());

    act(() => {
      result.current.enqueueStreamEvent("session-1", assistant("你好", { id: "main-delta-1" }));
    });
    // Subagent completes with a full body while the main turn is still streaming.
    // Pre-fix this was treated as authoritative for the SHARED draft key and
    // cleared the main turn's buffered text, permanently dropping "你好".
    // (A complete frame flushes immediately, which legitimately COMMITS the main
    // draft into the timeline — the regression is the draft being CLEARED.)
    act(() => {
      result.current.enqueueStreamEvent("session-1", assistant("子代理最终答复", {
        id: "sub-final-1",
        agentId: "sub-1",
        isComplete: true,
      }));
    });

    const session = useSessionStore.getState().sessions[0];
    const mainAssistant = session.events.find((event) => event.type === "assistant_message") as Extract<TimelineEvent, { type: "assistant_message" }> | undefined;
    expect(mainAssistant?.content).toContain("你好");
    expect(mainAssistant?.content).not.toContain("子代理最终答复");
    const card = session.events.find((event) => event.type === "subagent") as Extract<TimelineEvent, { type: "subagent" }>;
    expect(card.events.some((event) => event.type === "assistant_message" && event.content.includes("子代理最终答复"))).toBe(true);
    unmount();
  });
});
