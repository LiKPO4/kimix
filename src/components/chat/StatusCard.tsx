import { useAppStore } from "@/stores/appStore";
import type { TimelineEvent } from "@/types/ui";

interface StatusCardProps {
  event: Extract<TimelineEvent, { type: "status_update" }>;
}

function formatK(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(2)}k`;
  return String(tokens);
}

function formatContext(event: Extract<TimelineEvent, { type: "status_update" }>, detailed: boolean): string {
  const ratio = event.contextSize ?? 0;
  const limit = event.contextLimit ?? 256000;
  if (detailed) {
    const used = ratio <= 1 ? ratio * limit : ratio;
    return `${formatK(used)}/${formatK(limit)}`;
  }
  const percent = ratio <= 1 ? ratio * 100 : (ratio / limit) * 100;
  return `${percent.toFixed(2)}%`;
}

export function StatusCard({ event }: StatusCardProps) {
  const detailedContext = useAppStore((s) => s.detailedContext);
  return (
    <div className="flex justify-center">
      <div className="inline-flex max-w-full items-center gap-2 truncate rounded-full bg-[#faf8f4] px-2.5 py-0.5 text-[12px] text-[#aaa49a]">
        {event.message && <span className="truncate">{event.message}</span>}
        <span>Tokens: {event.tokenCount ?? 0}</span>
        <span title={formatContext(event, true)}>Context: {formatContext(event, detailedContext)}</span>
      </div>
    </div>
  );
}
