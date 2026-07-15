import { describe, expect, it } from "vitest";
import { buildRenderItems, filterStatusUpdates } from "@/components/chat/ChatThread";
import { assistantFooterFallbackLabel, timelineEventMemoKey } from "@/components/chat/MessageBubble";
import { createSubagentOnlyAssistantEvent, createToolOnlyAssistantEvent } from "../chatRenderItems";
import type { TimelineEvent, ToolCallEvent } from "@/types/ui";

describe("createToolOnlyAssistantEvent", () => {
  it("creates a completed assistant header for pure completed tool turns", () => {
    const tools: ToolCallEvent[] = [
      {
        id: "tool-1",
        type: "tool_call",
        timestamp: 2,
        toolCallId: "call-1",
        toolName: "UpdateGoal",
        status: "success",
        arguments: { status: "complete" },
        rawArguments: "{\"status\":\"complete\"}",
        result: "Goal marked complete.",
      },
    ];

    const event = createToolOnlyAssistantEvent(tools);
    expect(event.type).toBe("assistant_message");
    expect(event.id).toBe("assistant-tools-tool-1");
    expect(event.content).toBe("");
    expect(event.isComplete).toBe(true);
  });

  it("keeps the assistant header active while any tool is running", () => {
    const event = createToolOnlyAssistantEvent([
      {
        id: "tool-1",
        type: "tool_call",
        timestamp: 1,
        toolCallId: "call-1",
        toolName: "UpdateGoal",
        status: "running",
        arguments: {},
      },
    ]);

    expect(event.isComplete).toBe(false);
  });
});

describe("createSubagentOnlyAssistantEvent", () => {
  it("keeps the assistant header active while any subagent is active", () => {
    const subagents: Extract<TimelineEvent, { type: "subagent" }>[] = [
      {
        id: "agent-1",
        type: "subagent",
        timestamp: 3,
        agentName: "worker",
        status: "running",
        events: [],
      },
      {
        id: "agent-2",
        type: "subagent",
        timestamp: 4,
        agentName: "worker",
        status: "completed",
        events: [],
      },
    ];

    const event = createSubagentOnlyAssistantEvent(subagents);
    expect(event.type).toBe("assistant_message");
    expect(event.id).toBe("assistant-subagents-agent-1:agent-2");
    expect(event.content).toBe("");
    expect(event.isComplete).toBe(false);
  });

  it("creates a completed assistant header when all subagents are settled", () => {
    const event = createSubagentOnlyAssistantEvent([
      {
        id: "agent-1",
        type: "subagent",
        timestamp: 5,
        agentName: "worker",
        status: "completed",
        events: [],
      },
    ]);

    expect(event.isComplete).toBe(true);
  });

  it("surfaces assistant content from subagent events when the main timeline has none", () => {
    const subagents: Extract<TimelineEvent, { type: "subagent" }>[] = [
      {
        id: "agent-1",
        type: "subagent",
        timestamp: 1,
        agentId: "a1",
        agentName: "coder",
        status: "completed",
        events: [
          { id: "a1", type: "assistant_message", timestamp: 2, content: "剩余小债务", isThinking: false, isComplete: true },
        ],
      },
    ];
    const event = createSubagentOnlyAssistantEvent(subagents);
    expect(event.content).toBe("剩余小债务");
    expect(event.isComplete).toBe(true);
  });

  it("joins content from multiple subagent assistant messages", () => {
    const subagents: Extract<TimelineEvent, { type: "subagent" }>[] = [
      {
        id: "s1",
        type: "subagent",
        timestamp: 1,
        agentId: "a1",
        agentName: "coder",
        status: "completed",
        events: [
          { id: "a1", type: "assistant_message", timestamp: 2, content: "第一部分", isThinking: false, isComplete: true },
          { id: "a2", type: "assistant_message", timestamp: 3, content: "第二部分", isThinking: false, isComplete: true },
        ],
      },
    ];
    const event = createSubagentOnlyAssistantEvent(subagents);
    expect(event.content).toBe("第一部分\n\n第二部分");
  });

  it("collects thinking from subagent events", () => {
    const subagents: Extract<TimelineEvent, { type: "subagent" }>[] = [
      {
        id: "s1",
        type: "subagent",
        timestamp: 1,
        agentId: "a1",
        agentName: "coder",
        status: "completed",
        events: [
          { id: "a1", type: "assistant_message", timestamp: 2, content: "", thinking: "思考内容", isThinking: false, isComplete: true },
        ],
      },
    ];
    const event = createSubagentOnlyAssistantEvent(subagents);
    expect(event.thinking).toBe("思考内容");
  });

  it("collects content from nested subagent events", () => {
    const subagents: Extract<TimelineEvent, { type: "subagent" }>[] = [
      {
        id: "s1",
        type: "subagent",
        timestamp: 1,
        agentId: "a1",
        agentName: "coder",
        status: "completed",
        events: [
          {
            id: "s2",
            type: "subagent",
            timestamp: 2,
            agentId: "a2",
            agentName: "reviewer",
            status: "completed",
            events: [
              { id: "a2", type: "assistant_message", timestamp: 3, content: "嵌套子代理正文", isThinking: false, isComplete: true },
            ],
          },
        ],
      },
    ];
    const event = createSubagentOnlyAssistantEvent(subagents);
    expect(event.content).toBe("嵌套子代理正文");
  });

  it("collects thinking from thinkingParts when thinking field is empty", () => {
    const subagents: Extract<TimelineEvent, { type: "subagent" }>[] = [
      {
        id: "s1",
        type: "subagent",
        timestamp: 1,
        agentId: "a1",
        agentName: "coder",
        status: "completed",
        events: [
          {
            id: "a1",
            type: "assistant_message",
            timestamp: 2,
            content: "",
            thinking: "",
            thinkingParts: [{ id: "tp1", timestamp: 2, text: "分段思考", signature: "sig1" }],
            isThinking: false,
            isComplete: true,
          },
        ],
      },
    ];
    const event = createSubagentOnlyAssistantEvent(subagents);
    expect(event.thinking).toBe("分段思考");
  });
});

