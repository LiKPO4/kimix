import { memo, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, ChevronDown, Clock } from "lucide-react";
import type { StatusNotificationDetail, TimelineEvent } from "@/types/ui";

type StatusUpdateEvent = Extract<TimelineEvent, { type: "status_update" }>;

/** 通知卡中文标题（对齐官方：后台任务完成/后台任务完成通知/定时任务触发）。 */
export function notificationHeadline(detail: StatusNotificationDetail): string {
  if (detail.kind === "cron-fire") return "定时任务触发";
  if (detail.type === "task.completed") return "后台任务完成";
  if (detail.type === "task.lost") return "后台任务丢失";
  if (detail.type === "task.failed") return "后台任务失败";
  if (detail.type === "task.killed") return "后台任务已终止";
  return "后台任务通知";
}

/** 右上角状态文案（对齐官方：完成 11:02）。 */
export function notificationStatusLabel(detail: StatusNotificationDetail): string {
  if (detail.kind === "cron-fire") return "触发";
  if (detail.type === "task.completed") return "完成";
  if (detail.type === "task.lost") return "丢失";
  if (detail.type === "task.failed") return "失败";
  if (detail.type === "task.killed") return "终止";
  return "通知";
}

/**
 * 图标色调（只给图标/计数点着色，卡片本体走 kimix-soft-card 基础样式，
 * 跟随基础/风格化主题——早期版本整张卡铺 tone 底色，现代模式发蓝、复古模式刺眼）。
 */
function notificationToneIconClass(event: StatusUpdateEvent): string {
  if (event.tone === "success") return "text-accent-success";
  if (event.tone === "warning") return "text-accent-warning";
  if (event.tone === "danger") return "text-accent-danger";
  return "text-[var(--kimix-panel-text-muted)]";
}

function NotificationIcon({ detail, size = 14 }: { detail: StatusNotificationDetail; size?: number }) {
  if (detail.kind === "cron-fire") return <Clock size={size} />;
  if (detail.type === "task.completed") return <CheckCircle2 size={size} />;
  if (detail.type === "task.lost" || detail.type === "task.failed") return <AlertTriangle size={size} />;
  return <Bell size={size} />;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline" style={{ gap: 14 }}>
      <span className="shrink-0 text-[12px] leading-6 text-[var(--kimix-panel-text-muted)]" style={{ minWidth: 40 }}>{label}</span>
      <span className="min-w-0 text-[12.5px] leading-6 text-[var(--kimix-panel-text-secondary)]" style={{ wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

/**
 * 单条通知详情卡：头部 图标+中文标题+英文副标题+「状态 时间」，点击展开
 * 类型/来源/严重度/正文/原始 payload。外观对齐过程链其他卡片（kimix-soft-card
 * + 折叠行），不再整卡铺色调底色。embedded=true 时去掉卡片外壳，作为分组卡内部行。
 */
export const NotificationCard = memo(function NotificationCard({ event, embedded = false }: { event: StatusUpdateEvent; embedded?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const detail = event.notification;
  if (!detail) return null;
  const headline = notificationHeadline(detail);
  const source = [detail.sourceKind, detail.sourceId].filter(Boolean).join(" · ");

  const header = (
    <button
      type="button"
      onClick={() => setExpanded((current) => !current)}
      className="kimix-chat-collapse-row flex w-full items-center text-left transition-colors"
      style={{ gap: 9, padding: "8px 12px" }}
      aria-expanded={expanded}
    >
      <span className={`flex h-5 w-[18px] shrink-0 items-center justify-center ${notificationToneIconClass(event)}`}>
        <NotificationIcon detail={detail} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-5 text-text-primary">{headline}</span>
        {detail.title ? <span className="block truncate text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">{detail.title}</span> : null}
      </span>
      <span className="shrink-0 text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">
        {notificationStatusLabel(detail)} · {formatTime(event.timestamp)}
      </span>
      <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-[var(--kimix-process-muted)]">
        <ChevronDown size={14} className="transition-transform" style={{ transform: expanded ? "rotate(180deg)" : undefined }} />
      </span>
    </button>
  );
  const detailBlock = expanded ? (
    <div className="flex flex-col border-t border-[var(--kimix-panel-divider)]" style={{ gap: 4, padding: "10px 14px" }}>
      <DetailRow label="类型" value={detail.type} />
      {source ? <DetailRow label="来源" value={source} /> : null}
      {detail.severity ? <DetailRow label="严重度" value={detail.severity} /> : null}
      {detail.body ? (
        <div className="text-[12.5px] leading-6 text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{detail.body}</div>
      ) : null}
      <details style={{ marginTop: 4 }}>
        <summary className="cursor-pointer select-none text-[12px] leading-6 text-[var(--kimix-panel-text-muted)]">原始 payload</summary>
        <pre className="rounded-lg bg-surface-base text-[11.5px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 6, padding: "8px 10px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{detail.raw}</pre>
      </details>
    </div>
  ) : null;

  if (embedded) return <div>{header}{detailBlock}</div>;
  return <div className="kimix-soft-card overflow-hidden rounded-xl">{header}{detailBlock}</div>;
});

/**
 * 连续通知分组卡（对齐官方「N 条通知」）：折叠态显示计数+摘要行+逐条色调点，
 * 展开后逐条渲染嵌入版通知卡。外壳同样走 kimix-soft-card 基础样式。
 */
export const NotificationGroupCard = memo(function NotificationGroupCard({ events }: { events: StatusUpdateEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const first = events[0];
  if (!first?.notification) return null;
  const summary = events
    .map((event) => event.notification?.title ?? event.notification?.body ?? event.message ?? "")
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="kimix-soft-card overflow-hidden rounded-xl">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="kimix-chat-collapse-row flex w-full items-center text-left transition-colors"
        style={{ gap: 9, padding: "8px 12px" }}
        aria-expanded={expanded}
      >
        <span className={`flex h-5 w-[18px] shrink-0 items-center justify-center ${notificationToneIconClass(first)}`}>
          <NotificationIcon detail={first.notification} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium leading-5 text-text-primary">{events.length} 条通知</span>
          {!expanded && summary ? (
            <span className="block truncate text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">{summary}</span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center" style={{ gap: 3 }}>
          {events.map((event) => (
            <span key={event.id} className={`h-1.5 w-1.5 rounded-full bg-current ${notificationToneIconClass(event)}`} />
          ))}
        </span>
        <span className="flex h-5 w-[18px] shrink-0 items-center justify-center text-[var(--kimix-process-muted)]">
          <ChevronDown size={14} className="transition-transform" style={{ transform: expanded ? "rotate(180deg)" : undefined }} />
        </span>
      </button>
      {expanded && (
        <div className="flex flex-col border-t border-[var(--kimix-panel-divider)]">
          {events.map((event) => <NotificationCard key={event.id} event={event} embedded />)}
        </div>
      )}
    </div>
  );
});
