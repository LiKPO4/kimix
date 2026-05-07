import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { TimelineEvent } from "@/types/ui";

interface TodoCardProps {
  event: Extract<TimelineEvent, { type: "todo" }>;
}

export function TodoCard({ event }: TodoCardProps) {
  const doneCount = event.items.filter((i) => i.status === "done").length;
  const total = event.items.length;
  const progress = total > 0 ? (doneCount / total) * 100 : 0;

  return (
    <div className="flex justify-center">
      <div className="max-w-[90%] w-full rounded-xl border border-border-default bg-bg-secondary px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-text-primary">📋 任务列表</span>
          <span className="text-xs text-text-muted">{doneCount}/{total}</span>
        </div>
        <div className="w-full h-1 bg-bg-tertiary rounded-full mb-3">
          <div
            className="h-full bg-accent-blue rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="space-y-2">
          {event.items.map((item) => (
            <div key={item.id} className="flex items-center gap-2 text-sm text-text-secondary">
              {item.status === "done" ? (
                <CheckCircle2 size={16} className="text-accent-green shrink-0" />
              ) : item.status === "in_progress" ? (
                <Loader2 size={16} className="text-accent-yellow shrink-0 animate-spin" />
              ) : (
                <Circle size={16} className="text-text-muted shrink-0" />
              )}
              <span className={item.status === "done" ? "line-through text-text-muted" : ""}>{item.content}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
