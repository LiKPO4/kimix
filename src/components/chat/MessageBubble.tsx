import { useState, useRef, useEffect } from "react";
import { ChevronDown, ChevronUp, Copy, Check, RotateCcw } from "lucide-react";
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
    <div className="group flex justify-end">
      <div className="max-w-[78%]">
        <div className="rounded-[20px] bg-[#F2F2F2] px-5 py-3 text-[15px] leading-relaxed text-text-primary">
          {event.content}
        </div>
        <div className="mt-1 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => trigger(event.content)}
            className="rounded-md p-1 text-text-muted hover:bg-bg-hover"
            title="复制"
            aria-label="复制"
          >
            {copied ? <Check size={13} className="text-accent-green" /> : <Copy size={13} />}
          </button>
          <button
            onClick={handleResend}
            disabled={isRunning}
            className="rounded-md p-1 text-text-muted hover:bg-bg-hover disabled:opacity-30"
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
  const hasContent = event.content.trim().length > 0;
  const hasThinking = Boolean(event.thinking?.trim());

  return (
    <div className="group flex justify-start">
      <div className="w-full max-w-[78%] space-y-2">
        {event.isThinking && !hasContent && !hasThinking && (
          <div className="py-1 text-[15px] text-text-muted">正在思考</div>
        )}

        {hasThinking && (
          <div>
            <button
              onClick={() => setShowThinking(!showThinking)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[13px] text-text-muted transition-colors hover:bg-bg-hover hover:text-text-secondary"
            >
              {showThinking ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              <span>{showThinking ? "收起思考" : "显示思考"}</span>
            </button>
            {showThinking && (
              <div className="mt-1 rounded-xl border border-border-default bg-bg-secondary px-4 py-3 text-[13px] text-text-secondary">
                <pre className="whitespace-pre-wrap font-mono leading-relaxed">{event.thinking}</pre>
              </div>
            )}
          </div>
        )}

        {hasContent && (
          <div className="relative w-full text-[16px] leading-relaxed text-text-primary">
            <MarkdownRenderer content={event.content} />
          </div>
        )}

        {hasContent && (
          <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={() => trigger(event.content)}
              className="rounded-md p-1 text-text-muted transition-colors hover:bg-bg-hover"
              title="复制"
              aria-label="复制"
            >
              {copied ? <Check size={13} className="text-accent-green" /> : <Copy size={13} />}
            </button>
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
