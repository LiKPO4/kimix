import { memo, useRef, useEffect, useLayoutEffect, useMemo, useState, useCallback } from "react";
import { ArrowDown, ChevronDown, ChevronRight, Wrench, Loader2, Bot, FileText, RefreshCw } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { getRuntimeSessionId } from "@/utils/runtimeSession";
import { normalizePathForComparison } from "@/utils/pathCase";
import { useLiveSession } from "@/hooks/useLiveSession";
import { EmptyState } from "./EmptyState";
import { MessageBubble } from "./MessageBubble";
import { ToolCard } from "./ToolCard";
import { ChangeCard } from "./ChangeCard";
import { FileCard } from "./FileCard";
import { StatusCard } from "./StatusCard";
import { ApprovalCard } from "./ApprovalCard";
import { QuestionCard } from "./QuestionCard";
import { ErrorCard } from "./ErrorCard";
import { SessionRecommendationCard } from "./SessionRecommendationCard";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { createSubagentOnlyAssistantEvent, createToolOnlyAssistantEvent } from "@/utils/chatRenderItems";
import { reliableAssistantDurationMs } from "@/utils/duration";
import { hasMetricStatus, shouldRenderStandaloneStatusUpdate } from "@/utils/sessionMetrics";
import { hasLocalFailedSendAttempt, hasLocalOrphanUserSendAttempt, removeLocalUserSendAttempt } from "@/utils/eventHelpers";
import { logError } from "@/utils/reportError";
import { bottomScrollTop, distanceFromBottom, scrollTopPreservingBottomDistance, shouldResumeAutoFollowAtBottom, USER_SCROLL_INTENT_MS } from "@/utils/scrollIntent";
import { selectInitialChatTail } from "@/utils/chatTailWindow";
import type { LongTaskSessionMeta, TimelineEvent, ToolCallEvent } from "@/types/ui";
import { projectCollaborationTimeline } from "@/utils/collaborationTimeline";
import {
  canReleaseViewportTailCompensation,
  CHAT_PROCESS_COLLAPSE_VIEWPORT_EVENT,
  isProcessCollapseAnchorUnstable,
  isViewportAnchorGenerationCurrent,
  planDetachedViewportRestore,
  requiredViewportTailCompensation,
  type ChatProcessCollapseViewportDetail,
} from "@/utils/chatViewportTransaction";

type RenderItem =
  | { type: "event"; event: TimelineEvent; turnStartedAt?: number; leadingTools?: ToolCallEvent[]; leadingSubagents?: Extract<TimelineEvent, { type: "subagent" }>[]; leadingHooks?: Extract<TimelineEvent, { type: "hook" }>[]; leadingApprovals?: Extract<TimelineEvent, { type: "approval_request" }>[]; attachedSteers?: Extract<TimelineEvent, { type: "steer_message" }>[]; attachedUserStatuses?: Extract<TimelineEvent, { type: "status_update" }>[]; activeStatus?: Extract<TimelineEvent, { type: "status_update" }>; changedFiles?: string[]; changeSummary?: Extract<TimelineEvent, { type: "change_summary" }>; trailingStatuses?: Extract<TimelineEvent, { type: "status_update" }>[]; hideProcessSummary?: boolean; approvalDiffs?: { path: string; oldText?: string; newText?: string; additions?: number; deletions?: number }[] }
  | { type: "tool_group"; id: string; tools: ToolCallEvent[] }
  | { type: "plan_preview"; id: string; path: string; projectPath?: string }
  | { type: "change_group"; id: string; changes: { path: string; oldText?: string; newText?: string; additions?: number; deletions?: number }[] };

type ViewportAnchor = { key: string; offsetTop: number };
type ResizeViewportAnchor = ViewportAnchor & { userScrollGeneration: number };
type ProcessCollapseViewportSnapshot = {
  anchorElement: HTMLElement | null;
  anchorViewportTop?: number;
  scrollTop: number;
  autoFollow: boolean;
  userScroll: boolean;
};
type PermissionModeDiagDetail = {
  traceId?: string;
  stage?: string;
  requestedMode?: string;
  previousMode?: string;
  runtimeSessionId?: string;
  activeSessionId?: string;
  activeRuntimeSessionId?: string;
  currentSessionId?: string;
  runningSessionId?: string | null;
  [key: string]: unknown;
};

function renderItemKey(item: RenderItem) {
  return item.type === "event" ? item.event.id : item.type === "tool_group" ? item.id : item.type === "plan_preview" ? item.id : item.id;
}

function useAnimatedDots(active: boolean) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!active) {
      setCount(0);
      return;
    }
    const timer = window.setInterval(() => {
      setCount((value) => (value + 1) % 4);
    }, 450);
    return () => window.clearInterval(timer);
  }, [active]);

  return ".".repeat(count);
}

function AnimatedDotsSlot({ dots }: { dots: string }) {
  return (
    <span className="relative inline-block text-left" aria-hidden="true">
      <span className="invisible">...</span>
      <span className="absolute inset-0">{dots}</span>
    </span>
  );
}

function SessionHistoryLoadingState() {
  return (
    <div
      className="flex h-full w-full items-center justify-center overflow-hidden"
      style={{ paddingLeft: 24, paddingRight: 24 }}
    >
      <div
        className="flex items-center justify-center text-text-muted"
        style={{ minHeight: 40, gap: 10, paddingLeft: 16, paddingRight: 16 }}
        role="status"
        aria-live="polite"
      >
        <Loader2 size={17} className="animate-spin" />
        <span style={{ fontSize: 15, lineHeight: "22px", fontWeight: 500, textWrap: "pretty" }}>正在同步最新会话</span>
      </div>
    </div>
  );
}

const COMPACTION_STALE_MS = 15 * 60 * 1000;
const COMPACTION_LONG_RUNNING_MS = 5 * 60 * 1000;
const CHAT_FULL_RENDER_ITEM_LIMIT = 28;
const OLDER_ITEMS_BATCH_SIZE = CHAT_FULL_RENDER_ITEM_LIMIT;
const CHAT_BOTTOM_SPACER_HEIGHT = 60;
const SESSION_OPEN_BOTTOM_MAX_WAIT_MS = 3_500;
const USER_SUBMIT_BOTTOM_MAX_WAIT_MS = 6_000;
const SESSION_LAYOUT_STABLE_MS = 80;
const SCROLL_ANCHOR_IDLE_CAPTURE_MS = 140;
const USER_SCROLL_RESIZE_RESTORE_SUPPRESS_MS = 260;
const USER_SCROLL_ANCHOR_RESTORE_SUPPRESS_MS = 700;
const MAX_RESIZE_ANCHOR_RESTORE_PX = 300;

const longTaskStageLabels: Record<LongTaskSessionMeta["stage"], string> = {
  drafting: "需求澄清",
  planning: "计划设计",
  ready: "等待执行",
  running: "执行中",
  reviewing: "已暂停",
  paused: "已暂停",
  completed: "已完成",
};

const longTaskAgentLabels: Record<LongTaskSessionMeta["activeAgent"], string> = {
  executor: "长程任务",
  reviewer: "长程任务",
};

