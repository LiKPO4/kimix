import { useState, useRef, useEffect } from "react";
import { Plus, AlertTriangle, ArrowUp, ChevronDown, Check, Send, Edit2, Trash2, Mic, Hand, ShieldAlert, Brain, X, GripVertical, MoreHorizontal, AtSign, TerminalSquare, FileText, Bot, Puzzle, CircleHelp, ClipboardList, Palette, Lock, Zap } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useLiveSession } from "@/hooks/useLiveSession";
import type { TimelineEvent, PermissionMode, ClarificationToolMode } from "@/types/ui";
import { ComposerInput, type ComposerInputHandle } from "./ComposerInput";
import { TodoPanel, getVisibleTodos } from "./TodoPanel";
import { ContextRing } from "./ContextRing";
import { DrawingBoard, type DrawingBoardRequest } from "./DrawingBoard";
import { ImagePreviewOverlay } from "./ImagePreviewOverlay";
import { getRuntimeSessionId } from "@/utils/runtimeSession";

function genId(): string {
  return Math.random().toString(36).substring(2, 11);
}

function hasDraggedFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

const PERMISSION_OPTIONS: { value: PermissionMode; label: string; desc: string; tooltip: string }[] = [
  { value: "manual", label: "手动审批", desc: "每次操作都需要确认", tooltip: "手动审批：每次工具调用都会停下来等你确认，适合高风险修改。" },
  { value: "auto", label: "自动权限", desc: "自动处理审批", tooltip: "自动权限：使用官方 auto 权限模式，自动处理工具审批，且 Agent 不再向用户提问。" },
  { value: "yolo", label: "完全访问权限", desc: "无需确认，直接执行", tooltip: "完全访问权限：自动批准所有工具请求，适合可信任务，请谨慎开启。" },
];

const permissionMenuIcons = {
  manual: Hand,
  auto: Brain,
  yolo: ShieldAlert,
};

const CLARIFICATION_OPTIONS: { value: ClarificationToolMode; label: string; desc: string }[] = [
  { value: "on", label: "开启", desc: "优先澄清不明确需求" },
  { value: "off", label: "关闭", desc: "直接发送原消息" },
  { value: "auto", label: "自动", desc: "由 AI 判断是否需要澄清" },
];

const DRAWING_BOARD_RATIOS: DrawingBoardRequest["ratio"][] = ["1:1", "4:3", "3:4", "16:9", "9:16"];

const CLARIFICATION_PROMPTS: Record<Exclude<ClarificationToolMode, "off">, string> = {
  auto: "【Kimix 需求澄清工具：自动判断】\n请先判断用户需求是否足够明确。若当前官方 Kimi Code 运行模式支持向用户提问，且系统/权限规则没有禁止提问，可以使用官方 AskUserQuestion 结构化提问能力提出 1-3 个简短问题；若当前处于 prompt/auto 等禁止向用户提问的模式，请不要调用 AskUserQuestion，也不要解释本规则，按官方要求做合理判断并继续。",
  on: "【Kimix 需求澄清工具：开启】\n请在开始执行前做需求澄清检查。若当前官方 Kimi Code 运行模式支持向用户提问，且系统/权限规则没有禁止提问，优先使用官方 AskUserQuestion 结构化提问能力提出 1-3 个简短问题；若当前处于 prompt/auto 等禁止向用户提问的模式，请不要调用 AskUserQuestion，也不要解释本规则，按官方要求做合理判断并继续。",
};

function withClarificationBehavior(content: string, mode: ClarificationToolMode): string {
  const trimmed = content.trim();
  if (!trimmed || mode === "off") return content;
  return `${CLARIFICATION_PROMPTS[mode]}\n\n用户原始需求：\n${content}`;
}

const iconButtonClass =
  "kimix-muted-action flex h-8 w-8 shrink-0 items-center justify-center rounded-xl disabled:cursor-not-allowed disabled:opacity-35";

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
  commandName?: string;
  kind: "agent" | "plugin" | "file" | "slash";
};

const unsupportedSlashHints: Record<string, string> = {
  status: "套餐用量已移到底部“套餐用量”菜单，请从那里查看 5小时和本周用量。",
  usage: "套餐用量已移到底部“套餐用量”菜单，请从那里查看 5小时和本周用量。",
};

