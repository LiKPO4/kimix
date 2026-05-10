import { useState, useRef, useEffect } from "react";
import { ChevronDown, ChevronUp, Copy, Check, RotateCcw } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TimelineEvent } from "@/types/ui";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface MessageBubbleProps {
  event: Extract<TimelineEvent, { type: "user_message" | "steer_message" | "assistant_message" }>;
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

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function useElapsed(start: number, active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return Math.max(0, now - start);
}

function UserMessageBubble({ event }: { event: Extract<TimelineEvent, { type: "user_message" }> }) {
  const { copied, trigger } = useCopyTimeout();
  const currentSession = useAppStore((s) => s.currentSession);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const updateSession = useSessionStore((s) => s.updateSession);

  const handleResend = async () => {
    if (!currentSession || runningSessionId === currentSession.id) return;
    const responsePlaceholder: TimelineEvent = {
      id: Math.random().toString(36).substring(2, 11),
      type: "assistant_message",
      timestamp: Date.now(),
      content: "",
      isThinking: defaultThinking,
      isComplete: false,
    };
    updateSession(currentSession.id, (session) => ({
      ...session,
      events: [...session.events, responsePlaceholder],
      updatedAt: Date.now(),
    }));
    setRunningSessionId(currentSession.id);
    try {
      await window.api.sendPrompt({
        sessionId: currentSession.id,
        content: event.content,
        thinking: defaultThinking,
        yoloMode: permissionMode === "yolo",
      });
    } catch (err) {
      console.error("Resend failed:", err);
      setRunningSessionId(null);
    }
  };

  return (
    <div className="group flex justify-end">
      <div className="max-w-[58%]">
        <div
          style={{ minWidth: 64, paddingLeft: 15, paddingRight: 15, paddingTop: 8, paddingBottom: 8 }}
          className="rounded-[16px] bg-[#f3f3f3] text-[14.5px] leading-[1.45] text-[#24211d] shadow-[0_1px_0_rgba(25,23,20,0.02)]"
        >
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
            disabled={currentSession ? runningSessionId === currentSession.id : false}
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

function SteerMessageBubble({ event }: { event: Extract<TimelineEvent, { type: "steer_message" }> }) {
  const label = event.status === "sending"
    ? "正在引导对话"
    : event.status === "failed"
      ? "引导失败"
      : "已引导对话";

  return (
    <div className="group w-full">
      <div
        className={`text-[15px] leading-7 ${event.status === "failed" ? "text-accent-red" : "text-[#8a847a]"}`}
        style={{ paddingTop: 2, paddingBottom: 12 }}
      >
        {label}
      </div>
      <div className="flex justify-end">
        <div className="max-w-[58%]">
          <div className="mb-1 flex justify-end">
            <span className={`text-[13px] leading-5 ${event.status === "failed" ? "text-accent-red" : "text-[#8a847a]"}`}>
              {label}
            </span>
          </div>
          <div
            style={{ minWidth: 64, paddingLeft: 15, paddingRight: 15, paddingTop: 8, paddingBottom: 8 }}
            className="rounded-[16px] bg-[#f3f3f3] text-[14.5px] leading-[1.45] text-[#24211d] shadow-[0_1px_0_rgba(25,23,20,0.02)]"
          >
            {event.content}
          </div>
          {event.error && <div className="mt-1 text-right text-[12.5px] text-accent-red">{event.error}</div>}
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
  const elapsed = useElapsed(event.timestamp, event.isThinking && !event.isComplete);
  const durationLabel = event.isComplete
    ? formatDuration(event.durationMs ?? elapsed)
    : formatDuration(elapsed);

  return (
    <div className="group flex justify-start">
      <div className="w-full" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {(event.isThinking || event.isComplete || !hasContent) && (
          <div
            className="border-b border-[#ece8df] text-[15px] leading-7 text-[#8a847a]"
            style={{ paddingTop: 2, paddingBottom: 14 }}
          >
            {event.isComplete
              ? `已处理 ${durationLabel}`
              : event.isThinking
                ? `正在思考 ${durationLabel}`
                : `已处理 ${durationLabel}`}
          </div>
        )}

        {hasThinking && (
          <div>
            <button
              onClick={() => setShowThinking(!showThinking)}
              className="flex h-8 items-center rounded-lg text-[14.5px] leading-none text-[#8a847a] transition-colors hover:bg-[#f3f1ec] hover:text-[#625d55]"
              style={{ gap: 7, paddingLeft: 4, paddingRight: 10 }}
            >
              {showThinking ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              <span>{showThinking ? "收起思考" : "显示思考"}</span>
            </button>
            {showThinking && (
              <div
                className="mt-3 rounded-xl border border-[#e5e1d8] bg-[#faf8f4] text-[15px] text-[#706b63]"
                style={{ paddingLeft: 36, paddingRight: 36, paddingTop: 24, paddingBottom: 24 }}
              >
                <pre className="min-w-0 whitespace-pre-wrap break-words font-mono leading-8">{event.thinking}</pre>
              </div>
            )}
          </div>
        )}

        {hasContent && (
          <div className="relative w-full text-[15px] leading-[1.68] text-[#24211d]">
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
  if (event.type === "steer_message") {
    return <SteerMessageBubble event={event} />;
  }
  return <AssistantMessageBubble event={event} />;
}
