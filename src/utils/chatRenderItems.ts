import type { TimelineEvent, ToolCallEvent } from "@/types/ui";

export function createToolOnlyAssistantEvent(tools: ToolCallEvent[]): Extract<TimelineEvent, { type: "assistant_message" }> {
  const first = tools[0];
  const last = tools[tools.length - 1] ?? first;
  const hasRunningTool = tools.some((tool) => tool.status === "running");
  return {
    id: `assistant-tools-${tools.map((tool) => tool.id).join(":")}`,
    type: "assistant_message",
    timestamp: first?.timestamp ?? Date.now(),
    content: "",
    isThinking: false,
    isComplete: !hasRunningTool,
    durationMs: last?.durationMs ?? Math.max(0, (last?.timestamp ?? first?.timestamp ?? 0) - (first?.timestamp ?? 0)),
  };
}
