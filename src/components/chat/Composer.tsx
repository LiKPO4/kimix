import { useState, useRef, useEffect } from "react";
import { Plus, AlertTriangle, ArrowUp, ChevronDown, Check, Send, Edit2, Trash2, Mic, Hand, RotateCw, ShieldAlert, Brain, X, GripVertical, MoreHorizontal, AtSign, Slash, FileText, Bot, Puzzle } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TimelineEvent, PermissionMode } from "@/types/ui";
import { ComposerInput, type ComposerInputHandle } from "./ComposerInput";
import { TodoPanel } from "./TodoPanel";

function genId(): string {
  return Math.random().toString(36).substring(2, 11);
}

function hasDraggedFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
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

type CompletionMode = "mention" | "slash";

type CompletionItem = {
  id: string;
  label: string;
  detail?: string;
  insertText: string;
  kind: "agent" | "plugin" | "file" | "slash";
};

const mentionBaseItems: CompletionItem[] = [
  { id: "agent-explorer", label: "Explorer Fast", detail: "快速探索代码库", insertText: "@Explorer Fast ", kind: "agent" },
  { id: "agent-implementer", label: "Implementer Safe", detail: "实现代码", insertText: "@Implementer Safe ", kind: "agent" },
  { id: "agent-reviewer", label: "Reviewer Strict", detail: "代码审查", insertText: "@Reviewer Strict ", kind: "agent" },
  { id: "agent-test-runner", label: "Test Runner", detail: "运行测试", insertText: "@Test Runner ", kind: "agent" },
  { id: "plugin-browser", label: "浏览器", detail: "Control the in-app browser with Codex", insertText: "@浏览器 ", kind: "plugin" },
  { id: "plugin-chrome", label: "Chrome", detail: "Control Chrome with Codex", insertText: "@Chrome ", kind: "plugin" },
];

function getActiveCompletion(value: string): { mode: CompletionMode; query: string; start: number } | null {
  const match = value.match(/(^|\s)([@/])([^\s]*)$/);
  if (!match || match.index === undefined) return null;
  const trigger = match[2];
  const prefixLength = match[1].length;
  return {
    mode: trigger === "@" ? "mention" : "slash",
    query: match[3] ?? "",
    start: match.index + prefixLength,
  };
}

