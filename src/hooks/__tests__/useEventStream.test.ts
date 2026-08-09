import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
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
import { deduplicateTimelineEvents } from "@/utils/eventMapper";
import {
  coalesceStreamEventBatch,
  commitActiveTurnDraftsToBatch,
  getStreamEventFlushDelay,
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

describe("getStreamEventFlushDelay", () => {
  it("slows pure tool progress without delaying assistant text or boundaries", () => {
    const base = { id: "e1", timestamp: 1 };
    const runningTool: TimelineEvent = {
      ...base,
      type: "tool_call",
      toolCallId: "t",
      toolName: "Read",
      status: "running",
      arguments: {},
    };
    expect(getStreamEventFlushDelay([runningTool], false)).toBe(500);
    expect(getStreamEventFlushDelay([assistant("正文")], false)).toBe(80);
    expect(getStreamEventFlushDelay([runningTool], true)).toBe(250);
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
    // 时间戳必须真实：草稿内容先于边界到达（残留提交场景），段才落在边界之前。
    applyActiveTurnDraftDelta(firstKey, assistant("你好", {
      timestamp: 1000,
      agentTurnId: "turn-local",
      roomAgentId: "agent-1",
      roomMessageId: "message-local",
    }) as Extract<TimelineEvent, { type: "assistant_message" }>);
    applyActiveTurnDraftDelta(secondKey, assistant("霖江路。我会补上焦点归还。", {
      timestamp: 2000,
      agentTurnId: "turn-official",
      roomAgentId: "agent-1",
      roomMessageId: "message-official",
    }) as Extract<TimelineEvent, { type: "assistant_message" }>);
    const boundary: TimelineEvent = {
      id: "tool-boundary",
      type: "tool_call",
      timestamp: 3000,
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

  it("keeps first-delta timestamp order when identity migration reorders the draft map", () => {
    const localKey = makeActiveTurnDraftKey("session-1", "agent-1", "turn-local");
    const officialKey = makeActiveTurnDraftKey("session-1", "agent-1", "turn-official");
    applyActiveTurnDraftDelta(localKey, assistant("你好", {
      timestamp: 1000,
      agentTurnId: "turn-local",
      roomAgentId: "agent-1",
      roomMessageId: "message-1",
    }) as Extract<TimelineEvent, { type: "assistant_message" }>);
    applyActiveTurnDraftDelta(officialKey, assistant("霖江路。我来查", {
      timestamp: 2000,
      agentTurnId: "turn-official",
      roomAgentId: "agent-1",
    }) as Extract<TimelineEvent, { type: "assistant_message" }>);
    // A later delta whose roomMessageId matches the local draft migrates it to a
    // third key, moving the OLDER draft to the drafts-map tail.
    const migratedKey = makeActiveTurnDraftKey("session-1", "agent-1", "turn-migrated");
    applyActiveTurnDraftDelta(migratedKey, assistant("", {
      timestamp: 3000,
      agentTurnId: "turn-migrated",
      roomAgentId: "agent-1",
      roomMessageId: "message-1",
    }) as Extract<TimelineEvent, { type: "assistant_message" }>);

    const batches = new Map<string, { roomId: string; roomAgentId: string; items: TimelineEvent[] }>();
    commitActiveTurnDraftsToBatch(batches);

    const items = batches.get(JSON.stringify(["session-1", "agent-1"]))?.items ?? [];
    expect(items.map((event) => (
      event.type === "assistant_message" ? event.content : event.type
    ))).toEqual(["你好", "霖江路。我来查"]);
  });

  it("never leapfrogs an older sibling draft when the commit is turn-filtered", () => {
    const localKey = makeActiveTurnDraftKey("session-1", "agent-1", "turn-local");
    const officialKey = makeActiveTurnDraftKey("session-1", "agent-1", "turn-official");
    applyActiveTurnDraftDelta(localKey, assistant("你好", {
      timestamp: 1000,
      agentTurnId: "turn-local",
      roomAgentId: "agent-1",
      roomMessageId: "message-local",
    }) as Extract<TimelineEvent, { type: "assistant_message" }>);
    applyActiveTurnDraftDelta(officialKey, assistant("霖江路。我来查", {
      timestamp: 2000,
      agentTurnId: "turn-official",
      roomAgentId: "agent-1",
      roomMessageId: "message-official",
    }) as Extract<TimelineEvent, { type: "assistant_message" }>);

    const batches = new Map<string, { roomId: string; roomAgentId: string; items: TimelineEvent[] }>();
    commitActiveTurnDraftsToBatch(batches, {
      sessionId: "session-1",
      roomAgentId: "agent-1",
      agentTurnId: "turn-official",
    });

    const items = batches.get(JSON.stringify(["session-1", "agent-1"]))?.items ?? [];
    expect(items.map((event) => (
      event.type === "assistant_message" ? event.content : event.type
    ))).toEqual(["你好", "霖江路。我来查"]);
    expect(getActiveTurnDraft(localKey)).toBeNull();
    expect(getActiveTurnDraft(officialKey)).toBeNull();
  });

  it("inserts draft segments behind an earlier formal assistant batch item", () => {
    const draftKey = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    applyActiveTurnDraftDelta(draftKey, assistant("霖江路。我来查", {
      timestamp: 2000,
      agentTurnId: "turn-1",
      roomAgentId: "agent-1",
    }) as Extract<TimelineEvent, { type: "assistant_message" }>);
    // A formal assistant frame arrived BEFORE the draft's first delta (e.g. the
    // first body delta carried no agentTurnId and took the formal path).
    const formal = assistant("你好", {
      id: "formal-early",
      timestamp: 1000,
      agentTurnId: "turn-0",
      roomAgentId: "agent-1",
    });
    const batchKey = JSON.stringify(["session-1", "agent-1"]);
    const batches = new Map<string, { roomId: string; roomAgentId: string; items: TimelineEvent[] }>([[batchKey, {
      roomId: "session-1",
      roomAgentId: "agent-1",
      items: [formal],
    }]]);

    commitActiveTurnDraftsToBatch(batches, {
      sessionId: "session-1",
      roomAgentId: "agent-1",
    });

    expect(batches.get(batchKey)?.items.map((event) => (
      event.type === "assistant_message" ? event.content : event.type
    ))).toEqual(["你好", "霖江路。我来查"]);
  });

  it("commits a draft segment AFTER deferred running tools that arrived earlier (no tool clump)", () => {
    // 现场（v2.20.208 截图）：running 工具帧是 deferrable，会在批次里堆积最多
    // 500ms；草稿段提交时若插到「首个非 assistant 项」之前，思考/正文段会跳到
    // 整串工具帧前面，连续段再被 mergeEvents 合并，多步工具粘成一张
    // 「N 个工具调用」卡、中间思考段只剩 teaser。官方 kimi-web 永不如此。
    const draftKey = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    const runningTool = (id: string, callId: string, timestamp: number): TimelineEvent => ({
      id,
      type: "tool_call",
      timestamp,
      toolCallId: callId,
      toolName: "Read",
      status: "running",
      arguments: {},
      roomAgentId: "agent-1",
      agentTurnId: "turn-1",
    });
    applyActiveTurnDraftDelta(draftKey, assistant("", {
      timestamp: 3000,
      thinking: "工具之后到达的思考",
      agentTurnId: "turn-1",
      roomAgentId: "agent-1",
    }) as Extract<TimelineEvent, { type: "assistant_message" }>);
    const batchKey = JSON.stringify(["session-1", "agent-1"]);
    const batches = new Map<string, { roomId: string; roomAgentId: string; items: TimelineEvent[] }>([[batchKey, {
      roomId: "session-1",
      roomAgentId: "agent-1",
      items: [runningTool("tool-1", "call-1", 1000), runningTool("tool-2", "call-2", 2000)],
    }]]);

    commitActiveTurnDraftsToBatch(batches, {
      sessionId: "session-1",
      roomAgentId: "agent-1",
      agentTurnId: "turn-1",
    });

    expect(batches.get(batchKey)?.items.map((event) => (
      event.type === "assistant_message" ? event.thinking : event.type
    ))).toEqual(["tool_call", "tool_call", "工具之后到达的思考"]);
  });

  it("keeps an earlier-arrived same-millisecond thinking segment ahead of its tool", () => {
    // 官方 wire 给思考段和随后的工具调用相同时间戳，线序是思考在前。
    const draftKey = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    const tool: TimelineEvent = {
      id: "tool-tie",
      type: "tool_call",
      timestamp: 3000,
      toolCallId: "call-tie",
      toolName: "Bash",
      status: "running",
      arguments: {},
      roomAgentId: "agent-1",
      agentTurnId: "turn-1",
    };
    applyActiveTurnDraftDelta(draftKey, assistant("", {
      timestamp: 3000,
      thinking: "同毫秒思考",
      agentTurnId: "turn-1",
      roomAgentId: "agent-1",
    }) as Extract<TimelineEvent, { type: "assistant_message" }>);
    const batchKey = JSON.stringify(["session-1", "agent-1"]);
    const batches = new Map<string, { roomId: string; roomAgentId: string; items: TimelineEvent[] }>([[batchKey, {
      roomId: "session-1",
      roomAgentId: "agent-1",
      items: [tool],
    }]]);

    commitActiveTurnDraftsToBatch(batches, {
      sessionId: "session-1",
      roomAgentId: "agent-1",
      agentTurnId: "turn-1",
    });

    expect(batches.get(batchKey)?.items.map((event) => (
      event.type === "assistant_message" ? event.thinking : event.type
    ))).toEqual(["同毫秒思考", "tool_call"]);
  });

  it("gives repeated materializations of one turn unique persisted ids", () => {
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    const materialize = (content: string, timestamp: number) => {
      applyActiveTurnDraftDelta(key, assistant(content, {
        timestamp,
        agentTurnId: "turn-1",
        roomAgentId: "agent-1",
      }) as Extract<TimelineEvent, { type: "assistant_message" }>);
      const batches = new Map<string, { roomId: string; roomAgentId: string; items: TimelineEvent[] }>();
      commitActiveTurnDraftsToBatch(batches, {
        sessionId: "session-1",
        roomAgentId: "agent-1",
        agentTurnId: "turn-1",
      });
      return batches.get(JSON.stringify(["session-1", "agent-1"]))!.items[0];
    };

    const interim = materialize("阶段性汇报", 1);
    const final = materialize("完整最终正文", 2);
    const hydrated = deduplicateTimelineEvents([interim, final]);

    expect(interim.id).not.toBe(final.id);
    expect(hydrated.map((event) => (
      event.type === "assistant_message" ? event.content : event.type
    ))).toEqual(["阶段性汇报", "完整最终正文"]);
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

describe("enqueueStreamEvent authoritative body frames", () => {
  beforeEach(() => {
    resetActiveTurnDraftStoreForTests();
    useSessionStore.setState({ sessions: [seedSession([])] });
  });

  afterEach(() => {
    resetActiveTurnDraftStoreForTests();
    useSessionStore.setState({ sessions: [] });
  });

  it("commits draft thinking ahead of a body-only authoritative frame instead of dropping it", () => {
    const { result, unmount } = renderHook(() => useEventStream());
    const draftKey = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");

    act(() => {
      result.current.enqueueStreamEvent("session-1", assistant("", {
        id: "think-delta-1",
        thinking: "最后一段思考",
      }));
    });
    expect(getActiveTurnDraft(draftKey)?.thinking).toBe("最后一段思考");

    // The final body frame owns the text but carries no thinking of its own.
    act(() => {
      result.current.enqueueStreamEvent("session-1", assistant("最终正文", {
        id: "final-body-1",
        isComplete: true,
      }));
    });

    const session = useSessionStore.getState().sessions[0];
    const assistants = session.events.filter((event) => event.type === "assistant_message") as Extract<TimelineEvent, { type: "assistant_message" }>[];
    expect(assistants.some((event) => (event.thinking ?? "").includes("最后一段思考"))).toBe(true);
    expect(assistants.some((event) => event.content.includes("最终正文"))).toBe(true);
    expect(getActiveTurnDraft(draftKey)).toBeNull();
    unmount();
  });

  it("atomically materializes the full offset stream before a content-less prompt completion", () => {
    useSessionStore.setState({ sessions: [seedSession([{
      id: "user-real-sequence",
      type: "user_message",
      timestamp: 1_000,
      content: "你好呀",
      roomAgentId: "agent-1",
      agentTurnId: "turn-1",
    }])] });
    const { result, unmount } = renderHook(() => useEventStream());
    const full = "你好！有什么我可以帮你的吗？比如写代码、查问题、处理文件，或者只是聊聊技术都行。";
    const chunks = [
      [0, 9], [9, 14], [14, 20], [20, 21], [21, 28], [28, 33], [33, 40],
    ] as const;

    act(() => {
      for (const [start, end] of chunks) {
        result.current.enqueueStreamEvent("session-1", assistant(full.slice(start, end), {
          id: `delta-${start}`,
          timestamp: 4_000,
          streamOffset: start,
          roomAgentId: "agent-1",
          agentTurnId: "turn-1",
        }));
      }
      result.current.enqueueStreamEvent("session-1", assistant("", {
        id: "prompt-completed",
        timestamp: 4_893,
        isComplete: true,
        roomAgentId: "agent-1",
        agentTurnId: "turn-1",
      }));
    });

    const assistants = useSessionStore.getState().sessions[0].events
      .filter((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => event.type === "assistant_message");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({ content: full, isComplete: true, durationMs: 3_893 });
    unmount();
  });

  it("does not let interleaved status flushes split an offset stream into tail fragments", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useEventStream());
    const draftKey = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    const full = "我是 Kimi Code，一个可以帮助你完成编程、分析和项目维护工作的 AI 助手。有什么我可以帮你的吗？";
    const chunks = [[0, 2], [2, 16], [16, 23], [23, 31], [31, 37], [37, 47], [47, 49], [49, 56], [56, 58], [58, 65], [65, 71], [71, 77], [77, 85], [85, 92], [92, full.length]] as const;

    for (const [start, end] of chunks) {
      act(() => {
        result.current.enqueueStreamEvent("session-1", assistant(full.slice(start, end), {
          id: `interleaved-delta-${start}`,
          streamOffset: start,
          roomAgentId: "agent-1",
          agentTurnId: "turn-1",
        }));
        result.current.enqueueStreamEvent("session-1", {
          id: `status-${start}`,
          type: "status_update",
          timestamp: Date.now(),
          message: "Context: 10%",
          roomAgentId: "agent-1",
          agentTurnId: "turn-1",
        });
        vi.advanceTimersByTime(100);
      });
    }

    expect(getActiveTurnDraft(draftKey)?.content).toBe(full);
    act(() => {
      result.current.enqueueStreamEvent("session-1", assistant("", {
        id: "interleaved-prompt-completed",
        isComplete: true,
        roomAgentId: "agent-1",
        agentTurnId: "turn-1",
      }));
    });
    const body = useSessionStore.getState().sessions[0].events
      .filter((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => event.type === "assistant_message")
      .map((event) => event.content)
      .join("");
    expect(body).toBe(full);
    unmount();
    vi.useRealTimers();
  });

  it("still drops the draft when the authoritative frame carries its own thinking", () => {
    const { result, unmount } = renderHook(() => useEventStream());
    const draftKey = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");

    act(() => {
      result.current.enqueueStreamEvent("session-1", assistant("", {
        id: "think-delta-1",
        thinking: "草稿思考",
      }));
    });
    act(() => {
      result.current.enqueueStreamEvent("session-1", assistant("最终正文", {
        id: "final-body-1",
        isComplete: true,
        thinking: "正式思考",
      }));
    });

    const session = useSessionStore.getState().sessions[0];
    const assistants = session.events.filter((event) => event.type === "assistant_message") as Extract<TimelineEvent, { type: "assistant_message" }>[];
    const joinedThinking = assistants.map((event) => event.thinking ?? "").join("\n");
    expect(joinedThinking).toContain("正式思考");
    expect(joinedThinking).not.toContain("草稿思考");
    expect(getActiveTurnDraft(draftKey)).toBeNull();
    unmount();
  });
});
