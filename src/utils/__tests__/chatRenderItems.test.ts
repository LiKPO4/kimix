import { describe, expect, it } from "vitest";
import { buildRenderItems, filterStatusUpdates } from "@/components/chat/ChatThread";
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
});
