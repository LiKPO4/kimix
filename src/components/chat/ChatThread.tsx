import { useRef, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ArrowDown, ChevronDown, ChevronRight, Wrench, Loader2, Bot, FileText, RefreshCw } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { getRuntimeSessionId } from "@/utils/runtimeSession";
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
import { createToolOnlyAssistantEvent } from "@/utils/chatRenderItems";
import { reliableAssistantDurationMs } from "@/utils/duration";
import type { LongTaskSessionMeta, TimelineEvent, ToolCallEvent } from "@/types/ui";

type RenderItem =
  | { type: "event"; event: TimelineEvent; leadingTools?: ToolCallEvent[]; leadingSubagents?: Extract<TimelineEvent, { type: "subagent" }>[]; leadingHooks?: Extract<TimelineEvent, { type: "hook" }>[]; leadingApprovals?: Extract<TimelineEvent, { type: "approval_request" }>[]; attachedSteers?: Extract<TimelineEvent, { type: "steer_message" }>[]; attachedUserStatuses?: Extract<TimelineEvent, { type: "status_update" }>[]; activeStatus?: Extract<TimelineEvent, { type: "status_update" }>; changedFiles?: string[]; changeSummary?: Extract<TimelineEvent, { type: "change_summary" }>; trailingStatuses?: Extract<TimelineEvent, { type: "status_update" }>[]; hideProcessSummary?: boolean; approvalDiffs?: { path: string; oldText?: string; newText?: string; additions?: number; deletions?: number }[] }
  | { type: "tool_group"; id: string; tools: ToolCallEvent[] }
  | { type: "plan_preview"; id: string; path: string; projectPath?: string }
  | { type: "change_group"; id: string; changes: { path: string; oldText?: string; newText?: string; additions?: number; deletions?: number }[] };

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

const COMPACTION_STALE_MS = 5 * 60 * 1000;
const CHAT_FULL_RENDER_ITEM_LIMIT = 28;
const CHAT_BOTTOM_SPACER_HEIGHT = 60;
const SESSION_OPEN_BOTTOM_SETTLE_MS = 1200;
const SESSION_OPEN_BOTTOM_SETTLE_INTERVAL_MS = 120;
const SCROLL_ANCHOR_IDLE_CAPTURE_MS = 140;
const USER_SCROLL_RESIZE_RESTORE_SUPPRESS_MS = 260;

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
  return value.replace(/\\/g, "/").toLowerCase();
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

