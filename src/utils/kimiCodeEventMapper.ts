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
  const step = isNumber(event.step) ? ` ${event.step}` : "";
  if (type === "turn.step.started") return `步骤${step}开始`;
  if (type === "turn.step.completed") return `步骤${step}完成`;
  if (type === "turn.step.retrying") {
    const message = isString(event.errorMessage) ? event.errorMessage : "正在重试";
    return `步骤${step}重试：${message}`;
  }
  if (type === "turn.step.interrupted") {
    const message = isString(event.message) ? event.message : "已中断";
    return `步骤${step}中断：${message}`;
  }
  return "状态更新";
}

export function mapKimiCodeEvent(
  rawEvent: unknown,
  options: KimiCodeEventMapperOptions = {},
): TimelineEvent | null {
  if (!isRecord(rawEvent) || !isString(rawEvent.type)) return null;

  const timestamp = getTimestamp(rawEvent, options);
  const type = rawEvent.type;

  switch (type) {
    case "turn.started":
      return null;

    case "assistant.delta": {
      const delta = isString(rawEvent.delta) ? rawEvent.delta : "";
      if (!delta) return null;
      return {
        id: getId(options),
        type: "assistant_message",
        timestamp,
        content: delta,
        isThinking: false,
        isComplete: false,
      };
    }

    case "thinking.delta": {
      const delta = isString(rawEvent.delta) ? rawEvent.delta : "";
      if (!delta) return null;
      return {
        id: getId(options),
        type: "assistant_message",
        timestamp,
        content: "",
        thinking: delta,
        thinkingParts: [{ id: getId(options), timestamp, text: delta }],
        isThinking: true,
        isComplete: false,
      };
    }

    case "turn.ended":
      return {
        id: getId(options),
        type: "assistant_message",
        timestamp,
        content: "",
        isThinking: false,
        isComplete: true,
      };

    case "tool.call.delta": {
      const toolCallId = isString(rawEvent.toolCallId) ? rawEvent.toolCallId : "";
      const rawArguments = isString(rawEvent.argumentsPart) ? rawEvent.argumentsPart : "";
      if (!toolCallId && !rawArguments) return null;
      return {
        id: getId(options),
        type: "tool_call",
        timestamp,
        toolCallId,
        toolName: isString(rawEvent.name) ? rawEvent.name : "unknown",
        status: "running",
        arguments: parseJsonObject(rawArguments),
        rawArguments,
      };
    }

    case "tool.call.started": {
      const args = isRecord(rawEvent.args) ? rawEvent.args : {};
      return {
        id: getId(options),
        type: "tool_call",
        timestamp,
        toolCallId: isString(rawEvent.toolCallId) ? rawEvent.toolCallId : "",
        toolName: isString(rawEvent.name) ? rawEvent.name : "unknown",
        status: "running",
        arguments: args,
        rawArguments: Object.keys(args).length > 0 ? JSON.stringify(args) : undefined,
      };
    }

    case "tool.result":
      return {
        id: getId(options),
        type: "tool_result",
        timestamp,
        toolCallId: isString(rawEvent.toolCallId) ? rawEvent.toolCallId : "",
        toolName: isString(rawEvent.name) ? rawEvent.name : "unknown",
        result: normalizeResult(rawEvent),
      };

    case "agent.status.updated": {
      const currentTurnUsage = isRecord(rawEvent.usage) && isRecord(rawEvent.usage.currentTurn)
        ? rawEvent.usage.currentTurn
        : undefined;
      return {
        id: getId(options),
        type: "status_update",
        timestamp,
        tokenCount: usageOutput(currentTurnUsage),
        inputTokenCount: usageInput(currentTurnUsage),
        contextSize: isNumber(rawEvent.contextTokens) ? rawEvent.contextTokens : undefined,
        contextLimit: isNumber(rawEvent.maxContextTokens) ? rawEvent.maxContextTokens : undefined,
        planMode: typeof rawEvent.planMode === "boolean" ? rawEvent.planMode : undefined,
        message: isString(rawEvent.model) ? `模型：${rawEvent.model}` : undefined,
      };
    }

    case "turn.step.started":
    case "turn.step.completed":
    case "turn.step.retrying":
    case "turn.step.interrupted":
      return {
        id: getId(options),
        type: "status_update",
        timestamp,
        step: isNumber(rawEvent.step) ? rawEvent.step : undefined,
        message: statusMessageForStep(type, rawEvent),
      };

    case "subagent.spawned":
      return {
        id: getId(options),
        type: "subagent",
        timestamp,
        agentName: isString(rawEvent.subagentName) ? rawEvent.subagentName : "subagent",
        status: "running",
        events: [],
      };

    case "subagent.completed":
      return {
        id: getId(options),
        type: "subagent",
        timestamp,
        agentName: isString(rawEvent.subagentName) ? rawEvent.subagentName : (isString(rawEvent.subagentId) ? rawEvent.subagentId : "subagent"),
        status: "completed",
        events: [],
      };

    case "subagent.failed":
      return {
        id: getId(options),
        type: "subagent",
        timestamp,
        agentName: isString(rawEvent.subagentName) ? rawEvent.subagentName : (isString(rawEvent.subagentId) ? rawEvent.subagentId : "subagent"),
        status: "error",
        events: [],
      };

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
        message: isString(rawEvent.message) ? rawEvent.message : "Kimi Code SDK error",
        source: "sdk",
        canDismiss: true,
      };

    case "warning":
      return {
        id: getId(options),
        type: "status_update",
        timestamp,
        message: isString(rawEvent.message) ? rawEvent.message : "Kimi Code SDK warning",
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
