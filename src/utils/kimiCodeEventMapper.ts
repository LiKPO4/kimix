import type { TimelineEvent, UserMessageImage } from "../types/ui";
import { extractUserMessage, mergeEvents, parseBlobRefUrl } from "./eventMapper";
import {
  formatKimiSkillActivationCommand,
  parseKimiAgentEnvelope,
  parseKimiGoalContinuation,
  parseKimiSkillActivation,
} from "./eventHelpers";

export interface KimiCodeEventMapperOptions {
  now?: number;
  idFactory?: () => string;
}

let nextId = 0;

function generateId(): string {
  nextId += 1;
  return `kimi-code-event-${Date.now()}-${nextId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isKimixFallbackSteer(event: Record<string, unknown>): boolean {
  return event.source === "kimix-fallback";
}

const FAILED_TURN_ENDED_REASONS = new Set([
  "failed",
  "error",
  "interrupted",
  "cancelled",
  "canceled",
  "aborted",
]);

function isFailedTurnEndedReason(reason: unknown): boolean {
  return typeof reason === "string" && FAILED_TURN_ENDED_REASONS.has(reason.toLowerCase());
}

function readTimestampCandidate(value: unknown): number | undefined {
  if (isNumber(value) && value > 0) return value;
  if (!isString(value) || !value.trim()) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getTimestamp(event: Record<string, unknown>, options: KimiCodeEventMapperOptions): number {
  for (const candidate of [event.timestamp, event.createdAt, event.created_at, event.time, event.at]) {
    const timestamp = readTimestampCandidate(candidate);
    if (timestamp !== undefined) return timestamp;
  }
  return options.now ?? Date.now();
}

function getId(options: KimiCodeEventMapperOptions): string {
  return options.idFactory?.() ?? generateId();
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeResult(event: Record<string, unknown>): unknown {
  if ("output" in event) return event.output;
  const result = event.result;
  if (isRecord(result) && "output" in result) return result.output;
  return result ?? "";
}

/**
 * 官方 tool_result 的失败标记：顶层 is_error/isError、嵌套 result 记录，
 * 或官方 /messages 内容分片（content parts）上的 is_error。
 * normalizeResult 只取 output，失败标记必须单独透传。
 */
function resolveToolResultIsError(event: Record<string, unknown>): boolean | undefined {
  const direct = event.is_error ?? event.isError;
  if (typeof direct === "boolean") return direct;
  const nested = isRecord(event.result) ? (event.result.is_error ?? event.result.isError) : undefined;
  if (typeof nested === "boolean") return nested;
  if (Array.isArray(event.content)) {
    for (const part of event.content) {
      if (isRecord(part)) {
        const flag = part.is_error ?? part.isError;
        if (typeof flag === "boolean") return flag;
      }
    }
  }
  return undefined;
}

function nestedString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const nestedValue = value[key];
  return isString(nestedValue) && nestedValue.trim() ? nestedValue.trim() : undefined;
}

function extractCompactionSummary(event: Record<string, unknown>): string | undefined {
  const direct =
    nestedString(event, "summary") ??
    nestedString(event, "compaction_summary") ??
    nestedString(event, "text") ??
    nestedString(event, "message");
  if (direct) return direct;

  const result =
    nestedString(event.result, "summary") ??
    nestedString(event.result, "compaction_summary") ??
    nestedString(event.result, "text") ??
    nestedString(event.result, "message");
  if (result) return result;

  const payload =
    nestedString(event.payload, "summary") ??
    nestedString(event.payload, "compaction_summary") ??
    nestedString(event.payload, "text") ??
    nestedString(event.payload, "message");
  return payload;
}

function normalizeToolDisplay(event: Record<string, unknown>): Extract<TimelineEvent, { type: "tool_result" }>["display"] | undefined {
  const result = isRecord(event.result) ? event.result : {};
  const output = "output" in event ? event.output : result.output;
  const commandDisplay = isRecord(event.display)
    ? event.display
    : isRecord(result.display)
      ? result.display
      : {};
  const displayBlocks = Array.isArray(event.display)
    ? event.display
    : Array.isArray(result.display)
      ? result.display
      : Array.isArray(output)
        ? output
        : [];
  const display: Extract<TimelineEvent, { type: "tool_result" }>["display"] = {};
  if (isString(commandDisplay.kind)) display.kind = commandDisplay.kind;
  if (isString(commandDisplay.command)) display.command = commandDisplay.command;
  if (isString(commandDisplay.cwd)) display.cwd = commandDisplay.cwd;
  if (isString(commandDisplay.description)) display.description = commandDisplay.description;
  if (isString(commandDisplay.language)) display.language = commandDisplay.language;
  if (displayBlocks.length === 0) return Object.keys(display).length > 0 ? display : undefined;

  const blocks = displayBlocks.filter(isRecord);
  const diffBlock = blocks.find((block) => block.type === "diff");
  const todoBlock = blocks.find((block) => block.type === "todo");

  if (diffBlock) {
    const path = isString(diffBlock.path) ? diffBlock.path : undefined;
    const oldText = isString(diffBlock.old_text)
      ? diffBlock.old_text
      : isString(diffBlock.oldText)
        ? diffBlock.oldText
        : undefined;
    const newText = isString(diffBlock.new_text)
      ? diffBlock.new_text
      : isString(diffBlock.newText)
        ? diffBlock.newText
        : undefined;
    if (path && oldText !== undefined && newText !== undefined) {
      display.diff = { path, oldText, newText };
    }
  }

  if (todoBlock && Array.isArray(todoBlock.items)) {
    display.todo = todoBlock.items.filter(isRecord).map((item, index) => {
      const status = isString(item.status) && ["pending", "in_progress", "done"].includes(item.status)
        ? item.status as "pending" | "in_progress" | "done"
        : "pending";
      return {
        id: isString(item.id) ? item.id : `todo-${index}`,
        content: isString(item.content) ? item.content : isString(item.title) ? item.title : "",
        status,
      };
    });
  }

  return Object.keys(display).length > 0 ? display : undefined;
}

function normalizeApprovalDisplay(display: Record<string, unknown>): Extract<TimelineEvent, { type: "approval_request" }>["display"] | undefined {
  const normalized: Extract<TimelineEvent, { type: "approval_request" }>["display"] = {};
  if (isString(display.kind)) normalized.kind = display.kind;
  if (isString(display.title)) normalized.title = display.title;
  if (isString(display.description)) normalized.description = display.description;
  if (isString(display.plan)) normalized.plan = display.plan;
  if (isString(display.path)) normalized.path = display.path;
  if (Array.isArray(display.options)) {
    const options = display.options.filter(isRecord).map((option) => ({
      label: isString(option.label) ? option.label : "",
      description: isString(option.description) ? option.description : undefined,
    })).filter((option) => option.label.trim());
    if (options.length > 0) normalized.options = options;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeToolProgress(event: Record<string, unknown>): string {
  const update = isRecord(event.update) ? event.update : {};
  const text = isString(update.text) ? update.text : "";
  if (!text) return "";
  const kind = isString(update.kind) ? update.kind : "";
  return kind === "stderr" ? `[stderr] ${text}` : text;
}

function normalizeKimiCodeEvent(event: Record<string, unknown>): Record<string, unknown> {
  if (event.type === "context.append_loop_event" && isRecord(event.event)) {
    return {
      ...event.event,
      agentId: isString(event.event.agentId) ? event.event.agentId : event.agentId,
      timestamp: event.event.timestamp ?? event.timestamp,
      createdAt: event.event.createdAt ?? event.createdAt,
      created_at: event.event.created_at ?? event.created_at,
      time: event.event.time ?? event.time,
      at: event.event.at ?? event.at,
      kimixTerminalScope: event.kimixTerminalScope,
      snapshotReplay: event.event.snapshotReplay ?? event.snapshotReplay,
      snapshotRole: event.event.snapshotRole ?? event.snapshotRole,
      snapshotMessageText: event.event.snapshotMessageText ?? event.snapshotMessageText,
      snapshotMessageId: isString(event.event.snapshotMessageId)
        ? event.event.snapshotMessageId
        : event.snapshotMessageId,
      snapshotMessageIdStable: typeof event.event.snapshotMessageIdStable === "boolean"
        ? event.event.snapshotMessageIdStable
        : event.snapshotMessageIdStable,
    };
  }
  return event;
}

function getAgentId(event: Record<string, unknown>): string | undefined {
  return isString(event.agentId) && event.agentId !== "main" ? event.agentId : undefined;
}

function getSnapshotMessageId(event: Record<string, unknown>): string | undefined {
  return isString(event.snapshotMessageId) && event.snapshotMessageId
    ? event.snapshotMessageId
    : undefined;
}

function getSnapshotMessageIdStable(event: Record<string, unknown>): boolean | undefined {
  return typeof event.snapshotMessageIdStable === "boolean"
    ? event.snapshotMessageIdStable
    : undefined;
}

function isCompletionBarrierReplay(event: Record<string, unknown>): boolean {
  return event.kimixPromptCompletionBarrier === true;
}

function isCompletionBarrierFullBody(event: Record<string, unknown>): boolean {
  return event.kimixPromptCompletionFullBody === true;
}

function getContentPart(event: Record<string, unknown>): Record<string, unknown> {
  return isRecord(event.part) ? event.part : event;
}

/**
 * 官方文件型图片引用解析：kimi-file://f_xxx 或 f_ 前缀 id → server file id。
 * 官方 Web 以文件内容寻址渲染，本地端用同一 id 经 kimix-media: 流式取回，不依赖本地绝对路径。
 */
function resolveImageFileId(id: string | undefined, url: string | undefined): string | undefined {
  const fromUrl = url?.match(/^kimi-file:\/\/(f_[A-Za-z0-9-]+)/)?.[1];
  if (fromUrl) return fromUrl;
  if (id && /^f_[A-Za-z0-9-]+$/.test(id)) return id;
  return undefined;
}

function extractPromptMessage(input: unknown): { content: string; images: UserMessageImage[] } {
  if (isString(input)) return { content: input, images: [] };
  if (!Array.isArray(input)) return { content: "", images: [] };

  const textParts: string[] = [];
  const images: UserMessageImage[] = [];
  input.forEach((part, index) => {
    if (!isRecord(part)) return;
    if (part.type === "text" && isString(part.text)) {
      textParts.push(part.text);
      return;
    }
    if (part.type === "image_url") {
      const imageUrl = isRecord(part.imageUrl)
        ? part.imageUrl
        : (isRecord(part.image_url) ? part.image_url : {});
      const url = isString(imageUrl.url) ? imageUrl.url : undefined;
      const id = isString(imageUrl.id) ? imageUrl.id : undefined;
      const blob = parseBlobRefUrl(url);
      images.push({ name: id || `图片 ${index + 1}`, dataUrl: url?.startsWith("data:image/") ? url : undefined, fileId: resolveImageFileId(id, url), blobRef: blob?.hash, mediaType: blob?.mediaType });
      return;
    }
    if (part.type === "image" && isRecord(part.source)) {
      const mediaType = isString(part.source.media_type)
        ? part.source.media_type
        : isString(part.source.mediaType)
          ? part.source.mediaType
          : "image/png";
      const data = isString(part.source.data) ? part.source.data : undefined;
      const url = isString(part.source.url) ? part.source.url : undefined;
      const id = isString(part.id)
        ? part.id
        : isString(part.source.file_id)
          ? part.source.file_id
          : undefined;
      const dataUrl = data
        ? (data.startsWith("data:image/") ? data : `data:${mediaType};base64,${data}`)
        : url?.startsWith("data:image/")
          ? url
          : undefined;
      const blob = parseBlobRefUrl(url);
      images.push({ name: id || `图片 ${index + 1}`, dataUrl, fileId: resolveImageFileId(id, url ?? dataUrl), blobRef: blob?.hash, mediaType: blob?.mediaType });
      return;
    }
    if (part.type === "video_url") {
      const videoUrl = isRecord(part.videoUrl)
        ? part.videoUrl
        : (isRecord(part.video_url) ? part.video_url : {});
      const url = isString(videoUrl.url) ? videoUrl.url : undefined;
      const id = isString(videoUrl.id) ? videoUrl.id : undefined;
      const blob = parseBlobRefUrl(url);
      images.push({ kind: "video", name: id || `视频 ${index + 1}`, dataUrl: url?.startsWith("data:video/") ? url : undefined, url: url && !url.startsWith("data:") && !blob ? url : undefined, blobRef: blob?.hash, mediaType: blob?.mediaType });
      return;
    }
    if (part.type === "video" && isRecord(part.source)) {
      const mediaType = isString(part.source.media_type) ? part.source.media_type : "video/mp4";
      const data = isString(part.source.data) ? part.source.data : undefined;
      const url = isString(part.source.url) ? part.source.url : undefined;
      const blob = parseBlobRefUrl(url);
      images.push({
        kind: "video",
        name: isString(part.name) ? part.name : `视频 ${index + 1}`,
        dataUrl: data ? (data.startsWith("data:video/") ? data : `data:${mediaType};base64,${data}`) : undefined,
        fileId: isString(part.source.file_id) ? part.source.file_id : undefined,
        mediaType: blob?.mediaType ?? mediaType,
        url: url && !url.startsWith("data:") && !blob ? url : undefined,
        blobRef: blob?.hash,
      });
    }
  });
  return { content: textParts.filter(Boolean).join("\n"), images };
}

function usageOutput(usage: unknown): number | undefined {
  if (!isRecord(usage)) return undefined;
  return isNumber(usage.output) ? usage.output : undefined;
}

function usageInput(usage: unknown): number | undefined {
  if (!isRecord(usage)) return undefined;
  const inputOther = isNumber(usage.inputOther) ? usage.inputOther : 0;
  const inputCacheRead = isNumber(usage.inputCacheRead) ? usage.inputCacheRead : 0;
  const inputCacheCreation = isNumber(usage.inputCacheCreation) ? usage.inputCacheCreation : 0;
  const total = inputOther + inputCacheRead + inputCacheCreation;
  return total > 0 ? total : undefined;
}

function statusMessageForStep(type: string, _event: Record<string, unknown>): string {
  if (type === "turn.step.retrying") {
    return "正在重试";
  }
  if (type === "turn.step.interrupted") {
    return "输出打断";
  }
  return "状态更新";
}

function mapSubagentEvent(
  event: Record<string, unknown>,
  status: Extract<TimelineEvent, { type: "subagent" }>["status"],
  options: KimiCodeEventMapperOptions,
): TimelineEvent {
  const subagentId = isString(event.subagentId) ? event.subagentId : undefined;
  return {
    id: getId(options),
    type: "subagent",
    timestamp: getTimestamp(event, options),
    agentId: subagentId,
    parentToolCallId: isString(event.parentToolCallId) ? event.parentToolCallId : undefined,
    swarmIndex: isNumber(event.swarmIndex) ? event.swarmIndex : undefined,
    description: isString(event.description) ? event.description : undefined,
    agentName: isString(event.subagentName) ? event.subagentName : "子代理",
    modelAlias: isString(event.modelAlias) ? event.modelAlias : undefined,
    thinkingEffort: isString(event.thinkingEffort) ? event.thinkingEffort : undefined,
    status,
    resultSummary: isString(event.resultSummary) ? event.resultSummary : undefined,
    error: isString(event.error) ? event.error : undefined,
    events: [],
  };
}

export function mapKimiCodeEvent(
  rawEvent: unknown,
  options: KimiCodeEventMapperOptions = {},
): TimelineEvent | null {
  if (!isRecord(rawEvent) || !isString(rawEvent.type)) return null;

  const event = normalizeKimiCodeEvent(rawEvent);
  if (!isString(event.type)) return null;

  const timestamp = getTimestamp(event, options);
  const type = event.type;

  switch (type) {
    case "turn.started":
      // In-flight snapshot frames carry only { type: "turn.started" } — no
      // user_input and no stable snapshotMessageId to map. The UI keeps its
      // own optimistic user row, so the turn boundary itself stays filtered.
      return null;

    case "TurnBegin": {
      const payload = isRecord(event.payload) ? event.payload : {};
      const userMessage = extractUserMessage(
        event.user_input ??
        event.userInput ??
        event.input ??
        event.text ??
        payload.user_input ??
        payload.userInput ??
        payload.input ??
        payload.text,
      );
      if (!userMessage.content.trim() && userMessage.images.length === 0) return null;
      const envelope = parseKimiAgentEnvelope(userMessage.content);
      if (envelope) {
        return {
          id: getId(options),
          type: "status_update",
          timestamp,
          message: envelope.summary,
          source: "runtime",
          tone: envelope.tone,
          notification: envelope.notification,
        };
      }
      // goal 续跑是系统触发消息（origin 或文本前缀），折叠为状态摘要并保留
      // 事件位置以维持轮次边界，不渲染原文。
      const goalContinuation = parseKimiGoalContinuation(userMessage.content, event.origin ?? payload.origin);
      if (goalContinuation) {
        return {
          id: getId(options),
          type: "status_update",
          timestamp,
          message: "目标续跑",
          source: "runtime",
          tone: "info",
        };
      }
      const skillActivation = parseKimiSkillActivation(userMessage.content);
      if (skillActivation?.trigger === "model-tool") {
        return {
          id: getId(options),
          type: "status_update",
          timestamp,
          message: `已调用 Skill：${skillActivation.name}`,
          source: "skill",
          tone: "info",
        };
      }
      const snapshotMessageId = getSnapshotMessageId(event);
      return {
        id: snapshotMessageId && getSnapshotMessageIdStable(event) === true
          ? `user:${snapshotMessageId}`
          : getId(options),
        type: "user_message",
        timestamp,
        content: skillActivation
          ? formatKimiSkillActivationCommand(skillActivation.name, skillActivation.args)
          : userMessage.content,
        images: userMessage.images,
        snapshotMessageId: getSnapshotMessageId(event),
        snapshotMessageIdStable: getSnapshotMessageIdStable(event),
        roomMessageId: userMessage.deliveryIdentity?.roomMessageId,
        agentTurnId: userMessage.deliveryIdentity?.agentTurnId,
        dispatchAttemptId: userMessage.deliveryIdentity?.dispatchAttemptId,
      };
    }

    case "assistant.delta": {
      const delta = isString(event.delta) ? event.delta : "";
      if (!delta) return null;
      return {
        id: getId(options),
        type: "assistant_message",
        timestamp,
        snapshotMessageId: getSnapshotMessageId(event),
        snapshotMessageIdStable: getSnapshotMessageIdStable(event),
        completionBarrierReplay: isCompletionBarrierReplay(event),
        completionBarrierFullBody: isCompletionBarrierFullBody(event),
        streamOffset: typeof event.offset === "number" ? event.offset : undefined,
        agentId: getAgentId(event),
        content: delta,
        model: isString(event.model) ? event.model : undefined,
        isThinking: false,
        isComplete: false,
      };
    }

    case "content.part": {
      const part = getContentPart(event);
      if (part.type === "text") {
        const text = isString(part.text) ? part.text : "";
        if (!text) return null;
        return {
          id: getId(options),
          type: "assistant_message",
          timestamp,
          snapshotMessageId: getSnapshotMessageId(event),
          snapshotMessageIdStable: getSnapshotMessageIdStable(event),
          completionBarrierReplay: isCompletionBarrierReplay(event),
          completionBarrierFullBody: isCompletionBarrierFullBody(event),
          agentId: getAgentId(event),
          content: text,
          model: isString(event.model) ? event.model : undefined,
          isThinking: false,
          isComplete: false,
        };
      }
      if (part.type === "think" || part.type === "thinking") {
        const think = isString(part.think)
          ? part.think
          : isString(part.thinking)
            ? part.thinking
            : "";
        if (!think) return null;
        const signature = isString(part.signature) ? part.signature : undefined;
        return {
          id: getId(options),
          type: "assistant_message",
          timestamp,
          snapshotMessageId: getSnapshotMessageId(event),
          snapshotMessageIdStable: getSnapshotMessageIdStable(event),
          completionBarrierReplay: isCompletionBarrierReplay(event),
          completionBarrierFullBody: isCompletionBarrierFullBody(event),
          agentId: getAgentId(event),
          content: "",
          thinking: think,
          thinkingParts: [{ id: getId(options), timestamp, text: think, signature }],
          model: isString(event.model) ? event.model : undefined,
          isThinking: true,
          isComplete: false,
        };
      }
      return null;
    }

    case "thinking.delta": {
      const delta = isString(event.delta) ? event.delta : "";
      if (!delta) return null;
      const signature = isString(event.signature) ? event.signature : undefined;
      return {
        id: getId(options),
        type: "assistant_message",
        timestamp,
        snapshotMessageId: getSnapshotMessageId(event),
        snapshotMessageIdStable: getSnapshotMessageIdStable(event),
        completionBarrierReplay: isCompletionBarrierReplay(event),
        streamOffset: typeof event.offset === "number" ? event.offset : undefined,
        agentId: getAgentId(event),
        content: "",
        thinking: delta,
        thinkingParts: [{ id: getId(options), timestamp, text: delta, signature }],
        model: isString(event.model) ? event.model : undefined,
        isThinking: true,
        isComplete: false,
      };
    }

    case "SteerInput":
    case "steer.input":
    case "turn.steer": {
      const payload = isRecord(event.payload) ? event.payload : {};
      const message = extractPromptMessage(
        event.user_input ??
        event.userInput ??
        event.input ??
        event.text ??
        payload.user_input ??
        payload.userInput ??
        payload.input ??
        payload.text,
      );
      if (!message.content.trim() && message.images.length === 0) return null;
      return {
        id: getId(options),
        type: "steer_message",
        timestamp,
        content: message.content || (message.images.some((media) => media.kind === "video") ? "[视频]" : "[图片]"),
        images: message.images,
        status: isKimixFallbackSteer(event) ? "accepted" : "sent",
      };
    }

    case "turn.ended":
      if (event.reason === "filtered") {
        return {
          id: getId(options),
          type: "error",
          timestamp,
          message: "模型安全策略拦截了本轮回复",
          source: "sdk",
          canDismiss: true,
        };
      }
      // Successful Server turn boundaries (reason=completed/missing) inside a
      // prompt are step boundaries, not prompt completion — keep them filtered
      // so the Assistant card stays open until prompt.completed. Failed /
      // cancelled / interrupted boundaries must still produce a terminal
      // assistant_message marker so buildRenderItems can settle the turn
      // (turnSettled requires every assistant isComplete=true); otherwise a
      // failed live turn keeps an incomplete placeholder forever and the
      // message header disappears.
      if (event.kimixTerminalScope === "prompt" && !isFailedTurnEndedReason(event.reason)) return null;
      return {
        id: getId(options),
        type: "assistant_message",
        timestamp,
        snapshotMessageId: getSnapshotMessageId(event),
        snapshotMessageIdStable: getSnapshotMessageIdStable(event),
        agentId: getAgentId(event),
        content: "",
        model: isString(event.model) ? event.model : undefined,
        isThinking: false,
        isComplete: true,
      };

    case "prompt.completed":
      // This is the authoritative delivery barrier for the main prompt. Map a
      // content-less completion marker so useEventStream atomically commits the
      // active draft before formal completion. ChatThread keeps the marker
      // visually open while the Host-managed continuation grace is running.
      return {
        id: getId(options),
        type: "assistant_message",
        timestamp,
        agentId: getAgentId(event),
        content: "",
        model: isString(event.model) ? event.model : undefined,
        isThinking: false,
        isComplete: true,
        durationMs: typeof event.durationMs === "number" ? event.durationMs : undefined,
      };

    case "step.end": {
      const finishReason = isString(event.finishReason) ? event.finishReason : "";
      if (finishReason !== "end_turn" || event.kimixTerminalScope === "prompt") return null;
      return {
        id: getId(options),
        type: "assistant_message",
        timestamp,
        snapshotMessageId: getSnapshotMessageId(event),
        snapshotMessageIdStable: getSnapshotMessageIdStable(event),
        agentId: getAgentId(event),
        content: "",
        model: isString(event.model) ? event.model : undefined,
        isThinking: false,
        isComplete: true,
      };
    }

    case "tool.call.delta": {
      const toolCallId = isString(event.toolCallId) ? event.toolCallId : "";
      const rawArguments = isString(event.argumentsPart) ? event.argumentsPart : "";
      if (!toolCallId && !rawArguments) return null;
      return {
        id: getId(options),
        type: "tool_call",
        timestamp,
        agentId: getAgentId(event),
        toolCallId,
        toolName: isString(event.name) ? event.name : "unknown",
        status: "running",
        arguments: parseJsonObject(rawArguments),
        rawArguments,
        description: isString(event.description) ? event.description : undefined,
        display: normalizeToolDisplay(event),
      };
    }

    case "tool.call":
    case "tool.call.started": {
      const args = isRecord(event.args) ? event.args : {};
      return {
        id: getId(options),
        type: "tool_call",
        timestamp,
        agentId: getAgentId(event),
        toolCallId: isString(event.toolCallId) ? event.toolCallId : "",
        toolName: isString(event.name) ? event.name : "unknown",
        status: "running",
        arguments: args,
        rawArguments: Object.keys(args).length > 0 ? JSON.stringify(args) : undefined,
        description: isString(event.description) ? event.description : undefined,
        display: normalizeToolDisplay(event),
      };
    }

    case "tool.progress": {
      const output = normalizeToolProgress(event);
      if (!output) return null;
      return {
        id: getId(options),
        type: "tool_call",
        timestamp,
        agentId: getAgentId(event),
        toolCallId: isString(event.toolCallId) ? event.toolCallId : "",
        toolName: isString(event.name) ? event.name : "unknown",
        status: "running",
        arguments: {},
        result: output,
      };
    }

    case "tool.result":
      return {
        id: getId(options),
        type: "tool_result",
        timestamp,
        agentId: getAgentId(event),
        toolCallId: isString(event.toolCallId) ? event.toolCallId : "",
        toolName: isString(event.name) ? event.name : "unknown",
        result: normalizeResult(event),
        isError: resolveToolResultIsError(event),
        display: normalizeToolDisplay(event),
      };

    case "agent.status.updated": {
      const currentTurnUsage = isRecord(event.usage) && isRecord(event.usage.currentTurn)
        ? event.usage.currentTurn
        : undefined;
      return {
        id: getId(options),
        type: "status_update",
        timestamp,
        agentId: getAgentId(event),
        tokenCount: usageOutput(currentTurnUsage),
        inputTokenCount: usageInput(currentTurnUsage),
        contextSize: isNumber(event.contextTokens) ? event.contextTokens : undefined,
        contextLimit: isNumber(event.maxContextTokens) ? event.maxContextTokens : undefined,
        planMode: typeof event.planMode === "boolean" ? event.planMode : undefined,
        swarmMode: typeof event.swarmMode === "boolean" ? event.swarmMode : undefined,
        source: event.kimixStatusRefresh === true ? "status_refresh" : undefined,
        message: currentTurnUsage && isString(event.model) ? `模型：${event.model}` : undefined,
      };
    }

    case "usage.record": {
      const usage = isRecord(event.usage) ? event.usage : {};
      return {
        id: getId(options),
        type: "status_update",
        timestamp,
        tokenCount: usageOutput(usage),
        inputTokenCount: usageInput(usage),
        usageScope: event.usageScope === "turn" || event.usageScope === "session" ? event.usageScope : undefined,
        message: isString(event.model) ? `模型：${event.model}` : undefined,
      };
    }

    case "turn.step.started":
      return null;

    case "turn.step.completed": {
      const finishReason = isString(event.finishReason)
        ? event.finishReason
        : isString(event.finish_reason)
          ? event.finish_reason
          : "";
      if (finishReason !== "end_turn" || event.kimixTerminalScope === "prompt") return null;
      return {
        id: getId(options),
        type: "assistant_message",
        timestamp,
        agentId: getAgentId(event),
        content: "",
        model: isString(event.model) ? event.model : undefined,
        isThinking: false,
        isComplete: true,
      };
    }

    case "turn.step.retrying":
    case "turn.step.interrupted":
      return {
        id: getId(options),
        type: "status_update",
        timestamp,
        agentId: getAgentId(event),
        step: isNumber(event.step) ? event.step : undefined,
        message: statusMessageForStep(type, event),
      };

    case "subagent.spawned":
      return mapSubagentEvent(event, "queued", options);

    case "subagent.started":
      return mapSubagentEvent(event, "running", options);

    case "subagent.suspended":
      return mapSubagentEvent(event, "suspended", options);

    case "subagent.completed":
      return mapSubagentEvent(event, "completed", options);

    case "subagent.failed":
      return mapSubagentEvent(event, "error", options);

    case "compaction.started":
    case "full_compaction.begin":
      return {
        id: getId(options),
        type: "compaction",
        timestamp,
        phase: "begin",
        source: event.source === "auto" || event.source === "manual" ? event.source : undefined,
      };

    case "compaction.completed":
    case "full_compaction.complete":
      return {
        id: getId(options),
        type: "compaction",
        timestamp,
        phase: "end",
        outcome: "completed",
        summary: extractCompactionSummary(event),
      };

    case "compaction.cancelled":
    case "full_compaction.cancel":
      return {
        id: getId(options),
        type: "compaction",
        timestamp,
        phase: "end",
        outcome: "cancelled",
        summary: extractCompactionSummary(event),
      };

    case "error":
      return {
        id: getId(options),
        type: "error",
        timestamp,
        message: isString(event.message) ? event.message : "Kimi Code error",
        source: "sdk",
        canDismiss: true,
      };

    case "warning":
      return {
        id: getId(options),
        type: "status_update",
        timestamp,
        message: isString(event.message) ? event.message : "Kimi Code warning",
      };

    default:
      return null;
  }
}

export function mapKimiCodeApprovalRequest(
  request: unknown,
  options: KimiCodeEventMapperOptions = {},
): TimelineEvent | null {
  if (!isRecord(request)) return null;
  const display = isRecord(request.display) ? request.display : {};
  // Server 审批载荷把工具输入预览放在 tool_input_display（string 或 record），
  // 合成进 display，让审批卡能显示真实命令/路径而不是兜底文案。
  const toolInputDisplay = request.tool_input_display;
  let normalizedDisplay = normalizeApprovalDisplay(
    isRecord(toolInputDisplay) ? { ...toolInputDisplay, ...display } : display,
  );
  if (isString(toolInputDisplay) && toolInputDisplay.trim() && !normalizedDisplay?.description) {
    normalizedDisplay = { ...(normalizedDisplay ?? {}), description: toolInputDisplay.trim() };
  }
  const timestamp = options.now ?? readTimestampCandidate(request.created_at) ?? Date.now();
  const action = isString(request.action) ? request.action : "";

  return {
    id: getId(options),
    type: "approval_request",
    timestamp,
    requestId: isString(request.toolCallId) ? request.toolCallId : getId(options),
    toolName: isString(request.toolName)
      ? request.toolName
      : (isString(request.tool_name) ? request.tool_name : "unknown"),
    description: normalizedDisplay?.description ?? normalizedDisplay?.title ?? (normalizedDisplay?.kind === "plan_review" ? "审阅计划" : "需要审批"),
    details: action,
    riskLevel: action === "write" || action === "delete" ? "high" : "medium",
    status: "pending",
    display: normalizedDisplay,
  };
}

export function mapKimiCodeQuestionRequest(
  request: unknown,
  options: KimiCodeEventMapperOptions = {},
): TimelineEvent | null {
  if (!isRecord(request)) return null;
  const rawQuestions = Array.isArray(request.questions)
    ? request.questions
    : (Array.isArray(request.fields) ? request.fields : []);
  const questions = rawQuestions.filter(isRecord);
  const timestamp = options.now ?? readTimestampCandidate(request.created_at) ?? Date.now();
  const requestId = isString(request.toolCallId) ? request.toolCallId : getId(options);

  return {
    id: getId(options),
    type: "question_request",
    timestamp,
    requestId,
    rpcRequestId: requestId,
    toolCallId: isString(request.toolCallId) ? request.toolCallId : "",
    questions: questions.map((question) => {
      // "其他"选项字段 camelCase/snake_case 都可能出现，逐一探测
      const otherLabel = isString(question.otherLabel)
        ? question.otherLabel
        : (isString(question.other_label) ? question.other_label : undefined);
      const otherId = isString(question.otherId)
        ? question.otherId
        : (isString(question.other_id) ? question.other_id : undefined);
      const otherDescription = isString(question.otherDescription)
        ? question.otherDescription
        : (isString(question.other_description) ? question.other_description : undefined);
      return {
        id: isString(question.id) ? question.id : undefined,
        question: isString(question.question)
          ? question.question
          : (isString(question.label) ? question.label : "请选择后续处理方式？"),
        header: isString(question.header) ? question.header : undefined,
        multiSelect: typeof question.multiSelect === "boolean"
          ? question.multiSelect
          : (typeof question.multi_select === "boolean" ? question.multi_select : false),
        options: [
          ...(Array.isArray(question.options) ? question.options.filter(isRecord) : []).map((option) => ({
            id: isString(option.id) ? option.id : undefined,
            label: isString(option.label) ? option.label : "选项",
            description: isString(option.description) ? option.description : undefined,
          })),
          ...(otherLabel ? [{
            id: otherId,
            label: otherLabel,
            description: otherDescription,
          }] : []),
        ],
      };
    }),
    status: "pending",
  };
}

export function reduceKimiCodeEvents(
  initialEvents: TimelineEvent[],
  rawEvents: readonly unknown[],
  options: KimiCodeEventMapperOptions = {},
): TimelineEvent[] {
  return rawEvents.reduce<TimelineEvent[]>((events, rawEvent) => {
    const mapped = mapKimiCodeEvent(rawEvent, options);
    return mapped ? mergeEvents(events, mapped) : events;
  }, initialEvents);
}
