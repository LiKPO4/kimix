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
  GitDetailsResponse,
  GitGraphRequest,
  GitGraphResponse,
  GitCommitRequest,
  GitPullRequest,
  GitPushRequest,
  GitActionResponse,
  KimiUsageResponse,
  ListLongTasksResponse,
  ListRecentResponse,
  ListSessionsResponse,
  ListSkillsResponse,
  ListSlashCommandsResponse,
  LoadSessionResponse,
  OpenProjectResponse,
  ReadTextFileResponse,
  ExportMarkdownResponse,
  ExportSessionResponse,
  ExportSessionBackupResponse,
  ImportSessionBackupResponse,
  KimiLoginResponse,
  KimiLogoutResponse,
  KimiCodeListSessionsResponse,
  KimiCodeListMarketplaceResponse,
  KimiCodeLoadSessionResponse,
  KimiCodeListPluginsResponse,
  KimiCodeListSkillsResponse,
  KimiCodePluginResponse,
  KimiCodeGoalResponse,
  KimiCodeSessionResponse,
  KimiCodeStatusResponse,
  KimiCodeUsageResponse,
  KimiCodeManagedUsageResponse,
  KimiCodeListMcpServersResponse,
  KimiCodeMcpStartupMetricsResponse,
  KimiCodeListBackgroundTasksResponse,
  KimiCodeBackgroundTaskOutputResponse,
  KimiCodeBackgroundTaskOutputPathResponse,
  ListMcpServersResponse,
  AddMcpServerRequest,
  RemoveMcpServerRequest,
  McpServerActionRequest,
  McpServerMutationResponse,
  ImportPluginMcpServerRequest,
  TestMcpServerResponse,
  SaveEnabledSkillsResponse,
  InstallKimiPluginResponse,
  SearchProjectFilesResponse,
  SettingsResponse,
  StartSessionResponse,
  UpdateKimiCliResponse,
  VoidResponse,
  GenerateHookRuleResponse,
} from "../electron/types/ipc";
import App from "./App";
import "./index.css";
import { applyCachedThemeSnapshot } from "@/utils/themeSnapshot";

const BROWSER_PREVIEW_SETTINGS_KEY = "kimix_browser_preview_settings";

