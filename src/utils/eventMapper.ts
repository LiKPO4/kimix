import type { TimelineEvent, TodoItem } from "@/types/ui";
import { findUnmatchedCompactionBeginIndex, formatKimiSkillActivationCommand, isLegacyKimiWorkDirError, parseKimiSkillActivation } from "./eventHelpers";
import { reliableAssistantDurationBetween, reliableAssistantDurationMs } from "./duration";
import { stripRoomContextFromPrompt } from "./roomContextBridge";

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
const OFFICIAL_SYSTEM_REMINDER_PATTERN = /(?:^|\r?\n)[ \t]*<system-reminder\b[^>]*>[\s\S]*?<\/system-reminder>[ \t]*(?=\r?\n|$)/gi;

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

function payloadValue(payload: Record<string, unknown>, source: Record<string, unknown>, key: string): unknown {
  return key in payload ? payload[key] : source[key];
}

function payloadString(payload: Record<string, unknown>, source: Record<string, unknown>, key: string): string | undefined {
  const value = payloadValue(payload, source, key);
  return isString(value) ? value : undefined;
}

function nestedString(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const nestedValue = value[key];
  return isString(nestedValue) && nestedValue.trim() ? nestedValue.trim() : undefined;
}

function compactSummaryFromRecord(record: Record<string, unknown>): string | undefined {
  const direct =
    nestedString(record, "summary") ??
    nestedString(record, "compaction_summary") ??
    nestedString(record, "text") ??
    nestedString(record, "message");
  if (direct) return direct;

  const result =
    nestedString(record.result, "summary") ??
    nestedString(record.result, "compaction_summary") ??
    nestedString(record.result, "text") ??
    nestedString(record.result, "message");
  if (result) return result;

  const payload =
    nestedString(record.payload, "summary") ??
    nestedString(record.payload, "compaction_summary") ??
    nestedString(record.payload, "text") ??
    nestedString(record.payload, "message");
  return payload;
}

function extractCompactionSummary(payload: Record<string, unknown>, source: Record<string, unknown>): string | undefined {
  return compactSummaryFromRecord(payload) ?? compactSummaryFromRecord(source);
}

function mergeToolResult(current: unknown, incoming: unknown): unknown {
  if (incoming === undefined) return current;
  if (current === undefined) return incoming;
  if (typeof current === "string" && typeof incoming === "string") return `${current}${incoming}`;
  return incoming;
}

function mergeRawArguments(current = "", incoming = ""): string | undefined {
  if (!current && !incoming) return undefined;
  if (!current) return incoming;
  if (!incoming) return current;
  if (current === incoming || current.endsWith(incoming)) return current;
  if (incoming.startsWith(current)) return incoming;
  return `${current}${incoming}`;
}

function normalizeNativeToolProgress(payload: Record<string, unknown>, source: Record<string, unknown>): string {
  const update = isRecord(payload.update) ? payload.update : isRecord(source.update) ? source.update : {};
  const text = isString(update.text) ? update.text : "";
  if (!text) return "";
  return update.kind === "stderr" ? `[stderr] ${text}` : text;
}

function normalizeNativeToolDisplay(payload: Record<string, unknown>, source: Record<string, unknown>): Extract<TimelineEvent, { type: "tool_result" }>["display"] | undefined {
  const result = isRecord(payload.result) ? payload.result : isRecord(source.result) ? source.result : {};
  const output = "output" in payload ? payload.output : "output" in source ? source.output : result.output;
  const commandDisplay = isRecord(payload.display)
    ? payload.display
    : isRecord(source.display)
      ? source.display
      : isRecord(result.display)
        ? result.display
        : {};
  const displayBlocks = Array.isArray(payload.display)
    ? payload.display
    : Array.isArray(source.display)
      ? source.display
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

  const blocks = displayBlocks.filter(isRecord);
  const diffBlock = blocks.find((block) => block.type === "diff");
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

function appendAssistantContent(existingContent: string, incomingContent: string): string {
  if (!incomingContent) return existingContent;
  if (!existingContent) return incomingContent;
  return existingContent + incomingContent;
}

function isInsideUnclosedInlineCode(content: string) {
  const currentLine = content.split(/\r?\n/).pop() ?? "";
  const withoutFences = currentLine.replace(/```/g, "");
  const inlineBackticks = withoutFences.match(/`/g)?.length ?? 0;
  return inlineBackticks % 2 === 1;
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

function splitAtFirstParagraphBreak(content: string): { continuation: string; remaining: string } {
  const breakMatch = /\r?\n\s*\r?\n/.exec(content);
  if (!breakMatch || breakMatch.index < 0) return { continuation: content, remaining: "" };
  return {
    continuation: content.slice(0, breakMatch.index),
    remaining: content.slice(breakMatch.index + breakMatch[0].length).trimStart(),
  };
}

function lastNonEmptyLine(content: string): string {
  const lines = content.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim()) return lines[index];
  }
  return "";
}

type PostSteerAssistantContinuation = {
  continuation: string;
  remaining: string;
  trimTrailingTablePipe?: boolean;
};

function pipeCount(line: string): number {
  return line.match(/\|/g)?.length ?? 0;
}

function hasRecentMarkdownTableContext(content: string): boolean {
  const recentLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8);
  return recentLines.some((line) => pipeCount(line) >= 2);
}

