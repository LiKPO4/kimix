import { useRef, useEffect, useMemo, useState } from "react";
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
import type { LongTaskSessionMeta, TimelineEvent, ToolCallEvent } from "@/types/ui";

type RenderItem =
  | { type: "event"; event: TimelineEvent; leadingTools?: ToolCallEvent[]; leadingSubagents?: Extract<TimelineEvent, { type: "subagent" }>[]; leadingHooks?: Extract<TimelineEvent, { type: "hook" }>[]; leadingApprovals?: Extract<TimelineEvent, { type: "approval_request" }>[]; attachedSteers?: Extract<TimelineEvent, { type: "steer_message" }>[]; changedFiles?: string[]; trailingStatuses?: Extract<TimelineEvent, { type: "status_update" }>[]; hideProcessSummary?: boolean; approvalDiffs?: { path: string; oldText?: string; newText?: string; additions?: number; deletions?: number }[] }
  | { type: "tool_group"; id: string; tools: ToolCallEvent[] }
  | { type: "plan_preview"; id: string; path: string; projectPath?: string }
  | { type: "change_group"; id: string; changes: { path: string; oldText?: string; newText?: string; additions?: number; deletions?: number }[] };

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

const longTaskStageLabels: Record<LongTaskSessionMeta["stage"], string> = {
  drafting: "需求澄清",
  planning: "计划设计",
  ready: "等待执行",
  running: "执行中",
  reviewing: "审查中",
  paused: "已暂停",
  completed: "已完成",
};

const longTaskAgentLabels: Record<LongTaskSessionMeta["activeAgent"], string> = {
  executor: "执行 agent",
  reviewer: "审查 agent",
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
  const isReviewer = meta.activeAgent === "reviewer";
  return (
    <div
      className={`kimix-chat-banner rounded-2xl shadow-[0_10px_26px_rgba(74,132,190,0.10)] ${isReviewer ? "is-reviewer" : ""}`}
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
            className={`kimix-chat-banner-button kimix-icon-text-button is-compact rounded-lg hover:opacity-90 ${isReviewer ? "text-[var(--kimix-warning-text)]" : "text-[var(--kimix-info-text)]"}`}
            onClick={() => {
              void window.api.openFile({ projectPath, filePath: meta.bigPlanPath });
            }}
          >
            BIGPLAN
          </button>
          <span className={`kimix-chat-banner-badge rounded-lg text-[12px] leading-5 ${isReviewer ? "text-[var(--kimix-warning-text)]" : "text-[var(--kimix-info-text)]"}`} style={{ minHeight: 32, padding: "5px 10px" }}>
            {longTaskAgentLabels[meta.activeAgent]}
          </span>
        </div>
      </div>
    </div>
  );
}

