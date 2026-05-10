import { useEffect, useMemo, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChatThread } from "@/components/chat/ChatThread";
import { Composer } from "@/components/chat/Composer";
import { ContextBar } from "@/components/chat/ContextBar";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { SearchOverlay } from "./SearchOverlay";
import { SkillsPanel } from "./SkillsPanel";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  Code2,
  Copy,
  Ellipsis,
  ExternalLink,
  FolderOpen,
  GitBranch,
  HelpCircle,
  History,
  Info,
  Keyboard,
  Minus,
  PanelLeft,
  PanelRight,
  Play,
  RefreshCw,
  Square,
  SquareTerminal,
  X,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";

type MenuAction =
  | "close-chat"
  | "new-window"
  | "new-chat"
  | "quick-chat"
  | "open-project"
  | "settings"
  | "about"
  | "logout"
  | "exit"
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "delete"
  | "select-all"
  | "toggle-sidebar"
  | "toggle-terminal"
  | "toggle-file-tree"
  | "open-browser-tab"
  | "reload-browser-page"
  | "toggle-diff-panel"
  | "find"
  | "previous-chat"
  | "next-chat"
  | "back"
  | "forward"
  | "zoom-in"
  | "zoom-out"
  | "actual-size"
  | "toggle-fullscreen"
  | "minimize"
  | "zoom-window"
  | "close-window"
  | "documentation"
  | "whats-new"
  | "automations"
  | "local-environments"
  | "worktrees"
  | "skills"
  | "mcp"
  | "troubleshooting"
  | "send-feedback"
  | "performance-trace"
  | "keyboard-shortcuts";

type MenuEntry =
  | { type: "separator" }
  | { type?: "item"; label: string; hint?: string; action: MenuAction; disabled?: boolean; note?: string };

type HelpDialog = "about" | "updates" | "shortcuts" | "info";

type ReleaseInfo = {
  tagName: string;
  name: string;
  body: string;
  publishedAt: string;
  htmlUrl: string;
  assets: { name: string; downloadUrl: string }[];
};

const MENU_ITEMS: Record<string, MenuEntry[]> = {
  文件: [
    { label: "关闭对话", hint: "Ctrl+W", action: "close-chat" },
    { label: "新建窗口", hint: "Ctrl+Shift+N", action: "new-window", disabled: true, note: "新建窗口暂未接入" },
    { label: "新对话", hint: "Ctrl+N", action: "new-chat" },
    { label: "快速对话", hint: "Alt+Ctrl+N", action: "quick-chat" },
    { label: "打开项目...", hint: "Ctrl+O", action: "open-project" },
    { type: "separator" },
    { label: "设置...", hint: "Ctrl+逗号", action: "settings" },
    { type: "separator" },
    { label: "关于 Kimix", action: "about" },
    { label: "退出登录", action: "logout", disabled: true, note: "官方 Kimi 登录态暂未暴露给桌面端" },
    { label: "退出", action: "exit" },
  ],
  编辑: [
    { label: "撤销", hint: "Ctrl+Z", action: "undo" },
    { label: "重做", hint: "Ctrl+Y", action: "redo" },
    { type: "separator" },
    { label: "剪切", hint: "Ctrl+X", action: "cut" },
    { label: "复制", hint: "Ctrl+C", action: "copy" },
    { label: "粘贴", hint: "Ctrl+V", action: "paste" },
    { label: "删除", action: "delete" },
    { type: "separator" },
    { label: "全选", hint: "Ctrl+A", action: "select-all" },
  ],
  查看: [
    { label: "切换侧边栏", hint: "Ctrl+B", action: "toggle-sidebar" },
    { label: "打开终端", hint: "Ctrl+J", action: "toggle-terminal" },
    { label: "切换文件树", hint: "Ctrl+Shift+E", action: "toggle-file-tree", disabled: true, note: "文件树面板暂未实现" },
    { label: "打开浏览器标签页", hint: "Ctrl+T", action: "open-browser-tab", disabled: true, note: "内置浏览器页暂未实现" },
    { label: "重新载入页面", hint: "Ctrl+R", action: "reload-browser-page" },
    { label: "切换差异面板", hint: "Alt+Ctrl+B", action: "toggle-diff-panel", disabled: true, note: "差异面板暂未实现" },
    { label: "查找", hint: "Ctrl+F", action: "find" },
    { type: "separator" },
    { label: "上一个对话", hint: "Ctrl+Shift+[", action: "previous-chat" },
    { label: "下一个对话", hint: "Ctrl+Shift+]", action: "next-chat" },
    { label: "后退", hint: "Ctrl+[", action: "back" },
    { label: "前进", hint: "Ctrl+]", action: "forward" },
    { type: "separator" },
    { label: "放大", hint: "Ctrl++", action: "zoom-in" },
    { label: "缩小", hint: "Ctrl+-", action: "zoom-out" },
    { label: "实际大小", hint: "Ctrl+0", action: "actual-size" },
    { type: "separator" },
    { label: "切换全屏", hint: "F11", action: "toggle-fullscreen" },
  ],
  窗口: [
    { label: "最小化", hint: "Ctrl+M", action: "minimize" },
    { label: "缩放", action: "zoom-window" },
    { label: "关闭", hint: "Ctrl+W", action: "close-window" },
  ],
  帮助: [
    { label: "Kimix 文档", action: "documentation" },
    { label: "更新记录", action: "whats-new" },
    { label: "自动化", action: "automations" },
    { label: "本地环境", action: "local-environments" },
    { label: "工作树", action: "worktrees" },
    { label: "技能", action: "skills" },
    { label: "模型上下文协议", action: "mcp" },
    { label: "故障排查", action: "troubleshooting" },
    { type: "separator" },
    { label: "发送反馈", action: "send-feedback" },
    { label: "开始性能跟踪", action: "performance-trace", disabled: true, note: "性能跟踪暂未接入" },
    { type: "separator" },
    { label: "键盘快捷键", action: "keyboard-shortcuts" },
  ],
};

