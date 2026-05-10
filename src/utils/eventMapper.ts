import type { TimelineEvent, TodoItem } from "@/types/ui";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNumber(v: unknown): v is number {
  return typeof v === "number";
}

const LATEST_TOOL_CALL = "__kimix_latest_tool_call__";

type ExtractedUserMessage = {
  content: string;
  images: { name: string; dataUrl?: string }[];
};

function parseArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (!isString(value) || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mergeArguments(rawArguments: string, fallback: Record<string, unknown>): Record<string, unknown> {
  const parsed = parseArguments(rawArguments);
  return Object.keys(parsed).length > 0 ? parsed : fallback;
}

function createTodoEvent(items: TodoItem[], timestamp: number): TimelineEvent | null {
  if (items.length === 0) return null;
  return {
    id: generateId(),
    type: "todo",
    timestamp,
    items,
  };
}

function extractUserInput(input: unknown): string {
  return extractUserMessage(input).content;
}

function extractUserMessage(input: unknown): ExtractedUserMessage {
  if (isString(input)) return { content: input, images: [] };
  if (!Array.isArray(input)) return { content: "", images: [] };

  const textParts: string[] = [];
  const images: { name: string; dataUrl?: string }[] = [];
  input.forEach((part, index) => {
    if (!isRecord(part)) return;
    if (part.type === "text" && isString(part.text)) {
      textParts.push(part.text);
      return;
    }
    if (part.type === "image_url") {
      const imageUrl = isRecord(part.image_url) ? part.image_url : {};
      const url = isString(imageUrl.url) ? imageUrl.url : undefined;
      images.push({ name: `图片 ${index + 1}`, dataUrl: url });
      if (!url) textParts.push("[图片]");
    }
  });
  return {
    content: textParts.filter(Boolean).join("\n"),
    images,
  };
}

function normalizeUserContent(content: string): string {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^\[图片(?::[^\]]*)?\]$/.test(line))
    .join("\n")
    .trim();
}

function getUserImageSignature(event: Extract<TimelineEvent, { type: "user_message" }>): string {
  return (event.images ?? [])
    .map((image) => image.dataUrl || image.name || "图片")
    .join("|");
}

