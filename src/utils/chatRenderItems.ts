import type { TimelineEvent, ToolCallEvent } from "@/types/ui";
import { logEvent } from "@/utils/reportError";

type SubagentEvent = Extract<TimelineEvent, { type: "subagent" }>;

export function createToolOnlyAssistantEvent(tools: ToolCallEvent[], isTurnActive = false): Extract<TimelineEvent, { type: "assistant_message" }> {
  const first = tools[0];
  const last = tools[tools.length - 1] ?? first;
  const hasRunningTool = tools.some((tool) => tool.status === "running");
  return {
    id: first?.agentTurnId ? `assistant:${first.agentTurnId}:tools` : `assistant-tools-${tools.map((tool) => tool.id).join(":")}`,
    type: "assistant_message",
    timestamp: first?.timestamp ?? Date.now(),
    content: "",
    isThinking: false,
    isComplete: !hasRunningTool && !isTurnActive,
    durationMs: last?.durationMs ?? Math.max(0, (last?.timestamp ?? first?.timestamp ?? 0) - (first?.timestamp ?? 0)),
    roomAgentId: first?.roomAgentId,
    roomMessageId: first?.roomMessageId,
    agentTurnId: first?.agentTurnId,
  };
}

export function collectSubagentAssistantOutput(subagents: SubagentEvent[]): { content: string; thinking?: string } {
  const contents: string[] = [];
  const thinkings: string[] = [];

  function walk(events: TimelineEvent[]) {
    for (const event of events) {
      if (event.type === "assistant_message") {
        const content = event.content?.trim();
        const thinking = event.thinking?.trim();
        if (content) contents.push(content);
        if (thinking) thinkings.push(thinking);
        // thinkingParts 可能承载 thinking 正文，thinking 字段为空时也要收集
        for (const part of event.thinkingParts ?? []) {
          const partText = part.text?.trim();
          if (partText) thinkings.push(partText);
        }
      } else if (event.type === "subagent") {
        walk(event.events);
      }
    }
  }

  for (const subagent of subagents) {
    walk(subagent.events);
  }
  return {
    content: contents.join("\n\n"),
    thinking: thinkings.join("") || undefined,
  };
}

export function hasSubagentAssistantOutput(subagents: SubagentEvent[]): boolean {
  return collectSubagentAssistantOutput(subagents).content.length > 0;
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
  if (content.trim().length > 0 || thinking?.trim().length) {
    logEvent("chatRenderItems.subagentContentSurfaced", {
      agentTurnId: first?.agentTurnId,
      roomAgentId: first?.roomAgentId,
      roomMessageId: first?.roomMessageId,
      subagentCount: subagents.length,
      hasActiveSubagent,
      contentLength: content.length,
      thinkingLength: thinking?.length ?? 0,
    });
  }
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
