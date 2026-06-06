import { describe, expect, it } from "vitest";
import { createToolOnlyAssistantEvent } from "../chatRenderItems";
import type { ToolCallEvent } from "@/types/ui";

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
