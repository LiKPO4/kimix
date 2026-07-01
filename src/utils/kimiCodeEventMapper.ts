import type { TimelineEvent } from "../types/ui";
import { mergeEvents } from "./eventMapper";

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

function getTimestamp(event: Record<string, unknown>, options: KimiCodeEventMapperOptions): number {
  return isNumber(event.time) ? event.time : options.now ?? Date.now();
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

function normalizeToolDisplay(event: Record<string, unknown>): Extract<TimelineEvent, { type: "tool_result" }>["display"] | undefined {
  const result = isRecord(event.result) ? event.result : {};
  const output = "output" in event ? event.output : result.output;
  const displayBlocks = Array.isArray(event.display)
    ? event.display
    : Array.isArray(result.display)
      ? result.display
      : Array.isArray(output)
        ? output
        : [];
  if (displayBlocks.length === 0) return undefined;

  const blocks = displayBlocks.filter(isRecord);
  const diffBlock = blocks.find((block) => block.type === "diff");
  const todoBlock = blocks.find((block) => block.type === "todo");
  let display: Extract<TimelineEvent, { type: "tool_result" }>["display"] | undefined;

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
      display = { diff: { path, oldText, newText } };
    }
  }

  if (todoBlock && Array.isArray(todoBlock.items)) {
    display = {
      ...display,
      todo: todoBlock.items.filter(isRecord).map((item, index) => {
        const status = isString(item.status) && ["pending", "in_progress", "done"].includes(item.status)
          ? item.status as "pending" | "in_progress" | "done"
          : "pending";
        return {
          id: isString(item.id) ? item.id : `todo-${index}`,
          content: isString(item.content) ? item.content : isString(item.title) ? item.title : "",
          status,
        };
      }),
    };
  }

  return display;
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
      time: isNumber(event.event.time) ? event.event.time : event.time,
    };
  }
  return event;
}

function getAgentId(event: Record<string, unknown>): string | undefined {
  return isString(event.agentId) && event.agentId !== "main" ? event.agentId : undefined;
}

function getContentPart(event: Record<string, unknown>): Record<string, unknown> {
  return isRecord(event.part) ? event.part : event;
}

function extractPromptMessage(input: unknown): { content: string; images: { name: string; dataUrl?: string }[] } {
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
      const imageUrl = isRecord(part.imageUrl)
        ? part.imageUrl
        : (isRecord(part.image_url) ? part.image_url : {});
      const url = isString(imageUrl.url) ? imageUrl.url : undefined;
      const id = isString(imageUrl.id) ? imageUrl.id : undefined;
      images.push({ name: id || `图片 ${index + 1}`, dataUrl: url?.startsWith("data:image/") ? url : undefined });
      if (!url) textParts.push("[图片]");
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

function statusMessageForStep(type: string, event: Record<string, unknown>): string {
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
    agentName: isString(event.subagentName) ? event.subagentName : (subagentId ?? "subagent"),
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
      return null;

    case "assistant.delta": {
      const delta = isString(event.delta) ? event.delta : "";
      if (!delta) return null;
      return {
        id: getId(options),
        type: "assistant_message",
        timestamp,
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
          agentId: getAgentId(event),
          content: text,
          model: isString(event.model) ? event.model : undefined,
          isThinking: false,
          isComplete: false,
        };
      }
      if (part.type === "think") {
        const think = isString(part.think) ? part.think : "";
        if (!think) return null;
        return {
          id: getId(options),
          type: "assistant_message",
          timestamp,
          agentId: getAgentId(event),
          content: "",
          thinking: think,
          thinkingParts: [{ id: getId(options), timestamp, text: think }],
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
      return {
        id: getId(options),
        type: "assistant_message",
        timestamp,
        agentId: getAgentId(event),
        content: "",
        thinking: delta,
        thinkingParts: [{ id: getId(options), timestamp, text: delta }],
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
        content: message.content || "[图片]",
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

    case "step.end": {
      const finishReason = isString(event.finishReason) ? event.finishReason : "";
      if (finishReason !== "end_turn") return null;
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
        message: isString(event.model) ? `模型：${event.model}` : undefined,
      };
    }

    case "turn.step.started":
    case "turn.step.completed":
      return null;

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
      return {
        id: getId(options),
        type: "compaction",
        timestamp,
        phase: "begin",
      };

    case "compaction.completed":
    case "compaction.cancelled":
      return {
        id: getId(options),
        type: "compaction",
        timestamp,
        phase: "end",
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
  const timestamp = options.now ?? Date.now();
  const action = isString(request.action) ? request.action : "";

  return {
    id: getId(options),
    type: "approval_request",
    timestamp,
    requestId: isString(request.toolCallId) ? request.toolCallId : getId(options),
    toolName: isString(request.toolName) ? request.toolName : "unknown",
    description: isString(display.description) ? display.description : (isString(display.title) ? display.title : "需要审批"),
    details: action,
    riskLevel: action === "write" || action === "delete" ? "high" : "medium",
    status: "pending",
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
  const timestamp = options.now ?? Date.now();
  const requestId = isString(request.toolCallId) ? request.toolCallId : getId(options);

  return {
    id: getId(options),
    type: "question_request",
    timestamp,
    requestId,
    rpcRequestId: requestId,
    toolCallId: isString(request.toolCallId) ? request.toolCallId : "",
    questions: questions.map((question) => ({
      question: isString(question.question)
        ? question.question
        : (isString(question.label) ? question.label : "请选择后续处理方式？"),
      header: isString(question.header) ? question.header : undefined,
      multiSelect: typeof question.multiSelect === "boolean"
        ? question.multiSelect
        : (typeof question.multi_select === "boolean" ? question.multi_select : false),
      options: [
        ...(Array.isArray(question.options) ? question.options.filter(isRecord) : []).map((option) => ({
          label: isString(option.label) ? option.label : "选项",
          description: isString(option.description) ? option.description : undefined,
        })),
        ...(isString(question.otherLabel) ? [{
          label: question.otherLabel,
          description: isString(question.otherDescription) ? question.otherDescription : undefined,
        }] : []),
      ],
    })),
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
