import { memo, useRef, useEffect, useMemo, useState, useCallback } from "react";
import { ArrowDown, ChevronDown, ChevronRight, Wrench, Loader2, Bot, FileText, RefreshCw } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { getRuntimeSessionId } from "@/utils/runtimeSession";
import { normalizePathForComparison } from "@/utils/pathCase";
import { useLiveSession } from "@/hooks/useLiveSession";
import { useChatRenderCache } from "@/hooks/useChatRenderCache";
import { useChatViewport } from "@/hooks/useChatViewport";
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
import { logError, logEvent } from "@/utils/reportError";
import { selectInitialChatTail } from "@/utils/chatTailWindow";
import type { LongTaskSessionMeta, Session, TimelineEvent, ToolCallEvent } from "@/types/ui";
import type { CompletedTurnRenderCacheEntry, RenderItem } from "@/types/chatRender";
import { projectCollaborationTimeline } from "@/utils/collaborationTimeline";
import { getRoomAgentEvents } from "@/utils/collaborationRooms";

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

const contentVersionObjectIds = new WeakMap<object, number>();
let nextContentVersionObjectId = 1;

function contentVersionObjectId(value: object) {
  const existing = contentVersionObjectIds.get(value);
  if (existing) return existing;
  const next = nextContentVersionObjectId++;
  contentVersionObjectIds.set(value, next);
  return next;
}

function renderItemIdentityVersion(item: RenderItem) {
  if (item.type === "event") return `e${contentVersionObjectId(item.event)}`;
  if (item.type === "tool_group") {
    const lastTool = item.tools[item.tools.length - 1];
    return `t${item.tools.length}:${lastTool ? contentVersionObjectId(lastTool) : 0}`;
  }
  return `${item.type}:${item.id}`;
}

export function buildContentVersion(
  session: { id?: string; updatedAt?: number } | null | undefined,
  roomTimeline: TimelineEvent[],
  renderItems: RenderItem[],
): string {
  const lastItem = renderItems[renderItems.length - 1];
  const lastKey = lastItem ? renderItemKey(lastItem) : "";
  const lastAssistantContentLength = lastItem?.type === "event" && lastItem.event.type === "assistant_message"
    ? lastItem.event.content.length
    : undefined;
  const lastAssistantThinkingLength = lastItem?.type === "event" && lastItem.event.type === "assistant_message"
    ? (lastItem.event.thinking?.length ?? 0)
    : undefined;
  const renderIdentityVersion = renderItems.map(renderItemIdentityVersion).join(",");
  return [
    session?.id ?? "",
    session?.updatedAt ?? 0,
    roomTimeline.length,
    renderItems.length,
    lastKey,
    lastAssistantContentLength ?? "",
    lastAssistantThinkingLength ?? "",
    renderIdentityVersion,
  ].join(":");
}

export interface SubagentContentRegressionSnapshot {
  key: string;
  sessionId: string;
  roomAgentId?: string;
  agentTurnId?: string;
  eventId: string;
  topLevelAssistantSize: number;
  sourceEvents: TimelineEvent[];
}

export function buildSubagentRegressionDiagnosticData(snapshot: SubagentContentRegressionSnapshot) {
  const eventTypes = snapshot.sourceEvents.reduce<Record<string, number>>((counts, event) => {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
    return counts;
  }, {});
  return {
    sessionId: snapshot.sessionId,
    roomAgentId: snapshot.roomAgentId,
    agentTurnId: snapshot.agentTurnId,
    eventId: snapshot.eventId,
    topLevelAssistantSize: snapshot.topLevelAssistantSize,
    sourceEventCount: snapshot.sourceEvents.length,
    sourceEventTypes: eventTypes,
    ...(window.api.detailedDiagnosticsEnabled
      ? { snapshot: JSON.stringify(snapshot.sourceEvents.slice(-200)) }
      : {}),
  };
}

