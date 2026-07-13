import { describe, expect, it } from "vitest";
import { buildRenderItems } from "@/components/chat/ChatThread";
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
});
