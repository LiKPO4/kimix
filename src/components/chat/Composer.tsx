import { useState, useRef, useEffect } from "react";
import { Plus, AlertTriangle, ArrowUp, ChevronDown, Check, Send, Edit2, Trash2, ArrowUpFromLine, ArrowDownFromLine, Mic, Hand, RotateCw, ShieldAlert, Brain, X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TimelineEvent, PermissionMode } from "@/types/ui";
import { ComposerInput, type ComposerInputHandle } from "./ComposerInput";

function genId(): string {
  return Math.random().toString(36).substring(2, 11);
}

const PERMISSION_OPTIONS: { value: PermissionMode; label: string; desc: string }[] = [
  { value: "manual", label: "手动审批", desc: "每次操作都需要确认" },
  { value: "approve_for_session", label: "本会话允许", desc: "当前会话内自动允许" },
  { value: "yolo", label: "完全访问权限", desc: "无需确认，直接执行" },
];

const permissionMenuIcons = {
  manual: Hand,
  approve_for_session: RotateCw,
  yolo: ShieldAlert,
};

const THINKING_OPTIONS = [
  { value: true, label: "思考开启" },
  { value: false, label: "思考关闭" },
];

const iconButtonClass =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[#8f887e] transition-colors hover:bg-[#f1eee8] hover:text-[#24211d] disabled:cursor-not-allowed disabled:opacity-35";

type ImageAttachment = {
  id: string;
  name: string;
  dataUrl: string;
};

export function Composer() {
  const [input, setInput] = useState("");
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>([]);
  const inputRef = useRef<ComposerInputHandle>(null);

  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const currentProject = useAppStore((s) => s.currentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const setDefaultThinking = useAppStore((s) => s.setDefaultThinking);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const focusInputTrigger = useAppStore((s) => s.focusInputTrigger);

  const updateSession = useSessionStore((s) => s.updateSession);
  const addSession = useSessionStore((s) => s.addSession);
  const addPendingMessage = useSessionStore((s) => s.addPendingMessage);
  const pendingMessages = useSessionStore((s) => s.pendingMessages);
  const updatePendingMessage = useSessionStore((s) => s.updatePendingMessage);
  const removePendingMessage = useSessionStore((s) => s.removePendingMessage);
  const movePendingMessage = useSessionStore((s) => s.movePendingMessage);
  const promotePendingMessage = useSessionStore((s) => s.promotePendingMessage);

  const [showPermissionMenu, setShowPermissionMenu] = useState(false);
  const [showThinkingMenu, setShowThinkingMenu] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [editingPendingId, setEditingPendingId] = useState<string | null>(null);

  const permissionBtnRef = useRef<HTMLDivElement>(null);
  const thinkingBtnRef = useRef<HTMLDivElement>(null);
  const isCurrentSessionRunning = Boolean(currentSession && runningSessionId === currentSession.id);
  const canUseComposer = Boolean(currentSession || currentProject);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (permissionBtnRef.current && !permissionBtnRef.current.contains(e.target as Node)) {
        setShowPermissionMenu(false);
      }
      if (thinkingBtnRef.current && !thinkingBtnRef.current.contains(e.target as Node)) {
        setShowThinkingMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (focusInputTrigger > 0) inputRef.current?.focus();
  }, [focusInputTrigger]);

  const addImageFiles = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const attachments = await Promise.all(
      imageFiles.map((file) => new Promise<ImageAttachment>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({
          id: genId(),
          name: file.name || "粘贴图片",
          dataUrl: String(reader.result),
        });
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      })),
    );
    setImageAttachments((prev) => [...prev, ...attachments]);
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    event.preventDefault();
    void addImageFiles(files);
  };

  const ensureSession = async () => {
    if (currentSession) return currentSession;
    if (!currentProject) return null;
    const sessionRes = await window.api.startSession({
      workDir: currentProject.path,
      model: "kimi-code/kimi-for-coding",
      thinking: defaultThinking,
      yoloMode: permissionMode === "yolo",
    });
    if (!sessionRes.success) return null;
    const session = {
      id: sessionRes.data.sessionId,
      title: "新会话",
      projectPath: currentProject.path,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      events: [],
      isLoading: false,
    };
    addSession(session);
    setCurrentSession(session);
    return session;
  };

  const sendPromptContent = async (content: string, options?: { addUserEvent?: boolean; images?: ImageAttachment[] }) => {
    const targetSession = await ensureSession();
    if (!targetSession) return;
    const images = options?.images ?? [];
    const imageLabel = images.length > 0
      ? `${content ? "\n" : ""}${images.map((image) => `[图片: ${image.name}]`).join("\n")}`
      : "";

    const userEvent: TimelineEvent = {
      id: genId(),
      type: "user_message",
      timestamp: Date.now(),
      content: content + imageLabel,
    };
    const responsePlaceholder: TimelineEvent = {
      id: genId(),
      type: "assistant_message",
      timestamp: Date.now(),
      content: "",
      isThinking: defaultThinking,
      isComplete: false,
    };

    updateSession(targetSession.id, (session) => ({
      ...session,
      events: [
        ...session.events,
        ...(options?.addUserEvent === false ? [] : [userEvent]),
        responsePlaceholder,
      ],
      title: session.title === "新会话" ? content.slice(0, 30) + (content.length > 30 ? "..." : "") : session.title,
      updatedAt: Date.now(),
    }));

    setRunningSessionId(targetSession.id);
    try {
      await window.api.sendPrompt({
        sessionId: targetSession.id,
        content,
        images: images.map((image) => ({ name: image.name, dataUrl: image.dataUrl })),
        thinking: defaultThinking,
        yoloMode: permissionMode === "yolo",
      });
    } catch (err) {
      console.error("Send failed:", err);
      setRunningSessionId(null);
    }
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    const imagesToSend = imageAttachments;
    if ((!trimmed && imagesToSend.length === 0) || !canUseComposer) return;

    setInput("");
    setImageAttachments([]);
    setEditingPendingId(null);
    inputRef.current?.reset();

    if (editingPendingId) {
      updatePendingMessage(editingPendingId, trimmed);
      return;
    }
    if (isCurrentSessionRunning) {
      addPendingMessage(trimmed);
      return;
    }
    await sendPromptContent(trimmed, { images: imagesToSend });
  };

  const handleStop = async () => {
    if (!currentSession) return;
    try {
      await window.api.stopTurn({ sessionId: currentSession.id });
    } catch (err) {
      console.error("Stop failed:", err);
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
    if (files.length > 0 && canUseComposer) {
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));
      const otherFiles = files.filter((file) => !file.type.startsWith("image/"));
      if (imageFiles.length > 0) {
        void addImageFiles(imageFiles);
      }
      if (otherFiles.length === 0) return;
      const paths = otherFiles
        .map((f) => {
          const p = typeof (f as { path?: unknown }).path === "string" ? (f as { path: string }).path : f.name;
          return p;
        })
        .join(", ");
      setInput((prev) => (prev ? prev + "\n" : "") + `[附件: ${paths}]`);
    }
  };

  const handleSendPendingNow = async (id: string) => {
    const pending = pendingMessages.find((msg) => msg.id === id);
    if (!pending || !canUseComposer) return;
    if (isCurrentSessionRunning) {
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
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleCancelPendingEdit = () => {
    setInput("");
    setEditingPendingId(null);
    inputRef.current?.reset();
  };

  const permissionLabel = {
    manual: "手动审批",
    approve_for_session: "本会话允许",
    yolo: "完全访问权限",
  }[permissionMode];

  const placeholder = canUseComposer
    ? "向 Kimi 询问任何事。输入 @ 使用插件或提及文件"
    : "请先选择项目";

  return (
    <div
      className="relative flex w-full flex-col"
      style={{ paddingTop: 8 }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {pendingMessages.length > 0 && (
        <div className="mb-1.5 overflow-hidden rounded-[14px] border border-[#ebe7df] bg-white/90 text-[13px] shadow-[0_1px_2px_rgba(25,23,20,0.04)]">
          <div className="flex items-center justify-between px-3 py-1.5 text-[#7c756c]">
            <span>正在排队（{pendingMessages.length} 条）</span>
            {isCurrentSessionRunning && <span className="text-[#a09a91]">当前任务结束后继续</span>}
          </div>
          <div className="max-h-32 overflow-y-auto">
            {pendingMessages.map((msg, index) => (
              <div key={msg.id} className="group flex min-w-0 items-center gap-2 border-t border-[#f0ede7] px-2.5 py-1.5 hover:bg-[#faf8f4]">
                <div className="flex shrink-0 items-center text-[#a09a91]">
                  <button onClick={() => movePendingMessage(msg.id, "up")} disabled={index === 0} className="rounded p-1 transition-colors hover:bg-black/5 hover:text-[#24211d] disabled:opacity-25" title="上移" aria-label="上移">
                    <ArrowUpFromLine size={12} />
                  </button>
                  <button onClick={() => movePendingMessage(msg.id, "down")} disabled={index === pendingMessages.length - 1} className="rounded p-1 transition-colors hover:bg-black/5 hover:text-[#24211d] disabled:opacity-25" title="下移" aria-label="下移">
                    <ArrowDownFromLine size={12} />
                  </button>
                </div>
                <div className="min-w-0 flex-1 truncate text-[#3a362f]">{msg.content}</div>
                <div className="flex shrink-0 items-center gap-0.5 text-[#8f887e] opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                  <button onClick={() => handleSendPendingNow(msg.id)} className="rounded-lg p-1.5 transition-colors hover:bg-black/5 hover:text-accent-blue" title={isCurrentSessionRunning ? "提升到队首" : "立即发送"}>
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
        style={{ paddingLeft: 17, paddingRight: 17, paddingTop: 11, paddingBottom: 8 }}
        className={`kimix-composer-surface flex min-w-0 flex-col overflow-visible rounded-[19px] border bg-white transition-colors ${
          isDragging
            ? "border-accent-blue"
            : isFocused
              ? "border-[#d4cfc5] shadow-[0_0_0_1px_rgba(0,0,0,0.02)]"
              : "border-[#dfdbd2] shadow-[0_1px_2px_rgba(25,23,20,0.06)]"
        } ${!canUseComposer ? "opacity-60" : ""}`}
      >
        <ComposerInput
          ref={inputRef}
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onPaste={handlePaste}
          placeholder={placeholder}
          disabled={!canUseComposer}
        />

        {imageAttachments.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {imageAttachments.map((image) => (
              <div key={image.id} className="group relative h-16 w-16 overflow-hidden rounded-xl border border-[#e5e1d8] bg-[#f7f5f1]">
                <img src={image.dataUrl} alt={image.name} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => setImageAttachments((prev) => prev.filter((item) => item.id !== image.id))}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-90 transition-opacity hover:opacity-100"
                  title="移除图片"
                  aria-label="移除图片"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-2 flex h-9 min-w-0 flex-nowrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {editingPendingId && (
              <button onClick={handleCancelPendingEdit} className="shrink-0 rounded-xl px-2.5 py-1 text-[13px] text-[#8f887e] transition-colors hover:bg-[#f1eee8] hover:text-[#24211d]">
                取消修改
              </button>
            )}
            <button disabled={!canUseComposer} className={iconButtonClass} title="附件" aria-label="附件">
              <Plus size={18} />
            </button>

            <div ref={permissionBtnRef} className="relative min-w-0 shrink">
              <button disabled={!canUseComposer} onClick={() => setShowPermissionMenu((v) => !v)} className="flex h-8 max-w-[170px] min-w-0 items-center gap-1.5 rounded-xl px-2.5 text-[13px] text-[#7c756c] transition-colors hover:bg-[#f1eee8] disabled:cursor-not-allowed disabled:opacity-35">
                <AlertTriangle size={14} className="shrink-0 text-[#d97706]" />
                <span className="truncate">{permissionLabel}</span>
                <ChevronDown size={12} className="shrink-0" />
              </button>
              {showPermissionMenu && (
                <div className="absolute bottom-full left-0 z-30 mb-2 w-[216px] rounded-xl border border-[#e5e1d8] bg-white py-2.5 shadow-[0_14px_34px_rgba(25,23,20,0.14)]">
                  {PERMISSION_OPTIONS.map((opt) => {
                    const Icon = permissionMenuIcons[opt.value];
                    return (
                      <button key={opt.value} onClick={() => { setPermissionMode(opt.value); setShowPermissionMenu(false); }} style={{ paddingLeft: 18, paddingRight: 18, paddingTop: 12, paddingBottom: 12 }} className={`flex w-full items-center gap-3.5 text-left text-[13px] leading-none hover:bg-[#f3f1ec] ${permissionMode === opt.value ? "text-[#24211d]" : "text-[#26231f]"}`}>
                        <Icon size={13} className="shrink-0 text-[#7c756c]" />
                        <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                        {permissionMode === opt.value && <Check size={13} className="mr-1 shrink-0 text-[#24211d]" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <div ref={thinkingBtnRef} className="relative">
              <button disabled={!canUseComposer} onClick={() => setShowThinkingMenu((v) => !v)} className="flex h-8 min-w-[112px] items-center justify-center gap-2 rounded-xl px-2.5 text-[13px] text-[#625d55] transition-colors hover:bg-[#f1eee8] hover:text-[#24211d] disabled:cursor-not-allowed disabled:opacity-35">
                <Brain size={14} className="shrink-0" />
                <span>{defaultThinking ? "思考开启" : "思考关闭"}</span>
                <ChevronDown size={12} className="shrink-0" />
              </button>
              {showThinkingMenu && (
                <div className="absolute bottom-full right-0 z-20 mb-2 w-[188px] rounded-xl border border-[#e5e1d8] bg-white py-2.5 shadow-[0_14px_36px_rgba(25,23,20,0.14)]">
                  {THINKING_OPTIONS.map((option) => (
                    <button key={String(option.value)} onClick={() => { setDefaultThinking(option.value); setShowThinkingMenu(false); }} style={{ paddingLeft: 18, paddingRight: 18, paddingTop: 12, paddingBottom: 12 }} className={`flex w-full items-center justify-between gap-4 text-left text-[14px] leading-none hover:bg-[#f3f1ec] ${defaultThinking === option.value ? "text-accent-blue" : "text-[#26231f]"}`}>
                      {option.label}
                      {defaultThinking === option.value && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button disabled={!canUseComposer} className={iconButtonClass} title="语音" aria-label="语音">
              <Mic size={16} />
            </button>

            {isCurrentSessionRunning ? (
              <button onClick={handleStop} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#171512] transition-colors hover:bg-black" title="停止" aria-label="停止">
                <span className="h-2.5 w-2.5 rounded-[2px] bg-white" />
              </button>
            ) : (
              <button onClick={handleSend} disabled={(!input.trim() && imageAttachments.length === 0) || !canUseComposer} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#9bd8ff] text-white transition-colors hover:bg-[#72c7ff] disabled:bg-[#ece9e3] disabled:text-[#aaa49a]" title={editingPendingId ? "保存修改" : "发送"} aria-label={editingPendingId ? "保存修改" : "发送"}>
                <ArrowUp size={17} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
