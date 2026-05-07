import { useState, useRef, useEffect } from "react";
import { Loader2, ChevronDown, ChevronUp, Copy, Check, RotateCcw } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TimelineEvent } from "@/types/ui";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface MessageBubbleProps {
  event: Extract<TimelineEvent, { type: "user_message" | "assistant_message" }>;
}

function useCopyTimeout() {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const trigger = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 2000);
  };

  return { copied, trigger };
}

function UserMessageBubble({ event }: { event: Extract<TimelineEvent, { type: "user_message" }> }) {
  const { copied, trigger } = useCopyTimeout();
  const currentSession = useAppStore((s) => s.currentSession);
  const isRunning = useAppStore((s) => s.isRunning);
  const setIsRunning = useAppStore((s) => s.setIsRunning);
  const updateSession = useSessionStore((s) => s.updateSession);

  const handleResend = async () => {
    if (!currentSession || isRunning) return;
    const thinkingPlaceholder: TimelineEvent = {
      id: Math.random().toString(36).substring(2, 11),
      type: "assistant_message",
      timestamp: Date.now(),
      content: "",
      isThinking: true,
      isComplete: false,
    };
    updateSession(currentSession.id, (session) => ({
      ...session,
      events: [...session.events, thinkingPlaceholder],
      updatedAt: Date.now(),
    }));
    setIsRunning(true);
    try {
      await window.api.sendPrompt({ sessionId: currentSession.id, content: event.content });
    } catch (err) {
      console.error("Resend failed:", err);
      setIsRunning(false);
    }
  };

  return (
    <div className="flex justify-end group">
      <div className="max-w-[80%]">
        <div className="rounded-[20px] rounded-tr-sm bg-[#0078d4] text-white px-5 py-3 text-[15px] leading-relaxed">
          {event.content}
        </div>
        <div className="flex justify-end gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => trigger(event.content)}
            className="p-1 rounded-md hover:bg-bg-hover text-text-muted"
            title="复制"
            aria-label="复制"
          >
            {copied ? <Check size={13} className="text-accent-green" /> : <Copy size={13} />}
          </button>
          <button
            onClick={handleResend}
            disabled={isRunning}
            className="p-1 rounded-md hover:bg-bg-hover text-text-muted disabled:opacity-30"
            title="重新发送"
            aria-label="重新发送"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function AssistantMessageBubble({ event }: { event: Extract<TimelineEvent, { type: "assistant_message" }> }) {
  const [showThinking, setShowThinking] = useState(false);
  const { copied, trigger } = useCopyTimeout();

  return (
    <div className="flex justify-start group">
      <div className="max-w-[80%] space-y-1">
        {event.isThinking && !event.content && !event.thinking && (
          <div className="rounded-[20px] rounded-tl-sm bg-bg-elevated border border-border-default px-5 py-3">
            <div className="flex items-center gap-2 text-text-muted text-sm">
              <Loader2 size={14} className="animate-spin" />
              <span>思考中...</span>
            </div>
          </div>
        )}

        {(event.content || (!event.isThinking && event.thinking)) && (
          <div className="relative">
            <div className="rounded-[20px] rounded-tl-sm bg-bg-elevated border border-border-default px-5 py-3 text-[15px] leading-relaxed text-text-primary">
              <MarkdownRenderer content={event.content} />
            </div>
            <button
              onClick={() => trigger(event.content)}
              className="absolute -right-7 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-bg-hover text-text-muted"
              title="复制"
              aria-label="复制"
            >
              {copied ? <Check size={13} className="text-accent-green" /> : <Copy size={13} />}
            </button>
          </div>
        )}

        {event.thinking && (
          <div className="ml-1">
            <button
              onClick={() => setShowThinking(!showThinking)}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors px-2 py-1 rounded-md hover:bg-bg-hover"
            >
              {showThinking ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              <span>{showThinking ? "收起思考" : "显示思考"}</span>
            </button>
            {showThinking && (
              <div className="mt-1 text-xs text-text-secondary bg-bg-secondary rounded-xl px-4 py-3 border border-border-default">
                <pre className="whitespace-pre-wrap font-mono leading-relaxed">{event.thinking}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function MessageBubble({ event }: MessageBubbleProps) {
  if (event.type === "user_message") {
    return <UserMessageBubble event={event} />;
  }
  return <AssistantMessageBubble event={event} />;
}
