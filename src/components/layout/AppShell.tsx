import { useEffect, useMemo, useRef, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChatThread } from "@/components/chat/ChatThread";
import { Composer } from "@/components/chat/Composer";
import { ContextBar } from "@/components/chat/ContextBar";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { SearchOverlay } from "./SearchOverlay";
import { SkillsPanel } from "./SkillsPanel";
import { LongTasksPanel } from "./LongTasksPanel";
import {
  ArrowLeft,
  ArrowRight,
  Archive,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Code2,
  Copy,
  Clipboard,
  ClipboardCopy,
  Ellipsis,
  ExternalLink,
  FileText,
  FolderOpen,
  GitFork,
  GitBranch,
  HelpCircle,
  History,
  Info,
  Keyboard,
  Laptop,
  Link,
  Minus,
  MessageSquarePlus,
  Monitor,
  PanelLeft,
  PanelLeftOpen,
  PanelRight,
  Pencil,
  Pin,
  Play,
  Pause,
  RefreshCw,
  RotateCcw,
  Square,
  SquareTerminal,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Session, TimelineEvent } from "@/types/ui";
import type { LongTaskDetail } from "@electron/types/ipc";
import { getRuntimeSessionId } from "@/utils/runtimeSession";

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

type SessionMenuEntry =
  | { type: "separator" }
  | { type?: "item"; label: string; hint?: string; icon: LucideIcon; disabled?: boolean; action: () => void | Promise<void> };

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
};

const KIMI_CLI_DOCS_URL = "https://moonshotai.github.io/kimi-cli/zh/guides/getting-started.html";
const KIMI_CLI_WINDOWS_INSTALL_COMMAND = "Invoke-RestMethod https://code.kimi.com/install.ps1 | Invoke-Expression";

type ParsedBigPlanStep = {
  index: number;
  title: string;
  goal: string;
  scope: string;
  acceptance: string;
  status: string;
};

type ParsedLongTaskDetail = {
  goal: string;
  initialRequest: string;
  steps: ParsedBigPlanStep[];
  reviewItems: string[];
  rounds: ParsedLongTaskRound[];
};

type ParsedLongTaskRoundEntry = {
  title: string;
  phase: string;
  role: string;
  conclusion: string;
  content: string;
};

type ParsedLongTaskRound = {
  step: number;
  filePath: string;
  updatedAt: number;
  entries: ParsedLongTaskRoundEntry[];
};

type SessionDiffEntry = {
  id: string;
  filePath: string;
  timestamp: number;
  oldText: string;
  newText: string;
  additions: number;
  deletions: number;
};

const longTaskStageLabels: Record<NonNullable<Session["longTask"]>["stage"], string> = {
  drafting: "澄清中",
  planning: "规划中",
  ready: "待执行",
  running: "执行中",
  reviewing: "审查中",
  paused: "已暂停",
  completed: "已完成",
};

const longTaskAgentLabels: Record<NonNullable<Session["longTask"]>["activeAgent"], string> = {
  executor: "执行",
  reviewer: "审查",
};

function extractMarkdownSection(content: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`^##\\s+${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, "m"));
  return match?.[1]?.trim() ?? "";
}

function extractField(block: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`^${escaped}：\\s*(.*)$`, "m"));
  return match?.[1]?.trim() ?? "";
}

function parseBigPlanSteps(content: string): ParsedBigPlanStep[] {
  const steps: ParsedBigPlanStep[] = [];
  const stepRegex = /^###\s+Step\s+(\d+)([^\r\n]*)\r?\n([\s\S]*?)(?=^###\s+Step\s+\d+|^##\s+|(?![\s\S]))/gm;
  for (const match of content.matchAll(stepRegex)) {
    const index = Number(match[1]);
    const suffix = match[2]?.trim();
    const block = match[3] ?? "";
    steps.push({
      index,
      title: suffix || `Step ${index}`,
      goal: extractField(block, "目标"),
      scope: extractField(block, "范围"),
      acceptance: extractField(block, "验收标准"),
      status: extractField(block, "状态") || "未标记",
    });
  }
  return steps;
}

function parseReviewItems(content: string) {
  const pending = extractMarkdownSection(content, "待处理") || content;
  return pending
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter((line) => line && line !== "暂无");
}

function extractBulletField(block: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`^-\\s+${escaped}：\\s*(.*)$`, "m"));
  return match?.[1]?.trim() ?? "";
}

function parseRoundEntries(content: string): ParsedLongTaskRoundEntry[] {
  const entries: ParsedLongTaskRoundEntry[] = [];
  const entryRegex = /^##\s+([^\r\n]+)\r?\n([\s\S]*?)(?=^##\s+|(?![\s\S]))/gm;
  for (const match of content.matchAll(entryRegex)) {
    const block = match[2] ?? "";
    const recordMatch = block.match(/^###\s+记录\s*\r?\n([\s\S]*)$/m);
    entries.push({
      title: match[1]?.trim() || "轮次记录",
      phase: extractBulletField(block, "阶段"),
      role: extractBulletField(block, "角色"),
      conclusion: extractBulletField(block, "结论"),
      content: (recordMatch?.[1] ?? block).trim(),
    });
  }
  if (entries.length > 0) return entries;
  const fallback = content.replace(/^#\s+[^\r\n]+\r?\n+/, "").trim();
  return fallback ? [{
    title: "轮次记录",
    phase: "",
    role: "",
    conclusion: "",
    content: fallback,
  }] : [];
}

function parseLongTaskRounds(detail: LongTaskDetail) {
  return detail.rounds.map((round) => ({
    step: round.step,
    filePath: round.filePath,
    updatedAt: round.updatedAt,
    entries: parseRoundEntries(round.content),
  }));
}

function parseLongTaskDetail(detail: LongTaskDetail | null): ParsedLongTaskDetail | null {
  if (!detail) return null;
  return {
    goal: extractMarkdownSection(detail.bigPlanContent, "目标") || detail.title,
    initialRequest: extractMarkdownSection(detail.bigPlanContent, "初始需求") || detail.initialRequest,
    steps: parseBigPlanSteps(detail.bigPlanContent),
    reviewItems: parseReviewItems(detail.reviewQueueContent),
    rounds: parseLongTaskRounds(detail),
  };
}

function normalizeReviewItem(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

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
    { label: "切换差异面板", hint: "Alt+Ctrl+B", action: "toggle-diff-panel" },
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

function formatEventAsMarkdown(event: TimelineEvent): string {
  if (event.type === "user_message") {
    const imageLines = event.images?.length
      ? `\n\n${event.images.map((image) => `![${image.name}](${image.dataUrl ?? image.name})`).join("\n")}`
      : "";
    return `## 用户\n\n${event.content || "[图片]"}${imageLines}`;
  }
  if (event.type === "steer_message") return `## 用户引导\n\n${event.content}`;
  if (event.type === "assistant_message") {
    const thinking = event.thinking ? `\n\n<details>\n<summary>思考</summary>\n\n${event.thinking}\n\n</details>` : "";
    return `## Kimi\n\n${event.content || ""}${thinking}`;
  }
  if (event.type === "tool_call") return `> 命令：${event.toolName}\n>\n> ${event.rawArguments ?? JSON.stringify(event.arguments)}`;
  if (event.type === "status_update") return `> 状态：${event.message ?? "处理中"}`;
  if (event.type === "change_summary") return `> 已更改 ${event.files.length} 个文件，+${event.additions} -${event.deletions}`;
  if (event.type === "file_artifact") return `> 文件：${event.filePath}`;
  if (event.type === "error") return `> 错误：${event.message}`;
  if (event.type === "todo") return `> TodoList：${event.items.length} 项`;
  if (event.type === "session_recommendation") return `> 会话建议：已进行 ${event.turnCount} 轮，推荐上限 ${event.turnLimit} 轮。`;
  if (event.type === "compaction") return `> 上下文压缩${event.phase === "begin" ? "开始" : "完成"}`;
  if (event.type === "diff") return `> Diff：${event.filePath}`;
  if (event.type === "approval_request") return `> 审批请求：${event.description}`;
  if (event.type === "question_request") return `> 需求澄清：${event.questions.map((question) => question.question).join(" / ")}`;
  if (event.type === "tool_result") return `> 工具结果：${event.toolName}`;
  if (event.type === "subagent") return `> 子任务：${event.agentName} ${event.status}`;
  return "";
}

