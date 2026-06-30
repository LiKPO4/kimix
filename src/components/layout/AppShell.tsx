import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Sidebar } from "./Sidebar";
import { ChatThread } from "@/components/chat/ChatThread";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { Composer } from "@/components/chat/Composer";
import { ContextBar } from "@/components/chat/ContextBar";
import { getVisibleTodos } from "@/components/chat/TodoPanel";
import { getVisibleSwarmAgents } from "@/components/chat/SwarmPanel";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { SearchOverlay } from "./SearchOverlay";
import { SkillsPanel } from "./SkillsPanel";
import { HooksPanel } from "./HooksPanel";
import { LongTasksPanel } from "./LongTasksPanel";
import {
  ArrowLeft,
  ClipboardList,
  ExternalLink,
  FileText,
  LucideIcon,
  MessageSquarePlus,
  Network,
  Target,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { selectSessionById } from "@/stores/selectors";
import type { Session, WorkspaceView } from "@/types/ui";
import type { DownloadUpdateProgress, KimiCliUpdateInfo, KimiCodeBackgroundTaskInfo, LongTaskDetail, LongTaskSummary, PreviewFileInfo } from "@electron/types/ipc";
import { getRuntimeSessionId } from "@/utils/runtimeSession";
import { collectSessionDiffs } from "@/utils/diff";
import { TopMenuBar, type MenuEntry, type MenuAction } from "./TopMenuBar";
import { type DownloadProgressInfo } from "@/utils/format";
import { parseLongTaskDetail, normalizeReviewItem } from "@/utils/longTaskParser";
import { sendDocumentCommand, isInputLike } from "@/utils/dom";
import { findSessionPlanPath, hasSessionPlanSignal } from "@/utils/planPath";
import { clampWidth } from "@/utils/number";
import { persistLocalConversationState } from "@/utils/persistence";
import { DialogSystem } from "./DialogSystem";
import { SessionToolbar } from "./SessionToolbar";
import { DiffPanel } from "./DiffPanel";
import { ToastSystem } from "./ToastSystem";
import { LongTaskInspectorPanel, type BtwPanelState, type LongTaskBackgroundTaskView, type SessionPlanState } from "./LongTaskInspectorPanel";
import { ResizeHandle } from "./ResizeHandle";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import { isTerminalGoalStatus, reconcileOfficialGoalSnapshot } from "@/utils/officialGoalState";
import { normalizeAdditionalWorkDirs } from "@/utils/additionalWorkDirs";

function isBackgroundTaskTerminalStatus(status: string) {
  return ["completed", "failed", "killed", "cancelled", "stopped", "exited"].includes(status);
}

const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 440;
const RIGHT_PANEL_MIN_WIDTH = 280;
const RIGHT_PANEL_MAX_WIDTH = 560;
const EMPTY_BTW_PANEL_STATE: BtwPanelState = {
  input: "",
  loading: false,
  error: null,
  rounds: [],
};
type BtwTransientState = Pick<BtwPanelState, "input" | "loading" | "error">;
const EMPTY_BTW_TRANSIENT_STATE: BtwTransientState = {
  input: "",
  loading: false,
  error: null,
};

function normalizeProjectPath(path: string | undefined) {
  return (path ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isSameProjectPath(a: string | undefined, b: string | undefined) {
  const left = normalizeProjectPath(a);
  const right = normalizeProjectPath(b);
  return Boolean(left && right && left === right);
}

function goalStatusLabel(status: string) {
  if (status === "active") return "进行中";
  if (status === "paused") return "已暂停";
  if (status === "blocked") return "受阻";
  if (status === "complete") return "已完成";
  return status;
}

type HelpDialog = "about" | "updates" | "shortcuts" | "info";
type KimiCodeInstallPhase = NonNullable<DownloadUpdateProgress["phase"]>;
type NavigationEntry = {
  workspaceView: WorkspaceView;
  sessionId: string | null;
};

type ReleaseInfo = {
  tagName: string;
  name: string;
  body: string;
  publishedAt: string;
  htmlUrl: string;
  assets: { name: string; downloadUrl: string }[];
};

type KimiCliOnboardingState = {
  loading: boolean;
  available: boolean | null;
  message: string;
  path?: string;
  output?: string;
  version?: string | null;
  isLegacy?: boolean;
};

const HELP_TOPICS: Record<MenuAction, { title: string; body: string; url?: string }> = {
  automations: {
    title: "自动化",
    body: "自动化用于定时运行任务、跟踪结果，并把重要状态带回当前工作区。",
  },
  "local-environments": {
    title: "本地环境",
    body: "Kimix 会使用本机 Kimi Code 和当前项目目录运行任务，请确认项目依赖和命令环境已经准备好。",
  },
  worktrees: {
    title: "工作树",
    body: "工作树用于为任务准备独立目录和分支，适合并行处理多个互不干扰的改动。",
  },
  skills: {
    title: "插件",
    body: "插件页统一管理 Kimix 扩展能力，包括本地 Skills 与 MCP 服务。",
  },
  mcp: {
    title: "模型上下文协议",
    body: "MCP 已整合进插件页，可查看服务列表、添加服务、测试连接，以及处理 OAuth 授权。",
  },
  troubleshooting: {
    title: "故障排查",
    body: "常见问题：确认 Kimi Code 已安装并登录，项目路径存在，启动日志里 root 内容自检非 0。",
  },
  documentation: {
    title: "Kimix 文档",
    body: "项目文档位于 GitHub 仓库 README，包含开发、构建和发布说明。",
    url: "https://github.com/LiKPO4/kimix",
  },
  "send-feedback": {
    title: "发送反馈",
    body: "反馈会打开 GitHub Issues，你可以在那里提交问题、截图和复现步骤。",
    url: "https://github.com/LiKPO4/kimix/issues",
  },
  "performance-trace": {
    title: "性能跟踪",
    body: "性能跟踪暂未接入。",
  },
  about: { title: "关于 Kimix", body: "" },
  "keyboard-shortcuts": { title: "键盘快捷键", body: "" },
  "whats-new": { title: "更新记录", body: "" },
  "close-chat": { title: "", body: "" },
  "new-window": { title: "", body: "" },
  "new-chat": { title: "", body: "" },
  "quick-chat": { title: "", body: "" },
  "open-project": { title: "", body: "" },
  settings: { title: "", body: "" },
  logout: { title: "", body: "" },
  exit: { title: "", body: "" },
  undo: { title: "", body: "" },
  redo: { title: "", body: "" },
  cut: { title: "", body: "" },
  copy: { title: "", body: "" },
  paste: { title: "", body: "" },
  delete: { title: "", body: "" },
  "select-all": { title: "", body: "" },
  "toggle-sidebar": { title: "", body: "" },
  "toggle-terminal": { title: "", body: "" },
  "open-web-server": { title: "", body: "" },
  "reload-browser-page": { title: "", body: "" },
  "toggle-diff-panel": { title: "", body: "" },
  find: { title: "", body: "" },
  "previous-chat": { title: "", body: "" },
  "next-chat": { title: "", body: "" },
  back: { title: "", body: "" },
  forward: { title: "", body: "" },
  "zoom-in": { title: "", body: "" },
  "zoom-out": { title: "", body: "" },
  "actual-size": { title: "", body: "" },
  "toggle-fullscreen": { title: "", body: "" },
  minimize: { title: "", body: "" },
  "zoom-window": { title: "", body: "" },
  "close-window": { title: "", body: "" },
};

function ProjectFilePreviewViewer({
  file,
  content,
  resolvedPath,
  loading,
  error,
  onBack,
  onOpenFile,
}: {
  file: PreviewFileInfo;
  content: string;
  resolvedPath: string;
  loading: boolean;
  error: string;
  onBack: () => void;
  onOpenFile: () => void;
}) {
  const previewIsMarkdown = file.extension === "md" || file.extension === "markdown";
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-base">
      <div
        className="grid shrink-0 items-center border-b border-border-subtle"
        style={{ gridTemplateColumns: "auto minmax(0, 1fr) auto", columnGap: 14, padding: "14px 22px" }}
      >
        <button
          type="button"
          onClick={onBack}
          className="kimix-icon-text-button kimix-muted-action is-compact"
          style={{ minHeight: 34, paddingLeft: 12, paddingRight: 14 }}
        >
          <ArrowLeft size={15} />
          <span>返回对话</span>
        </button>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center text-[15px] font-semibold leading-5 text-text-primary" style={{ gap: 9 }}>
            <FileText size={16} className="shrink-0 text-text-muted" />
            <span className="min-w-0 truncate" title={file.name}>{file.name}</span>
          </div>
          <div className="mt-1 truncate text-[12.5px] leading-5 text-text-muted" title={resolvedPath || file.path}>
            {resolvedPath || file.path}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenFile}
          className="kimix-icon-text-button kimix-muted-action is-compact"
          style={{ minHeight: 34, paddingLeft: 12, paddingRight: 14 }}
        >
          <ExternalLink size={14} />
          <span>打开</span>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" style={{ padding: "24px 34px 34px" }}>
        <div className="mx-auto w-full max-w-[960px]">
          {loading ? (
            <div className="text-[13.5px] leading-6 text-text-muted">正在读取文件...</div>
          ) : error ? (
            <div className="rounded-lg border border-border-subtle bg-surface-elevated text-[13.5px] leading-6 text-accent-danger" style={{ padding: "16px 18px" }}>
              {error}
            </div>
          ) : previewIsMarkdown ? (
            <MarkdownRenderer content={content || " "} />
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-lg border border-border-subtle bg-surface-elevated font-mono text-[13px] leading-6 text-text-primary" style={{ padding: "18px 20px" }}>
              {content || " "}
            </pre>
          )}
        </div>
      </div>
    </section>
  );
}


export function AppShell() {
  const currentSession = useAppStore((s) => s.currentSession);
  const filePreviewExtensions = useAppStore((s) => s.filePreviewExtensions);
  const currentProject = useAppStore((s) => s.currentProject);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const searchOpen = useAppStore((s) => s.searchOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const workspaceView = useAppStore((s) => s.workspaceView);
  const setWorkspaceView = useAppStore((s) => s.setWorkspaceView);
  const longTaskInspectorOpen = useAppStore((s) => s.longTaskInspectorOpen);
  const setLongTaskInspectorOpen = useAppStore((s) => s.setLongTaskInspectorOpen);
  const diffPanelOpen = useAppStore((s) => s.diffPanelOpen);
  const setDiffPanelOpen = useAppStore((s) => s.setDiffPanelOpen);
  const hiddenComposerCards = useAppStore((s) => s.hiddenComposerCards);
  const setComposerCardHidden = useAppStore((s) => s.setComposerCardHidden);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const defaultPlanMode = useAppStore((s) => s.defaultPlanMode);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setCreatingSessionProjectPath = useAppStore((s) => s.setCreatingSessionProjectPath);
  const addSession = useSessionStore((s) => s.addSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const sessions = useSessionStore((s) => s.sessions);
  const recentProjects = useSessionStore((s) => s.recentProjects);
  const setRecentProjects = useSessionStore((s) => s.setRecentProjects);
  const pendingMessages = useSessionStore((s) => s.pendingMessages);
  const [launchCommandDialogOpen, setLaunchCommandDialogOpen] = useState(false);
  const [launchCommandDraft, setLaunchCommandDraft] = useState("");
  const [pluginPanelTab, setPluginPanelTab] = useState<"skills" | "mcp">("skills");
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [rightPanelWidth, setRightPanelWidth] = useState(320);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<PreviewFileInfo | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const [previewResolvedPath, setPreviewResolvedPath] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const toastTimerRef = useRef<number | null>(null);
  const [helpDialog, setHelpDialog] = useState<HelpDialog | null>(null);
  const [infoTopic, setInfoTopic] = useState<{ title: string; body: string; url?: string } | null>(null);
  const [appInfo, setAppInfo] = useState({ name: "Kimix", version: "2.5.0", author: "@linjianglu", repository: "https://github.com/LiKPO4/kimix" });
  const [updateState, setUpdateState] = useState<{ loading: boolean; downloading: boolean; downloadProgress: DownloadProgressInfo | null; message: string; latest: ReleaseInfo | null; hasUpdate: boolean }>({
    loading: false,
    downloading: false,
    downloadProgress: null,
    message: "尚未检查更新",
    latest: null,
    hasUpdate: false,
  });
  const [cliUpdateState, setCliUpdateState] = useState<{ loading: boolean; updating: boolean; progressStartedAt: number | null; progressPercent: number; progressPhase: KimiCodeInstallPhase | null; message: string; info: KimiCliUpdateInfo | null; hasUpdate: boolean }>({
    loading: false,
    updating: false,
    progressStartedAt: null,
    progressPercent: 0,
    progressPhase: null,
    message: "尚未检查 Kimi Code 更新",
    info: null,
    hasUpdate: false,
  });
  const [longTaskDetail, setLongTaskDetail] = useState<LongTaskDetail | null>(null);
  const [longTaskDetailLoading, setLongTaskDetailLoading] = useState(false);
  const [longTaskDetailError, setLongTaskDetailError] = useState<string | null>(null);
  const [longTaskBackgroundTasks, setLongTaskBackgroundTasks] = useState<LongTaskBackgroundTaskView[]>([]);
  const [longTaskBackgroundTasksLoading, setLongTaskBackgroundTasksLoading] = useState(false);
  const [longTaskBackgroundTasksError, setLongTaskBackgroundTasksError] = useState<string | null>(null);
  const navigationBackStackRef = useRef<NavigationEntry[]>([]);
  const navigationForwardStackRef = useRef<NavigationEntry[]>([]);
  const lastNavigationEntryRef = useRef<NavigationEntry | null>(null);
  const applyingNavigationRef = useRef(false);
  const [targetStepDraft, setTargetStepDraft] = useState("");
  const [targetStepBusy, setTargetStepBusy] = useState(false);
  const [longTaskControlBusy, setLongTaskControlBusy] = useState(false);
  const [sessionLongTasks, setSessionLongTasks] = useState<LongTaskSummary[]>([]);
  const [gitDetailsOpenSignal, setGitDetailsOpenSignal] = useState(0);
  const [sessionLongTasksLoading, setSessionLongTasksLoading] = useState(false);
  const [shutdownAfterLongTaskId, setShutdownAfterLongTaskId] = useState<string | null>(null);
  const [shutdownDialog, setShutdownDialog] = useState<{ taskId: string; taskTitle: string; remainingSeconds: number } | null>(null);
  const scheduledShutdownTaskRef = useRef<string | null>(null);
  const [kimiOnboarding, setKimiOnboarding] = useState<KimiCliOnboardingState>({
    loading: true,
    available: null,
    message: "正在检测 Kimi Code",
  });
  const [kimiOnboardingDismissed, setKimiOnboardingDismissed] = useState(false);
  const [kimiInstallBusy, setKimiInstallBusy] = useState(false);
  const [sessionPlanState, setSessionPlanState] = useState<SessionPlanState>({
    loading: false,
    path: null,
    content: "",
    updatedAt: null,
    error: null,
    message: undefined,
  });
  const [btwTransientBySessionId, setBtwTransientBySessionId] = useState<Record<string, BtwTransientState>>({});

  const startSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = clampWidth(startWidth + moveEvent.clientX - startX, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH);
      setSidebarWidth(nextWidth);
    };
    const stopResize = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    handlePointerMove(event.nativeEvent);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }, [sidebarWidth]);

  const startRightPanelResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rightPanelWidth;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = clampWidth(startWidth + startX - moveEvent.clientX, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH);
      setRightPanelWidth(nextWidth);
    };
    const stopResize = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };

    handlePointerMove(event.nativeEvent);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }, [rightPanelWidth]);

  const checkKimiForOnboarding = async () => {
    setKimiOnboarding((state) => ({ ...state, loading: true, message: "正在检测 Kimi Code" }));
    const res = await window.api.checkKimiCli({ verify: false });
    if (res.success) {
      setKimiOnboarding({
        loading: false,
        available: res.data.available,
        message: res.data.message,
        path: res.data.path,
        output: res.data.output,
        version: res.data.version,
        isLegacy: res.data.isLegacy,
      });
      if (res.data.available && !res.data.isLegacy) setKimiOnboardingDismissed(true);
      return;
    }
    setKimiOnboarding({ loading: false, available: false, message: res.error });
  };

  const installKimiCliFromOnboarding = async () => {
    if (kimiInstallBusy) return;
    setKimiInstallBusy(true);
    setKimiOnboarding((state) => ({
      ...state,
      loading: true,
      message: "正在一键安装 Kimi Code，首次安装可能需要 1-2 分钟",
    }));
      setCliUpdateState((state) => ({
        ...state,
        updating: true,
        progressStartedAt: Date.now(),
        progressPercent: 0,
        progressPhase: null,
        message: "正在安装 Kimi Code，首次安装可能需要 1-2 分钟...",
      }));
    try {
      const res = await window.api.installKimiCli();
      if (!res.success) {
        setKimiOnboarding({ loading: false, available: false, message: res.error });
        setCliUpdateState((state) => ({ ...state, updating: false, progressStartedAt: null, progressPercent: 0, progressPhase: null, message: `安装失败：${res.error}` }));
        return;
      }
      setKimiOnboarding({
        loading: false,
        available: true,
        message: res.data.output || res.data.message,
        path: res.data.path,
        output: res.data.output,
      });
      setKimiOnboardingDismissed(true);
      setWorkspaceView("settings");
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("kimix:focus-auth-settings"));
      }, 120);
      showToast("Kimi Code 已安装，请在设置页完成登录");
      const cliRes = await window.api.checkKimiCliUpdate?.();
      if (cliRes?.success) {
        setCliUpdateState({
          loading: false,
          updating: false,
          progressStartedAt: null,
          progressPercent: 0,
          progressPhase: null,
          message: cliRes.data.message,
          info: cliRes.data,
          hasUpdate: cliRes.data.hasUpdate,
        });
      }
      await checkKimiForOnboarding();
    } finally {
      setCliUpdateState((state) => ({ ...state, updating: false, progressStartedAt: null, progressPercent: 0, progressPhase: null }));
      setKimiInstallBusy(false);
    }
  };

  const showToast = (message = "待实现") => {
    setToastMessage(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 1600);
  };

  useEffect(() => {
    const handleToast = (event: Event) => {
      const detail = event instanceof CustomEvent && typeof event.detail === "string" ? event.detail : "待实现";
      showToast(detail);
    };
    window.addEventListener("kimix:toast", handleToast);
    return () => {
      window.removeEventListener("kimix:toast", handleToast);
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window.api.getAppInfo === "function") {
      void window.api.getAppInfo().then((res) => {
        if (res.success) setAppInfo(res.data);
      });
    }
    void checkKimiForOnboarding();
  }, []);

  useEffect(() => {
    if (typeof window.api.onDownloadUpdateProgress !== "function") return;
    return window.api.onDownloadUpdateProgress((payload) => {
      if (payload.scope === "kimi-code") {
        const phase = payload.phase ?? null;
        const isBinaryDownload = phase === "binary";
        setCliUpdateState((state) => ({
          ...state,
          updating: phase !== "done",
          progressPhase: phase,
          progressPercent: isBinaryDownload ? Math.max(0, Math.min(100, payload.percent)) : 0,
          message: payload.message ?? state.message,
        }));
        return;
      }
      setUpdateState((state) => {
        if (!state.downloading) return state;
        const percent = Math.max(0, Math.min(100, payload.percent));
        return {
          ...state,
          downloadProgress: {
            percent: Number.isFinite(percent) ? percent : state.downloadProgress?.percent ?? 0,
            receivedBytes: payload.receivedBytes,
            totalBytes: payload.totalBytes,
            bytesPerSecond: payload.bytesPerSecond,
          },
        };
      });
    });
  }, []);

  const createSessionForProject = async () => {
    if (!currentProject) return;
    if (useAppStore.getState().creatingSessionProjectPath) return;
    const project = currentProject;
    const previousSession = useAppStore.getState().currentSession;
    const placeholder = {
      id: `creating-${crypto.randomUUID()}`,
      title: "新对话",
      projectPath: project.path,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      events: [],
      isLoading: true,
    };
    setCreatingSessionProjectPath(project.path);
    addSession(placeholder);
    setWorkspaceView("chat");
    setCurrentSession(placeholder);
    try {
      const sessionRes = await window.api.startKimiCodeRuntime({
        workDir: project.path,
        thinking: defaultThinking,
        yoloMode: permissionMode === "yolo",
        autoMode: permissionMode === "auto",
        planMode: defaultPlanMode,
        additionalWorkDirs: normalizeAdditionalWorkDirs(useAppStore.getState().additionalWorkDirs),
      });
      if (!sessionRes.success) {
        deleteSession(placeholder.id);
        setCurrentSession(previousSession?.id === placeholder.id ? null : previousSession);
        return;
      }
      const session = {
        ...placeholder,
        id: sessionRes.data.sessionId,
        isLoading: false,
        updatedAt: Date.now(),
      };
      updateSession(placeholder.id, () => session);
      setCurrentSession(session);
    } finally {
      setCreatingSessionProjectPath(null);
    }
  };

  const handleOpenProject = async () => {
    const res = await window.api.openProject();
    if (!res.success || !res.data) return;
    const data = res.data;
    const existing = recentProjects.find((p) => p.path === data.path);
    const project = existing
      ? { ...existing, lastOpenedAt: Date.now() }
      : { ...data, id: crypto.randomUUID(), lastOpenedAt: Date.now() };
    setCurrentProject(project);
    const recent = await window.api.listRecentProjects();
    if (recent.success) setRecentProjects(recent.data);
  };

  const sortedSessions = useMemo(
    () => sessions.filter((session) => !session.archivedAt && !isHiddenInternalSession(session) && (!currentProject || isSameProjectPath(session.projectPath, currentProject.path))),
    [sessions, currentProject],
  );

  const applyNavigationEntry = (entry: NavigationEntry) => {
    applyingNavigationRef.current = true;
    lastNavigationEntryRef.current = entry;
    setWorkspaceView(entry.workspaceView);
    const targetSession = entry.sessionId
      ? selectSessionById(entry.sessionId)(useSessionStore.getState())
      : null;
    setCurrentSession(targetSession && !targetSession.archivedAt && !isHiddenInternalSession(targetSession) ? targetSession : null);
    window.setTimeout(() => {
      applyingNavigationRef.current = false;
    }, 0);
  };

  const navigateHistory = (direction: "back" | "forward") => {
    const from = lastNavigationEntryRef.current ?? { workspaceView, sessionId: currentSession?.id ?? null };
    const sourceStack = direction === "back" ? navigationBackStackRef.current : navigationForwardStackRef.current;
    const target = sourceStack.pop();
    if (!target) return;
    const destinationStack = direction === "back" ? navigationForwardStackRef.current : navigationBackStackRef.current;
    destinationStack.push(from);
    applyNavigationEntry(target);
  };

  useEffect(() => {
    const nextEntry: NavigationEntry = { workspaceView, sessionId: currentSession?.id ?? null };
    const previous = lastNavigationEntryRef.current;
    if (applyingNavigationRef.current) {
      lastNavigationEntryRef.current = nextEntry;
      return;
    }
    if (!previous) {
      lastNavigationEntryRef.current = nextEntry;
      return;
    }
    if (previous.workspaceView === nextEntry.workspaceView && previous.sessionId === nextEntry.sessionId) return;
    navigationBackStackRef.current.push(previous);
    if (navigationBackStackRef.current.length > 80) navigationBackStackRef.current.shift();
    navigationForwardStackRef.current = [];
    lastNavigationEntryRef.current = nextEntry;
  }, [workspaceView, currentSession?.id]);

  useEffect(() => {
    if (!currentSession || currentSession.archivedAt || isHiddenInternalSession(currentSession)) return;
    if (isSameProjectPath(currentProject?.path, currentSession.projectPath)) return;
    const sessionProject = recentProjects.find((project) => isSameProjectPath(project.path, currentSession.projectPath));
    if (sessionProject) setCurrentProject(sessionProject);
  }, [currentSession?.id, currentSession?.projectPath, currentProject?.path, recentProjects, setCurrentProject]);

  const moveChat = (direction: "previous" | "next") => {
    if (sortedSessions.length === 0) return;
    const currentIndex = Math.max(0, sortedSessions.findIndex((session) => session.id === currentSession?.id));
    const nextIndex = direction === "previous"
      ? (currentIndex - 1 + sortedSessions.length) % sortedSessions.length
      : (currentIndex + 1) % sortedSessions.length;
    setCurrentSession(sortedSessions[nextIndex]);
  };

  const handleCheckUpdates = async () => {
    setUpdateState((state) => ({ ...state, loading: true, message: "正在检查 GitHub 发布版本..." }));
    if (typeof window.api.checkForUpdates !== "function") {
      setUpdateState({ loading: false, downloading: false, downloadProgress: null, message: "更新检查接口尚未载入，请重启应用后再试", latest: null, hasUpdate: false });
      return;
    }
    const res = await window.api.checkForUpdates();
    if (!res.success) {
      setUpdateState({ loading: false, downloading: false, downloadProgress: null, message: `检查失败：${res.error}`, latest: null, hasUpdate: false });
      return;
    }
    setUpdateState((state) => ({
      ...state,
      loading: false,
      downloadProgress: null,
      message: res.data.message,
      latest: res.data.latest,
      hasUpdate: res.data.hasUpdate,
    }));
  };

  const handleDownloadUpdate = async () => {
    setUpdateState((state) => ({ ...state, downloading: true, downloadProgress: { percent: 0, receivedBytes: 0 }, message: "正在下载匹配当前包体的升级包..." }));
    if (typeof window.api.downloadUpdate !== "function") {
      setUpdateState((state) => ({ ...state, downloading: false, downloadProgress: null, message: "升级接口尚未载入，请重启应用后再试" }));
      return;
    }
    const res = await window.api.downloadUpdate();
    if (!res.success) {
      setUpdateState((state) => ({ ...state, downloading: false, downloadProgress: null, message: `升级失败：${res.error}` }));
      return;
    }
    setUpdateState((state) => ({ ...state, downloading: false, downloadProgress: state.downloadProgress ? { ...state.downloadProgress, percent: 100 } : { percent: 100, receivedBytes: 0 }, message: res.data.message }));
    showToast(res.data.message);
  };

  const handleOpenLatestRelease = () => {
    const url = updateState.latest?.htmlUrl || appInfo.repository;
    void window.api.openExternal(url);
  };

  const handleCheckCliUpdate = async () => {
    setCliUpdateState((state) => ({ ...state, loading: true, message: "正在检查 Kimi Code 最新版本..." }));
    if (typeof window.api.checkKimiCliUpdate !== "function") {
      setCliUpdateState({ loading: false, updating: false, progressStartedAt: null, progressPercent: 0, progressPhase: null, message: "Kimi Code 更新检查接口尚未载入，请重启应用后再试", info: null, hasUpdate: false });
      return;
    }
    const res = await window.api.checkKimiCliUpdate();
    if (!res.success) {
      setCliUpdateState({ loading: false, updating: false, progressStartedAt: null, progressPercent: 0, progressPhase: null, message: `Kimi Code 检查失败：${res.error}`, info: null, hasUpdate: false });
      return;
    }
    setCliUpdateState((state) => ({
      ...state,
      loading: false,
      message: res.data.message,
      info: res.data,
      hasUpdate: res.data.hasUpdate,
    }));
    if (res.data.isLegacy || res.data.hasUpdate) setHelpDialog("updates");
  };

  const handleUpdateKimiCli = async () => {
    setCliUpdateState((state) => ({ ...state, updating: true, progressStartedAt: Date.now(), progressPercent: 0, progressPhase: null, message: state.info?.isLegacy ? "正在升级到 Kimi Code，准备下载安装包..." : "正在更新 Kimi Code，准备下载安装包..." }));
    if (typeof window.api.updateKimiCli !== "function") {
      setCliUpdateState((state) => ({ ...state, updating: false, progressStartedAt: null, progressPercent: 0, progressPhase: null, message: "Kimi Code 更新接口尚未载入，请重启应用后再试" }));
      return;
    }
    const res = await window.api.updateKimiCli();
    if (!res.success) {
      setCliUpdateState((state) => ({ ...state, updating: false, progressStartedAt: null, progressPercent: 0, progressPhase: null, message: `Kimi Code 更新失败：${res.error}` }));
      return;
    }
    setCliUpdateState({
      loading: false,
      updating: false,
      progressStartedAt: null,
      progressPercent: 0,
      progressPhase: null,
      message: res.data.message,
      info: res.data,
      hasUpdate: res.data.hasUpdate,
    });
    setKimiOnboarding((state) => ({
      ...state,
      available: true,
      path: res.data.path ?? state.path,
      output: res.data.currentVersion ? `kimi, version ${res.data.currentVersion}` : state.output,
      message: res.data.message,
    }));
    setKimiOnboardingDismissed(true);
    showToast(res.data.message);
  };

  useEffect(() => {
    void (async () => {
      const [appRes, cliRes] = await Promise.all([
        window.api.checkForUpdates?.(),
        window.api.checkKimiCliUpdate?.(),
      ]);
      if (appRes?.success) {
        setUpdateState((state) => ({
          ...state,
          loading: false,
          downloadProgress: null,
          message: appRes.data.message,
          latest: appRes.data.latest,
          hasUpdate: appRes.data.hasUpdate,
        }));
      } else if (appRes && !appRes.success) {
        setUpdateState({ loading: false, downloading: false, downloadProgress: null, message: `检查失败：${appRes.error}`, latest: null, hasUpdate: false });
      }
      if (cliRes?.success) {
        setCliUpdateState((state) => ({
          ...state,
          loading: false,
          message: cliRes.data.message,
          info: cliRes.data,
          hasUpdate: cliRes.data.hasUpdate,
        }));
      } else if (cliRes && !cliRes.success) {
        setCliUpdateState({ loading: false, updating: false, progressStartedAt: null, progressPercent: 0, progressPhase: null, message: `Kimi Code 检查失败：${cliRes.error}`, info: null, hasUpdate: false });
      }
      if (appRes?.success && appRes.data.hasUpdate) showToast(appRes.data.message);
      if (cliRes?.success && cliRes.data.hasUpdate) showToast(cliRes.data.message);
      if (cliRes?.success && cliRes.data.isLegacy) showToast("检测到旧版 Kimi，请升级并迁移到 Kimi Code");
    })();
  }, []);

  const openInfoTopic = (action: MenuAction) => {
    const topic = HELP_TOPICS[action];
    if (!topic?.title) return;
    setInfoTopic(topic);
    setHelpDialog("info");
  };

  const openOfficialPluginMarketplace = async () => {
    return false;
  };

  const openPluginWorkspace = async (tab: "skills" | "mcp") => {
    setPluginPanelTab(tab);
    setWorkspaceView("plugins");
  };

  const handleMenuAction = (entry: MenuEntry) => {
    if (entry.type === "separator") return;
    if (entry.disabled) {
      if (entry.note) {
        setInfoTopic({ title: entry.label, body: entry.note });
        setHelpDialog("info");
      }
      return;
    }

    const action = entry.action;
    if (action === "close-chat") setCurrentSession(null);
    if (action === "new-chat" || action === "quick-chat") void createSessionForProject();
    if (action === "open-project") void handleOpenProject();
    if (action === "settings") setWorkspaceView("settings");
    if (action === "about") setHelpDialog("about");
    if (action === "logout") {
      void window.api.logoutKimi().then((res) => {
        const message = res.success ? res.data.message : `退出失败：${res.error}`;
        showToast(message);
        if (res.success) {
          window.dispatchEvent(new CustomEvent("kimix:kimi-auth-changed"));
        }
      });
    }
    if (action === "exit") void window.api.closeWindow();
    if (action === "undo") sendDocumentCommand("undo");
    if (action === "redo") sendDocumentCommand("redo");
    if (action === "cut") sendDocumentCommand("cut");
    if (action === "copy") sendDocumentCommand("copy");
    if (action === "paste") sendDocumentCommand("paste");
    if (action === "delete" && isInputLike(document.activeElement)) document.activeElement.setRangeText("");
    if (action === "select-all") sendDocumentCommand("selectAll");
    if (action === "toggle-sidebar") toggleSidebar();
    if (action === "toggle-terminal") openProjectTerminal();
    if (action === "open-web-server") {
      void window.api.openKimiCodeWebServer().then((res) => {
        showToast(res.success ? "已打开 Kimi Web Server" : `打开 Web Server 失败：${res.error}`);
      });
    }
    if (action === "toggle-diff-panel") {
      setLongTaskInspectorOpen(false);
      setDiffPanelOpen(!diffPanelOpen);
    }
    if (action === "reload-browser-page") {
      if (typeof window.api.reloadWindow === "function") void window.api.reloadWindow();
      else window.location.reload();
    }
    if (action === "find") setSearchOpen(true);
    if (action === "previous-chat") moveChat("previous");
    if (action === "next-chat") moveChat("next");
    if (action === "back") navigateHistory("back");
    if (action === "forward") navigateHistory("forward");
    if (action === "zoom-in" && typeof window.api.setZoomLevel === "function") void window.api.setZoomLevel(0.5);
    if (action === "zoom-out" && typeof window.api.setZoomLevel === "function") void window.api.setZoomLevel(-0.5);
    if (action === "actual-size" && typeof window.api.resetZoom === "function") void window.api.resetZoom();
    if (action === "toggle-fullscreen" && typeof window.api.toggleFullScreen === "function") void window.api.toggleFullScreen();
    if (action === "minimize") void window.api.minimizeWindow();
    if (action === "zoom-window") void window.api.maximizeWindow();
    if (action === "close-window") void window.api.closeWindow();
    if (action === "documentation" || action === "send-feedback") {
      const topic = HELP_TOPICS[action];
      if (topic.url) void window.api.openExternal(topic.url);
      openInfoTopic(action);
    }
    if (action === "whats-new") setHelpDialog("updates");
    if (action === "keyboard-shortcuts") setHelpDialog("shortcuts");
    if (action === "skills") {
      void openPluginWorkspace("skills");
    }
    if (action === "mcp") {
      void openPluginWorkspace("mcp");
    }
    if (["automations", "local-environments", "worktrees", "troubleshooting", "performance-trace", "new-window"].includes(action)) {
      openInfoTopic(action);
    }
  };

  const liveCurrentSession = useMemo(
    () => selectSessionById(currentSession?.id)(useSessionStore.getState()) ?? currentSession,
    [sessions, currentSession],
  );
  const longTaskMeta = liveCurrentSession?.longTask;
  const hasLongTaskMeta = Boolean(longTaskMeta);
  const liveCurrentSessionProjectPath = liveCurrentSession?.projectPath;
  const parsedLongTaskDetail = useMemo(() => parseLongTaskDetail(longTaskDetail), [longTaskDetail]);
  const reviewedReviewItems = useMemo(() => new Set((longTaskMeta?.reviewedReviewItems ?? []).map(normalizeReviewItem)), [longTaskMeta?.reviewedReviewItems]);
  const pendingReviewItems = useMemo(
    () => (parsedLongTaskDetail?.reviewItems ?? []).filter((item) => !reviewedReviewItems.has(normalizeReviewItem(item))),
    [parsedLongTaskDetail?.reviewItems, reviewedReviewItems],
  );
  const completedReviewItems = useMemo(
    () => (parsedLongTaskDetail?.reviewItems ?? []).filter((item) => reviewedReviewItems.has(normalizeReviewItem(item))),
    [parsedLongTaskDetail?.reviewItems, reviewedReviewItems],
  );
  const totalLongTaskSteps = parsedLongTaskDetail?.steps.length ?? 0;
  const longTaskEventCount = liveCurrentSession?.events.length ?? 0;
  const sessionTitle = liveCurrentSession?.title || "新对话";
  const projectPath = currentProject?.path;
  const previewProjectPath = liveCurrentSession?.projectPath ?? currentProject?.path;
  const isCurrentSessionRunning = Boolean(liveCurrentSession && runningSessionId === liveCurrentSession.id);
  const longTaskStatusTone = "executor";
  const sessionDiffs = useMemo(
    () => collectSessionDiffs(liveCurrentSession?.events ?? []),
    [liveCurrentSession?.events],
  );
  const latestTodos = useMemo(() => getVisibleTodos(liveCurrentSession?.events ?? []), [liveCurrentSession?.events]);
  const visibleSwarmAgents = useMemo(() => getVisibleSwarmAgents(liveCurrentSession?.events ?? []), [liveCurrentSession?.events]);
  const composerCardSessionId = liveCurrentSession?.id ?? "__global__";
  const btwSessionId = liveCurrentSession?.id ?? "__global__";

  useEffect(() => {
    setPreviewFile(null);
    setPreviewContent("");
    setPreviewResolvedPath("");
    setPreviewError("");
  }, [previewProjectPath]);

  useEffect(() => {
    if (!diffPanelOpen) {
      setPreviewFile(null);
      setPreviewContent("");
      setPreviewResolvedPath("");
      setPreviewError("");
    }
  }, [diffPanelOpen]);

  useEffect(() => {
    if (!previewProjectPath || !previewFile) return;
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError("");
    setPreviewContent("");
    setPreviewResolvedPath("");
    window.api.readTextFile({
      projectPath: previewProjectPath,
      sessionId: liveCurrentSession ? getRuntimeSessionId(liveCurrentSession) : undefined,
      path: previewFile.path,
    }).then((res) => {
      if (cancelled) return;
      setPreviewLoading(false);
      if (!res.success) {
        setPreviewError(`读取文件失败：${res.error}`);
        return;
      }
      setPreviewContent(res.data.content);
      setPreviewResolvedPath(res.data.path);
    }).catch((err) => {
      if (cancelled) return;
      setPreviewLoading(false);
      setPreviewError(`读取文件失败：${err instanceof Error ? err.message : String(err)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [liveCurrentSession?.id, liveCurrentSession?.runtimeSessionId, liveCurrentSession?.officialSessionId, previewProjectPath, previewFile?.path]);

  const btwTransientState = btwTransientBySessionId[btwSessionId] ?? EMPTY_BTW_TRANSIENT_STATE;
  const btwState: BtwPanelState = liveCurrentSession
    ? { ...btwTransientState, rounds: liveCurrentSession.btwRounds ?? [] }
    : EMPTY_BTW_PANEL_STATE;
  const hiddenComposerCardList = hiddenComposerCards[composerCardSessionId] ?? [];
  const rawCurrentGoal = liveCurrentSession?.officialGoal?.goal ?? null;
  const currentGoal = rawCurrentGoal && !isTerminalGoalStatus(rawCurrentGoal.status) ? rawCurrentGoal : null;
  const currentGoalStatus = currentGoal?.status ?? "";
  const hasVisibleGoalModeCard = Boolean(currentGoal && !["complete", "cancelled", "canceled"].includes(currentGoalStatus));
  const hiddenComposerCardEntries = [
    hiddenComposerCardList.includes("todo") && latestTodos.length > 0
      ? {
          key: "todo" as const,
          title: "TodoList",
          desc: `${latestTodos.filter((item) => item.status === "done").length}/${latestTodos.length} 已完成`,
          icon: ClipboardList,
        }
      : null,
    hiddenComposerCardList.includes("pending") && pendingMessages.length > 0
      ? {
          key: "pending" as const,
          title: "排队消息",
          desc: `${pendingMessages.length} 条消息正在排队`,
          icon: MessageSquarePlus,
        }
      : null,
    hiddenComposerCardList.includes("swarm") && visibleSwarmAgents.length > 0
      ? {
          key: "swarm" as const,
          title: "Swarm 子进程",
          desc: `${visibleSwarmAgents.filter((agent) => agent.status === "completed").length}/${visibleSwarmAgents.length} 已完成`,
          icon: Network,
        }
      : null,
    hiddenComposerCardList.includes("goal") && hasVisibleGoalModeCard
      ? {
          key: "goal" as const,
          title: "官方 Goal",
          desc: `${currentGoalStatus ? goalStatusLabel(currentGoalStatus) : "进行中"} · ${currentGoal?.objective ?? ""}`,
          icon: Target,
        }
      : null,
  ].filter((item): item is { key: "todo" | "pending" | "goal" | "swarm"; title: string; desc: string; icon: LucideIcon } => Boolean(item));
  const visibleSessionLongTasks = useMemo(() => {
    const activeTaskIds = new Set(
      sessions
        .filter((session) => !session.archivedAt && session.longTask)
        .map((session) => session.longTask?.taskId)
        .filter((taskId): taskId is string => Boolean(taskId)),
    );
    return sessionLongTasks.filter((task) => activeTaskIds.has(task.id));
  }, [sessionLongTasks, sessions]);
  const sessionPlanPath = useMemo(
    () => {
      const events = liveCurrentSession?.events ?? [];
      return findSessionPlanPath(events) ?? (hasSessionPlanSignal(events) ? "__latest_kimi_plan__" : null);
    },
    [liveCurrentSession?.events],
  );
  const rightPanelTitle = longTaskMeta ? "长程任务" : "会话侧栏";
  const rightPanelSubtitle = longTaskMeta
    ? longTaskMeta.title
    : sessionPlanPath
      ? "已捕获当前会话 Plan"
      : "Plan、变更和会话信息";

  const setReviewItemChecked = (item: string, checked: boolean) => {
    if (!liveCurrentSession?.longTask) return;
    const normalized = normalizeReviewItem(item);
    let latestSession = liveCurrentSession;
    updateSession(liveCurrentSession.id, (session) => {
      if (!session.longTask) return session;
      const current = session.longTask.reviewedReviewItems ?? [];
      const currentSet = new Set(current.map(normalizeReviewItem));
      if (checked) currentSet.add(normalized);
      else currentSet.delete(normalized);
      latestSession = {
        ...session,
        longTask: {
          ...session.longTask,
          reviewedReviewItems: Array.from(currentSet),
        },
        updatedAt: Date.now(),
      };
      return latestSession;
    });
    setCurrentSession(latestSession);
    if (latestSession.longTask) {
      void window.api.updateLongTaskState({
        projectPath: latestSession.projectPath,
        taskId: latestSession.longTask.taskId,
        patch: {
          stage: latestSession.longTask.stage,
          activeAgent: latestSession.longTask.activeAgent,
          recovery: latestSession.longTask.recovery ?? null,
          currentStep: latestSession.longTask.currentStep,
          targetStep: latestSession.longTask.targetStep,
          reviewedReviewItems: latestSession.longTask.reviewedReviewItems ?? [],
        },
      }).catch(() => {});
    }
  };

  const persistLongTaskTarget = async (session: Session) => {
    if (!session.longTask) return;
    await window.api.updateLongTaskState({
      projectPath: session.projectPath,
      taskId: session.longTask.taskId,
      patch: {
        stage: session.longTask.stage,
        activeAgent: session.longTask.activeAgent,
        recovery: session.longTask.recovery ?? null,
        currentStep: session.longTask.currentStep,
        targetStep: session.longTask.targetStep,
        reviewedReviewItems: session.longTask.reviewedReviewItems ?? [],
      },
    });
  };

  const persistLongTaskSession = async (session: Session) => {
    if (!session.longTask) return;
    await window.api.updateLongTaskState({
      projectPath: session.projectPath,
      taskId: session.longTask.taskId,
      patch: {
        stage: session.longTask.stage,
        activeAgent: session.longTask.activeAgent,
        recovery: session.longTask.recovery ?? null,
        currentStep: session.longTask.currentStep,
        targetStep: session.longTask.targetStep,
        reviewedReviewItems: session.longTask.reviewedReviewItems ?? [],
      },
    });
  };

  const patchLongTaskMeta = async (
    patch: Partial<NonNullable<Session["longTask"]>>,
    options?: { stopRunning?: boolean; message?: string },
  ) => {
    if (!liveCurrentSession?.longTask || longTaskControlBusy) return;
    setLongTaskControlBusy(true);
    let latestSession = liveCurrentSession;
	    try {
	      if (options?.stopRunning) {
	        // 长任务需按 activeAgent 选择正确的 runtime，而非总是 executor
	        const longTask = liveCurrentSession.longTask;
	        const runtimeSessionId = longTask && longTask.activeAgent === "reviewer" && longTask.reviewerSessionId !== longTask.executorSessionId
	          ? longTask.reviewerSessionId
	          : (getRuntimeSessionId(liveCurrentSession) ?? liveCurrentSession.id);
	        await window.api.cancelKimiCodeTurn({ sessionId: runtimeSessionId }).catch(() => ({ success: true as const, data: undefined }));
	      }
      updateSession(liveCurrentSession.id, (session) => {
        if (!session.longTask) return session;
        const nextMeta = {
          ...session.longTask,
          ...patch,
          activeAgent: "executor" as const,
          recovery: patch.recovery !== undefined
            ? patch.recovery
            : options?.stopRunning
              ? {
                  status: "paused" as const,
                  reason: "用户暂停了长程任务",
                  suggestedAction: "确认当前状态后点击继续，或复制下一步 prompt 手动恢复。",
                  updatedAt: Date.now(),
                }
              : session.longTask.recovery,
        };
        const runtimeSessionId = nextMeta.executorSessionId;
        latestSession = {
          ...session,
          runtimeSessionId,
          longTask: nextMeta,
          updatedAt: Date.now(),
        };
        return latestSession;
      });
      setCurrentSession(latestSession);
      await persistLongTaskSession(latestSession);
      if (options?.stopRunning && runningSessionId === liveCurrentSession.id) {
        setRunningSessionId(null);
      }
      showToast(options?.message ?? "已更新长程任务状态");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
    } finally {
      setLongTaskControlBusy(false);
    }
  };

  const buildNextLongTaskPrompt = () => {
    if (!longTaskMeta) return "";
    const nextStep = Math.max(longTaskMeta.currentStep || 1, 1);
    const target = longTaskMeta.targetStep ?? nextStep;
    const isFinalStep = nextStep >= target;
    return `【Kimix 长程任务：手动执行 Step ${nextStep}】
请先阅读 ${longTaskMeta.bigPlanPath}。

本次整体目标是执行到 Step ${target}，但本轮只允许执行 Step ${nextStep}。
若规划尚未完成，请先完善 BIGPLAN 并请求用户确认；若已经可以执行，请直接执行 Step ${nextStep}。
完成后写入 rounds/ 记录，包含本轮产出、验证证据和残余风险。
不要启动、模拟或等待额外审查流程；不要输出 kimix-long-task-status 或任何机器状态代码块。
${isFinalStep
  ? "这是目标范围内最后一个 Step。完成后请输出最终结果和建议用户全盘审查的内容，并明确写出“长程任务执行完成”。"
  : `完成后明确写出“Step ${nextStep} 执行完成，继续下一步”，然后停止本轮输出，等待 Kimix 自动调度 Step ${nextStep + 1}。`}`;
  };

  const copyNextLongTaskPrompt = async () => {
    const prompt = buildNextLongTaskPrompt();
    if (!prompt) {
      showToast("当前没有可复制的长程任务提示词");
      return;
    }
    await copyToClipboard(prompt, "已复制下一步 prompt");
  };

  const applyTargetStep = async (startNow: boolean) => {
    if (!liveCurrentSession?.longTask || targetStepBusy) return;
    const draftNumber = Number(targetStepDraft);
    // 恢复场景（startNow === true）下 draft 为空时回退到持久化的 targetStep
    const target = (Number.isInteger(draftNumber) && draftNumber >= 1)
      ? draftNumber
      : (startNow ? liveCurrentSession.longTask.targetStep : 0);
    if (!Number.isInteger(target) || target < 1) {
      showToast("请输入有效步骤");
      return;
    }
    if (totalLongTaskSteps > 0 && target > totalLongTaskSteps) {
      showToast(`最多到 Step ${totalLongTaskSteps}`);
      return;
    }
    if (target < liveCurrentSession.longTask.currentStep) {
      showToast("目标步骤不能小于当前步骤");
      return;
    }

    setTargetStepBusy(true);
    let latestSession = liveCurrentSession;
    const wasRecovering = Boolean(liveCurrentSession.longTask.recovery && liveCurrentSession.longTask.recovery.status !== "none");
    try {
      updateSession(liveCurrentSession.id, (session) => {
        if (!session.longTask) return session;
        const stage = startNow && ["drafting", "planning", "ready", "paused"].includes(session.longTask.stage)
          ? "running"
          : session.longTask.stage;
        const recovery = startNow ? null : session.longTask.recovery;
        latestSession = {
          ...session,
          runtimeSessionId: session.longTask.executorSessionId,
          longTask: {
            ...session.longTask,
            activeAgent: "executor",
            stage,
            recovery,
            targetStep: target,
          },
          updatedAt: Date.now(),
        };
        return latestSession;
      });
      setCurrentSession(latestSession);
      await persistLongTaskTarget(latestSession);

      if (!startNow) {
        showToast(`已设置执行到 Step ${target}`);
        return;
      }
      if (runningSessionId) {
        showToast("已有任务运行中，已先保存目标步骤");
        return;
      }

      const nextStep = Math.max(latestSession.longTask?.currentStep ?? 1, 1);
      const isFinalStep = nextStep >= target;
      const prompt = `【Kimix 长程任务：执行到 Step ${target}】
这是 Kimix 内部调度指令。请先阅读 ${latestSession.longTask?.bigPlanPath}。

本次整体目标是最终执行到 Step ${target}，但本轮只允许执行 Step ${nextStep}。

执行规则：
1. 如果当前还没有完成规划，请先完善 BIGPLAN，并请求用户确认进入执行阶段。
2. 如果已经可以执行，请不要询问用户是否继续，直接执行 Step ${nextStep}。
3. 只执行 Step ${nextStep}，不要合并后续多个 Step。
4. 完成后必须写入 rounds/ 记录，包含本轮产出、验证证据和残余风险。
5. 不要启动、模拟或等待额外审查流程；不要输出 kimix-long-task-status 或任何机器状态代码块。
${isFinalStep
  ? "6. 这是目标范围内最后一个 Step。完成后请输出最终结果和建议用户全盘审查的内容，并明确写出“长程任务执行完成”。"
  : `6. 完成 Step ${nextStep} 后必须立刻停止本轮输出，并明确写出“Step ${nextStep} 执行完成，继续下一步”。即使 Step ${target} 还未达到，也等待 Kimix 自动调度 Step ${nextStep + 1}。`}`;
      updateSession(latestSession.id, (session) => ({
        ...session,
        events: [
          ...session.events,
          {
            id: crypto.randomUUID(),
            type: "assistant_message" as const,
            timestamp: Date.now(),
            content: "",
            isThinking: defaultThinking,
            isComplete: false,
          },
        ],
        updatedAt: Date.now(),
      }));
      setCurrentSession(useSessionStore.getState().sessions.find((session) => session.id === latestSession.id) ?? latestSession);
      setRunningSessionId(latestSession.id);
      const res = await window.api.sendKimiCodePrompt({
        sessionId: latestSession.longTask?.executorSessionId ?? latestSession.runtimeSessionId ?? latestSession.id,
        content: prompt,
        thinking: defaultThinking,
        yoloMode: permissionMode === "yolo",
        autoMode: permissionMode === "auto",
      });
      if (!res.success) throw new Error(res.error);
      showToast(wasRecovering ? "已继续长程任务" : "已启动长程任务");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err));
      setRunningSessionId(null);
    } finally {
      setTargetStepBusy(false);
    }
  };

  const refreshLongTaskDetail = (options?: { silent?: boolean }) => {
    if (!longTaskInspectorOpen || !liveCurrentSession?.longTask) {
      setLongTaskDetail(null);
      setLongTaskDetailError(null);
      setLongTaskDetailLoading(false);
      return;
    }

    const { taskId } = liveCurrentSession.longTask;
    if (!options?.silent) setLongTaskDetailLoading(true);
    setLongTaskDetailError(null);
    void window.api.getLongTaskDetail({ projectPath: liveCurrentSession.projectPath, taskId }).then((res) => {
      if (res.success) {
        setLongTaskDetail(res.data);
      } else {
        setLongTaskDetail(null);
        setLongTaskDetailError(res.error);
      }
    }).catch((err: unknown) => {
      setLongTaskDetail(null);
      setLongTaskDetailError(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      if (!options?.silent) setLongTaskDetailLoading(false);
    });
  };

  const refreshLongTaskBackgroundTasks = useCallback((options?: { silent?: boolean }) => {
    const meta = liveCurrentSession?.longTask;
    if (!longTaskInspectorOpen || !meta) {
      setLongTaskBackgroundTasks([]);
      setLongTaskBackgroundTasksLoading(false);
      setLongTaskBackgroundTasksError(null);
      return;
    }
    const targets = [
      { role: "executor" as const, runtimeSessionId: meta.executorSessionId },
    ].filter((target, index, list) => (
      Boolean(target.runtimeSessionId) &&
      list.findIndex((item) => item.runtimeSessionId === target.runtimeSessionId) === index
    ));
    if (!options?.silent) setLongTaskBackgroundTasksLoading(true);
    setLongTaskBackgroundTasksError(null);
    void Promise.all(targets.map(async (target) => {
      const res = await window.api.listKimiCodeBackgroundTasks({
        sessionId: target.runtimeSessionId,
        activeOnly: false,
        limit: 20,
      });
      if (!res.success) throw new Error(`长程任务：${res.error}`);
      return res.data.map((task: KimiCodeBackgroundTaskInfo): LongTaskBackgroundTaskView => ({
        ...task,
        role: target.role,
        runtimeSessionId: target.runtimeSessionId,
      }));
    })).then((groups) => {
      setLongTaskBackgroundTasks(groups.flat().sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)));
    }).catch((err: unknown) => {
      setLongTaskBackgroundTasksError(err instanceof Error ? err.message : String(err));
    }).finally(() => {
      if (!options?.silent) setLongTaskBackgroundTasksLoading(false);
    });
  }, [
    liveCurrentSession?.longTask?.executorSessionId,
    longTaskInspectorOpen,
  ]);

  const copyBackgroundTaskOutput = async (task: LongTaskBackgroundTaskView) => {
    const res = await window.api.getKimiCodeBackgroundTaskOutput({
      sessionId: task.runtimeSessionId,
      taskId: task.taskId,
      tail: 6000,
    });
    if (!res.success) {
      showToast(`读取输出失败：${res.error}`);
      return;
    }
    await copyToClipboard(res.data || "当前后台任务没有输出。", "已复制后台任务输出");
  };

  const stopBackgroundTask = async (task: LongTaskBackgroundTaskView) => {
    const res = await window.api.stopKimiCodeBackgroundTask({
      sessionId: task.runtimeSessionId,
      taskId: task.taskId,
      reason: "Kimix 用户在长程任务侧栏停止后台任务",
    });
    if (!res.success) {
      showToast(`停止失败：${res.error}`);
      return;
    }
    showToast("已请求停止后台任务");
    refreshLongTaskBackgroundTasks({ silent: true });
  };

  const refreshSessionPlan = useCallback((options?: { silent?: boolean }) => {
    if (!longTaskInspectorOpen || hasLongTaskMeta || !liveCurrentSessionProjectPath) {
      setSessionPlanState({ loading: false, path: null, content: "", updatedAt: null, error: null, message: undefined });
      return;
    }
    const pathToRead = sessionPlanPath ?? "__latest_kimi_plan__";
    if (!options?.silent) {
      setSessionPlanState((state) => ({ ...state, loading: true, path: sessionPlanPath, error: null }));
    }
    void window.api.readTextFile({
      projectPath: liveCurrentSessionProjectPath,
      sessionId: liveCurrentSession ? getRuntimeSessionId(liveCurrentSession) : undefined,
      path: pathToRead,
    }).then((res) => {
      if (res.success) {
        setSessionPlanState({
          loading: false,
          path: res.data.path,
          content: res.data.content,
          updatedAt: res.data.updatedAt,
          error: null,
          message: res.data.message,
        });
      } else {
        setSessionPlanState({ loading: false, path: sessionPlanPath, content: "", updatedAt: null, error: res.error, message: undefined });
      }
    }).catch((err: unknown) => {
      setSessionPlanState({
        loading: false,
        path: sessionPlanPath,
        content: "",
        updatedAt: null,
        error: err instanceof Error ? err.message : String(err),
        message: undefined,
      });
    });
  }, [
    hasLongTaskMeta,
    liveCurrentSession?.id,
    liveCurrentSession?.officialSessionId,
    liveCurrentSession?.runtimeSessionId,
    liveCurrentSessionProjectPath,
    longTaskInspectorOpen,
    sessionPlanPath,
  ]);

  const refreshSessionLongTasks = useCallback((options?: { silent?: boolean }) => {
    const pathForTasks = liveCurrentSession?.projectPath ?? currentProject?.path;
    if (!longTaskInspectorOpen || longTaskMeta || !pathForTasks) {
      setSessionLongTasks([]);
      setSessionLongTasksLoading(false);
      return;
    }
    if (!options?.silent) setSessionLongTasksLoading(true);
    void window.api.listLongTasks({ projectPath: pathForTasks }).then((res) => {
      setSessionLongTasks(res.success ? res.data : []);
    }).catch(() => setSessionLongTasks([])).finally(() => {
      if (!options?.silent) setSessionLongTasksLoading(false);
    });
  }, [currentProject?.path, liveCurrentSession?.projectPath, longTaskInspectorOpen, longTaskMeta]);

  useEffect(() => {
    refreshLongTaskDetail();
  }, [longTaskInspectorOpen, liveCurrentSession?.id, liveCurrentSession?.longTask?.taskId, liveCurrentSession?.projectPath]);

  useEffect(() => {
    refreshLongTaskBackgroundTasks();
  }, [refreshLongTaskBackgroundTasks]);

  useEffect(() => {
    refreshSessionPlan();
  }, [refreshSessionPlan]);

  useEffect(() => {
    refreshSessionLongTasks();
  }, [refreshSessionLongTasks]);

  useEffect(() => {
    if (!longTaskInspectorOpen || !liveCurrentSession?.longTask) return;
    refreshLongTaskDetail({ silent: true });
  }, [longTaskInspectorOpen, liveCurrentSession?.longTask?.taskId, longTaskEventCount]);

  useEffect(() => {
    if (!longTaskInspectorOpen || !liveCurrentSession?.longTask) return;
    const timer = window.setInterval(() => refreshLongTaskDetail({ silent: true }), 3000);
    return () => window.clearInterval(timer);
  }, [longTaskInspectorOpen, liveCurrentSession?.id, liveCurrentSession?.longTask?.taskId, liveCurrentSession?.projectPath]);

  useEffect(() => {
    if (!longTaskInspectorOpen || !liveCurrentSession?.longTask) return;
    const hasRunningTask = longTaskBackgroundTasks.some((task) => !isBackgroundTaskTerminalStatus(task.status));
    const timer = window.setInterval(() => refreshLongTaskBackgroundTasks({ silent: true }), hasRunningTask ? 2000 : 5000);
    return () => window.clearInterval(timer);
  }, [longTaskBackgroundTasks, longTaskInspectorOpen, liveCurrentSession?.id, liveCurrentSession?.longTask?.taskId, refreshLongTaskBackgroundTasks]);

  useEffect(() => {
    if (!liveCurrentSession?.longTask) {
      setTargetStepDraft("");
      return;
    }
    setTargetStepDraft(liveCurrentSession.longTask.targetStep ? String(liveCurrentSession.longTask.targetStep) : "");
  }, [liveCurrentSession?.longTask?.taskId, liveCurrentSession?.longTask?.targetStep]);

  useEffect(() => {
    const task = liveCurrentSession?.longTask;
    if (!task || shutdownAfterLongTaskId !== task.taskId) return;
    if (task.stage !== "completed") return;
    if (scheduledShutdownTaskRef.current === task.taskId) return;
    scheduledShutdownTaskRef.current = task.taskId;
    setShutdownDialog({ taskId: task.taskId, taskTitle: task.title, remainingSeconds: 180 });
    void window.api.scheduleShutdown({
      delaySeconds: 180,
      reason: `Kimix 长程任务「${task.title}」执行完成`,
    }).then((res) => {
      if (!res.success) {
        setShutdownDialog(null);
        scheduledShutdownTaskRef.current = null;
        showToast(res.error);
      }
    });
  }, [liveCurrentSession?.longTask?.taskId, liveCurrentSession?.longTask?.stage, shutdownAfterLongTaskId]);

  useEffect(() => {
    if (!shutdownDialog) return;
    const timer = window.setInterval(() => {
      setShutdownDialog((current) => {
        if (!current) return current;
        return { ...current, remainingSeconds: Math.max(0, current.remainingSeconds - 1) };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [shutdownDialog?.taskId]);

  const cancelScheduledShutdown = async () => {
    const res = await window.api.cancelShutdown();
    if (!res.success) {
      showToast(res.error);
      return;
    }
    setShutdownDialog(null);
    scheduledShutdownTaskRef.current = null;
    setShutdownAfterLongTaskId(null);
    showToast("已取消关机");
  };

  const copyToClipboard = async (text: string, successMessage = "已复制") => {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  };
  const syncOfficialGoalState = (sessionId: string, goal: NonNullable<Session["officialGoal"]>["goal"], error?: string | null) => {
    updateSession(sessionId, (session) => ({
      ...session,
      officialGoal: {
        goal: reconcileOfficialGoalSnapshot(goal, session.officialGoal?.goal),
        error: error ?? null,
        updatedAt: Date.now(),
      },
      updatedAt: Date.now(),
    }));
    const latest = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
    if (latest && currentSession?.id === sessionId) setCurrentSession(latest);
  };
  const ensureOfficialGoalRuntime = async () => {
    if (!liveCurrentSession) {
      showToast("请先选择一个会话");
      return null;
    }
    const existing = getRuntimeSessionId(liveCurrentSession);
    if (existing) {
      const res = await window.api.resumeKimiCodeSession({
        sessionId: existing,
        additionalWorkDirs: normalizeAdditionalWorkDirs(useAppStore.getState().additionalWorkDirs),
      });
      if (!res.success) throw new Error(res.error);
      updateSession(liveCurrentSession.id, (session) => ({
        ...session,
        engine: "kimi-code",
        runtimeSessionId: res.data.sessionId,
        officialSessionId: res.data.sessionId,
        updatedAt: Date.now(),
      }));
      return { uiSessionId: liveCurrentSession.id, runtimeSessionId: res.data.sessionId };
    }
    const res = await window.api.createKimiCodeSession({
      workDir: liveCurrentSession.projectPath,
      permission: permissionMode,
      planMode: defaultPlanMode,
      additionalWorkDirs: normalizeAdditionalWorkDirs(useAppStore.getState().additionalWorkDirs),
    });
    if (!res.success) throw new Error(res.error);
    updateSession(liveCurrentSession.id, (session) => ({
      ...session,
      engine: "kimi-code",
      runtimeSessionId: res.data.sessionId,
      officialSessionId: res.data.sessionId,
      updatedAt: Date.now(),
    }));
    return { uiSessionId: liveCurrentSession.id, runtimeSessionId: res.data.sessionId };
  };
  const refreshOfficialGoal = async () => {
    try {
      const runtime = await ensureOfficialGoalRuntime();
      if (!runtime) return;
      const res = await window.api.getKimiCodeGoal({ sessionId: runtime.runtimeSessionId });
      if (!res.success) {
        syncOfficialGoalState(runtime.uiSessionId, null, res.error);
        showToast(`官方 Goal 读取失败：${res.error}`);
        return;
      }
      syncOfficialGoalState(runtime.uiSessionId, res.data.goal);
      showToast(res.data.goal ? "已刷新官方 Goal" : "当前没有官方 Goal");
    } catch (err) {
      showToast(`官方 Goal 读取失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const createOfficialGoal = async (objective: string, replace?: boolean) => {
    try {
      const runtime = await ensureOfficialGoalRuntime();
      if (!runtime) return;
      const res = await window.api.createKimiCodeGoal({ sessionId: runtime.runtimeSessionId, objective, replace });
      if (!res.success) {
        syncOfficialGoalState(runtime.uiSessionId, null, res.error);
        showToast(`官方 Goal 启动失败：${res.error}`);
        return;
      }
      syncOfficialGoalState(runtime.uiSessionId, res.data.goal);
      showToast(replace ? "已替换官方 Goal" : "已启动官方 Goal");
    } catch (err) {
      showToast(`官方 Goal 启动失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const pauseOfficialGoal = async () => {
    try {
      const runtime = await ensureOfficialGoalRuntime();
      if (!runtime) return;
      const res = await window.api.pauseKimiCodeGoal({ sessionId: runtime.runtimeSessionId, reason: "Paused from Kimix sidebar" });
      if (!res.success) {
        showToast(`官方 Goal 暂停失败：${res.error}`);
        return;
      }
      syncOfficialGoalState(runtime.uiSessionId, res.data.goal);
      showToast("已暂停官方 Goal");
    } catch (err) {
      showToast(`官方 Goal 暂停失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const resumeOfficialGoal = async () => {
    try {
      const runtime = await ensureOfficialGoalRuntime();
      if (!runtime) return;
      const res = await window.api.resumeKimiCodeGoal({ sessionId: runtime.runtimeSessionId, reason: "Resumed from Kimix sidebar" });
      if (!res.success) {
        showToast(`官方 Goal 继续失败：${res.error}`);
        return;
      }
      syncOfficialGoalState(runtime.uiSessionId, res.data.goal);
      showToast("已继续官方 Goal");
    } catch (err) {
      showToast(`官方 Goal 继续失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const cancelOfficialGoal = async () => {
    try {
      const runtime = await ensureOfficialGoalRuntime();
      if (!runtime) return;
      const res = await window.api.cancelKimiCodeGoal({ sessionId: runtime.runtimeSessionId, reason: "Cancelled from Kimix sidebar" });
      if (!res.success) {
        showToast(`官方 Goal 取消失败：${res.error}`);
        return;
      }
      syncOfficialGoalState(runtime.uiSessionId, null);
      showToast("已取消官方 Goal");
    } catch (err) {
      showToast(`官方 Goal 取消失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const updateBtwTransientState = (sessionId: string, patch: Partial<BtwTransientState>) => {
    setBtwTransientBySessionId((current) => ({
      ...current,
      [sessionId]: { ...(current[sessionId] ?? EMPTY_BTW_TRANSIENT_STATE), ...patch },
    }));
  };
  const updateSessionBtwRounds = (sessionId: string, updater: (rounds: NonNullable<Session["btwRounds"]>) => NonNullable<Session["btwRounds"]>) => {
    updateSession(sessionId, (session) => ({
      ...session,
      btwRounds: updater(session.btwRounds ?? []),
      updatedAt: Date.now(),
    }));
    window.setTimeout(() => persistLocalConversationState(), 0);
  };
  const setBtwInput = (value: string) => {
    updateBtwTransientState(btwSessionId, { input: value, error: null });
  };
  const clearBtw = () => {
    if (!liveCurrentSession) return;
    updateSessionBtwRounds(liveCurrentSession.id, () => []);
    updateBtwTransientState(liveCurrentSession.id, { error: null });
  };
  const askBtw = async () => {
    if (!liveCurrentSession) {
      showToast("请先选择一个会话");
      return;
    }
    if (isCurrentSessionRunning) {
      showToast("当前轮次结束后再侧问");
      return;
    }
    const content = btwState.input.trim();
    if (!content) return;
    const sessionId = getRuntimeSessionId(liveCurrentSession) ?? liveCurrentSession.id;
    const clientSessionId = liveCurrentSession.id;
    const roundId = `btw-round-${Date.now()}`;
    updateBtwTransientState(clientSessionId, { input: "", loading: true, error: null });
    updateSessionBtwRounds(clientSessionId, (rounds) => [...rounds, { id: roundId, userContent: content, timestamp: Date.now() }]);
    const res = await window.api.askKimiCodeBtw({ sessionId, content });
    if (!res.success) {
      updateBtwTransientState(clientSessionId, { loading: false, error: res.error });
      showToast(`BTW 侧问失败：${res.error}`);
      return;
    }
    updateBtwTransientState(clientSessionId, { loading: false, error: null });
    updateSessionBtwRounds(clientSessionId, (rounds) => rounds.map((round) => round.id === roundId
      ? {
          ...round,
          assistantContent: res.data.content || "没有返回正文。",
          thinking: res.data.thinking || undefined,
        }
      : round));
  };
  const openProjectTerminal = () => {
    if (projectPath) void window.api.openProjectTerminal({ path: projectPath });
  };
  const setLaunchCommand = async () => {
    const current = await window.api.getSettings();
    setLaunchCommandDraft(current.success ? current.data.selectedLaunchCommand ?? "" : "");
    setLaunchCommandDialogOpen(true);
  };
  const saveLaunchCommand = async () => {
    const command = launchCommandDraft.trim();
    if (!command) {
      showToast("启动命令不能为空");
      return;
    }
    const res = await window.api.setLaunchCommand({ command });
    showToast(res.success ? "已更新启动命令" : `设置失败：${res.error}`);
    if (res.success) setLaunchCommandDialogOpen(false);
  };
  const showKimiOnboarding = !kimiOnboardingDismissed && !kimiOnboarding.loading && (kimiOnboarding.available === false || kimiOnboarding.isLegacy);
  const needsKimiCodeSetup = kimiOnboarding.available === false || cliUpdateState.info?.available === false;
  const hasKimiCodeUpdate = needsKimiCodeSetup || cliUpdateState.hasUpdate || Boolean(cliUpdateState.info?.isLegacy) || Boolean(kimiOnboarding.isLegacy);
  const topUpdateLabel = updateState.hasUpdate
    ? "升级 Kimix"
    : needsKimiCodeSetup
      ? "安装 Kimi Code"
      : hasKimiCodeUpdate
        ? "升级 Kimi Code"
        : "升级";
  const topUpdateMessage = updateState.hasUpdate
    ? updateState.message
    : needsKimiCodeSetup
      ? "未找到 Kimi Code，点击查看安装和迁移指引"
      : hasKimiCodeUpdate
        ? cliUpdateState.info?.migrationHint ?? cliUpdateState.message
        : updateState.message;
  const pluginWorkspaceActive = workspaceView === "plugins" || workspaceView === "mcp";
  const hooksWorkspaceActive = workspaceView === "hooks";
  const settingsWorkspaceActive = workspaceView === "settings";
  const chatWorkspaceActive = workspaceView === "chat";
  useEffect(() => {
    if (!["chat", "plugins", "hooks", "mcp", "settings"].includes(workspaceView as string)) setWorkspaceView("chat");
  }, [setWorkspaceView, workspaceView]);
  const handlePluginTabChange = (tab: "skills" | "mcp") => {
    setPluginPanelTab(tab);
    if (workspaceView === "mcp") setWorkspaceView("plugins");
  };
  const openGitDetailsFromContextBar = () => {
    setDiffPanelOpen(false);
    setLongTaskInspectorOpen(true);
    setGitDetailsOpenSignal((value) => value + 1);
  };

  return (
    <div className="kimix-app-shell flex h-full w-full flex-col overflow-hidden text-[15px] text-text-primary">
        <TopMenuBar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={toggleSidebar}
          onNavigateBack={() => navigateHistory("back")}
          onNavigateForward={() => navigateHistory("forward")}
          onMenuAction={handleMenuAction}
        hasUpdate={updateState.hasUpdate || hasKimiCodeUpdate}
        updateMessage={topUpdateMessage}
        updateLabel={topUpdateLabel}
        onOpenUpdates={() => setHelpDialog("updates")}
      />

      <div style={{ paddingBottom: 0, paddingRight: 0, gap: 0 }} className="flex min-h-0 flex-1">
        <Sidebar width={sidebarWidth} />
        {sidebarOpen ? (
          <ResizeHandle ariaLabel="调整左侧栏宽度" onPointerDown={startSidebarResize} />
        ) : (
          <div className="kimix-layout-spacer" />
        )}
        <main className="kimix-app-shell-main relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[20px] border shadow-[0_1px_2px_rgba(25,23,20,0.04)]">
          {chatWorkspaceActive && (
            <SessionToolbar
              title={sessionTitle}
              longTaskMeta={longTaskMeta}
              longTaskStatusTone={longTaskStatusTone}
              isCurrentSessionRunning={isCurrentSessionRunning}
              onOpenLongTaskInspector={() => setLongTaskInspectorOpen(true)}
              projectPath={projectPath}
              currentProject={currentProject}
              diffPanelOpen={diffPanelOpen}
              onToggleDiffPanel={() => {
                setLongTaskInspectorOpen(false);
                setDiffPanelOpen(!diffPanelOpen);
              }}
              longTaskInspectorOpen={longTaskInspectorOpen}
              onToggleLongTaskInspector={() => {
                setDiffPanelOpen(false);
                setLongTaskInspectorOpen(!longTaskInspectorOpen);
              }}
              showToast={showToast}
              copyToClipboard={copyToClipboard}
              onSetLaunchCommand={setLaunchCommand}
            />
          )}
          {pluginWorkspaceActive ? (
            <SkillsPanel open activeTab={workspaceView === "mcp" ? "mcp" : pluginPanelTab} onActiveTabChange={handlePluginTabChange} onBackToChat={() => setWorkspaceView("chat")} onOpenOfficialMarketplace={openOfficialPluginMarketplace} />
          ) : hooksWorkspaceActive ? (
            <HooksPanel onBackToChat={() => setWorkspaceView("chat")} />
          ) : settingsWorkspaceActive ? (
            <SettingsPanel variant="workspace" onBackToChat={() => setWorkspaceView("chat")} />
          ) : previewFile ? (
            <ProjectFilePreviewViewer
              file={previewFile}
              content={previewContent}
              resolvedPath={previewResolvedPath}
              loading={previewLoading}
              error={previewError}
              onBack={() => setPreviewFile(null)}
              onOpenFile={() => {
                if (previewProjectPath) void window.api.openFile({ projectPath: previewProjectPath, filePath: previewFile.path });
              }}
            />
          ) : (
            <>
              <div className="relative min-h-0 flex-1 overflow-hidden">
                <ChatThread />
              </div>
              <div className="kimix-app-shell-footer kimix-content-x shrink-0" style={{ paddingTop: 10, paddingBottom: 10 }}>
                <div className="kimix-chat-column">
                  <Composer />
                  <div style={{ marginTop: 10 }}>
                    <ContextBar onOpenGitDetails={openGitDetailsFromContextBar} />
                  </div>
                </div>
              </div>
            </>
          )}
        </main>
        {chatWorkspaceActive && (longTaskInspectorOpen || diffPanelOpen) && (
          <ResizeHandle ariaLabel="调整右侧栏宽度" onPointerDown={startRightPanelResize} />
        )}
        {chatWorkspaceActive && longTaskInspectorOpen && (
          <LongTaskInspectorPanel
            width={rightPanelWidth}
            title={rightPanelTitle}
            subtitle={rightPanelSubtitle}
            longTaskMeta={longTaskMeta}
            longTaskDetail={longTaskDetail}
            longTaskDetailLoading={longTaskDetailLoading}
            longTaskDetailError={longTaskDetailError}
            parsedLongTaskDetail={parsedLongTaskDetail}
            pendingReviewItems={pendingReviewItems}
            completedReviewItems={completedReviewItems}
            targetStepDraft={targetStepDraft}
            targetStepBusy={targetStepBusy}
            longTaskControlBusy={longTaskControlBusy}
            runningSessionId={runningSessionId}
            totalLongTaskSteps={totalLongTaskSteps}
            sessionLongTasksLoading={sessionLongTasksLoading}
            shutdownAfterLongTaskId={shutdownAfterLongTaskId}
            sessionPlanState={sessionPlanState}
            sessionPlanPath={sessionPlanPath}
            liveCurrentSession={liveCurrentSession}
            currentProject={currentProject}
            hiddenComposerCardEntries={hiddenComposerCardEntries}
            composerCardSessionId={composerCardSessionId}
            visibleSessionLongTasks={visibleSessionLongTasks}
            backgroundTasks={longTaskBackgroundTasks}
            backgroundTasksLoading={longTaskBackgroundTasksLoading}
            backgroundTasksError={longTaskBackgroundTasksError}
            sessionDiffs={sessionDiffs}
            btwState={btwState}
            btwDisabled={!liveCurrentSession || isCurrentSessionRunning}
            defaultPlanMode={defaultPlanMode}
            officialGoal={liveCurrentSession?.officialGoal}
            gitDetailsOpenSignal={gitDetailsOpenSignal}
            onClose={() => setLongTaskInspectorOpen(false)}
            onPatchLongTaskMeta={patchLongTaskMeta}
            onApplyTargetStep={applyTargetStep}
            onSetReviewItemChecked={setReviewItemChecked}
            onCopyNextLongTaskPrompt={copyNextLongTaskPrompt}
            onRefreshLongTaskDetail={refreshLongTaskDetail}
            onRefreshSessionPlan={refreshSessionPlan}
            onRefreshSessionLongTasks={refreshSessionLongTasks}
            onRefreshBackgroundTasks={refreshLongTaskBackgroundTasks}
            onCopyBackgroundTaskOutput={copyBackgroundTaskOutput}
            onStopBackgroundTask={stopBackgroundTask}
            onSetTargetStepDraft={setTargetStepDraft}
            onSetShutdownAfterLongTaskId={setShutdownAfterLongTaskId}
            onSetComposerCardHidden={setComposerCardHidden}
            onSetBtwInput={setBtwInput}
            onAskBtw={askBtw}
            onClearBtw={clearBtw}
            onRefreshOfficialGoal={refreshOfficialGoal}
            onCreateOfficialGoal={createOfficialGoal}
            onPauseOfficialGoal={pauseOfficialGoal}
            onResumeOfficialGoal={resumeOfficialGoal}
            onCancelOfficialGoal={cancelOfficialGoal}
            showToast={showToast}
            copyToClipboard={copyToClipboard}
          />
        )}
        {chatWorkspaceActive && diffPanelOpen && (
          <DiffPanel
            width={rightPanelWidth}
            projectPath={previewProjectPath}
            allowedExtensions={filePreviewExtensions}
            selectedPath={previewFile?.path}
            onSelectFile={setPreviewFile}
            onClose={() => setDiffPanelOpen(false)}
          />
        )}
      </div>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      <LongTasksPanel />
      <ToastSystem message={toastMessage} />
      <DialogSystem
        showKimiOnboarding={showKimiOnboarding}
        kimiOnboardingMessage={kimiOnboarding.message}
        kimiInstallBusy={kimiInstallBusy}
        kimiInstallPercent={cliUpdateState.progressPercent}
        kimiInstallPhase={cliUpdateState.progressPhase}
        onKimiDismiss={() => setKimiOnboardingDismissed(true)}
        onKimiInstall={installKimiCliFromOnboarding}
        onKimiCheck={checkKimiForOnboarding}
        onKimiOpenSettings={() => {
          setWorkspaceView("settings");
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent("kimix:focus-auth-settings"));
          }, 80);
        }}
        copyToClipboard={copyToClipboard}
        launchCommandOpen={launchCommandDialogOpen}
        launchCommandDraft={launchCommandDraft}
        onLaunchCommandChange={setLaunchCommandDraft}
        onLaunchCommandClose={() => setLaunchCommandDialogOpen(false)}
        onLaunchCommandSave={saveLaunchCommand}
        shutdownDialog={shutdownDialog}
        onShutdownCancel={cancelScheduledShutdown}
        helpDialog={helpDialog}
        infoTopic={infoTopic}
        appInfo={appInfo}
        updateState={updateState}
        cliUpdateState={cliUpdateState}
        onHelpClose={() => setHelpDialog(null)}
        onDownloadUpdate={handleDownloadUpdate}
        onOpenLatestRelease={handleOpenLatestRelease}
        onCheckUpdates={handleCheckUpdates}
        onUpdateKimiCli={handleUpdateKimiCli}
        onInstallKimiCli={installKimiCliFromOnboarding}
        onCheckCliUpdate={handleCheckCliUpdate}
      />
    </div>
  );
}
