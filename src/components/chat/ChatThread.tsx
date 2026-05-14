import { useRef, useEffect, useMemo, useState } from "react";
import { ArrowDown, ChevronDown, ChevronRight, Wrench, Loader2, Bot } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
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
import type { LongTaskSessionMeta, TimelineEvent, ToolCallEvent } from "@/types/ui";

type RenderItem =
  | { type: "event"; event: TimelineEvent; leadingTools?: ToolCallEvent[]; leadingSubagents?: Extract<TimelineEvent, { type: "subagent" }>[]; changedFiles?: string[]; trailingStatuses?: Extract<TimelineEvent, { type: "status_update" }>[] }
  | { type: "tool_group"; id: string; tools: ToolCallEvent[] };

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
            className={`kimix-chat-banner-button kimix-icon-text-button is-compact hover:opacity-90 ${isReviewer ? "text-[var(--kimix-warning-text)]" : "text-[var(--kimix-info-text)]"}`}
            onClick={() => {
              void window.api.openFile({ projectPath, filePath: meta.bigPlanPath });
            }}
          >
            BIGPLAN
          </button>
          <span className={`kimix-chat-banner-badge rounded-full text-[12px] leading-5 ${isReviewer ? "text-[var(--kimix-warning-text)]" : "text-[var(--kimix-info-text)]"}`} style={{ padding: "5px 10px" }}>
            {longTaskAgentLabels[meta.activeAgent]}
          </span>
        </div>
      </div>
    </div>
  );
}

function EventRenderer({ event, leadingTools, leadingSubagents, changedFiles, trailingStatuses }: { event: TimelineEvent; leadingTools?: ToolCallEvent[]; leadingSubagents?: Extract<TimelineEvent, { type: "subagent" }>[]; changedFiles?: string[]; trailingStatuses?: Extract<TimelineEvent, { type: "status_update" }>[] }) {
  switch (event.type) {
    case "user_message":
    case "steer_message":
      return <MessageBubble event={event} />;
    case "assistant_message":
      return <MessageBubble event={event} leadingTools={leadingTools} leadingSubagents={leadingSubagents} changedFiles={changedFiles} trailingStatuses={trailingStatuses} />;
    case "tool_call":
      return <ToolCard event={event} />;
    case "tool_result":
      return null;
    case "approval_request":
      return <ApprovalCard event={event} />;
    case "question_request":
      return <QuestionCard event={event} />;
    case "status_update":
      return <StatusCard event={event} />;
    case "file_artifact":
      return <FileCard event={event} />;
    case "change_summary":
      return <ChangeCard event={event} />;
    case "session_recommendation":
      return <SessionRecommendationCard event={event} />;
    case "todo":
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
      const existing = filesByPath.get(file.path);
      filesByPath.set(file.path, {
        path: file.path,
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

function buildRenderItems(events: TimelineEvent[]): RenderItem[] {
  const items: RenderItem[] = [];

  const pushStandaloneTools = (tools: ToolCallEvent[]) => {
    if (tools.length === 0) return;
    items.push({ type: "tool_group", id: tools[0].id, tools });
  };

  const renderTurnBody = (turnEvents: TimelineEvent[]) => {
    const tools = turnEvents.filter((event): event is ToolCallEvent => event.type === "tool_call");
    const primaryAssistant = turnEvents.find((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => (
      event.type === "assistant_message" && event.content.trim().length > 0
    ));
    const changedFiles = new Set(
      turnEvents
        .filter((e): e is Extract<TimelineEvent, { type: "change_summary" }> => e.type === "change_summary")
        .flatMap((e) => e.files.map((f) => f.path))
    );
    let toolsAttached = false;

    const statusEvents = turnEvents.filter((event): event is Extract<TimelineEvent, { type: "status_update" }> => event.type === "status_update");
    const subagents = turnEvents.filter((event): event is Extract<TimelineEvent, { type: "subagent" }> => event.type === "subagent");
    const mergedChangeSummary = mergeChangeSummaryEvents(turnEvents.filter((event): event is Extract<TimelineEvent, { type: "change_summary" }> => event.type === "change_summary"));
    let assistantAttached = false;
    const trailingStatuses = statusEvents;

    for (const event of turnEvents) {
      const type = (event as { type?: unknown }).type;
      if (type === "tool_call" || type === "tool_result") continue;
      if (type === "subagent") continue;
      if (type === "status_update") continue;
      if (type === "change_summary") continue;
      if (event === primaryAssistant) {
        items.push({ type: "event", event, leadingTools: tools, leadingSubagents: subagents, changedFiles: Array.from(changedFiles), trailingStatuses });
        toolsAttached = true;
        assistantAttached = true;
        continue;
      }
      if (
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
      if (primaryAssistant && type === "question_request") continue;
      if (type === "assistant_message" && !toolsAttached) {
        items.push({ type: "event", event, leadingTools: tools, leadingSubagents: subagents, changedFiles: Array.from(changedFiles), trailingStatuses });
        toolsAttached = true;
        assistantAttached = true;
        continue;
      }
      if (!toolsAttached && tools.length > 0) {
        pushStandaloneTools(tools);
        toolsAttached = true;
      }
      items.push({ type: "event", event });
    }

    if (!toolsAttached) pushStandaloneTools(tools);
    if (primaryAssistant) {
      turnEvents
        .filter((event) => event.type === "question_request")
        .forEach((event) => items.push({ type: "event", event }));
    }
    if (mergedChangeSummary) items.push({ type: "event", event: mergedChangeSummary });
    if (!assistantAttached) {
      subagents.forEach((event) => items.push({ type: "event", event }));
      statusEvents.forEach((event) => items.push({ type: "event", event }));
    }
  };

  let turnBody: TimelineEvent[] = [];
  const flushTurn = () => {
    renderTurnBody(turnBody);
    turnBody = [];
  };

  for (const event of events) {
    const type = (event as { type?: unknown }).type;
    if (type === "user_message" || type === "steer_message") {
      flushTurn();
      items.push({ type: "event", event });
      continue;
    }

    turnBody.push(event);
  }
  flushTurn();
  return items;
}

function filterStatusUpdates(events: TimelineEvent[], display: "each" | "turn_end", isRunning: boolean): TimelineEvent[] {
  return events.filter((event, index) => {
    if (event.type !== "status_update") return true;
    if (isRunning) return false;
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
  const statusUpdateDisplay = useAppStore((s) => s.statusUpdateDisplay);
  const session = useSessionStore((s) => s.sessions.find((sess) => sess.id === currentSession?.id));
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
      Boolean(session?.id && runningSessionId === session.id),
    ),
    [session?.events, session?.id, runningSessionId, statusUpdateDisplay]
  );
  const renderItems = useMemo(() => buildRenderItems(visibleEvents), [visibleEvents]);
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
        style={{ paddingTop: session.longTask ? 124 : 42, paddingBottom: 42 }}
        onScroll={handleScroll}
        onWheel={pauseAutoFollowForUser}
        onTouchStart={pauseAutoFollowForUser}
      >
        <div className="kimix-chat-column flex w-full flex-col" style={{ gap: 22 }}>
          {renderItems.map((item) => (
            item.type === "tool_group"
              ? <ToolGroup key={item.id} tools={item.tools} />
              : <EventRenderer key={item.event.id} event={item.event} leadingTools={item.leadingTools} leadingSubagents={item.leadingSubagents} changedFiles={item.changedFiles} trailingStatuses={item.trailingStatuses} />
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