describe("buildRenderItems compaction placement", () => {
  it("places a completed pre-turn compaction between the user and assistant even when it arrived after assistant output", () => {
    const events: TimelineEvent[] = [{
      id: "user",
      type: "user_message",
      timestamp: 1,
      content: "继续处理",
    }, {
      id: "assistant",
      type: "assistant_message",
      timestamp: 3,
      content: "开始回复",
      isThinking: false,
      isComplete: true,
    }, {
      id: "compaction",
      type: "compaction",
      timestamp: 2,
      phase: "end",
      summary: "保留用户目标。",
    }];

    const renderedTypes = buildRenderItems(events, "kimi-code").map((item) => (
      item.type === "event" ? item.event.type : item.type
    ));
    expect(renderedTypes).toEqual(["user_message", "compaction", "assistant_message"]);
  });
});

describe("buildRenderItems usage footer", () => {
  const events: TimelineEvent[] = [{
    id: "user", type: "user_message", timestamp: 1, content: "继续处理",
  }, {
    id: "assistant", type: "assistant_message", timestamp: 2, content: "阶段性回复", isThinking: false, isComplete: true,
  }, {
    id: "usage-1", type: "status_update", timestamp: 3, inputTokenCount: 100, tokenCount: 20,
  }, {
    id: "usage-2", type: "status_update", timestamp: 4, inputTokenCount: 120, tokenCount: 30,
  }];

  it("hides interim usage while the latest runtime turn is still active", () => {
    const assistant = buildRenderItems(events, "kimi-code", undefined, true)
      .find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistant?.type).toBe("event");
    if (assistant?.type !== "event") return;
    expect(assistant.trailingStatuses).toEqual([]);
    expect(assistant.event.type === "assistant_message" && assistant.event.isComplete).toBe(false);
  });

  it("keeps a successful tool-only latest turn active while the runtime is still running", () => {
    const items = buildRenderItems([{
      id: "user-tool-only",
      type: "user_message",
      timestamp: 1,
      content: "检查代码",
    }, {
      id: "tool-only",
      type: "tool_call",
      timestamp: 2,
      toolCallId: "tool-only",
      toolName: "Read",
      status: "success",
      arguments: {},
    }], "kimi-code", undefined, true);
    const assistant = items.find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistant?.type).toBe("event");
    if (assistant?.type !== "event" || assistant.event.type !== "assistant_message") return;
    expect(assistant.event.isComplete).toBe(false);
  });

  it("shows only the final usage after the runtime turn settles", () => {
    const assistant = buildRenderItems(events, "kimi-code", undefined, false)
      .find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistant?.type).toBe("event");
    if (assistant?.type !== "event") return;
    expect(assistant.trailingStatuses?.map((status) => status.id)).toEqual(["usage-2"]);
  });

  it("keeps final usage when a generic completed status arrives afterwards", () => {
    const items = buildRenderItems([...events, {
      id: "completed-late",
      type: "status_update",
      timestamp: 5,
      message: "已完成",
    }], "kimi-code", undefined, false);
    const assistant = items.find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistant?.type).toBe("event");
    if (assistant?.type !== "event") return;
    expect(assistant.trailingStatuses?.map((status) => status.id)).toEqual(["usage-2"]);
  });
});

