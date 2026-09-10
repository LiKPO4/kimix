import { createContext, memo, useContext } from "react";
import { useAppStore } from "@/stores/appStore";
import type { StatusCardItems, TimelineEvent } from "@/types/ui";
import { compactModelText } from "@/utils/modelDisplay";
import { hasMetricStatus, isEmptyStatusUpdate, isNotificationSummaryMessage, shouldShowInlineStatusUpdate } from "@/utils/sessionMetrics";

/** 每个 turn 级 usage 帧的输出速率（eventId → t/s），由 ChatThread 按完整事件流预计算。 */
export const StatusCardSpeedContext = createContext<Map<string, number> | null>(null);

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
  const size = event.contextSize ?? 0;
  const limit = event.contextLimit;
  // 格式只依赖 detailed 开关：非 detailed 一律绝对 token 数。原先按 limit 是否存在
  // 在「绝对值/百分比」间切换，相邻两轮帧结构不同就会显示不一致（实机复现）。
  const absolute = size <= 1 && limit !== undefined && limit > 0 ? size * limit : size;
  if (detailed && limit !== undefined && limit > 0) return `${formatK(absolute)}/${formatK(limit)}`;
  if (absolute > 0 && absolute <= 1) return `${(absolute * 100).toFixed(2)}%`;
  return formatK(absolute);
}

const STATUS_CARD_ITEMS_ALL: StatusCardItems = { model: true, input: true, output: true, context: true, speed: true };

function formatSpeed(tokensPerSecond: number): string {
  const value = tokensPerSecond >= 100 ? String(Math.round(tokensPerSecond)) : tokensPerSecond.toFixed(1);
  return `${value} t/s`;
}

export function getStatusCardDetailTexts(
  event: Extract<TimelineEvent, { type: "status_update" }>,
  detailedContext: boolean,
  items: StatusCardItems = STATUS_CARD_ITEMS_ALL,
  speedTokensPerSecond?: number,
): string[] {
  // 182 前的遗留持久化行可能把通知摘要混进度量行 message；与上方 tone/source
  // 兜底同类的显示层修复，度量行不显示通知文案。
  const leakedNotificationMessage = hasMetricStatus(event) && isNotificationSummaryMessage(event.message);
  return [
    event.planMode === true ? "Plan" : "",
    items.model && event.message && !leakedNotificationMessage ? compactModelText(event.message) : "",
    items.input && event.inputTokenCount !== undefined ? `输入: ${formatK(event.inputTokenCount)}` : "",
    items.output && event.tokenCount !== undefined ? `输出: ${formatK(event.tokenCount)}` : "",
    items.context && shouldDisplayStatusContext(event) ? `上下文: ${formatContext(event, detailedContext)}` : "",
    items.speed && typeof speedTokensPerSecond === "number" && Number.isFinite(speedTokensPerSecond) && speedTokensPerSecond > 0
      ? `速率: ${formatSpeed(speedTokensPerSecond)}`
      : "",
  ].filter(Boolean);
}

export function getStatusCardToneClass(event: Extract<TimelineEvent, { type: "status_update" }>): string {
  // Token/context footers are neutral measurements. This display-side guard
  // also repairs persisted legacy rows whose adjacent runtime notification
  // leaked source/tone into a later usage snapshot.
  if (hasMetricStatus(event)) return "kimix-status-surface bg-surface-hover text-text-muted";
  if (event.tone === "info" || event.source === "slash") return "bg-accent-primary-light text-accent-primary";
  if (event.tone === "success") return "bg-accent-success-light text-accent-success";
  if (event.tone === "warning") return "bg-accent-warning-light text-accent-warning";
  if (event.tone === "danger") return "bg-accent-danger-light text-accent-danger";
  return "kimix-status-surface bg-surface-hover text-text-muted";
}

export const StatusCard = memo(function StatusCard({ event, inline = false, allowModelOnly = false }: StatusCardProps) {
  const detailedContext = useAppStore((s) => s.detailedContext);
  const statusCardItems = useAppStore((s) => s.statusCardItems);
  const speedTokensPerSecond = useContext(StatusCardSpeedContext)?.get(event.id);
  if (allowModelOnly ? !shouldShowInlineStatusUpdate(event) : isEmptyStatusUpdate(event)) return null;
  const toneClass = getStatusCardToneClass(event);
  const details = getStatusCardDetailTexts(event, detailedContext, statusCardItems, speedTokensPerSecond).map((text) => ({
    text,
    tabular: text.startsWith("输入:") || text.startsWith("输出:") || text.startsWith("上下文:") || text.startsWith("速率:"),
  }));
  // 用户在设置里关掉了该帧能显示的全部内容项时不渲染空胶囊。
  if (details.length === 0) return null;

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
