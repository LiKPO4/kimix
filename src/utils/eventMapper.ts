import type { TimelineEvent, TodoItem } from "@/types/ui";
import { isLegacyKimiWorkDirError } from "./eventHelpers";
import { restoreAssistantProgressParagraphs } from "./assistantParagraphs";

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
const CLARIFICATION_ORIGINAL_MARKER = "\n\n用户原始需求：\n";
const LONG_TASK_ORIGINAL_MARKER = "\n\n用户初始需求：\n";
const SUPERPOWERS_BOOTSTRAP_MARKER = "\n\n【用户当前消息】\n";
const SUPERPOWERS_BOOTSTRAP_LEGACY_MARKER = "\n\n用户当前消息：\n";
const HOOK_CONTEXT_MARKER = "\n\n【用户当前消息】\n";

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

function appendAssistantContent(existingContent: string, incomingContent: string, paragraphBreak: boolean): string {
  if (!incomingContent) return existingContent;
  if (!existingContent) return incomingContent;
  if (
    !paragraphBreak ||
    existingContent.endsWith("\n") ||
    incomingContent.startsWith("\n") ||
    incomingContent.trim().length < 8
  ) {
    return existingContent + incomingContent;
  }
  return restoreAssistantProgressParagraphs(`${existingContent}\n\n${incomingContent}`);
}

function isAssistantProcessBoundary(event: TimelineEvent): boolean {
  return !["assistant_message", "status_update", "todo", "steer_message"].includes(event.type);
}

function normalizeComparableContent(content: string): string {
  return content.trim().replace(/\s+/g, " ");
}

function isMatchingSteerContent(existing: string, incoming: string): boolean {
  const existingContent = normalizeComparableContent(existing);
  const incomingContent = normalizeComparableContent(incoming);
  if (!existingContent || !incomingContent) return false;
  return existingContent === incomingContent ||
    existingContent.startsWith(incomingContent) ||
    incomingContent.startsWith(existingContent);
}