function stripTrailingTablePipe(content: string): string {
  return content.replace(/\s*\|\s*$/, "");
}

function appendWithOverlap(existingContent: string, incomingContent: string): string {
  if (!existingContent || !incomingContent) return existingContent + incomingContent;
  if (incomingContent.startsWith(existingContent)) return incomingContent;
  if (existingContent.endsWith(incomingContent)) return existingContent;

  const maxOverlap = Math.min(existingContent.length, incomingContent.length, 8192);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (existingContent.endsWith(incomingContent.slice(0, size))) {
      return existingContent + incomingContent.slice(size);
    }
  }
  return existingContent + incomingContent;
}

function appendPostSteerContinuation(previousContent: string, continuation: string, trimTrailingTablePipe = false): string {
  const base = trimTrailingTablePipe ? stripTrailingTablePipe(previousContent) : previousContent;
  if (!base || !continuation) return base + continuation;
  const overlapped = appendWithOverlap(base, continuation);
  if (overlapped !== base + continuation) return overlapped;
  if (/\s$/.test(base) || /^\s/.test(continuation) || /^[。.!?！？,，;；:：]/.test(continuation)) {
    return base + continuation;
  }
  if (/[A-Za-z0-9_.)\]`]/.test(base.at(-1) ?? "") && /^[\u4e00-\u9fff]/u.test(continuation)) {
    return `${base} ${continuation}`;
  }
  return base + continuation;
}

function isInsideUnclosedFencedCodeBlock(content: string): boolean {
  const fences = content.match(/(?:^|\r?\n)[ \t]*```/g)?.length ?? 0;
  return fences % 2 === 1;
}

function isLikelyInlineCodeContinuation(previousContent: string, incomingContent: string): boolean {
  if (!isInsideUnclosedInlineCode(previousContent)) return false;
  return incomingContent.trimStart().startsWith("`");
}

function isLikelyMarkdownTableContinuation(previousContent: string, incomingContent: string): boolean {
  const previousLine = lastNonEmptyLine(previousContent).trimEnd();
  const incomingFirstLine = incomingContent.trimStart().split(/\r?\n/)[0]?.trimStart() ?? "";
  if (!previousLine || !incomingFirstLine) return false;
  if (incomingFirstLine.startsWith("|")) return false;
  if (!incomingFirstLine.includes("|")) return false;

  const previousPipeCount = pipeCount(previousLine);
  const incomingPipeCount = pipeCount(incomingFirstLine);
  if (incomingPipeCount === 0) return false;
  if (previousPipeCount === 0) return hasRecentMarkdownTableContext(previousContent);

  // The assistant was interrupted in the middle of a Markdown table row, e.g.
  // "| APK | 版本 | 日期 | min" + "Sdk | compileSdk |".
  return !previousLine.endsWith("|") || hasRecentMarkdownTableContext(previousContent);
}

function splitPostSteerAssistantContinuation(previousContent: string, incomingContent: string): PostSteerAssistantContinuation | null {
  const previous = previousContent.trimEnd();
  if (!previous || !incomingContent) return null;

  if (isInsideUnclosedFencedCodeBlock(previousContent)) {
    return { continuation: incomingContent, remaining: "" };
  }

  if (isLikelyInlineCodeContinuation(previousContent, incomingContent)) {
    return splitAtFirstParagraphBreak(incomingContent);
  }

  const punctuation = incomingContent.match(/^([。.!?！？,，;；]+)/);
  if (punctuation && !/[。.!?！？,，;；]$/.test(previous)) {
    const continuation = punctuation[1];
    const remaining = incomingContent.slice(continuation.length).trimStart();
    return { continuation, remaining };
  }

  if (isLikelyMarkdownTableContinuation(previousContent, incomingContent)) {
    const split = splitAtFirstParagraphBreak(incomingContent);
    return {
      ...split,
      trimTrailingTablePipe: /\|\s*$/.test(previousContent),
    };
  }

  const previousToken = previous.match(/[A-Za-z0-9_./\\-]{2,}$/)?.[0] ?? "";
  const previousTokenContext = previous.slice(Math.max(0, previous.length - 64));
  if (!previousToken || !/[./\\_-]/.test(previousTokenContext)) return null;

  const continuationMatch = incomingContent.match(/^([A-Za-z0-9_./\\-]{1,12})([。.!?！？,，;；:]?)(?=\s|$|[\u4e00-\u9fff])/);
  if (!continuationMatch) return null;
  const continuation = continuationMatch[0];
  const remaining = incomingContent.slice(continuation.length).trimStart();
  return { continuation, remaining };
}

function closeOpenAssistantBeforeIndex(events: TimelineEvent[], index: number, settledAt: number): TimelineEvent[] {
  const assistantIndex = events
    .slice(0, index)
    .findLastIndex((event) => event.type === "assistant_message" && !event.isComplete);
  if (assistantIndex === -1) return events;
  const assistant = events[assistantIndex] as Extract<TimelineEvent, { type: "assistant_message" }>;
  const result = [...events];
  result[assistantIndex] = {
    ...assistant,
    isThinking: false,
    isComplete: true,
    durationMs: completedAssistantDuration(events, assistantIndex, assistant, settledAt),
  };
  return result;
}

