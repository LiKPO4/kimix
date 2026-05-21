import { useAppStore } from "@/stores/appStore";
import type { TimelineEvent } from "@/types/ui";
import { isEmptyStatusUpdate } from "@/utils/sessionMetrics";

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

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-");
}

export function StatusCard({ event }: StatusCardProps) {
  const detailedContext = useAppStore((s) => s.detailedContext);
  if (isEmptyStatusUpdate(event)) return null;
  const details = [
    event.planMode === true ? "Plan" : "",
    event.message ? event.message : "",
    formatTimestamp(event.timestamp),
    event.tokenCount !== undefined ? `Tokens: ${formatK(event.tokenCount)}` : "",
    event.contextSize !== undefined ? `Context: ${formatContext(event, detailedContext)}` : "",
  ].filter(Boolean);

  return (
    <div className="flex justify-center" style={{ paddingTop: 2, paddingBottom: 2 }}>
      <div
        className="inline-flex max-w-full items-center rounded-full bg-[#faf8f4] text-[#aaa49a]"
        style={{ gap: 12, paddingLeft: 16, paddingRight: 16, paddingTop: 6, paddingBottom: 6, fontSize: 13, lineHeight: "18px" }}
      >
        {details.map((detail, index) => (
          <span key={`${event.id}-${index}`} className="truncate">{detail}</span>
        ))}
      </div>
    </div>
  );
}