function appendBeforeTrailingSendingSteer(existing: TimelineEvent[], additions: TimelineEvent[]): TimelineEvent[] {
  const last = existing[existing.length - 1];
  if (last?.type !== "steer_message" || last.status !== "sending") return [...existing, ...additions];
  return [...existing.slice(0, -1), ...additions, last];
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

function stripKimixClarificationInstruction(content: string): string {
  if (content.startsWith("【Kimix Hooks 上下文】")) {
    const markerIndex = content.indexOf(HOOK_CONTEXT_MARKER);
    if (markerIndex === -1) return "";
    return stripKimixClarificationInstruction(content.slice(markerIndex + HOOK_CONTEXT_MARKER.length));
  }
  const trailingHookIndex = content.indexOf("\n\n【Kimix Hooks 上下文】");
  if (trailingHookIndex !== -1) {
    return stripKimixClarificationInstruction(content.slice(0, trailingHookIndex).trimEnd());
  }
  if (content.startsWith("【Kimix 隐藏 Superpowers Bootstrap】")) {
    const marker = content.includes(SUPERPOWERS_BOOTSTRAP_MARKER)
      ? SUPERPOWERS_BOOTSTRAP_MARKER
      : SUPERPOWERS_BOOTSTRAP_LEGACY_MARKER;
    const markerIndex = content.indexOf(marker);
    if (markerIndex === -1) return "";
    return stripKimixClarificationInstruction(content.slice(markerIndex + marker.length));
  }
  if (content.startsWith("<!-- kimix-superpowers-bootstrap -->")) {
    const markerIndex = content.indexOf(SUPERPOWERS_BOOTSTRAP_LEGACY_MARKER);
    if (markerIndex === -1) return "";
    return stripKimixClarificationInstruction(content.slice(markerIndex + SUPERPOWERS_BOOTSTRAP_LEGACY_MARKER.length));
  }
  if (content.startsWith("【Kimix 长程任务：")) {
    const markerIndex = content.indexOf(LONG_TASK_ORIGINAL_MARKER);
    if (markerIndex === -1) return "";
    return content.slice(markerIndex + LONG_TASK_ORIGINAL_MARKER.length);
  }
  if (!content.startsWith("【Kimix 需求澄清工具：")) return content;
  const markerIndex = content.indexOf(CLARIFICATION_ORIGINAL_MARKER);
  if (markerIndex === -1) return content;
  return stripKimixClarificationInstruction(content.slice(markerIndex + CLARIFICATION_ORIGINAL_MARKER.length));
}

function extractUserMessage(input: unknown): ExtractedUserMessage {
  if (isString(input)) return { content: stripKimixClarificationInstruction(input), images: [] };
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
    content: stripKimixClarificationInstruction(textParts.filter(Boolean).join("\n")),
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

function readTimestampCandidate(value: unknown): number | null {
  if (isNumber(value) && Number.isFinite(value) && value > 0) return value;
  if (!isString(value) || !value.trim()) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveEventTimestamp(...sources: Array<unknown>): number {
  for (const source of sources) {
    if (!isRecord(source)) continue;
    const candidates = [source.timestamp, source.createdAt, source.created_at, source.time, source.at];
    for (const candidate of candidates) {
      const resolved = readTimestampCandidate(candidate);
      if (resolved !== null) return resolved;
    }
  }
  return Date.now();
}

export function mapStreamEvent(event: unknown): TimelineEvent | null {
  if (!isRecord(event)) return null;
  const source = isRecord(event.message) ? event.message : event;
  const type = source.type;
  if (!isString(type)) return null;
  const payload = isRecord(source.payload) ? source.payload : {};
  const eventTimestamp = resolveEventTimestamp(source, payload);

  switch (type) {
    case "TurnBegin": {
      const userMessage = extractUserMessage(payload.user_input);
      if (!userMessage.content.trim() && userMessage.images.length === 0) return null;
      return {
        id: generateId(),
        type: "user_message",
        timestamp: eventTimestamp,
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
          timestamp: eventTimestamp,
          content: payload.text,
          isThinking: false,
          isComplete: false,
        };
      }
      if (partType === "think" && isString(payload.think)) {
        if (isKimixSyntheticThinking(payload.think)) return null;
        const id = generateId();
        const timestamp = eventTimestamp;
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
        timestamp: eventTimestamp,
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
        timestamp: eventTimestamp,
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
        timestamp: eventTimestamp,
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
        timestamp: eventTimestamp,
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
        timestamp: eventTimestamp,
        requestId: isString(payload.id) ? payload.id : "",
        toolName: isString(payload.sender) ? payload.sender : "unknown",
        description: isString(payload.description) ? payload.description : "需要审批",
        details: isString(payload.action) ? payload.action : "",
        riskLevel: "medium",
        status: "pending",
      };
    }

    case "QuestionRequest": {
      const questions = Array.isArray(payload.questions) ? payload.questions.filter(isRecord) : [];
      return {
        id: generateId(),
        type: "question_request",
        timestamp: eventTimestamp,
        requestId: isString(payload.id) ? payload.id : "",
        rpcRequestId: isString(payload.rpc_request_id) ? payload.rpc_request_id : (isString(payload.id) ? payload.id : ""),
        toolCallId: isString(payload.tool_call_id) ? payload.tool_call_id : "",
        questions: questions.map((question) => ({
          question: isString(question.question) ? question.question : "请选择后续处理方式？",
          header: isString(question.header) ? question.header : undefined,
          multiSelect: typeof question.multi_select === "boolean" ? question.multi_select : false,
          options: (Array.isArray(question.options) ? question.options.filter(isRecord) : []).map((option) => ({
            label: isString(option.label) ? option.label : "选项",
            description: isString(option.description) ? option.description : undefined,
          })),
        })),
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
        timestamp: eventTimestamp,
        tokenCount: isNumber(tokenUsage.output) ? tokenUsage.output : 0,
        inputTokenCount,
        contextSize,
        contextLimit: 256000,
        planMode: typeof payload.plan_mode === "boolean" ? payload.plan_mode : undefined,
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
        timestamp: eventTimestamp,
        projectPath: isString(payload.project_path) ? payload.project_path : undefined,
        files: mappedFiles,
        additions: mappedFiles.reduce((sum, file) => sum + (file.additions ?? 0), 0),
        deletions: mappedFiles.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
      };
    }

    case "HookTriggered": {
      return {
        id: generateId(),
        type: "hook",
        timestamp: eventTimestamp,
        phase: "triggered",
        eventName: isString(payload.event) ? payload.event : "Hook",
        target: isString(payload.target) ? payload.target : "",
        hookCount: isNumber(payload.hook_count) ? payload.hook_count : undefined,
      };
    }

    case "HookResolved": {
      return {
        id: generateId(),
        type: "hook",
        timestamp: eventTimestamp,
        phase: "resolved",
        eventName: isString(payload.event) ? payload.event : "Hook",
        target: isString(payload.target) ? payload.target : "",
        action: payload.action === "block" ? "block" : "allow",
        reason: isString(payload.reason) ? payload.reason : "",
        durationMs: isNumber(payload.duration_ms) ? payload.duration_ms : undefined,
      };
    }

    case "CompactionBegin":
      return {
        id: generateId(),
        type: "compaction",
        timestamp: eventTimestamp,
        phase: "begin",
      };

    case "CompactionEnd":
      return {
        id: generateId(),
        type: "compaction",
        timestamp: eventTimestamp,
        phase: "end",
      };

    case "SubagentEvent": {
      const subagentStatus = isString(payload.status) && ["running", "completed", "error"].includes(payload.status)
        ? payload.status
        : "running";
      return {
        id: generateId(),
        type: "subagent",
        timestamp: eventTimestamp,
        agentName: isString(payload.agent_name) ? payload.agent_name : "subagent",
        status: subagentStatus,
        events: [],
      };
    }

    case "TurnEnd": {
      return {
        id: generateId(),
        type: "assistant_message",
        timestamp: eventTimestamp,
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
      const message = isString(payload.message) ? payload.message : "未知错误";
      if (isLegacyKimiWorkDirError(message)) return null;
      return {
        id: generateId(),
        type: "error",
        timestamp: eventTimestamp,
        message,
        source: "sdk",
      };
    }

    default:
      return null;
  }
}

function isKimixSyntheticThinking(text: string) {
  const trimmed = text.trim();
  return trimmed.startsWith("【实时状态】") ||
    trimmed.includes("当前 prompt-mode 尚未实时写出思考正文") ||
    trimmed.includes("Kimix 会继续回放");
}

export function mergeEvents(existing: TimelineEvent[], incoming: TimelineEvent): TimelineEvent[] {
  // 忽略重复的用户消息（前端已提前添加，SDK 的 TurnBegin 会再发一次）
  if (incoming.type === "user_message") {
    // 取最近一条 user_message，若内容与 incoming 相同且在 10 秒内，则认为是重复
    const lastUserMessageIndex = existing.findLastIndex((e) => e.type === "user_message");
    if (lastUserMessageIndex >= 0) {
      const lastUser = existing[lastUserMessageIndex] as Extract<TimelineEvent, { type: "user_message" }>;
      if (Math.abs(lastUser.timestamp - incoming.timestamp) <= 10000) {
        const lastContent = normalizeUserContent(lastUser.content);
        const incomingContent = normalizeUserContent(incoming.content);
        if (lastContent === incomingContent && incomingContent.length > 0) {
          return existing;
        }
        if (lastContent === incomingContent && incomingContent.length === 0) {
          if (getUserImageSignature(lastUser) === getUserImageSignature(incoming)) {
            return existing;
          }
        }
      }
    }
  }

  // Merge streaming assistant messages
  if (incoming.type === "assistant_message") {
    if (incoming.isComplete && !incoming.content && !incoming.thinking) {
      const latestOpenIndex = existing.findLastIndex((e) => e.type === "assistant_message" && !e.isComplete);
      const hasRunningSubagent = existing.some((e) => e.type === "subagent" && e.status === "running");

      // TurnEnd 到达时，同时关闭 running 的 subagent 和未完成的 assistant_message
      // 因为 TurnEnd 代表整个 turn 结束，不应让 subagent 的 TurnEnd 提前结束主对话
      // 也不应让主对话完成后 subagent 还保持 running
      let base = existing;
      if (hasRunningSubagent) {
        base = existing.map((event) =>
          event.type === "subagent" && event.status === "running" ? { ...event, status: "completed" as const } : event
        );
      }

      if (latestOpenIndex === -1) {
        return base;
      }
      return base.flatMap((event, index) => {
        if (event.type !== "assistant_message" || event.isComplete) return event;
        const hasContent = event.content.trim().length > 0;
        const hasThinking = Boolean(
          event.thinking?.trim() ||
          event.thinkingParts?.some((part) => part.text.trim().length > 0)
        );
        if (!hasContent && !hasThinking && index !== latestOpenIndex) return [];
        return {
          ...event,
          isThinking: false,
          isComplete: true,
          durationMs: Math.max(0, Date.now() - event.timestamp),
        };
      });
    }

    const lastIndex = existing.findLastIndex(
      (e) => e.type === "assistant_message" && !e.isComplete
    );
    if (lastIndex !== -1) {
      const last = existing[lastIndex] as Extract<TimelineEvent, { type: "assistant_message" }>;
      const eventsAfterOpenAssistant = existing.slice(lastIndex + 1);
      const hasQuestionBoundary = eventsAfterOpenAssistant.some((event) => event.type === "question_request");
      if (hasQuestionBoundary && (incoming.content.trim() || incoming.thinking?.trim())) {
        return [...existing, incoming];
      }
      const shouldBreakParagraph = eventsAfterOpenAssistant.some(isAssistantProcessBoundary);
      const updated: typeof last = {
        ...last,
        agentRole: incoming.agentRole ?? last.agentRole,
        content: appendAssistantContent(last.content, incoming.content, shouldBreakParagraph),
        thinking: incoming.thinking ? (last.thinking ?? "") + incoming.thinking : last.thinking,
        thinkingParts: incoming.thinkingParts
          ? [...(last.thinkingParts ?? []), ...incoming.thinkingParts]
          : last.thinkingParts,
        isThinking: incoming.isComplete ? false : (last.isThinking || Boolean(incoming.thinking)),
        isComplete: incoming.isComplete,
        durationMs: incoming.isComplete ? Math.max(0, Date.now() - last.timestamp) : last.durationMs,
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
      (e) => e.type === "steer_message" && isMatchingSteerContent(e.content, incoming.content)
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
    return [...existing, incoming];
  }

  if (incoming.type === "question_request") {
    const matchingQuestionIndex = existing.findLastIndex((event) => (
      event.type === "question_request" &&
      Boolean(event.requestId) &&
      event.requestId === incoming.requestId
    ));
    if (matchingQuestionIndex !== -1) {
      const current = existing[matchingQuestionIndex] as Extract<TimelineEvent, { type: "question_request" }>;
      const result = [...existing];
      result[matchingQuestionIndex] = {
        ...incoming,
        id: current.id,
        timestamp: current.timestamp,
        status: incoming.status ?? current.status,
        answers: incoming.answers ?? current.answers,
      };
      return result;
    }
  }

  if (incoming.type === "tool_result") {
    const result = [...existing];
    const callIndex = result.findLastIndex(
      (e) => e.type === "tool_call" && e.toolCallId === incoming.toolCallId
    );
    const diffEvent = incoming.display?.diff
      ? {
          id: generateId(),
          type: "diff" as const,
          timestamp: incoming.timestamp,
          filePath: incoming.display.diff.path,
          oldText: incoming.display.diff.oldText,
          newText: incoming.display.diff.newText,
        }
      : null;
    const todoEvent = incoming.display?.todo ? createTodoEvent(incoming.display.todo, incoming.timestamp) : null;
    if (callIndex !== -1) {
      const call = result[callIndex] as Extract<TimelineEvent, { type: "tool_call" }>;
      result[callIndex] = {
        ...call,
        status: "success",
        result: incoming.result,
        durationMs: Math.max(0, incoming.timestamp - call.timestamp),
      };
      return appendBeforeTrailingSendingSteer(result, [...(diffEvent ? [diffEvent] : []), ...(todoEvent ? [todoEvent] : [])]);
    }
    if (diffEvent || todoEvent) return appendBeforeTrailingSendingSteer(existing, [...(diffEvent ? [diffEvent] : []), ...(todoEvent ? [todoEvent] : [])]);
  }

  if (incoming.type === "subagent") {
    const matchingSubagentIndex = existing.findLastIndex((e) => (
      e.type === "subagent" &&
      e.agentName === incoming.agentName &&
      e.status === "running"
    ));
    if (matchingSubagentIndex !== -1) {
      const result = [...existing];
      result[matchingSubagentIndex] = { ...result[matchingSubagentIndex], ...incoming } as TimelineEvent;
      return result;
    }
  }

  if (incoming.type === "status_update") {
    const last = existing[existing.length - 1];
    if (last?.type === "status_update") {
      return [...existing.slice(0, -1), incoming];
    }
    return appendBeforeTrailingSendingSteer(existing, [incoming]);
  }

  if (incoming.type === "change_summary") {
    const result = [...existing];
    const lastStatusIndex = result.findLastIndex((event) => event.type === "status_update");
    if (lastStatusIndex !== -1) {
      const [statusEvent] = result.splice(lastStatusIndex, 1);
      result.push(statusEvent);
    }
    return appendBeforeTrailingSendingSteer(result, [incoming]);
  }

  return appendBeforeTrailingSendingSteer(existing, [incoming]);
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
