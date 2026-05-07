import { useState, useRef, useEffect } from "react";
import { Plus, AlertTriangle, Mic, ArrowUp, Square, Clock } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TimelineEvent } from "@/types/ui";

function genId(): string {
  return Math.random().toString(36).substring(2, 11);
}

export function Composer() {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isRunning = useAppStore((s) => s.isRunning);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const currentSession = useAppStore((s) => s.currentSession);
  const setIsRunning = useAppStore((s) => s.setIsRunning);
  const updateSession = useSessionStore((s) => s.updateSession);
  const addPendingMessage = useSessionStore((s) => s.addPendingMessage);
  const pendingMessages = useSessionStore((s) => s.pendingMessages);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || !currentSession) return;

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // 立即本地添加用户消息
    const userEvent: TimelineEvent = {
      id: genId(),
      type: "user_message",
      timestamp: Date.now(),
      content: trimmed,
    };

    // 如果正在运行，加入排队队列
    if (isRunning) {
      addPendingMessage(trimmed);
      updateSession(currentSession.id, (session) => ({
        ...session,
        events: [...session.events, userEvent],
        updatedAt: Date.now(),
      }));
      return;
    }

    // 立即本地添加用户消息 + 思考中占位符
    const thinkingPlaceholder: TimelineEvent = {
      id: genId(),
      type: "assistant_message",
      timestamp: Date.now(),
      content: "",
      isThinking: true,
      isComplete: false,
    };

    updateSession(currentSession.id, (session) => ({
      ...session,
      events: [...session.events, userEvent, thinkingPlaceholder],
      updatedAt: Date.now(),
    }));

    setIsRunning(true);
    try {
      await window.api.sendPrompt({ sessionId: currentSession.id, content: trimmed });
    } catch (err) {
      console.error("Send failed:", err);
      setIsRunning(false);
    }
  };

  const handleStop = async () => {
    if (!currentSession) return;
    try {
      await window.api.stopTurn({ sessionId: currentSession.id });
    } catch (err) {
      console.error("Stop failed:", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  };

  // Focus input when triggered globally (Cmd/Ctrl+K)
  const focusInputTrigger = useAppStore((s) => s.focusInputTrigger);
  useEffect(() => {
    if (focusInputTrigger > 0) {
      textareaRef.current?.focus();
    }
  }, [focusInputTrigger]);

  const permissionLabel = {
    manual: "手动审批",
    approve_for_session: "本会话允许",
    yolo: "完全访问权限",
  }[permissionMode];

  return (
    <div className="px-4 pb-3">
      {/* Pending messages indicator */}
      {pendingMessages.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 mb-2 text-xs text-text-muted bg-bg-secondary rounded-full w-fit mx-auto">
          <Clock size={12} />
          <span>排队中: {pendingMessages.length} 条消息</span>
        </div>
      )}

      <div className="rounded-2xl border border-border-default bg-bg-composer shadow-sm">
        {/* Input area */}
        <div className="px-4 pt-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={currentSession ? "可向 Kimi 询问任何事。输入 @ 使用插件或提及文件" : "请先选择项目"}
            disabled={!currentSession}
            rows={1}
            className="w-full resize-none bg-transparent text-text-primary placeholder:text-text-muted outline-none text-sm leading-relaxed min-h-[24px] max-h-[200px]"
          />
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 pb-3 pt-1">
          <div className="flex items-center gap-1">
            <button
              disabled={!currentSession}
              className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-secondary disabled:opacity-40 transition-colors"
              title="附件"
            >
              <Plus size={18} />
            </button>
            <button
              disabled={!currentSession}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-bg-tertiary text-accent-orange text-sm disabled:opacity-40 transition-colors"
            >
              <AlertTriangle size={14} />
              <span>{permissionLabel}</span>
            </button>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-xs text-text-muted px-2">kimi-latest</span>
            <button
              disabled={!currentSession}
              className="p-1.5 rounded-lg hover:bg-bg-tertiary text-text-secondary disabled:opacity-40 transition-colors"
              title="语音输入"
            >
              <Mic size={18} />
            </button>
            {isRunning && (
              <button
                onClick={handleStop}
                className="p-2 rounded-full bg-accent-red text-white hover:opacity-90 transition-opacity"
                title="停止"
              >
                <Square size={16} fill="currentColor" />
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={!input.trim() || !currentSession}
              className="p-2 rounded-full bg-accent-blue text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
              title={isRunning ? "排队发送" : "发送"}
            >
              {isRunning ? <Clock size={16} /> : <ArrowUp size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
