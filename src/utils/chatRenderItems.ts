import type { TimelineEvent, ToolCallEvent } from "@/types/ui";

type SubagentEvent = Extract<TimelineEvent, { type: "subagent" }>;

/**
 * Render-only container for turns that produced no assistant text of their own
 * (tool-only / subagent-only bodies). It carries no fabricated content: the
 * bubble renders the ordered turn blocks (tool groups, subagent task cards)
 * and nothing else. Subagent-internal output must never be promoted into the
 * main timeline body — official kimi-web keeps agentId-scoped frames out of
 * the main transcript at the projector level.
 */
export function createToolOnlyAssistantEvent(
  tools: ToolCallEvent[],
  isTurnActive = false,
  subagents: SubagentEvent[] = [],
): Extract<TimelineEvent, { type: "assistant_message" }> {
  const first = tools[0] ?? subagents[0];
  const last = tools[tools.length - 1] ?? subagents[subagents.length - 1] ?? first;
  const hasRunningTool = tools.some((tool) => tool.status === "running");
  const hasActiveSubagent = subagents.some((subagent) => (
    subagent.status === "queued" ||
    subagent.status === "running" ||
    subagent.status === "suspended"
  ));
  const fallbackId = [...tools, ...subagents].map((event) => event.id).join(":");
  return {
    id: first?.agentTurnId ? `assistant:${first.agentTurnId}:tools` : `assistant-tools-${fallbackId}`,
    type: "assistant_message",
    timestamp: first?.timestamp ?? Date.now(),
    content: "",
    isThinking: false,
    isComplete: !hasRunningTool && !hasActiveSubagent && !isTurnActive,
    durationMs: last?.durationMs ?? Math.max(0, (last?.timestamp ?? first?.timestamp ?? 0) - (first?.timestamp ?? 0)),
    roomAgentId: first?.roomAgentId,
    roomMessageId: first?.roomMessageId,
    agentTurnId: first?.agentTurnId,
  };
}