describe("buildRenderItems completed turn cache", () => {
  it("reuses a completed Assistant render item while rebuilding the active turn", () => {
    const completedUser: TimelineEvent = { id: "user-1", type: "user_message", timestamp: 1, content: "第一轮" };
    const completedAssistant: TimelineEvent = { id: "assistant-1", type: "assistant_message", timestamp: 2, content: "稳定正文", isThinking: false, isComplete: true };
    const activeUser: TimelineEvent = { id: "user-2", type: "user_message", timestamp: 3, content: "第二轮" };
    const activeAssistant: TimelineEvent = { id: "assistant-2", type: "assistant_message", timestamp: 4, content: "流式", isThinking: false, isComplete: false };
    const cache = new Map();
    const first = buildRenderItems([completedUser, completedAssistant, activeUser, activeAssistant], "kimi-code", undefined, true, undefined, cache);
    const updatedActiveAssistant: TimelineEvent = { ...activeAssistant, content: "流式增长" };
    const second = buildRenderItems([completedUser, completedAssistant, activeUser, updatedActiveAssistant], "kimi-code", undefined, true, undefined, cache);
    const firstCompleted = first.find((item) => item.type === "event" && item.event.id === completedAssistant.id);
    const secondCompleted = second.find((item) => item.type === "event" && item.event.id === completedAssistant.id);
    const firstActive = first.find((item) => item.type === "event" && item.event.id === activeAssistant.id);
    const secondActive = second.find((item) => item.type === "event" && item.event.id === activeAssistant.id);

    expect(secondCompleted).toBe(firstCompleted);
    expect(secondActive).not.toBe(firstActive);
  });
});

