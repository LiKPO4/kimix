import { useRef, useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { MoreHorizontal } from "lucide-react";
import { EmptyState } from "./EmptyState";
import { MessageBubble } from "./MessageBubble";
import { ToolCard } from "./ToolCard";
import { ChangeCard } from "./ChangeCard";
import { TodoCard } from "./TodoCard";
import { StatusCard } from "./StatusCard";
import { ApprovalCard } from "./ApprovalCard";
import { ErrorCard } from "./ErrorCard";
import type { TimelineEvent } from "@/types/ui";

function EventRenderer({ event }: { event: TimelineEvent }) {
  switch (event.type) {
    case "user_message":
    case "assistant_message":
      return <MessageBubble event={event} />;
    case "tool_call":
    case "tool_result":
      return <ToolCard event={event} />;
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
          <div className="text-xs text-text-muted bg-bg-secondary rounded-full px-4 py-1.5">
            {event.type === "subagent" ? `🤖 ${event.agentName} ${event.status}` : event.phase === "begin" ? "📝 上下文压缩中..." : "✅ 上下文压缩完成"}
          </div>
        </div>
      );
    default:
      return null;
  }
}

export function ChatThread() {
  const currentSession = useAppStore((s) => s.currentSession);
  const session = useSessionStore((s) => s.sessions.find((sess) => sess.id === currentSession?.id));
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastEventId = session?.events[session?.events.length - 1]?.id;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [lastEventId]);

  if (!session || session.events.length === 0) {
    return <EmptyState />;
  }

  return (
    <>
      {/* Chat Thread Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border-default bg-bg-primary shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-medium text-text-primary truncate">{session.title}</h2>
        </div>
        <button
          className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text-secondary transition-colors"
          title="更多操作"
          aria-label="更多操作"
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
        {session.events.map((event) => (
          <EventRenderer key={event.id} event={event} />
        ))}
      </div>
    </>
  );
}
