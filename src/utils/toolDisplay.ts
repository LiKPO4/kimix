import type { TimelineEvent } from "@/types/ui";

type ToolLikeEvent = Extract<TimelineEvent, { type: "tool_call" | "tool_result" }>;

const LARGE_TEXT_KEYS = new Set([
  "content",
  "new_string",
  "old_string",
  "newText",
  "oldText",
  "text",
  "body",
  "prompt",
  "input",
]);

const TEXT_PREVIEW_LIMIT = 420;
const DETAIL_LIMIT = 4800;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRawArguments(raw?: string): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function countLines(value: string) {
  if (!value) return 0;
  return value.split(/\r?\n/).length;
}

function previewText(value: string, limit = TEXT_PREVIEW_LIMIT) {
  if (value.length <= limit) return value;
  const head = value.slice(0, limit).trimEnd();
  return `${head}\n...（已省略 ${value.length - head.length} 字，避免过程卡片卡顿）`;
}

function compactValue(value: unknown, key = "", depth = 0): unknown {
  if (typeof value === "string") {
    const shouldSummarize = LARGE_TEXT_KEYS.has(key) || value.length > TEXT_PREVIEW_LIMIT;
    if (!shouldSummarize) return value;
    return [
      `文本 ${value.length} 字 / ${countLines(value)} 行`,
      previewText(value),
    ].join("\n");
  }

  if (Array.isArray(value)) {
    if (depth >= 2) return `数组 ${value.length} 项`;
    const visible = value.slice(0, 8).map((item) => compactValue(item, key, depth + 1));
    if (value.length <= visible.length) return visible;
    return [...visible, `...（另有 ${value.length - visible.length} 项）`];
  }

  if (isRecord(value)) {
    if (depth >= 3) return "{...}";
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, compactValue(entryValue, entryKey, depth + 1)]),
    );
  }

  return value;
}

function stringifyCompact(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return previewText(value, DETAIL_LIMIT);
  try {
    const text = JSON.stringify(compactValue(value), null, 2);
    return text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT).trimEnd()}\n...（已省略 ${text.length - DETAIL_LIMIT} 字）` : text;
  } catch {
    return String(value);
  }
}

function stringifyFull(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function getStructuredToolArguments(event: ToolLikeEvent): Record<string, unknown> | null {
  if (event.type === "tool_result") return null;
  if (event.arguments && Object.keys(event.arguments).length > 0) return event.arguments;
  return parseRawArguments(event.rawArguments);
}

export function toolArgumentPreview(event: ToolLikeEvent): string {
  if (event.type === "tool_result") return "";
  const args = getStructuredToolArguments(event);
  if (args) {
    const path = typeof args.path === "string"
      ? args.path
      : typeof args.file_path === "string"
        ? args.file_path
        : "";
    const command = typeof args.command === "string"
      ? args.command
      : typeof args.cmd === "string"
        ? args.cmd
        : "";
    if (command) return command.replace(/\s+/g, " ").slice(0, 220);
    if (path) return path;
    return stringifyCompact(args).replace(/\s+/g, " ").slice(0, 220);
  }
  return previewText(event.rawArguments ?? "", 220).replace(/\s+/g, " ");
}

export function formatToolArgumentsForDisplay(event: ToolLikeEvent): string {
  if (event.type === "tool_result") return "";
  const args = getStructuredToolArguments(event);
  if (args) return stringifyCompact(args);
  return stringifyCompact(event.rawArguments ?? "");
}

/** 完整内容仅在用户主动展开长工具明细时使用，避免默认渲染拖慢长会话。 */
export function formatFullToolArgumentsForDisplay(event: ToolLikeEvent): string {
  if (event.type === "tool_result") return "";
  const args = getStructuredToolArguments(event);
  return args ? stringifyFull(args) : (event.rawArguments ?? "");
}

export function formatToolResultForDisplay(value: unknown): string {
  return stringifyCompact(value).trim();
}

export function formatFullToolResultForDisplay(value: unknown): string {
  return stringifyFull(value).trim();
}