const defaultBrowserPreviewSettings = {
  defaultModel: "",
  defaultThinking: true,
  defaultPlanMode: false,
  maxTurns: 50,
  enableCompaction: true,
  defaultPermissionMode: "manual" as const,
  theme: "light",
  themePalette: "warm-paper" as const,
  customThemePalette: {
    primary: "#1982FF",
    surface: "#EDE9E0",
    accent: "#B85C38",
  },
  kimiThemePalettes: [],
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
    setProjectPinned: (): Promise<ListRecentResponse> => Promise.resolve({ success: true, data: [] }),
    reorderProjects: (): Promise<ListRecentResponse> => Promise.resolve({ success: true, data: [] }),
    getGitInfo: (): Promise<GitInfoResponse> => Promise.resolve({ success: true, data: { status: "浏览器预览模式", branch: undefined } }),
    getGitDetails: (): Promise<GitDetailsResponse> => Promise.resolve({ success: true, data: { status: "浏览器预览模式", branch: undefined, files: [] } }),
    getGitGraph: (_req: GitGraphRequest): Promise<GitGraphResponse> => Promise.resolve({ success: true, data: { branch: undefined, commits: [], limit: 100 } }),
    commitGitChanges: (_req: GitCommitRequest): Promise<GitActionResponse> => fail("Git 提交"),
    pullGitChanges: (_req: GitPullRequest): Promise<GitActionResponse> => fail("Git 拉取"),
    pushGitChanges: (_req: GitPushRequest): Promise<GitActionResponse> => fail("Git 推送"),
    openProjectPath: () => fail<VoidResponse>("打开项目目录"),
    readTextFile: (): Promise<ReadTextFileResponse> => fail("读取文本文件"),
    listPreviewFiles: () => Promise.resolve({ success: true, data: [] }),
    openFile: () => fail<VoidResponse>("打开文件"),
    revertFiles: () => fail<VoidResponse>("回退文件"),
    openProjectEditor: () => fail<VoidResponse>("打开编辑器"),
    openProjectTerminal: () => fail<VoidResponse>("打开终端"),
    searchProjectFiles: (): Promise<SearchProjectFilesResponse> => Promise.resolve({ success: true, data: [] }),
    listSkills: (): Promise<ListSkillsResponse> => Promise.resolve({ success: true, data: [] }),
    saveEnabledSkills: (): Promise<SaveEnabledSkillsResponse> =>
      Promise.resolve({ success: true, data: { enabledNames: [], enabledDir: "" } }),
    importSkillArchive: () => fail("导入技能包"),
    installKimiPlugin: (): Promise<InstallKimiPluginResponse> => fail("安装 Kimi Plugin"),
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
        message: unsupported("检测 Kimi Code"),
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
    getKimiModelConfig: () => Promise.resolve({
      success: true,
      data: {
        configPath: "~/.kimi-code/config.toml",
        exists: true,
        defaultModel: "kimi-for-coding",
        providers: [{
          name: "managed:kimi-code",
          type: "kimi",
          baseUrl: "https://api.kimi.com/coding/v1",
          hasApiKey: true,
          hasOauth: true,
        }],
        models: [{
          alias: "kimi-for-coding",
          provider: "managed:kimi-code",
          model: "kimi-for-coding",
          displayName: "Kimi-k2.6",
          maxContextSize: 262144,
          adaptiveThinking: true,
          isDefault: true,
        }],
      },
    }),
    saveKimiOpenAiProvider: () => Promise.resolve({
      success: true,
      data: {
        configPath: "~/.kimi-code/config.toml",
        exists: true,
        defaultModel: "deepseek/deepseek-v4-flash",
        providers: [{
          name: "deepseek",
          type: "openai",
          baseUrl: "https://api.deepseek.com",
          hasApiKey: true,
          hasOauth: false,
        }],
        models: [{
          alias: "deepseek/deepseek-v4-flash",
          provider: "deepseek",
          model: "deepseek-v4-flash",
          displayName: "deepseek/deepseek-v4-flash",
          maxContextSize: 1000000,
          adaptiveThinking: false,
          isDefault: true,
        }],
        message: "浏览器预览已模拟保存",
      },
    }),
    setKimiDefaultModel: () => Promise.resolve({
      success: true,
      data: {
        configPath: "~/.kimi-code/config.toml",
        exists: true,
        defaultModel: "deepseek/deepseek-v4-flash",
        providers: [{
          name: "deepseek",
          type: "openai",
          baseUrl: "https://api.deepseek.com",
          hasApiKey: true,
          hasOauth: false,
        }],
        models: [{
          alias: "deepseek/deepseek-v4-flash",
          provider: "deepseek",
          model: "deepseek-v4-flash",
          displayName: "deepseek/deepseek-v4-flash",
          maxContextSize: 1000000,
          adaptiveThinking: false,
          isDefault: true,
        }],
        message: "浏览器预览已模拟切换默认模型",
      },
    }),
    setKimiModelAdaptiveThinking: () => Promise.resolve({
      success: true,
      data: {
        configPath: "~/.kimi-code/config.toml",
        exists: true,
        defaultModel: "kimi-for-coding",
        providers: [{
          name: "managed:kimi-code",
          type: "kimi",
          baseUrl: "https://api.kimi.com/coding/v1",
          hasApiKey: true,
          hasOauth: true,
        }],
        models: [{
          alias: "kimi-for-coding",
          provider: "managed:kimi-code",
          model: "kimi-for-coding",
          displayName: "Kimi-k2.6",
          maxContextSize: 262144,
          adaptiveThinking: false,
          isDefault: true,
        }],
        message: "浏览器预览已模拟更新自适应思考",
      },
    }),
    removeKimiModelConfig: () => Promise.resolve({
      success: true,
      data: {
        configPath: "~/.kimi-code/config.toml",
        exists: true,
        defaultModel: "kimi-for-coding",
        providers: [{
          name: "managed:kimi-code",
          type: "kimi",
          baseUrl: "https://api.kimi.com/coding/v1",
          hasApiKey: true,
          hasOauth: true,
        }],
        models: [{
          alias: "kimi-for-coding",
          provider: "managed:kimi-code",
          model: "kimi-for-coding",
          displayName: "Kimi-k2.6",
          maxContextSize: 262144,
          adaptiveThinking: true,
          isDefault: true,
        }],
        message: "浏览器预览已模拟删除模型配置",
      },
    }),
    listKimiProviderCatalog: () => Promise.resolve({
      success: true,
      data: {
        providers: [{
          providerId: "openai",
          type: "openai",
          baseUrl: "https://api.openai.com/v1",
          modelCount: 2,
          models: [{
            id: "gpt-5.1-codex",
            name: "GPT-5.1 Codex",
            maxContextSize: 400000,
            thinking: true,
            toolUse: true,
          }, {
            id: "gpt-5.1",
            name: "GPT-5.1",
            maxContextSize: 400000,
            thinking: true,
            toolUse: true,
          }],
        }],
      },
    }),
    doctorKimiConfig: () => Promise.resolve({
      success: true,
      data: {
        ok: true,
        output: "浏览器预览已模拟 Kimi Code 配置诊断通过",
        message: "浏览器预览已模拟 Kimi Code 配置诊断通过",
        environment: {
          kimiCodeHome: "~/.kimi-code",
          proxy: [
            { key: "HTTP_PROXY", configured: false, value: "" },
            { key: "HTTPS_PROXY", configured: false, value: "" },
            { key: "ALL_PROXY", configured: false, value: "" },
            { key: "NO_PROXY", configured: false, value: "" },
          ],
        },
      },
    }),
    testKimiOpenAiProvider: () => Promise.resolve({
      success: true,
      data: {
        message: "浏览器预览已模拟测试",
        output: "OK",
      },
    }),
    loginKimi: (): Promise<KimiLoginResponse> => fail("登录 Kimi"),
    logoutKimi: (): Promise<KimiLogoutResponse> => fail("退出 Kimi 登录"),
    listMcpServers: (): Promise<ListMcpServersResponse> => Promise.resolve({
      success: true,
      data: {
        configPath: "",
        servers: [],
        pluginServers: [],
        rawExists: false,
      },
    }),
    addMcpServer: (_req: AddMcpServerRequest): Promise<McpServerMutationResponse> => fail("添加 MCP 服务"),
    importPluginMcpServer: (_req: ImportPluginMcpServerRequest): Promise<McpServerMutationResponse> => fail("加入 Plugin MCP"),
    removeMcpServer: (_req: RemoveMcpServerRequest): Promise<McpServerMutationResponse> => fail("移除 MCP 服务"),
    authMcpServer: (_req: McpServerActionRequest): Promise<McpServerMutationResponse> => fail("授权 MCP 服务"),
    resetMcpServerAuth: (_req: McpServerActionRequest): Promise<McpServerMutationResponse> => fail("重置 MCP 授权"),
    testMcpServer: (_req: McpServerActionRequest): Promise<TestMcpServerResponse> => fail("测试 MCP 服务"),
    installKimiCli: () => fail("安装 Kimi Code"),
    checkKimiCliUpdate: (): Promise<CheckKimiCliUpdateResponse> => Promise.resolve({
      success: true,
      data: {
        available: false,
        currentVersion: null,
        latestVersion: null,
        hasUpdate: false,
        message: unsupported("检查 Kimi Code 更新"),
      },
    }),
    updateKimiCli: (): Promise<UpdateKimiCliResponse> => fail("更新 Kimi Code"),
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
    exportSession: (): Promise<ExportSessionResponse> => fail("导出 Kimi Debug ZIP"),
    exportSessionBackup: (): Promise<ExportSessionBackupResponse> => fail("导出 Kimix 会话快照"),
    importSessionBackup: (): Promise<ImportSessionBackupResponse> => fail("导入 Kimix 会话快照"),
    exportMarkdown: (): Promise<ExportMarkdownResponse> => fail("导出 Markdown"),
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
    startKimiVis: (): Promise<VoidResponse> => fail("启动 Kimi Code 会话可视化"),
    createKimiCodeSession: (): Promise<KimiCodeSessionResponse> => fail("创建 Kimi Code SDK 会话"),
    resumeKimiCodeSession: (): Promise<KimiCodeSessionResponse> => fail("恢复 Kimi Code SDK 会话"),
    forkKimiCodeSession: (): Promise<KimiCodeSessionResponse> => fail("派生 Kimi Code SDK 会话"),
    renameKimiCodeSession: (): Promise<VoidResponse> => fail("重命名 Kimi Code SDK 会话"),
    reloadKimiCodeSession: (): Promise<VoidResponse> => fail("重载 Kimi Code SDK 会话"),
    sendKimiCodePrompt: (): Promise<VoidResponse> => fail("发送 Kimi Code SDK 消息"),
    askKimiCodeBtw: () => Promise.resolve({ success: false, error: unsupported("使用 Kimi Code BTW 侧问") }),
    swarmKimiCode: (): Promise<VoidResponse> => fail("使用 Kimi Code Swarm"),
    createKimiCodeGoal: (): Promise<KimiCodeGoalResponse> => fail("创建 Kimi Code Goal"),
    getKimiCodeGoal: (): Promise<KimiCodeGoalResponse> => Promise.resolve({ success: true, data: { goal: null } }),
    pauseKimiCodeGoal: (): Promise<KimiCodeGoalResponse> => fail("暂停 Kimi Code Goal"),
    resumeKimiCodeGoal: (): Promise<KimiCodeGoalResponse> => fail("继续 Kimi Code Goal"),
    cancelKimiCodeGoal: (): Promise<KimiCodeGoalResponse> => fail("取消 Kimi Code Goal"),
    steerKimiCode: (): Promise<VoidResponse> => fail("发送 Kimi Code SDK 引导"),
    undoKimiCodeHistory: (): Promise<VoidResponse> => Promise.resolve({ success: true, data: undefined }),
    cancelKimiCodeTurn: (): Promise<VoidResponse> => fail("停止 Kimi Code SDK"),
    setKimiCodePlanMode: (): Promise<VoidResponse> => fail("切换 Kimi Code SDK Plan 模式"),
    setKimiCodePermission: (): Promise<VoidResponse> => fail("切换 Kimi Code SDK 权限"),
    respondKimiCodeApproval: (): Promise<VoidResponse> => fail("响应 Kimi Code SDK 审批"),
    respondKimiCodeQuestion: (): Promise<VoidResponse> => fail("响应 Kimi Code SDK 提问"),
    getKimiCodeStatus: (): Promise<KimiCodeStatusResponse> => fail("读取 Kimi Code SDK 状态"),
    getKimiCodeUsage: (): Promise<KimiCodeUsageResponse> => fail("读取 Kimi Code SDK 会话用量"),
    getKimiCodeConfigDiagnostics: () => Promise.resolve({ success: true, data: { warnings: [] } }),
    getKimiCodeManagedUsage: (): Promise<KimiCodeManagedUsageResponse> => fail("读取 Kimi Code SDK 套餐用量"),
    listKimiCodeMcpServers: (): Promise<KimiCodeListMcpServersResponse> => fail("读取 Kimi Code SDK MCP 服务"),
    getKimiCodeMcpStartupMetrics: (): Promise<KimiCodeMcpStartupMetricsResponse> => fail("读取 Kimi Code SDK MCP 启动指标"),
    reconnectKimiCodeMcpServer: (): Promise<VoidResponse> => fail("重连 Kimi Code SDK MCP 服务"),
    listKimiCodeBackgroundTasks: (): Promise<KimiCodeListBackgroundTasksResponse> => fail("读取 Kimi Code SDK 后台任务"),
    getKimiCodeBackgroundTaskOutput: (): Promise<KimiCodeBackgroundTaskOutputResponse> => fail("读取 Kimi Code SDK 后台任务输出"),
    getKimiCodeBackgroundTaskOutputPath: (): Promise<KimiCodeBackgroundTaskOutputPathResponse> => fail("读取 Kimi Code SDK 后台任务输出路径"),
    stopKimiCodeBackgroundTask: (): Promise<VoidResponse> => fail("停止 Kimi Code SDK 后台任务"),
    listKimiCodeSessions: (): Promise<KimiCodeListSessionsResponse> => Promise.resolve({ success: true, data: [] }),
    listKimiCodeMarketplace: (): Promise<KimiCodeListMarketplaceResponse> => Promise.resolve({ success: true, data: [] }),
    listKimiCodeSkills: (): Promise<KimiCodeListSkillsResponse> => Promise.resolve({ success: true, data: [] }),
    loadKimiCodeSession: (): Promise<KimiCodeLoadSessionResponse> => fail("加载 Kimi Code SDK 会话历史"),
    closeKimiCodeSession: (): Promise<VoidResponse> => fail("关闭 Kimi Code SDK 会话"),
    listKimiCodePlugins: (): Promise<KimiCodeListPluginsResponse> => fail("读取 Kimi Code SDK 插件列表"),
    installKimiCodePlugin: (): Promise<KimiCodePluginResponse> => fail("安装 Kimi Code SDK 插件"),
    setKimiCodePluginEnabled: (): Promise<VoidResponse> => fail("切换 Kimi Code SDK 插件状态"),
    setKimiCodePluginMcpServerEnabled: (): Promise<VoidResponse> => fail("切换 Kimi Code SDK Plugin MCP 状态"),

    onKimiEvent: () => () => {},
    onKimiStatus: () => () => {},
    onKimiCodeEvent: () => () => {},
    onKimiCodeStatus: () => () => {},

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
    getDraggedFilePath: () => "",
    reportRendererHeartbeat: () => {},
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
applyCachedThemeSnapshot();
installBrowserPreviewApi();
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
