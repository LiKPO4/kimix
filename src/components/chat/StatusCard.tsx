import { useAppStore } from "@/stores/appStore";
import type { TimelineEvent } from "@/types/ui";
import { compactModelText } from "@/utils/modelDisplay";
import { isEmptyStatusUpdate } from "@/utils/sessionMetrics";

interface StatusCardProps {
  event: Extract<TimelineEvent, { type: "status_update" }>;
  inline?: boolean;
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

export function StatusCard({ event, inline = false }: StatusCardProps) {
  const detailedContext = useAppStore((s) => s.detailedContext);
  if (isEmptyStatusUpdate(event)) return null;
  const toneClass = event.tone === "info" || event.source === "slash"
    ? "bg-accent-primary-light text-accent-primary"
    : event.tone === "success"
      ? "bg-accent-success-light text-accent-success"
      : event.tone === "warning"
        ? "bg-accent-warning-light text-accent-warning"
        : event.tone === "danger"
          ? "bg-accent-danger-light text-accent-danger"
          : "bg-surface-hover text-text-muted";
  const details = [
    event.planMode === true ? "Plan" : "",
    event.message ? compactModelText(event.message) : "",
    formatTimestamp(event.timestamp),
    event.tokenCount !== undefined ? `Tokens: ${formatK(event.tokenCount)}` : "",
    event.contextSize !== undefined ? `Context: ${formatContext(event, detailedContext)}` : "",
  ].filter(Boolean);

  const pill = (
      <div
        className={`inline-flex max-w-full items-center rounded-full ${toneClass}`}
        style={{ gap: 12, paddingLeft: inline ? 13 : 16, paddingRight: inline ? 13 : 16, paddingTop: inline ? 5 : 6, paddingBottom: inline ? 5 : 6, fontSize: 13, lineHeight: "18px" }}
      >
        {details.map((detail, index) => (
          <span key={`${event.id}-${index}`} className="truncate">{detail}</span>
        ))}
      </div>
  );

  if (inline) return pill;

  return (
    <div className="flex justify-center" style={{ paddingTop: 2, paddingBottom: 2 }}>
      {pill}
    </div>
  );
}
