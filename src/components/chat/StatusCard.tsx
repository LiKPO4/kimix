import { memo } from "react";
import { useAppStore } from "@/stores/appStore";
import type { TimelineEvent } from "@/types/ui";
import { compactModelText } from "@/utils/modelDisplay";
import { isEmptyStatusUpdate, shouldShowInlineStatusUpdate } from "@/utils/sessionMetrics";

interface StatusCardProps {
  event: Extract<TimelineEvent, { type: "status_update" }>;
  inline?: boolean;
  allowModelOnly?: boolean;
}

export const STATUS_CARD_TEXT_STYLE = {
  fontSize: 13,
  lineHeight: "18px",
} as const;

export function shouldDisplayStatusContext(event: Extract<TimelineEvent, { type: "status_update" }>): boolean {
  return typeof event.contextSize === "number" && event.contextSize > 0;
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

export function getStatusCardDetailTexts(
  event: Extract<TimelineEvent, { type: "status_update" }>,
  detailedContext: boolean,
): string[] {
  return [
    event.planMode === true ? "Plan" : "",
    event.message ? compactModelText(event.message) : "",
    event.inputTokenCount !== undefined ? `输入: ${formatK(event.inputTokenCount)}` : "",
    event.tokenCount !== undefined ? `输出: ${formatK(event.tokenCount)}` : "",
    shouldDisplayStatusContext(event) ? `Context: ${formatContext(event, detailedContext)}` : "",
  ].filter(Boolean);
}

export const StatusCard = memo(function StatusCard({ event, inline = false, allowModelOnly = false }: StatusCardProps) {
  const detailedContext = useAppStore((s) => s.detailedContext);
  if (allowModelOnly ? !shouldShowInlineStatusUpdate(event) : isEmptyStatusUpdate(event)) return null;
  const toneClass = event.tone === "info" || event.source === "slash"
    ? "bg-accent-primary-light text-accent-primary"
    : event.tone === "success"
      ? "bg-accent-success-light text-accent-success"
      : event.tone === "warning"
        ? "bg-accent-warning-light text-accent-warning"
        : event.tone === "danger"
          ? "bg-accent-danger-light text-accent-danger"
          : "bg-surface-hover text-text-muted";
  const details = getStatusCardDetailTexts(event, detailedContext).map((text) => ({
    text,
    tabular: text.startsWith("输入:") || text.startsWith("输出:") || text.startsWith("Context:"),
  }));

  const pill = (
      <div
        className={`inline-flex max-w-full items-center rounded-full ${toneClass}`}
        style={{ gap: 12, paddingLeft: inline ? 13 : 16, paddingRight: inline ? 13 : 16, paddingTop: inline ? 5 : 6, paddingBottom: inline ? 5 : 6, ...STATUS_CARD_TEXT_STYLE }}
      >
        {details.map((detail, index) => (
          <span key={`${event.id}-${index}`} className={`${detail.tabular ? "kimix-tabular-nums " : ""}truncate`}>{detail.text}</span>
        ))}
      </div>
  );

  if (inline) return pill;

  return (
    <div className="flex justify-center" style={{ paddingTop: 2, paddingBottom: 2 }}>
      {pill}
    </div>
  );
});