function PlanPreviewCard({ path, projectPath }: { path: string; projectPath?: string }) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadPlan = () => {
    setLoading(true);
    setError("");
    void window.api.readTextFile({ path, projectPath }).then((res) => {
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
  }, [path, projectPath]);

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

function CompactionLabel({ event }: { event: Extract<TimelineEvent, { type: "compaction" }> }) {
  const isStale = event.phase === "begin" && Date.now() - event.timestamp >= COMPACTION_STALE_MS;
  const dots = useAnimatedDots(event.phase === "begin" && !isStale);
  if (isStale) return <>上下文压缩可能已超时，可重新尝试</>;
  if (event.phase === "end") return <>上下文压缩完成</>;
  return (
    <>
      上下文压缩中
      <span className="inline-block w-[1.5em] text-left">{dots}</span>
    </>
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
        className="flex h-8 w-full items-center rounded-lg text-left text-[14.5px] leading-none text-[var(--kimix-panel-text-secondary)] transition-colors hover:bg-[var(--kimix-panel-hover)]"
        style={{ gap: 8, paddingLeft: 4, paddingRight: 10 }}
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

function EventRenderer({ event, sessionId, runtimeSessionId, projectPath, leadingTools, leadingSubagents, leadingHooks, leadingApprovals, attachedSteers, attachedUserStatuses, activeStatus, changedFiles, changeSummary, trailingStatuses, hideProcessSummary, approvalDiffs, onRetryError }: { event: TimelineEvent; sessionId: string; runtimeSessionId?: string; projectPath: string; leadingTools?: ToolCallEvent[]; leadingSubagents?: Extract<TimelineEvent, { type: "subagent" }>[]; leadingHooks?: Extract<TimelineEvent, { type: "hook" }>[]; leadingApprovals?: Extract<TimelineEvent, { type: "approval_request" }>[]; attachedSteers?: Extract<TimelineEvent, { type: "steer_message" }>[]; attachedUserStatuses?: Extract<TimelineEvent, { type: "status_update" }>[]; activeStatus?: Extract<TimelineEvent, { type: "status_update" }>; changedFiles?: string[]; changeSummary?: Extract<TimelineEvent, { type: "change_summary" }>; trailingStatuses?: Extract<TimelineEvent, { type: "status_update" }>[]; hideProcessSummary?: boolean; approvalDiffs?: { path: string; oldText?: string; newText?: string; additions?: number; deletions?: number }[]; onRetryError?: () => Promise<void> }) {
  switch (event.type) {
    case "user_message":
      return (
        <>
          <MessageBubble event={event} sessionId={sessionId} runtimeSessionId={runtimeSessionId} />
          <UserAttachedStatuses statuses={attachedUserStatuses} />
        </>
      );
    case "steer_message":
      return <MessageBubble event={event} sessionId={sessionId} runtimeSessionId={runtimeSessionId} />;
    case "assistant_message":
      return <MessageBubble event={event} sessionId={sessionId} runtimeSessionId={runtimeSessionId} leadingTools={leadingTools} leadingSubagents={leadingSubagents} leadingHooks={leadingHooks} leadingApprovals={leadingApprovals} attachedSteers={attachedSteers} activeStatus={activeStatus} changedFiles={changedFiles} changeSummary={changeSummary} trailingStatuses={trailingStatuses} hideProcessSummary={hideProcessSummary} />;
    case "tool_call":
      return <ToolCard event={event} />;
    case "tool_result":
      return null;
    case "approval_request":
      return <ApprovalCard event={event} diffPreviews={approvalDiffs} />;
    case "question_request":
      return <QuestionCard event={event} />;
    case "status_update":
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
      return <ErrorCard event={event} />;
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
      return (
        <div className="flex justify-center" style={{ paddingTop: 2, paddingBottom: 2 }}>
          <div
            className="inline-flex max-w-full items-center rounded-full bg-surface-hover text-text-muted"
            style={{ gap: 8, paddingLeft: 16, paddingRight: 16, paddingTop: 6, paddingBottom: 6, fontSize: 13, lineHeight: "18px" }}
          >
            <CompactionLabel event={event} />
          </div>
        </div>
      );
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

function buildRenderItems(
  events: TimelineEvent[],
  sessionEngine?: "prompt" | "kimi-code",
  attachedUserStatuses?: Map<string, Extract<TimelineEvent, { type: "status_update" }>[]>,
): RenderItem[] {
  const items: RenderItem[] = [];

  const pushStandaloneTools = (tools: ToolCallEvent[]) => {
    if (tools.length === 0) return;
    if (sessionEngine === "kimi-code") {
      items.push({ type: "event", event: createToolOnlyAssistantEvent(tools), leadingTools: tools, trailingStatuses: [] });
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
      id: visible.map((event) => event.id).join(":"),
      timestamp: first.timestamp,
      content: visible.map((event) => event.content).filter((content) => content.trim()).join("\n\n"),
      thinking: visible.map((event) => event.thinking ?? "").filter((thinking) => thinking.trim()).join(""),
      thinkingParts: visible.flatMap((event) => event.thinkingParts ?? []),
      isThinking: visible.some((event) => event.isThinking && !event.isComplete),
      isComplete: visible.every((event) => event.isComplete),
      durationMs: reliableAssistantDurationMs(last.durationMs),
    } satisfies Extract<TimelineEvent, { type: "assistant_message" }>;
  };

  const renderTurnBody = (turnEvents: TimelineEvent[]) => {
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
    const turnSettled = (
      !assistantEvents.some((event) => !event.isComplete) &&
      !tools.some((event) => event.status === "running") &&
      !subagents.some((event) => event.status === "queued" || event.status === "running" || event.status === "suspended")
    );
    const trailingStatusEvents = turnSettled
      ? statusEvents.filter((status) => !(status.source === "ipc" && status.parentEventId))
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
      if (event.type === "steer_message") continue;
      if (event.type === "tool_call" || event.type === "tool_result") continue;
      if (event.type === "subagent") continue;
      if (event.type === "hook") continue;
      if (event.type === "status_update") continue;
      if (event.type === "change_summary") continue;
      if (event.type === "diff") continue;
      if (event.type === "assistant_message") {
        if (assistantAttached || !mergedAssistantEvent) continue;
        const hasContent = mergedAssistantEvent.content.trim().length > 0;
        const hasOwnProcessDetails = Boolean(
          (mergedAssistantEvent.thinking?.trim() && !isKimixSyntheticThinking(mergedAssistantEvent.thinking)) ||
          mergedAssistantEvent.thinkingParts?.some((part) => part.text.trim().length > 0 && !isKimixSyntheticThinking(part.text))
        );
        items.push({
          type: "event",
          event: mergedAssistantEvent,
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
      if (
        (event.type !== "assistant_message" || assistantEventIds.has(event.id)) &&
        event.type !== "assistant_message" &&
        event.type !== "approval_request" &&
        event.type !== "question_request" &&
        event.type !== "file_artifact" &&
        event.type !== "change_summary" &&
        event.type !== "session_recommendation" &&
        event.type !== "diff" &&
        event.type !== "error" &&
        event.type !== "compaction"
      ) {
        continue;
      }
      if (event.type === "assistant_message" && !toolsAttached) {
        items.push({ type: "event", event, leadingTools: tools, leadingSubagents: subagents, leadingHooks: hooks, changedFiles: Array.from(changedFiles), changeSummary: mergedChangeSummary ?? undefined, trailingStatuses: trailingStatusEvents });
        toolsAttached = true;
        assistantAttached = true;
        if (mergedChangeSummary) changeSummaryAttached = true;
        continue;
      }
      if (!toolsAttached) {
        if (tools.length > 0) {
          pushStandaloneTools(tools);
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

    if (!toolsAttached) pushStandaloneTools(tools);
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
      statusEvents.forEach((event) => items.push({ type: "event", event }));
    }
    if (!assistantAttached && subagents.length === 1) {
      subagents.forEach((event) => items.push({ type: "event", event }));
    }
    // Multi-agent Swarm progress is rendered by the floating SwarmPanel above the composer.
    // Keeping those rows out of the message stream prevents duplicate process lists.
  };

  let turnBody: TimelineEvent[] = [];
  const flushTurn = () => {
    renderTurnBody(turnBody);
    turnBody = [];
  };

  for (const event of events) {
    if (event.type === "user_message") {
      flushTurn();
      items.push({ type: "event", event, attachedUserStatuses: attachedUserStatuses?.get(event.id) });
      continue;
    }
    if (event.type === "steer_message") {
      flushTurn();
      items.push({ type: "event", event });
      continue;
    }

    turnBody.push(event);
  }
  flushTurn();
  return items;
}

function filterStatusUpdates(events: TimelineEvent[], display: "each" | "turn_end" | "never"): TimelineEvent[] {
  return events.filter((event, index) => {
    if (event.type !== "status_update") return true;
    if (event.source === "slash") return true;
    // Prompt-link statuses drive the live assistant process header. They are
    // intentionally retained even when standalone status cards are hidden;
    // renderTurnBody removes them again once the turn settles.
    if (event.source === "ipc" && event.parentEventId) return true;
    if (display === "never") return false;
    if (display === "each") return true;
    const nextTurnIndex = events.findIndex((candidate, candidateIndex) => (
      candidateIndex > index &&
      (candidate.type === "user_message" || candidate.type === "steer_message")
    ));
    const turnEnd = nextTurnIndex === -1 ? events.length : nextTurnIndex;
    return !events.slice(index + 1, turnEnd).some((candidate) => candidate.type === "status_update");
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

function hasVisibleConversation(events: TimelineEvent[], runningSessionId: string | null, sessionId?: string, runtimeSessionId?: string): boolean {
  const isRunningThisSession = Boolean(sessionId && (
    runningSessionId === sessionId ||
    Boolean(runtimeSessionId && runningSessionId === runtimeSessionId)
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

export function ChatThread() {
  const currentSession = useAppStore((s) => s.currentSession);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const defaultPlanMode = useAppStore((s) => s.defaultPlanMode);
  const permissionMode = useAppStore((s) => s.permissionMode);
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
  const sessionAutoBottomTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const pendingOlderItemsScrollAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const pendingFocusEventRef = useRef<{ sessionId: string; eventId: string; searchText?: string } | null>(null);
  const resizeScrollAnchorRef = useRef<{ key: string; offsetTop: number } | null>(null);
  const lastScrollSizeRef = useRef<{ width: number; height: number; scrollHeight: number } | null>(null);
  const lastScrollTopRef = useRef<number | null>(null);
  const userScrollResizeRestoreUntilRef = useRef(0);
  const intentionalResizeRestoreUntilRef = useRef(0);
  const [showOlderItems, setShowOlderItems] = useState(false);
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  const [primedSessionId, setPrimedSessionId] = useState<string | null>(null);
  const splitEvents = useMemo(
    () => splitUserAttachedStatuses(collapseCompletedCompactions(session?.events ?? [])),
    [session?.events]
  );
  const visibleEvents = useMemo(
    () => filterStatusUpdates(splitEvents.events, statusUpdateDisplay),
    [splitEvents.events, statusUpdateDisplay]
  );
  const hasPendingMessage = Boolean(session && pendingMessages.some((msg) => msg.sessionId === session.id));
  const renderItems = useMemo(
    () => buildRenderItems(visibleEvents, session?.engine, splitEvents.attachedByUserId),
    [visibleEvents, session?.engine, splitEvents.attachedByUserId]
  );
  const contentVersion = useMemo(() => {
    return (session?.events ?? []).map((event) => {
      if (event.type === "assistant_message") {
        return `${event.id}:${event.content.length}:${event.thinking?.length ?? 0}:${event.isComplete ? 1 : 0}`;
      }
      return `${event.id}:${event.type}`;
    }).join("|");
  }, [session?.events]);

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

  const clearSessionAutoBottomTimer = () => {
    if (sessionAutoBottomTimerRef.current === null) return;
    window.clearTimeout(sessionAutoBottomTimerRef.current);
    sessionAutoBottomTimerRef.current = null;
  };

  const cancelSessionAutoBottom = () => {
    sessionAutoBottomUntilRef.current = 0;
    clearSessionAutoBottomTimer();
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const node = scrollRef.current;
    if (!node) return;
    const token = ++scrollTokenRef.current;
    ignoreScrollUntilRef.current = Date.now() + 420;
    const bottom = Math.max(0, node.scrollHeight - node.clientHeight);
    if (behavior === "auto") {
      node.scrollTop = bottom;
    } else {
      node.scrollTo({ top: bottom, behavior });
    }
    window.setTimeout(() => {
      if (token !== scrollTokenRef.current || !autoFollowRef.current) return;
      const current = scrollRef.current;
      if (!current) return;
      const distance = current.scrollHeight - current.scrollTop - current.clientHeight;
      updateShowScrollToBottom(distance > 80);
    }, 460);
  };

  const keepSessionAtBottom = () => {
    if (!scrollRef.current || !autoFollowRef.current || userScrollRef.current) {
      cancelSessionAutoBottom();
      return;
    }
    scrollToBottom("auto");
    if (Date.now() >= sessionAutoBottomUntilRef.current) {
      clearSessionAutoBottomTimer();
      return;
    }
    clearSessionAutoBottomTimer();
    sessionAutoBottomTimerRef.current = window.setTimeout(() => {
      sessionAutoBottomTimerRef.current = null;
      keepSessionAtBottom();
    }, SESSION_OPEN_BOTTOM_SETTLE_INTERVAL_MS);
  };

  const enableAutoFollow = () => {
    autoFollowRef.current = true;
    userScrollRef.current = false;
    updateAutoFollow(true);
    updateShowScrollToBottom(false);
    scrollToBottom("smooth");
  };

  const pauseAutoFollowForUser = () => {
    cancelSessionAutoBottom();
    userScrollRef.current = true;
    scrollTokenRef.current += 1;
    if (autoFollowRef.current) {
      autoFollowRef.current = false;
      updateAutoFollow(false);
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
    };
  };

  const restoreResizeScrollAnchor = () => {
    const node = scrollRef.current;
    const anchor = resizeScrollAnchorRef.current;
    if (!node || !anchor?.key) return false;
    const escaped = globalThis.CSS?.escape ? globalThis.CSS.escape(anchor.key) : anchor.key.replace(/["\\]/g, "\\$&");
    const target = node.querySelector<HTMLElement>(`[data-kimix-render-key="${escaped}"]`);
    if (!target) return false;
    const containerRect = node.getBoundingClientRect();
    const nextOffsetTop = target.getBoundingClientRect().top - containerRect.top;
    const delta = nextOffsetTop - anchor.offsetTop;
    if (Math.abs(delta) > 0.5) {
      node.scrollTop += delta;
    }
    return true;
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
      if (!showOlderItems) {
        setShowOlderItems(true);
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
      ignoreScrollUntilRef.current = Date.now() + 240;
      updateAutoFollow(false);
    };
    window.addEventListener("kimix:intentional-chat-resize", handleIntentionalResize);
    return () => window.removeEventListener("kimix:intentional-chat-resize", handleIntentionalResize);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; eventId?: string; searchText?: string }>).detail;
      if (!detail?.sessionId || !detail.eventId) return;
      pendingFocusEventRef.current = { sessionId: detail.sessionId, eventId: detail.eventId, searchText: detail.searchText };
      if (session?.id === detail.sessionId) {
        window.requestAnimationFrame(() => {
          if (focusTimelineEvent(detail.eventId, detail.searchText)) {
            pendingFocusEventRef.current = null;
          }
        });
      }
    };
    window.addEventListener("kimix:focus-timeline-event", handler);
    return () => window.removeEventListener("kimix:focus-timeline-event", handler);
  }, [session?.id, showOlderItems]);

  useLayoutEffect(() => {
    setPrimedSessionId(null);
    cancelSessionAutoBottom();
    autoFollowRef.current = true;
    userScrollRef.current = false;
    setShowOlderItems(false);
    pendingOlderItemsScrollAnchorRef.current = null;
    resizeScrollAnchorRef.current = null;
    lastScrollSizeRef.current = null;
    lastScrollTopRef.current = null;
    userScrollResizeRestoreUntilRef.current = 0;
    cancelPendingAnchorCapture();
    updateAutoFollow(true);
    updateShowScrollToBottom(false);
    if (session?.id) {
      sessionAutoBottomUntilRef.current = Date.now() + SESSION_OPEN_BOTTOM_SETTLE_MS;
      keepSessionAtBottom();
      const primingSessionId = session.id;
      window.requestAnimationFrame(() => {
        keepSessionAtBottom();
        console.log("[ChatThread] rAF setPrimedSessionId", {
          primingSessionId,
          currentSessionId: session?.id,
          matches: session?.id === primingSessionId,
        });
        window.api.writeDiag?.({ message: "[ChatThread] rAF setPrimedSessionId", data: { primingSessionId, currentSessionId: session?.id, matches: session?.id === primingSessionId } }).catch(() => {});
        setPrimedSessionId(primingSessionId);
        window.requestAnimationFrame(keepSessionAtBottom);
      });
    }
    return () => {
      cancelSessionAutoBottom();
      cancelPendingAnchorCapture();
    };
  }, [session?.id]);

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
      if (Date.now() < intentionalResizeRestoreUntilRef.current) {
        scheduleAnchorCapture();
        const activeNode = scrollRef.current;
        if (activeNode) {
          const distance = activeNode.scrollHeight - activeNode.scrollTop - activeNode.clientHeight;
          updateShowScrollToBottom(distance > 80);
        }
        return;
      }
      if (autoFollowRef.current && !userScrollRef.current) {
        scrollToBottom("auto");
        return;
      }
      if (userScrollRef.current && Date.now() < userScrollResizeRestoreUntilRef.current) {
        scheduleIdleAnchorCapture();
        const activeNode = scrollRef.current;
        if (activeNode) {
          const distance = activeNode.scrollHeight - activeNode.scrollTop - activeNode.clientHeight;
          updateShowScrollToBottom(distance > 80);
        }
        return;
      }
      restoreResizeScrollAnchor();
      scheduleAnchorCapture();
      const nodeAfterRestore = scrollRef.current;
      if (!nodeAfterRestore) return;
      const distance = nodeAfterRestore.scrollHeight - nodeAfterRestore.scrollTop - nodeAfterRestore.clientHeight;
      updateShowScrollToBottom(distance > 80);
    };

    const scheduleResizeProcess = () => {
      if (resizeFrame) return;
      resizeFrame = window.requestAnimationFrame(processResize);
    };

    const observer = new ResizeObserver(scheduleResizeProcess);
    const contentNode = streamContentRef.current;
    observer.observe(contentNode ?? node);
    window.addEventListener("resize", scheduleResizeProcess);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleResizeProcess);
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
    };
  }, [session?.id, showOlderItems]);

  useLayoutEffect(() => {
    if (isAutoFollowRef.current) {
      if (Date.now() < sessionAutoBottomUntilRef.current) {
        keepSessionAtBottom();
      } else {
        scrollToBottom("auto");
      }
      return;
    }
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
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

    const placeholder: TimelineEvent = {
      id: crypto.randomUUID(),
      type: "assistant_message",
      timestamp: Date.now(),
      content: "",
      isThinking: defaultThinking,
      isComplete: false,
    };
    updateSession(session.id, (current) => ({
      ...current,
      events: [...current.events, placeholder],
      updatedAt: Date.now(),
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
      thinking: defaultThinking,
      yoloMode: permissionMode === "yolo",
      autoMode: permissionMode === "auto",
      planMode: defaultPlanMode,
    });
    if (!res.success) {
      setRunningSessionId(null);
      updateSession(session.id, (current) => ({
        ...current,
        events: [
          ...current.events.map((event) => event.type === "assistant_message" && event.id === placeholder.id
            ? { ...event, isComplete: true, isThinking: false }
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
  // Anchor capture (getBoundingClientRect + querySelectorAll) is expensive and
  // triggers forced layout. Keep it out of the hot scroll path; scrolling only
  // schedules one idle capture after the wheel/touch stream settles.
  const anchorCaptureFrameRef = useRef(0);
  const anchorCaptureIdleTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
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
    lastScrollTopRef.current = node.scrollTop;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const awayFromBottom = distance > 80;
    updateShowScrollToBottom(awayFromBottom);
    const now = Date.now();
    if (now < ignoreScrollUntilRef.current) return;
    if (userScrollRef.current && (previousScrollTop === null || Math.abs(node.scrollTop - previousScrollTop) > 0.5)) {
      userScrollResizeRestoreUntilRef.current = now + USER_SCROLL_RESIZE_RESTORE_SUPPRESS_MS;
      scheduleIdleAnchorCapture();
    }
    if (userScrollRef.current && awayFromBottom && autoFollowRef.current) {
      autoFollowRef.current = false;
      updateAutoFollow(false);
    }
    if (!awayFromBottom) {
      userScrollRef.current = false;
      updateShowScrollToBottom(false);
    }
  };

  const runtimeSessionId = session ? getRuntimeSessionId(session) : undefined;
  const hasActiveTurn = Boolean(session && (
    runningSessionId === session.id ||
    Boolean(runtimeSessionId && runningSessionId === runtimeSessionId)
  ));
  const shouldFoldOlderItems = !showOlderItems && renderItems.length > CHAT_FULL_RENDER_ITEM_LIMIT;
  const foldedItemCount = shouldFoldOlderItems ? renderItems.length - CHAT_FULL_RENDER_ITEM_LIMIT : 0;
  const visibleRenderItems = shouldFoldOlderItems ? renderItems.slice(-CHAT_FULL_RENDER_ITEM_LIMIT) : renderItems;
  const hasVisibleContent = Boolean(session && visibleEvents.length > 0 && hasVisibleConversation(visibleEvents, runningSessionId, session.id, runtimeSessionId));
  const isSessionScrollPrimed = !session?.id || primedSessionId === session.id;

  useEffect(() => {
    const data = {
      sessionId: session?.id,
      primedSessionId,
      isSessionScrollPrimed,
      hasVisibleContent,
      hasActiveTurn,
      eventsLength: session?.events.length ?? 0,
      renderItemsLength: renderItems.length,
    };
    console.log("[ChatThread] render state", data);
    window.api.writeDiag?.({ message: "[ChatThread] render state", data }).catch(() => {});
    if (session?.id && !isSessionScrollPrimed) {
      const node = scrollRef.current;
      const visibilityData = {
        sessionId: session?.id,
        domVisibility: node ? getComputedStyle(node).visibility : "no-node",
        domScrollHeight: node?.scrollHeight,
        domClientHeight: node?.clientHeight,
      };
      console.log("[ChatThread] visibility check", visibilityData);
      window.api.writeDiag?.({ message: "[ChatThread] visibility check", data: visibilityData }).catch(() => {});
    }
  });

  useEffect(() => {
    const pending = pendingFocusEventRef.current;
    if (!pending || !session || pending.sessionId !== session.id) return;
    window.requestAnimationFrame(() => {
      if (focusTimelineEvent(pending.eventId, pending.searchText)) {
        pendingFocusEventRef.current = null;
      }
    });
  }, [session?.id, visibleRenderItems.length]);

  useLayoutEffect(() => {
    const anchor = pendingOlderItemsScrollAnchorRef.current;
    const node = scrollRef.current;
    if (!anchor || !node || !showOlderItems) return;
    pendingOlderItemsScrollAnchorRef.current = null;
    const delta = node.scrollHeight - anchor.scrollHeight;
    node.scrollTop = anchor.scrollTop + Math.max(0, delta);
    autoFollowRef.current = false;
    userScrollRef.current = true;
    updateAutoFollow(false);
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    updateShowScrollToBottom(distance > 80);
  }, [showOlderItems, visibleRenderItems.length]);

  if (!session || (!hasActiveTurn && !hasPendingMessage && !hasVisibleContent)) {
    return <EmptyState />;
  }

  const expandOlderItems = () => {
    const node = scrollRef.current;
    if (node) {
      pendingOlderItemsScrollAnchorRef.current = {
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
      };
      scrollTokenRef.current += 1;
    }
    setShowOlderItems(true);
  };

  return (
    <div className="relative h-full">
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
        style={{ paddingTop: session.longTask ? 124 : 42, paddingBottom: 0, scrollbarGutter: "stable", overflowAnchor: "none", overscrollBehavior: "contain", visibility: isSessionScrollPrimed ? "visible" : "hidden" }}
        onScroll={handleScroll}
        onPointerDown={(event) => {
          if (event.button === 0) pauseAutoFollowForUser();
        }}
        onWheel={pauseAutoFollowForUser}
        onTouchStart={pauseAutoFollowForUser}
      >
        <div ref={streamContentRef} className="kimix-chat-stream-column flex min-h-full w-full flex-col" style={{ gap: 22, paddingBottom: CHAT_BOTTOM_SPACER_HEIGHT }}>
          {foldedItemCount > 0 && <FoldedHistoryNotice count={foldedItemCount} onExpand={expandOlderItems} />}
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
                  ? <PlanPreviewCard path={item.path} projectPath={item.projectPath} />
                  : item.type === "change_group"
                    ? <ChangeCard changes={item.changes} />
                    : <EventRenderer event={item.event} sessionId={session.id} runtimeSessionId={runtimeSessionId} projectPath={session.projectPath} leadingTools={item.leadingTools} leadingSubagents={item.leadingSubagents} leadingHooks={item.leadingHooks} leadingApprovals={item.leadingApprovals} attachedSteers={item.attachedSteers} activeStatus={item.activeStatus} changedFiles={item.changedFiles} changeSummary={item.changeSummary} trailingStatuses={item.trailingStatuses} hideProcessSummary={item.hideProcessSummary} approvalDiffs={item.approvalDiffs} onRetryError={retryLastUserMessage} />
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
            className="flex items-center justify-center rounded-full border border-[var(--kimix-panel-border)] bg-[var(--kimix-panel-bg)] text-[var(--kimix-panel-text-secondary)] shadow-[0_8px_22px_rgba(15,15,15,0.10)] transition-colors hover:bg-[var(--kimix-panel-hover)] hover:text-[var(--kimix-panel-text)]"
            style={{
              width: 38,
              height: 38,
              opacity: 0,
              pointerEvents: "none",
              transform: "translateY(6px) scale(0.96)",
              transition: "opacity 120ms ease, transform 120ms ease, background-color var(--duration-base) var(--ease-hover), color var(--duration-base) var(--ease-hover)",
              willChange: "opacity, transform",
            }}
          >
            <ArrowDown size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
