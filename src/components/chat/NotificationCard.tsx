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

function notificationToneClass(event: StatusUpdateEvent): string {
  if (event.tone === "success") return "bg-accent-success-light text-accent-success";
  if (event.tone === "warning") return "bg-accent-warning-light text-accent-warning";
  return "bg-accent-primary-light text-accent-primary";
}

function NotificationIcon({ detail, size = 15 }: { detail: StatusNotificationDetail; size?: number }) {
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
      <span className="shrink-0 text-[12px] leading-6 opacity-70" style={{ minWidth: 40 }}>{label}</span>
      <span className="min-w-0 text-[12.5px] leading-6" style={{ wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

/**
 * 单条通知详情卡（对齐官方通知卡）：头部 图标+中文标题+英文副标题+「状态 时间」，
 * 点击展开 类型/来源/严重度/正文/原始 payload。
 * embedded=true 时去掉自身背景圆角，作为分组卡内部行使用。
 */
export const NotificationCard = memo(function NotificationCard({ event, embedded = false }: { event: StatusUpdateEvent; embedded?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const detail = event.notification;
  if (!detail) return null;
  const toneClass = notificationToneClass(event);
  const headline = notificationHeadline(detail);
  const source = [detail.sourceKind, detail.sourceId].filter(Boolean).join(" · ");

  return (
    <div className={embedded ? "" : `rounded-xl ${toneClass}`} style={embedded ? undefined : { padding: "10px 14px" }}>
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className={`flex w-full items-center text-left ${embedded ? toneClass : ""}`}
        style={{ gap: 10, padding: embedded ? "8px 14px" : 0, borderRadius: embedded ? 8 : undefined }}
        aria-expanded={expanded}
      >
        <span className="shrink-0"><NotificationIcon detail={detail} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-5">{headline}</span>
          {detail.title ? <span className="block truncate text-[12px] leading-5 opacity-75">{detail.title}</span> : null}
        </span>
        <span className="shrink-0 text-[12px] leading-5">
          {notificationStatusLabel(detail)} · {formatTime(event.timestamp)}
        </span>
        <ChevronDown size={14} className="shrink-0 transition-transform" style={{ transform: expanded ? "rotate(180deg)" : undefined }} />
      </button>
      {expanded && (
        <div className={embedded ? "flex flex-col" : "flex flex-col"} style={{ gap: 4, marginTop: embedded ? 4 : 10, padding: embedded ? "0 14px 10px 39px" : 0, borderTop: embedded ? "none" : "1px solid color-mix(in srgb, currentColor 18%, transparent)", paddingTop: embedded ? 0 : 10 }}>
          <DetailRow label="类型" value={detail.type} />
          {source ? <DetailRow label="来源" value={source} /> : null}
          {detail.severity ? <DetailRow label="严重度" value={detail.severity} /> : null}
          {detail.body ? (
            <div className="text-[12.5px] leading-6" style={{ marginTop: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{detail.body}</div>
          ) : null}
          <details style={{ marginTop: 4 }}>
            <summary className="cursor-pointer select-none text-[12px] leading-6 opacity-70">原始 payload</summary>
            <pre className="text-[11.5px] leading-5" style={{ marginTop: 6, padding: "8px 10px", borderRadius: 8, background: "color-mix(in srgb, currentColor 8%, transparent)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{detail.raw}</pre>
          </details>
        </div>
      )}
    </div>
  );
});

/**
 * 连续通知分组卡（对齐官方「N 条通知」）：折叠态显示计数+摘要行，
 * 展开后逐条渲染嵌入版通知卡。
 */
export const NotificationGroupCard = memo(function NotificationGroupCard({ events }: { events: StatusUpdateEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const first = events[0];
  if (!first?.notification) return null;
  const toneClass = notificationToneClass(first);
  const summary = events
    .map((event) => event.notification?.title ?? event.notification?.body ?? event.message ?? "")
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-elevated">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center text-left"
        style={{ gap: 10, padding: "10px 14px" }}
        aria-expanded={expanded}
      >
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${toneClass}`}>
          <NotificationIcon detail={first.notification} size={13} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium leading-5 text-text-primary">{events.length} 条通知</span>
          {!expanded && summary ? (
            <span className="block truncate text-[12px] leading-5 text-text-muted">{summary}</span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center" style={{ gap: 3 }}>
          {events.map((event) => (
            <span key={event.id} className={`h-1.5 w-1.5 rounded-full bg-current ${notificationToneClass(event).split(" ").pop()}`} />
          ))}
        </span>
        <ChevronDown size={14} className="shrink-0 text-text-muted transition-transform" style={{ transform: expanded ? "rotate(180deg)" : undefined }} />
      </button>
      {expanded && (
        <div className="flex flex-col" style={{ gap: 6, padding: "0 6px 8px" }}>
          {events.map((event) => <NotificationCard key={event.id} event={event} embedded />)}
        </div>
      )}
    </div>
  );
});