export function Composer() {
  const [input, setInput] = useState("");
  const [imageAttachments, setImageAttachments] = useState<ImageAttachment[]>([]);
  const [previewImage, setPreviewImage] = useState<ImageAttachment | null>(null);
  const [slashCommands, setSlashCommands] = useState<CompletionItem[]>([]);
  const [fileItems, setFileItems] = useState<CompletionItem[]>([]);
  const [activeCompletionIndex, setActiveCompletionIndex] = useState(0);
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
  const removePendingMessage = useSessionStore((s) => s.removePendingMessage);
  const reorderPendingMessage = useSessionStore((s) => s.reorderPendingMessage);

  const [showPermissionMenu, setShowPermissionMenu] = useState(false);
  const [showThinkingMenu, setShowThinkingMenu] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [editingPendingId, setEditingPendingId] = useState<string | null>(null);
  const [draggingPendingId, setDraggingPendingId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!currentSession) {
      setSlashCommands([]);
      return;
    }
    let cancelled = false;
    void window.api.listSlashCommands({ sessionId: currentSession.id }).then((res) => {
      if (cancelled || !res.success) return;
      setSlashCommands(res.data.map((command) => ({
        id: `slash-${command.name}`,
        label: `/${command.name}`,
        detail: command.description,
        insertText: `/${command.name} `,
        kind: "slash",
      })));
    });
    return () => {
      cancelled = true;
    };
  }, [currentSession?.id]);

  const activeCompletion = getActiveCompletion(input);
  const filteredSlashItems = activeCompletion?.mode === "slash"
    ? slashCommands.filter((item) => {
        const query = activeCompletion.query.toLowerCase();
        return item.label.toLowerCase().includes(query) || item.detail?.toLowerCase().includes(query);
      })
    : [];
  const filteredMentionBaseItems = activeCompletion?.mode === "mention"
    ? mentionBaseItems.filter((item) => {
        const query = activeCompletion.query.toLowerCase();
        return item.label.toLowerCase().includes(query) || item.detail?.toLowerCase().includes(query);
      })
    : [];
  const completionItems = activeCompletion?.mode === "slash"
    ? filteredSlashItems
    : activeCompletion?.mode === "mention"
      ? [...filteredMentionBaseItems, ...fileItems]
      : [];

  useEffect(() => {
    setActiveCompletionIndex(0);
  }, [activeCompletion?.mode, activeCompletion?.query]);

  useEffect(() => {
    if (activeCompletion?.mode !== "mention" || !currentProject) {
      setFileItems([]);
      return;
    }
    let cancelled = false;
    const query = activeCompletion.query;
    const timer = window.setTimeout(() => {
      void window.api.searchProjectFiles({
        projectPath: currentProject.path,
        query,
        limit: 12,
      }).then((res) => {
        if (cancelled || !res.success) return;
        setFileItems(res.data.map((file) => ({
          id: `file-${file.path}`,
          label: file.name,
          detail: file.path,
          insertText: `@${file.path} `,
          kind: "file",
        })));
      });
    }, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeCompletion?.mode, activeCompletion?.query, currentProject?.path]);

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
      title: session.title,
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

    if (isCurrentSessionRunning && currentSession) {
      addPendingMessage(trimmed);
      return;
    }
    await sendPromptContent(trimmed, { images: imagesToSend });
  };

  const handleStop = async () => {
    const sessionId = runningSessionId ?? currentSession?.id;
    if (!sessionId) return;
    setRunningSessionId(null);
    try {
      const res = await window.api.stopTurn({ sessionId });
      if (!res.success) {
        console.error("Stop failed:", res.error);
      }
    } catch (err) {
      console.error("Stop failed:", err);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!hasDraggedFiles(e)) return;
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    if (!hasDraggedFiles(e)) return;
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
    if (isCurrentSessionRunning && currentSession) {
      removePendingMessage(id);
      const steerEventId = genId();
      updateSession(currentSession.id, (session) => ({
        ...session,
        events: [
          ...session.events,
          {
            id: steerEventId,
            type: "steer_message",
            timestamp: Date.now(),
            content: pending.content,
            status: "sending",
          },
        ],
        updatedAt: Date.now(),
      }));
      const res = await window.api.steerPrompt({
        sessionId: currentSession.id,
        content: pending.content,
      });
      if (!res.success) {
        console.error("Steer failed:", res.error);
        updateSession(currentSession.id, (session) => ({
          ...session,
          events: session.events.map((event) => event.id === steerEventId
            ? { ...event, status: "failed" as const, error: res.error }
            : event),
          updatedAt: Date.now(),
        }));
        addPendingMessage(pending.content);
      } else {
        updateSession(currentSession.id, (session) => ({
          ...session,
          events: session.events.map((event) => event.id === steerEventId
            ? { ...event, status: "sent" as const }
            : event),
          updatedAt: Date.now(),
        }));
      }
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
    removePendingMessage(id);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleCancelPendingEdit = () => {
    setInput("");
    setEditingPendingId(null);
    inputRef.current?.reset();
  };

  const applyCompletion = (item: CompletionItem) => {
    if (!activeCompletion) return;
    setInput((value) => `${value.slice(0, activeCompletion.start)}${item.insertText}`);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleCompletionKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!activeCompletion || completionItems.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveCompletionIndex((index) => (index + 1) % completionItems.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveCompletionIndex((index) => (index - 1 + completionItems.length) % completionItems.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      applyCompletion(completionItems[activeCompletionIndex] ?? completionItems[0]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setInput((value) => value.slice(0, activeCompletion.start));
    }
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
      {currentSession && <TodoPanel events={currentSession.events} />}

      {pendingMessages.length > 0 && (
        <div className="mb-2 overflow-hidden rounded-[15px] border border-[#e6e1d8] bg-white/95 text-[13px] shadow-[0_3px_12px_rgba(25,23,20,0.05)]">
          <div className="flex h-11 items-center justify-between border-b border-[#eeeae3] text-[14.5px] text-[#7c756c]" style={{ paddingLeft: 20, paddingRight: 22 }}>
            <span className="min-w-0 truncate">{pendingMessages.length} 条消息正在排队</span>
            {isCurrentSessionRunning && <span className="shrink-0 text-[#8f887e]">当前任务结束后继续</span>}
          </div>
          <div className="max-h-40 overflow-y-auto">
            {pendingMessages.map((msg) => (
              <div
                key={msg.id}
                draggable
                onDragStart={(event) => {
                  setDraggingPendingId(msg.id);
                  setIsDragging(false);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", msg.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const dragId = draggingPendingId || event.dataTransfer.getData("text/plain");
                  if (dragId && dragId !== msg.id) reorderPendingMessage(dragId, msg.id);
                }}
                onDragEnd={() => setDraggingPendingId(null)}
                className={`group flex min-h-[42px] min-w-0 items-center gap-2 border-b border-[#f0ede7] last:border-b-0 hover:bg-[#faf8f4] ${
                  draggingPendingId === msg.id ? "bg-[#f4f1eb] opacity-70" : ""
                }`}
                style={{ paddingLeft: 18, paddingRight: 18 }}
              >
                <div className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-lg text-[#aaa49a] active:cursor-grabbing">
                  <GripVertical size={15} />
                </div>
                <div className="min-w-0 flex-1 truncate text-[14px] leading-5 text-[#3a362f]">{msg.content}</div>
                <div className="flex shrink-0 items-center gap-1 text-[#8f887e]">
                  <button onClick={() => handleSendPendingNow(msg.id)} className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[13px] transition-colors hover:bg-black/5 hover:text-[#24211d]" title={isCurrentSessionRunning ? "引导当前任务" : "立即发送"}>
                    <Send size={13} />
                    <span>引导</span>
                  </button>
                  <button onClick={() => handleEditPending(msg.id)} className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-black/5 hover:text-[#24211d]" title="撤回到输入框修改" aria-label="撤回到输入框修改">
                    <Edit2 size={13} />
                  </button>
                  <button onClick={() => removePendingMessage(msg.id)} className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-accent-red/10 hover:text-accent-red" title="删除" aria-label="删除">
                    <Trash2 size={13} />
                  </button>
                  <button className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-black/5 hover:text-[#24211d]" title="更多" aria-label="更多">
                    <MoreHorizontal size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        style={{ paddingLeft: 17, paddingRight: 17, paddingTop: 14, paddingBottom: 10 }}
        className={`kimix-composer-surface relative flex min-w-0 flex-col overflow-visible rounded-[19px] border bg-white transition-colors ${
          isDragging
            ? "border-accent-blue"
            : isFocused
              ? "border-[#d4cfc5] shadow-[0_0_0_1px_rgba(0,0,0,0.02)]"
              : "border-[#dfdbd2] shadow-[0_1px_2px_rgba(25,23,20,0.06)]"
        } ${!canUseComposer ? "opacity-60" : ""}`}
      >
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[19px] border border-dashed border-accent-blue bg-accent-blue/5">
            <span className="text-sm font-medium text-accent-blue">释放以添加附件</span>
          </div>
        )}
        {activeCompletion && (
          <div
            className="mb-3 max-h-[276px] overflow-y-auto rounded-[16px] border border-[#ebe6dd] bg-white/95 text-[14px] shadow-[0_16px_42px_rgba(25,23,20,0.12)]"
            style={{ padding: 10 }}
            onMouseDown={(event) => event.preventDefault()}
          >
            {activeCompletion.mode === "mention" ? (
              <>
                <div className="px-2 pb-1.5 text-[13px] text-[#9a948b]">智能体</div>
                {filteredMentionBaseItems.filter((item) => item.kind === "agent").map((item) => {
                  const index = completionItems.findIndex((candidate) => candidate.id === item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => applyCompletion(item)}
                      className={`flex h-9 w-full items-center gap-2.5 rounded-xl text-left transition-colors ${activeCompletionIndex === index ? "bg-black/5 text-[#24211d]" : "text-[#4b4640] hover:bg-black/5"}`}
                      style={{ paddingLeft: 10, paddingRight: 12 }}
                    >
                      <Bot size={15} className="shrink-0 text-[#7d7972]" />
                      <span className="shrink-0">{item.label}</span>
                      {item.detail && <span className="min-w-0 truncate text-[#aaa49a]">{item.detail}</span>}
                    </button>
                  );
                })}
                <div className="px-2 pb-1.5 pt-2 text-[13px] text-[#9a948b]">插件</div>
                {filteredMentionBaseItems.filter((item) => item.kind === "plugin").map((item) => {
                  const index = completionItems.findIndex((candidate) => candidate.id === item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => applyCompletion(item)}
                      className={`flex h-9 w-full items-center gap-2.5 rounded-xl text-left transition-colors ${activeCompletionIndex === index ? "bg-black/5 text-[#24211d]" : "text-[#4b4640] hover:bg-black/5"}`}
                      style={{ paddingLeft: 10, paddingRight: 12 }}
                    >
                      <Puzzle size={15} className="shrink-0 text-[#7d7972]" />
                      <span className="shrink-0">{item.label}</span>
                      {item.detail && <span className="min-w-0 truncate text-[#aaa49a]">{item.detail}</span>}
                    </button>
                  );
                })}
                <div className="px-2 pb-1.5 pt-2 text-[13px] text-[#9a948b]">文件</div>
                {fileItems.length > 0 ? fileItems.map((item) => {
                  const index = completionItems.findIndex((candidate) => candidate.id === item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => applyCompletion(item)}
                      className={`flex h-9 w-full items-center gap-2.5 rounded-xl text-left transition-colors ${activeCompletionIndex === index ? "bg-black/5 text-[#24211d]" : "text-[#4b4640] hover:bg-black/5"}`}
                      style={{ paddingLeft: 10, paddingRight: 12 }}
                    >
                      <FileText size={15} className="shrink-0 text-[#7d7972]" />
                      <span className="min-w-0 flex-1 truncate">{item.detail}</span>
                    </button>
                  );
                }) : (
                  <div className="px-2 py-1.5 text-[#aaa49a]">输入内容搜索文件</div>
                )}
              </>
            ) : (
              <>
                <div className="px-2 pb-1.5 text-[13px] text-[#9a948b]">命令</div>
                {completionItems.length > 0 ? completionItems.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => applyCompletion(item)}
                    className={`flex h-9 w-full items-center gap-2.5 rounded-xl text-left transition-colors ${activeCompletionIndex === index ? "bg-black/5 text-[#24211d]" : "text-[#4b4640] hover:bg-black/5"}`}
                    style={{ paddingLeft: 10, paddingRight: 12 }}
                  >
                    <Slash size={15} className="shrink-0 text-[#7d7972]" />
                    <span className="shrink-0">{item.label}</span>
                    {item.detail && <span className="min-w-0 truncate text-[#aaa49a]">{item.detail}</span>}
                  </button>
                )) : (
                  <div className="flex items-center gap-2 px-2 py-1.5 text-[#aaa49a]">
                    <AtSign size={14} />
                    <span>正在从 Kimi 加载命令，或当前会话未返回 slash_commands</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {imageAttachments.length > 0 && (
          <div className="flex flex-wrap" style={{ gap: 10, paddingTop: 2, paddingBottom: 12 }}>
            {imageAttachments.map((image) => (
              <button
                key={image.id}
                type="button"
                onClick={() => setPreviewImage(image)}
                className="group relative h-20 w-20 overflow-hidden rounded-xl border border-[#ded8cf] bg-[#f7f5f1] text-left shadow-[0_1px_2px_rgba(25,23,20,0.05)] transition-colors hover:border-[#cfc8bc]"
                title="点击查看图片"
                aria-label={`查看图片 ${image.name}`}
              >
                <img src={image.dataUrl} alt={image.name} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setImageAttachments((prev) => prev.filter((item) => item.id !== image.id));
                    if (previewImage?.id === image.id) setPreviewImage(null);
                  }}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-white opacity-95 transition-colors hover:bg-black"
                  title="移除图片"
                  aria-label="移除图片"
                >
                  <X size={13} />
                </button>
              </button>
            ))}
          </div>
        )}

        <ComposerInput
          ref={inputRef}
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onPaste={handlePaste}
          onKeyDownCapture={handleCompletionKeyDown}
          placeholder={placeholder}
          disabled={!canUseComposer}
        />

        <div className="mt-2 flex h-9 min-w-0 flex-nowrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-1" style={{ marginLeft: -6 }}>
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

      {previewImage && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/72"
          onClick={() => setPreviewImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
        >
          <div className="absolute right-6 top-6 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#24211d] shadow-[0_8px_24px_rgba(0,0,0,0.22)] transition-colors hover:bg-[#f3f1ec]"
              title="关闭"
              aria-label="关闭图片预览"
            >
              <X size={20} />
            </button>
          </div>
          <img
            src={previewImage.dataUrl}
            alt={previewImage.name}
            className="max-h-[82vh] max-w-[86vw] rounded-xl bg-white object-contain shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
