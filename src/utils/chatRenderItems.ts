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

function collectSubagentAssistantOutput(subagents: SubagentEvent[]): { content: string; thinking?: string } {
  const contents: string[] = [];
  const thinkings: string[] = [];
  for (const subagent of subagents) {
    for (const event of subagent.events) {
      if (event.type !== "assistant_message") continue;
      const content = event.content?.trim();
      const thinking = event.thinking?.trim();
      if (content) contents.push(content);
      if (thinking) thinkings.push(thinking);
    }
  }
  return {
    content: contents.join("\n\n"),
    thinking: thinkings.join("") || undefined,
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
  // 当主时间线没有产生助手正文时，把子代理内部的 assistant_message 内容提升到主时间线，
  // 避免用户只看到“子代理已完成”却看不到实际输出（ reopen 后官方历史通常会正确归位）。
  const { content, thinking } = collectSubagentAssistantOutput(subagents);
  return {
    id: first?.agentTurnId ? `assistant:${first.agentTurnId}:subagents` : `assistant-subagents-${subagents.map((subagent) => subagent.id).join(":")}`,
    type: "assistant_message",
    timestamp: first?.timestamp ?? Date.now(),
    content,
    thinking,
    isThinking: false,
    isComplete: !hasActiveSubagent,
    durationMs: Math.max(0, (last?.timestamp ?? first?.timestamp ?? 0) - (first?.timestamp ?? 0)),
    roomAgentId: first?.roomAgentId,
    roomMessageId: first?.roomMessageId,
    agentTurnId: first?.agentTurnId,
  };
}
