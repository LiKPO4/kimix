import type { TimelineEvent } from "@/types/ui";

interface ErrorCardProps {
  event: Extract<TimelineEvent, { type: "error" }>;
}

export function ErrorCard({ event }: ErrorCardProps) {
  return (
    <div className="flex justify-center">
      <div className="max-w-[90%] w-full rounded-xl border border-accent-red/30 bg-accent-red/5 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-accent-red">
          <span>⚠️</span>
          <span>错误</span>
        </div>
        <p className="mt-1 text-sm text-text-secondary">{event.message}</p>
      </div>
    </div>
  );
}