const KIMI_PLAN_PATH_PATTERN = /(?:[A-Za-z]:\\[^\r\n"'<>|]*?\.kimi(?:-code)?\\plans\\[^\s"'<>|]+\.md|\/[^\s"'<>]*?\.kimi(?:-code)?\/plans\/[^\s"'<>|]+\.md|\.kimi(?:-code)?[\\/]+plans[\\/]+[^\s"'<>|]+\.md)/i;

function cleanPlanPath(pathValue: string) {
  return pathValue.trim().replace(/[),.;，。；）]+$/u, "");
}

function findPlanPathInChangeSummary(event?: Extract<TimelineEvent, { type: "change_summary" }> | null) {
  return event?.files.map((file) => file.path.match(KIMI_PLAN_PATH_PATTERN)?.[0]).filter(Boolean).map((path) => cleanPlanPath(path as string))[0] ?? null;
}

function isKimixSyntheticThinking(text: string) {
  const trimmed = text.trim();
  return trimmed.startsWith("【实时状态】") ||
    trimmed.includes("当前 prompt-mode 尚未实时写出思考正文") ||
    trimmed.includes("Kimix 会继续回放");
}

function normalizeFilePath(value: string) {
  return normalizePathForComparison(value);
}

function slashNoticeCommand(event: Extract<TimelineEvent, { type: "status_update" }>): string | null {
  if (event.source !== "slash" || !event.message) return null;
  const match = event.message.match(/^已接收本地指令：([\s\S]+)$/);
  return match?.[1]?.trim() || null;
}

function splitUserAttachedStatuses(events: TimelineEvent[]) {
  const attachedByUserId = new Map<string, Extract<TimelineEvent, { type: "status_update" }>[]>();
  const remaining: TimelineEvent[] = [];
  const userEvents = events.filter((event): event is Extract<TimelineEvent, { type: "user_message" }> => event.type === "user_message");

  const attach = (userId: string, status: Extract<TimelineEvent, { type: "status_update" }>) => {
    attachedByUserId.set(userId, [...(attachedByUserId.get(userId) ?? []), status]);
  };

  for (const event of events) {
    if (event.type !== "status_update" || event.source !== "slash") {
      remaining.push(event);
      continue;
    }
    if (event.parentEventId && userEvents.some((user) => user.id === event.parentEventId)) {
      attach(event.parentEventId, event);
      continue;
    }
    const command = slashNoticeCommand(event);
    const matchedUser = command
      ? [...userEvents].reverse().find((user) => user.content.trim() === command)
      : undefined;
    if (matchedUser) {
      attach(matchedUser.id, event);
      continue;
    }
    remaining.push(event);
  }

  return { events: remaining, attachedByUserId };
}

function PlanPreviewCard({ path, projectPath, sessionId }: { path: string; projectPath?: string; sessionId?: string }) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadPlan = () => {
    setLoading(true);
    setError("");
    void window.api.readTextFile({ path, projectPath, sessionId }).then((res) => {
      if (res.success) {
        setContent(res.data.content);
      } else {
        setContent("");
        setError(res.error);
      }
    }).catch((err: unknown) => {
      setContent("");
      setError(err instanceof Error ? err.message : String(err));
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    loadPlan();
  }, [path, projectPath, sessionId]);

  return (
    <div className="w-full overflow-hidden rounded-[var(--radius-md)] border border-accent-primary-soft bg-accent-primary-light">
      <div className="flex min-h-14 items-center border-b border-accent-primary-soft" style={{ paddingLeft: 18, paddingRight: 18, gap: 12 }}>
        <FileText size={16} className="shrink-0 text-accent-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-medium leading-5 text-accent-primary-dark">待确认的 Plan</div>
          <div className="mt-1 truncate text-[12.5px] leading-5 text-accent-primary-soft">{path}</div>
        </div>
        <button
          type="button"
          onClick={loadPlan}
          disabled={loading}
          className="kimix-icon-text-button is-compact shrink-0 bg-surface-elevated text-accent-primary hover:bg-accent-primary-light disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          刷新
        </button>
      </div>
      <div style={{ padding: "16px 18px 18px" }}>
        {loading ? (
          <div className="rounded-lg bg-surface-elevated text-[13px] leading-6 text-accent-primary-soft" style={{ padding: "13px 14px" }}>
            正在读取 Plan 内容...
          </div>
        ) : error ? (
          <div className="rounded-lg bg-accent-danger-light text-[13px] leading-6 text-accent-danger" style={{ padding: "13px 14px" }}>
            读取 Plan 失败：{error}
          </div>
        ) : (
          <div className="max-h-[520px] overflow-y-auto rounded-lg bg-surface-elevated text-[14px] leading-6 text-accent-primary-dark" style={{ padding: "16px 16px" }}>
            <MarkdownRenderer content={content || "Plan 文件为空。"} />
          </div>
        )}
      </div>
    </div>
  );
}

function CompactionLabel({
  event,
  isSessionRunning,
}: {
  event: Extract<TimelineEvent, { type: "compaction" }>;
  isSessionRunning?: boolean;
}) {
  const elapsed = Date.now() - event.timestamp;
  const isLongRunning = event.phase === "begin" && elapsed >= COMPACTION_LONG_RUNNING_MS;
  const isStale = event.phase === "begin" && !isSessionRunning && elapsed >= COMPACTION_STALE_MS;
  const dots = useAnimatedDots(event.phase === "begin" && !isStale);
  if (isStale) return <>上下文压缩可能已卡住，可重新尝试</>;
  if (event.phase === "end") return <>{event.summary ? "上下文压缩完成，已生成摘要" : "上下文压缩完成"}</>;
  if (isLongRunning) {
    return (
      <>
        上下文压缩耗时较长
        <AnimatedDotsSlot dots={dots} />
      </>
    );
  }
  return (
    <>
      上下文压缩中
      <AnimatedDotsSlot dots={dots} />
    </>
  );
}

function CompactionNotice({
  event,
  isSessionRunning,
}: {
  event: Extract<TimelineEvent, { type: "compaction" }>;
  isSessionRunning?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (event.phase === "end" && event.summary) {
    return (
      <div className="flex justify-center" style={{ paddingTop: 4, paddingBottom: 4 }}>
        <div className="kimix-soft-card w-full max-w-[680px] overflow-hidden rounded-xl text-text-muted">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="grid w-full items-center text-left transition-colors hover:bg-[var(--kimix-panel-hover)]"
            style={{ gridTemplateColumns: "minmax(0, 1fr) 18px", gap: 10, minHeight: 40, paddingLeft: 16, paddingRight: 14 }}
            aria-expanded={expanded}
          >
            <span className="truncate" style={{ fontSize: 13, lineHeight: "18px" }}>
              <CompactionLabel event={event} isSessionRunning={isSessionRunning} />
            </span>
            <span className="flex h-5 items-center justify-center text-[var(--kimix-process-muted)]">
              {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </span>
          </button>
          {expanded && (
            <div
              className="border-t border-[var(--kimix-panel-divider)] text-text-secondary"
              style={{ fontSize: 13, lineHeight: "21px", paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 14 }}
            >
              <MarkdownRenderer content={event.summary} wrapLongLines />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center" style={{ paddingTop: 2, paddingBottom: 2 }}>
      <div
        className="inline-flex max-w-full items-center rounded-full bg-surface-hover text-text-muted"
        style={{ gap: 8, paddingLeft: 16, paddingRight: 16, paddingTop: 6, paddingBottom: 6, fontSize: 13, lineHeight: "18px" }}
      >
        <CompactionLabel event={event} isSessionRunning={isSessionRunning} />
      </div>
    </div>
  );
}

function ToolGroup({ tools }: { tools: ToolCallEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const completed = tools.filter((tool) => tool.status === "success").length;
  const running = tools.filter((tool) => tool.status === "running").length;
  const summary = [
    completed > 0 ? `已运行 ${completed} 条命令` : "",
    running > 0 ? `正在运行 ${running} 条命令` : "",
  ].filter(Boolean).join("，");

  return (
    <div className="w-full">
      <button
        onClick={() => setExpanded((value) => !value)}
        className="kimix-chat-collapse-row w-full text-left text-[14.5px] leading-none text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-hover)]"
      >
        {expanded ? <ChevronDown size={15} className="shrink-0" /> : <ChevronRight size={15} className="shrink-0" />}
        <Wrench size={15} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{summary || "正在运行命令"}</span>
      </button>
      {expanded && (
        <div className="mt-1 space-y-1">
          {tools.map((tool) => (
            <ToolCard key={tool.id} event={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

function LongTaskBanner({ meta, projectPath }: { meta: LongTaskSessionMeta; projectPath: string }) {
  return (
    <div
      className="kimix-chat-banner rounded-2xl shadow-[0_10px_26px_rgba(74,132,190,0.10)]"
      style={{ padding: "16px 18px" }}
    >
      <div className="flex flex-wrap items-center justify-between" style={{ gap: 12 }}>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium leading-6">长程任务：{meta.title}</div>
          <div className="kimix-chat-banner-muted mt-1.5 text-[13px] leading-5">
            当前工作：{longTaskAgentLabels[meta.activeAgent]} · {longTaskStageLabels[meta.stage]} · 步骤 {meta.currentStep}{meta.targetStep ? ` / ${meta.targetStep}` : " / 未设置"}
          </div>
        </div>
        <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
          <button
            type="button"
            className="kimix-chat-banner-button kimix-icon-text-button is-compact rounded-lg text-[var(--kimix-info-text)] hover:opacity-90"
            onClick={() => {
              void window.api.openFile({ projectPath, filePath: meta.bigPlanPath });
            }}
          >
            BIGPLAN
          </button>
          <span className="kimix-chat-banner-badge rounded-lg text-[12px] leading-5 text-[var(--kimix-info-text)]" style={{ minHeight: 32, padding: "5px 10px" }}>
            自动执行
          </span>
        </div>
      </div>
    </div>
  );
}

function UserAttachedStatuses({ statuses }: { statuses?: Extract<TimelineEvent, { type: "status_update" }>[] }) {
  if (!statuses || statuses.length === 0) return null;
  return (
    <div className="flex flex-col items-end" style={{ gap: 6, paddingRight: 18, marginTop: -12, marginBottom: 8 }}>
      {statuses.map((status) => <StatusCard key={status.id} event={status} />)}
    </div>
  );
}

function FoldedHistoryNotice({ count, onExpand }: { count: number; onExpand: () => void }) {
  return (
    <div className="flex justify-center" style={{ paddingTop: 4, paddingBottom: 2 }}>
      <button
        type="button"
        onClick={onExpand}
        className="kimix-icon-text-button kimix-muted-action"
        style={{ minHeight: 34, paddingLeft: 16, paddingRight: 16 }}
      >
        <ChevronDown size={15} />
        <span>已折叠较早对话 {count} 条，点击展开</span>
      </button>
    </div>
  );
}

function EventRenderer({ event, sessionId, runtimeSessionId, projectPath, turnStartedAt, leadingTools, leadingSubagents, leadingHooks, leadingApprovals, attachedSteers, attachedUserStatuses, activeStatus, changedFiles, changeSummary, trailingStatuses, hideProcessSummary, expandProcessByDefault, approvalDiffs, onRetryError, onDismissError, onDeleteUserMessage, deletableUserMessageIds, eagerMarkdown, isSessionRunning }: { event: TimelineEvent; sessionId: string; runtimeSessionId?: string; projectPath: string; turnStartedAt?: number; leadingTools?: ToolCallEvent[]; leadingSubagents?: Extract<TimelineEvent, { type: "subagent" }>[]; leadingHooks?: Extract<TimelineEvent, { type: "hook" }>[]; leadingApprovals?: Extract<TimelineEvent, { type: "approval_request" }>[]; attachedSteers?: Extract<TimelineEvent, { type: "steer_message" }>[]; attachedUserStatuses?: Extract<TimelineEvent, { type: "status_update" }>[]; activeStatus?: Extract<TimelineEvent, { type: "status_update" }>; changedFiles?: string[]; changeSummary?: Extract<TimelineEvent, { type: "change_summary" }>; trailingStatuses?: Extract<TimelineEvent, { type: "status_update" }>[]; hideProcessSummary?: boolean; expandProcessByDefault?: boolean; approvalDiffs?: { path: string; oldText?: string; newText?: string; additions?: number; deletions?: number }[]; onRetryError?: () => Promise<void>; onDismissError?: (eventId: string) => void; onDeleteUserMessage?: (eventId: string) => void; deletableUserMessageIds?: ReadonlySet<string>; eagerMarkdown?: boolean; isSessionRunning?: boolean }) {
  switch (event.type) {
    case "user_message":
      return (
        <>
          <MessageBubble event={event} sessionId={sessionId} runtimeSessionId={runtimeSessionId} onDeleteUserMessage={deletableUserMessageIds?.has(event.id) ? onDeleteUserMessage : undefined} />
          <UserAttachedStatuses statuses={attachedUserStatuses} />
        </>
      );
    case "steer_message":
      return <MessageBubble event={event} sessionId={sessionId} runtimeSessionId={runtimeSessionId} />;
    case "assistant_message":
      return <MessageBubble event={event} sessionId={sessionId} runtimeSessionId={runtimeSessionId} turnStartedAt={turnStartedAt} leadingTools={leadingTools} leadingSubagents={leadingSubagents} leadingHooks={leadingHooks} leadingApprovals={leadingApprovals} attachedSteers={attachedSteers} activeStatus={activeStatus} changedFiles={changedFiles} changeSummary={changeSummary} trailingStatuses={trailingStatuses} hideProcessSummary={hideProcessSummary} expandProcessByDefault={expandProcessByDefault} eagerMarkdown={eagerMarkdown} />;
    case "tool_call":
      return <ToolCard event={event} />;
    case "tool_result":
      return null;
    case "approval_request":
      return <ApprovalCard event={event} diffPreviews={approvalDiffs} />;
    case "question_request":
      return <QuestionCard event={event} />;
    case "status_update":
      if (!shouldRenderStandaloneStatusUpdate(event)) return null;
      return <StatusCard event={event} />;
    case "file_artifact":
      return <FileCard event={event} />;
    case "change_summary":
      return <ChangeCard event={event} />;
    case "session_recommendation":
      return <SessionRecommendationCard event={event} sourceSessionId={sessionId} projectPath={projectPath} />;
    case "todo":
    case "hook":
      return null;
    case "diff":
      return <ChangeCard changes={[{ path: event.filePath, oldText: event.oldText, newText: event.newText }]} />;
    case "error":
      return (
        <ErrorCard
          event={event}
          onRetry={event.roomMessageId && event.roomAgentId
            ? async () => {
                window.dispatchEvent(new CustomEvent("kimix:room-delivery-action", {
                  detail: {
                    action: "retry",
                    sessionId,
                    roomMessageId: event.roomMessageId,
                    roomAgentId: event.roomAgentId,
                  },
                }));
              }
            : onRetryError}
          onDismiss={onDismissError ? () => onDismissError(event.id) : undefined}
        />
      );
    case "subagent":
      return (
        <div className="kimix-soft-card flex items-center gap-2 rounded-xl text-[14.5px]" style={{ paddingLeft: 14, paddingRight: 16, paddingTop: 10, paddingBottom: 10 }}>
          {event.status === "running" ? (
            <Loader2 size={16} className="shrink-0 animate-spin text-[var(--kimix-panel-text-muted)]" />
          ) : (
            <Bot size={16} className="shrink-0 text-[var(--kimix-panel-text-muted)]" />
          )}
          <span>{event.status === "running" ? "子代理运行中" : "子代理已完成任务"}</span>
        </div>
      );
    case "compaction":
      return <CompactionNotice event={event} isSessionRunning={isSessionRunning} />;
    default:
      return null;
  }
}

function mergeChangeSummaryEvents(events: Extract<TimelineEvent, { type: "change_summary" }>[]): Extract<TimelineEvent, { type: "change_summary" }> | null {
  if (events.length === 0) return null;
  const filesByPath = new Map<string, { path: string; additions?: number; deletions?: number }>();
  for (const event of events) {
    for (const file of event.files) {
      const key = normalizeFilePath(file.path);
      const existing = filesByPath.get(key);
      filesByPath.set(key, {
        path: existing?.path ?? file.path,
        additions: (existing?.additions ?? 0) + (file.additions ?? 0),
        deletions: (existing?.deletions ?? 0) + (file.deletions ?? 0),
      });
    }
  }
  const files = Array.from(filesByPath.values());
  return {
    id: events.map((event) => event.id).join(":"),
    type: "change_summary",
    timestamp: events.at(-1)?.timestamp ?? Date.now(),
    projectPath: events.find((event) => event.projectPath)?.projectPath,
    files,
    additions: files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
    deletions: files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
  };
}

export function buildRenderItems(
  events: TimelineEvent[],
  sessionEngine?: "prompt" | "kimi-code",
  attachedUserStatuses?: Map<string, Extract<TimelineEvent, { type: "status_update" }>[]>,
  isSessionRunning = false,
  activeRoomAgentIds?: ReadonlySet<string>,
): RenderItem[] {
  const items: RenderItem[] = [];

  const pushStandaloneTools = (tools: ToolCallEvent[], turnStartedAt?: number, isTurnActive = false) => {
    if (tools.length === 0) return;
    if (sessionEngine === "kimi-code") {
      items.push({ type: "event", event: createToolOnlyAssistantEvent(tools, isTurnActive), turnStartedAt, leadingTools: tools, trailingStatuses: [] });
      return;
    }
    items.push({ type: "tool_group", id: tools[0].id, tools });
  };

  const mergeAssistantProcessEvents = (assistantEvents: Extract<TimelineEvent, { type: "assistant_message" }>[]) => {
    const visible = assistantEvents.filter((event) => (
      event.content.trim().length > 0 ||
      Boolean(event.thinking?.trim()) ||
      Boolean(event.thinkingParts?.some((part) => part.text.trim().length > 0)) ||
      !event.isComplete
    ));
    if (visible.length === 0) return undefined;
    const first = visible[0];
    const last = visible[visible.length - 1];
    return {
      ...first,
      id: first.agentTurnId ? `assistant:${first.agentTurnId}` : visible.map((event) => event.id).join(":"),
      timestamp: first.timestamp,
      content: visible.map((event) => event.content).filter((content) => content.trim()).join("\n\n"),
      thinking: visible.map((event) => event.thinking ?? "").filter((thinking) => thinking.trim()).join(""),
      thinkingParts: visible.flatMap((event) => event.thinkingParts ?? []),
      isThinking: visible.some((event) => event.isThinking && !event.isComplete),
      isComplete: visible.every((event) => event.isComplete),
      durationMs: reliableAssistantDurationMs(last.durationMs),
    } satisfies Extract<TimelineEvent, { type: "assistant_message" }>;
  };

  const renderTurnBody = (turnEvents: TimelineEvent[], turnStartedAt?: number, isLatestTurn = false) => {
    turnEvents
      .filter((event): event is Extract<TimelineEvent, { type: "compaction" }> => event.type === "compaction")
      .forEach((event) => items.push({ type: "event", event }));
    const tools = turnEvents.filter((event): event is ToolCallEvent => event.type === "tool_call");
    const steerEvents = turnEvents.filter((event): event is Extract<TimelineEvent, { type: "steer_message" }> => event.type === "steer_message");
    const assistantEvents = turnEvents.filter((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => event.type === "assistant_message");
    const changedFiles = new Set(
      turnEvents
        .filter((e): e is Extract<TimelineEvent, { type: "change_summary" }> => e.type === "change_summary")
        .flatMap((e) => e.files.map((f) => f.path))
    );
    let toolsAttached = false;
    let assistantAttached = false;
    const mergedAssistantEvent = mergeAssistantProcessEvents(assistantEvents);
    const assistantEventIds = new Set(assistantEvents.map((assistantEvent) => assistantEvent.id));

    const statusEvents = turnEvents.filter((event): event is Extract<TimelineEvent, { type: "status_update" }> => event.type === "status_update");
    const subagents = turnEvents.filter((event): event is Extract<TimelineEvent, { type: "subagent" }> => event.type === "subagent");
    const hooks = turnEvents.filter((event): event is Extract<TimelineEvent, { type: "hook" }> => event.type === "hook");
    // Resolved (approved/rejected) approvals fold into the assistant process
    // summary; only pending ones stay as standalone interactive cards. If there
    // is no assistant message to fold into, keep them standalone as a fallback.
    const resolvedApprovals = turnEvents.filter(
      (event): event is Extract<TimelineEvent, { type: "approval_request" }> =>
        event.type === "approval_request" && event.status !== "pending"
    );
    const foldApprovals = Boolean(mergedAssistantEvent) && resolvedApprovals.length > 0;
    const roomAgentId = turnEvents.find((event) => event.roomAgentId)?.roomAgentId;
    const isRoomAgentRunning = Boolean(roomAgentId && activeRoomAgentIds?.has(roomAgentId));
    const turnSettled = (
      !isRoomAgentRunning &&
      !(!roomAgentId && isLatestTurn && isSessionRunning) &&
      !assistantEvents.some((event) => !event.isComplete) &&
      !tools.some((event) => event.status === "running") &&
      !subagents.some((event) => event.status === "queued" || event.status === "running" || event.status === "suspended")
    );
    const renderAssistantEvent = mergedAssistantEvent && !turnSettled && mergedAssistantEvent.isComplete
      ? { ...mergedAssistantEvent, isComplete: false }
      : mergedAssistantEvent;
    const settledStatusEvents = statusEvents.filter((status) => !(status.source === "ipc" && status.parentEventId));
    const finalUsageStatus = settledStatusEvents.findLast(hasMetricStatus);
    const trailingStatusEvents = turnSettled
      ? (finalUsageStatus ? [finalUsageStatus] : settledStatusEvents.slice(-1))
      : [];
    const activeStatusEvent = turnSettled
      ? undefined
      : statusEvents.findLast((status) => status.source === "ipc" && Boolean(status.message?.trim()));
    const diffEvents = turnEvents.filter((event): event is Extract<TimelineEvent, { type: "diff" }> => event.type === "diff");
    const mergedChangeSummary = mergeChangeSummaryEvents(turnEvents.filter((event): event is Extract<TimelineEvent, { type: "change_summary" }> => event.type === "change_summary"));
    const summaryPathSet = new Set((mergedChangeSummary?.files ?? []).map((file) => normalizeFilePath(file.path)));
    const standaloneDiffEvents = diffEvents.filter((diff) => {
      const normalized = normalizeFilePath(diff.filePath);
      return !summaryPathSet.has(normalized) && !Array.from(summaryPathSet).some((path) => path.endsWith(`/${normalized}`) || normalized.endsWith(`/${path}`));
    });
    const planPath = findPlanPathInChangeSummary(mergedChangeSummary);
    let changeSummaryAttached = false;
    let diffGroupAttached = false;
    let planPreviewAttached = false;
    let steerAttached = false;
    const getAttachedSteers = () => {
      if (steerAttached) return [];
      steerAttached = true;
      return steerEvents;
    };
    const pushStandaloneSteers = () => {
      if (steerAttached) return;
      steerEvents.forEach((event) => items.push({ type: "event", event }));
      steerAttached = true;
    };
    for (const [eventIndex, event] of turnEvents.entries()) {
      if (event.type === "compaction") continue;
      if (event.type === "steer_message") continue;
      if (event.type === "tool_call" || event.type === "tool_result") continue;
      if (event.type === "subagent") continue;
      if (event.type === "hook") continue;
      if (event.type === "status_update") continue;
      if (event.type === "change_summary") continue;
      if (event.type === "diff") continue;
      if (event.type === "assistant_message") {
        if (assistantAttached || !renderAssistantEvent) continue;
        const hasContent = renderAssistantEvent.content.trim().length > 0;
        const hasOwnProcessDetails = Boolean(
          (renderAssistantEvent.thinking?.trim() && !isKimixSyntheticThinking(renderAssistantEvent.thinking)) ||
          renderAssistantEvent.thinkingParts?.some((part) => part.text.trim().length > 0 && !isKimixSyntheticThinking(part.text))
        );
        items.push({
          type: "event",
          event: renderAssistantEvent,
          turnStartedAt,
          leadingTools: assistantAttached ? [] : tools,
          leadingSubagents: assistantAttached ? [] : subagents,
          leadingHooks: assistantAttached ? [] : hooks,
          leadingApprovals: assistantAttached ? [] : resolvedApprovals,
          attachedSteers: getAttachedSteers(),
          activeStatus: activeStatusEvent,
          changedFiles: assistantAttached ? [] : Array.from(changedFiles),
          changeSummary: assistantAttached ? undefined : mergedChangeSummary ?? undefined,
          trailingStatuses: assistantAttached ? [] : trailingStatusEvents,
          hideProcessSummary: assistantAttached && (hasContent || !hasOwnProcessDetails),
        });
        assistantAttached = true;
        toolsAttached = true;
        if (mergedChangeSummary) changeSummaryAttached = true;
        continue;
      }
      if (event.type === "user_message" || event.type === "todo") continue;
      if (!toolsAttached) {
        if (tools.length > 0) {
          pushStandaloneTools(tools, turnStartedAt, !turnSettled);
          toolsAttached = true;
        }
      }
      if ((event.type === "question_request" || event.type === "approval_request") && mergedChangeSummary && !changeSummaryAttached) {
        items.push({ type: "event", event: mergedChangeSummary });
        changeSummaryAttached = true;
      }
      if ((event.type === "question_request" || event.type === "approval_request") && standaloneDiffEvents.length > 0 && !diffGroupAttached) {
        items.push({
          type: "change_group",
          id: `diff-group-${standaloneDiffEvents.map((diff) => diff.id).join(":")}`,
          changes: standaloneDiffEvents.map((diff) => ({ path: diff.filePath, oldText: diff.oldText, newText: diff.newText })),
        });
        diffGroupAttached = true;
      }
      if ((event.type === "question_request" || event.type === "approval_request") && planPath && !planPreviewAttached) {
        items.push({ type: "plan_preview", id: `plan-preview-${planPath}`, path: planPath, projectPath: mergedChangeSummary?.projectPath });
        planPreviewAttached = true;
      }
      if (event.type === "approval_request") {
        // Resolved approvals are folded into the assistant process summary; do
        // not render them as standalone cards below the body.
        if (foldApprovals && (event as Extract<TimelineEvent, { type: "approval_request" }>).status !== "pending") {
          continue;
        }
        items.push({ type: "event", event, approvalDiffs: diffEvents.map((diff) => ({ path: diff.filePath, oldText: diff.oldText, newText: diff.newText })) });
        continue;
      }
      items.push({ type: "event", event });
    }

    if (!toolsAttached) pushStandaloneTools(tools, turnStartedAt, !turnSettled);
    pushStandaloneSteers();
    if (mergedChangeSummary && !changeSummaryAttached) {
      items.push({ type: "event", event: mergedChangeSummary });
      changeSummaryAttached = true;
    }
    if (standaloneDiffEvents.length > 0 && !diffGroupAttached) {
      items.push({
        type: "change_group",
        id: `diff-group-${standaloneDiffEvents.map((diff) => diff.id).join(":")}`,
        changes: standaloneDiffEvents.map((diff) => ({ path: diff.filePath, oldText: diff.oldText, newText: diff.newText })),
      });
      diffGroupAttached = true;
    }
    if (planPath && !planPreviewAttached) {
      items.push({ type: "plan_preview", id: `plan-preview-${planPath}`, path: planPath, projectPath: mergedChangeSummary?.projectPath });
    }
    if (turnSettled && !assistantAttached) {
      statusEvents
        .filter(shouldRenderStandaloneStatusUpdate)
        .forEach((event) => items.push({ type: "event", event }));
    }
    if (!assistantAttached && subagents.length > 0) {
      items.push({
        type: "event",
        event: createSubagentOnlyAssistantEvent(subagents),
        turnStartedAt,
        leadingSubagents: subagents,
        trailingStatuses: [],
      });
      assistantAttached = true;
    }
    // Subagent progress belongs to the message stream so it stays aligned with the turn timeline.
  };

  let turnBody: TimelineEvent[] = [];
  let currentTurnStartedAt: number | undefined;
  let currentAgentTurnId: string | undefined;
  const flushTurn = (isLatestTurn = false) => {
    renderTurnBody(turnBody, currentTurnStartedAt, isLatestTurn);
    turnBody = [];
    currentAgentTurnId = undefined;
  };

  for (const event of events) {
    if (event.type === "user_message") {
      flushTurn(false);
      items.push({ type: "event", event, attachedUserStatuses: attachedUserStatuses?.get(event.id) });
      currentTurnStartedAt = event.timestamp;
      continue;
    }
    if (event.type === "steer_message") {
      flushTurn();
      items.push({ type: "event", event });
      continue;
    }

    if (event.agentTurnId && currentAgentTurnId && event.agentTurnId !== currentAgentTurnId) {
      flushTurn(false);
    }
    if (event.agentTurnId) currentAgentTurnId = event.agentTurnId;

    turnBody.push(event);
  }
  flushTurn(true);
  return items;
}

export function filterStatusUpdates(events: TimelineEvent[], display: "each" | "turn_end" | "never"): TimelineEvent[] {
  return events.filter((event, index) => {
    if (event.type !== "status_update") return true;
    if (event.source === "slash") return true;
    // Prompt-link statuses drive the live assistant process header. They are
    // intentionally retained even when standalone status cards are hidden;
    // renderTurnBody removes them again once the turn settles.
    if (event.source === "ipc" && event.parentEventId) return true;
    if (display === "never") return false;
    if (display === "each") return true;
    const previousTurnIndex = events.findLastIndex((candidate, candidateIndex) => (
      candidateIndex < index &&
      (candidate.type === "user_message" || candidate.type === "steer_message")
    ));
    const nextTurnIndex = events.findIndex((candidate, candidateIndex) => (
      candidateIndex > index &&
      (candidate.type === "user_message" || candidate.type === "steer_message")
    ));
    const turnStart = previousTurnIndex === -1 ? 0 : previousTurnIndex + 1;
    const turnEnd = nextTurnIndex === -1 ? events.length : nextTurnIndex;
    const statusesInAgentTurn = events.slice(turnStart, turnEnd).filter((candidate): candidate is Extract<TimelineEvent, { type: "status_update" }> => {
      if (candidate.type !== "status_update") return false;
      if (candidate.source === "slash") return false;
      if (candidate.source === "ipc" && candidate.parentEventId) return false;
      if (event.agentTurnId) return candidate.agentTurnId === event.agentTurnId;
      if (event.roomAgentId) return candidate.roomAgentId === event.roomAgentId && !candidate.agentTurnId;
      return !candidate.agentTurnId && !candidate.roomAgentId;
    });
    const preferredStatus = statusesInAgentTurn.findLast(hasMetricStatus) ?? statusesInAgentTurn.at(-1);
    return preferredStatus === event;
  });
}

function collapseCompletedCompactions(events: TimelineEvent[]): TimelineEvent[] {
  return events.filter((event, index) => {
    if (event.type !== "compaction" || event.phase !== "begin") return true;
    const nextCompaction = events
      .slice(index + 1)
      .find((candidate) => candidate.type === "compaction");
    return nextCompaction?.type !== "compaction" || nextCompaction.phase !== "end";
  });
}

function hasVisibleConversation(events: TimelineEvent[], runningSessionId: string | null, sessionId?: string, runtimeSessionId?: string, isRoomRunning = false): boolean {
  const isRunningThisSession = Boolean(sessionId && (
    runningSessionId === sessionId ||
    Boolean(runtimeSessionId && runningSessionId === runtimeSessionId) ||
    isRoomRunning
  ));
  return events.some((event) => {
    if (event.type === "user_message") {
      return event.content.trim().length > 0 || Boolean(event.images && event.images.length > 0);
    }
    if (event.type === "steer_message") {
      return event.content.trim().length > 0;
    }
    if (event.type === "assistant_message") {
      const hasText =
        event.content.trim().length > 0 ||
        Boolean(event.thinking && event.thinking.trim().length > 0);
      const isActiveThinking = Boolean(isRunningThisSession && event.isThinking && !event.isComplete);
      return hasText || isActiveThinking;
    }
    if (event.type === "tool_result") return false;
    if (event.type === "status_update") {
      return Boolean(event.message && event.message.trim().length > 0) || isRunningThisSession;
    }
    if (
      event.type === "tool_call" ||
      event.type === "approval_request" ||
      event.type === "question_request" ||
      event.type === "file_artifact" ||
      event.type === "change_summary" ||
      event.type === "session_recommendation" ||
      event.type === "diff" ||
      event.type === "error" ||
      event.type === "subagent" ||
      event.type === "compaction"
    ) {
      return true;
    }
    return false;
  });
}

export const ChatThread = memo(function ChatThread() {
  const currentSession = useAppStore((s) => s.currentSession);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const roomAgentActivities = useAppStore((s) => s.roomAgentActivities);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const pendingMessages = useSessionStore((s) => s.pendingMessages);
  const statusUpdateDisplay = useAppStore((s) => s.statusUpdateDisplay);
  const session = useLiveSession(currentSession?.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamContentRef = useRef<HTMLDivElement>(null);
  const autoFollowRef = useRef(true);
  const userScrollRef = useRef(false);
  const ignoreScrollUntilRef = useRef(0);
  const scrollTokenRef = useRef(0);
  const isAutoFollowRef = useRef(true);
  const showScrollToBottomRef = useRef(false);
  const scrollToBottomButtonRef = useRef<HTMLButtonElement>(null);
  const sessionAutoBottomUntilRef = useRef(0);
  const sessionAutoBottomTimerRef = useRef<number | null>(null);
  const sessionAutoBottomStableRef = useRef<{ scrollHeight: number; clientHeight: number; count: number } | null>(null);
  const pendingOlderItemsScrollAnchorRef = useRef<ViewportAnchor | null>(null);
  const pendingTailExpandScrollAnchorRef = useRef<ViewportAnchor | null>(null);
  const pendingFocusEventRef = useRef<{ sessionId: string; eventId: string; searchText?: string } | null>(null);
  const resizeScrollAnchorRef = useRef<ResizeViewportAnchor | null>(null);
  const lastScrollSizeRef = useRef<{ width: number; height: number; scrollHeight: number } | null>(null);
  const lastScrollTopRef = useRef<number | null>(null);
  const lastScrollHeightRef = useRef<number | null>(null);
  const contentVersionRef = useRef("");
  const contentResizeSnapshotRef = useRef<{
    sessionId?: string;
    contentVersion: string;
    scrollHeight: number;
    scrollTop: number;
    clientHeight: number;
    autoFollow: boolean;
    userScroll: boolean;
  } | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const userInputLockUntilRef = useRef(0);
  const userBottomIntentUntilRef = useRef(0);
  const userScrollGenerationRef = useRef(0);
  const scrollbarPointerActiveRef = useRef(false);
  const lastUserScrollAtRef = useRef(0);
  const lastScrollDiagRef = useRef(0);
  const lastManualAnchorRestoreAtRef = useRef(0);
  const bottomTrackerFrameRef = useRef(0);
  const intentionalResizeRestoreUntilRef = useRef(0);
  const processCollapseViewportSnapshotsRef = useRef(new Map<string, ProcessCollapseViewportSnapshot>());
  const detachedViewportMinimumScrollHeightRef = useRef<number | null>(null);
  const detachedTailCompensationRef = useRef(0);
  const [olderItemsPage, setOlderItemsPage] = useState(0);
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  const [primedSessionId, setPrimedSessionId] = useState<string | null>(null);
  const [expandedInitialTailSessionId, setExpandedInitialTailSessionId] = useState<string | null>(null);
  const [userHasScrolled, setUserHasScrolled] = useState(false);

  const roomTimeline = useMemo(() => session ? projectCollaborationTimeline(session) : [], [session]);
  const splitEvents = useMemo(
    () => splitUserAttachedStatuses(collapseCompletedCompactions(roomTimeline)),
    [roomTimeline]
  );
  const visibleEvents = useMemo(
    () => filterStatusUpdates(splitEvents.events, statusUpdateDisplay),
    [splitEvents.events, statusUpdateDisplay]
  );
  const runtimeSessionId = session ? getRuntimeSessionId(session) : undefined;
  const activeRoomAgentIds = useMemo(() => new Set(Object.values(roomAgentActivities)
    .filter((activity) => activity.roomId === session?.id && ["running", "waiting_approval", "waiting_question"].includes(activity.status))
    .map((activity) => activity.roomAgentId)), [roomAgentActivities, session?.id]);
  const hasActiveTurn = Boolean(session && (activeRoomAgentIds.size > 0 || (
    runningSessionId === session.id ||
    Boolean(runtimeSessionId && runningSessionId === runtimeSessionId)
  )));
  const hasPendingMessage = Boolean(session && pendingMessages.some((msg) => msg.sessionId === session.id));
  const renderItems = useMemo(
    () => buildRenderItems(visibleEvents, session?.engine, splitEvents.attachedByUserId, hasActiveTurn, activeRoomAgentIds),
    [visibleEvents, session?.engine, splitEvents.attachedByUserId, hasActiveTurn, activeRoomAgentIds]
  );
  const latestProcessAssistantEventId = useMemo(() => {
    const item = renderItems.findLast((candidate) => (
      candidate.type === "event" &&
      candidate.event.type === "assistant_message" &&
      !candidate.hideProcessSummary
    ));
    return item?.type === "event" ? item.event.id : undefined;
  }, [renderItems]);
  const contentVersion = useMemo(() => {
    return roomTimeline.map((event) => {
      if (event.type === "assistant_message") {
        return `${event.id}:${event.roomAgentId ?? ""}:${event.agentTurnId ?? ""}:${event.content.length}:${event.thinking?.length ?? 0}:${event.isComplete ? 1 : 0}`;
      }
      return `${event.id}:${event.type}:${event.roomAgentId ?? ""}:${event.agentTurnId ?? ""}`;
    }).join("|");
  }, [roomTimeline]);
  contentVersionRef.current = contentVersion;

  const updateAutoFollow = (value: boolean) => {
    if (isAutoFollowRef.current === value) return;
    isAutoFollowRef.current = value;
  };

  const updateShowScrollToBottom = (value: boolean) => {
    if (showScrollToBottomRef.current === value) return;
    showScrollToBottomRef.current = value;
    const button = scrollToBottomButtonRef.current;
    if (!button) return;
    button.style.opacity = value ? "1" : "0";
    button.style.transform = value ? "translateY(0) scale(1)" : "translateY(6px) scale(0.96)";
    button.style.pointerEvents = value ? "auto" : "none";
    button.tabIndex = value ? 0 : -1;
    button.setAttribute("aria-hidden", value ? "false" : "true");
  };

  const setDetachedTailCompensation = (value: number) => {
    const nextValue = Math.max(0, value);
    if (Math.abs(detachedTailCompensationRef.current - nextValue) <= 0.01) return;
    detachedTailCompensationRef.current = nextValue;
    streamContentRef.current?.style.setProperty(
      "--kimix-detached-tail-compensation",
      `${nextValue}px`,
    );
  };

  const clearDetachedViewportCompensation = () => {
    detachedViewportMinimumScrollHeightRef.current = null;
    setDetachedTailCompensation(0);
  };

  const reconcileDetachedViewportCompensation = (node: HTMLElement) => {
    const minimumScrollHeight = detachedViewportMinimumScrollHeightRef.current;
    if (minimumScrollHeight === null) return;
    // Keep only the exact scroll-range debt that real final content has not yet
    // replaced. This avoids a later jump without reserving message-level height.
    const naturalScrollHeight = Math.max(0, node.scrollHeight - detachedTailCompensationRef.current);
    const nextCompensation = requiredViewportTailCompensation({
      minimumScrollHeight,
      naturalScrollHeight,
    });
    setDetachedTailCompensation(nextCompensation);
    if (nextCompensation <= 0.01) {
      detachedViewportMinimumScrollHeightRef.current = null;
    }
  };

  const naturalDistanceFromBottom = (node: HTMLElement) => Math.max(
    0,
    node.scrollHeight - detachedTailCompensationRef.current - node.scrollTop - node.clientHeight,
  );

  const clearSessionAutoBottomTimer = () => {
    if (sessionAutoBottomTimerRef.current === null) return;
    window.clearTimeout(sessionAutoBottomTimerRef.current);
    sessionAutoBottomTimerRef.current = null;
  };

  const cancelSessionAutoBottom = () => {
    sessionAutoBottomUntilRef.current = 0;
    sessionAutoBottomStableRef.current = null;
    clearSessionAutoBottomTimer();
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const node = scrollRef.current;
    if (!node) return;
    if (autoFollowRef.current && !userScrollRef.current) {
      clearDetachedViewportCompensation();
    }
    const locked = Date.now() < userInputLockUntilRef.current;
    const beforeScrollTop = node.scrollTop;
    const beforeScrollHeight = node.scrollHeight;
    const targetTop = bottomScrollTop(node);
    window.api.writeDiag?.({
      message: "[ChatThread] scrollToBottom",
      data: {
        behavior,
        autoFollow: autoFollowRef.current,
        userScroll: userScrollRef.current,
        locked,
        beforeScrollTop,
        beforeScrollHeight,
        targetTop,
      },
    }).catch(logError("writeDiag"));
    if (locked) return;
    const token = ++scrollTokenRef.current;
    ignoreScrollUntilRef.current = Date.now() + 420;
    if (behavior === "auto") {
      node.scrollTop = targetTop;
    } else {
      node.scrollTo({ top: targetTop, behavior });
    }
    window.setTimeout(() => {
      if (token !== scrollTokenRef.current || !autoFollowRef.current) return;
      const current = scrollRef.current;
      if (!current) return;
      const distance = current.scrollHeight - current.scrollTop - current.clientHeight;
      updateShowScrollToBottom(distance > 80);
      window.api.writeDiag?.({
        message: "[ChatThread] scrollToBottomAfter",
        data: {
          token,
          targetTop,
          afterScrollTop: current.scrollTop,
          afterScrollHeight: current.scrollHeight,
          afterClientHeight: current.clientHeight,
          distance,
        },
      }).catch(logError("writeDiag"));
    }, 60);
  };

  const settleSessionAtBottom = () => {
    const node = scrollRef.current;
    if (!node || !autoFollowRef.current || userScrollRef.current) {
      cancelSessionAutoBottom();
      return;
    }
    scrollToBottom("auto");
    const remaining = sessionAutoBottomUntilRef.current - Date.now();
    window.api.writeDiag?.({
      message: "[ChatThread] settleSessionAtBottom",
      data: {
        remaining,
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
        clientHeight: node.clientHeight,
        autoFollow: autoFollowRef.current,
        userScroll: userScrollRef.current,
      },
    }).catch(logError("writeDiag"));
    if (remaining <= 0) {
      cancelSessionAutoBottom();
      return;
    }
    clearSessionAutoBottomTimer();
    sessionAutoBottomTimerRef.current = window.setTimeout(() => {
      sessionAutoBottomTimerRef.current = null;
      if (!autoFollowRef.current || userScrollRef.current) {
        cancelSessionAutoBottom();
        return;
      }
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (!autoFollowRef.current || userScrollRef.current) {
            cancelSessionAutoBottom();
            return;
          }
          scrollToBottom("auto");
          settleSessionAtBottom();
        });
      });
    }, Math.min(SESSION_LAYOUT_STABLE_MS, remaining));
  };

  const enableAutoFollow = () => {
    cancelPendingAnchorCapture();
    resizeScrollAnchorRef.current = null;
    userBottomIntentUntilRef.current = 0;
    autoFollowRef.current = true;
    userScrollRef.current = false;
    updateAutoFollow(true);
    updateShowScrollToBottom(false);
    scrollToBottom("smooth");
  };

  const settleUserSubmittedMessageAtBottom = () => {
    autoFollowRef.current = true;
    userScrollRef.current = false;
    sessionAutoBottomUntilRef.current = Date.now() + USER_SUBMIT_BOTTOM_MAX_WAIT_MS;
    sessionAutoBottomStableRef.current = null;
    updateAutoFollow(true);
    updateShowScrollToBottom(false);
    scrollToBottom("auto");
    window.requestAnimationFrame(() => {
      scrollToBottom("auto");
      settleSessionAtBottom();
    });
  };

  const recordExplicitUserScrollIntent = () => {
    userScrollGenerationRef.current += 1;
    resizeScrollAnchorRef.current = null;
    lastUserScrollAtRef.current = Date.now();
    scheduleIdleAnchorCapture();
  };

  const pauseAutoFollowForUser = () => {
    cancelSessionAutoBottom();
    recordExplicitUserScrollIntent();
    userBottomIntentUntilRef.current = 0;
    userScrollRef.current = true;
    scrollTokenRef.current += 1;
    if (!userHasScrolled) {
      setUserHasScrolled(true);
    }
    if (autoFollowRef.current) {
      autoFollowRef.current = false;
      updateAutoFollow(false);
    }
  };

  const lockScrollForUserInput = () => {
    userInputLockUntilRef.current = Date.now() + 200;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.button === 1 || event.clientX >= rect.right - 20) {
      scrollbarPointerActiveRef.current = true;
      lockScrollForUserInput();
      pauseAutoFollowForUser();
      userBottomIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_MS;
    }
  };

  const handlePointerMove = () => {
    if (!scrollbarPointerActiveRef.current) return;
    lockScrollForUserInput();
    recordExplicitUserScrollIntent();
  };

  const handlePointerEnd = () => {
    if (!scrollbarPointerActiveRef.current) return;
    scrollbarPointerActiveRef.current = false;
    recordExplicitUserScrollIntent();
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) {
      lockScrollForUserInput();
      pauseAutoFollowForUser();
      if (isInitialTailOnly) expandInitialTail();
    } else if (event.deltaY > 0) {
      recordExplicitUserScrollIntent();
      userBottomIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_MS;
    }
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    touchStartYRef.current = event.touches[0]?.clientY ?? null;
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const startY = touchStartYRef.current;
    if (startY === null) return;
    const currentY = event.touches[0]?.clientY ?? startY;
    if (currentY - startY > 10) {
      lockScrollForUserInput();
      pauseAutoFollowForUser();
    } else if (startY - currentY > 10) {
      recordExplicitUserScrollIntent();
      userBottomIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_MS;
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (["PageUp", "ArrowUp", "Home"].includes(event.key)) {
      lockScrollForUserInput();
      pauseAutoFollowForUser();
    } else if (["PageDown", "ArrowDown", "End"].includes(event.key)) {
      recordExplicitUserScrollIntent();
      userBottomIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_MS;
    }
  };

  const captureResizeScrollAnchor = () => {
    const node = scrollRef.current;
    if (!node) return;
    const containerRect = node.getBoundingClientRect();
    const anchorTop = containerRect.top + Math.min(Math.max(node.clientHeight * 0.24, 96), 220);
    const items = Array.from(node.querySelectorAll<HTMLElement>("[data-kimix-render-key]"));
    const anchor = items.find((item) => item.getBoundingClientRect().bottom >= anchorTop) ?? items[0] ?? null;
    if (!anchor) {
      resizeScrollAnchorRef.current = null;
      return;
    }
    resizeScrollAnchorRef.current = {
      key: anchor.dataset.kimixRenderKey ?? "",
      offsetTop: anchor.getBoundingClientRect().top - containerRect.top,
      userScrollGeneration: userScrollGenerationRef.current,
    };
  };

  const restoreResizeScrollAnchor = (maxDelta = MAX_RESIZE_ANCHOR_RESTORE_PX) => {
    const node = scrollRef.current;
    const anchor = resizeScrollAnchorRef.current;
    if (!node || !anchor?.key) return false;
    if (!isViewportAnchorGenerationCurrent({
      capturedGeneration: anchor.userScrollGeneration,
      currentGeneration: userScrollGenerationRef.current,
    })) return false;
    const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(anchor.key) : anchor.key.replace(/["\\]/g, "\\$&");
    const target = node.querySelector<HTMLElement>(`[data-kimix-render-key="${escaped}"]`);
    if (!target) return false;
    const containerRect = node.getBoundingClientRect();
    const nextOffsetTop = target.getBoundingClientRect().top - containerRect.top;
    const delta = nextOffsetTop - anchor.offsetTop;
    if (Math.abs(delta) <= 0.5) {
      return true;
    }
    if (Math.abs(delta) <= maxDelta) {
      node.scrollTop += delta;
      return true;
    }
    return false;
  };

  const restoreManualScrollAnchor = (reason: string) => {
    const node = scrollRef.current;
    if (!node || !userScrollRef.current) return false;
    const anchor = resizeScrollAnchorRef.current;
    const hasCurrentAnchor = Boolean(anchor && isViewportAnchorGenerationCurrent({
      capturedGeneration: anchor.userScrollGeneration,
      currentGeneration: userScrollGenerationRef.current,
    }));
    const beforeScrollTop = node.scrollTop;
    const beforeDistance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const target = hasCurrentAnchor && anchor?.key
      ? node.querySelector<HTMLElement>(`[data-kimix-render-key="${globalThis.CSS?.escape ? globalThis.CSS.escape(anchor.key) : anchor.key.replace(/["\\]/g, "\\$&")}"]`)
      : null;
    const containerRect = node.getBoundingClientRect();
    const targetOffsetTop = target ? target.getBoundingClientRect().top - containerRect.top : undefined;
    const delta = target && anchor ? targetOffsetTop! - anchor.offsetTop : undefined;
    const restored = restoreResizeScrollAnchor(Number.POSITIVE_INFINITY);
    const afterScrollTop = node.scrollTop;
    const afterDistance = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (restored) {
      updateShowScrollToBottom(afterDistance > 80);
      scheduleAnchorCapture();
    }
    if (beforeScrollTop <= 8 || Math.abs(afterScrollTop - beforeScrollTop) > 0.5 || (!restored && anchor?.key)) {
      window.api.writeDiag?.({
        message: "[ChatThread] restoreManualScrollAnchor",
        data: {
          reason,
          restored,
          beforeScrollTop,
          afterScrollTop,
          beforeDistance,
          afterDistance,
          delta,
          targetOffsetTop,
          anchorOffsetTop: anchor?.offsetTop,
          skippedByDefaultMax: typeof delta === "number" ? Math.abs(delta) > MAX_RESIZE_ANCHOR_RESTORE_PX : undefined,
          sessionId: session?.id,
          runtimeSessionId: session ? getRuntimeSessionId(session) : undefined,
          runningSessionId,
          anchorKey: anchor?.key,
          anchorGeneration: anchor?.userScrollGeneration,
          userScrollGeneration: userScrollGenerationRef.current,
          hasCurrentAnchor,
          targetFound: Boolean(target),
          userScroll: userScrollRef.current,
          autoFollow: autoFollowRef.current,
        },
      }).catch(logError("writeDiag"));
    }
    return restored;
  };

  const readScrollSize = (node: HTMLElement) => ({
    width: node.clientWidth,
    height: node.clientHeight,
    scrollHeight: node.scrollHeight,
  });

  const findRenderedEventNode = (eventId: string): HTMLElement | null => {
    const node = scrollRef.current;
    if (!node) return null;
    const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(eventId) : eventId.replace(/["\\]/g, "\\$&");
    const direct = node.querySelector<HTMLElement>(`[data-kimix-event-id="${escaped}"]`);
    if (direct) return direct;
    return Array.from(node.querySelectorAll<HTMLElement>("[data-kimix-event-ids]"))
      .find((item) => (item.dataset.kimixEventIds ?? "").split(" ").includes(eventId)) ?? null;
  };

  const selectTextInNode = (target: HTMLElement, searchText?: string): boolean => {
    const needle = searchText?.trim();
    if (!needle) return false;
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let textNode = walker.nextNode() as Text | null;
    const lowerNeedle = needle.toLowerCase();
    while (textNode) {
      textNodes.push(textNode);
      textNode = walker.nextNode() as Text | null;
    }
    const fullText = textNodes.map((node) => node.nodeValue ?? "").join("");
    const index = fullText.toLowerCase().indexOf(lowerNeedle);
    if (index < 0) return false;
    const endIndex = index + needle.length;
    let cursor = 0;
    let startNode: Text | null = null;
    let endNode: Text | null = null;
    let startOffset = 0;
    let endOffset = 0;
    for (const node of textNodes) {
      const length = node.nodeValue?.length ?? 0;
      const next = cursor + length;
      if (!startNode && index >= cursor && index <= next) {
        startNode = node;
        startOffset = index - cursor;
      }
      if (!endNode && endIndex >= cursor && endIndex <= next) {
        endNode = node;
        endOffset = endIndex - cursor;
        break;
      }
      cursor = next;
    }
    if (!startNode || !endNode) return false;
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const node = scrollRef.current;
    const rect = range.getBoundingClientRect();
    if (node && rect.height > 0) {
      const containerRect = node.getBoundingClientRect();
      const targetTop = node.scrollTop + rect.top - containerRect.top - Math.max(80, node.clientHeight * 0.28);
      node.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    } else {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return true;
  };

  const focusTimelineEvent = (eventId: string, searchText?: string): boolean => {
    cancelSessionAutoBottom();
    const target = findRenderedEventNode(eventId);
    if (!target) {
      const hasMoreOlderItems = renderItems.length > CHAT_FULL_RENDER_ITEM_LIMIT + olderItemsPage * OLDER_ITEMS_BATCH_SIZE;
      if (hasMoreOlderItems) {
        expandOlderItemsToEnd();
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => focusTimelineEvent(eventId, searchText));
        });
      }
      return false;
    }
    scrollTokenRef.current += 1;
    autoFollowRef.current = false;
    userScrollRef.current = true;
    updateAutoFollow(false);
    const didSelectText = selectTextInNode(target, searchText);
    if (!didSelectText) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    setHighlightedEventId(eventId);
    window.setTimeout(() => {
      setHighlightedEventId((current) => current === eventId ? null : current);
    }, 2200);
    return true;
  };

  useEffect(() => {
    const handleIntentionalResize = (event: Event) => {
      const detail = (event as CustomEvent<{ preserveViewport?: boolean }>).detail;
      intentionalResizeRestoreUntilRef.current = Date.now() + 240;
      if (!detail?.preserveViewport) return;
      cancelSessionAutoBottom();
      scrollTokenRef.current += 1;
      autoFollowRef.current = false;
      userScrollRef.current = true;
      userScrollGenerationRef.current += 1;
      resizeScrollAnchorRef.current = null;
      lastUserScrollAtRef.current = Date.now();
      ignoreScrollUntilRef.current = Date.now() + 240;
      updateAutoFollow(false);
    };
    window.addEventListener("kimix:intentional-chat-resize", handleIntentionalResize);
    return () => window.removeEventListener("kimix:intentional-chat-resize", handleIntentionalResize);
  }, []);

  useEffect(() => {
    const clearScrollbarPointer = () => {
      scrollbarPointerActiveRef.current = false;
    };
    window.addEventListener("pointerup", clearScrollbarPointer);
    window.addEventListener("pointercancel", clearScrollbarPointer);
    window.addEventListener("blur", clearScrollbarPointer);
    return () => {
      window.removeEventListener("pointerup", clearScrollbarPointer);
      window.removeEventListener("pointercancel", clearScrollbarPointer);
      window.removeEventListener("blur", clearScrollbarPointer);
    };
  }, []);

  useEffect(() => {
    const selectStableAnchor = (
      node: HTMLElement,
      detail: ChatProcessCollapseViewportDetail,
    ) => {
      const containerRect = node.getBoundingClientRect();
      const sampleY = containerRect.top + Math.min(Math.max(node.clientHeight * 0.24, 96), 220);
      const sampleX = containerRect.left + Math.max(1, Math.min(containerRect.width - 1, containerRect.width * 0.5));
      const contentAnchor = detail.contentAnchor?.isConnected && node.contains(detail.contentAnchor)
        ? detail.contentAnchor
        : null;
      if (contentAnchor && contentAnchor.getBoundingClientRect().top <= sampleY + 0.5) {
        return contentAnchor;
      }
      const hit = typeof document.elementFromPoint === "function"
        ? document.elementFromPoint(sampleX, sampleY)
        : null;
      let anchor = hit instanceof HTMLElement ? hit : hit?.parentElement ?? null;
      const isUnstableAnchor = isProcessCollapseAnchorUnstable({
        anchor,
        scrollNode: node,
        streamNode: streamContentRef.current,
        collapsingNode: detail.collapsingNode ?? null,
      });

      if (isUnstableAnchor) {
        const summaryAnchor = detail.summaryAnchor?.isConnected && node.contains(detail.summaryAnchor)
          ? detail.summaryAnchor
          : null;
        if (summaryAnchor && summaryAnchor.getBoundingClientRect().top <= sampleY + 0.5) {
          anchor = summaryAnchor;
        } else {
          anchor = null;
        }
      }

      return anchor && node.contains(anchor) ? anchor : null;
    };

    const handleProcessCollapseViewport = (event: Event) => {
      const detail = (event as CustomEvent<ChatProcessCollapseViewportDetail>).detail;
      if (!detail?.transactionId || detail.sessionId !== session?.id) return;
      const node = scrollRef.current;
      if (!node) return;
      intentionalResizeRestoreUntilRef.current = Date.now() + 600;

      if (detail.phase === "before") {
        const isDetached = userScrollRef.current || !autoFollowRef.current;
        if (isDetached) userBottomIntentUntilRef.current = 0;
        const anchorElement = isDetached ? selectStableAnchor(node, detail) : null;
        processCollapseViewportSnapshotsRef.current.set(detail.transactionId, {
          anchorElement,
          anchorViewportTop: anchorElement?.getBoundingClientRect().top,
          scrollTop: node.scrollTop,
          autoFollow: autoFollowRef.current,
          userScroll: userScrollRef.current,
        });
        return;
      }

      const snapshot = processCollapseViewportSnapshotsRef.current.get(detail.transactionId);
      processCollapseViewportSnapshotsRef.current.delete(detail.transactionId);
      if (!snapshot) return;

      if (snapshot.autoFollow && !snapshot.userScroll && autoFollowRef.current && !userScrollRef.current) {
        clearDetachedViewportCompensation();
        scrollToBottom("auto");
        return;
      }

      const currentAnchorViewportTop = snapshot.anchorElement?.isConnected && node.contains(snapshot.anchorElement)
        ? snapshot.anchorElement.getBoundingClientRect().top
        : undefined;
      const naturalScrollHeight = Math.max(0, node.scrollHeight - detachedTailCompensationRef.current);
      // The browser may already have clamped scrollTop after the shrink. Rebuild
      // the intended position from a surviving reading-line element, then add
      // temporary tail range only when the natural maximum cannot reach it.
      const plan = planDetachedViewportRestore({
        previousScrollTop: snapshot.scrollTop,
        previousAnchorViewportTop: snapshot.anchorViewportTop,
        currentScrollTop: node.scrollTop,
        currentAnchorViewportTop,
        naturalScrollHeight,
        clientHeight: node.clientHeight,
      });

      detachedViewportMinimumScrollHeightRef.current = plan.tailCompensation > 0.01
        ? plan.minimumScrollHeight
        : null;
      setDetachedTailCompensation(plan.tailCompensation);
      const compensatedScrollHeight = node.scrollHeight;
      ignoreScrollUntilRef.current = Date.now() + 240;
      node.scrollTop = plan.targetScrollTop;
      resizeScrollAnchorRef.current = null;
      cancelPendingAnchorCapture();
      scheduleAnchorCapture();
      updateShowScrollToBottom(naturalDistanceFromBottom(node) > 80);
      window.api.writeDiag?.({
        message: "[ChatThread] processCollapseViewport",
        data: {
          transactionId: detail.transactionId,
          eventId: detail.eventId,
          agentTurnId: detail.agentTurnId,
          roomAgentId: detail.roomAgentId,
          previousScrollTop: snapshot.scrollTop,
          nextScrollTop: node.scrollTop,
          targetScrollTop: plan.targetScrollTop,
          naturalScrollHeight,
          compensatedScrollHeight,
          tailCompensation: plan.tailCompensation,
          anchorSurvived: currentAnchorViewportTop !== undefined,
        },
      }).catch(logError("writeDiag"));
    };

    window.addEventListener(CHAT_PROCESS_COLLAPSE_VIEWPORT_EVENT, handleProcessCollapseViewport);
    return () => window.removeEventListener(CHAT_PROCESS_COLLAPSE_VIEWPORT_EVENT, handleProcessCollapseViewport);
  }, [session?.id]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; eventId?: string; searchText?: string }>).detail;
      if (!detail?.sessionId || !detail.eventId) return;
      pendingFocusEventRef.current = { sessionId: detail.sessionId, eventId: detail.eventId, searchText: detail.searchText };
      if (session?.id === detail.sessionId) {
        const eventId = detail.eventId;
        window.requestAnimationFrame(() => {
          if (focusTimelineEvent(eventId, detail.searchText)) {
            pendingFocusEventRef.current = null;
          }
        });
      }
    };
    window.addEventListener("kimix:focus-timeline-event", handler);
    return () => window.removeEventListener("kimix:focus-timeline-event", handler);
  }, [session?.id, olderItemsPage]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (!detail?.sessionId || detail.sessionId !== session?.id) return;
      settleUserSubmittedMessageAtBottom();
    };
    window.addEventListener("kimix:user-message-submitted", handler);
    return () => window.removeEventListener("kimix:user-message-submitted", handler);
  }, [session?.id]);

  useLayoutEffect(() => {
    setPrimedSessionId(null);
    cancelSessionAutoBottom();
    autoFollowRef.current = true;
    userScrollRef.current = false;
    setOlderItemsPage(0);
    setExpandedInitialTailSessionId(null);
    setUserHasScrolled(false);
    pendingOlderItemsScrollAnchorRef.current = null;
    pendingTailExpandScrollAnchorRef.current = null;
    resizeScrollAnchorRef.current = null;
    processCollapseViewportSnapshotsRef.current.clear();
    clearDetachedViewportCompensation();
    lastScrollSizeRef.current = null;
    lastScrollTopRef.current = null;
    lastScrollHeightRef.current = null;
    touchStartYRef.current = null;
    userInputLockUntilRef.current = 0;
    userBottomIntentUntilRef.current = 0;
    userScrollGenerationRef.current = 0;
    scrollbarPointerActiveRef.current = false;
    lastUserScrollAtRef.current = 0;
    cancelPendingAnchorCapture();
    updateAutoFollow(true);
    updateShowScrollToBottom(false);
    let mutationObserver: MutationObserver | null = null;
    if (session?.id) {
      sessionAutoBottomUntilRef.current = Date.now() + SESSION_OPEN_BOTTOM_MAX_WAIT_MS;
      sessionAutoBottomStableRef.current = null;
      const node = scrollRef.current;
      if (node) {
        node.scrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
      }
      settleSessionAtBottom();
      const contentNode = streamContentRef.current;
      if (contentNode) {
        mutationObserver = new MutationObserver(() => {
          if (!autoFollowRef.current || userScrollRef.current) return;
          if (Date.now() >= sessionAutoBottomUntilRef.current && !isAutoFollowRef.current) return;
          if (bottomTrackerFrameRef.current) return;
          bottomTrackerFrameRef.current = window.requestAnimationFrame(() => {
            bottomTrackerFrameRef.current = 0;
            if (!autoFollowRef.current || userScrollRef.current) return;
            scrollToBottom("auto");
          });
        });
        mutationObserver.observe(contentNode, { childList: true, subtree: true });
      }
      const primingSessionId = session.id;
      window.requestAnimationFrame(() => {
        settleSessionAtBottom();
        console.log("[ChatThread] rAF setPrimedSessionId", {
          primingSessionId,
          currentSessionId: session?.id,
          matches: session?.id === primingSessionId,
        });
        window.api.writeDiag?.({ message: "[ChatThread] rAF setPrimedSessionId", data: { primingSessionId, currentSessionId: session?.id, matches: session?.id === primingSessionId } }).catch(logError("writeDiag"));
        setPrimedSessionId(primingSessionId);
        window.requestAnimationFrame(settleSessionAtBottom);
      });
    }
    return () => {
      cancelSessionAutoBottom();
      cancelPendingAnchorCapture();
      if (bottomTrackerFrameRef.current) {
        window.cancelAnimationFrame(bottomTrackerFrameRef.current);
        bottomTrackerFrameRef.current = 0;
      }
      mutationObserver?.disconnect();
    };
  }, [session?.id]);

  /** Scroll to bottom when the container becomes visible (primedSessionId set). */
  useLayoutEffect(() => {
    if (primedSessionId) {
      settleSessionAtBottom();
    }
  }, [primedSessionId]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let resizeFrame = 0;
    lastScrollSizeRef.current = readScrollSize(node);
    scheduleAnchorCapture();

    const processResize = () => {
      resizeFrame = 0;
      const current = scrollRef.current;
      if (!current) return;
      const previousSize = lastScrollSizeRef.current;
      reconcileDetachedViewportCompensation(current);
      const nextSize = readScrollSize(current);
      lastScrollSizeRef.current = nextSize;
      if (
        !previousSize ||
        (
          previousSize.width === nextSize.width &&
          previousSize.height === nextSize.height &&
          previousSize.scrollHeight === nextSize.scrollHeight
        )
      ) {
        return;
      }
      const shouldStickToBottom = autoFollowRef.current && !userScrollRef.current;
      if (Date.now() < intentionalResizeRestoreUntilRef.current) {
        if (shouldStickToBottom) scrollToBottom("auto");
        scheduleAnchorCapture();
        const activeNode = scrollRef.current;
        if (activeNode) {
          const distance = naturalDistanceFromBottom(activeNode);
          updateShowScrollToBottom(distance > 80);
        }
        return;
      }
      // Follow mode owns the bottom invariant. Content and viewport height
      // changes are equivalent here, so an incomplete content signature must
      // never route a live tool resize through an older viewport anchor.
      if (shouldStickToBottom) {
        scrollToBottom("auto");
        return;
      }
      // Detached mode owns the visible anchor. Avoid fighting an active wheel or
      // touch gesture, then restore the same rendered item after layout settles.
      if (userScrollRef.current) {
        const isRecentUserScroll = Date.now() - lastUserScrollAtRef.current < USER_SCROLL_RESIZE_RESTORE_SUPPRESS_MS;
        if (!isRecentUserScroll) {
          restoreResizeScrollAnchor();
          scheduleAnchorCapture();
        }
        const activeNode = scrollRef.current;
        if (activeNode) {
          const distance = naturalDistanceFromBottom(activeNode);
          updateShowScrollToBottom(distance > 80);
        }
        return;
      }
      restoreResizeScrollAnchor();
      scheduleAnchorCapture();
      const nodeAfterRestore = scrollRef.current;
      if (!nodeAfterRestore) return;
      const distance = naturalDistanceFromBottom(nodeAfterRestore);
      updateShowScrollToBottom(distance > 80);
    };

    const scheduleResizeProcess = () => {
      if (resizeFrame) return;
      resizeFrame = window.requestAnimationFrame(processResize);
    };

    const observer = new ResizeObserver(scheduleResizeProcess);
    const contentNode = streamContentRef.current;
    observer.observe(node);
    if (contentNode && contentNode !== node) observer.observe(contentNode);
    window.addEventListener("resize", scheduleResizeProcess);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleResizeProcess);
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
    };
  }, [session?.id, olderItemsPage]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    const snapshot = contentResizeSnapshotRef.current;
    if (
      node &&
      snapshot &&
      snapshot.sessionId === session?.id &&
      snapshot.autoFollow &&
      !snapshot.userScroll &&
      node.scrollHeight < snapshot.scrollHeight
    ) {
      ignoreScrollUntilRef.current = Date.now() + 120;
      node.scrollTop = scrollTopPreservingBottomDistance({
        previousScrollHeight: snapshot.scrollHeight,
        previousScrollTop: snapshot.scrollTop,
        previousClientHeight: snapshot.clientHeight,
        nextScrollHeight: node.scrollHeight,
        nextClientHeight: node.clientHeight,
      });
    }
    contentResizeSnapshotRef.current = node ? {
      sessionId: session?.id,
      contentVersion,
      scrollHeight: node.scrollHeight,
      scrollTop: node.scrollTop,
      clientHeight: node.clientHeight,
      autoFollow: autoFollowRef.current,
      userScroll: userScrollRef.current,
    } : null;
  }, [contentVersion, session?.id]);

  useLayoutEffect(() => {
    const remaining = sessionAutoBottomUntilRef.current - Date.now();
    const isSettlingOpenedSession = remaining > 0 && !userScrollRef.current;
    if (isSettlingOpenedSession) {
      autoFollowRef.current = true;
      updateAutoFollow(true);
      scrollToBottom("auto");
      return;
    }
    if (isAutoFollowRef.current) {
      scrollToBottom("auto");
      return;
    }
    const node = scrollRef.current;
    if (!node) return;
    if (Date.now() < intentionalResizeRestoreUntilRef.current) {
      updateShowScrollToBottom(naturalDistanceFromBottom(node) > 80);
      return;
    }
    if (userScrollRef.current) {
      const isRecentUserScroll = Date.now() - lastUserScrollAtRef.current < USER_SCROLL_ANCHOR_RESTORE_SUPPRESS_MS;
      if (isRecentUserScroll) {
        const distance = naturalDistanceFromBottom(node);
        updateShowScrollToBottom(distance > 80);
        return;
      }
      const now = Date.now();
      if (now - lastManualAnchorRestoreAtRef.current < 350) {
        const distance = naturalDistanceFromBottom(node);
        updateShowScrollToBottom(distance > 80);
        return;
      }
      lastManualAnchorRestoreAtRef.current = now;
      if (restoreManualScrollAnchor("contentVersion:user-scroll")) {
        return;
      }
    }
    const distance = naturalDistanceFromBottom(node);
    updateShowScrollToBottom(distance > 80);
  }, [contentVersion]);

  const retryLastUserMessage = async () => {
    if (!session) throw new Error("当前没有可重试的会话");
    if (runningSessionId) throw new Error("当前已有任务运行中，稍后再重试");
    const lastPrompt = [...session.events].reverse().find((event): event is Extract<TimelineEvent, { type: "user_message" | "steer_message" }> => (
      (event.type === "user_message" || event.type === "steer_message") && event.content.trim().length > 0
    ));
    if (!lastPrompt) throw new Error("没有找到上一条可重试的用户消息");
    const runtimeSessionId = getRuntimeSessionId(session);
    if (!runtimeSessionId) throw new Error("当前会话没有可用的运行时 session");

    const now = Date.now();
    const resentUserEvent: TimelineEvent = {
      id: crypto.randomUUID(),
      type: "user_message",
      timestamp: now,
      content: lastPrompt.content,
      images: lastPrompt.type === "user_message" ? lastPrompt.images : undefined,
    };
    const linkStatusEvent: TimelineEvent = {
      id: crypto.randomUUID(),
      type: "status_update",
      timestamp: now,
      message: "消息发送中",
      source: "ipc",
      tone: "info",
      parentEventId: resentUserEvent.id,
    };
    const placeholder: TimelineEvent = {
      id: crypto.randomUUID(),
      type: "assistant_message",
      timestamp: now,
      content: "",
      isThinking: defaultThinking,
      isComplete: false,
    };
    updateSession(session.id, (current) => ({
      ...current,
      events: [...current.events, resentUserEvent, linkStatusEvent, placeholder],
      updatedAt: now,
    }));
    const latest = useSessionStore.getState().sessions.find((item) => item.id === session.id);
    if (latest) setCurrentSession(latest);
    setRunningSessionId(session.id);

    const dispatchStartedAt = Date.now();
    updateSession(session.id, (current) => ({
      ...current,
      events: current.events.map((event) => event.id === placeholder.id
        ? { ...event, timestamp: dispatchStartedAt }
        : event
      ),
      updatedAt: dispatchStartedAt,
    }));
    const res = await window.api.sendKimiCodePrompt({
      sessionId: runtimeSessionId,
      content: lastPrompt.content,
      images: lastPrompt.type === "user_message" ? (lastPrompt.images ?? []).map((image) => ({ name: image.name, dataUrl: image.dataUrl ?? "" })).filter((image) => image.dataUrl) : [],
    });
    if (!res.success) {
      setRunningSessionId(null);
      updateSession(session.id, (current) => ({
        ...current,
        events: [
          ...current.events.map((event) => event.type === "assistant_message" && event.id === placeholder.id
            ? { ...event, isComplete: true, isThinking: false }
            : event.id === linkStatusEvent.id && event.type === "status_update"
              ? { ...event, timestamp: Date.now(), message: "消息发送失败", tone: "danger" as const }
              : event
          ),
          {
            id: crypto.randomUUID(),
            type: "error",
            timestamp: Date.now(),
            message: res.error,
            source: "ui",
          },
        ],
        updatedAt: Date.now(),
      }));
      const failedLatest = useSessionStore.getState().sessions.find((item) => item.id === session.id);
      if (failedLatest) setCurrentSession(failedLatest);
      throw new Error(res.error);
    }
  };

  const syncCurrentSessionAfterLocalEdit = useCallback((sessionId: string) => {
    const latest = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
    if (latest && currentSession?.id === sessionId) {
      setCurrentSession(latest);
    }
  }, [currentSession?.id, setCurrentSession]);

  const dismissErrorEvent = useCallback((eventId: string) => {
    if (!session) return;
    const timestamp = Date.now();
    updateSession(session.id, (current) => ({
      ...current,
      events: current.events.filter((event) => event.id !== eventId),
      updatedAt: timestamp,
    }));
    syncCurrentSessionAfterLocalEdit(session.id);
  }, [session, syncCurrentSessionAfterLocalEdit, updateSession]);

  const deleteUserMessageAttempt = useCallback((eventId: string) => {
    if (!session) return;
    const timestamp = Date.now();
    updateSession(session.id, (current) => {
      const currentRuntimeSessionId = getRuntimeSessionId(current);
      const isCurrentSessionRunning = runningSessionId === current.id ||
        Boolean(currentRuntimeSessionId && runningSessionId === currentRuntimeSessionId);
      if (!hasLocalFailedSendAttempt(current.events, eventId) && (isCurrentSessionRunning || !hasLocalOrphanUserSendAttempt(current.events, eventId))) return current;
      return {
        ...current,
        events: removeLocalUserSendAttempt(current.events, eventId),
        updatedAt: timestamp,
      };
    });
    syncCurrentSessionAfterLocalEdit(session.id);
  }, [runningSessionId, session, syncCurrentSessionAfterLocalEdit, updateSession]);

  // Anchor capture (getBoundingClientRect + querySelectorAll) is expensive and
  // triggers forced layout. Keep it out of the hot scroll path; scrolling only
  // schedules one idle capture after the wheel/touch stream settles.
  const anchorCaptureFrameRef = useRef(0);
  const anchorCaptureIdleTimerRef = useRef<number | null>(null);
  const scheduleAnchorCapture = () => {
    if (anchorCaptureFrameRef.current) return;
    anchorCaptureFrameRef.current = window.requestAnimationFrame(() => {
      anchorCaptureFrameRef.current = 0;
      captureResizeScrollAnchor();
    });
  };
  const scheduleIdleAnchorCapture = () => {
    if (anchorCaptureIdleTimerRef.current !== null) {
      window.clearTimeout(anchorCaptureIdleTimerRef.current);
    }
    anchorCaptureIdleTimerRef.current = window.setTimeout(() => {
      anchorCaptureIdleTimerRef.current = null;
      scheduleAnchorCapture();
    }, SCROLL_ANCHOR_IDLE_CAPTURE_MS);
  };
  const cancelPendingAnchorCapture = () => {
    if (anchorCaptureIdleTimerRef.current !== null) {
      window.clearTimeout(anchorCaptureIdleTimerRef.current);
      anchorCaptureIdleTimerRef.current = null;
    }
    if (anchorCaptureFrameRef.current) {
      window.cancelAnimationFrame(anchorCaptureFrameRef.current);
      anchorCaptureFrameRef.current = 0;
    }
  };

  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const previousScrollTop = lastScrollTopRef.current;
    const previousScrollHeight = lastScrollHeightRef.current;
    lastScrollTopRef.current = node.scrollTop;
    lastScrollHeightRef.current = node.scrollHeight;
    if (canReleaseViewportTailCompensation({
      tailCompensation: detachedTailCompensationRef.current,
      scrollTop: node.scrollTop,
      naturalScrollHeight: Math.max(0, node.scrollHeight - detachedTailCompensationRef.current),
      clientHeight: node.clientHeight,
    })) {
      clearDetachedViewportCompensation();
    }
    const geometricDistance = distanceFromBottom(node);
    const distance = detachedTailCompensationRef.current > 0
      ? naturalDistanceFromBottom(node)
      : geometricDistance;
    const now = Date.now();
    if (shouldResumeAutoFollowAtBottom({
      distance,
      autoFollow: autoFollowRef.current,
      userScroll: userScrollRef.current,
      bottomIntentUntil: userBottomIntentUntilRef.current,
      suppressUntil: ignoreScrollUntilRef.current,
      now,
    })) {
      userScrollRef.current = false;
      autoFollowRef.current = true;
      userBottomIntentUntilRef.current = 0;
      lastUserScrollAtRef.current = 0;
      cancelPendingAnchorCapture();
      resizeScrollAnchorRef.current = null;
      clearDetachedViewportCompensation();
      lastScrollTopRef.current = node.scrollTop;
      lastScrollHeightRef.current = node.scrollHeight;
      updateAutoFollow(true);
    }
    updateShowScrollToBottom(distance > 80);
    if (
      previousScrollTop !== null &&
      previousScrollTop > Math.max(160, node.clientHeight * 0.5) &&
      node.scrollTop <= 8
    ) {
      window.api.writeDiag?.({
        message: "[ChatThread] scrollJumpNearTop",
        data: {
          previousScrollTop,
          previousScrollHeight,
          nextScrollTop: node.scrollTop,
          nextScrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
          distance,
          sessionId: session?.id,
          runtimeSessionId: session ? getRuntimeSessionId(session) : undefined,
          runningSessionId,
          autoFollow: autoFollowRef.current,
          userScroll: userScrollRef.current,
          isAutoFollow: isAutoFollowRef.current,
          ignoreScrollRemaining: Math.max(0, ignoreScrollUntilRef.current - now),
          sessionAutoBottomRemaining: Math.max(0, sessionAutoBottomUntilRef.current - now),
          olderItemsPage,
          primedSessionId,
          expandedInitialTailSessionId,
          userHasScrolled,
          contentVersionLength: contentVersionRef.current.length,
        },
      }).catch(logError("writeDiag"));
    }
    if (now - lastScrollDiagRef.current > 500) {
      lastScrollDiagRef.current = now;
      window.api.writeDiag?.({
        message: "[ChatThread] handleScroll",
        data: {
          scrollTop: node.scrollTop,
          scrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
          distance,
          autoFollow: autoFollowRef.current,
          userScroll: userScrollRef.current,
        },
      }).catch(logError("writeDiag"));
    }
  };

  const deletableUserMessageIds = useMemo(() => {
    if (!session) return new Set<string>();
    return new Set(session.events
      .filter((event) => event.type === "user_message" && (
        hasLocalFailedSendAttempt(session.events, event.id) ||
        (!hasActiveTurn && hasLocalOrphanUserSendAttempt(session.events, event.id))
      ))
      .map((event) => event.id));
  }, [hasActiveTurn, session]);
  const visibleOlderItemCount = olderItemsPage * OLDER_ITEMS_BATCH_SIZE;
  const visibleItemLimit = CHAT_FULL_RENDER_ITEM_LIMIT + visibleOlderItemCount;
  const shouldFoldOlderItems = renderItems.length > visibleItemLimit;
  const foldedItemCount = shouldFoldOlderItems ? renderItems.length - visibleItemLimit : 0;
  const fullVisibleRenderItems = shouldFoldOlderItems ? renderItems.slice(-visibleItemLimit) : renderItems;
  const isInitialTailOnly = Boolean(session?.id && expandedInitialTailSessionId !== session.id && !userHasScrolled);
  const initialTailRenderItems = useMemo(() => selectInitialChatTail(fullVisibleRenderItems, {
    isCompletedAssistant: (item) => item.type === "event" &&
      item.event.type === "assistant_message" &&
      item.event.isComplete &&
      item.event.content.trim().length > 0,
  }), [fullVisibleRenderItems]);
  const visibleRenderItems = isInitialTailOnly ? initialTailRenderItems : fullVisibleRenderItems;
  const initialTailHiddenCount = isInitialTailOnly ? Math.max(0, renderItems.length - visibleRenderItems.length) : 0;
  const hasVisibleContent = Boolean(session && visibleEvents.length > 0 && hasVisibleConversation(visibleEvents, runningSessionId, session.id, runtimeSessionId ?? undefined, hasActiveTurn));
  const isRestoringOfficialHistory = Boolean(session?.isLoading && roomTimeline.length > 0);
  const isSessionScrollPrimed = !session?.id || primedSessionId === session.id;
  const eagerMarkdown = Boolean(session?.id && (
    Date.now() < sessionAutoBottomUntilRef.current || userHasScrolled
  ));

  const readPermissionScrollDiagState = (phase: string, detail?: PermissionModeDiagDetail) => {
    const node = scrollRef.current;
    const contentNode = streamContentRef.current;
    const items = Array.from(contentNode?.querySelectorAll<HTMLElement>("[data-kimix-render-key]") ?? []);
    const distance = node ? node.scrollHeight - node.scrollTop - node.clientHeight : undefined;
    return {
      phase,
      traceId: detail?.traceId,
      permissionStage: detail?.stage,
      requestedMode: detail?.requestedMode,
      previousMode: detail?.previousMode,
      diagRuntimeSessionId: detail?.runtimeSessionId,
      diagActiveSessionId: detail?.activeSessionId,
      diagActiveRuntimeSessionId: detail?.activeRuntimeSessionId,
      diagCurrentSessionId: detail?.currentSessionId,
      diagRunningSessionId: detail?.runningSessionId,
      sessionId: session?.id,
      runtimeSessionId,
      runningSessionId,
      currentSessionId: currentSession?.id,
      scrollTop: node?.scrollTop,
      scrollHeight: node?.scrollHeight,
      clientHeight: node?.clientHeight,
      distance,
      contentOffsetHeight: contentNode?.offsetHeight,
      contentScrollHeight: contentNode?.scrollHeight,
      itemCount: items.length,
      firstItemKey: items[0]?.dataset.kimixRenderKey,
      lastItemKey: items.at(-1)?.dataset.kimixRenderKey,
      renderItemsLength: renderItems.length,
      visibleRenderItemsLength: visibleRenderItems.length,
      visibleEventsLength: visibleEvents.length,
      olderItemsPage,
      shouldFoldOlderItems,
      isInitialTailOnly,
      initialTailHiddenCount,
      primedSessionId,
      expandedInitialTailSessionId,
      userHasScrolled,
      autoFollow: autoFollowRef.current,
      userScroll: userScrollRef.current,
      isAutoFollow: isAutoFollowRef.current,
      showScrollToBottom: showScrollToBottomRef.current,
      ignoreScrollRemaining: Math.max(0, ignoreScrollUntilRef.current - Date.now()),
      sessionAutoBottomRemaining: Math.max(0, sessionAutoBottomUntilRef.current - Date.now()),
      contentVersionLength: contentVersionRef.current.length,
      lastScrollTop: lastScrollTopRef.current,
      lastScrollHeight: lastScrollHeightRef.current,
    };
  };

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<PermissionModeDiagDetail>).detail;
      if (userScrollRef.current) {
        captureResizeScrollAnchor();
        intentionalResizeRestoreUntilRef.current = Date.now() + 900;
      }
      window.api.writeDiag?.({
        message: "[ChatThread] permissionDiag",
        data: readPermissionScrollDiagState("event", detail),
      }).catch(logError("writeDiag"));
      window.requestAnimationFrame(() => {
        restoreManualScrollAnchor(`permission:${detail?.stage ?? "unknown"}:rAF1`);
        window.api.writeDiag?.({
          message: "[ChatThread] permissionDiag rAF1",
          data: readPermissionScrollDiagState("rAF1", detail),
        }).catch(logError("writeDiag"));
        window.requestAnimationFrame(() => {
          restoreManualScrollAnchor(`permission:${detail?.stage ?? "unknown"}:rAF2`);
          window.api.writeDiag?.({
            message: "[ChatThread] permissionDiag rAF2",
            data: readPermissionScrollDiagState("rAF2", detail),
          }).catch(logError("writeDiag"));
        });
      });
    };
    window.addEventListener("kimix:permission-mode-diag", handler);
    return () => window.removeEventListener("kimix:permission-mode-diag", handler);
  }, [
    currentSession?.id,
    expandedInitialTailSessionId,
    initialTailHiddenCount,
    isInitialTailOnly,
    primedSessionId,
    renderItems.length,
    runningSessionId,
    runtimeSessionId,
    session?.id,
    shouldFoldOlderItems,
    olderItemsPage,
    userHasScrolled,
    visibleEvents.length,
    visibleRenderItems.length,
  ]);

  useEffect(() => {
    const pending = pendingFocusEventRef.current;
    if (!pending || !session || pending.sessionId !== session.id) return;
    window.requestAnimationFrame(() => {
      if (focusTimelineEvent(pending.eventId, pending.searchText)) {
        pendingFocusEventRef.current = null;
      }
    });
  }, [session?.id, visibleRenderItems.length]);

  useEffect(() => {
    if (!session?.id || !isInitialTailOnly || isRestoringOfficialHistory) return;
    const sessionId = session.id;
    const frame = window.requestAnimationFrame(() => {
      setExpandedInitialTailSessionId(sessionId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [session?.id, isInitialTailOnly, isRestoringOfficialHistory]);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || !session?.id) return;
    const anchor = pendingTailExpandScrollAnchorRef.current;
    if (anchor?.key) {
      // The user scrolled up, which expanded the folded initial-tail history
      // above the viewport. Pin the previously-visible anchor so the newly
      // inserted (and now eagerly-rendered) content does not shove the view.
      pendingTailExpandScrollAnchorRef.current = null;
      const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(anchor.key) : anchor.key.replace(/["\\]/g, "\\$&");
      const target = node.querySelector<HTMLElement>(`[data-kimix-render-key="${escaped}"]`);
      if (target) {
        const containerRect = node.getBoundingClientRect();
        const nextOffsetTop = target.getBoundingClientRect().top - containerRect.top;
        node.scrollTop += nextOffsetTop - anchor.offsetTop;
      }
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      updateShowScrollToBottom(distance > 80);
      return;
    }
    if (autoFollowRef.current && !userScrollRef.current) {
      scrollToBottom("auto");
    }
  }, [expandedInitialTailSessionId, session?.id]);

  useLayoutEffect(() => {
    const anchor = pendingOlderItemsScrollAnchorRef.current;
    const node = scrollRef.current;
    if (!anchor || !node || olderItemsPage === 0) return;
    pendingOlderItemsScrollAnchorRef.current = null;
    const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(anchor.key) : anchor.key.replace(/["\\]/g, "\\$&");
    const target = node.querySelector<HTMLElement>(`[data-kimix-render-key="${escaped}"]`);
    if (target) {
      const containerRect = node.getBoundingClientRect();
      const nextOffsetTop = target.getBoundingClientRect().top - containerRect.top;
      node.scrollTop += nextOffsetTop - anchor.offsetTop;
    }
    autoFollowRef.current = false;
    userScrollRef.current = true;
    updateAutoFollow(false);
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    updateShowScrollToBottom(distance > 80);
  }, [olderItemsPage, visibleRenderItems.length]);

  if (isRestoringOfficialHistory) {
    return <SessionHistoryLoadingState />;
  }

  if (!session || (!hasActiveTurn && !hasPendingMessage && !hasVisibleContent)) {
    return <EmptyState />;
  }

  const expandOlderItems = () => {
    const node = scrollRef.current;
    if (node) {
      const containerRect = node.getBoundingClientRect();
      const items = Array.from(node.querySelectorAll<HTMLElement>("[data-kimix-render-key]"));
      const anchor = items.find((item) => item.getBoundingClientRect().bottom >= containerRect.top + 1) ?? items[0];
      pendingOlderItemsScrollAnchorRef.current = anchor ? {
        key: anchor.dataset.kimixRenderKey ?? "",
        offsetTop: anchor.getBoundingClientRect().top - containerRect.top,
      } : null;
      scrollTokenRef.current += 1;
      ignoreScrollUntilRef.current = Date.now() + 240;
      intentionalResizeRestoreUntilRef.current = Date.now() + 240;
    }
    setOlderItemsPage((prev) => prev + 1);
  };

  const expandOlderItemsToEnd = () => {
    const maxPage = Math.max(
      0,
      Math.ceil((renderItems.length - CHAT_FULL_RENDER_ITEM_LIMIT) / OLDER_ITEMS_BATCH_SIZE)
    );
    if (olderItemsPage >= maxPage) return;
    const node = scrollRef.current;
    if (node) {
      const containerRect = node.getBoundingClientRect();
      const items = Array.from(node.querySelectorAll<HTMLElement>("[data-kimix-render-key]"));
      const anchor = items.find((item) => item.getBoundingClientRect().bottom >= containerRect.top + 1) ?? items[0];
      pendingOlderItemsScrollAnchorRef.current = anchor ? {
        key: anchor.dataset.kimixRenderKey ?? "",
        offsetTop: anchor.getBoundingClientRect().top - containerRect.top,
      } : null;
      scrollTokenRef.current += 1;
      ignoreScrollUntilRef.current = Date.now() + 240;
      intentionalResizeRestoreUntilRef.current = Date.now() + 240;
    }
    setOlderItemsPage(maxPage);
  };

  const expandInitialTail = () => {
    if (!session?.id || !isInitialTailOnly) return;
    const node = scrollRef.current;
    if (node) {
      const containerRect = node.getBoundingClientRect();
      const items = Array.from(node.querySelectorAll<HTMLElement>("[data-kimix-render-key]"));
      const anchor = items.find((item) => item.getBoundingClientRect().bottom >= containerRect.top + 1) ?? items[0];
      pendingTailExpandScrollAnchorRef.current = anchor ? {
        key: anchor.dataset.kimixRenderKey ?? "",
        offsetTop: anchor.getBoundingClientRect().top - containerRect.top,
      } : null;
    }
    setExpandedInitialTailSessionId(session.id);
  };



  return (
    <div className="relative h-full" style={{ height: "100%", minHeight: 0, overflow: "hidden" }}>
      {session.longTask && (
        <div className="kimix-content-x pointer-events-none absolute inset-x-0 z-30" style={{ top: 10 }}>
          <div className="kimix-chat-stream-column pointer-events-auto">
            <LongTaskBanner meta={session.longTask} projectPath={session.projectPath} />
          </div>
        </div>
      )}
      <div
        ref={scrollRef}
        className="kimix-content-x kimix-chat-scroll-area kimix-stable-scrollbar h-full overflow-y-auto"
        style={{
          paddingTop: session.longTask ? 124 : 42,
          paddingBottom: 0,
          scrollbarGutter: "stable",
          overscrollBehavior: "contain",
          visibility: isSessionScrollPrimed ? "visible" : "hidden",
        }}
        onScroll={handleScroll}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handlePointerEnd}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onKeyDown={handleKeyDown}
      >
        <div
          ref={streamContentRef}
          className="kimix-chat-stream-column flex min-h-full w-full flex-col"
          style={{
            gap: 22,
            paddingBottom: `calc(${CHAT_BOTTOM_SPACER_HEIGHT}px + var(--kimix-detached-tail-compensation, 0px))`,
          }}
        >
          {isInitialTailOnly && initialTailHiddenCount > 0 && <FoldedHistoryNotice count={initialTailHiddenCount} onExpand={() => { pauseAutoFollowForUser(); expandInitialTail(); }} />}
          {!isInitialTailOnly && foldedItemCount > 0 && <FoldedHistoryNotice count={foldedItemCount} onExpand={expandOlderItems} />}
          {visibleRenderItems.map((item) => (
            <div
              key={renderItemKey(item)}
              data-kimix-render-key={renderItemKey(item)}
              data-kimix-event-id={item.type === "event" ? item.event.id : undefined}
              data-kimix-event-ids={item.type === "event" ? item.event.id.split(":").join(" ") : item.type === "tool_group" ? item.tools.map((tool) => tool.id).join(" ") : undefined}
              style={{
                borderRadius: 12,
                outline: item.type === "event" && highlightedEventId === item.event.id
                  ? "2px solid var(--accent-primary)"
                  : item.type === "tool_group" && item.tools.some((tool) => tool.id === highlightedEventId)
                    ? "2px solid var(--accent-primary)"
                    : "2px solid transparent",
                outlineOffset: 4,
                transition: "outline-color 160ms ease",
              }}
            >
              {item.type === "tool_group"
                ? <ToolGroup tools={item.tools} />
                  : item.type === "plan_preview"
                  ? <PlanPreviewCard path={item.path} projectPath={item.projectPath} sessionId={runtimeSessionId ?? undefined} />
                  : item.type === "change_group"
                    ? <ChangeCard changes={item.changes} />
                  : <EventRenderer event={item.event} sessionId={session.id} runtimeSessionId={runtimeSessionId ?? undefined} projectPath={session.projectPath} turnStartedAt={item.turnStartedAt} leadingTools={item.leadingTools} leadingSubagents={item.leadingSubagents} leadingHooks={item.leadingHooks} leadingApprovals={item.leadingApprovals} attachedSteers={item.attachedSteers} activeStatus={item.activeStatus} changedFiles={item.changedFiles} changeSummary={item.changeSummary} trailingStatuses={item.trailingStatuses} hideProcessSummary={item.hideProcessSummary} expandProcessByDefault={item.event.id === latestProcessAssistantEventId} approvalDiffs={item.approvalDiffs} onRetryError={retryLastUserMessage} onDismissError={dismissErrorEvent} onDeleteUserMessage={deleteUserMessageAttempt} deletableUserMessageIds={deletableUserMessageIds} eagerMarkdown={eagerMarkdown} isSessionRunning={hasActiveTurn} />
              }
            </div>
          ))}
        </div>
      </div>
      <div className="kimix-content-x pointer-events-none absolute inset-x-0 z-20" style={{ bottom: 24 }}>
        <div className="kimix-chat-stream-column flex justify-end">
          <button
            ref={scrollToBottomButtonRef}
            type="button"
            aria-label="滚动到底部"
            aria-hidden="true"
            tabIndex={-1}
            title="滚动到底部"
            onClick={enableAutoFollow}
            className="kimix-chat-floating-action flex items-center justify-center"
            style={{
              opacity: 0,
              pointerEvents: "none",
              transform: "translateY(6px) scale(0.96)",
              willChange: "opacity, transform",
            }}
          >
            <ArrowDown size={17} />
          </button>
        </div>
      </div>
    </div>
  );
});