function sessionToMarkdown(session: Session): string {
  const header = `# ${session.title}\n\n- 会话 ID：${session.id}\n- 工作目录：${session.projectPath}\n`;
  const body = session.events.map(formatEventAsMarkdown).filter(Boolean).join("\n\n---\n\n");
  return `${header}\n${body}\n`;
}

function countDiffLines(value: string) {
  if (!value.trim()) return 0;
  return value.split("\n").length;
}

function collectSessionDiffs(events: TimelineEvent[]): SessionDiffEntry[] {
  return events
    .filter((event): event is Extract<TimelineEvent, { type: "diff" }> => event.type === "diff")
    .map((event) => ({
      id: event.id,
      filePath: event.filePath,
      timestamp: event.timestamp,
      oldText: event.oldText,
      newText: event.newText,
      additions: Math.max(0, countDiffLines(event.newText) - countDiffLines(event.oldText)),
      deletions: Math.max(0, countDiffLines(event.oldText) - countDiffLines(event.newText)),
    }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function AppShell() {
  const currentSession = useAppStore((s) => s.currentSession);
  const currentProject = useAppStore((s) => s.currentProject);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const searchOpen = useAppStore((s) => s.searchOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const skillsOpen = useAppStore((s) => s.skillsOpen);
  const setSkillsOpen = useAppStore((s) => s.setSkillsOpen);
  const longTaskInspectorOpen = useAppStore((s) => s.longTaskInspectorOpen);
  const setLongTaskInspectorOpen = useAppStore((s) => s.setLongTaskInspectorOpen);
  const diffPanelOpen = useAppStore((s) => s.diffPanelOpen);
  const setDiffPanelOpen = useAppStore((s) => s.setDiffPanelOpen);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setCreatingSessionProjectPath = useAppStore((s) => s.setCreatingSessionProjectPath);
  const addSession = useSessionStore((s) => s.addSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const archiveSession = useSessionStore((s) => s.archiveSession);
  const sessions = useSessionStore((s) => s.sessions);
  const recentProjects = useSessionStore((s) => s.recentProjects);
  const setRecentProjects = useSessionStore((s) => s.setRecentProjects);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [helpDialog, setHelpDialog] = useState<HelpDialog | null>(null);
  const [infoTopic, setInfoTopic] = useState<{ title: string; body: string; url?: string } | null>(null);
  const [appInfo, setAppInfo] = useState({ name: "Kimix", version: "2.5.0", author: "@linjianglu", repository: "https://github.com/LiKPO4/kimix" });
  const [updateState, setUpdateState] = useState<{ loading: boolean; downloading: boolean; message: string; latest: ReleaseInfo | null; hasUpdate: boolean }>({
    loading: false,
    downloading: false,
    message: "尚未检查更新",
    latest: null,
    hasUpdate: false,
  });
  const [longTaskDetail, setLongTaskDetail] = useState<LongTaskDetail | null>(null);
  const [longTaskDetailLoading, setLongTaskDetailLoading] = useState(false);
  const [longTaskDetailError, setLongTaskDetailError] = useState<string | null>(null);
  const [targetStepDraft, setTargetStepDraft] = useState("");
  const [targetStepBusy, setTargetStepBusy] = useState(false);
  const [longTaskControlBusy, setLongTaskControlBusy] = useState(false);
  const [kimiOnboarding, setKimiOnboarding] = useState<KimiCliOnboardingState>({
    loading: true,
    available: null,
    message: "正在检测 Kimi CLI",
  });
  const [kimiOnboardingDismissed, setKimiOnboardingDismissed] = useState(false);
  const [kimiInstallBusy, setKimiInstallBusy] = useState(false);

  const checkKimiForOnboarding = async () => {
    setKimiOnboarding((state) => ({ ...state, loading: true, message: "正在检测 Kimi CLI" }));
    const res = await window.api.checkKimiCli({ verify: false });
    if (res.success) {
      setKimiOnboarding({
        loading: false,
        available: res.data.available,
        message: res.data.message,
        path: res.data.path,
        output: res.data.output,
      });
      if (res.data.available) setKimiOnboardingDismissed(true);
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
      message: "正在一键安装 Kimi CLI，首次安装可能需要 1-2 分钟",
    }));
    try {
      const res = await window.api.installKimiCli();
      if (!res.success) {
        setKimiOnboarding({ loading: false, available: false, message: res.error });
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
      showToast("Kimi CLI 已安装，接下来请执行登录");
      await checkKimiForOnboarding();
    } finally {
      setKimiInstallBusy(false);
    }
  };

  useEffect(() => {
    const close = () => {
      setOpenMenu(null);
      setProjectMenuOpen(false);
      setSessionMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

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
    void window.api.isWindowMaximized().then((res) => {
      if (res.success) setIsMaximized(res.data);
    });
    if (typeof window.api.getAppInfo === "function") {
      void window.api.getAppInfo().then((res) => {
        if (res.success) setAppInfo(res.data);
      });
    }
    void checkKimiForOnboarding();
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
    () => sessions.filter((session) => !session.archivedAt && (!currentProject || session.projectPath === currentProject.path)),
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
      setUpdateState({ loading: false, downloading: false, message: "更新检查接口尚未载入，请重启应用后再试", latest: null, hasUpdate: false });
      return;
    }
    const res = await window.api.checkForUpdates();
    if (!res.success) {
      setUpdateState({ loading: false, downloading: false, message: `检查失败：${res.error}`, latest: null, hasUpdate: false });
      return;
    }
    setUpdateState((state) => ({
      ...state,
      loading: false,
      message: res.data.message,
      latest: res.data.latest,
      hasUpdate: res.data.hasUpdate,
    }));
  };

  const handleDownloadUpdate = async () => {
    setUpdateState((state) => ({ ...state, downloading: true, message: "正在下载匹配当前包体的升级包..." }));
    if (typeof window.api.downloadUpdate !== "function") {
      setUpdateState((state) => ({ ...state, downloading: false, message: "升级接口尚未载入，请重启应用后再试" }));
      return;
    }
    const res = await window.api.downloadUpdate();
    if (!res.success) {
      setUpdateState((state) => ({ ...state, downloading: false, message: `升级失败：${res.error}` }));
      return;
    }
    setUpdateState((state) => ({ ...state, downloading: false, message: res.data.message }));
    showToast(res.data.message);
  };

  useEffect(() => {
    void handleCheckUpdates();
  }, []);

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
    if (["automations", "local-environments", "worktrees", "mcp", "troubleshooting", "performance-trace", "logout", "toggle-file-tree", "open-browser-tab", "new-window"].includes(action)) {
      openInfoTopic(action);
    }
    setOpenMenu(null);
  };

  const liveCurrentSession = useMemo(
    () => sessions.find((session) => session.id === currentSession?.id) ?? currentSession,
    [sessions, currentSession],
  );
  const longTaskMeta = liveCurrentSession?.longTask;
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
  const isCurrentSessionRunning = Boolean(liveCurrentSession && runningSessionId === liveCurrentSession.id);
  const longTaskStatusTone = longTaskMeta?.activeAgent === "reviewer" || longTaskMeta?.stage === "reviewing" ? "reviewer" : "executor";
  const sessionDiffs = useMemo(
    () => collectSessionDiffs(liveCurrentSession?.events ?? []),
    [liveCurrentSession?.events],
  );

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
        const runtimeSessionId = getRuntimeSessionId(liveCurrentSession) ?? liveCurrentSession.id;
        await window.api.stopTurn({ sessionId: runtimeSessionId }).catch(() => ({ success: true as const, data: undefined }));
      }
      updateSession(liveCurrentSession.id, (session) => {
        if (!session.longTask) return session;
        const nextMeta = { ...session.longTask, ...patch };
        const runtimeSessionId = nextMeta.activeAgent === "reviewer" ? nextMeta.reviewerSessionId : nextMeta.executorSessionId;
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
    if (longTaskMeta.activeAgent === "reviewer" || longTaskMeta.stage === "reviewing") {
      return `请作为审查 agent，阅读 ${longTaskMeta.bigPlanPath} 和 ${longTaskMeta.reviewQueuePath}，审查 Step ${nextStep} 的执行结果。输出必须包含“结论：通过 / 需修复 / 待人工审查”，并说明发现的问题、缺失验证和下一轮建议。`;
    }
    return `请作为执行 agent，阅读 ${longTaskMeta.bigPlanPath}，从 Step ${nextStep} 开始执行。本次目标是执行到 Step ${target}，一轮只执行一个 Step。完成后写入 rounds/ 记录，并明确写出“Step ${nextStep} 执行完成，交给审查 agent 审查”。`;
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
    const target = Number(targetStepDraft);
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
    try {
      updateSession(liveCurrentSession.id, (session) => {
        if (!session.longTask) return session;
        const stage = startNow && ["drafting", "planning", "ready", "paused"].includes(session.longTask.stage)
          ? "running"
          : session.longTask.stage;
        latestSession = {
          ...session,
          runtimeSessionId: session.longTask.executorSessionId,
          longTask: {
            ...session.longTask,
            activeAgent: "executor",
            stage,
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
      const prompt = `【Kimix 长程任务：执行到 Step ${target}】\n请你作为执行 agent，先阅读 ${latestSession.longTask?.bigPlanPath}，然后从 Step ${nextStep} 开始，按 BIGPLAN 顺序一轮只执行一个 Step。本次目标是执行到 Step ${target}。\n\n如果当前还没有完成规划，请先完善 BIGPLAN 并向用户确认；如果已经可以执行，请只执行 Step ${nextStep}。完成本轮后写入 rounds/ 记录，并明确写出“Step ${nextStep} 执行完成，交给审查 agent 审查”。`;
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
      const res = await window.api.sendPrompt({
        sessionId: latestSession.longTask?.executorSessionId ?? latestSession.runtimeSessionId ?? latestSession.id,
        content: prompt,
        thinking: defaultThinking,
        yoloMode: permissionMode === "yolo",
      });
      if (!res.success) throw new Error(res.error);
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

  useEffect(() => {
    refreshLongTaskDetail();
  }, [longTaskInspectorOpen, liveCurrentSession?.id, liveCurrentSession?.longTask?.taskId, liveCurrentSession?.projectPath]);

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
    if (!liveCurrentSession?.longTask) {
      setTargetStepDraft("");
      return;
    }
    setTargetStepDraft(liveCurrentSession.longTask.targetStep ? String(liveCurrentSession.longTask.targetStep) : "");
  }, [liveCurrentSession?.longTask?.taskId, liveCurrentSession?.longTask?.targetStep]);

  const copyToClipboard = async (text: string, successMessage = "已复制") => {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  };
  const renameCurrentSession = () => {
    if (!liveCurrentSession) {
      showToast("当前没有对话");
      return;
    }
    const nextTitle = window.prompt("重命名对话", liveCurrentSession.title)?.trim();
    if (!nextTitle || nextTitle === liveCurrentSession.title) return;
    const updatedAt = Date.now();
    updateSession(liveCurrentSession.id, (session) => ({ ...session, title: nextTitle, updatedAt }));
    setCurrentSession({ ...liveCurrentSession, title: nextTitle, updatedAt });
    showToast("已重命名");
  };
  const archiveCurrentSession = () => {
    if (!liveCurrentSession) {
      showToast("当前没有对话");
      return;
    }
    archiveSession(liveCurrentSession.id);
    setCurrentSession(null);
    showToast("已归档对话");
  };
  const sessionMenuItems: SessionMenuEntry[] = [
    { label: "置顶对话", hint: "Ctrl+Alt+P", icon: Pin, disabled: true, action: () => undefined },
    { label: "重命名对话", hint: "Ctrl+Alt+R", icon: Pencil, action: renameCurrentSession },
    { label: "归档对话", hint: "Ctrl+Shift+A", icon: Archive, action: archiveCurrentSession },
    { type: "separator" },
    { label: "复制工作目录", hint: "Ctrl+Shift+C", icon: ClipboardCopy, action: () => copyToClipboard(projectPath ?? liveCurrentSession?.projectPath ?? "", "已复制工作目录") },
    { label: "复制会话 ID", hint: "Ctrl+Alt+C", icon: Clipboard, action: () => copyToClipboard(liveCurrentSession?.id ?? "", "已复制会话 ID") },
    { label: "复制深度链接", hint: "Ctrl+Alt+L", icon: Link, action: () => copyToClipboard(`kimix://session/${liveCurrentSession?.id ?? ""}`, "已复制深度链接") },
    { label: "复制为 Markdown", icon: FileText, action: () => liveCurrentSession ? copyToClipboard(sessionToMarkdown(liveCurrentSession), "已复制 Markdown") : showToast("当前没有对话") },
    { type: "separator" },
    { label: "打开侧边聊天", icon: MessageSquarePlus, disabled: true, action: () => undefined },
    { label: "派生到本地", icon: Laptop, disabled: true, action: () => undefined },
    { label: "派生到新工作树", icon: GitFork, disabled: true, action: () => undefined },
    { label: "添加自动化...", icon: History, disabled: true, action: () => undefined },
    { type: "separator" },
    { label: "在新窗口中打开", icon: ExternalLink, disabled: true, action: () => undefined },
  ];
  const handleSessionMenuEntry = (entry: SessionMenuEntry) => {
    if (entry.type === "separator" || entry.disabled) return;
    void entry.action();
    setSessionMenuOpen(false);
  };
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
  const showKimiOnboarding = !kimiOnboardingDismissed && !kimiOnboarding.loading && kimiOnboarding.available === false;

  return (
    <div className="kimix-app-shell flex h-full w-full flex-col overflow-hidden text-[15px] text-text-primary">
      <header className="z-50 flex h-12 w-full shrink-0 items-center justify-between px-3" style={{ WebkitAppRegion: "drag" as const }}>
        <div className="flex h-full items-center gap-7" style={{ WebkitAppRegion: "no-drag" as const }}>
          <div className="flex items-center gap-2 text-[#7d7972]">
            <button onClick={toggleSidebar} className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/5" style={{ marginLeft: 14 }} aria-label={sidebarOpen ? "收起侧边栏" : "展开侧边栏"} title={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}>
              {sidebarOpen ? <PanelLeft size={17} /> : <PanelLeftOpen size={17} />}
            </button>
            <button onClick={() => window.history.back()} className="ml-2 flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/5" aria-label="后退">
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

      <div style={{ paddingBottom: 0, paddingRight: 0, gap: 10 }} className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="kimix-app-shell-main relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] border shadow-[0_1px_2px_rgba(25,23,20,0.04)]">
          <div className="kimix-app-shell-toolbar flex h-14 shrink-0 items-center justify-between border-b" style={{ paddingLeft: 30, paddingRight: 30 }}>
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="max-w-[300px] truncate text-[14px] font-medium text-[var(--kimix-panel-text)]">
                {sessionTitle}
              </div>
              <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setSessionMenuOpen((open) => !open)}
                  className={`kimix-muted-action flex h-8 w-8 items-center justify-center rounded-lg ${sessionMenuOpen ? "bg-[var(--kimix-panel-hover)] text-[var(--kimix-panel-text)]" : ""}`}
                  title="更多"
                  aria-label="更多"
                >
                  <Ellipsis size={17} />
                </button>
                {sessionMenuOpen && (
                  <div className="kimix-floating-menu absolute left-0 top-full z-[65] mt-2 w-[332px] overflow-hidden rounded-[15px] py-3 text-[14px] text-[var(--kimix-panel-text)]">
                    {sessionMenuItems.map((item, index) => (
                      item.type === "separator" ? (
                        <div key={`session-menu-separator-${index}`} className="my-2 border-t border-[var(--kimix-panel-divider)]" />
                      ) : (
                        <button
                          key={item.label}
                          type="button"
                          disabled={item.disabled}
                          onClick={() => handleSessionMenuEntry(item)}
                          className={`flex min-h-10 w-full items-center gap-3 text-left leading-none transition-colors ${
                            item.disabled
                              ? "cursor-not-allowed text-[var(--kimix-panel-text-muted)]"
                              : "text-[var(--kimix-panel-text)] hover:bg-[var(--kimix-panel-hover)]"
                          }`}
                          style={{ paddingLeft: 20, paddingRight: 20, paddingTop: 9, paddingBottom: 9 }}
                        >
                          <item.icon size={17} className="shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {item.hint && <span className="shrink-0 text-[13px] text-[var(--kimix-panel-text-muted)]">{item.hint}</span>}
                        </button>
                      )
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3.5 text-[#8a847a]">
              {longTaskMeta ? (
                <button
                  type="button"
                  onClick={() => setLongTaskInspectorOpen(true)}
                  className={`flex h-9 min-w-[148px] items-center rounded-xl border bg-white text-left transition-colors ${
                    longTaskStatusTone === "reviewer"
                      ? "border-[#f1ddb0] text-[#8a6a1f] hover:bg-[#fff8e8]"
                      : "border-[#cfe4fb] text-[#2f6fad] hover:bg-[#f4f9ff]"
                  }`}
                  style={{ gap: 9, paddingLeft: 13, paddingRight: 14 }}
                  title="查看长程任务状态"
                  aria-label="查看长程任务状态"
                >
                  {longTaskMeta.stage === "completed" ? (
                    <CheckCircle2 size={15} className="shrink-0" />
                  ) : isCurrentSessionRunning ? (
                    <Square size={13} className="shrink-0 fill-current" />
                  ) : longTaskMeta.stage === "paused" ? (
                    <Pause size={15} className="shrink-0" />
                  ) : (
                    <Play size={15} className="shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px] leading-5">
                    {longTaskAgentLabels[longTaskMeta.activeAgent]} · {longTaskStageLabels[longTaskMeta.stage]}
                  </span>
                  <span className="shrink-0 rounded-full bg-white/75 text-[12px] leading-5" style={{ paddingLeft: 8, paddingRight: 8 }}>
                    {longTaskMeta.currentStep}{longTaskMeta.targetStep ? `/${longTaskMeta.targetStep}` : ""}
                  </span>
                </button>
              ) : (
                <button
                  onClick={() => showToast("当前对话不是长程任务")}
                  className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[#f3f1ec] hover:text-[#3a362f]"
                  title="运行"
                  aria-label="运行"
                >
                  <Play size={15} />
                </button>
              )}
              <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
                <div className={`flex h-9 min-w-[72px] items-center rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)] transition-colors hover:bg-[var(--kimix-panel-soft-bg)] hover:text-[var(--kimix-panel-text)] ${!projectPath ? "opacity-45" : ""}`}>
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
                  <div className="kimix-floating-menu absolute right-6 top-full z-40 mt-3 w-[288px] overflow-hidden rounded-[15px] py-3.5 text-[14px] text-[var(--kimix-panel-text)]">
                    <button onClick={() => openProjectEditor("vscode")} style={{ paddingLeft: 28, paddingRight: 24 }} className="flex h-12 w-full items-center gap-3 text-left transition-colors hover:bg-[var(--kimix-panel-hover)]">
                      <Code2 size={17} className="w-6 shrink-0 text-[#3483eb]" />
                      <span>使用 VS Code 打开</span>
                    </button>
                    <button onClick={openProjectPath} style={{ paddingLeft: 28, paddingRight: 24 }} className="flex h-12 w-full items-center gap-3 text-left transition-colors hover:bg-[var(--kimix-panel-hover)]">
                      <FolderOpen size={17} className="w-6 shrink-0 text-[#d19a32]" />
                      <span>在文件资源管理器中打开</span>
                    </button>
                    <button onClick={openProjectTerminal} style={{ paddingLeft: 28, paddingRight: 24 }} className="flex h-12 w-full items-center gap-3 text-left transition-colors hover:bg-[var(--kimix-panel-hover)]">
                      <SquareTerminal size={17} className="w-6 shrink-0 text-[#777168]" />
                      <span>打开终端</span>
                    </button>
                    <button onClick={() => openProjectEditor("trae")} style={{ paddingLeft: 28, paddingRight: 24 }} className="flex h-12 w-full items-center gap-3 text-left transition-colors hover:bg-[var(--kimix-panel-hover)]">
                      <GitBranch size={17} className="w-6 shrink-0 text-[#9a948b]" />
                      <span>使用 Trae 打开</span>
                    </button>
                    <button onClick={() => openProjectEditor("coder")} style={{ paddingLeft: 28, paddingRight: 24 }} className="flex h-12 w-full items-center gap-3 text-left transition-colors hover:bg-[var(--kimix-panel-hover)]">
                      <Code2 size={17} className="w-6 shrink-0 text-[#9a948b]" />
                      <span>使用 Coder 打开</span>
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={openProjectTerminal}
                disabled={!projectPath}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--kimix-panel-border-soft)] transition-colors hover:bg-[var(--kimix-panel-soft-bg)] hover:text-[var(--kimix-panel-text)] disabled:cursor-not-allowed disabled:opacity-45"
                title="终端"
                aria-label="终端"
              >
                <SquareTerminal size={15} />
              </button>
              <button
                onClick={() => {
                  setLongTaskInspectorOpen(false);
                  setDiffPanelOpen(!diffPanelOpen);
                }}
                className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
                  diffPanelOpen
                    ? "border-[var(--accent-blue)] bg-[#eef7ff] text-[var(--accent-blue)]"
                    : "border-[var(--kimix-panel-border-soft)] text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-soft-bg)]"
                }`}
                title="差异面板"
                aria-label="差异面板"
              >
                <FileText size={15} />
              </button>
              <button
                onClick={() => {
                  setDiffPanelOpen(false);
                  setLongTaskInspectorOpen(!longTaskInspectorOpen);
                }}
                className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
                  longTaskInspectorOpen
                    ? "border-[var(--accent-blue)] bg-[#eef7ff] text-[var(--accent-blue)]"
                    : "border-[var(--kimix-panel-border-soft)] text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-soft-bg)]"
                }`}
                title="长程任务侧栏"
                aria-label="长程任务侧栏"
              >
                <PanelRight size={15} />
              </button>
            </div>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <ChatThread />
          </div>
          <div className="kimix-app-shell-footer kimix-content-x shrink-0" style={{ paddingTop: 10, paddingBottom: 10 }}>
            <div className="kimix-chat-column">
              <Composer />
              <div style={{ marginTop: 10 }}>
                <ContextBar />
              </div>
            </div>
          </div>
        </main>
        {longTaskInspectorOpen && (
          <aside className="kimix-longtask-inspector flex h-full w-[320px] shrink-0 flex-col overflow-hidden rounded-[18px] border shadow-[0_1px_2px_rgba(25,23,20,0.04)]">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#dbeafa]" style={{ paddingLeft: 18, paddingRight: 14 }}>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold leading-5 text-[#24415f]">长程任务</div>
                <div className="mt-0.5 truncate text-[12.5px] leading-5 text-[#6f87a1]">
                  {longTaskMeta ? longTaskMeta.title : "当前对话未关联长程任务"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLongTaskInspectorOpen(false)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#6f87a1] transition-colors hover:bg-[#eaf4ff] hover:text-[#24415f]"
                aria-label="关闭长程任务侧栏"
                title="关闭"
              >
                <X size={15} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto" style={{ paddingLeft: 18, paddingRight: 18, paddingTop: 10, paddingBottom: 18 }}>
              {longTaskMeta ? (
                <div className="flex flex-col" style={{ gap: 14 }}>
                  <section className="rounded-xl border border-[#dbeafa] bg-white" style={{ padding: "16px 16px 18px" }}>
                    <div className="text-[13px] font-medium leading-5 text-[#6f87a1]">当前状态</div>
                    <div className="mt-2 text-[14px] leading-6 text-[#24415f]">
                      {longTaskMeta.activeAgent === "reviewer" ? "审查 agent" : "执行 agent"} · {longTaskMeta.stage}
                    </div>
                    <div className="mt-1 text-[13px] leading-5 text-[#6f87a1]">
                      步骤 {longTaskMeta.currentStep}{longTaskMeta.targetStep ? ` / ${longTaskMeta.targetStep}` : " / 未设置"}
                    </div>
                    <div className="mt-4 flex flex-col" style={{ gap: 14 }}>
                      <div className="rounded-lg bg-[#f4f9ff]" style={{ padding: "14px 12px" }}>
                        <div className="flex items-center justify-between" style={{ gap: 10 }}>
                          <span className="shrink-0 text-[13px] font-medium leading-5 text-[#2f6fad]">工作 agent</span>
                          <div className="flex min-w-0 items-center rounded-lg bg-white" style={{ gap: 4, padding: 4 }}>
                            <button
                              type="button"
                              disabled={longTaskControlBusy}
                              onClick={() => void patchLongTaskMeta({ activeAgent: "executor", stage: longTaskMeta.stage === "reviewing" ? "paused" : longTaskMeta.stage }, { message: "已切换到执行 agent" })}
                              className={`h-7 rounded-md text-[12.5px] leading-5 transition-colors disabled:cursor-wait disabled:opacity-60 ${longTaskMeta.activeAgent === "executor" ? "bg-[#dff0ff] text-[#2f6fad]" : "text-[#6f87a1] hover:bg-[#eef7ff]"}`}
                              style={{ paddingLeft: 10, paddingRight: 10 }}
                            >
                              执行
                            </button>
                            <button
                              type="button"
                              disabled={longTaskControlBusy}
                              onClick={() => void patchLongTaskMeta({ activeAgent: "reviewer", stage: longTaskMeta.stage === "running" ? "paused" : longTaskMeta.stage }, { message: "已切换到审查 agent" })}
                              className={`h-7 rounded-md text-[12.5px] leading-5 transition-colors disabled:cursor-wait disabled:opacity-60 ${longTaskMeta.activeAgent === "reviewer" ? "bg-[#fff3d6] text-[#8a6a1f]" : "text-[#6f87a1] hover:bg-[#eef7ff]"}`}
                              style={{ paddingLeft: 10, paddingRight: 10 }}
                            >
                              审查
                            </button>
                          </div>
                        </div>
                        <div className="mt-3 flex items-center" style={{ gap: 8 }}>
                          <button
                            type="button"
                            disabled={longTaskControlBusy || longTaskMeta.stage === "paused" || longTaskMeta.stage === "completed"}
                            onClick={() => void patchLongTaskMeta({ stage: "paused" }, { stopRunning: true, message: "已暂停长程任务" })}
                            className="kimix-icon-text-button is-compact flex-1 justify-center bg-white text-[#6f87a1] hover:bg-[#eef7ff] disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            <Pause size={14} />
                            暂停
                          </button>
                          <button
                            type="button"
                            disabled={longTaskControlBusy || Boolean(runningSessionId) || longTaskMeta.stage === "completed"}
                            onClick={() => void applyTargetStep(true)}
                            className="kimix-icon-text-button is-compact flex-1 justify-center bg-white text-[#2f6fad] hover:bg-[#eef7ff] disabled:cursor-not-allowed disabled:opacity-55"
                          >
                            <Play size={14} />
                            继续
                          </button>
                        </div>
                      </div>
                      <div className="rounded-lg bg-[#f4f9ff]" style={{ padding: "15px 12px 14px" }}>
                        <div className="flex items-center justify-between" style={{ gap: 10 }}>
                          <label className="shrink-0 text-[13px] font-medium leading-5 text-[#2f6fad]" htmlFor="long-task-target-step">
                            执行到
                          </label>
                          <input
                            id="long-task-target-step"
                            type="number"
                            min={1}
                            max={totalLongTaskSteps || undefined}
                            value={targetStepDraft}
                            onChange={(event) => setTargetStepDraft(event.target.value)}
                            className="h-8 min-w-0 flex-1 rounded-lg border border-[#cfe4fb] bg-white text-[13px] text-[#24415f] outline-none focus:border-[#90c4f2]"
                            style={{ paddingLeft: 10, paddingRight: 10 }}
                            placeholder={totalLongTaskSteps ? `1-${totalLongTaskSteps}` : "Step"}
                          />
                        </div>
                        <div className="mt-4 flex items-center" style={{ gap: 10 }}>
                          <button
                            type="button"
                            disabled={targetStepBusy}
                            onClick={() => void applyTargetStep(false)}
                            className="kimix-icon-text-button is-compact flex-1 justify-center bg-white text-[#2f6fad] hover:bg-[#eef7ff] disabled:cursor-wait disabled:opacity-60"
                          >
                            保存目标
                          </button>
                          <button
                            type="button"
                            disabled={targetStepBusy || Boolean(runningSessionId)}
                            onClick={() => void applyTargetStep(true)}
                            className="kimix-icon-text-button is-compact flex-1 justify-center bg-[#339af0] text-white hover:bg-[#228be6] disabled:cursor-wait disabled:opacity-60"
                          >
                            {runningSessionId ? "运行中" : "开始执行"}
                          </button>
                        </div>
                      </div>
                      <div className="rounded-lg bg-[#f8fbff] text-[13px] leading-5 text-[#5e7894]" style={{ padding: "13px 12px" }}>
                        <div className="flex items-center justify-between" style={{ gap: 10 }}>
                          <span className="font-medium text-[#2f6fad]">下一步 prompt</span>
                          <button
                            type="button"
                            onClick={() => void copyNextLongTaskPrompt()}
                            className="kimix-icon-text-button is-compact shrink-0 bg-white text-[#2f6fad] hover:bg-[#eef7ff]"
                          >
                            <ClipboardCopy size={13} />
                            复制
                          </button>
                        </div>
                        <div className="mt-3 line-clamp-4 whitespace-pre-wrap text-[#6f87a1]">
                          {buildNextLongTaskPrompt()}
                        </div>
                      </div>
                    </div>
                  </section>
                  <section className="rounded-xl border border-[#dbeafa] bg-white" style={{ padding: "16px 16px 18px" }}>
                    <div className="flex items-center justify-between" style={{ gap: 10 }}>
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium leading-5 text-[#6f87a1]">BIGPLAN</div>
                        <div className="mt-1 truncate text-[13px] leading-5 text-[#24415f]">{longTaskMeta.bigPlanPath}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (liveCurrentSession) void window.api.openFile({ projectPath: liveCurrentSession.projectPath, filePath: longTaskMeta.bigPlanPath });
                        }}
                        className="kimix-icon-text-button is-compact shrink-0 bg-[#eef7ff] text-[#2f6fad] hover:bg-[#dff0ff]"
                      >
                        打开
                      </button>
                    </div>
                    {longTaskDetailLoading ? (
                      <div className="mt-4 rounded-lg bg-[#f4f9ff] text-[13px] leading-6 text-[#6f87a1]" style={{ padding: "13px 12px" }}>
                        正在读取 BIGPLAN...
                      </div>
                    ) : longTaskDetailError ? (
                      <div className="mt-4 rounded-lg bg-[#fff4f0] text-[13px] leading-6 text-[#9b4b34]" style={{ padding: "13px 12px" }}>
                        读取失败：{longTaskDetailError}
                      </div>
                    ) : parsedLongTaskDetail ? (
                      <div className="mt-4 flex flex-col" style={{ gap: 12 }}>
                        <div className="rounded-lg bg-[#f4f9ff] text-[13px] leading-6 text-[#24415f]" style={{ padding: "13px 12px" }}>
                          <div className="font-medium text-[#2f6fad]">目标</div>
                          <div className="mt-1 line-clamp-3 text-[#4f6f8f]">{parsedLongTaskDetail.goal}</div>
                          <div className="mt-2 font-medium text-[#2f6fad]">初始需求</div>
                          <div className="mt-1 line-clamp-3 text-[#4f6f8f]">{parsedLongTaskDetail.initialRequest}</div>
                        </div>
                        <div className="flex flex-col" style={{ gap: 10 }}>
                          {parsedLongTaskDetail.steps.map((step) => {
                            const isCurrent = step.index === longTaskMeta.currentStep;
                            return (
                              <div
                                key={step.index}
                                className={`rounded-lg border ${isCurrent ? "border-[#b7d9f7] bg-[#f4f9ff]" : "border-[#e2edf8] bg-white"}`}
                                style={{ padding: "12px 12px" }}
                              >
                                <div className="flex items-center justify-between" style={{ gap: 10 }}>
                                  <div className="min-w-0 truncate text-[13.5px] font-medium leading-5 text-[#24415f]">
                                    Step {step.index}
                                  </div>
                                  <span className="shrink-0 rounded-full bg-[#eef7ff] text-[12px] leading-5 text-[#2f6fad]" style={{ paddingLeft: 9, paddingRight: 9 }}>
                                    {step.status}
                                  </span>
                                </div>
                                <div className="mt-2 text-[13px] leading-5 text-[#5e7894]">
                                  {step.goal || step.title || "暂未填写目标"}
                                </div>
                                {(step.scope || step.acceptance) && (
                                  <div className="mt-2 text-[12.5px] leading-5 text-[#7b91a7]">
                                    {step.scope && <div className="line-clamp-2">范围：{step.scope}</div>}
                                    {step.acceptance && <div className="line-clamp-2">验收：{step.acceptance}</div>}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {parsedLongTaskDetail.steps.length === 0 && (
                            <div className="rounded-lg bg-[#f4f9ff] text-[13px] leading-6 text-[#6f87a1]" style={{ padding: "13px 12px" }}>
                              BIGPLAN 还没有解析到 Step，等待执行 agent 完成规划。
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </section>
                  <section className="rounded-xl border border-[#dbeafa] bg-white" style={{ padding: "16px 16px 18px" }}>
                    <div className="flex items-center justify-between" style={{ gap: 10 }}>
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium leading-5 text-[#6f87a1]">轮次记录</div>
                        <div className="mt-1 truncate text-[13px] leading-5 text-[#24415f]">rounds/step-XXX.md</div>
                      </div>
                      <span className="shrink-0 rounded-full bg-[#eef7ff] text-[12px] leading-5 text-[#2f6fad]" style={{ paddingLeft: 9, paddingRight: 9 }}>
                        {parsedLongTaskDetail?.rounds.length ?? 0}
                      </span>
                    </div>
                    {longTaskDetailLoading ? (
                      <div className="mt-4 rounded-lg bg-[#f8fbff] text-[13px] leading-6 text-[#6f87a1]" style={{ padding: "13px 12px" }}>
                        正在读取轮次记录...
                      </div>
                    ) : parsedLongTaskDetail && parsedLongTaskDetail.rounds.length > 0 ? (
                      <div className="mt-4 flex flex-col" style={{ gap: 10 }}>
                        {parsedLongTaskDetail.rounds.map((round) => (
                          <div key={round.filePath} className="rounded-lg border border-[#e2edf8] bg-[#fbfdff]" style={{ padding: "12px 12px" }}>
                            <div className="flex items-center justify-between" style={{ gap: 10 }}>
                              <div className="flex min-w-0 items-center" style={{ gap: 7 }}>
                                <FileText size={14} className="shrink-0 text-[#6f87a1]" />
                                <span className="truncate text-[13.5px] font-medium leading-5 text-[#24415f]">Step {round.step}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  if (liveCurrentSession) void window.api.openFile({ projectPath: liveCurrentSession.projectPath, filePath: round.filePath });
                                }}
                                className="kimix-icon-text-button is-compact shrink-0 bg-white text-[#2f6fad] hover:bg-[#eef7ff]"
                              >
                                打开
                              </button>
                            </div>
                            <div className="mt-3 flex flex-col" style={{ gap: 10 }}>
                              {round.entries.map((entry, index) => (
                                <div key={`${round.filePath}-${index}`} className="rounded-lg bg-white text-[13px] leading-5 text-[#5e7894]" style={{ padding: "11px 11px" }}>
                                  <div className="flex items-center justify-between" style={{ gap: 8 }}>
                                    <div className="min-w-0 truncate font-medium text-[#2f6fad]">{entry.title}</div>
                                    {(entry.phase || entry.role) && (
                                      <span className="shrink-0 rounded-full bg-[#f4f9ff] text-[12px] leading-5 text-[#6f87a1]" style={{ paddingLeft: 8, paddingRight: 8 }}>
                                        {[entry.phase, entry.role].filter(Boolean).join(" · ")}
                                      </span>
                                    )}
                                  </div>
                                  {entry.conclusion && (
                                    <div className="mt-1 text-[12.5px] leading-5 text-[#7b91a7]">结论：{entry.conclusion}</div>
                                  )}
                                  <div className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-[#5e7894]">
                                    {entry.content || "暂无正文。"}
                                  </div>
                                </div>
                              ))}
                              {round.entries.length === 0 && (
                                <div className="rounded-lg bg-white text-[13px] leading-6 text-[#7b91a7]" style={{ padding: "11px 11px" }}>
                                  这个 Step 记录暂时为空。
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-lg bg-[#f8fbff] text-[13px] leading-6 text-[#6f87a1]" style={{ padding: "13px 12px" }}>
                        暂无 Step 轮次记录。
                      </div>
                    )}
                  </section>
                  <section className="rounded-xl border border-[#dbeafa] bg-white" style={{ padding: "16px 16px 18px" }}>
                    <div className="flex items-center justify-between" style={{ gap: 10 }}>
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium leading-5 text-[#6f87a1]">待审查</div>
                        <div className="mt-1 truncate text-[13px] leading-5 text-[#24415f]">{longTaskMeta.reviewQueuePath}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (liveCurrentSession) void window.api.openFile({ projectPath: liveCurrentSession.projectPath, filePath: longTaskMeta.reviewQueuePath });
                        }}
                        className="kimix-icon-text-button is-compact shrink-0 bg-[#eef7ff] text-[#2f6fad] hover:bg-[#dff0ff]"
                      >
                        打开
                      </button>
                    </div>
                    {longTaskDetailLoading ? (
                      <div className="mt-4 rounded-lg bg-[#fffdf7] text-[13px] leading-6 text-[#7b6d4a]" style={{ padding: "13px 12px" }}>
                        正在读取待审查队列...
                      </div>
                    ) : parsedLongTaskDetail && parsedLongTaskDetail.reviewItems.length > 0 ? (
                      <div className="mt-4 flex flex-col" style={{ gap: 10 }}>
                        {pendingReviewItems.map((item, index) => (
                          <button
                            key={`${index}-${item}`}
                            type="button"
                            onClick={() => setReviewItemChecked(item, true)}
                            className="flex w-full items-start rounded-lg border border-[#efe1bf] bg-[#fffdf7] text-left text-[13px] leading-5 text-[#7b6d4a] transition-colors hover:bg-[#fff8e8]"
                            style={{ gap: 10, padding: "12px 12px" }}
                            title="点击标记为已审查"
                          >
                            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[#e2c884] text-transparent">
                              <CheckCircle2 size={12} />
                            </span>
                            <span className="min-w-0 flex-1">{item}</span>
                          </button>
                        ))}
                        {pendingReviewItems.length === 0 && (
                          <div className="rounded-lg bg-[#fffdf7] text-[13px] leading-6 text-[#7b6d4a]" style={{ padding: "13px 12px" }}>
                            待审查项都已确认。
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-lg bg-[#fffdf7] text-[13px] leading-6 text-[#7b6d4a]" style={{ padding: "13px 12px" }}>
                        暂无待人工审查项。
                      </div>
                    )}
                  </section>
                  {completedReviewItems.length > 0 && (
                    <section className="rounded-xl border border-[#dbeafa] bg-white" style={{ padding: "16px 16px 18px" }}>
                      <div className="flex items-center justify-between" style={{ gap: 10 }}>
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium leading-5 text-[#6f87a1]">已审查</div>
                          <div className="mt-1 text-[13px] leading-5 text-[#8aa0b5]">点击条目可撤回到待审查</div>
                        </div>
                        <span className="shrink-0 rounded-full bg-[#eef7ff] text-[12px] leading-5 text-[#2f6fad]" style={{ paddingLeft: 9, paddingRight: 9 }}>
                          {completedReviewItems.length}
                        </span>
                      </div>
                      <div className="mt-4 flex flex-col" style={{ gap: 10 }}>
                        {completedReviewItems.map((item, index) => (
                          <button
                            key={`${index}-${item}`}
                            type="button"
                            onClick={() => setReviewItemChecked(item, false)}
                            className="flex w-full items-start rounded-lg border border-[#d8e8d8] bg-[#f7fbf7] text-left text-[13px] leading-5 text-[#6f806f] transition-colors hover:bg-[#edf7ed]"
                            style={{ gap: 10, padding: "12px 12px" }}
                            title="点击撤回到待审查"
                          >
                            <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[#4d9f55]" />
                            <span className="min-w-0 flex-1 line-through decoration-[#7d937d] decoration-1">{item}</span>
                            <RotateCcw size={13} className="mt-1 shrink-0 text-[#89a089]" />
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[#dbeafa] bg-white text-[13.5px] leading-6 text-[#6f87a1]" style={{ padding: "18px 16px" }}>
                  选择一个长程任务对话后，这里会显示 BIGPLAN 可视化和待审查内容。
                </div>
              )}
            </div>
          </aside>
        )}
        {diffPanelOpen && (
          <aside className="kimix-diff-panel flex h-full w-[360px] shrink-0 flex-col overflow-hidden rounded-[18px] border shadow-[0_1px_2px_rgba(25,23,20,0.04)]">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--kimix-panel-divider)]" style={{ paddingLeft: 18, paddingRight: 14 }}>
              <div className="min-w-0">
                <div className="text-[15px] font-semibold leading-5 text-[var(--kimix-panel-text)]">差异面板</div>
                <div className="mt-0.5 truncate text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]">
                  {sessionDiffs.length > 0 ? `${sessionDiffs.length} 条最近变更` : "当前会话还没有 diff 记录"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDiffPanelOpen(false)}
                className="kimix-muted-action flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                aria-label="关闭差异面板"
                title="关闭"
              >
                <X size={15} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto" style={{ paddingLeft: 18, paddingRight: 18, paddingTop: 12, paddingBottom: 18 }}>
              {sessionDiffs.length > 0 ? (
                <div className="flex flex-col" style={{ gap: 14 }}>
                  {sessionDiffs.map((diff) => (
                    <section key={diff.id} className="kimix-soft-card rounded-xl" style={{ padding: "16px 16px 18px" }}>
                      <div className="flex items-start justify-between" style={{ gap: 10 }}>
                        <div className="min-w-0">
                          <div className="truncate text-[13.5px] font-medium leading-5 text-[var(--kimix-panel-text)]">{diff.filePath}</div>
                          <div className="mt-1 text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">
                            +{diff.additions} / -{diff.deletions} · {formatReleaseDate(new Date(diff.timestamp).toISOString())}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (liveCurrentSession) void window.api.openFile({ projectPath: liveCurrentSession.projectPath, filePath: diff.filePath });
                          }}
                          className="kimix-icon-text-button kimix-muted-action is-compact shrink-0"
                        >
                          打开
                        </button>
                      </div>
                      <div className="mt-4 flex flex-col" style={{ gap: 10 }}>
                        <div className="rounded-lg border border-[var(--kimix-warning-border)] bg-[var(--kimix-warning-bg)]" style={{ padding: "12px 12px" }}>
                          <div className="text-[12px] font-medium leading-5 text-[var(--kimix-warning-text)]">修改前</div>
                          <pre className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--kimix-warning-text-secondary)]">{diff.oldText || "空"}</pre>
                        </div>
                        <div className="rounded-lg border border-[var(--kimix-success-border)] bg-[var(--kimix-success-bg)]" style={{ padding: "12px 12px" }}>
                          <div className="text-[12px] font-medium leading-5 text-[var(--kimix-success-text)]">修改后</div>
                          <pre className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]">{diff.newText || "空"}</pre>
                        </div>
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="kimix-soft-card rounded-xl text-[13.5px] leading-6" style={{ padding: "18px 16px" }}>
                  当工具调用返回结构化 diff 后，这里会按时间展示文件变更明细。
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      <SettingsPanel />
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
      <SkillsPanel open={skillsOpen} onClose={() => setSkillsOpen(false)} />
      <LongTasksPanel />
      {showKimiOnboarding && (
        <div className="kimix-onboarding-overlay fixed inset-0 z-[118] flex items-center justify-center backdrop-blur-sm" style={{ padding: 24 }}>
          <div className="kimix-onboarding-card w-full max-w-[560px] rounded-[18px] border shadow-[0_26px_80px_rgba(35,31,25,0.18)]" style={{ padding: "22px 24px" }}>
            <div className="flex items-start justify-between" style={{ gap: 16 }}>
              <div className="flex min-w-0 items-start" style={{ gap: 14 }}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eef7ff] text-[#2f6fad]">
                  <SquareTerminal size={20} />
                </div>
                <div className="min-w-0">
                  <div className="text-[18px] font-semibold leading-7 text-[#24211d]">需要先配置 Kimi CLI</div>
                  <div className="mt-1 text-[14px] leading-6 text-[#706b63]">
                    Kimix 通过本机的 <span className="font-medium text-[#3a362f]">kimi</span> 命令启动对话。当前没有在 PATH 中找到 Kimi CLI，配置完成后才能正常发送消息。
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setKimiOnboardingDismissed(true)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#8a847a] hover:bg-[#f3f1ec]"
                aria-label="稍后配置"
              >
                <X size={16} />
              </button>
            </div>

            <div className="mt-5 rounded-xl border border-[#eee8dc] bg-[#fbfaf7]" style={{ padding: "16px 16px 18px" }}>
              <div className="text-[13px] font-medium leading-5 text-[#625d55]">推荐步骤</div>
              <div className="mt-2 grid gap-2 text-[13.5px] leading-6 text-[#6f685f]">
                <div>1. 点击“一键安装”，或使用官方脚本安装 Kimi CLI（脚本会自动安装 uv）。</div>
                <div>2. 安装完成后，在系统终端运行 <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[12.5px] text-[#3a362f]">kimi</span>，再输入 <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[12.5px] text-[#3a362f]">/login</span> 完成登录。</div>
                <div>3. 重启 Kimix 或点击“重新检测”。</div>
              </div>
              <div className="mt-4 rounded-lg border border-[#e6dfd2] bg-white font-mono text-[12.5px] leading-5 text-[#3a362f]" style={{ padding: "12px 12px" }}>
                {KIMI_CLI_WINDOWS_INSTALL_COMMAND}
              </div>
              <div className="mt-2 text-[12.5px] leading-5 text-[#9a948b]">
                检测结果：{kimiOnboarding.message}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between" style={{ gap: 12, marginTop: 24 }}>
              <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
                <button
                  type="button"
                  onClick={() => void installKimiCliFromOnboarding()}
                  disabled={kimiInstallBusy}
                  className="kimix-icon-text-button is-compact bg-[#339af0] text-white hover:bg-[#228be6] disabled:cursor-wait disabled:opacity-65"
                  style={{ minHeight: 34, paddingTop: 6, paddingBottom: 6 }}
                >
                  {kimiInstallBusy ? <RefreshCw size={14} className="kimix-spin" /> : <SquareTerminal size={14} />}
                  <span>{kimiInstallBusy ? "安装中" : "一键安装"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void window.api.openExternal(KIMI_CLI_DOCS_URL)}
                  className="kimix-icon-text-button is-compact text-[#2f6fad] hover:bg-[#eef4fb]"
                  style={{ minHeight: 34, paddingTop: 6, paddingBottom: 6 }}
                >
                  <ExternalLink size={14} />
                  <span>打开官方说明</span>
                </button>
                <button
                  type="button"
                  onClick={() => void copyToClipboard(KIMI_CLI_WINDOWS_INSTALL_COMMAND, "已复制安装命令")}
                  className="kimix-icon-text-button is-compact text-[#625d55] hover:bg-[#f1eee8]"
                  style={{ minHeight: 34, paddingTop: 6, paddingBottom: 6 }}
                >
                  <Copy size={14} />
                  <span>复制安装命令</span>
                </button>
              </div>
              <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    setKimiOnboardingDismissed(true);
                    setSettingsOpen(true);
                  }}
                  className="kimix-icon-text-button is-compact text-[#625d55] hover:bg-[#f1eee8]"
                  style={{ minHeight: 34, paddingTop: 6, paddingBottom: 6 }}
                >
                  <Monitor size={14} />
                  <span>打开设置</span>
                </button>
                <button
                  type="button"
                  onClick={() => void checkKimiForOnboarding()}
                  className="kimix-icon-text-button is-compact text-[#2f6fad] hover:bg-[#eef7ff]"
                  style={{ minHeight: 34, paddingTop: 6, paddingBottom: 6 }}
                >
                  <RefreshCw size={14} />
                  <span>重新检测</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {toastMessage && (
        <div
          className="pointer-events-none fixed left-1/2 top-16 z-[120] -translate-x-1/2 rounded-full border border-[#ded9cf] bg-white text-[14px] font-medium leading-5 text-[#3a362f] shadow-[0_16px_40px_rgba(25,23,20,0.16)]"
          style={{ padding: "9px 18px" }}
        >
          {toastMessage}
        </div>
      )}
      {helpDialog && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/20 px-5" onMouseDown={() => setHelpDialog(null)}>
          <div className="kimix-modal-card w-full max-w-[560px] rounded-[18px] border shadow-[0_28px_90px_rgba(25,23,20,0.24)]" onMouseDown={(e) => e.stopPropagation()}>
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
                  <div className="rounded-xl border border-[#e5e1d8] bg-[#faf8f4]" style={{ paddingTop: 18, paddingRight: 16, paddingBottom: 18, paddingLeft: 16 }}>
                    <div>开发者：{appInfo.author}</div>
                    <button className="kimix-icon-text-button is-compact mt-4 text-[#2f6fad] hover:bg-[#eef4fb]" onClick={() => window.api.openExternal(appInfo.repository)}>
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
                    <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                      {updateState.hasUpdate && (
                        <button
                          onClick={handleDownloadUpdate}
                          disabled={updateState.downloading || updateState.loading}
                          className="kimix-icon-text-button h-10 shrink-0 bg-[#339af0] text-white hover:bg-[#228be6] disabled:opacity-45"
                          style={{ paddingLeft: 16, paddingRight: 18 }}
                        >
                          <RefreshCw size={14} className={updateState.downloading ? "kimix-spin" : ""} />
                          {updateState.downloading ? "下载中" : "升级"}
                        </button>
                      )}
                      <button
                        onClick={handleCheckUpdates}
                        disabled={updateState.loading || updateState.downloading}
                        className="kimix-icon-text-button h-10 shrink-0 bg-[#24211d] text-white hover:bg-black disabled:opacity-45"
                        style={{ paddingLeft: 16, paddingRight: 18 }}
                      >
                        <RefreshCw size={14} className={updateState.loading ? "kimix-spin" : ""} />
                        检查更新
                      </button>
                    </div>
                  </div>
                  {updateState.latest && (
                    <div className="rounded-xl border border-[#e5e1d8]" style={{ paddingTop: 18, paddingRight: 16, paddingBottom: 18, paddingLeft: 16 }}>
                      <div className="font-semibold text-[#24211d]">{updateState.latest.name || updateState.latest.tagName}</div>
                      <p className="mt-3 whitespace-pre-wrap leading-6">{updateState.latest.body || "该版本没有填写更新说明。"}</p>
                      <button className="kimix-icon-text-button is-compact mt-4 text-[#2f6fad] hover:bg-[#eef4fb]" onClick={() => window.api.openExternal(updateState.latest!.htmlUrl)}>
                        打开发布页面 <ExternalLink size={13} />
                      </button>
                    </div>
                  )}
                  <div className="space-y-3">
                    {RELEASE_TIMELINE.map((item) => (
                      <div key={item.version} className="rounded-xl border border-[#e5e1d8] bg-white" style={{ paddingTop: 18, paddingRight: 16, paddingBottom: 18, paddingLeft: 16 }}>
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-[#24211d]">{item.version}</span>
                          <span className="text-[13px] text-[#8a847a]">{item.date}</span>
                        </div>
                        <p className="mt-3 leading-6">{item.text}</p>
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
