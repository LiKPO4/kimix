import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { WindowAPI } from "../electron/preload";
import type {
  AppInfoResponse,
  GetKimiAuthStatusResponse,
  CheckKimiCliResponse,
  CheckKimiCliUpdateResponse,
  CheckUpdateResponse,
  GitInfoResponse,
  KimiUsageResponse,
  ListLongTasksResponse,
  ListRecentResponse,
  ListSessionsResponse,
  ListSkillsResponse,
  ListSlashCommandsResponse,
  LoadSessionResponse,
  OpenProjectResponse,
  ReadTextFileResponse,
  KimiLoginResponse,
  KimiLogoutResponse,
  ListMcpServersResponse,
  AddMcpServerRequest,
  RemoveMcpServerRequest,
  McpServerActionRequest,
  McpServerMutationResponse,
  TestMcpServerResponse,
  SaveEnabledSkillsResponse,
  SearchProjectFilesResponse,
  SettingsResponse,
  StartSessionResponse,
  UpdateKimiCliResponse,
  VoidResponse,
  GenerateHookRuleResponse,
} from "../electron/types/ipc";
import App from "./App";
import "./index.css";

const BROWSER_PREVIEW_SETTINGS_KEY = "kimix_browser_preview_settings";

const defaultBrowserPreviewSettings = {
  defaultModel: "",
  defaultThinking: true,
  defaultPlanMode: false,
  defaultAfkMode: false,
  maxTurns: 50,
  enableCompaction: true,
  defaultPermissionMode: "manual",
  theme: "light",
  fontSize: 14,
  showThinking: true,
  detailedContext: false,
  statusUpdateDisplay: "turn_end",
  sessionRecommendationEnabled: true,
  sessionRecommendationTurnLimit: 10,
  voiceShortcut: "Win+H",
  notificationMode: "unfocused",
  clarificationToolMode: "auto",
  expandToolCalls: false,
  autoReadAgentsMd: true,
  autoShowGitStatus: true,
  enabledSkillNames: [],
  additionalWorkDirs: [],
  hookRules: [],
  hookRunLog: [],
};

function readBrowserPreviewSettings(): SettingsResponse {
  if (typeof window === "undefined") {
    return { success: true, data: { ...defaultBrowserPreviewSettings } };
  }
  try {
    const raw = window.localStorage.getItem(BROWSER_PREVIEW_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      success: true,
      data: {
        ...defaultBrowserPreviewSettings,
        ...(parsed && typeof parsed === "object" ? parsed : {}),
      },
    };
  } catch {
    return { success: true, data: { ...defaultBrowserPreviewSettings } };
  }
}

function writeBrowserPreviewSettings(settings: Partial<typeof defaultBrowserPreviewSettings>) {
  if (typeof window === "undefined") return;
  const next = {
    ...readBrowserPreviewSettings().data,
    ...settings,
  };
  window.localStorage.setItem(BROWSER_PREVIEW_SETTINGS_KEY, JSON.stringify(next));
}

const unsupported = (action: string) => `当前是浏览器预览模式，暂不支持${action}。请从 Electron 桌面实例打开 Kimix。`;