function hasConfirmedSteerAfterOpenAssistant(events: TimelineEvent[]): boolean {
  const assistantIndex = events.findLastIndex((event) => event.type === "assistant_message" && !event.isComplete);
  if (assistantIndex === -1) return false;
  return events.slice(assistantIndex + 1).some((event) => (
    event.type === "steer_message" && event.status === "sent"
  ));
}

function hasConfirmedSteerBeforeIndex(events: TimelineEvent[], index: number): boolean {
  return events.slice(0, index).some((event) => (
    event.type === "steer_message" && event.status === "sent"
  ));
}

function appendAfterConfirmedSteer(
  existing: TimelineEvent[],
  additions: TimelineEvent[],
  { closeOpenAssistant = true }: { closeOpenAssistant?: boolean } = {},
): TimelineEvent[] {
  if (!closeOpenAssistant || additions.length === 0 || !hasConfirmedSteerAfterOpenAssistant(existing)) {
    return [...existing, ...additions];
  }
  const settledAt = additions[0].timestamp;
  return [...closeOpenAssistantBeforeIndex(existing, existing.length, settledAt), ...additions];
}

function findTurnAnchorTimestamp(events: TimelineEvent[], beforeIndex: number): number | undefined {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "user_message") return event.timestamp;
  }
  return undefined;
}

function completedAssistantDuration(
  events: TimelineEvent[],
  assistantIndex: number,
  assistant: Extract<TimelineEvent, { type: "assistant_message" }>,
  completedAt: number,
  incomingDurationMs?: number,
): number | undefined {
  const turnStartedAt = findTurnAnchorTimestamp(events, assistantIndex);
  const turnDuration = turnStartedAt !== undefined
    ? reliableAssistantDurationBetween(turnStartedAt, completedAt)
    : undefined;
  if (turnDuration !== undefined) return turnDuration;

  const direct =
    reliableAssistantDurationMs(incomingDurationMs) ??
    reliableAssistantDurationMs(assistant.durationMs) ??
    reliableAssistantDurationBetween(assistant.timestamp, completedAt);
  return direct;
}

function countTextLines(value: string): number {
  if (!value) return 0;
  return value.split(/\r?\n/).filter((line) => line.length > 0).length;
}

function createChangeSummaryFromDiff(diff: Extract<TimelineEvent, { type: "diff" }>): TimelineEvent {
  const additions = Math.max(0, countTextLines(diff.newText) - countTextLines(diff.oldText));
  const deletions = Math.max(0, countTextLines(diff.oldText) - countTextLines(diff.newText));
  return {
    id: generateId(),
    type: "change_summary",
    timestamp: diff.timestamp,
    files: [{ path: diff.filePath, additions, deletions }],
    additions,
    deletions,
  };
}

