import type { TimelineEvent, ToolCallEvent } from "@/types/ui";

type SubagentEvent = Extract<TimelineEvent, { type: "subagent" }>;

export function createToolOnlyAssistantEvent(tools: ToolCallEvent[]): Extract<TimelineEvent, { type: "assistant_message" }> {
  const first = tools[0];
  const last = tools[tools.length - 1] ?? first;
  const hasRunningTool = tools.some((tool) => tool.status === "running");
  return {
    id: first?.agentTurnId ? `assistant:${first.agentTurnId}:tools` : `assistant-tools-${tools.map((tool) => tool.id).join(":")}`,
    type: "assistant_message",
    timestamp: first?.timestamp ?? Date.now(),
    content: "",
    isThinking: false,
    isComplete: !hasRunningTool,
    durationMs: last?.durationMs ?? Math.max(0, (last?.timestamp ?? first?.timestamp ?? 0) - (first?.timestamp ?? 0)),
    roomAgentId: first?.roomAgentId,
    roomMessageId: first?.roomMessageId,
    agentTurnId: first?.agentTurnId,
  };
}

export function createSubagentOnlyAssistantEvent(subagents: SubagentEvent[]): Extract<TimelineEvent, { type: "assistant_message" }> {
  const first = subagents[0];
  const last = subagents[subagents.length - 1] ?? first;
  const hasActiveSubagent = subagents.some((subagent) => (
    subagent.status === "queued" ||
    subagent.status === "running" ||
    subagent.status === "suspended"
  ));
  return {
    id: first?.agentTurnId ? `assistant:${first.agentTurnId}:subagents` : `assistant-subagents-${subagents.map((subagent) => subagent.id).join(":")}`,
    type: "assistant_message",
    timestamp: first?.timestamp ?? Date.now(),
    content: "",
    isThinking: false,
    isComplete: !hasActiveSubagent,
    durationMs: Math.max(0, (last?.timestamp ?? first?.timestamp ?? 0) - (first?.timestamp ?? 0)),
    roomAgentId: first?.roomAgentId,
    roomMessageId: first?.roomMessageId,
    agentTurnId: first?.agentTurnId,
  };
}
