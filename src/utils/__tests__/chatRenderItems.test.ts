import { describe, expect, it } from "vitest";
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
