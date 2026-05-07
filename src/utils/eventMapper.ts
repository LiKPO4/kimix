import type { TimelineEvent } from "@/types/ui";

export function mapStreamEvent(event: unknown): TimelineEvent | null {
  const e = event as Record<string, unknown>;
  const type = e.type as string;
  const payload = (e.payload ?? {}) as Record<string, unknown>;

  switch (type) {
    case "TurnBegin": {
      const input = payload.user_input;
      const text = typeof input === "string" ? input : "";
      return {
        id: generateId(),
        type: "user_message",
        timestamp: Date.now(),
        content: text,
      };
    }

    case "ContentPart": {
      const partType = (payload as Record<string, unknown>).type as string;
      if (partType === "text") {
        return {
          id: generateId(),
          type: "assistant_message",
          timestamp: Date.now(),
          content: (payload as Record<string, unknown>).text as string,
          isThinking: false,
          isComplete: false,
        };
      }
      if (partType === "think") {
        return {
          id: generateId(),
          type: "assistant_message",
          timestamp: Date.now(),
          content: "",
          thinking: (payload as Record<string, unknown>).think as string,
          isThinking: true,
          isComplete: false,
        };
      }
      return null;
    }

    case "ToolCall": {
      const func = (payload.function ?? {}) as Record<string, unknown>;
      return {
        id: generateId(),
        type: "tool_call",
        timestamp: Date.now(),
        toolCallId: (payload.id as string) ?? generateId(),
        toolName: (func.name as string) ?? "unknown",
        status: "running",
        arguments: func.arguments ? JSON.parse(func.arguments as string) : {},
        rawArguments: (func.arguments as string) ?? "",
      };
    }

    case "ToolCallPart": {
      // Streaming tool arguments - handled by updating existing ToolCallEvent
      return null;
    }

    case "ToolResult": {
      const returnValue = (payload.return_value ?? {}) as Record<string, unknown>;
      const output = returnValue.output;
      let display: { diff?: { path: string; oldText: string; newText: string }; todo?: { id: string; content: string; status: "pending" | "in_progress" | "done" }[] } | undefined;

      if (Array.isArray(output)) {
        const blocks = output as Array<Record<string, unknown>>;
        const diffBlock = blocks.find((b) => b.type === "diff");
        const todoBlock = blocks.find((b) => b.type === "todo");
        if (diffBlock) {
          display = {
            diff: {
              path: diffBlock.path as string,
              oldText: diffBlock.old_text as string,
              newText: diffBlock.new_text as string,
            },
          };
        }
        if (todoBlock) {
          display = {
            ...display,
            todo: ((todoBlock.items as Array<Record<string, unknown>>) ?? []).map((item, i) => ({
              id: `todo-${i}`,
              content: item.title as string,
              status: item.status as "pending" | "in_progress" | "done",
            })),
          };
        }
      }

      return {
        id: generateId(),
        type: "tool_result",
        timestamp: Date.now(),
        toolCallId: (payload.tool_call_id as string) ?? "",
        toolName: "unknown",
        result: returnValue.output ?? "",
        display,
      };
    }

    case "ApprovalRequest": {
      return {
        id: generateId(),
        type: "approval_request",
        timestamp: Date.now(),
        requestId: (payload.id as string) ?? "",
        toolName: (payload.sender as string) ?? "unknown",
        description: (payload.description as string) ?? "需要审批",
        details: (payload.action as string) ?? "",
        riskLevel: "medium",
        status: "pending",
      };
    }

    case "StatusUpdate": {
      const tokenUsage = (payload.token_usage ?? {}) as Record<string, number>;
      return {
        id: generateId(),
        type: "status_update",
        timestamp: Date.now(),
        tokenCount: tokenUsage.output ?? 0,
        contextSize: (payload.context_usage as number) ?? 0,
        message: payload.message_id ? `消息 ${payload.message_id}` : undefined,
      };
    }

    case "CompactionBegin":
      return {
        id: generateId(),
        type: "compaction",
        timestamp: Date.now(),
        phase: "begin",
      };

    case "CompactionEnd":
      return {
        id: generateId(),
        type: "compaction",
        timestamp: Date.now(),
        phase: "end",
      };

    case "SubagentEvent": {
      return {
        id: generateId(),
        type: "subagent",
        timestamp: Date.now(),
        agentName: (payload.agent_name as string) ?? "subagent",
        status: "running",
        events: [],
      };
    }

    case "TurnEnd": {
      return {
        id: generateId(),
        type: "assistant_message",
        timestamp: Date.now(),
        content: "",
        isThinking: false,
        isComplete: true,
      };
    }

    case "Error": {
      return {
        id: generateId(),
        type: "error",
        timestamp: Date.now(),
        message: (payload.message as string) ?? "未知错误",
        source: "sdk",
      };
    }

    default:
      return null;
  }
}

export function mergeEvents(existing: TimelineEvent[], incoming: TimelineEvent): TimelineEvent[] {
  // 忽略重复的用户消息（前端已提前添加，SDK 的 TurnBegin 会再发一次）
  if (incoming.type === "user_message") {
    const hasDuplicate = existing.some(
      (e) => e.type === "user_message" && e.content === incoming.content
    );
    if (hasDuplicate) return existing;
  }

  // Merge streaming assistant messages
  if (incoming.type === "assistant_message") {
    const last = existing[existing.length - 1];
    if (last && last.type === "assistant_message" && !last.isComplete) {
      const updated: typeof last = {
        ...last,
        content: last.content + incoming.content,
        thinking: incoming.thinking ? (last.thinking ?? "") + incoming.thinking : last.thinking,
        isThinking: incoming.isThinking ?? last.isThinking,
        isComplete: incoming.isComplete,
      };
      return [...existing.slice(0, -1), updated];
    }
  }

  // Merge streaming tool calls
  if (incoming.type === "tool_call") {
    const last = existing[existing.length - 1];
    if (last && last.type === "tool_call" && last.status === "running" && last.toolName === incoming.toolName) {
      const updated: typeof last = {
        ...last,
        arguments: { ...last.arguments, ...incoming.arguments },
        rawArguments: (last.rawArguments ?? "") + (incoming.rawArguments ?? ""),
      };
      return [...existing.slice(0, -1), updated];
    }
  }

  return [...existing, incoming];
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}
