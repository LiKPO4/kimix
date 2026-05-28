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
      <div
        className="w-full rounded-xl border text-text-primary shadow-[0_1px_0_rgba(25,23,20,0.02)]"
        style={{
          borderColor: "rgba(216,59,1,0.18)",
          background: "rgba(216,59,1,0.04)",
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 12,
          paddingBottom: 12,
        }}
      >
        <div className="flex items-start" style={{ gap: 12 }}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-danger-light text-accent-danger">
            <AlertCircle size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between" style={{ gap: 12 }}>
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-medium leading-6 text-accent-danger">出错了</div>
                <p className="mt-1 text-[13.5px] leading-6 text-text-secondary">{event.message}</p>
              </div>
              {event.canDismiss !== false && (
                <button
                  type="button"
                  onClick={() => setDismissed(true)}
                  className="kimix-icon-text-button is-compact shrink-0 text-text-muted hover:bg-accent-danger/10 hover:text-accent-danger"
                  style={{ minWidth: 32, paddingLeft: 8, paddingRight: 8 }}
                  aria-label="关闭错误提示"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
