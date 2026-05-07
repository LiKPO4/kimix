import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { TimelineEvent } from "@/types/ui";

interface ToolCardProps {
  event: Extract<TimelineEvent, { type: "tool_call" | "tool_result" }>;
}

export function ToolCard({ event }: ToolCardProps) {
  const [expanded, setExpanded] = useState(true);

  const isToolCall = event.type === "tool_call";
  const toolName = event.toolName;
  const status = isToolCall ? event.status : "success";

  const statusConfig = {
    running: { label: "运行中", className: "bg-accent-yellow/10 text-accent-yellow" },
    success: { label: "成功", className: "bg-accent-green/10 text-accent-green" },
    error: { label: "失败", className: "bg-accent-red/10 text-accent-red" },
  };

  const config = statusConfig[status];

  return (
    <div className="flex justify-center">
      <div className="max-w-[90%] w-full rounded-xl border border-border-default bg-bg-secondary">
        {/* Header */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-text-primary hover:bg-bg-tertiary/50 transition-colors rounded-xl"
        >
          <span className="text-accent-blue">🔧</span>
          <span className="flex-1 text-left">{toolName}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${config.className}`}>{config.label}</span>
          {expanded ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
        </button>

        {/* Body */}
        {expanded && (
          <div className="px-4 pb-3 space-y-2">
            {isToolCall && Object.keys(event.arguments).length > 0 && (
              <pre className="text-xs text-text-secondary bg-bg-primary rounded-lg p-2 overflow-x-auto border border-border-subtle">
                {JSON.stringify(event.arguments, null, 2)}
              </pre>
            )}
            {!isToolCall && (
              <div className="text-xs text-text-secondary">
                {typeof event.result === "string" ? event.result : JSON.stringify(event.result, null, 2)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
