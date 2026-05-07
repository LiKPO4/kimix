import type { TimelineEvent } from "@/types/ui";

interface StatusCardProps {
  event: Extract<TimelineEvent, { type: "status_update" }>;
}

export function StatusCard({ event }: StatusCardProps) {
  return (
    <div className="flex justify-center">
      <div className="inline-flex items-center gap-3 px-3 py-1.5 rounded-full bg-bg-secondary border border-border-subtle text-xs text-text-muted">
        {event.message && <span>{event.message}</span>}
        {event.tokenCount !== undefined && (
          <span>Tokens: {event.tokenCount}</span>
        )}
        {event.contextSize !== undefined && (
          <span>Context: {event.contextSize}</span>
        )}
      </div>
    </div>
  );
}
