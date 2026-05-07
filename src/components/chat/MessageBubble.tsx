import { useState } from "react";
import { Loader2, ChevronDown, ChevronUp, User, Bot, Copy, Check, RotateCcw } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TimelineEvent } from "@/types/ui";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface MessageBubbleProps {
  event: Extract<TimelineEvent, { type: "user_message" | "assistant_message" }>;
}

export function MessageBubble({ event }: MessageBubbleProps) {
  const [showThinking, setShowThinking] = useState(false);

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatFullTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

  if (event.type === "user_message") {
    const [copied, setCopied] = useState(false);
    const currentSession = useAppStore((s) => s.currentSession);
    const isRunning = useAppStore((s) => s.isRunning);
    const setIsRunning = useAppStore((s) => s.setIsRunning);
    const updateSession = useSessionStore((s) => s.updateSession);

    const handleCopy = async () => {
      await navigator.clipboard.writeText(event.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };

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
        <div className="flex items-start gap-2.5 max-w-[85%]">
          <div className="relative">
            <div className="rounded-2xl rounded-tr-sm bg-accent-blue text-white px-5 py-3 text-[15px] leading-relaxed shadow-sm">
              {event.content}
            </div>
            <div className="absolute -left-8 top-1 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={handleCopy}
                className="p-1 rounded-md hover:bg-bg-tertiary text-text-muted"
                title="复制"
              >
                {copied ? <Check size={14} className="text-accent-green" /> : <Copy size={14} />}
              </button>
              <button
                onClick={handleResend}
                disabled={isRunning}
                className="p-1 rounded-md hover:bg-bg-tertiary text-text-muted disabled:opacity-30"
                title="重新发送"
              >
                <RotateCcw size={14} />
              </button>
            </div>
            <div className="text-right mt-1">
              <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" title={formatFullTime(event.timestamp)}>
                {formatTime(event.timestamp)}
              </span>
            </div>
          </div>
          <div className="w-7 h-7 rounded-full bg-accent-blue/10 flex items-center justify-center shrink-0 mt-1">
            <User size={14} className="text-accent-blue" />
          </div>
        </div>
      </div>
    );
  }

  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(event.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex justify-start group">
      <div className="flex items-start gap-2.5 max-w-[85%]">
        <div className="w-7 h-7 rounded-full bg-bg-tertiary flex items-center justify-center shrink-0 mt-1 border border-border-default">
          <Bot size={14} className="text-text-secondary" />
        </div>
        <div className="space-y-1">
          {/* Thinking placeholder */}
          {event.isThinking && !event.content && !event.thinking && (
            <div className="rounded-2xl rounded-tl-sm bg-bg-elevated border border-border-default px-5 py-3 shadow-sm">
              <div className="flex items-center gap-2 text-text-muted text-sm">
                <Loader2 size={14} className="animate-spin" />
                <span className="flex gap-0.5">
                  {"思考中".split("").map((c, i) => (
                    <span key={i} className="inline-block" style={{ animation: `pulse-dot 1.5s ${i * 0.15}s infinite` }}>{c}</span>
                  ))}
                  <span className="inline-flex gap-0.5">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="inline-block w-1 h-1 rounded-full bg-text-muted" style={{ animation: `pulse-dot 1.5s ${i * 0.3}s infinite` }} />
                    ))}
                  </span>
                </span>
              </div>
            </div>
          )}

          {/* Content */}
          {(event.content || (!event.isThinking && event.thinking)) && (
            <div className="relative">
              <div className="rounded-2xl rounded-tl-sm bg-bg-elevated border border-border-default px-5 py-3 text-[15px] leading-relaxed text-text-primary shadow-sm">
                <MarkdownRenderer content={event.content} />
              </div>
              <button
                onClick={handleCopy}
                className="absolute -right-8 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-bg-tertiary text-text-muted"
                title="复制"
              >
                {copied ? <Check size={14} className="text-accent-green" /> : <Copy size={14} />}
              </button>
            </div>
          )}

          <div className="mt-1">
            <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" title={formatFullTime(event.timestamp)}>
              {formatTime(event.timestamp)}
            </span>
          </div>
          {/* Thinking block */}
          {event.thinking && (
            <div className="ml-1">
              <button
                onClick={() => setShowThinking(!showThinking)}
                className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors px-2 py-1 rounded-md hover:bg-bg-tertiary"
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
    </div>
  );
}