function firstStringValue(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function isShellLikeTool(toolName: string): boolean {
  return ["shell", "bash", "cmd", "powershell", "pwsh"].some((name) => toolName.includes(name));
}

function parseShellDeletionPaths(command: string): string[] {
  const trimmed = command.trim();
  const match = trimmed.match(/^\s*(rm|del|rmdir|Remove-Item|unlink)\b\s*([\s\S]*)$/i);
  if (!match) return [];

  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  const flush = () => {
    if (token) tokens.push(token);
    token = "";
  };
  const rest = match[2] ?? "";
  for (let index = 0; index < rest.length; index += 1) {
    const char = rest[index];
    if (quote) {
      if (char === quote) quote = null;
      else token += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    if (char === ";" || char === "|") {
      flush();
      break;
    }
    if (char === "&" && rest[index + 1] === "&") {
      flush();
      break;
    }
    token += char;
  }
  flush();

  const paths: string[] = [];
  for (const value of tokens) {
    if (!value || value.startsWith("-")) continue;
    if (/^\/(?:q|s|f|a|p)$/i.test(value)) continue;
    if (value === ".") continue;
    paths.push(value);
  }
  return paths;
}

function extractDeletedPaths(toolName: string, args: Record<string, unknown>): string[] {
  if (["delete", "remove", "deletefile", "delete_file"].some((name) => toolName.includes(name))) {
    const path = firstStringValue(args, ["path", "filePath", "file_path", "target", "file"]);
    return path ? [path] : [];
  }
  if (isShellLikeTool(toolName)) {
    const command = firstStringValue(args, ["command", "cmd", "script"]);
    if (command) return parseShellDeletionPaths(command);
  }
  return [];
}

function createChangeSummaryFromToolCall(
  call: Extract<TimelineEvent, { type: "tool_call" }>,
  timestamp: number,
): TimelineEvent | null {
  const toolName = call.toolName.toLowerCase();
  const args = call.arguments ?? {};

  if (["write", "edit", "multiedit"].some((name) => toolName.includes(name))) {
    const path = firstStringValue(args, ["path", "filePath", "file_path"]);
    if (!path) return null;
    const newText = firstStringValue(args, ["content", "newString", "new_string", "replacement", "text"]);
    const oldText = firstStringValue(args, ["oldString", "old_string", "oldText", "old_text"]) ?? "";
    const additions = newText !== undefined ? Math.max(0, countTextLines(newText) - countTextLines(oldText)) : 0;
    const deletions = oldText ? Math.max(0, countTextLines(oldText) - countTextLines(newText ?? "")) : 0;

    return {
      id: generateId(),
      type: "change_summary",
      timestamp,
      projectPath: call.display?.cwd,
      files: [{ path, additions, deletions }],
      additions,
      deletions,
    };
  }

  const deletedPaths = extractDeletedPaths(toolName, args);
  if (deletedPaths.length > 0) {
    return {
      id: generateId(),
      type: "change_summary",
      timestamp,
      projectPath: call.display?.cwd,
      files: deletedPaths.map((path) => ({ path, additions: 0, deletions: 1 })),
      additions: 0,
      deletions: deletedPaths.length,
    };
  }

  return null;
}

function appendAroundTrailingSteer(existing: TimelineEvent[], additions: TimelineEvent[]): TimelineEvent[] {
  const last = existing[existing.length - 1];
  if (last?.type === "steer_message" && last.status !== "sent") return [...existing.slice(0, -1), ...additions, last];
  if (last?.type === "steer_message" && last.status === "sent") return appendAfterConfirmedSteer(existing, additions);
  if (hasConfirmedSteerAfterOpenAssistant(existing)) return appendAfterConfirmedSteer(existing, additions);
  return [...existing, ...additions];
}

function createTodoEvent(items: TodoItem[], timestamp: number): TimelineEvent | null {
  return {
    id: generateId(),
    type: "todo",
    timestamp,
    items,
  };
}

function scopedAgentId(event: TimelineEvent): string | undefined {
  const agentId = "agentId" in event && typeof event.agentId === "string" ? event.agentId : undefined;
  return agentId && agentId !== "main" ? agentId : undefined;
}

function stripAgentScope<T extends TimelineEvent>(event: T): T {
  const next = { ...event } as T & { agentId?: string };
  delete next.agentId;
  return next as T;
}

function mergeSubagentLifecycle(
  current: Extract<TimelineEvent, { type: "subagent" }>,
  incoming: Extract<TimelineEvent, { type: "subagent" }>,
): Extract<TimelineEvent, { type: "subagent" }> {
  return {
    ...current,
    ...incoming,
    // 子代理名字在创建时确定，生命周期内不应变更；迟到事件若只带兜底名"子代理"，
    // 优先保留已存在的更具体名字（例如 "coder"），没有时才退回 incoming 的兜底。
    agentName: current.agentName ?? incoming.agentName,
    description: incoming.description ?? current.description,
    parentToolCallId: incoming.parentToolCallId ?? current.parentToolCallId,
    swarmIndex: incoming.swarmIndex ?? current.swarmIndex,
    resultSummary: incoming.resultSummary ?? current.resultSummary,
    error: incoming.error ?? current.error,
    events: incoming.events.length > 0 ? incoming.events : current.events,
  };
}

function attachScopedEventToSubagent(existing: TimelineEvent[], incoming: TimelineEvent): TimelineEvent[] | null {
  const agentId = scopedAgentId(incoming);
  if (!agentId || incoming.type === "subagent") return null;
  const subagentIndex = existing.findLastIndex((event) => event.type === "subagent" && event.agentId === agentId);
  if (subagentIndex === -1) return null;

  const result = [...existing];
  const subagent = result[subagentIndex] as Extract<TimelineEvent, { type: "subagent" }>;
  result[subagentIndex] = {
    ...subagent,
    events: mergeEvents(subagent.events, stripAgentScope(incoming)),
  };
  return result;
}

export function stripLegacyKimixClarificationWrapper(content: string): string {
  if (!/^【Kimix 需求澄清(?:工具)?[:：]/.test(content)) return content;
  const markerIndex = content.indexOf(CLARIFICATION_ORIGINAL_MARKER);
  if (markerIndex === -1) return content;
  return content.slice(markerIndex + CLARIFICATION_ORIGINAL_MARKER.length);
}

function stripKimixClarificationInstruction(content: string): string {
  const withoutRoomContext = stripRoomContextFromPrompt(content);
  if (withoutRoomContext !== content) return stripKimixClarificationInstruction(withoutRoomContext);
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
  const withoutClarificationWrapper = stripLegacyKimixClarificationWrapper(content);
  if (withoutClarificationWrapper === content) return content;
  return stripKimixClarificationInstruction(withoutClarificationWrapper);
}

function stripOfficialSystemReminders(content: string): string {
  if (!content.includes("<system-reminder")) return content;
  return content
    .replace(OFFICIAL_SYSTEM_REMINDER_PATTERN, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeUserMessageText(content: string): string {
  return stripOfficialSystemReminders(stripKimixClarificationInstruction(content));
}

function extractUserMessage(input: unknown): ExtractedUserMessage {
  if (isString(input)) return { content: sanitizeUserMessageText(input), images: [] };
  if (!Array.isArray(input)) return { content: "", images: [] };

  const textParts: string[] = [];
  const images: { name: string; dataUrl?: string }[] = [];
  input.forEach((part, index) => {
    if (!isRecord(part)) return;
    if (part.type === "text" && isString(part.text)) {
      const text = sanitizeUserMessageText(part.text);
      if (text) textParts.push(text);
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
      images.push({ name: id || `图片 ${index + 1}`, dataUrl });
      if (!dataUrl) textParts.push("[图片]");
    }
  });
  return {
    content: sanitizeUserMessageText(textParts.filter(Boolean).join("\n")),
    images,
  };
}

function normalizeUserContent(content: string): string {
  const attachmentMarkerIndex = content.search(/(?:^|\n)附件文件：/);
  const visibleContent = attachmentMarkerIndex >= 0 ? content.slice(0, attachmentMarkerIndex) : content;
  return visibleContent
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

function hasDisplayableImages(images?: { dataUrl?: string }[]) {
  return Boolean(images?.some((image) => typeof image.dataUrl === "string" && image.dataUrl.startsWith("data:image/")));
}

function hasLocalUserMedia(images?: { dataUrl?: string; filePath?: string }[]) {
  return Boolean(images?.some((image) => Boolean(image.dataUrl || image.filePath)));
}

function mergeUserMedia(
  localImages: Extract<TimelineEvent, { type: "user_message" | "steer_message" }>["images"],
  canonicalImages: Extract<TimelineEvent, { type: "user_message" | "steer_message" }>["images"],
) {
  if (!hasLocalUserMedia(localImages)) return canonicalImages;
  if (!canonicalImages || canonicalImages.length === 0) return localImages;
  return canonicalImages.map((image, index) => {
    const local = localImages?.[index] ?? localImages?.find((candidate) => candidate.name === image.name);
    if (!local) return image;
    return {
      ...image,
      id: image.id ?? local.id,
      kind: image.kind ?? local.kind,
      dataUrl: image.dataUrl ?? local.dataUrl,
      filePath: image.filePath ?? local.filePath,
    };
  });
}

/**
 * Official history is authoritative for the timeline, but pasted image bytes and
 * OS drag paths are renderer-local metadata. Reattach that metadata before a
 * canonical snapshot replaces the local timeline.
 */
export function preserveLocalUserMediaInCanonicalHistory(
  localEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
): TimelineEvent[] {
  const localMessages = localEvents.filter((event): event is Extract<TimelineEvent, { type: "user_message" | "steer_message" }> => (
    event.type === "user_message" || event.type === "steer_message"
  ));
  const usedLocalIndexes = new Set<number>();

  return canonicalEvents.map((event) => {
    if (event.type !== "user_message" && event.type !== "steer_message") return event;
    const content = normalizeUserContent(event.content);
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    localMessages.forEach((candidate, index) => {
      if (usedLocalIndexes.has(index) || candidate.type !== event.type) return;
      if (normalizeUserContent(candidate.content) !== content) return;
      const distance = Math.abs(candidate.timestamp - event.timestamp);
      if (distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    });
    if (bestIndex < 0) return event;
    usedLocalIndexes.add(bestIndex);
    const local = localMessages[bestIndex];
    const images = mergeUserMedia(local.images, event.images);
    return images === event.images ? event : { ...event, images };
  });
}

function shouldPreserveLocalUserImages(
  local: Extract<TimelineEvent, { type: "user_message" }>,
  incoming: Extract<TimelineEvent, { type: "user_message" }>,
) {
  return hasDisplayableImages(local.images) && !hasDisplayableImages(incoming.images);
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
    case "assistant.delta": {
      const delta = payloadString(payload, source, "delta");
      if (!delta) return null;
      return {
        id: generateId(),
        type: "assistant_message",
        timestamp: eventTimestamp,
        agentId: payloadString(payload, source, "agentId"),
        content: delta,
        model: payloadString(payload, source, "model")?.trim() || undefined,
        isThinking: false,
        isComplete: false,
      };
    }

    case "thinking.delta": {
      const delta = payloadString(payload, source, "delta");
      if (!delta) return null;
      const signature = payloadString(payload, source, "signature");
      return {
        id: generateId(),
        type: "assistant_message",
        timestamp: eventTimestamp,
        agentId: payloadString(payload, source, "agentId"),
        content: "",
        thinking: delta,
        thinkingParts: [{ id: generateId(), timestamp: eventTimestamp, text: delta, signature }],
        model: payloadString(payload, source, "model")?.trim() || undefined,
        isThinking: true,
        isComplete: false,
      };
    }

    case "turn.ended":
      return {
        id: generateId(),
        type: "assistant_message",
        timestamp: eventTimestamp,
        content: "",
        model: payloadString(payload, source, "model")?.trim() || undefined,
        isThinking: false,
        isComplete: true,
      };

    case "tool.call":
    case "tool.call.started": {
      const args = payloadValue(payload, source, "args");
      const parsedArgs = parseArguments(args);
      return {
        id: generateId(),
        type: "tool_call",
        timestamp: eventTimestamp,
        agentId: payloadString(payload, source, "agentId"),
        toolCallId: payloadString(payload, source, "toolCallId") ?? payloadString(payload, source, "id") ?? generateId(),
        toolName: payloadString(payload, source, "name") ?? payloadString(payload, source, "toolName") ?? "unknown",
        status: "running",
        arguments: parsedArgs,
        rawArguments: isString(args) ? args : Object.keys(parsedArgs).length > 0 ? JSON.stringify(parsedArgs) : undefined,
        description: payloadString(payload, source, "description"),
        display: normalizeNativeToolDisplay(payload, source),
      };
    }

    case "tool.progress": {
      const result = normalizeNativeToolProgress(payload, source);
      if (!result) return null;
      return {
        id: generateId(),
        type: "tool_call",
        timestamp: eventTimestamp,
        agentId: payloadString(payload, source, "agentId"),
        toolCallId: payloadString(payload, source, "toolCallId") ?? payloadString(payload, source, "id") ?? LATEST_TOOL_CALL,
        toolName: payloadString(payload, source, "name") ?? payloadString(payload, source, "toolName") ?? "unknown",
        status: "running",
        arguments: {},
        result,
      };
    }

    case "tool.result":
      return {
        id: generateId(),
        type: "tool_result",
        timestamp: eventTimestamp,
        agentId: payloadString(payload, source, "agentId"),
        toolCallId: payloadString(payload, source, "toolCallId") ?? payloadString(payload, source, "id") ?? "",
        toolName: payloadString(payload, source, "name") ?? payloadString(payload, source, "toolName") ?? "unknown",
        result: payloadValue(payload, source, "result") ?? payloadValue(payload, source, "output") ?? "",
        display: normalizeNativeToolDisplay(payload, source),
      };

    case "compaction.started":
      return {
        id: generateId(),
        type: "compaction",
        timestamp: eventTimestamp,
        phase: "begin",
      };

    case "compaction.completed":
    case "compaction.cancelled":
      return {
        id: generateId(),
        type: "compaction",
        timestamp: eventTimestamp,
        phase: "end",
        summary: extractCompactionSummary(payload, source),
      };

    case "TurnBegin": {
      const userMessage = extractUserMessage(payload.user_input);
      if (!userMessage.content.trim() && userMessage.images.length === 0) return null;
      const skillActivation = parseKimiSkillActivation(userMessage.content);
      if (skillActivation?.trigger === "model-tool") {
        return {
          id: generateId(),
          type: "status_update",
          timestamp: eventTimestamp,
          message: `已调用 Skill：${skillActivation.name}`,
          source: "skill",
          tone: "info",
        };
      }
      return {
        id: generateId(),
        type: "user_message",
        timestamp: eventTimestamp,
        content: skillActivation
          ? formatKimiSkillActivationCommand(skillActivation.name, skillActivation.args)
          : userMessage.content,
        images: userMessage.images,
      };
    }

    case "ContentPart":
    case "content.part": {
      const part = type === "content.part" && isRecord(payload.part) ? payload.part : payload;
      const partType = part.type;
      if (partType === "text" && isString(part.text)) {
        return {
          id: generateId(),
          type: "assistant_message",
          timestamp: eventTimestamp,
          content: part.text,
          model: payloadString(payload, source, "model")?.trim() || undefined,
          isThinking: false,
          isComplete: false,
        };
      }
      if ((partType === "think" || partType === "thinking") && (isString(part.think) || isString(part.thinking))) {
        const think = isString(part.think) ? part.think : isString(part.thinking) ? part.thinking : "";
        if (isKimixSyntheticThinking(think)) return null;
        const id = generateId();
        const timestamp = eventTimestamp;
        const signature = isString(part.signature) ? part.signature : undefined;
        return {
          id,
          type: "assistant_message",
          timestamp,
          content: "",
          thinking: think,
          thinkingParts: [{ id: generateId(), timestamp, text: think, signature }],
          model: payloadString(payload, source, "model")?.trim() || undefined,
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
      const message = extractUserMessage(payload.user_input);
      const text = message.content;
      if (!text.trim() && message.images.length === 0) return null;
      return {
        id: generateId(),
        type: "steer_message",
        timestamp: eventTimestamp,
        content: text || "[图片]",
        images: message.images,
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
      const display = isRecord(payload.display) ? payload.display : {};
      const normalizedDisplay = normalizeApprovalDisplay(display);
      return {
        id: generateId(),
        type: "approval_request",
        timestamp: eventTimestamp,
        requestId: isString(payload.id) ? payload.id : "",
        toolName: isString(payload.sender) ? payload.sender : "unknown",
        description: isString(payload.description)
          ? payload.description
          : normalizedDisplay?.description ?? normalizedDisplay?.title ?? (normalizedDisplay?.kind === "plan_review" ? "审阅计划" : "需要审批"),
        details: isString(payload.action) ? payload.action : "",
        riskLevel: "medium",
        status: "pending",
        display: normalizedDisplay,
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
          id: isString(question.id) ? question.id : undefined,
          question: isString(question.question) ? question.question : "请选择后续处理方式？",
          header: isString(question.header) ? question.header : undefined,
          multiSelect: typeof question.multi_select === "boolean" ? question.multi_select : false,
          options: (Array.isArray(question.options) ? question.options.filter(isRecord) : []).map((option) => ({
            id: isString(option.id) ? option.id : undefined,
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
      const contextSize = isNumber(payload.context_usage) ? payload.context_usage : undefined;
      return {
        id: generateId(),
        type: "status_update",
        timestamp: eventTimestamp,
        tokenCount: isNumber(tokenUsage.output) ? tokenUsage.output : 0,
        inputTokenCount,
        contextSize,
        contextLimit: contextSize !== undefined ? 256000 : undefined,
        planMode: typeof payload.plan_mode === "boolean" ? payload.plan_mode : undefined,
        message: isString(payload.model)
          ? `模型：${payload.model}`
          : isNumber(payload.message_id) || isString(payload.message_id)
            ? `消息 ${payload.message_id}`
            : undefined,
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
        summary: extractCompactionSummary(payload, source),
      };

    case "SubagentEvent": {
      const subagentStatus = isString(payload.status) && ["running", "completed", "error"].includes(payload.status)
        ? payload.status
        : "running";
      return {
        id: generateId(),
        type: "subagent",
        timestamp: eventTimestamp,
        agentName: isString(payload.agent_name) ? payload.agent_name : "子代理",
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
        model: payloadString(payload, source, "model")?.trim() || undefined,
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
          if (shouldPreserveLocalUserImages(lastUser, incoming)) {
            return existing;
          }
          if (getUserImageSignature(lastUser) === getUserImageSignature(incoming)) {
            return existing;
          }
        }
      }
    }
  }

  // Keep compaction completion aligned with its start event. If it is appended
  // after assistant content that streamed in while compaction was running, it
  // would visually appear below the agent output for the same turn.
  if (incoming.type === "compaction") {
    const unmatchedBeginIndex = findUnmatchedCompactionBeginIndex(existing);
    if (incoming.phase === "end" && unmatchedBeginIndex !== -1) {
      const result = [...existing];
      result.splice(unmatchedBeginIndex + 1, 0, incoming);
      return result;
    }
  }

  const withScopedSubagentEvent = attachScopedEventToSubagent(existing, incoming);
  if (withScopedSubagentEvent) return withScopedSubagentEvent;

  // Merge streaming assistant messages
  if (incoming.type === "assistant_message") {
    if (incoming.isComplete && !incoming.content && !incoming.thinking) {
      const latestOpenIndex = existing.findLastIndex((e) => e.type === "assistant_message" && !e.isComplete);
      const hasRunningSubagent = existing.some((e) => e.type === "subagent" && e.status === "running");
      const hasRunningTool = existing.some((e) => e.type === "tool_call" && e.status === "running");

      // TurnEnd 到达时，同时关闭 running 的 subagent/tool 和未完成的 assistant_message
      // 因为 TurnEnd 代表整个 turn 结束，不应让 subagent 的 TurnEnd 提前结束主对话
      // 也不应让主对话完成后过程卡片还保持 running
      let base = existing;
      if (hasRunningSubagent || hasRunningTool) {
        base = existing.map((event) =>
          event.type === "subagent" && event.status === "running"
            ? { ...event, status: "completed" as const }
            : event.type === "tool_call" && event.status === "running"
              ? { ...event, status: "success" as const, durationMs: Math.max(0, incoming.timestamp - event.timestamp) }
              : event
        );
      }

      if (latestOpenIndex === -1) {
        return base;
      }
      if (hasConfirmedSteerBeforeIndex(existing, latestOpenIndex)) {
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
          durationMs: completedAssistantDuration(existing, index, event, incoming.timestamp, incoming.durationMs),
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
      const hasConfirmedSteerBoundary = eventsAfterOpenAssistant.some((event) => (
        event.type === "steer_message" && event.status === "sent"
      ));
      if (hasConfirmedSteerBoundary && (incoming.content.trim() || incoming.thinking?.trim())) {
        const split = splitPostSteerAssistantContinuation(last.content, incoming.content);
        if (split) {
          const withContinuation = [...existing];
          withContinuation[lastIndex] = {
            ...last,
            content: appendPostSteerContinuation(last.content, split.continuation, split.trimTrailingTablePipe),
          };
          const hasRemainingAssistant = Boolean(split.remaining.trim() || incoming.thinking?.trim());
          if (!hasRemainingAssistant) return withContinuation;
          return appendAfterConfirmedSteer(withContinuation, [{ ...incoming, content: split.remaining }]);
        }
        return appendAfterConfirmedSteer(existing, [incoming]);
      }
      const updated: typeof last = {
        ...last,
        agentRole: incoming.agentRole ?? last.agentRole,
        model: incoming.model ?? last.model,
        content: appendAssistantContent(last.content, incoming.content),
        thinking: incoming.thinking ? (last.thinking ?? "") + incoming.thinking : last.thinking,
        thinkingParts: incoming.thinkingParts
          ? [...(last.thinkingParts ?? []), ...incoming.thinkingParts]
          : last.thinkingParts,
        isThinking: incoming.isComplete ? false : (last.isThinking || Boolean(incoming.thinking)),
        isComplete: incoming.isComplete,
        durationMs: incoming.isComplete
          ? completedAssistantDuration(existing, lastIndex, last, incoming.timestamp, incoming.durationMs)
          : reliableAssistantDurationMs(last.durationMs),
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
      const rawArguments = mergeRawArguments(last.rawArguments, incoming.rawArguments);
      const fallbackArguments = { ...last.arguments, ...incoming.arguments };
      const updated: typeof last = {
        ...last,
        toolName: incoming.toolName && incoming.toolName !== "unknown" ? incoming.toolName : last.toolName,
        arguments: mergeArguments(rawArguments ?? "", fallbackArguments),
        rawArguments,
        description: incoming.description ?? last.description,
        display: incoming.display ?? last.display,
        result: mergeToolResult(last.result, incoming.result),
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
        images: hasDisplayableImages(incoming.images)
          ? incoming.images
          : (result[duplicateIndex] as Extract<TimelineEvent, { type: "steer_message" }>).images,
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
    const changeEvent = diffEvent ? createChangeSummaryFromDiff(diffEvent) : null;
    const todoEvent = incoming.display?.todo ? createTodoEvent(incoming.display.todo, incoming.timestamp) : null;
    const displayEvents = [...(changeEvent ? [changeEvent] : []), ...(diffEvent ? [diffEvent] : []), ...(todoEvent ? [todoEvent] : [])];
    if (callIndex !== -1) {
      const call = result[callIndex] as Extract<TimelineEvent, { type: "tool_call" }>;
      const resultRecord = incoming.result && typeof incoming.result === "object" && !Array.isArray(incoming.result)
        ? incoming.result as Record<string, unknown>
        : null;
      const resultText = typeof incoming.result === "string"
        ? incoming.result
        : typeof resultRecord?.output === "string"
          ? resultRecord.output
          : "";
      const isErrorResult = resultRecord?.isError === true;
      const isRecoveryInterruption = isErrorResult && /execution was interrupted|执行(?:已|被)?中断/i.test(resultText);
      result[callIndex] = {
        ...call,
        status: isErrorResult ? "error" : "success",
        display: incoming.display ?? call.display,
        result: incoming.result,
        durationMs: isRecoveryInterruption ? undefined : Math.max(0, incoming.timestamp - call.timestamp),
      };
      const fallbackChangeEvent = displayEvents.length === 0 ? createChangeSummaryFromToolCall(call, incoming.timestamp) : null;
      return appendAroundTrailingSteer(result, fallbackChangeEvent ? [fallbackChangeEvent] : displayEvents);
    }
    if (displayEvents.length > 0) return appendAroundTrailingSteer(existing, displayEvents);
  }

  if (incoming.type === "subagent") {
    let matchingSubagentIndex = existing.findLastIndex((e) => (
      e.type === "subagent" &&
      (
        (incoming.agentId && e.agentId === incoming.agentId) ||
        (!incoming.agentId && e.agentName === incoming.agentName)
      ) &&
      (e.status === "queued" || e.status === "running" || e.status === "suspended")
    ));
    if (
      matchingSubagentIndex === -1 &&
      incoming.agentId &&
      (incoming.status === "completed" || incoming.status === "error")
    ) {
      matchingSubagentIndex = existing.findLastIndex((event) => (
        event.type === "subagent" && event.agentId === incoming.agentId
      ));
    }
    if (matchingSubagentIndex !== -1) {
      const result = [...existing];
      result[matchingSubagentIndex] = mergeSubagentLifecycle(
        result[matchingSubagentIndex] as Extract<TimelineEvent, { type: "subagent" }>,
        incoming,
      );
      return result;
    }
  }

  if (incoming.type === "status_update") {
    const last = existing[existing.length - 1];
    if (last?.type === "steer_message" && last.status === "sent") {
      return appendAfterConfirmedSteer(existing, [incoming], { closeOpenAssistant: false });
    }
    if (last?.type === "status_update") {
      const merged: typeof last = {
        ...last,
        ...incoming,
        message: incoming.message ?? last.message,
        tokenCount: incoming.tokenCount ?? last.tokenCount,
        inputTokenCount: incoming.inputTokenCount ?? last.inputTokenCount,
        contextSize: incoming.contextSize ?? last.contextSize,
        contextLimit: incoming.contextLimit ?? last.contextLimit,
      };
      return [...existing.slice(0, -1), merged];
    }
    return appendAroundTrailingSteer(existing, [incoming]);
  }

  if (incoming.type === "change_summary") {
    const result = [...existing];
    const lastStatusIndex = result.findLastIndex((event) => event.type === "status_update");
    if (lastStatusIndex !== -1) {
      const [statusEvent] = result.splice(lastStatusIndex, 1);
      result.push(statusEvent);
    }
    return appendAroundTrailingSteer(result, [incoming]);
  }

  return appendAroundTrailingSteer(existing, [incoming]);
}

function stableSnapshotEvent(
  rawEvent: unknown,
  mapped: TimelineEvent,
  counters: Map<string, number>,
): TimelineEvent {
  if (!isRecord(rawEvent)) return mapped;
  const source = isRecord(rawEvent.message) ? rawEvent.message : rawEvent;
  const payload = isRecord(source.payload) ? source.payload : {};
  const replay = payload.snapshotReplay;
  const messageId = payload.snapshotMessageId;
  if ((replay !== "history" && replay !== "in_flight") || !isString(messageId) || !messageId) return mapped;
  const kind = mapped.type === "assistant_message"
    ? "assistant"
    : mapped.type === "user_message"
      ? "user"
      : mapped.type === "tool_call" || mapped.type === "tool_result"
        ? `tool:${mapped.toolCallId || "unknown"}`
        : mapped.type === "approval_request" || mapped.type === "question_request"
          ? `${mapped.type}:${mapped.requestId || "unknown"}`
          : mapped.type;
  const counterKey = `${messageId}\u0000${kind}`;
  const partIndex = counters.get(counterKey) ?? 0;
  counters.set(counterKey, partIndex + 1);
  const prefix = `snapshot:${encodeURIComponent(messageId)}:${encodeURIComponent(kind)}`;
  const id = `${prefix}:${partIndex}`;
  if (mapped.type !== "assistant_message" || !mapped.thinkingParts?.length) {
    return { ...mapped, id };
  }
  return {
    ...mapped,
    id,
    thinkingParts: mapped.thinkingParts.map((part, index) => ({
      ...part,
      id: `${id}:thinking:${index}`,
    })),
  };
}

export function mapHistoryEvents(events: unknown[]): TimelineEvent[] {
  const stableCounters = new Map<string, number>();
  return events.reduce<TimelineEvent[]>((items, event) => {
    const mapped = mapStreamEvent(event);
    return mapped ? mergeEvents(items, stableSnapshotEvent(event, mapped, stableCounters)) : items;
  }, []);
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}