const skillCommandPattern = /^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/;

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
  const [drawingBoardRequest, setDrawingBoardRequest] = useState<DrawingBoardRequest | null>(null);
  const [slashCommands, setSlashCommands] = useState<CompletionItem[]>([]);
  const [fileItems, setFileItems] = useState<CompletionItem[]>([]);
  const [activeCompletionIndex, setActiveCompletionIndex] = useState(0);
  const inputRef = useRef<ComposerInputHandle>(null);
  const completionListRef = useRef<HTMLDivElement>(null);
  const completionItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const handoffSessionId = useAppStore((s) => s.handoffSessionId);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const currentProject = useAppStore((s) => s.currentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const setDefaultThinking = useAppStore((s) => s.setDefaultThinking);
  const defaultPlanMode = useAppStore((s) => s.defaultPlanMode);
  const setDefaultPlanMode = useAppStore((s) => s.setDefaultPlanMode);
  const hiddenComposerCards = useAppStore((s) => s.hiddenComposerCards);
  const setComposerCardHidden = useAppStore((s) => s.setComposerCardHidden);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const focusInputTrigger = useAppStore((s) => s.focusInputTrigger);
  const voiceShortcut = useAppStore((s) => s.voiceShortcut);
  const clarificationToolMode = useAppStore((s) => s.clarificationToolMode);
  const setClarificationToolMode = useAppStore((s) => s.setClarificationToolMode);
  const experimentalTuiEngineEnabled = useAppStore((s) => s.experimentalTuiEngineEnabled);
  const clarificationLockedByYolo = permissionMode === "yolo";
  const effectiveClarificationToolMode = clarificationLockedByYolo ? "off" : clarificationToolMode;

  const updateSession = useSessionStore((s) => s.updateSession);
  const addSession = useSessionStore((s) => s.addSession);
  const addPendingMessage = useSessionStore((s) => s.addPendingMessage);
  const pendingMessages = useSessionStore((s) => s.pendingMessages);
  const removePendingMessage = useSessionStore((s) => s.removePendingMessage);
  const reorderPendingMessage = useSessionStore((s) => s.reorderPendingMessage);
  const liveSession = useLiveSession(currentSession?.id);

  const [showPermissionMenu, setShowPermissionMenu] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [editingPendingId, setEditingPendingId] = useState<string | null>(null);
  const [draggingPendingId, setDraggingPendingId] = useState<string | null>(null);

  const permissionBtnRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLDivElement>(null);
  const activeSession = liveSession ?? currentSession;
  const activeRuntimeSessionId = activeSession ? getRuntimeSessionId(activeSession) : undefined;
  const isCurrentSessionRunning = Boolean(activeSession && (
    runningSessionId === activeSession.id ||
    Boolean(activeRuntimeSessionId && runningSessionId === activeRuntimeSessionId)
  ));
  const isCurrentSessionHandoff = Boolean(activeSession && handoffSessionId === activeSession.id);
  const hasUnfinishedAssistant = Boolean(activeSession?.events.some((event) => event.type === "assistant_message" && !event.isComplete));
  const shouldShowStopButton = Boolean(isCurrentSessionRunning || hasUnfinishedAssistant);
  const canUseComposer = Boolean(currentSession || currentProject) && !isCurrentSessionHandoff;
  const canTogglePlanMode = canUseComposer && !isCurrentSessionRunning && !hasUnfinishedAssistant;
  const allowedSlashNames = new Set(slashCommands.flatMap((item) => item.commandName ? [item.commandName] : []));

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (permissionBtnRef.current && !permissionBtnRef.current.contains(e.target as Node)) {
        setShowPermissionMenu(false);
      }
      if (addBtnRef.current && !addBtnRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (focusInputTrigger > 0) inputRef.current?.focus();
  }, [focusInputTrigger]);

  useEffect(() => {
    const handleAddDrawingImage = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; dataUrl?: string }>).detail;
      if (!detail?.dataUrl?.startsWith("data:image/")) return;
      setImageAttachments((prev) => [
        ...prev,
        {
          id: genId(),
          name: detail.name?.trim() || "画板图片.png",
          dataUrl: detail.dataUrl,
        },
      ]);
      inputRef.current?.focus();
    };
    window.addEventListener("kimix:addDrawingImage", handleAddDrawingImage);
    return () => window.removeEventListener("kimix:addDrawingImage", handleAddDrawingImage);
  }, []);

  useEffect(() => {
    if (!currentSession) {
      setSlashCommands([]);
      return;
    }
    if (currentSession.engine === "tui") {
      setSlashCommands([]);
      return;
    }
    let cancelled = false;
    const runtimeSessionId = getRuntimeSessionId(currentSession);
    if (!runtimeSessionId) {
      setSlashCommands([]);
      return;
    }
    void window.api.listSlashCommands({ sessionId: runtimeSessionId }).then((res) => {
      if (cancelled) return;
      if (!res.success) {
        console.warn("List slash commands failed:", res.error);
        setSlashCommands([]);
        return;
      }
      setSlashCommands(res.data.map((command) => ({
        id: `slash-${command.name}`,
        label: `/${command.name}`,
        detail: command.description,
        insertText: `/${command.name} `,
        commandName: command.name,
        kind: "slash",
      })));
    }).catch((err) => {
      if (cancelled) return;
      console.warn("List slash commands failed:", err);
      setSlashCommands([]);
    });
    return () => {
      cancelled = true;
    };
  }, [currentSession?.id, currentSession?.longTask?.activeAgent]);

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
    if (!activeCompletion || completionItems.length === 0) return;
    const activeItem = completionItems[activeCompletionIndex] ?? completionItems[0];
    const activeNode = activeItem ? completionItemRefs.current[activeItem.id] : null;
    activeNode?.scrollIntoView({ block: "nearest" });
  }, [activeCompletion, activeCompletionIndex, completionItems]);

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

  const openBlankDrawingBoard = (ratio: DrawingBoardRequest["ratio"]) => {
    setDrawingBoardRequest({ ratio });
    setShowAddMenu(false);
  };

  const handleSaveDrawingBoard = (image: { name: string; dataUrl: string; sourceId?: string }) => {
    const attachment: ImageAttachment = {
      id: genId(),
      name: image.name,
      dataUrl: image.dataUrl,
    };
    setImageAttachments((prev) => {
      if (!image.sourceId) return [...prev, attachment];
      const sourceIndex = prev.findIndex((item) => item.id === image.sourceId);
      if (sourceIndex < 0) return [...prev, attachment];
      return [
        ...prev.slice(0, sourceIndex + 1),
        attachment,
        ...prev.slice(sourceIndex + 1),
      ];
    });
    setDrawingBoardRequest(null);
  };

  const ensureSession = async () => {
    if (currentSession) {
      return useSessionStore.getState().sessions.find((session) => session.id === currentSession.id) ?? currentSession;
    }
    if (!currentProject) return null;
    if (experimentalTuiEngineEnabled) {
      const session = {
        id: genId(),
        engine: "tui" as const,
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
    }
    const sessionRes = await window.api.startSession({
      workDir: currentProject.path,
      thinking: defaultThinking,
      yoloMode: permissionMode === "yolo",
      autoMode: permissionMode === "auto",
      planMode: defaultPlanMode,
    });
    if (!sessionRes.success) return null;
    setSlashCommands((sessionRes.data.slashCommands ?? []).map((command) => ({
      id: `slash-${command.name}`,
      label: `/${command.name}`,
      detail: command.description,
      insertText: `/${command.name} `,
      commandName: command.name,
      kind: "slash",
    })));
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
    const ensuredSession = await ensureSession();
    if (!ensuredSession) return;
    let targetSession = ensuredSession;
    const images = options?.images ?? [];

    const userEvent: TimelineEvent = {
      id: genId(),
      type: "user_message",
      timestamp: Date.now(),
      content,
      images: images.map((image) => ({ id: image.id, name: image.name, dataUrl: image.dataUrl })),
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

    const shouldUseTuiEngine = experimentalTuiEngineEnabled && !targetSession.longTask;
    const outboundContent = targetSession.longTask
      ? content
      : shouldUseTuiEngine
        ? content
        : withClarificationBehavior(content, effectiveClarificationToolMode);
    setRunningSessionId(targetSession.id);
    if (shouldUseTuiEngine) {
      try {
        let tuiSessionId = targetSession.engine === "tui" ? targetSession.runtimeSessionId : undefined;
        if (!tuiSessionId) {
          const startRes = await window.api.startTuiSession({ workDir: targetSession.projectPath });
          if (!startRes.success) throw new Error(startRes.error);
          tuiSessionId = startRes.data.sessionId;
          targetSession = { ...targetSession, engine: "tui", runtimeSessionId: tuiSessionId };
          updateSession(targetSession.id, (session) => ({
            ...session,
            engine: "tui",
            runtimeSessionId: tuiSessionId,
            model: "Kimi TUI",
            updatedAt: Date.now(),
          }));
          if (currentSession?.id === targetSession.id) setCurrentSession(targetSession);
        }
        const sendRes = await window.api.sendTuiInput({
          sessionId: tuiSessionId,
          text: outboundContent,
          images: images.map((image) => ({ name: image.name, dataUrl: image.dataUrl })),
        });
        if (!sendRes.success) throw new Error(sendRes.error);
        return;
      } catch (err) {
        console.error("TUI send failed:", err);
        setRunningSessionId(null);
        updateSession(targetSession.id, (session) => ({
          ...session,
          events: [
            ...session.events.map((event) => event.type === "assistant_message" && !event.isComplete
              ? { ...event, isComplete: true, isThinking: false }
              : event
            ),
            {
              id: genId(),
              type: "error",
              timestamp: Date.now(),
              message: err instanceof Error ? err.message : String(err),
              source: "ipc",
            },
          ],
          updatedAt: Date.now(),
        }));
        return;
      }
    }
    let runtimeSessionId = getRuntimeSessionId(targetSession);
    if (!runtimeSessionId) {
      setRunningSessionId(null);
      return;
    }
    const sendToRuntime = (sessionId: string) => window.api.sendPrompt({
      sessionId,
      content: outboundContent,
      images: images.map((image) => ({ name: image.name, dataUrl: image.dataUrl })),
      thinking: defaultThinking,
      yoloMode: permissionMode === "yolo",
      autoMode: permissionMode === "auto",
      planMode: defaultPlanMode,
    });
    try {
      let res = await sendToRuntime(runtimeSessionId);
      if (!res.success && /session not found/i.test(res.error)) {
        const startRes = await window.api.startSession({
          workDir: targetSession.projectPath,
          sessionId: targetSession.id,
          thinking: defaultThinking,
          yoloMode: permissionMode === "yolo",
          autoMode: permissionMode === "auto",
          planMode: defaultPlanMode,
        });
        if (!startRes.success) throw new Error(startRes.error);
        runtimeSessionId = startRes.data.sessionId;
        targetSession = { ...targetSession, runtimeSessionId };
        updateSession(targetSession.id, (session) => ({ ...session, runtimeSessionId }));
        if (currentSession?.id === targetSession.id) setCurrentSession(targetSession);
        res = await sendToRuntime(runtimeSessionId);
      }
      if (!res.success) throw new Error(res.error);
    } catch (err) {
      console.error("Send failed:", err);
      setRunningSessionId(null);
      updateSession(targetSession.id, (session) => ({
        ...session,
        events: [
          ...session.events.map((event) => event.type === "assistant_message" && !event.isComplete
            ? { ...event, isComplete: true, isThinking: false }
            : event
          ),
          {
            id: genId(),
            type: "error",
            timestamp: Date.now(),
            message: err instanceof Error ? err.message : String(err),
            source: "ipc",
          },
        ],
        updatedAt: Date.now(),
      }));
      return;
    }
  };

  const settlePendingClarifications = (sessionId: string, status: "skipped" | "answered" = "skipped") => {
    updateSession(sessionId, (session) => ({
      ...session,
      events: session.events.map((event) => (
        event.type === "question_request" && event.status === "pending"
          ? { ...event, status, answers: event.answers ?? {} }
          : event
      )),
      updatedAt: Date.now(),
    }));
  };

  const appendLocalEvent = async (event: TimelineEvent) => {
    const targetSession = await ensureSession();
    if (!targetSession) return null;
    updateSession(targetSession.id, (session) => ({
      ...session,
      events: [...session.events, event],
      updatedAt: Date.now(),
    }));
    return targetSession;
  };

  const applySkillCommand = async (skillName: string) => {
    const skillRes = await window.api.listSkills();
    if (!skillRes.success) {
      await appendLocalEvent({
        id: genId(),
        type: "error",
        timestamp: Date.now(),
        message: `启用 Skill 失败：${skillRes.error}`,
        source: "ui",
      });
      return false;
    }

    const normalizedName = skillName.trim().toLowerCase();
    const skill = skillRes.data.skills.find((item) => (
      item.name.toLowerCase() === normalizedName ||
      item.path.toLowerCase().includes(`\\${normalizedName}\\skill.md`) ||
      item.path.toLowerCase().includes(`/${normalizedName}/skill.md`)
    ));
    if (!skill) {
      await appendLocalEvent({
        id: genId(),
        type: "error",
        timestamp: Date.now(),
        message: `未找到 Skill：${skillName}。请在左侧“技能”面板确认名称后再发送。`,
        source: "ui",
      });
      return false;
    }

    const nextNames = Array.from(new Set([...skillRes.data.enabledNames, skill.name]));
    const saveRes = await window.api.saveEnabledSkills({ names: nextNames });
    if (!saveRes.success) {
      await appendLocalEvent({
        id: genId(),
        type: "error",
        timestamp: Date.now(),
        message: `启用 Skill 失败：${saveRes.error}`,
        source: "ui",
      });
      return false;
    }

    const targetSession = await ensureSession();
    if (!targetSession) return false;
    const startRes = await window.api.startSession({
      workDir: targetSession.projectPath,
      sessionId: getRuntimeSessionId(targetSession) ?? targetSession.id,
      thinking: defaultThinking,
      yoloMode: permissionMode === "yolo",
      autoMode: permissionMode === "auto",
      planMode: defaultPlanMode,
      skillsDir: saveRes.data.enabledDir,
    });
    if (!startRes.success) {
      await appendLocalEvent({
        id: genId(),
        type: "error",
        timestamp: Date.now(),
        message: `Skill 已保存，但刷新当前会话失败：${startRes.error}`,
        source: "ui",
      });
      return false;
    }

    setSlashCommands((startRes.data.slashCommands ?? []).map((command) => ({
      id: `slash-${command.name}`,
      label: `/${command.name}`,
      detail: command.description,
      insertText: `/${command.name} `,
      commandName: command.name,
      kind: "slash",
    })));
    updateSession(targetSession.id, (session) => ({
      ...session,
      events: [
        ...session.events,
        {
          id: genId(),
          type: "status_update",
          timestamp: Date.now(),
          message: `已启用 Skill：${skill.name}`,
        },
      ],
      updatedAt: Date.now(),
    }));
    return true;
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    const imagesToSend = imageAttachments;
    if ((!trimmed && imagesToSend.length === 0) || !canUseComposer) return;
    const skillMatch = trimmed.match(skillCommandPattern);
    if (skillMatch) {
      const skillName = skillMatch[1];
      const restContent = (skillMatch[2] ?? "").trim();
      setInput("");
      setImageAttachments([]);
      setEditingPendingId(null);
      inputRef.current?.reset();
      const applied = await applySkillCommand(skillName);
      if (applied && (restContent || imagesToSend.length > 0)) {
        if ((isCurrentSessionRunning || hasUnfinishedAssistant) && currentSession) {
          addPendingMessage(restContent, imagesToSend.map((image) => ({ id: image.id, name: image.name, dataUrl: image.dataUrl })));
          if (imagesToSend.length > 0) {
            window.dispatchEvent(new CustomEvent("kimix:toast", {
              detail: "当前轮次还没结束，文字和图片已加入队列，等待官方 TUI 完成后自动发送。",
            }));
          }
          return;
        }
        await sendPromptContent(restContent, { images: imagesToSend });
      }
      return;
    }
    const slashMatch = trimmed.match(/^\/([^\s/]+)(?:\s|$)/);
    if (slashMatch) {
      const slashName = slashMatch[1];
      const isKnown = allowedSlashNames.has(slashName);
      const shouldBlock = !experimentalTuiEngineEnabled && (unsupportedSlashHints[slashName] || (slashCommands.length > 0 && !isKnown));
      if (shouldBlock) {
        const targetSession = await ensureSession();
        if (!targetSession) return;
        const hint = unsupportedSlashHints[slashName] ?? "这个命令不是当前 Kimi SDK 会话可直接执行的原生命令，已拦截，避免发送后出现 Unknown slash command。";
        updateSession(targetSession.id, (session) => ({
          ...session,
          events: [
            ...session.events,
            {
              id: genId(),
              type: "error",
              timestamp: Date.now(),
              message: `/${slashName} 暂不能在当前对话输入框中发送。${hint}`,
              source: "ui",
            },
          ],
          updatedAt: Date.now(),
        }));
        return;
      }
    }

    setInput("");
    setImageAttachments([]);
    setEditingPendingId(null);
    inputRef.current?.reset();

    if (!isCurrentSessionRunning && !hasUnfinishedAssistant && activeSession) {
      settlePendingClarifications(activeSession.id);
    }

    if ((isCurrentSessionRunning || hasUnfinishedAssistant) && currentSession) {
      addPendingMessage(trimmed, imagesToSend.map((image) => ({ id: image.id, name: image.name, dataUrl: image.dataUrl })));
      return;
    }
    await sendPromptContent(trimmed, { images: imagesToSend });
  };

  // steer：把输入框内容立即注入当前运行中的 TUI turn（官方 Ctrl+S 行为），
  // 与普通 Enter 排队严格区分。仅 TUI 引擎、且当前轮运行中时可用。
  const handleSteer = async () => {
    const trimmed = input.trim();
    const imagesToSend = imageAttachments;
    if ((!trimmed && imagesToSend.length === 0) || !canUseComposer) return;
    if (!activeSession || activeSession.engine !== "tui") return;
    const runtimeSessionId = getRuntimeSessionId(activeSession);
    if (!runtimeSessionId) return;
    setInput("");
    setImageAttachments([]);
    setEditingPendingId(null);
    inputRef.current?.reset();
    const res = await window.api.sendTuiInput({
      sessionId: runtimeSessionId,
      text: trimmed,
      images: imagesToSend.map((image) => ({ name: image.name, dataUrl: image.dataUrl })),
      submit: "steer",
    });
    if (!res.success) {
      window.dispatchEvent(new CustomEvent("kimix:toast", { detail: `引导失败：${res.error}` }));
      return;
    }
    updateSession(activeSession.id, (session) => ({
      ...session,
      events: [
        ...session.events,
        {
          id: genId(),
          type: "status_update",
          timestamp: Date.now(),
          message: `已引导当前任务：${trimmed || "[图片]"}`,
        },
      ],
      updatedAt: Date.now(),
    }));
    window.dispatchEvent(new CustomEvent("kimix:toast", {
      detail: "已注入当前任务（Ctrl+S 引导）",
    }));
  };

  const handleStop = async () => {
    const stateRunningSessionId = useAppStore.getState().runningSessionId;
    const stateRunningMatchesActive = Boolean(activeSession && (
      stateRunningSessionId === activeSession.id ||
      Boolean(activeRuntimeSessionId && stateRunningSessionId === activeRuntimeSessionId)
    ));
    const sessionId = (hasUnfinishedAssistant || stateRunningMatchesActive) && activeSession ? activeSession.id : stateRunningSessionId ?? activeSession?.id;
    if (!sessionId) return;
    if (stateRunningSessionId === sessionId || (activeRuntimeSessionId && stateRunningSessionId === activeRuntimeSessionId)) setRunningSessionId(null);
    updateSession(sessionId, (session) => ({
      ...session,
      events: session.events.map((event) => event.type === "assistant_message" && !event.isComplete
        ? { ...event, isComplete: true, isThinking: false, durationMs: event.durationMs ?? Math.max(0, Date.now() - event.timestamp) }
        : event.type === "question_request" && event.status === "pending"
          ? { ...event, status: "skipped" as const, answers: event.answers ?? {} }
        : event
      ),
      updatedAt: Date.now(),
    }));
    if (activeSession?.id === sessionId) {
      const updated = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
      if (updated) setCurrentSession(updated);
    }
    window.setTimeout(() => {
      const latest = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
      if (!latest) return;
      const hasOpenAssistant = latest.events.some((event) => event.type === "assistant_message" && !event.isComplete);
      if (!hasOpenAssistant) return;
      updateSession(sessionId, (session) => ({
        ...session,
        events: session.events.map((event) => event.type === "assistant_message" && !event.isComplete
          ? { ...event, isComplete: true, isThinking: false, durationMs: event.durationMs ?? Math.max(0, Date.now() - event.timestamp) }
          : event
        ),
        updatedAt: Date.now(),
      }));
    }, 250);
    try {
      const latest = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
      const runtimeSessionId = latest ? getRuntimeSessionId(latest) : sessionId;
      const res = latest?.engine === "tui" && runtimeSessionId
        ? await window.api.stopTuiSession({ sessionId: runtimeSessionId })
        : await window.api.stopTurn({ sessionId: runtimeSessionId ?? sessionId });
      if (!res.success) {
        console.error("Stop failed:", res.error);
      }
    } catch (err) {
      console.error("Stop failed:", err);
    }
  };

  const handleVoiceShortcut = async () => {
    const shortcut = voiceShortcut.trim() || "Win+H";
    const res = await window.api.triggerShortcut({ shortcut });
    window.dispatchEvent(new CustomEvent("kimix:toast", {
      detail: res.success ? `已触发语音快捷键：${shortcut}` : `语音快捷键失败：${res.error}`,
    }));
  };

  const handleSetClarificationToolMode = (mode: ClarificationToolMode) => {
    if (clarificationLockedByYolo) {
      if (clarificationToolMode !== "off") setClarificationToolMode("off");
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: "官方 yolo 模式不支持开启需求澄清工具",
      }));
      return;
    }
    setClarificationToolMode(mode);
    window.dispatchEvent(new CustomEvent("kimix:toast", {
      detail: `需求澄清工具：${CLARIFICATION_OPTIONS.find((option) => option.value === mode)?.label ?? mode}`,
    }));
  };

  const handleSetPermissionMode = async (mode: PermissionMode) => {
    const previousMode = permissionMode;
    setPermissionMode(mode);
    if (mode === "yolo" && clarificationToolMode !== "off") {
      setClarificationToolMode("off");
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: "已关闭需求澄清工具：官方 yolo 模式不支持开启",
      }));
    }
    setShowPermissionMenu(false);
    if (!experimentalTuiEngineEnabled || !activeSession || activeSession.engine !== "tui" || (mode !== "manual" && mode !== "auto")) {
      return;
    }
    const runtimeSessionId = getRuntimeSessionId(activeSession);
    if (!runtimeSessionId || previousMode === mode) return;
    const res = await window.api.sendTuiInput({ sessionId: runtimeSessionId, text: "/auto" });
    if (!res.success) {
      setPermissionMode(previousMode);
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: `TUI 权限切换失败：${res.error}`,
      }));
      return;
    }
    window.dispatchEvent(new CustomEvent("kimix:toast", {
      detail: mode === "auto" ? "已发送 /auto，等待 TUI 切到自动权限" : "已发送 /auto，等待 TUI 切回手动审批",
    }));
  };

  const handleTogglePlanMode = async () => {
    if (!canTogglePlanMode) return;
    const next = !defaultPlanMode;
    setDefaultPlanMode(next);
    const runtimeSessionId = activeSession ? getRuntimeSessionId(activeSession) : null;
    if (!runtimeSessionId) {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: next ? "Plan 模式已开启" : "Plan 模式已关闭",
      }));
      return;
    }
    if (activeSession?.engine === "tui") {
      const res = await window.api.sendTuiInput({ sessionId: runtimeSessionId, text: "/plan" });
      if (!res.success) {
        setDefaultPlanMode(!next);
        window.dispatchEvent(new CustomEvent("kimix:toast", {
          detail: `TUI Plan 模式切换失败：${res.error}`,
        }));
        return;
      }
      setDefaultPlanMode(next);
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: next ? "已发送 /plan，等待 TUI 开启 Plan 模式" : "已发送 /plan，等待 TUI 关闭 Plan 模式",
      }));
      return;
    }
    const res = await window.api.setPlanMode({ sessionId: runtimeSessionId, enabled: next });
    if (!res.success) {
      setDefaultPlanMode(!next);
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: `Plan 模式切换失败：${res.error}`,
      }));
      return;
    }
    setDefaultPlanMode(next);
    window.dispatchEvent(new CustomEvent("kimix:toast", {
      detail: next ? "Plan 模式已开启" : "Plan 模式已关闭",
    }));
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
    if ((isCurrentSessionRunning || hasUnfinishedAssistant) && currentSession) {
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: "当前轮次还没结束，这条消息会留在队列里，等待官方 TUI 完成后自动发送。",
      }));
      return;
    }
    removePendingMessage(id);
    await sendPromptContent(pending.content, {
      images: (pending.images ?? []).map((image) => ({
        id: image.id ?? genId(),
        name: image.name,
        dataUrl: image.dataUrl ?? "",
      })).filter((image) => image.dataUrl),
    });
  };

  const handleEditPending = (id: string) => {
    const pending = pendingMessages.find((msg) => msg.id === id);
    if (!pending) return;
    setInput(pending.content);
    setImageAttachments((pending.images ?? []).map((image) => ({
      id: image.id ?? genId(),
      name: image.name,
      dataUrl: image.dataUrl ?? "",
    })).filter((image) => image.dataUrl));
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
    auto: "自动权限",
    yolo: "完全访问权限",
  }[permissionMode];

  const placeholder = canUseComposer
    ? "向 Agent 询问任何事。输入 @ 使用插件或提及文件"
    : isCurrentSessionHandoff
      ? "正在生成交接内容..."
      : "请先选择项目";
  const composerCardSessionId = activeSession?.id ?? "__global__";
  const hiddenCards = hiddenComposerCards[composerCardSessionId] ?? [];
  const visibleTodos = activeSession ? getVisibleTodos(activeSession.events) : [];
  const todoHidden = hiddenCards.includes("todo");
  const pendingHidden = hiddenCards.includes("pending");
  const canSendNow = canUseComposer && (input.trim().length > 0 || imageAttachments.length > 0);
  const hideComposerCard = (card: "todo" | "pending", label: string) => {
    setComposerCardHidden(composerCardSessionId, card, true);
    window.dispatchEvent(new CustomEvent("kimix:toast", { detail: `${label}已收起，可在右侧会话侧栏恢复。` }));
  };

  return (
    <div
      className="relative flex w-full flex-col"
      style={{ paddingTop: 8 }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {activeSession && visibleTodos.length > 0 && !todoHidden && (
        <TodoPanel
          events={activeSession.events}
          onDismiss={() => hideComposerCard("todo", "TodoList")}
        />
      )}

      {pendingMessages.length > 0 && !pendingHidden && (
        <div
          className="kimix-floating-panel overflow-hidden rounded-[15px] text-[13px]"
          style={{ marginBottom: 8 }}
        >
          <div className="flex h-11 items-center justify-between border-b border-[var(--kimix-panel-divider)] text-[14.5px] text-[var(--kimix-panel-text-secondary)]" style={{ gap: 12, paddingLeft: 20, paddingRight: 14 }}>
            <span className="min-w-0 truncate">{pendingMessages.length} 条消息正在排队</span>
            {isCurrentSessionRunning && <span className="shrink-0 text-[var(--kimix-panel-text-muted)]">当前任务结束后继续</span>}
            <button
              type="button"
              onClick={() => hideComposerCard("pending", "排队消息")}
              className="kimix-muted-action flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              title="收起到侧栏"
              aria-label="收起排队消息"
            >
              <X size={13} />
            </button>
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
                className={`group flex min-h-[42px] min-w-0 items-center gap-2 border-b border-[var(--kimix-panel-divider)] last:border-b-0 hover:bg-[var(--kimix-panel-soft-bg)] ${
                  draggingPendingId === msg.id ? "bg-[var(--kimix-panel-hover)] opacity-70" : ""
                }`}
                style={{ paddingLeft: 18, paddingRight: 18 }}
              >
                <div className="flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-lg text-[var(--kimix-panel-text-muted)] active:cursor-grabbing">
                  <GripVertical size={15} />
                </div>
                <div className="min-w-0 flex-1 truncate text-[14px] leading-5 text-[var(--kimix-panel-text)]">
                  {msg.content || "[图片]"}
                  {(msg.images?.length ?? 0) > 0 && (
                    <span className="text-[12.5px] text-[var(--kimix-panel-text-muted)]"> · {msg.images?.length} 张图片</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1 text-[var(--kimix-panel-text-muted)]">
                  <button onClick={() => handleSendPendingNow(msg.id)} className="kimix-icon-text-button kimix-muted-action is-compact text-[13px]" title={isCurrentSessionRunning || hasUnfinishedAssistant ? "等待当前轮次结束后自动发送" : "发送这条队列消息"}>
                    <Send size={13} />
                    <span>{isCurrentSessionRunning || hasUnfinishedAssistant ? "等待" : "发送"}</span>
                  </button>
                  <button onClick={() => handleEditPending(msg.id)} className="kimix-muted-action flex h-7 w-7 items-center justify-center rounded-lg transition-colors" title="撤回到输入框修改" aria-label="撤回到输入框修改">
                    <Edit2 size={13} />
                  </button>
                  <button onClick={() => removePendingMessage(msg.id)} className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-accent-red/10 hover:text-accent-red" title="删除" aria-label="删除">
                    <Trash2 size={13} />
                  </button>
                  <button className="kimix-muted-action flex h-7 w-7 items-center justify-center rounded-lg transition-colors" title="更多" aria-label="更多">
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
        className={`kimix-composer-surface kimix-composer-card relative flex min-w-0 flex-col overflow-visible border transition-colors ${
          isDragging
            ? "border-accent-blue"
            : isFocused
              ? "is-focused"
              : ""
        } ${!canUseComposer ? "opacity-60" : ""}`}
      >
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-accent-primary bg-accent-primary/5">
            <span className="text-sm font-medium text-accent-primary">释放以添加附件</span>
          </div>
        )}
        {activeCompletion && (
          <div
            ref={completionListRef}
            className="kimix-floating-panel mb-3 max-h-[276px] overflow-y-auto rounded-[16px] text-[14px]"
            style={{ padding: 10 }}
            onMouseDown={(event) => event.preventDefault()}
          >
            {activeCompletion.mode === "mention" ? (
              <>
                <div className="px-2 pb-1.5 text-[13px] text-[var(--kimix-panel-text-muted)]">智能体</div>
                {filteredMentionBaseItems.filter((item) => item.kind === "agent").map((item) => {
                  const index = completionItems.findIndex((candidate) => candidate.id === item.id);
                  return (
                    <button
                      ref={(node) => { completionItemRefs.current[item.id] = node; }}
                      key={item.id}
                      type="button"
                      onClick={() => applyCompletion(item)}
                      className={`flex h-9 w-full items-center gap-2.5 rounded-xl text-left transition-colors ${activeCompletionIndex === index ? "bg-[var(--kimix-panel-hover)] text-[var(--kimix-panel-text)]" : "text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-hover)]"}`}
                      style={{ paddingLeft: 10, paddingRight: 12 }}
                    >
                      <Bot size={15} className="shrink-0 text-[var(--kimix-panel-text-muted)]" />
                      <span className="shrink-0">{item.label}</span>
                      {item.detail && <span className="min-w-0 truncate text-[var(--kimix-panel-text-muted)]">{item.detail}</span>}
                    </button>
                  );
                })}
                <div className="px-2 pb-1.5 pt-2 text-[13px] text-[var(--kimix-panel-text-muted)]">插件</div>
                {filteredMentionBaseItems.filter((item) => item.kind === "plugin").map((item) => {
                  const index = completionItems.findIndex((candidate) => candidate.id === item.id);
                  return (
                    <button
                      ref={(node) => { completionItemRefs.current[item.id] = node; }}
                      key={item.id}
                      type="button"
                      onClick={() => applyCompletion(item)}
                      className={`flex h-9 w-full items-center gap-2.5 rounded-xl text-left transition-colors ${activeCompletionIndex === index ? "bg-[var(--kimix-panel-hover)] text-[var(--kimix-panel-text)]" : "text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-hover)]"}`}
                      style={{ paddingLeft: 10, paddingRight: 12 }}
                    >
                      <Puzzle size={15} className="shrink-0 text-[var(--kimix-panel-text-muted)]" />
                      <span className="shrink-0">{item.label}</span>
                      {item.detail && <span className="min-w-0 truncate text-[var(--kimix-panel-text-muted)]">{item.detail}</span>}
                    </button>
                  );
                })}
                <div className="px-2 pb-1.5 pt-2 text-[13px] text-[var(--kimix-panel-text-muted)]">文件</div>
                {fileItems.length > 0 ? fileItems.map((item) => {
                  const index = completionItems.findIndex((candidate) => candidate.id === item.id);
                  return (
                    <button
                      ref={(node) => { completionItemRefs.current[item.id] = node; }}
                      key={item.id}
                      type="button"
                      onClick={() => applyCompletion(item)}
                      className={`flex h-9 w-full items-center gap-2.5 rounded-xl text-left transition-colors ${activeCompletionIndex === index ? "bg-[var(--kimix-panel-hover)] text-[var(--kimix-panel-text)]" : "text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-hover)]"}`}
                      style={{ paddingLeft: 10, paddingRight: 12 }}
                    >
                      <FileText size={15} className="shrink-0 text-[var(--kimix-panel-text-muted)]" />
                      <span className="min-w-0 flex-1 truncate">{item.detail}</span>
                    </button>
                  );
                }) : (
                  <div className="px-2 py-1.5 text-[var(--kimix-panel-text-muted)]">输入内容搜索文件</div>
                )}
              </>
            ) : (
              <>
                <div className="px-2 pb-1.5 text-[13px] text-[var(--kimix-panel-text-muted)]">命令</div>
                {completionItems.length > 0 ? completionItems.map((item, index) => (
                  <button
                    ref={(node) => { completionItemRefs.current[item.id] = node; }}
                    key={item.id}
                    type="button"
                    onClick={() => applyCompletion(item)}
                    className={`flex h-9 w-full items-center gap-2.5 rounded-xl text-left transition-colors ${activeCompletionIndex === index ? "bg-[var(--kimix-panel-hover)] text-[var(--kimix-panel-text)]" : "text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-hover)]"}`}
                    style={{ paddingLeft: 10, paddingRight: 12 }}
                  >
                    <TerminalSquare size={15} className="shrink-0 text-[var(--kimix-panel-text-muted)]" />
                    <span className="shrink-0">{item.label}</span>
                    {item.detail && <span className="min-w-0 truncate text-[var(--kimix-panel-text-muted)]">{item.detail}</span>}
                  </button>
                )) : (
                  <div className="flex items-center gap-2 px-2 py-1.5 text-[var(--kimix-panel-text-muted)]">
                    <AtSign size={14} />
                    <span>正在从 Agent 加载命令，或当前会话未返回 slash_commands</span>
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
                className="kimix-media-thumb group relative h-20 w-20 overflow-hidden rounded-xl text-left shadow-[0_1px_2px_rgba(25,23,20,0.05)] transition-colors"
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
              <button onClick={handleCancelPendingEdit} className="kimix-muted-action shrink-0 rounded-xl px-2.5 py-1 text-[13px]">
                取消修改
              </button>
            )}
            <div ref={addBtnRef} className="relative">
              <button disabled={!canUseComposer} onClick={() => setShowAddMenu((value) => !value)} className={iconButtonClass} title="更多工具" aria-label="更多工具">
                <Plus size={18} />
              </button>
              {showAddMenu && (
                <div className="kimix-floating-panel absolute bottom-full left-0 z-30 mb-2 w-[260px] rounded-xl" style={{ padding: "14px 14px 14px" }}>
                  <div className="flex flex-col" style={{ gap: 14 }}>
                    <section>
                      <div className="flex items-center justify-between" style={{ gap: 10, marginBottom: 10 }}>
                        <div className="flex min-w-0 items-center gap-2 text-[13.5px] font-medium text-[var(--kimix-panel-text)]">
                          <Palette size={15} className="shrink-0 text-[var(--kimix-panel-text-secondary)]" />
                          <span>画板</span>
                        </div>
                        <span className="shrink-0 text-[12.5px] text-[var(--kimix-panel-text-muted)]">新建空白画布</span>
                      </div>
                      <div className="grid justify-between" style={{ gridTemplateColumns: "repeat(5, 38px)", gap: 6 }}>
                        {DRAWING_BOARD_RATIOS.map((ratio) => (
                          <button
                            key={ratio}
                            type="button"
                            onClick={() => openBlankDrawingBoard(ratio)}
                            className="kimix-icon-text-button is-compact justify-center rounded-lg text-[13px] text-text-secondary hover:bg-[var(--kimix-panel-hover)]"
                            style={{ width: 38, paddingLeft: 0, paddingRight: 0 }}
                          >
                            {ratio}
                          </button>
                        ))}
                      </div>
                    </section>

                    <section className="border-t border-[var(--kimix-panel-divider)]" style={{ paddingTop: 14 }}>
                      <div className="flex items-center justify-between" style={{ gap: 10 }}>
                        <div className="flex min-w-0 items-center gap-2 text-[13.5px] font-medium text-[var(--kimix-panel-text)]">
                          <CircleHelp size={15} className="shrink-0 text-[var(--kimix-panel-text-secondary)]" />
                          <span>需求澄清</span>
                          {clarificationLockedByYolo && <Lock size={12} className="shrink-0 text-[var(--kimix-panel-text-muted)]" />}
                        </div>
                        <div
                          className="flex w-[132px] shrink-0 rounded-xl bg-[var(--kimix-panel-soft-bg)]"
                          style={{ gap: 4, padding: 4, opacity: clarificationLockedByYolo ? 0.72 : 1 }}
                          title={clarificationLockedByYolo ? "官方 yolo 模式不支持开启需求澄清工具" : undefined}
                        >
                          {CLARIFICATION_OPTIONS.map((option) => {
                            const active = effectiveClarificationToolMode === option.value;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                title={clarificationLockedByYolo ? "官方 yolo 模式不支持开启需求澄清工具" : option.desc}
                                onClick={() => handleSetClarificationToolMode(option.value)}
                                className={`h-8 flex-1 rounded-lg text-[13px] transition-colors ${active ? "bg-surface-elevated text-accent-primary shadow-[0_1px_2px_rgba(25,23,20,0.08)]" : "text-[var(--kimix-panel-text-secondary)] hover:bg-surface-elevated/70"}`}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </section>

                  </div>
                </div>
              )}
            </div>

            <div ref={permissionBtnRef} className="relative min-w-0 shrink">
              <button disabled={!canUseComposer} onClick={() => setShowPermissionMenu((v) => !v)} className="kimix-icon-text-button kimix-muted-action is-compact max-w-[188px] min-w-0 disabled:cursor-not-allowed disabled:opacity-35">
                <AlertTriangle size={14} className="shrink-0 text-accent-warning" />
                <span className="truncate">{permissionLabel}</span>
                <ChevronDown size={12} className="shrink-0" />
              </button>
              {showPermissionMenu && (
                <div className="kimix-floating-panel absolute bottom-full left-0 z-30 mb-2 w-[216px] rounded-xl" style={{ paddingTop: 12, paddingBottom: 12 }}>
                  {PERMISSION_OPTIONS.map((opt) => {
                    const Icon = permissionMenuIcons[opt.value];
                    return (
                      <button key={opt.value} title={opt.tooltip} onClick={() => void handleSetPermissionMode(opt.value)} style={{ paddingLeft: 18, paddingRight: 18, paddingTop: 13, paddingBottom: 13, minHeight: 40 }} className={`flex w-full items-center gap-3.5 text-left text-[13px] leading-none hover:bg-[var(--kimix-panel-hover)] ${permissionMode === opt.value ? "text-[var(--kimix-panel-text)]" : "text-[var(--kimix-panel-text-secondary)]"}`}>
                        <Icon size={13} className="shrink-0 text-[var(--kimix-panel-text-secondary)]" />
                        <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                        {permissionMode === opt.value && <Check size={13} className="mr-1 shrink-0 text-[var(--kimix-panel-text)]" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              disabled={!canTogglePlanMode}
              onClick={() => void handleTogglePlanMode()}
              className="kimix-icon-text-button kimix-muted-action is-compact min-w-[92px] border disabled:cursor-not-allowed disabled:opacity-35"
              style={{
                borderColor: defaultPlanMode ? "var(--accent-primary-soft)" : "transparent",
                backgroundColor: defaultPlanMode ? "var(--accent-primary-light)" : "transparent",
                color: defaultPlanMode ? "var(--accent-primary-dark)" : undefined,
                boxShadow: defaultPlanMode ? "inset 0 0 0 1px rgba(25, 130, 255, 0.16)" : undefined,
              }}
              title={defaultPlanMode ? "关闭 Plan 模式。Plan 模式会先生成计划，等待确认后再执行。" : "开启 Plan 模式。Plan 模式会先生成计划，等待确认后再执行。"}
              aria-pressed={defaultPlanMode}
            >
              <ClipboardList size={14} className="shrink-0" />
              <span>{defaultPlanMode ? "Plan 开" : "Plan 关"}</span>
            </button>
            <button
              disabled={!canUseComposer}
              onClick={() => {
                if (!canUseComposer) return;
                const next = !defaultThinking;
                setDefaultThinking(next);
                window.dispatchEvent(new CustomEvent("kimix:toast", {
                  detail: next ? "思考开" : "思考关",
                }));
              }}
              className="kimix-icon-text-button kimix-muted-action is-compact min-w-[100px] border disabled:cursor-not-allowed disabled:opacity-35"
              style={{
                borderColor: defaultThinking ? "var(--accent-primary-soft)" : "transparent",
                backgroundColor: defaultThinking ? "var(--accent-primary-light)" : "transparent",
                color: defaultThinking ? "var(--accent-primary-dark)" : undefined,
                boxShadow: defaultThinking ? "inset 0 0 0 1px rgba(25, 130, 255, 0.16)" : undefined,
              }}
              title={defaultThinking ? "关闭思考" : "开启思考"}
              aria-pressed={defaultThinking}
            >
              <Brain size={14} className="shrink-0" />
              <span>{defaultThinking ? "思考开" : "思考关"}</span>
            </button>

            <ContextRing />
            <button disabled={!canUseComposer} onClick={() => void handleVoiceShortcut()} className={iconButtonClass} title={`语音快捷键：${voiceShortcut || "Win+H"}`} aria-label="语音">
              <Mic size={16} />
            </button>

            {shouldShowStopButton ? (
              <>
                {activeSession?.engine === "tui" && canSendNow && (
                  <button
                    onClick={() => void handleSteer()}
                    className="flex h-8 shrink-0 items-center rounded-full bg-accent-primary text-white transition-colors hover:bg-accent-primary-dark"
                    style={{ gap: 6, paddingLeft: 12, paddingRight: 14 }}
                    title="立即引导当前任务：把输入插入运行中的对话（官方 Ctrl+S steer），不进排队"
                    aria-label="引导当前任务"
                  >
                    <Zap size={14} strokeWidth={2.5} className="shrink-0" />
                    <span className="text-[13px]">引导</span>
                  </button>
                )}
                <button onClick={handleStop} className="kimix-strong-action flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:opacity-90" title="停止" aria-label="停止">
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-current" />
                </button>
              </>
            ) : (
              <button onClick={handleSend} disabled={!canSendNow} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${canSendNow ? "bg-accent-primary text-white hover:bg-accent-primary-dark" : "bg-surface-hover text-text-muted"}`} title={editingPendingId ? "保存修改" : "发送"} aria-label={editingPendingId ? "保存修改" : "发送"}>
                <ArrowUp size={17} strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>

      {previewImage && (
        <ImagePreviewOverlay
          image={previewImage}
          onClose={() => setPreviewImage(null)}
          onSaveDrawing={handleSaveDrawingBoard}
        />
      )}

      {drawingBoardRequest && (
        <DrawingBoard
          request={drawingBoardRequest}
          onClose={() => setDrawingBoardRequest(null)}
          onSave={handleSaveDrawingBoard}
        />
      )}
    </div>
  );
}
