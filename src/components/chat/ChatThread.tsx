import { useRef, useEffect, useMemo, useState } from "react";
import { ArrowDown, ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { EmptyState } from "./EmptyState";
import { MessageBubble } from "./MessageBubble";
import { ToolCard } from "./ToolCard";
import { ChangeCard } from "./ChangeCard";
import { FileCard } from "./FileCard";
import { StatusCard } from "./StatusCard";
import { ApprovalCard } from "./ApprovalCard";
import { ErrorCard } from "./ErrorCard";
import type { TimelineEvent, ToolCallEvent } from "@/types/ui";

type RenderItem =
  | { type: "event"; event: TimelineEvent; leadingTools?: ToolCallEvent[] }
  | { type: "tool_group"; id: string; tools: ToolCallEvent[] };

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
        className="flex h-8 w-full items-center rounded-lg text-left text-[14.5px] leading-none text-[#8a847a] transition-colors hover:bg-[#f3f1ec]"
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

function EventRenderer({ event, leadingTools }: { event: TimelineEvent; leadingTools?: ToolCallEvent[] }) {
  switch (event.type) {
    case "user_message":
    case "steer_message":
      return <MessageBubble event={event} />;
    case "assistant_message":
      return <MessageBubble event={event} leadingTools={leadingTools} />;
    case "tool_call":
      return <ToolCard event={event} />;
    case "tool_result":
      return null;
    case "approval_request":
      return <ApprovalCard event={event} />;
    case "status_update":
      return <StatusCard event={event} />;
    case "file_artifact":
      return <FileCard event={event} />;
    case "change_summary":
      return <ChangeCard event={event} />;
    case "todo":
      return null;
    case "diff":
      return <ChangeCard changes={[{ path: event.filePath, oldText: event.oldText, newText: event.newText }]} />;
    case "error":
      return <ErrorCard event={event} />;
    case "subagent":
    case "compaction":
      return (
        <div className="flex justify-center">
          <div className="rounded-full bg-bg-secondary px-4 py-1.5 text-[13px] text-text-muted">
            {event.type === "subagent" ? `${event.agentName} ${event.status}` : event.phase === "begin" ? "上下文压缩中..." : "上下文压缩完成"}
          </div>
        </div>
      );
    default:
      return null;
  }
}

function buildRenderItems(events: TimelineEvent[]): RenderItem[] {
  const items: RenderItem[] = [];

  const pushStandaloneTools = (tools: ToolCallEvent[]) => {
    if (tools.length === 0) return;
    items.push({ type: "tool_group", id: tools[0].id, tools });
  };

  const renderTurnBody = (turnEvents: TimelineEvent[]) => {
    const tools = turnEvents.filter((event): event is ToolCallEvent => event.type === "tool_call");
    let toolsAttached = false;

    for (const event of turnEvents) {
      const type = (event as { type?: unknown }).type;
      if (type === "tool_call" || type === "tool_result") continue;
      if (
        type !== "assistant_message" &&
        type !== "approval_request" &&
        type !== "status_update" &&
        type !== "file_artifact" &&
        type !== "change_summary" &&
        type !== "diff" &&
        type !== "error" &&
        type !== "subagent" &&
        type !== "compaction"
      ) {
        continue;
      }
      if (type === "assistant_message" && !toolsAttached) {
        items.push({ type: "event", event, leadingTools: tools });
        toolsAttached = true;
        continue;
      }
      if (!toolsAttached && tools.length > 0) {
        pushStandaloneTools(tools);
        toolsAttached = true;
      }
      items.push({ type: "event", event });
    }

    if (!toolsAttached) pushStandaloneTools(tools);
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

function filterStatusUpdates(events: TimelineEvent[], display: "each" | "turn_end"): TimelineEvent[] {
  if (display === "each") return events;
  return events.filter((event, index) => {
    if (event.type !== "status_update") return true;
    const nextTurnIndex = events.findIndex((candidate, candidateIndex) => (
      candidateIndex > index &&
      (candidate.type === "user_message" || candidate.type === "steer_message")
    ));
    const turnEnd = nextTurnIndex === -1 ? events.length : nextTurnIndex;
    return !events.slice(index + 1, turnEnd).some((candidate) => candidate.type === "status_update");
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
      type === "file_artifact" ||
      type === "change_summary" ||
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
  const visibleEvents = useMemo(() => filterStatusUpdates(session?.events ?? [], statusUpdateDisplay), [session?.events, statusUpdateDisplay]);
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
      <div
        ref={scrollRef}
        className="kimix-content-x h-full overflow-y-auto"
        style={{ paddingTop: 42, paddingBottom: 42 }}
        onScroll={handleScroll}
        onWheel={pauseAutoFollowForUser}
        onTouchStart={pauseAutoFollowForUser}
      >
        <div className="kimix-chat-column flex w-full flex-col" style={{ gap: 18 }}>
          {renderItems.map((item) => (
            item.type === "tool_group"
              ? <ToolGroup key={item.id} tools={item.tools} />
              : <EventRenderer key={item.event.id} event={item.event} leadingTools={item.leadingTools} />
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
              className="pointer-events-auto flex items-center justify-center rounded-full border border-[#dedad2] bg-white text-[#6f6a62] shadow-[0_8px_22px_rgba(15,15,15,0.10)] transition-colors hover:bg-[#f6f4ef] hover:text-[#2f2d29]"
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
