import { useRef, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { EmptyState } from "./EmptyState";
import { MessageBubble } from "./MessageBubble";
import { ToolCard } from "./ToolCard";
import { ChangeCard } from "./ChangeCard";
import { TodoCard } from "./TodoCard";
import { StatusCard } from "./StatusCard";
import { ApprovalCard } from "./ApprovalCard";
import { ErrorCard } from "./ErrorCard";
import type { TimelineEvent, ToolCallEvent } from "@/types/ui";

type RenderItem =
  | { type: "event"; event: TimelineEvent }
  | { type: "tool_group"; id: string; tools: ToolCallEvent[] };

function ToolGroup({ tools }: { tools: ToolCallEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const completed = tools.filter((tool) => tool.status === "success").length;
  const running = tools.length - completed;
  const summary = [
    completed > 0 ? `已运行 ${completed} 条命令` : "",
    running > 0 ? `正在运行 ${running} 条命令` : "",
  ].filter(Boolean).join("，");

  return (
    <div className="w-full">
      <button
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-[13px] text-[#8f887e] transition-colors hover:bg-[#f3f1ec]"
      >
        {expanded ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
        <Wrench size={14} className="shrink-0" />
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

function EventRenderer({ event }: { event: TimelineEvent }) {
  switch (event.type) {
    case "user_message":
    case "assistant_message":
      return <MessageBubble event={event} />;
    case "tool_call":
      return <ToolCard event={event} />;
    case "tool_result":
      return null;
    case "approval_request":
      return <ApprovalCard event={event} />;
    case "status_update":
      return <StatusCard event={event} />;
    case "todo":
      return <TodoCard event={event} />;
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
  let toolBuffer: ToolCallEvent[] = [];
  const flushTools = () => {
    if (toolBuffer.length === 1) {
      items.push({ type: "event", event: toolBuffer[0] });
    } else if (toolBuffer.length > 1) {
      items.push({ type: "tool_group", id: toolBuffer[0].id, tools: toolBuffer });
    }
    toolBuffer = [];
  };

  events.forEach((event) => {
    const type = (event as { type?: unknown }).type;
    if (type === "tool_call") {
      toolBuffer.push(event as ToolCallEvent);
      return;
    }
    if (type === "tool_result") return;
    if (
      type !== "user_message" &&
      type !== "assistant_message" &&
      type !== "approval_request" &&
      type !== "status_update" &&
      type !== "todo" &&
      type !== "diff" &&
      type !== "error" &&
      type !== "subagent" &&
      type !== "compaction"
    ) {
      return;
    }
    flushTools();
    items.push({ type: "event", event });
  });
  flushTools();
  return items;
}

function hasVisibleConversation(events: TimelineEvent[], runningSessionId: string | null, sessionId?: string): boolean {
  return events.some((event) => {
    const type = (event as { type?: unknown }).type;
    if (type === "user_message") {
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
      type === "todo" ||
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
  const session = useSessionStore((s) => s.sessions.find((sess) => sess.id === currentSession?.id));
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastUserEventId = session?.events.filter((event) => event.type === "user_message").at(-1)?.id;
  const renderItems = useMemo(() => buildRenderItems(session?.events ?? []), [session?.events]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [lastUserEventId]);

  if (!session || session.events.length === 0 || !hasVisibleConversation(session.events, runningSessionId, session.id)) {
    return <EmptyState />;
  }

  return (
    <div ref={scrollRef} className="kimix-content-x h-full overflow-y-auto" style={{ paddingTop: 42, paddingBottom: 42 }}>
      <div className="mx-auto flex w-full max-w-[736px] flex-col" style={{ gap: 18 }}>
        {renderItems.map((item) => (
          item.type === "tool_group"
            ? <ToolGroup key={item.id} tools={item.tools} />
            : <EventRenderer key={item.event.id} event={item.event} />
        ))}
      </div>
    </div>
  );
}
