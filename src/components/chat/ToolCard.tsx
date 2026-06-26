import { memo, useState } from "react";
import { ChevronDown, ChevronRight, Terminal, FileText, FolderSearch, Wrench } from "lucide-react";
import type { TimelineEvent } from "@/types/ui";
import { formatToolArgumentsForDisplay, formatToolResultForDisplay, toolArgumentPreview } from "@/utils/toolDisplay";

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

function inferToolMeta(event: Extract<TimelineEvent, { type: "tool_call" | "tool_result" }>) {
  if (event.type === "tool_result") {
    return { label: "工具结果", detail: "", icon: Wrench };
  }

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
  const preview = toolArgumentPreview(event);

  if (command || /Get-ChildItem|Select-String|Measure-Object|npm|pnpm|git|cmd|powershell/i.test(preview)) {
    return {
      label: command ? `运行 ${command}` : "运行命令",
      detail: command || preview,
      icon: Terminal,
    };
  }

  if (path || /read|file|path|Get-Content/i.test(preview)) {
    return {
      label: path ? `读取 ${path}` : "读取文件",
      detail: path || preview,
      icon: FileText,
    };
  }

  if (event.toolName && event.toolName !== "unknown") {
    return { label: event.toolName, detail: preview, icon: Wrench };
  }

  return { label: "执行工具", detail: preview, icon: FolderSearch };
}

export const ToolCard = memo(function ToolCard({ event }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isToolCall = event.type === "tool_call";
  const status = isToolCall ? event.status : "success";
  const meta = inferToolMeta(event);
  const Icon = meta.icon;
  const duration = isToolCall ? formatDuration(event.durationMs) : "";
  const toolResult = isToolCall && "result" in event ? event.result : undefined;
  const details = isToolCall
    ? [
        formatToolArgumentsForDisplay(event),
        formatToolResultForDisplay(toolResult)
          ? `${status === "running" ? "实时输出" : "输出"}:\n${formatToolResultForDisplay(toolResult)}`
          : "",
      ].filter(Boolean).join("\n\n")
    : formatToolResultForDisplay(event.result);

  const statusText = status === "running" ? "正在运行" : status === "error" ? "失败" : "已运行";
  const dotClass = status === "running" ? "bg-accent-warning" : status === "error" ? "bg-accent-danger" : "bg-accent-success";

  return (
    <div className="flex justify-start">
      <div className="w-full">
        <button
          onClick={() => setExpanded((value) => !value)}
          className="kimix-chat-collapse-row w-full text-left text-[14.5px] leading-none text-text-muted hover:bg-surface-hover"
        >
          {expanded ? <ChevronDown size={15} className="shrink-0" /> : <ChevronRight size={15} className="shrink-0" />}
          <Icon size={15} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {statusText} {meta.label}
          </span>
          {duration && <span className="shrink-0 text-text-muted">{duration}</span>}
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
        </button>
        {expanded && (
          <pre
            className="mt-2 max-h-52 min-w-0 overflow-auto rounded-xl bg-surface-base whitespace-pre-wrap break-words text-[14px] leading-7 text-text-secondary"
            style={{ paddingLeft: 32, paddingRight: 32, paddingTop: 20, paddingBottom: 20 }}
          >
            {details || meta.detail}
          </pre>
        )}
      </div>
    </div>
  );
});