describe("filterStatusUpdates room isolation", () => {
  it("keeps the final status for every Agent turn in turn-end mode", () => {
    const statuses: TimelineEvent[] = [{
      id: "reviewer-usage",
      type: "status_update",
      timestamp: 1,
      tokenCount: 22,
      inputTokenCount: 22036,
      roomAgentId: "reviewer",
      agentTurnId: "reviewer-turn",
    }, {
      id: "primary-usage",
      type: "status_update",
      timestamp: 2,
      tokenCount: 40,
      inputTokenCount: 23741,
      roomAgentId: "primary",
      agentTurnId: "primary-turn",
    }];

    expect(filterStatusUpdates(statuses, "turn_end").map((event) => event.id)).toEqual([
      "reviewer-usage",
      "primary-usage",
    ]);
  });

  it("still keeps only the latest status inside one Agent turn", () => {
    const statuses: TimelineEvent[] = [{
      id: "reviewer-interim",
      type: "status_update",
      timestamp: 1,
      tokenCount: 12,
      roomAgentId: "reviewer",
      agentTurnId: "reviewer-turn",
    }, {
      id: "reviewer-final",
      type: "status_update",
      timestamp: 2,
      tokenCount: 22,
      roomAgentId: "reviewer",
      agentTurnId: "reviewer-turn",
    }];

    expect(filterStatusUpdates(statuses, "turn_end").map((event) => event.id)).toEqual(["reviewer-final"]);
  });

  it("keeps the final metric status when a generic status arrives later in the same Agent turn", () => {
    const statuses: TimelineEvent[] = [{
      id: "reviewer-usage",
      type: "status_update",
      timestamp: 1,
      inputTokenCount: 22036,
      tokenCount: 22,
      contextSize: 0.42,
      roomAgentId: "reviewer",
      agentTurnId: "reviewer-turn",
    }, {
      id: "reviewer-permission",
      type: "status_update",
      timestamp: 2,
      message: "权限：完全访问",
      roomAgentId: "reviewer",
      agentTurnId: "reviewer-turn",
    }];

    expect(filterStatusUpdates(statuses, "turn_end").map((event) => event.id)).toEqual(["reviewer-usage"]);
  });

  it("keeps the latest generic status when an Agent turn has no metrics", () => {
    const statuses: TimelineEvent[] = [{
      id: "reviewer-plan",
      type: "status_update",
      timestamp: 1,
      message: "Plan 开",
      roomAgentId: "reviewer",
      agentTurnId: "reviewer-turn",
    }, {
      id: "reviewer-completed",
      type: "status_update",
      timestamp: 2,
      message: "已完成",
      roomAgentId: "reviewer",
      agentTurnId: "reviewer-turn",
    }];

    expect(filterStatusUpdates(statuses, "turn_end").map((event) => event.id)).toEqual(["reviewer-completed"]);
  });
});