export function mapStreamEvent(event: unknown): TimelineEvent | null {
  if (!isRecord(event)) return null;
  const source = isRecord(event.message) ? event.message : event;
  const type = source.type;
  if (!isString(type)) return null;
  const payload = isRecord(source.payload) ? source.payload : {};

  switch (type) {
    case "TurnBegin": {
      const userMessage = extractUserMessage(payload.user_input);
      return {
        id: generateId(),
        type: "user_message",
        timestamp: Date.now(),
        content: userMessage.content,
        images: userMessage.images,
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
        const id = generateId();
        const timestamp = Date.now();
        return {
          id,
          type: "assistant_message",
          timestamp,
          content: "",
          thinking: payload.think,
          thinkingParts: [{ id: generateId(), timestamp, text: payload.think }],
          isThinking: true,
          isComplete: false,
        };
      }
      return null;
    }

    case "ToolCall": {
      const func = isRecord(payload.function) ? payload.function : {};
      const rawArguments = isString(func.arguments) ? func.arguments : "";
      return {
        id: generateId(),
        type: "tool_call",
        timestamp: Date.now(),
        toolCallId: isString(payload.id) ? payload.id : generateId(),
        toolName: isString(func.name) ? func.name : "unknown",
        status: "running",
        arguments: parseArguments(rawArguments),
        rawArguments,
      };
    }

    case "SteerInput": {
      const text = extractUserInput(payload.user_input);
      if (!text.trim()) return null;
      return {
        id: generateId(),
        type: "steer_message",
        timestamp: Date.now(),
        content: text,
        status: "sent",
      };
    }

    case "ToolCallPart": {
      const rawArguments = isString(payload.arguments_part)
        ? payload.arguments_part
        : isString(payload.arguments)
          ? payload.arguments
          : "";
      return {
        id: generateId(),
        type: "tool_call",
        timestamp: Date.now(),
        toolCallId: isString(payload.tool_call_id) ? payload.tool_call_id : isString(payload.id) ? payload.id : LATEST_TOOL_CALL,
        toolName: "unknown",
        status: "running",
        arguments: parseArguments(rawArguments),
        rawArguments,
      };
    }

    case "ToolResult": {
      const returnValue = isRecord(payload.return_value) ? payload.return_value : {};
      const output = returnValue.output;
      const displayBlocks = Array.isArray(returnValue.display) ? returnValue.display : Array.isArray(output) ? output : [];
      let display: { diff?: { path: string; oldText: string; newText: string }; todo?: { id: string; content: string; status: "pending" | "in_progress" | "done" }[] } | undefined;

      if (displayBlocks.length > 0) {
        const blocks = displayBlocks.filter(isRecord);
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
      const inputTokenCount =
        (isNumber(tokenUsage.input_other) ? tokenUsage.input_other : 0) +
        (isNumber(tokenUsage.input_cache_read) ? tokenUsage.input_cache_read : 0) +
        (isNumber(tokenUsage.input_cache_creation) ? tokenUsage.input_cache_creation : 0);
      const contextSize = isNumber(payload.context_usage) ? payload.context_usage : 0;
      return {
        id: generateId(),
        type: "status_update",
        timestamp: Date.now(),
        tokenCount: isNumber(tokenUsage.output) ? tokenUsage.output : 0,
        inputTokenCount,
        contextSize,
        contextLimit: 256000,
        message: isNumber(payload.message_id) || isString(payload.message_id) ? `消息 ${payload.message_id}` : undefined,
      };
    }

    case "TurnChanges": {
      const files = Array.isArray(payload.files) ? payload.files.filter(isRecord) : [];
      const mappedFiles = files
        .map((file) => ({
          path: isString(file.path) ? file.path : "",
          additions: isNumber(file.additions) ? file.additions : 0,
          deletions: isNumber(file.deletions) ? file.deletions : 0,
        }))
        .filter((file) => file.path.length > 0);
      if (mappedFiles.length === 0) return null;
      return {
        id: generateId(),
        type: "change_summary",
        timestamp: Date.now(),
        projectPath: isString(payload.project_path) ? payload.project_path : undefined,
        files: mappedFiles,
        additions: mappedFiles.reduce((sum, file) => sum + (file.additions ?? 0), 0),
        deletions: mappedFiles.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
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
    const lastSubstantiveAssistantIndex = existing.findLastIndex(
      (e) => e.type === "assistant_message" && (
        e.isComplete ||
        e.content.trim().length > 0 ||
        Boolean(e.thinking?.trim())
      )
    );
    const hasDuplicate = existing.some((e, index) => {
      if (index <= lastSubstantiveAssistantIndex || e.type !== "user_message") return false;
      const existingContent = normalizeUserContent(e.content);
      const incomingContent = normalizeUserContent(incoming.content);
      if (existingContent !== incomingContent) return false;
      if (incomingContent.length > 0) return true;
      return getUserImageSignature(e) === getUserImageSignature(incoming);
    });
    if (hasDuplicate) return existing;
  }

  // Merge streaming assistant messages
  if (incoming.type === "assistant_message") {
    if (incoming.isComplete && !incoming.content && !incoming.thinking) {
      const latestOpenIndex = existing.findLastIndex((e) => e.type === "assistant_message" && !e.isComplete);
      if (latestOpenIndex === -1) return existing;
      return existing.flatMap((event, index) => {
        if (event.type !== "assistant_message" || event.isComplete) return event;
        const hasContent = event.content.trim().length > 0;
        const hasThinking = Boolean(event.thinking?.trim());
        if (!hasContent && !hasThinking && index !== latestOpenIndex) return [];
        return {
          ...event,
          isThinking: false,
          isComplete: true,
          durationMs: Math.max(0, incoming.timestamp - (index === latestOpenIndex ? event.timestamp : incoming.timestamp)),
        };
      });
    }

    const latestSteerIndex = existing.findLastIndex((e) => e.type === "steer_message");
    const lastIndex = existing.findLastIndex(
      (e, index) => index > latestSteerIndex && e.type === "assistant_message" && !e.isComplete
    );
    if (lastIndex !== -1) {
      const last = existing[lastIndex] as Extract<TimelineEvent, { type: "assistant_message" }>;
      const updated: typeof last = {
        ...last,
        content: last.content && incoming.content
          ? `${last.content}\n\n${incoming.content}`
          : last.content + incoming.content,
        thinking: incoming.thinking ? (last.thinking ?? "") + incoming.thinking : last.thinking,
        thinkingParts: incoming.thinkingParts
          ? [...(last.thinkingParts ?? []), ...incoming.thinkingParts]
          : last.thinkingParts,
        isThinking: incoming.isComplete ? false : (last.isThinking || Boolean(incoming.thinking)),
        isComplete: incoming.isComplete,
        durationMs: incoming.isComplete ? Math.max(0, incoming.timestamp - last.timestamp) : last.durationMs,
      };
      const result = [...existing];
      result[lastIndex] = updated;
      return result;
    }
  }

  // Merge streaming tool calls
  if (incoming.type === "tool_call") {
    const partialWithoutId = incoming.toolCallId === LATEST_TOOL_CALL;
    const sameCallIndex = partialWithoutId
      ? -1
      : existing.findLastIndex((e) => e.type === "tool_call" && e.status === "running" && e.toolCallId === incoming.toolCallId);
    const latestCallIndex = existing.findLastIndex((e) => e.type === "tool_call" && e.status === "running");
    const targetIndex = sameCallIndex !== -1 ? sameCallIndex : partialWithoutId ? latestCallIndex : -1;

    if (targetIndex !== -1) {
      const last = existing[targetIndex] as Extract<TimelineEvent, { type: "tool_call" }>;
      const rawArguments = (last.rawArguments ?? "") + (incoming.rawArguments ?? "");
      const fallbackArguments = { ...last.arguments, ...incoming.arguments };
      const updated: typeof last = {
        ...last,
        toolName: incoming.toolName && incoming.toolName !== "unknown" ? incoming.toolName : last.toolName,
        arguments: mergeArguments(rawArguments, fallbackArguments),
        rawArguments,
      };
      const result = [...existing];
      result[targetIndex] = updated;
      return result;
    }

    if (partialWithoutId) {
      return existing;
    }
  }

  if (incoming.type === "steer_message") {
    const duplicateIndex = existing.findLastIndex(
      (e) => e.type === "steer_message" && e.content === incoming.content
    );
    if (duplicateIndex !== -1) {
      const result = [...existing];
      result[duplicateIndex] = {
        ...result[duplicateIndex],
        status: incoming.status,
        error: incoming.error,
      } as TimelineEvent;
      return result;
    }
    const result = existing.map((event) => event.type === "assistant_message" && !event.isComplete
      ? { ...event, isComplete: true, isThinking: false }
      : event
    );
    return [...result, incoming];
  }

  if (incoming.type === "tool_result") {
    const result = [...existing];
    const callIndex = result.findLastIndex(
      (e) => e.type === "tool_call" && e.toolCallId === incoming.toolCallId
    );
    if (callIndex !== -1) {
      const call = result[callIndex] as Extract<TimelineEvent, { type: "tool_call" }>;
      result[callIndex] = {
        ...call,
        status: "success",
        durationMs: Math.max(0, incoming.timestamp - call.timestamp),
      };
      const todoEvent = incoming.display?.todo ? createTodoEvent(incoming.display.todo, incoming.timestamp) : null;
      return todoEvent ? [...result, todoEvent] : result;
    }
    const todoEvent = incoming.display?.todo ? createTodoEvent(incoming.display.todo, incoming.timestamp) : null;
    if (todoEvent) return [...existing, todoEvent];
  }

  if (incoming.type === "subagent") {
    const lastSubagentIndex = existing.findLastIndex((e) => e.type === "subagent");
    if (lastSubagentIndex !== -1) {
      const result = [...existing];
      result[lastSubagentIndex] = { ...result[lastSubagentIndex], ...incoming } as TimelineEvent;
      return result;
    }
  }

  if (incoming.type === "status_update") {
    const last = existing[existing.length - 1];
    if (last?.type === "status_update") {
      return [...existing.slice(0, -1), incoming];
    }
  }

  if (incoming.type === "change_summary") {
    const result = [...existing];
    const lastStatusIndex = result.findLastIndex((event) => event.type === "status_update");
    if (lastStatusIndex !== -1) {
      const [statusEvent] = result.splice(lastStatusIndex, 1);
      result.push(statusEvent);
    }
    return [...result, incoming];
  }

  return [...existing, incoming];
}

export function mapHistoryEvents(events: unknown[]): TimelineEvent[] {
  return events.reduce<TimelineEvent[]>((items, event) => {
    const mapped = mapStreamEvent(event);
    return mapped ? mergeEvents(items, mapped) : items;
  }, []);
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}
