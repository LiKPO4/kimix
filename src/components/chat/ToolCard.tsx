import { useState } from "react";
import { ChevronDown, ChevronUp, Wrench } from "lucide-react";
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
    running: { label: "运行中", dot: "bg-accent-yellow" },
    success: { label: "成功", dot: "bg-accent-green" },
    error: { label: "失败", dot: "bg-accent-red" },
  };

  const config = statusConfig[status];

  return (
    <div className="flex justify-center">
      <div className="max-w-[90%] w-full rounded-2xl border border-border-default bg-bg-secondary overflow-hidden">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-bg-hover transition-colors"
        >
          <Wrench size={15} className="text-text-muted shrink-0" />
          <span className="flex-1 text-left font-medium text-text-primary">{toolName}</span>
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
            {config.label}
          </span>
          {expanded ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
        </button>

        {expanded && (
          <div className="px-4 pb-3 space-y-2">
            {isToolCall && Object.keys(event.arguments).length > 0 && (
              <pre className="text-xs text-text-secondary bg-bg-primary rounded-xl p-3 overflow-x-auto border border-border-subtle font-mono leading-relaxed">
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
