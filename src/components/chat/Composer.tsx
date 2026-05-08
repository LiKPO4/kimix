import { useState, useRef, useEffect } from "react";
import { Plus, AlertTriangle, ArrowUp, ChevronDown, Check, Send, Edit2, Trash2, ArrowUpFromLine, ArrowDownFromLine, Mic } from "lucide-react";
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
const iconButtonClass = "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[#8f887e] transition-colors hover:bg-[#f1eee8] hover:text-[#24211d] disabled:cursor-not-allowed disabled:opacity-35";

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
  const updatePendingMessage = useSessionStore((s) => s.updatePendingMessage);
  const removePendingMessage = useSessionStore((s) => s.removePendingMessage);
  const movePendingMessage = useSessionStore((s) => s.movePendingMessage);
  const promotePendingMessage = useSessionStore((s) => s.promotePendingMessage);

  const [showPermissionMenu, setShowPermissionMenu] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [selectedModel, setSelectedModel] = useState("kimi-latest");
  const [isDragging, setIsDragging] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [editingPendingId, setEditingPendingId] = useState<string | null>(null);
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

  const sendPromptContent = async (content: string, options?: { addUserEvent?: boolean }) => {
    if (!currentSession) return;

    const userEvent: TimelineEvent = {
      id: genId(),
      type: "user_message",
      timestamp: Date.now(),
      content,
    };

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
      events: options?.addUserEvent === false
        ? [...session.events, thinkingPlaceholder]
        : [...session.events, userEvent, thinkingPlaceholder],
      updatedAt: Date.now(),
    }));

    setIsRunning(true);
    try {
      await window.api.sendPrompt({ sessionId: currentSession.id, content });
    } catch (err) {
      console.error("Send failed:", err);
      setIsRunning(false);
    }
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || !currentSession) return;

    setInput("");
    setEditingPendingId(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    if (editingPendingId) {
      updatePendingMessage(editingPendingId, trimmed);
      return;
    }

    if (isRunning) {
      addPendingMessage(trimmed);
      return;
    }

    await sendPromptContent(trimmed);
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
      el.style.height = `${Math.min(el.scrollHeight, 156)}px`;
    }
  };

  const focusInputTrigger = useAppStore((s) => s.focusInputTrigger);
  useEffect(() => {
    if (focusInputTrigger > 0) {
      textareaRef.current?.focus();
    }
  }, [focusInputTrigger]);

  const handleSendPendingNow = async (id: string) => {
    const pending = pendingMessages.find((msg) => msg.id === id);
    if (!pending || !currentSession) return;
    if (isRunning) {
      promotePendingMessage(id);
      return;
    }
    removePendingMessage(id);
    await sendPromptContent(pending.content);
  };

  const handleEditPending = (id: string) => {
    const pending = pendingMessages.find((msg) => msg.id === id);
    if (!pending) return;
    setInput(pending.content);
    setEditingPendingId(id);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      handleInput();
    });
  };

  const handleCancelPendingEdit = () => {
    setInput("");
    setEditingPendingId(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const permissionLabel = {
    manual: "手动审批",
    approve_for_session: "本会话允许",
    yolo: "完全访问权限",
  }[permissionMode];

  return (
    <div
      className="relative mx-auto flex w-full max-w-[760px] flex-col px-0 pb-0 pt-3"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {pendingMessages.length > 0 && (
        <div className="mb-1.5 overflow-hidden rounded-[14px] border border-[#ebe7df] bg-white/90 text-[13px] shadow-[0_1px_2px_rgba(25,23,20,0.04)]">
          <div className="flex items-center justify-between px-3 py-1.5 text-[#7c756c]">
            <span>正在排队（{pendingMessages.length} 条）</span>
            {isRunning && <span className="text-[#a09a91]">当前任务结束后继续</span>}
          </div>
          <div className="max-h-32 overflow-y-auto">
            {pendingMessages.map((msg, index) => (
              <div key={msg.id} className="group flex min-w-0 items-center gap-2 border-t border-[#f0ede7] px-2.5 py-1.5 hover:bg-[#faf8f4]">
                <div className="flex shrink-0 items-center text-[#a09a91]">
                  <button
                    onClick={() => movePendingMessage(msg.id, "up")}
                    disabled={index === 0}
                    className="rounded p-1 transition-colors hover:bg-black/5 hover:text-[#24211d] disabled:opacity-25"
                    title="上移"
                    aria-label="上移"
                  >
                    <ArrowUpFromLine size={12} />
                  </button>
                  <button
                    onClick={() => movePendingMessage(msg.id, "down")}
                    disabled={index === pendingMessages.length - 1}
                    className="rounded p-1 transition-colors hover:bg-black/5 hover:text-[#24211d] disabled:opacity-25"
                    title="下移"
                    aria-label="下移"
                  >
                    <ArrowDownFromLine size={12} />
                  </button>
                </div>
                <div className="min-w-0 flex-1 truncate text-[#3a362f]">{msg.content}</div>
                <div className="flex shrink-0 items-center gap-0.5 text-[#8f887e] opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                  <button onClick={() => handleSendPendingNow(msg.id)} className="rounded-lg p-1.5 transition-colors hover:bg-black/5 hover:text-accent-blue" title={isRunning ? "提升到队首" : "立刻发送"}>
                    <Send size={13} />
                  </button>
                  <button onClick={() => handleEditPending(msg.id)} className="rounded-lg p-1.5 transition-colors hover:bg-black/5 hover:text-[#24211d]" title="修改">
                    <Edit2 size={13} />
                  </button>
                  <button onClick={() => removePendingMessage(msg.id)} className="rounded-lg p-1.5 transition-colors hover:bg-accent-red/10 hover:text-accent-red" title="删除">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isDragging && (
        <div className="pointer-events-none absolute inset-x-5 bottom-12 top-2 z-10 flex items-center justify-center rounded-[22px] border border-dashed border-accent-blue bg-accent-blue/5">
          <span className="text-sm font-medium text-accent-blue">释放以添加附件</span>
        </div>
      )}

      <div
        className={`kimix-composer-surface flex min-w-0 flex-col overflow-visible rounded-[22px] border bg-white px-2 py-2 transition-colors ${
          isDragging
            ? "border-accent-blue"
            : isFocused
              ? "border-[#d4cfc5] shadow-[0_0_0_1px_rgba(0,0,0,0.02)]"
              : "border-[#dfdbd2] shadow-[0_1px_2px_rgba(25,23,20,0.06)]"
        } ${!currentSession ? "opacity-60" : ""}`}
      >
        <div className="rounded-[16px] bg-white px-10 pb-2 pt-3 sm:px-12">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={currentSession ? "向 Kimi 询问任何事。输入 @ 使用插件或提及文件" : "请先选择项目"}
            disabled={!currentSession}
            rows={1}
            className="no-focus-outline block max-h-[156px] min-h-[32px] w-full resize-none border-0 bg-transparent px-0 py-0 text-[15px] leading-6 text-[#27231f] shadow-none outline-none ring-0 caret-[#24211d] placeholder:text-[#b8b2a8] focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none disabled:cursor-not-allowed"
          />
        </div>

        <div className="flex h-10 min-w-0 flex-nowrap items-center justify-between gap-3 px-1 pb-0 pt-0 sm:px-1">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {editingPendingId && (
              <button
                onClick={handleCancelPendingEdit}
                className="shrink-0 rounded-xl px-2.5 py-1 text-[13px] text-[#8f887e] transition-colors hover:bg-[#f1eee8] hover:text-[#24211d]"
              >
                取消修改
              </button>
            )}
            <button disabled={!currentSession} className={iconButtonClass} title="附件" aria-label="附件">
              <Plus size={18} />
            </button>

            <div ref={permissionBtnRef} className="relative min-w-0 shrink">
              <button
                disabled={!currentSession}
                onClick={() => setShowPermissionMenu((v) => !v)}
                className="flex h-8 max-w-[170px] min-w-0 items-center gap-1.5 rounded-xl px-2.5 text-[13px] text-[#7c756c] transition-colors hover:bg-[#f1eee8] disabled:cursor-not-allowed disabled:opacity-35"
              >
                <AlertTriangle size={14} className="shrink-0 text-[#d97706]" />
                <span className="truncate">{permissionLabel}</span>
                <ChevronDown size={12} className="shrink-0" />
              </button>
              {showPermissionMenu && (
                <div className="absolute bottom-full left-0 z-20 mb-2 w-56 rounded-xl border border-[#e5e1d8] bg-white py-1 shadow-[0_14px_36px_rgba(25,23,20,0.14)]">
                  {PERMISSION_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setPermissionMode(opt.value);
                        setShowPermissionMenu(false);
                      }}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-[#f3f1ec] ${permissionMode === opt.value ? "text-accent-blue" : "text-[#26231f]"}`}
                    >
                      <span className="min-w-0">
                        <span className="block font-medium">{opt.label}</span>
                        <span className="block truncate text-xs text-[#8f887e]">{opt.desc}</span>
                      </span>
                      {permissionMode === opt.value && <Check size={14} className="shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <div ref={modelBtnRef} className="relative">
              <button
                disabled={!currentSession}
                onClick={() => setShowModelMenu((v) => !v)}
                className="flex h-8 max-w-[136px] items-center gap-1 rounded-xl px-2.5 text-[13px] text-[#7c756c] transition-colors hover:bg-[#f1eee8] hover:text-[#24211d] disabled:cursor-not-allowed disabled:opacity-35"
              >
                <span className="truncate">{selectedModel}</span>
                <ChevronDown size={12} className="shrink-0" />
              </button>
              {showModelMenu && (
                <div className="absolute bottom-full right-0 z-20 mb-2 w-40 rounded-xl border border-[#e5e1d8] bg-white py-1 shadow-[0_14px_36px_rgba(25,23,20,0.14)]">
                  {MODEL_OPTIONS.map((model) => (
                    <button
                      key={model}
                      onClick={() => {
                        setSelectedModel(model);
                        setShowModelMenu(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[#f3f1ec] ${selectedModel === model ? "text-accent-blue" : "text-[#26231f]"}`}
                    >
                      {model}
                      {selectedModel === model && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button disabled={!currentSession} className={iconButtonClass} title="语音" aria-label="语音">
              <Mic size={16} />
            </button>

            {isRunning ? (
              <button
                onClick={handleStop}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#171512] transition-colors hover:bg-black"
                title="停止"
                aria-label="停止"
              >
                <span className="h-2.5 w-2.5 rounded-[2px] bg-white" />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim() || !currentSession}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#8e8a83] text-white transition-colors hover:bg-[#171512] disabled:bg-[#ece9e3] disabled:text-[#aaa49a]"
                title={editingPendingId ? "保存修改" : "发送"}
                aria-label={editingPendingId ? "保存修改" : "发送"}
              >
                <ArrowUp size={17} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 flex w-full items-center justify-start px-4 text-[12px] text-[#8f887e]">
        <div className="flex min-w-0 items-center gap-4">
          <button className="flex items-center gap-1 transition-colors hover:text-[#24211d]">
            <span>本地模式</span>
            <ChevronDown size={11} />
          </button>
          <button className="flex min-w-0 items-center gap-1 transition-colors hover:text-[#24211d]">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
            <span className="truncate">main</span>
            <ChevronDown size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}
