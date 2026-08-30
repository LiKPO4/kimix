import { memo, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, ChevronDown, CircleStop, Clock, FileText } from "lucide-react";
import type { StatusNotificationDetail, TimelineEvent } from "@/types/ui";

type StatusUpdateEvent = Extract<TimelineEvent, { type: "status_update" }>;

/** 通知状态后缀（对齐官方：completed/failed/timed_out/killed/lost，其余 info 兜底）。 */
type NotificationStatus = "completed" | "failed" | "timed_out" | "killed" | "lost" | "info";

function notificationStatus(detail: StatusNotificationDetail): NotificationStatus {
  for (const status of ["completed", "failed", "timed_out", "killed", "lost"] as const) {
    if (detail.type.endsWith(`.${status}`)) return status;
  }
  return "info";
}

/** 来源头 id（对齐官方：子代理取 agentId，其余取 sourceId）。 */
function notificationSourceId(detail: StatusNotificationDetail): string {
  return detail.sourceKind === "subagent" && detail.agentId ? detail.agentId : detail.sourceId ?? "";
}

/**
 * 通知卡来源头（对齐官方「{kind}{状态} · {id}」：子代理完成 · agent-4 /
 * 后台任务完成 · bash-bv5pc30f；kind 按 sourceKind 区分 子代理/后台任务）。
 */
export function notificationHeadline(detail: StatusNotificationDetail): string {
  if (detail.kind === "cron-fire") {
    return detail.sourceId ? `定时任务触发 · ${detail.sourceId}` : "定时任务触发";
  }
  const kind = detail.sourceKind === "subagent" ? "子代理" : "后台任务";
  const statusWord: Record<NotificationStatus, string> = {
    completed: "完成",
    failed: "失败",
    timed_out: "超时",
    killed: "被终止",
    lost: "丢失",
    info: "通知",
  };
  const base = `${kind}${statusWord[notificationStatus(detail)]}`;
  const id = notificationSourceId(detail);
  return id ? `${base} · ${id}` : base;
}

/** 右上角状态文案（对齐官方：完成 11:02）。 */
export function notificationStatusLabel(detail: StatusNotificationDetail): string {
  if (detail.kind === "cron-fire") return "触发";
  const label: Record<NotificationStatus, string> = {
    completed: "完成",
    failed: "失败",
    timed_out: "超时",
    killed: "已终止",
    lost: "丢失",
    info: "信息",
  };
  return label[notificationStatus(detail)];
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
  const status = notificationStatus(detail);
  if (status === "completed") return <CheckCircle2 size={size} />;
  if (status === "lost" || status === "failed") return <AlertTriangle size={size} />;
  if (status === "timed_out") return <Clock size={size} />;
  if (status === "killed") return <CircleStop size={size} />;
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * 单条通知详情卡：头部 图标+来源头（{kind}{状态} · id）+英文副标题+「状态 时间」，
 * 点击展开 类型/来源/严重度/正文/输出文件/原始 payload。外观对齐过程链其他卡片
 * （kimix-soft-card + 折叠行），不再整卡铺色调底色。embedded=true 时去掉卡片外壳，
 * 作为分组卡内部行。
 */
export const NotificationCard = memo(function NotificationCard({ event, embedded = false }: { event: StatusUpdateEvent; embedded?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const detail = event.notification;
  if (!detail) return null;
  const headline = notificationHeadline(detail);
  const source = [detail.sourceKind, detail.sourceId].filter(Boolean).join(" · ");

  const copyOutputPath = () => {
    if (!detail.outputFile) return;
    void navigator.clipboard?.writeText(detail.outputFile.path).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }).catch(() => {});
  };

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
      {detail.outputFile ? (
        <div className="flex items-center" style={{ gap: 8, marginTop: 6 }}>
          <FileText size={13} className="shrink-0 text-[var(--kimix-panel-text-muted)]" />
          <span
            className="min-w-0 flex-1 truncate text-[12px] leading-6 text-[var(--kimix-panel-text-secondary)]"
            title={detail.outputFile.path}
            style={{ direction: "rtl", textAlign: "left" }}
          >{detail.outputFile.path}</span>
          {detail.outputFile.bytes !== undefined ? (
            <span className="shrink-0 text-[11.5px] leading-6 text-[var(--kimix-panel-text-muted)]">{formatBytes(detail.outputFile.bytes)}</span>
          ) : null}
          <button
            type="button"
            onClick={copyOutputPath}
            className="kimix-style-exempt shrink-0 rounded-md text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)] transition-colors hover:bg-[var(--kimix-panel-soft-bg)]"
            style={{ padding: "2px 10px" }}
          >{copied ? "已复制" : "复制路径"}</button>
        </div>
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