function EventRenderer({ event, sessionId, projectPath, leadingTools, leadingSubagents, leadingHooks, leadingApprovals, attachedSteers, changedFiles, trailingStatuses, hideProcessSummary, approvalDiffs, onRetryError }: { event: TimelineEvent; sessionId: string; projectPath: string; leadingTools?: ToolCallEvent[]; leadingSubagents?: Extract<TimelineEvent, { type: "subagent" }>[]; leadingHooks?: Extract<TimelineEvent, { type: "hook" }>[]; leadingApprovals?: Extract<TimelineEvent, { type: "approval_request" }>[]; attachedSteers?: Extract<TimelineEvent, { type: "steer_message" }>[]; changedFiles?: string[]; trailingStatuses?: Extract<TimelineEvent, { type: "status_update" }>[]; hideProcessSummary?: boolean; approvalDiffs?: { path: string; oldText?: string; newText?: string; additions?: number; deletions?: number }[]; onRetryError?: () => Promise<void> }) {
  switch (event.type) {
    case "user_message":
    case "steer_message":
      return <MessageBubble event={event} />;
    case "assistant_message":
      return <MessageBubble event={event} leadingTools={leadingTools} leadingSubagents={leadingSubagents} leadingHooks={leadingHooks} leadingApprovals={leadingApprovals} attachedSteers={attachedSteers} changedFiles={changedFiles} trailingStatuses={trailingStatuses} hideProcessSummary={hideProcessSummary} />;
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
        <div className="flex justify-center">
          <div className="rounded-full bg-bg-secondary px-4 py-1.5 text-[13px] text-text-muted">
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

function buildRenderItems(events: TimelineEvent[], sessionEngine?: "prompt" | "kimi-code"): RenderItem[] {
  const items: RenderItem[] = [];

  const pushStandaloneTools = (tools: ToolCallEvent[]) => {
    if (tools.length === 0) return;
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
      durationMs: last.durationMs ?? Math.max(0, last.timestamp - first.timestamp),
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
      !subagents.some((event) => event.status === "running")
    );
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
      const type = (event as { type?: unknown }).type;
      if (type === "steer_message") continue;
      if (type === "tool_call" || type === "tool_result") continue;
      if (type === "subagent") continue;
      if (type === "hook") continue;
      if (type === "status_update") continue;
      if (type === "change_summary") continue;
      if (type === "diff") continue;
      if (type === "assistant_message") {
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
          changedFiles: assistantAttached ? [] : Array.from(changedFiles),
          trailingStatuses: [],
          hideProcessSummary: assistantAttached && (hasContent || !hasOwnProcessDetails),
        });
        assistantAttached = true;
        toolsAttached = true;
        continue;
      }
      if (
        (type !== "assistant_message" || assistantEventIds.has(event.id)) &&
        type !== "assistant_message" &&
        type !== "approval_request" &&
        type !== "question_request" &&
        type !== "file_artifact" &&
        type !== "change_summary" &&
        type !== "session_recommendation" &&
        type !== "diff" &&
        type !== "error" &&
        type !== "compaction"
      ) {
        continue;
      }
      if (type === "assistant_message" && !toolsAttached) {
        items.push({ type: "event", event, leadingTools: tools, leadingSubagents: subagents, leadingHooks: hooks, changedFiles: Array.from(changedFiles), trailingStatuses: [] });
        toolsAttached = true;
        assistantAttached = true;
        continue;
      }
      if (!toolsAttached) {
        if (tools.length > 0) {
          pushStandaloneTools(tools);
          toolsAttached = true;
        }
      }
      if ((type === "question_request" || type === "approval_request") && mergedChangeSummary && !changeSummaryAttached) {
        items.push({ type: "event", event: mergedChangeSummary });
        changeSummaryAttached = true;
      }
      if ((type === "question_request" || type === "approval_request") && standaloneDiffEvents.length > 0 && !diffGroupAttached) {
        items.push({
          type: "change_group",
          id: `diff-group-${standaloneDiffEvents.map((diff) => diff.id).join(":")}`,
          changes: standaloneDiffEvents.map((diff) => ({ path: diff.filePath, oldText: diff.oldText, newText: diff.newText })),
        });
        diffGroupAttached = true;
      }
      if ((type === "question_request" || type === "approval_request") && planPath && !planPreviewAttached) {
        items.push({ type: "plan_preview", id: `plan-preview-${planPath}`, path: planPath, projectPath: mergedChangeSummary?.projectPath });
        planPreviewAttached = true;
      }
      if (type === "approval_request") {
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
    if (turnSettled) {
      statusEvents.forEach((event) => items.push({ type: "event", event }));
    }
    if (!assistantAttached) {
      subagents.forEach((event) => items.push({ type: "event", event }));
    }
  };

  let turnBody: TimelineEvent[] = [];
  const flushTurn = () => {
    renderTurnBody(turnBody);
    turnBody = [];
  };

  for (const event of events) {
    const type = (event as { type?: unknown }).type;
    if (type === "user_message") {
      flushTurn();
      items.push(type === "approval_request" ? { type: "event", event, approvalDiffs: diffEvents.map((diff) => ({ path: diff.filePath, oldText: diff.oldText, newText: diff.newText })) } : { type: "event", event });
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

function hasVisibleConversation(events: TimelineEvent[], runningSessionId: string | null, sessionId?: string): boolean {
  return events.some((event) => {
    const type = (event as { type?: unknown }).type;
    if (type === "user_message") {
      const content = (event as { content?: unknown }).content;
      const images = (event as { images?: unknown }).images;
      return (typeof content === "string" && content.trim().length > 0) || (Array.isArray(images) && images.length > 0);
    }
    if (type === "steer_message") {
      const content = (event as { content?: unknown }).content;
      return typeof content === "string" && content.trim().length > 0;
    }
    if (type === "assistant_message") {
      const content = (event as { content?: unknown }).content;
      const thinking = (event as { thinking?: unknown }).thinking;
      const hasText =
        (typeof content === "string" && content.trim().length > 0) ||
        (typeof thinking === "string" && thinking.trim().length > 0);
      const isActiveThinking = Boolean(sessionId && runningSessionId === sessionId && event.isThinking && !event.isComplete);
      return hasText || isActiveThinking;
    }
    if (type === "tool_result") return false;
    if (type === "status_update") {
      const message = (event as { message?: unknown }).message;
      return (typeof message === "string" && message.trim().length > 0) || Boolean(runningSessionId === sessionId);
    }
    if (
      type === "tool_call" ||
      type === "approval_request" ||
      type === "question_request" ||
      type === "file_artifact" ||
      type === "change_summary" ||
      type === "session_recommendation" ||
      type === "diff" ||
      type === "error" ||
      type === "subagent" ||
      type === "compaction"
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
  const statusUpdateDisplay = useAppStore((s) => s.statusUpdateDisplay);
  const session = useLiveSession(currentSession?.id);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoFollowRef = useRef(true);
  const userScrollRef = useRef(false);
  const ignoreScrollUntilRef = useRef(0);
  const scrollTokenRef = useRef(0);
  const isAutoFollowRef = useRef(true);
  const showScrollToBottomRef = useRef(false);
  const [isAutoFollow, setIsAutoFollow] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const visibleEvents = useMemo(
    () => filterStatusUpdates(
      collapseCompletedCompactions(session?.events ?? []),
      statusUpdateDisplay,
    ),
    [session?.events, statusUpdateDisplay]
  );
  const renderItems = useMemo(() => buildRenderItems(visibleEvents, session?.engine), [visibleEvents, session?.engine]);
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
    setIsAutoFollow(value);
  };

  const updateShowScrollToBottom = (value: boolean) => {
    if (showScrollToBottomRef.current === value) return;
    showScrollToBottomRef.current = value;
    setShowScrollToBottom(value);
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const node = scrollRef.current;
    if (!node) return;
    const token = ++scrollTokenRef.current;
    ignoreScrollUntilRef.current = Date.now() + 420;
    node.scrollTo({ top: node.scrollHeight, behavior });
    window.setTimeout(() => {
      if (token !== scrollTokenRef.current || !autoFollowRef.current) return;
      const current = scrollRef.current;
      if (!current) return;
      const distance = current.scrollHeight - current.scrollTop - current.clientHeight;
      updateShowScrollToBottom(distance > 80);
    }, 460);
  };

  const enableAutoFollow = () => {
    autoFollowRef.current = true;
    userScrollRef.current = false;
    updateAutoFollow(true);
    updateShowScrollToBottom(false);
    scrollToBottom("smooth");
  };

  const pauseAutoFollowForUser = () => {
    userScrollRef.current = true;
    scrollTokenRef.current += 1;
    if (autoFollowRef.current) {
      autoFollowRef.current = false;
      updateAutoFollow(false);
    }
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    updateShowScrollToBottom(distance > 24);
  };

  useEffect(() => {
    autoFollowRef.current = true;
    userScrollRef.current = false;
    updateAutoFollow(true);
    updateShowScrollToBottom(false);
    window.requestAnimationFrame(() => scrollToBottom("auto"));
  }, [session?.id]);

  useEffect(() => {
    if (isAutoFollow) {
      window.requestAnimationFrame(() => scrollToBottom("smooth"));
      return;
    }
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    updateShowScrollToBottom(distance > 80);
  }, [contentVersion, isAutoFollow]);

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

    const res = await window.api.sendPrompt({
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
  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const awayFromBottom = distance > 80;
    updateShowScrollToBottom(awayFromBottom);
    if (Date.now() < ignoreScrollUntilRef.current) return;
    if (userScrollRef.current && awayFromBottom && autoFollowRef.current) {
      autoFollowRef.current = false;
      updateAutoFollow(false);
    }
    if (!awayFromBottom) {
      userScrollRef.current = false;
      updateShowScrollToBottom(false);
    }
  };

  if (!session || session.events.length === 0 || !hasVisibleConversation(session.events, runningSessionId, session.id)) {
    return <EmptyState />;
  }

  return (
    <div className="relative h-full">
      {session.longTask && (
        <div className="kimix-content-x pointer-events-none absolute inset-x-0 z-30" style={{ top: 10 }}>
          <div className="kimix-chat-column pointer-events-auto">
            <LongTaskBanner meta={session.longTask} projectPath={session.projectPath} />
          </div>
        </div>
      )}
      <div
        ref={scrollRef}
        className="kimix-content-x h-full overflow-y-auto"
        style={{ paddingTop: session.longTask ? 124 : 42, paddingBottom: 120 }}
        onScroll={handleScroll}
        onWheel={pauseAutoFollowForUser}
        onTouchStart={pauseAutoFollowForUser}
      >
        <div className="kimix-chat-column flex min-h-full w-full flex-col" style={{ gap: 22 }}>
          {renderItems.map((item, index) => (
            <div key={item.type === "event" ? item.event.id : item.type === "tool_group" ? item.id : item.type === "plan_preview" ? item.id : item.id} className="kimix-message-enter" style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}>
              {item.type === "tool_group"
                ? <ToolGroup tools={item.tools} />
                : item.type === "plan_preview"
                  ? <PlanPreviewCard path={item.path} projectPath={item.projectPath} />
                  : item.type === "change_group"
                    ? <ChangeCard changes={item.changes} />
                    : <EventRenderer event={item.event} sessionId={session.id} projectPath={session.projectPath} leadingTools={item.leadingTools} leadingSubagents={item.leadingSubagents} leadingHooks={item.leadingHooks} leadingApprovals={item.leadingApprovals} attachedSteers={item.attachedSteers} changedFiles={item.changedFiles} trailingStatuses={item.trailingStatuses} hideProcessSummary={item.hideProcessSummary} approvalDiffs={item.approvalDiffs} onRetryError={retryLastUserMessage} />
              }
            </div>
          ))}
        </div>
      </div>
      {showScrollToBottom && (
        <div className="kimix-content-x pointer-events-none absolute inset-x-0 z-20" style={{ bottom: 24 }}>
          <div className="kimix-chat-column flex justify-end">
            <button
              type="button"
              aria-label="滚动到底部"
              title="滚动到底部"
              onClick={enableAutoFollow}
              className="pointer-events-auto flex items-center justify-center rounded-full border border-[var(--kimix-panel-border)] bg-[var(--kimix-panel-bg)] text-[var(--kimix-panel-text-secondary)] shadow-[0_8px_22px_rgba(15,15,15,0.10)] transition-colors hover:bg-[var(--kimix-panel-hover)] hover:text-[var(--kimix-panel-text)]"
              style={{ width: 38, height: 38 }}
            >
              <ArrowDown size={17} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
