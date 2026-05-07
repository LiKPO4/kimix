import { AlertCircle, X } from "lucide-react";
import { useState } from "react";
import type { TimelineEvent } from "@/types/ui";

interface ErrorCardProps {
  event: Extract<TimelineEvent, { type: "error" }>;
}

export function ErrorCard({ event }: ErrorCardProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="flex justify-center">
      <div className="max-w-[90%] w-full rounded-xl border border-accent-red/20 bg-accent-red/5 px-4 py-3">
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="text-accent-red shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-accent-red">出错了</span>
              <button
                onClick={() => setDismissed(true)}
                className="p-1 rounded-md hover:bg-accent-red/10 text-text-muted hover:text-accent-red transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <p className="mt-1 text-sm text-text-secondary leading-relaxed">{event.message}</p>
            {event.source && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-text-muted">来源: {event.source}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