describe("buildRenderItems room Agent turns", () => {
  const events: TimelineEvent[] = [{
    id: "room-message",
    type: "user_message",
    timestamp: 1,
    content: "分别检查",
    recipientAgentIds: ["agent-a", "agent-b"],
  }, {
    id: "assistant-a-part",
    type: "assistant_message",
    timestamp: 2,
    content: "A result",
    isThinking: false,
    isComplete: true,
    roomAgentId: "agent-a",
    roomMessageId: "room-message",
    agentTurnId: "turn-a",
  }, {
    id: "usage-a",
    type: "status_update",
    timestamp: 3,
    inputTokenCount: 10,
    tokenCount: 5,
    roomAgentId: "agent-a",
    roomMessageId: "room-message",
    agentTurnId: "turn-a",
  }, {
    id: "assistant-b-part",
    type: "assistant_message",
    timestamp: 4,
    content: "B result",
    isThinking: false,
    isComplete: true,
    roomAgentId: "agent-b",
    roomMessageId: "room-message",
    agentTurnId: "turn-b",
  }, {
    id: "usage-b",
    type: "status_update",
    timestamp: 5,
    inputTokenCount: 12,
    tokenCount: 6,
    roomAgentId: "agent-b",
    roomMessageId: "room-message",
    agentTurnId: "turn-b",
  }];

  it("keeps two Agent responses as separate stable render blocks", () => {
    const rendered = buildRenderItems(events, "kimi-code");
    const assistants = rendered.filter((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistants).toHaveLength(2);
    expect(assistants.map((item) => item.type === "event" ? item.event.id : "")).toEqual([
      "assistant:turn-a",
      "assistant:turn-b",
    ]);
    expect(assistants.map((item) => item.type === "event" && item.event.type === "assistant_message" ? item.event.content : "")).toEqual([
      "A result",
      "B result",
    ]);
  });

  it("uses the Agent activity set instead of treating only the last response as running", () => {
    const rendered = buildRenderItems(events, "kimi-code", undefined, false, new Set(["agent-a"]));
    const assistantA = rendered.find((item) => item.type === "event" && item.event.id === "assistant:turn-a");
    expect(assistantA?.type).toBe("event");
    if (assistantA?.type !== "event") return;
    expect(assistantA.trailingStatuses).toEqual([]);
  });

  it("settles one Agent footer while another Agent in the room is still running", () => {
    const rendered = buildRenderItems(events, "kimi-code", undefined, true, new Set(["agent-a"]));
    const assistantB = rendered.find((item) => item.type === "event" && item.event.id === "assistant:turn-b");
    expect(assistantB?.type).toBe("event");
    if (assistantB?.type !== "event") return;
    expect(assistantB.trailingStatuses?.map((status) => status.id)).toEqual(["usage-b"]);
  });

  it("keeps Agent A usage attached after Agent B starts and emits a generic status", () => {
    const visibleEvents = filterStatusUpdates([...events, {
      id: "agent-b-running",
      type: "status_update",
      timestamp: 6,
      message: "正在处理",
      roomAgentId: "agent-b",
      roomMessageId: "room-message",
      agentTurnId: "turn-b",
    }], "turn_end");
    const rendered = buildRenderItems(visibleEvents, "kimi-code", undefined, true, new Set(["agent-b"]));
    const assistantA = rendered.find((item) => item.type === "event" && item.event.id === "assistant:turn-a");
    expect(assistantA?.type).toBe("event");
    if (assistantA?.type !== "event") return;
    expect(assistantA.trailingStatuses?.map((status) => status.id)).toEqual(["usage-a"]);
  });
});

describe("assistant footer fallback", () => {
  it("uses the official turn model instead of an unreliable long duration for room Agents", () => {
    expect(assistantFooterFallbackLabel({
      id: "assistant-room",
      type: "assistant_message",
      timestamp: 1,
      content: "完成",
      model: "openai/gpt-5",
      isThinking: false,
      isComplete: true,
      durationMs: 12_370_000,
      roomAgentId: "agent-a",
      agentTurnId: "turn-a",
    }, false)).toBe("模型：gpt-5");
  });

  it("shows only completed when a room Agent has neither metrics nor an official model", () => {
    expect(assistantFooterFallbackLabel({
      id: "assistant-room",
      type: "assistant_message",
      timestamp: 1,
      content: "完成",
      isThinking: false,
      isComplete: true,
      durationMs: 12_370_000,
      roomAgentId: "agent-a",
      agentTurnId: "turn-a",
    }, false)).toBe("已完成");
  });

  it("keeps the existing reliable duration fallback for ordinary single-Agent sessions", () => {
    expect(assistantFooterFallbackLabel({
      id: "assistant-single",
      type: "assistant_message",
      timestamp: 1,
      content: "完成",
      isThinking: false,
      isComplete: true,
      durationMs: 65_000,
    }, false)).toBe("已完成 · 用时 1分5秒");
  });
});

describe("message footer memoization", () => {
  it("detects metric changes even when a status keeps the same event identity", () => {
    const before: TimelineEvent = {
      id: "usage",
      type: "status_update",
      timestamp: 1,
      inputTokenCount: 100,
      tokenCount: 20,
    };
    const after: TimelineEvent = {
      ...before,
      inputTokenCount: 120,
      tokenCount: 30,
      contextSize: 0.5,
    };

    expect(timelineEventMemoKey(before)).not.toBe(timelineEventMemoKey(after));
  });
});