function installBrowserPreviewApi() {
  if (typeof window === "undefined" || window.api) return;

  const okVoid = (): Promise<VoidResponse> => Promise.resolve({ success: true, data: undefined });
  const fail = <T extends { success: false; error: string }>(action: string): Promise<T> =>
    Promise.resolve({ success: false, error: unsupported(action) } as T);

  const previewApi: WindowAPI = {
    openProject: (): Promise<OpenProjectResponse> => Promise.resolve({ success: true, data: null }),
    chooseDirectory: () => Promise.resolve({ success: true, data: null }),
    listRecentProjects: (): Promise<ListRecentResponse> => Promise.resolve({ success: true, data: [] }),
    addRecentProject: () => Promise.resolve(),
    removeRecentProject: () => Promise.resolve(),
    getGitInfo: (): Promise<GitInfoResponse> => Promise.resolve({ success: true, data: { status: "浏览器预览模式", branch: undefined } }),
    openProjectPath: () => fail<VoidResponse>("打开项目目录"),
    readTextFile: (): Promise<ReadTextFileResponse> => fail("读取文本文件"),
    openFile: () => fail<VoidResponse>("打开文件"),
    revertFiles: () => fail<VoidResponse>("回退文件"),
    openProjectEditor: () => fail<VoidResponse>("打开编辑器"),
    openProjectTerminal: () => fail<VoidResponse>("打开终端"),
    searchProjectFiles: (): Promise<SearchProjectFilesResponse> => Promise.resolve({ success: true, data: [] }),
    listSkills: (): Promise<ListSkillsResponse> => Promise.resolve({ success: true, data: [] }),
    saveEnabledSkills: (): Promise<SaveEnabledSkillsResponse> =>
      Promise.resolve({ success: true, data: { enabledNames: [], enabledDir: "" } }),
    importSkillArchive: () => fail("导入技能包"),
    installSuperpowers: () => fail("安装 Superpowers"),
    getSuperpowersBootstrap: () => Promise.resolve({ success: true, data: { enabled: false, content: "" } }),

    listLongTasks: (): Promise<ListLongTasksResponse> => Promise.resolve({ success: true, data: [] }),
    createLongTask: () => fail("创建长程任务"),
    getLongTaskDetail: () => fail("读取长程任务详情"),
    updateLongTaskState: () => fail("更新长程任务状态"),
    appendLongTaskRound: () => fail("写入长程任务轮次记录"),
    generateHookRule: (): Promise<GenerateHookRuleResponse> => fail("调用规则创建 Agent"),

    startSession: (): Promise<StartSessionResponse> => fail("启动会话"),
    checkKimiCli: (): Promise<CheckKimiCliResponse> => Promise.resolve({
      success: true,
      data: {
        available: false,
        verified: false,
        command: "kimi",
        message: unsupported("检测 Kimi CLI"),
      },
    }),
    getKimiAuthStatus: (): Promise<GetKimiAuthStatusResponse> => Promise.resolve({
      success: true,
      data: {
        available: false,
        loggedIn: false,
        configPath: "",
        mcpConfigPath: "",
        defaultModel: null,
        defaultThinking: false,
        message: unsupported("读取登录状态"),
      },
    }),
    loginKimi: (): Promise<KimiLoginResponse> => fail("登录 Kimi"),
    logoutKimi: (): Promise<KimiLogoutResponse> => fail("退出 Kimi 登录"),
    listMcpServers: (): Promise<ListMcpServersResponse> => Promise.resolve({
      success: true,
      data: {
        configPath: "",
        servers: [],
        rawExists: false,
      },
    }),
    addMcpServer: (_req: AddMcpServerRequest): Promise<McpServerMutationResponse> => fail("添加 MCP 服务"),
    removeMcpServer: (_req: RemoveMcpServerRequest): Promise<McpServerMutationResponse> => fail("移除 MCP 服务"),
    authMcpServer: (_req: McpServerActionRequest): Promise<McpServerMutationResponse> => fail("授权 MCP 服务"),
    resetMcpServerAuth: (_req: McpServerActionRequest): Promise<McpServerMutationResponse> => fail("重置 MCP 授权"),
    testMcpServer: (_req: McpServerActionRequest): Promise<TestMcpServerResponse> => fail("测试 MCP 服务"),
    installKimiCli: () => fail("安装 Kimi CLI"),
    checkKimiCliUpdate: (): Promise<CheckKimiCliUpdateResponse> => Promise.resolve({
      success: true,
      data: {
        available: false,
        currentVersion: null,
        latestVersion: null,
        hasUpdate: false,
        message: unsupported("检查 Kimi CLI 更新"),
      },
    }),
    updateKimiCli: (): Promise<UpdateKimiCliResponse> => fail("更新 Kimi CLI"),
    sendPrompt: () => fail("发送消息"),
    setPlanMode: () => fail("切换 Plan 模式"),
    steerPrompt: () => fail("继续编辑消息"),
    stopTurn: () => fail("停止当前轮"),
    approveRequest: () => fail("审批操作"),
    respondQuestion: () => fail("回答问题卡片"),
    closeSession: () => fail("关闭会话"),
    listSlashCommands: (): Promise<ListSlashCommandsResponse> => Promise.resolve({ success: true, data: [] }),
    listSessions: (): Promise<ListSessionsResponse> => Promise.resolve({ success: true, data: [] }),
    loadSession: (): Promise<LoadSessionResponse> => Promise.resolve({ success: true, data: { sessionId: "browser-preview", events: [] } }),
    getKimiUsage: (): Promise<KimiUsageResponse> => Promise.resolve({
      success: true,
      data: {
        available: false,
        updatedAt: Date.now(),
        source: "browser-preview",
        periods: [],
        message: unsupported("读取 Kimi 用量"),
      },
    }),
    startKimiVis: (): Promise<VoidResponse> => fail("启动 Kimi Agent Tracing Visualizer"),

    onKimiEvent: () => () => {},
    onKimiStatus: () => () => {},

    getSettings: (): Promise<SettingsResponse> => Promise.resolve(readBrowserPreviewSettings()),
    saveSettings: (settings) => {
      writeBrowserPreviewSettings(settings);
      return okVoid();
    },
    getAppInfo: (): Promise<AppInfoResponse> => Promise.resolve({
      success: true,
      data: {
        name: "Kimix",
        version: "浏览器预览",
        author: "@linjianglu",
        repository: "https://github.com/linjianglu/kimix",
      },
    }),
    checkForUpdates: (): Promise<CheckUpdateResponse> => Promise.resolve({
      success: true,
      data: {
        currentVersion: "browser-preview",
        latest: null,
        hasUpdate: false,
        message: unsupported("检查更新"),
      },
    }),
    downloadUpdate: () => fail("下载更新"),
    onDownloadUpdateProgress: () => () => {},
    openExternal: async (url: string): Promise<VoidResponse> => {
      window.open(url, "_blank", "noopener,noreferrer");
      return { success: true, data: undefined };
    },
    copyImage: () => fail("复制图片"),
    chooseExecutable: () => fail("选择启动文件"),
    launchExecutable: () => fail("启动文件"),
    setLaunchCommand: () => fail("设置启动命令"),
    launchCommand: () => fail("启动命令"),
    triggerShortcut: () => okVoid(),
    notifyTurnComplete: () => okVoid(),
    clearTaskbarAttention: () => okVoid(),
    scheduleShutdown: () => fail("延迟关机"),
    cancelShutdown: () => fail("取消关机"),

    onBootstrap: () => () => {},

    minimizeWindow: () => Promise.resolve(),
    maximizeWindow: () => Promise.resolve(),
    reloadWindow: () => Promise.resolve(window.location.reload()),
    setZoomLevel: async () => ({ success: true as const, data: 0 }),
    resetZoom: async () => ({ success: true as const, data: 0 }),
    toggleFullScreen: async () => ({ success: true as const, data: false }),
    isWindowMaximized: async () => ({ success: true as const, data: false }),
    onWindowMaximizedChange: () => () => {},
    closeWindow: () => Promise.resolve(),
  };

  window.api = previewApi;
}

