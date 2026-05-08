import { useState, useRef, useEffect } from "react";
import { Plus, AlertTriangle, Mic, ArrowUp, Square, Clock, ChevronDown, Check } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TimelineEvent, PermissionMode } from "@/types/ui";

function genId(): string {
  return Math.random().toString(36).substring(2, 11);
}

const PERMISSION_OPTIONS: { value: PermissionMode; label: string; desc: string }[] = [
  { value: "manual", label: "手动审批", desc: "每次操作都需要确认" },
  { value: "approve_for_session", label: "本会话允许", desc: "当前会话内自动允许" },
  { value: "yolo", label: "完全访问权限", desc: "无需确认，直接执行" },
];

const MODEL_OPTIONS = ["kimi-latest"];

export function Composer() {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isRunning = useAppStore((s) => s.isRunning);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const currentSession = useAppStore((s) => s.currentSession);
  const setIsRunning = useAppStore((s) => s.setIsRunning);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const updateSession = useSessionStore((s) => s.updateSession);
  const addPendingMessage = useSessionStore((s) => s.addPendingMessage);
  const pendingMessages = useSessionStore((s) => s.pendingMessages);

  const [showPermissionMenu, setShowPermissionMenu] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [selectedModel, setSelectedModel] = useState("kimi-latest");
  const permissionBtnRef = useRef<HTMLDivElement>(null);
  const modelBtnRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (permissionBtnRef.current && !permissionBtnRef.current.contains(e.target as Node)) {
        setShowPermissionMenu(false);
      }
      if (modelBtnRef.current && !modelBtnRef.current.contains(e.target as Node)) {
        setShowModelMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || !currentSession) return;

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const userEvent: TimelineEvent = {
      id: genId(),
      type: "user_message",
      timestamp: Date.now(),
      content: trimmed,
    };

    if (isRunning) {
      addPendingMessage(trimmed);
      updateSession(currentSession.id, (session) => ({
        ...session,
        events: [...session.events, userEvent],
        updatedAt: Date.now(),
      }));
      return;
    }

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

  const [isDragging, setIsDragging] = useState(false);
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && currentSession) {
      const paths = files.map((f) => {
        const path = typeof (f as { path?: unknown }).path === "string" ? (f as { path: string }).path : f.name;
        return path;
      }).join(", ");
      setInput((prev) => (prev ? prev + "\n" : "") + `[附件: ${paths}]`);
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  };

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
    <div className="px-4 pb-4 pt-2 relative" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {pendingMessages.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1 mb-2 text-xs text-text-muted bg-bg-secondary rounded-full w-fit mx-auto">
          <Clock size={12} />
          <span>排队中: {pendingMessages.length} 条消息</span>
        </div>
      )}

      {isDragging && (
        <div className="absolute inset-x-4 bottom-4 top-2 rounded-[24px] border-2 border-dashed border-accent-blue bg-accent-blue/5 flex items-center justify-center z-10 pointer-events-none">
          <span className="text-sm text-accent-blue font-medium">释放以添加附件</span>
        </div>
      )}

      <div className={`rounded-[24px] border bg-bg-composer shadow-[0_2px_12px_rgba(0,0,0,0.06)] transition-colors ${isDragging ? "border-accent-blue" : "border-border-default"} ${!currentSession ? "opacity-60" : ""}`}>
        {/* Input */}
        <div className="px-5 pt-4 pb-1">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={currentSession ? "可向 Kimi 询问任何事。输入 @ 使用插件或提及文件" : "请先选择项目"}
            disabled={!currentSession}
            rows={1}
            className="w-full resize-none bg-transparent text-text-primary placeholder:text-text-muted outline-none text-[15px] leading-relaxed min-h-[24px] max-h-[200px]"
          />
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
          <div className="flex items-center gap-1">
            <button
              disabled={!currentSession}
              className="p-2 rounded-xl hover:bg-bg-hover text-text-secondary disabled:opacity-30 transition-colors"
              title="附件"
              aria-label="附件"
            >
              <Plus size={18} />
            </button>
            <div ref={permissionBtnRef} className="relative">
              <button
                disabled={!currentSession}
                onClick={() => setShowPermissionMenu((v) => !v)}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl hover:bg-bg-hover text-accent-orange text-sm disabled:opacity-30 transition-colors"
              >
                <AlertTriangle size={13} />
                <span className="flex items-center gap-0.5">
                  {permissionLabel}
                  <ChevronDown size={12} />
                </span>
              </button>
              {showPermissionMenu && (
                <div className="absolute bottom-full left-0 mb-1.5 w-52 rounded-xl border border-border-default bg-bg-elevated shadow-lg py-1 z-20">
                  {PERMISSION_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setPermissionMode(opt.value);
                        setShowPermissionMenu(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-bg-hover flex items-center justify-between ${permissionMode === opt.value ? "text-accent-blue" : "text-text-primary"}`}
                    >
                      <div>
                        <div className="font-medium">{opt.label}</div>
                        <div className="text-xs text-text-muted">{opt.desc}</div>
                      </div>
                      {permissionMode === opt.value && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-0.5">
            <div ref={modelBtnRef} className="relative">
              <button
                disabled={!currentSession}
                onClick={() => setShowModelMenu((v) => !v)}
                className="flex items-center gap-1 px-2 py-1.5 rounded-xl hover:bg-bg-hover text-text-muted text-sm disabled:opacity-30 transition-colors"
              >
                <span>{selectedModel}</span>
                <ChevronDown size={12} />
              </button>
              {showModelMenu && (
                <div className="absolute bottom-full right-0 mb-1.5 w-40 rounded-xl border border-border-default bg-bg-elevated shadow-lg py-1 z-20">
                  {MODEL_OPTIONS.map((model) => (
                    <button
                      key={model}
                      onClick={() => {
                        setSelectedModel(model);
                        setShowModelMenu(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-bg-hover flex items-center justify-between ${selectedModel === model ? "text-accent-blue" : "text-text-primary"}`}
                    >
                      {model}
                      {selectedModel === model && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              disabled={!currentSession}
              className="p-2 rounded-xl hover:bg-bg-hover text-text-secondary disabled:opacity-30 transition-colors"
              title="语音输入"
              aria-label="语音输入"
            >
              <Mic size={18} />
            </button>
            {isRunning ? (
              <button
                onClick={handleStop}
                className="p-2.5 rounded-full bg-bg-tertiary text-text-secondary hover:bg-accent-red hover:text-white transition-colors"
                title="停止"
                aria-label="停止"
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim() || !currentSession}
                className="p-2.5 rounded-full bg-bg-tertiary text-text-secondary hover:bg-text-primary hover:text-white disabled:opacity-30 transition-colors"
                title="发送"
                aria-label="发送"
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