export function findSubagentContentRegressionSnapshots(
  renderItems: RenderItem[],
  session: Session,
): SubagentContentRegressionSnapshot[] {
  const regressions = renderItems.filter((item) => (
    item.type === "event" &&
    item.event.type === "assistant_message" &&
    item.leadingSubagents &&
    item.leadingSubagents.length > 0 &&
    item.event.content.trim().length > 0 &&
    item.event.isComplete
  ));
  return regressions
    .map((item) => {
      if (item.type !== "event" || item.event.type !== "assistant_message") return null;
      const assistantEvent = item.event;
      const key = `${session.id}:${assistantEvent.roomAgentId ?? "primary"}:${assistantEvent.agentTurnId ?? assistantEvent.id}`;
      const sourceEvents = session.collaboration && assistantEvent.roomAgentId
        ? getRoomAgentEvents(session, assistantEvent.roomAgentId)
        : session.events;
      return {
        key,
        sessionId: session.id,
        roomAgentId: assistantEvent.roomAgentId,
        agentTurnId: assistantEvent.agentTurnId,
        eventId: assistantEvent.id,
        topLevelAssistantSize: assistantEvent.content.length,
        sourceEvents,
      } as SubagentContentRegressionSnapshot;
    })
    .filter((snapshot): snapshot is SubagentContentRegressionSnapshot => snapshot !== null);
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
  completedTurnCache?: Map<string, CompletedTurnRenderCacheEntry>,
): RenderItem[] {
  const items: RenderItem[] = [];
  const usedCompletedTurnCacheKeys = new Set<string>();

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
    for (const [, event] of turnEvents.entries()) {
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
  const canCacheTurn = (turnEvents: TimelineEvent[], isLatestTurn: boolean) => {
    if (!completedTurnCache || turnEvents.length === 0) return false;
    if (isLatestTurn && isSessionRunning && !turnEvents.some((event) => event.roomAgentId)) return false;
    if (turnEvents.some((event) => event.roomAgentId && activeRoomAgentIds?.has(event.roomAgentId))) return false;
    return !turnEvents.some((event) => (
      (event.type === "assistant_message" && !event.isComplete) ||
      (event.type === "tool_call" && event.status === "running") ||
      (event.type === "subagent" && (event.status === "queued" || event.status === "running" || event.status === "suspended")) ||
      (event.type === "approval_request" && event.status === "pending") ||
      (event.type === "question_request" && event.status === "pending") ||
      (event.type === "steer_message" && (event.status === "sending" || event.status === "accepted")) ||
      (event.type === "compaction" && event.phase === "begin")
    ));
  };
  const completedTurnCacheKey = (turnEvents: TimelineEvent[]) => {
    const first = turnEvents[0];
    const agentTurnId = turnEvents.find((event) => event.agentTurnId)?.agentTurnId;
    const roomAgentId = turnEvents.find((event) => event.roomAgentId)?.roomAgentId;
    return `${roomAgentId ?? "primary"}:${agentTurnId ?? first.id}:${currentTurnStartedAt ?? first.timestamp}`;
  };
  const renderCachedTurnBody = (turnEvents: TimelineEvent[], turnStartedAt?: number, isLatestTurn = false) => {
    if (!canCacheTurn(turnEvents, isLatestTurn) || !completedTurnCache) {
      renderTurnBody(turnEvents, turnStartedAt, isLatestTurn);
      return;
    }
    const cacheKey = completedTurnCacheKey(turnEvents);
    usedCompletedTurnCacheKeys.add(cacheKey);
    const cached = completedTurnCache.get(cacheKey);
    if (
      cached &&
      cached.sessionEngine === sessionEngine &&
      cached.events.length === turnEvents.length &&
      cached.events.every((event, index) => event === turnEvents[index])
    ) {
      items.push(...cached.items);
      return;
    }
    const itemStart = items.length;
    renderTurnBody(turnEvents, turnStartedAt, isLatestTurn);
    completedTurnCache.set(cacheKey, {
      events: [...turnEvents],
      items: items.slice(itemStart),
      sessionEngine,
    });
  };
  const flushTurn = (isLatestTurn = false) => {
    renderCachedTurnBody(turnBody, currentTurnStartedAt, isLatestTurn);
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
  if (completedTurnCache) {
    for (const cacheKey of completedTurnCache.keys()) {
      if (!usedCompletedTurnCacheKeys.has(cacheKey)) completedTurnCache.delete(cacheKey);
    }
  }
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
  const [olderItemsPage, setOlderItemsPage] = useState(0);
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  const [expandedInitialTailSessionId, setExpandedInitialTailSessionId] = useState<string | null>(null);
  const completedTurnRenderCacheRef = useChatRenderCache(session?.id);

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
    () => buildRenderItems(visibleEvents, session?.engine, splitEvents.attachedByUserId, hasActiveTurn, activeRoomAgentIds, completedTurnRenderCacheRef.current),
    [visibleEvents, session?.engine, splitEvents.attachedByUserId, hasActiveTurn, activeRoomAgentIds]
  );
  const surfacedSubagentContentKeysRef = useRef(new Set<string>());
  useEffect(() => {
    if (!session) return;
    for (const item of renderItems) {
      if (
        item.type !== "event" ||
        item.event.type !== "assistant_message" ||
        !item.leadingSubagents?.length ||
        (!item.event.content.trim() && !item.event.thinking?.trim())
      ) continue;
      const key = `${session.id}:${item.event.id}`;
      if (surfacedSubagentContentKeysRef.current.has(key)) continue;
      surfacedSubagentContentKeysRef.current.add(key);
      logEvent("chatRenderItems.subagentContentSurfaced", {
        sessionId: session.id,
        agentTurnId: item.event.agentTurnId,
        roomAgentId: item.event.roomAgentId,
        roomMessageId: item.event.roomMessageId,
        subagentCount: item.leadingSubagents.length,
        hasActiveSubagent: item.leadingSubagents.some((subagent) => (
          subagent.status === "queued" ||
          subagent.status === "running" ||
          subagent.status === "suspended"
        )),
        contentLength: item.event.content.length,
        thinkingLength: item.event.thinking?.length ?? 0,
      });
    }
  }, [renderItems, session]);
  const exportedSubagentRegressionSnapshotsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!session) return;
    const snapshots = findSubagentContentRegressionSnapshots(renderItems, session);
    for (const snapshot of snapshots) {
      const { key } = snapshot;
      if (exportedSubagentRegressionSnapshotsRef.current.has(key)) continue;
      exportedSubagentRegressionSnapshotsRef.current.add(key);
      window.api.writeDiag?.({
        message: "ChatThread.subagentContentRegressionSnapshot",
        data: buildSubagentRegressionDiagnosticData(snapshot),
      }).catch(logError("writeDiag"));
    }
  }, [renderItems, session]);

  const latestProcessAssistantEventId = useMemo(() => {
    const item = renderItems.findLast((candidate) => (
      candidate.type === "event" &&
      candidate.event.type === "assistant_message" &&
      !candidate.hideProcessSummary
    ));
    return item?.type === "event" ? item.event.id : undefined;
  }, [renderItems]);
  const contentVersion = useMemo(
    () => buildContentVersion(session, roomTimeline, renderItems),
    [session, roomTimeline, renderItems]
  );

  const hasMoreOlderItems = renderItems.length > CHAT_FULL_RENDER_ITEM_LIMIT + olderItemsPage * OLDER_ITEMS_BATCH_SIZE;

  const expandInitialTailRef = useRef<() => void>(() => {});
  const expandOlderItemsRef = useRef<() => void>(() => {});
  const expandOlderItemsToEndRef = useRef<() => void>(() => {});

  const viewport = useChatViewport({
    sessionId: session?.id,
    runtimeSessionId,
    runningSessionId,
    contentVersion,
    renderItems,
    olderItemsPage,
    expandedInitialTailSessionId,
    hasMoreOlderItems,
    onExpandInitialTail: () => expandInitialTailRef.current(),
    onExpandOlderItemsToEnd: () => expandOlderItemsToEndRef.current(),
    onHighlightEvent: setHighlightedEventId,
  });

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
  const isInitialTailOnly = Boolean(session?.id && expandedInitialTailSessionId !== session.id && !viewport.userHasScrolled);
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
  const isSessionScrollPrimed = viewport.isSessionScrollPrimed;
  const eagerMarkdown = viewport.eagerMarkdown;

  const readPermissionScrollDiagState = (phase: string, detail?: PermissionModeDiagDetail) => {
    const snap = viewport.getScrollDiagSnapshot();
    const contentNode = viewport.streamContentRef.current;
    const items = Array.from(contentNode?.querySelectorAll<HTMLElement>("[data-kimix-render-key]") ?? []);
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
      scrollTop: snap.scrollTop,
      scrollHeight: snap.scrollHeight,
      clientHeight: snap.clientHeight,
      distance: snap.distance,
      contentOffsetHeight: snap.contentOffsetHeight,
      contentScrollHeight: snap.contentScrollHeight,
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
      primedSessionId: viewport.isSessionScrollPrimed ? session?.id ?? null : null,
      expandedInitialTailSessionId,
      userHasScrolled: viewport.userHasScrolled,
      autoFollow: snap.autoFollow,
      userScroll: snap.userScroll,
      isAutoFollow: snap.isAutoFollow,
      showScrollToBottom: snap.showScrollToBottom,
      ignoreScrollRemaining: snap.ignoreScrollRemaining,
      sessionAutoBottomRemaining: snap.sessionAutoBottomRemaining,
      contentVersionLength: snap.contentVersionLength,
      lastScrollTop: snap.lastScrollTop,
      lastScrollHeight: snap.lastScrollHeight,
    };
  };

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<PermissionModeDiagDetail>).detail;
      if (viewport.userHasScrolled) {
        viewport.captureResizeAnchor();
      }
      window.api.writeDiag?.({
        message: "[ChatThread] permissionDiag",
        data: readPermissionScrollDiagState("event", detail),
      }).catch(logError("writeDiag"));
      window.requestAnimationFrame(() => {
        viewport.restoreResizeAnchor(`permission:${detail?.stage ?? "unknown"}:rAF1`);
        window.api.writeDiag?.({
          message: "[ChatThread] permissionDiag rAF1",
          data: readPermissionScrollDiagState("rAF1", detail),
        }).catch(logError("writeDiag"));
        window.requestAnimationFrame(() => {
          viewport.restoreResizeAnchor(`permission:${detail?.stage ?? "unknown"}:rAF2`);
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
    viewport.isSessionScrollPrimed,
    renderItems.length,
    runningSessionId,
    runtimeSessionId,
    session?.id,
    shouldFoldOlderItems,
    olderItemsPage,
    viewport.userHasScrolled,
    visibleEvents.length,
    visibleRenderItems.length,
    viewport.captureResizeAnchor,
    viewport.restoreResizeAnchor,
    viewport.getScrollDiagSnapshot,
  ]);


  useEffect(() => {
    if (!session?.id || !isInitialTailOnly || isRestoringOfficialHistory) return;
    const sessionId = session.id;
    const frame = window.requestAnimationFrame(() => {
      setExpandedInitialTailSessionId(sessionId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [session?.id, isInitialTailOnly, isRestoringOfficialHistory]);

  if (isRestoringOfficialHistory) {
    return <SessionHistoryLoadingState />;
  }

  if (!session || (!hasActiveTurn && !hasPendingMessage && !hasVisibleContent)) {
    return <EmptyState />;
  }

  const expandOlderItems = () => {
    viewport.prepareOlderItemsExpand();
    setOlderItemsPage((prev) => prev + 1);
  };
  expandOlderItemsRef.current = expandOlderItems;

  const expandOlderItemsToEnd = () => {
    const maxPage = Math.max(
      0,
      Math.ceil((renderItems.length - CHAT_FULL_RENDER_ITEM_LIMIT) / OLDER_ITEMS_BATCH_SIZE)
    );
    if (olderItemsPage >= maxPage) return;
    viewport.prepareOlderItemsExpandToEnd();
    setOlderItemsPage(maxPage);
    setExpandedInitialTailSessionId(null);
  };
  expandOlderItemsToEndRef.current = expandOlderItemsToEnd;

  const expandInitialTail = () => {
    if (!session?.id || !isInitialTailOnly) return;
    viewport.prepareInitialTailExpand();
    setExpandedInitialTailSessionId(session.id);
  };
  expandInitialTailRef.current = expandInitialTail;



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
        ref={viewport.scrollRef}
        className="kimix-content-x kimix-chat-scroll-area kimix-stable-scrollbar h-full overflow-y-auto"
        style={{
          paddingTop: session.longTask ? 124 : 42,
          paddingBottom: 0,
          scrollbarGutter: "stable",
          overscrollBehavior: "contain",
          visibility: isSessionScrollPrimed ? "visible" : "hidden",
        }}
        onScroll={viewport.handlers.onScroll}
        onPointerDown={viewport.handlers.onPointerDown}
        onPointerMove={viewport.handlers.onPointerMove}
        onPointerUp={viewport.handlers.onPointerUp}
        onPointerCancel={viewport.handlers.onPointerCancel}
        onLostPointerCapture={viewport.handlers.onLostPointerCapture}
        onWheel={viewport.handlers.onWheel}
        onTouchStart={viewport.handlers.onTouchStart}
        onTouchMove={viewport.handlers.onTouchMove}
        onKeyDown={viewport.handlers.onKeyDown}
      >
        <div
          ref={viewport.streamContentRef}
          className="kimix-chat-stream-column flex min-h-full w-full flex-col"
          style={{
            gap: 22,
            paddingBottom: `calc(${CHAT_BOTTOM_SPACER_HEIGHT}px + var(--kimix-detached-tail-compensation, 0px))`,
          }}
        >
          {isInitialTailOnly && initialTailHiddenCount > 0 && <FoldedHistoryNotice count={initialTailHiddenCount} onExpand={() => { viewport.pauseAutoFollowForUser(); expandInitialTail(); }} />}
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
            ref={viewport.scrollToBottomButtonRef}
            type="button"
            aria-label="滚动到底部"
            aria-hidden="true"
            tabIndex={-1}
            title="滚动到底部"
            onClick={viewport.enableAutoFollow}
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