function reloadKimixWindow() {
  const api = window.api;
  if (api && typeof api.reloadWindow === "function") {
    void api.reloadWindow().catch(() => window.location.reload());
    window.setTimeout(() => window.location.reload(), 700);
    return;
  }
  window.location.reload();
}

function showCenteredError(message: string, detail?: string) {
  const existing = document.getElementById("kimix-runtime-error");
  if (existing) existing.remove();
  const container = document.createElement("div");
  container.id = "kimix-runtime-error";
  container.setAttribute("role", "alertdialog");
  container.setAttribute("aria-modal", "true");
  container.innerHTML = `
    <div class="kimix-runtime-error-card">
      <button class="kimix-runtime-error-close" type="button" aria-label="关闭错误提示">×</button>
      <div class="kimix-runtime-error-heading">
        <div class="kimix-runtime-error-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M12 8v5" />
            <path d="M12 17h.01" />
            <path d="M10.3 4.6 2.7 18a1.8 1.8 0 0 0 1.6 2.7h15.4a1.8 1.8 0 0 0 1.6-2.7L13.7 4.6a2 2 0 0 0-3.4 0Z" />
          </svg>
        </div>
        <div class="kimix-runtime-error-title">界面遇到错误</div>
      </div>
      <div class="kimix-runtime-error-message"></div>
      <div class="kimix-runtime-error-detail"></div>
      <button class="kimix-runtime-error-button" type="button">重新载入</button>
    </div>
  `;
  container.querySelector(".kimix-runtime-error-message")!.textContent = message;
  container.querySelector(".kimix-runtime-error-detail")!.textContent = detail ?? "";
  container.querySelector(".kimix-runtime-error-close")?.addEventListener("click", () => container.remove());
  container.querySelector(".kimix-runtime-error-button")?.addEventListener("click", reloadKimixWindow);
  document.body.appendChild(container);
}

window.addEventListener("error", (event) => {
  showCenteredError(event.message, `${event.filename}:${event.lineno}`);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
  showCenteredError(reason);
});

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");
installBrowserPreviewApi();
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
