import type { TimelineEvent } from "@/types/ui";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number";
}

export function mapStreamEvent(event: unknown): TimelineEvent | null {
  if (!isRecord(event)) return null;
  const type = event.type;
  if (!isString(type)) return null;
  const payload = isRecord(event.payload) ? event.payload : {};

  switch (type) {
    case "TurnBegin": {
      const input = payload.user_input;
      const text = isString(input) ? input : "";
      return {
        id: generateId(),
        type: "user_message",
        timestamp: Date.now(),
        content: text,
      };
    }

    case "ContentPart": {
      const partType = payload.type;
      if (partType === "text" && isString(payload.text)) {
        return {
          id: generateId(),
          type: "assistant_message",
          timestamp: Date.now(),
          content: payload.text,
          isThinking: false,
          isComplete: false,
        };
      }
      if (partType === "think" && isString(payload.think)) {
        return {
          id: generateId(),
          type: "assistant_message",
          timestamp: Date.now(),
          content: "",
          thinking: payload.think,
          isThinking: true,
          isComplete: false,
        };
      }
      return null;
    }

    case "ToolCall": {
      const func = isRecord(payload.function) ? payload.function : {};
      return {
        id: generateId(),
        type: "tool_call",
        timestamp: Date.now(),
        toolCallId: isString(payload.id) ? payload.id : generateId(),
        toolName: isString(func.name) ? func.name : "unknown",
        status: "running",
        arguments: (() => {
          try { return isString(func.arguments) ? JSON.parse(func.arguments) : {}; }
          catch { return {}; }
        })(),
        rawArguments: isString(func.arguments) ? func.arguments : "",
      };
    }

    case "ToolCallPart": {
      const func = isRecord(payload.function) ? payload.function : {};
      return {
        id: generateId(),
        type: "tool_call",
        timestamp: Date.now(),
        toolCallId: isString(payload.tool_call_id) ? payload.tool_call_id : isString(payload.id) ? payload.id : generateId(),
        toolName: isString(func.name) ? func.name : "unknown",
        status: "running",
        arguments: (() => {
          try { return isString(func.arguments) ? JSON.parse(func.arguments) : {}; }
          catch { return {}; }
        })(),
        rawArguments: isString(func.arguments) ? func.arguments : "",
      };
    }

    case "ToolResult": {
      const returnValue = isRecord(payload.return_value) ? payload.return_value : {};
      const output = returnValue.output;
      let display: { diff?: { path: string; oldText: string; newText: string }; todo?: { id: string; content: string; status: "pending" | "in_progress" | "done" }[] } | undefined;

      if (Array.isArray(output)) {
        const blocks = output.filter(isRecord);
        const diffBlock = blocks.find((b) => b.type === "diff");
        const todoBlock = blocks.find((b) => b.type === "todo");
        if (diffBlock && isString(diffBlock.path) && isString(diffBlock.old_text) && isString(diffBlock.new_text)) {
          display = {
            diff: {
              path: diffBlock.path,
              oldText: diffBlock.old_text,
              newText: diffBlock.new_text,
            },
          };
        }
        if (todoBlock && Array.isArray(todoBlock.items)) {
          display = {
            ...display,
            todo: todoBlock.items.filter(isRecord).map((item, i) => {
              const status = isString(item.status) && ["pending", "in_progress", "done"].includes(item.status)
                ? item.status as "pending" | "in_progress" | "done"
                : "pending";
              return {
                id: `todo-${i}`,
                content: isString(item.title) ? item.title : "",
                status,
              };
            }),
          };
        }
      }

      return {
        id: generateId(),
        type: "tool_result",
        timestamp: Date.now(),
        toolCallId: isString(payload.tool_call_id) ? payload.tool_call_id : "",
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
        requestId: isString(payload.id) ? payload.id : "",
        toolName: isString(payload.sender) ? payload.sender : "unknown",
        description: isString(payload.description) ? payload.description : "需要审批",
        details: isString(payload.action) ? payload.action : "",
        riskLevel: "medium",
        status: "pending",
      };
    }

    case "StatusUpdate": {
      const tokenUsage = isRecord(payload.token_usage) ? payload.token_usage : {};
      return {
        id: generateId(),
        type: "status_update",
        timestamp: Date.now(),
        tokenCount: isNumber(tokenUsage.output) ? tokenUsage.output : 0,
        contextSize: isNumber(payload.context_usage) ? payload.context_usage : 0,
        message: isNumber(payload.message_id) || isString(payload.message_id) ? `消息 ${payload.message_id}` : undefined,
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
        agentName: isString(payload.agent_name) ? payload.agent_name : "subagent",
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

    case "TurnResult": {
      // Result already streamed via ContentPart/TurnEnd; no extra UI needed
      return null;
    }

    case "Error": {
      return {
        id: generateId(),
        type: "error",
        timestamp: Date.now(),
        message: isString(payload.message) ? payload.message : "未知错误",
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
    const lastIndex = existing.findLastIndex((e) => e.type === "assistant_message" && !e.isComplete);
    if (lastIndex !== -1) {
      const last = existing[lastIndex] as Extract<TimelineEvent, { type: "assistant_message" }>;
      const updated: typeof last = {
        ...last,
        content: last.content + incoming.content,
        thinking: incoming.thinking ? (last.thinking ?? "") + incoming.thinking : last.thinking,
        isThinking: incoming.isThinking ?? last.isThinking,
        isComplete: incoming.isComplete,
      };
      const result = [...existing];
      result[lastIndex] = updated;
      return result;
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
