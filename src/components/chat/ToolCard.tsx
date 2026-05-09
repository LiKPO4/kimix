import { useState } from "react";
import { ChevronDown, ChevronRight, Terminal, FileText, FolderSearch, Wrench } from "lucide-react";
import type { TimelineEvent } from "@/types/ui";

interface ToolCardProps {
  event: Extract<TimelineEvent, { type: "tool_call" | "tool_result" }>;
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return "";
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function inferToolMeta(event: Extract<TimelineEvent, { type: "tool_call" | "tool_result" }>) {
  if (event.type === "tool_result") {
    return { label: "工具结果", detail: "", icon: Wrench };
  }

  const argsText = event.rawArguments || stringifyValue(event.arguments);
  const command = typeof event.arguments.command === "string"
    ? event.arguments.command
    : typeof event.arguments.cmd === "string"
      ? event.arguments.cmd
      : "";
  const path = typeof event.arguments.path === "string"
    ? event.arguments.path
    : typeof event.arguments.file_path === "string"
      ? event.arguments.file_path
      : "";

  if (command || /Get-ChildItem|Select-String|Measure-Object|npm|pnpm|git|cmd|powershell/i.test(argsText)) {
    return {
      label: command ? `运行 ${command}` : "运行命令",
      detail: command || argsText.replace(/\s+/g, " ").slice(0, 120),
      icon: Terminal,
    };
  }

  if (path || /read|file|path|Get-Content/i.test(argsText)) {
    return {
      label: path ? `读取 ${path}` : "读取文件",
      detail: path || argsText.replace(/\s+/g, " ").slice(0, 120),
      icon: FileText,
    };
  }

  if (event.toolName && event.toolName !== "unknown") {
    return { label: event.toolName, detail: argsText.replace(/\s+/g, " ").slice(0, 120), icon: Wrench };
  }

  return { label: "执行工具", detail: argsText.replace(/\s+/g, " ").slice(0, 120), icon: FolderSearch };
}

export function ToolCard({ event }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isToolCall = event.type === "tool_call";
  const status = isToolCall ? event.status : "success";
  const meta = inferToolMeta(event);
  const Icon = meta.icon;
  const duration = isToolCall ? formatDuration(event.durationMs) : "";
  const details = isToolCall ? stringifyValue(event.arguments) : stringifyValue(event.result);

  const statusText = status === "running" ? "正在运行" : status === "error" ? "失败" : "已运行";
  const dotClass = status === "running" ? "bg-[#d6a100]" : status === "error" ? "bg-[#d83b01]" : "bg-[#1a8f3a]";

  return (
    <div className="flex justify-start">
      <div className="w-full">
        <button
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-[13px] text-[#8f887e] transition-colors hover:bg-[#f3f1ec]"
        >
          {expanded ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
          <Icon size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {statusText} {meta.label}
          </span>
          {duration && <span className="shrink-0 text-[#aaa49a]">{duration}</span>}
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
        </button>
        {expanded && (
          <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-[#f7f5f1] px-3 py-2 text-[12px] leading-relaxed text-[#706b63]">
            {details || meta.detail}
          </pre>
        )}
      </div>
    </div>
  );
}