const RELEASE_TIMELINE = [
  { version: "v2.5.0", date: "2026-05-10", text: "补齐顶部中文菜单、关于与更新页面，接入 GitHub Release 检查更新。" },
  { version: "v2.4.24", date: "2026-05-10", text: "修复引导状态显示、官方 steer 事件映射、队列续发顺序和 dev 白屏。" },
  { version: "v2.4.23", date: "2026-05-10", text: "增加启动后渲染内容自检，空 root 时自动重载一次。" },
  { version: "v2.4.22", date: "2026-05-10", text: "收敛按钮尺寸、圆角框灰色化，并优化 TodoList 面板密度。" },
  { version: "v2.4.18", date: "2026-05-10", text: "接入官方 slash 命令和项目文件候选。" },
];

const HELP_TOPICS: Record<MenuAction, { title: string; body: string; url?: string }> = {
  automations: {
    title: "自动化",
    body: "Kimix 侧栏已预留自动化入口，但本地自动化任务、定时运行和结果回写还没有接入到桌面端。",
  },
  "local-environments": {
    title: "本地环境",
    body: "当前版本会直接使用本机 Kimi CLI 和项目目录。隔离环境、环境模板和一键初始化仍需后续接入。",
  },
  worktrees: {
    title: "工作树",
    body: "工作树菜单先保留为说明入口。后续会基于 Git worktree 增加独立任务目录和分支隔离。",
  },
  skills: {
    title: "技能",
    body: "技能入口对应 Codex 风格能力分组。Kimix 当前只展示入口，尚未提供技能安装、启用和管理页面。",
  },
  mcp: {
    title: "模型上下文协议",
    body: "MCP 管理页尚未实现。当前 Kimix 主要通过 Kimi 官方 SDK 与本机 CLI 通信。",
  },
  troubleshooting: {
    title: "故障排查",
    body: "常见问题：确认 Kimi CLI 已安装并登录，项目路径存在，启动日志里 root 内容自检非 0。",
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
  "toggle-file-tree": { title: "", body: "" },
  "open-browser-tab": { title: "", body: "" },
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

function sendDocumentCommand(command: string) {
  document.execCommand(command);
}

function isInputLike(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

function formatReleaseDate(value: string): string {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function AppShell() {
  const currentSession = useAppStore((s) => s.currentSession);
  const currentProject = useAppStore((s) => s.currentProject);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const searchOpen = useAppStore((s) => s.searchOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const skillsOpen = useAppStore((s) => s.skillsOpen);
  const setSkillsOpen = useAppStore((s) => s.setSkillsOpen);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setCreatingSessionProjectPath = useAppStore((s) => s.setCreatingSessionProjectPath);
  const addSession = useSessionStore((s) => s.addSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const sessions = useSessionStore((s) => s.sessions);
  const recentProjects = useSessionStore((s) => s.recentProjects);
  const setRecentProjects = useSessionStore((s) => s.setRecentProjects);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [helpDialog, setHelpDialog] = useState<HelpDialog | null>(null);
  const [infoTopic, setInfoTopic] = useState<{ title: string; body: string; url?: string } | null>(null);
  const [appInfo, setAppInfo] = useState({ name: "Kimix", version: "2.5.0", author: "@linjianglu", repository: "https://github.com/LiKPO4/kimix" });
  const [updateState, setUpdateState] = useState<{ loading: boolean; message: string; latest: ReleaseInfo | null; hasUpdate: boolean }>({
    loading: false,
    message: "尚未检查更新",
    latest: null,
    hasUpdate: false,
  });

  useEffect(() => {
    const close = () => {
      setOpenMenu(null);
      setProjectMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    void window.api.isWindowMaximized().then((res) => {
      if (res.success) setIsMaximized(res.data);
    });
    if (typeof window.api.getAppInfo === "function") {
      void window.api.getAppInfo().then((res) => {
        if (res.success) setAppInfo(res.data);
      });
    }
    return window.api.onWindowMaximizedChange((payload) => setIsMaximized(payload.maximized));
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
    setCurrentSession(placeholder);
    try {
      const sessionRes = await window.api.startSession({
        workDir: project.path,
        model: "kimi-code/kimi-for-coding",
        thinking: defaultThinking,
        yoloMode: permissionMode === "yolo",
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
    () => sessions.filter((session) => !currentProject || session.projectPath === currentProject.path),
    [sessions, currentProject],
  );

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
      setUpdateState({ loading: false, message: "更新检查接口尚未载入，请重启应用后再试", latest: null, hasUpdate: false });
      return;
    }
    const res = await window.api.checkForUpdates();
    if (!res.success) {
      setUpdateState({ loading: false, message: `检查失败：${res.error}`, latest: null, hasUpdate: false });
      return;
    }
    setUpdateState({
      loading: false,
      message: res.data.message,
      latest: res.data.latest,
      hasUpdate: res.data.hasUpdate,
    });
  };

  const openInfoTopic = (action: MenuAction) => {
    const topic = HELP_TOPICS[action];
    if (!topic?.title) return;
    setInfoTopic(topic);
    setHelpDialog("info");
  };

  const handleMenuAction = (entry: MenuEntry) => {
    if (entry.type === "separator") return;
    if (entry.disabled) {
      if (entry.note) {
        setInfoTopic({ title: entry.label, body: entry.note });
        setHelpDialog("info");
      }
      setOpenMenu(null);
      return;
    }

    const action = entry.action;
    if (action === "close-chat") setCurrentSession(null);
    if (action === "new-chat" || action === "quick-chat") void createSessionForProject();
    if (action === "open-project") void handleOpenProject();
    if (action === "settings") setSettingsOpen(true);
    if (action === "about") setHelpDialog("about");
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
    if (action === "reload-browser-page") {
      if (typeof window.api.reloadWindow === "function") void window.api.reloadWindow();
      else window.location.reload();
    }
    if (action === "find") setSearchOpen(true);
    if (action === "previous-chat") moveChat("previous");
    if (action === "next-chat") moveChat("next");
    if (action === "back") window.history.back();
    if (action === "forward") window.history.forward();
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
    if (action === "skills") setSkillsOpen(true);
    if (["automations", "local-environments", "worktrees", "mcp", "troubleshooting", "performance-trace", "logout", "toggle-file-tree", "open-browser-tab", "toggle-diff-panel", "new-window"].includes(action)) {
      openInfoTopic(action);
    }
    setOpenMenu(null);
  };

  const sessionTitle = currentSession?.title || "新对话";
  const projectPath = currentProject?.path;
  const openProjectPath = () => {
    if (projectPath) void window.api.openProjectPath({ path: projectPath });
    setProjectMenuOpen(false);
  };
  const openProjectEditor = (editor: "vscode" | "trae" | "coder") => {
    if (projectPath) void window.api.openProjectEditor({ path: projectPath, editor });
    setProjectMenuOpen(false);
  };
  const openProjectTerminal = () => {
    if (projectPath) void window.api.openProjectTerminal({ path: projectPath });
    setProjectMenuOpen(false);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-[#f6f4ef] text-[15px] text-text-primary">
      <header className="z-50 flex h-12 w-full shrink-0 items-center justify-between px-3" style={{ WebkitAppRegion: "drag" as const }}>
        <div className="flex h-full items-center gap-7" style={{ WebkitAppRegion: "no-drag" as const }}>
          <div className="flex items-center gap-2 text-[#7d7972]">
            <button onClick={toggleSidebar} className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/5" aria-label="切换侧边栏" title="切换侧边栏">
              <PanelLeft size={17} />
            </button>
            <button onClick={() => window.history.back()} className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/5" aria-label="后退">
              <ArrowLeft size={17} />
            </button>
            <button onClick={() => window.history.forward()} className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/5" aria-label="前进">
              <ArrowRight size={17} />
            </button>
          </div>

          <nav className="flex items-center gap-1.5 text-[14px] text-[#69645d]">
            {Object.keys(MENU_ITEMS).map((menu) => (
              <div key={menu} className="relative" onMouseDown={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setOpenMenu((current) => current === menu ? null : menu)}
                  className={`kimix-top-menu-trigger ${openMenu === menu ? "is-active" : ""}`}
                >
                  {menu}
                </button>
                {openMenu === menu && (
                  <div className="kimix-top-menu absolute left-0 top-full z-[60] mt-2 min-w-[236px] overflow-hidden rounded-[15px] border border-[#e5e1d8] bg-white py-3 text-[14px]">
                    {MENU_ITEMS[menu].map((item, index) => (
                      item.type === "separator" ? (
                        <div key={`separator-${index}`} className="my-2 border-t border-[#eee9e1]" />
                      ) : (
                        <button
                          key={item.label}
                          onClick={() => handleMenuAction(item)}
                          style={{ paddingLeft: 24, paddingRight: 22, paddingTop: 10, paddingBottom: 10 }}
                          className={`flex min-h-10 w-full items-center justify-between gap-5 text-left leading-none transition-colors hover:bg-[#f3f1ec] ${
                            item.disabled ? "text-[#aaa49a]" : "text-[#26231f]"
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {item.hint && <span className="shrink-0 text-[13px] text-[#6f695f]">{item.hint}</span>}
                        </button>
                      )
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: "no-drag" as const, paddingRight: 12 }}>
          <button onClick={() => window.api.minimizeWindow()} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#7d7972] transition-colors hover:bg-black/5" aria-label="最小化">
            <Minus size={14} />
          </button>
          <button onClick={() => window.api.maximizeWindow()} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#7d7972] transition-colors hover:bg-black/5" aria-label={isMaximized ? "还原" : "最大化"}>
            {isMaximized ? <Copy size={12} /> : <Square size={12} />}
          </button>
          <button onClick={() => window.api.closeWindow()} className="flex h-8 w-8 items-center justify-center rounded-lg text-[#7d7972] transition-colors hover:bg-accent-red/10 hover:text-accent-red" aria-label="关闭">
            <X size={14} />
          </button>
        </div>
      </header>

      <div style={{ paddingBottom: 0, paddingRight: 0 }} className="flex min-h-0 flex-1 gap-2">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-[#e5e1d8] bg-white shadow-[0_1px_2px_rgba(25,23,20,0.04)]">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#efebe3] bg-white" style={{ paddingLeft: 30, paddingRight: 30 }}>
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="max-w-[300px] truncate text-[14px] font-medium text-[#24211d]">
                {sessionTitle}
              </div>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-lg text-[#8a847a] transition-colors hover:bg-[#f3f1ec] hover:text-[#3a362f]"
                title="更多"
                aria-label="更多"
              >
                <Ellipsis size={17} />
              </button>
            </div>

            <div className="flex shrink-0 items-center gap-3.5 text-[#8a847a]">
              <button
                className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[#f3f1ec] hover:text-[#3a362f]"
                title="运行"
                aria-label="运行"
              >
                <Play size={15} />
              </button>
              <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
                <div className={`flex h-9 min-w-[72px] items-center rounded-xl border border-[#e5e1d8] bg-white transition-colors hover:bg-[#f8f6f1] hover:text-[#3a362f] ${!projectPath ? "opacity-45" : ""}`}>
                  <button
                    onClick={openProjectPath}
                    disabled={!projectPath}
                    className="flex h-full flex-1 items-center justify-center gap-2 pl-4 pr-1 disabled:cursor-not-allowed"
                    title={currentProject?.path ?? "工作区"}
                    aria-label="在文件资源管理器中打开项目"
                  >
                    <FolderOpen size={17} className="shrink-0 text-[#d19a32]" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setProjectMenuOpen((value) => !value);
                    }}
                    disabled={!projectPath}
                    className="mr-1 flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-black/5 disabled:cursor-not-allowed"
                    title="打开方式"
                    aria-label="打开方式"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
                {projectMenuOpen && (
                  <div className="kimix-floating-menu absolute right-6 top-full z-40 mt-3 w-[288px] overflow-hidden rounded-[15px] border border-[#e5e1d8] bg-white py-3.5 text-[14px] text-[#2f2b26]">
                    <button onClick={() => openProjectEditor("vscode")} style={{ paddingLeft: 28, paddingRight: 24 }} className="flex h-12 w-full items-center gap-3 text-left transition-colors hover:bg-[#f3f1ec]">
                      <Code2 size={17} className="w-6 shrink-0 text-[#3483eb]" />
                      <span>使用 VS Code 打开</span>
                    </button>
                    <button onClick={openProjectPath} style={{ paddingLeft: 28, paddingRight: 24 }} className="flex h-12 w-full items-center gap-3 text-left transition-colors hover:bg-[#f3f1ec]">
                      <FolderOpen size={17} className="w-6 shrink-0 text-[#d19a32]" />
                      <span>在文件资源管理器中打开</span>
                    </button>
                    <button onClick={openProjectTerminal} style={{ paddingLeft: 28, paddingRight: 24 }} className="flex h-12 w-full items-center gap-3 text-left transition-colors hover:bg-[#f3f1ec]">
                      <SquareTerminal size={17} className="w-6 shrink-0 text-[#777168]" />
                      <span>打开终端</span>
                    </button>
                    <button onClick={() => openProjectEditor("trae")} style={{ paddingLeft: 28, paddingRight: 24 }} className="flex h-12 w-full items-center gap-3 text-left transition-colors hover:bg-[#f3f1ec]">
                      <GitBranch size={17} className="w-6 shrink-0 text-[#9a948b]" />
                      <span>使用 Trae 打开</span>
                    </button>
                    <button onClick={() => openProjectEditor("coder")} style={{ paddingLeft: 28, paddingRight: 24 }} className="flex h-12 w-full items-center gap-3 text-left transition-colors hover:bg-[#f3f1ec]">
                      <Code2 size={17} className="w-6 shrink-0 text-[#9a948b]" />
                      <span>使用 Coder 打开</span>
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={openProjectTerminal}
                disabled={!projectPath}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e5e1d8] transition-colors hover:bg-[#f8f6f1] hover:text-[#3a362f] disabled:cursor-not-allowed disabled:opacity-45"
                title="终端"
                aria-label="终端"
              >
                <SquareTerminal size={15} />
              </button>
              <button
                onClick={() => openInfoTopic("toggle-diff-panel")}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e5e1d8] text-[#8a847a] transition-colors hover:bg-[#f8f6f1]"
                title="审查和差异"
                aria-label="审查和差异"
              >
                <PanelRight size={15} />
              </button>
            </div>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <ChatThread />
          </div>
          <div className="kimix-content-x shrink-0 bg-white" style={{ paddingTop: 8, paddingBottom: 10 }}>
            <div className="kimix-chat-column">
              <Composer />
              <ContextBar />
            </div>
          </div>
        </main>
      </div>

      <SettingsPanel />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      <SkillsPanel open={skillsOpen} onClose={() => setSkillsOpen(false)} />
      {helpDialog && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/20 px-5" onMouseDown={() => setHelpDialog(null)}>
          <div className="w-full max-w-[560px] rounded-[18px] border border-[#dedad2] bg-white shadow-[0_28px_90px_rgba(25,23,20,0.24)]" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#ebe7df]" style={{ padding: "16px 20px" }}>
              <div className="flex items-center gap-2.5 text-[18px] font-semibold text-[#24211d]">
                {helpDialog === "about" && <Info size={18} />}
                {helpDialog === "updates" && <History size={18} />}
                {helpDialog === "shortcuts" && <Keyboard size={18} />}
                {helpDialog === "info" && <HelpCircle size={18} />}
                <span>
                  {helpDialog === "about" ? "关于 Kimix" : helpDialog === "updates" ? "更新记录" : helpDialog === "shortcuts" ? "键盘快捷键" : infoTopic?.title}
                </span>
              </div>
              <button className="flex h-8 w-8 items-center justify-center rounded-lg text-[#8f887e] hover:bg-[#f1eee8] hover:text-[#24211d]" onClick={() => setHelpDialog(null)} aria-label="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto" style={{ padding: 22 }}>
              {helpDialog === "about" && (
                <div className="space-y-4 text-[14.5px] leading-7 text-[#625d55]">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f3f1ec] text-[#24211d]">
                      <BookOpen size={22} />
                    </div>
                    <div>
                      <div className="text-[20px] font-semibold text-[#24211d]">{appInfo.name}</div>
                      <div className="text-[#8a847a]">版本 v{appInfo.version}</div>
                    </div>
                  </div>
                  <p>Kimix 是一个面向 Kimi Code CLI 的桌面客户端，目标是提供接近 Codex 的项目对话、队列、引导、工具调用和本地开发体验。</p>
                  <div className="rounded-xl border border-[#e5e1d8] bg-[#faf8f4]" style={{ padding: 16 }}>
                    <div>开发者：{appInfo.author}</div>
                    <button className="kimix-icon-text-button is-compact mt-3 text-[#2f6fad] hover:bg-[#eef4fb]" onClick={() => window.api.openExternal(appInfo.repository)}>
                      打开 GitHub 仓库 <ExternalLink size={13} />
                    </button>
                  </div>
                </div>
              )}

              {helpDialog === "updates" && (
                <div className="space-y-4 text-[14.5px] text-[#625d55]">
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-[#e5e1d8] bg-[#faf8f4]" style={{ paddingLeft: 20, paddingRight: 22, paddingTop: 18, paddingBottom: 18 }}>
                    <div className="min-w-0">
                      <div className="font-semibold text-[#24211d]">{updateState.message}</div>
                      {updateState.latest && <div className="mt-1 text-[13px] text-[#8a847a]">最新版本：{updateState.latest.tagName} · {formatReleaseDate(updateState.latest.publishedAt)}</div>}
                    </div>
                    <button
                      onClick={handleCheckUpdates}
                      disabled={updateState.loading}
                      className="kimix-icon-text-button h-10 shrink-0 bg-[#24211d] text-white hover:bg-black disabled:opacity-45"
                      style={{ paddingLeft: 16, paddingRight: 18 }}
                    >
                      <RefreshCw size={14} className={updateState.loading ? "kimix-spin" : ""} />
                      检查更新
                    </button>
                  </div>
                  {updateState.latest && (
                    <div className="rounded-xl border border-[#e5e1d8]" style={{ padding: 16 }}>
                      <div className="font-semibold text-[#24211d]">{updateState.latest.name || updateState.latest.tagName}</div>
                      <p className="mt-2 whitespace-pre-wrap leading-6">{updateState.latest.body || "该版本没有填写更新说明。"}</p>
                      <button className="kimix-icon-text-button is-compact mt-3 text-[#2f6fad] hover:bg-[#eef4fb]" onClick={() => window.api.openExternal(updateState.latest!.htmlUrl)}>
                        打开发布页面 <ExternalLink size={13} />
                      </button>
                    </div>
                  )}
                  <div className="space-y-3">
                    {RELEASE_TIMELINE.map((item) => (
                      <div key={item.version} className="rounded-xl border border-[#e5e1d8] bg-white" style={{ padding: 16 }}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-[#24211d]">{item.version}</span>
                          <span className="text-[13px] text-[#8a847a]">{item.date}</span>
                        </div>
                        <p className="mt-2 leading-6">{item.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {helpDialog === "shortcuts" && (
                <div className="grid gap-2 text-[14px] text-[#625d55]">
                  {["Ctrl+B 切换侧边栏", "Ctrl+K 聚焦输入框", "Ctrl+N 新对话", "Ctrl+O 打开项目", "Ctrl+R 重新载入页面", "Ctrl++ 放大", "Ctrl+- 缩小", "Ctrl+0 实际大小", "F11 切换全屏", "Esc 停止当前任务"].map((line) => (
                    <div key={line} className="rounded-lg bg-[#faf8f4]" style={{ padding: "10px 14px" }}>{line}</div>
                  ))}
                </div>
              )}

              {helpDialog === "info" && infoTopic && (
                <div className="space-y-4 text-[14.5px] leading-7 text-[#625d55]">
                  <p>{infoTopic.body}</p>
                  {infoTopic.url && (
                    <button className="kimix-icon-text-button is-compact text-[#2f6fad] hover:bg-[#eef4fb]" onClick={() => window.api.openExternal(infoTopic.url!)}>
                      打开相关页面 <ExternalLink size={13} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
