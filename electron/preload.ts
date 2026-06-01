import { contextBridge, ipcRenderer } from "electron";
import type {
  OpenProjectRequest,
  OpenProjectResponse,
  ChooseDirectoryRequest,
  ChooseDirectoryResponse,
  ListRecentResponse,
  ListLongTasksRequest,
  ListLongTasksResponse,
  CreateLongTaskRequest,
  CreateLongTaskResponse,
  GetLongTaskDetailRequest,
  GetLongTaskDetailResponse,
  UpdateLongTaskStateRequest,
  UpdateLongTaskStateResponse,
  AppendLongTaskRoundRequest,
  AppendLongTaskRoundResponse,
  StartSessionRequest,
  StartSessionResponse,
  StartTuiSessionRequest,
  StartTuiSessionResponse,
  CheckKimiCliRequest,
  CheckKimiCliResponse,
  GetKimiAuthStatusResponse,
  GetKimiModelConfigResponse,
  InstallKimiCliResponse,
  KimiOpenAiProviderConfigRequest,
  CheckKimiCliUpdateResponse,
  KimiLoginResponse,
  KimiLogoutResponse,
  SaveKimiModelConfigResponse,
  SetKimiDefaultModelRequest,
  ListMcpServersResponse,
  AddMcpServerRequest,
  ImportPluginMcpServerRequest,
  RemoveMcpServerRequest,
  McpServerActionRequest,
  McpServerMutationResponse,
  TestMcpServerResponse,
  TestKimiModelConfigResponse,
  UpdateKimiCliResponse,
  SendPromptRequest,
  SendPromptResponse,
  SetPlanModeRequest,
  SetPlanModeResponse,
  SteerPromptRequest,
  SteerPromptResponse,
  StopTurnRequest,
  StopTurnResponse,
  StopTuiSessionRequest,
  ApproveRequest,
  ApproveResponse,
  RespondQuestionRequest,
  RespondQuestionResponse,
  CloseSessionRequest,
  CloseSessionResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  ListSlashCommandsRequest,
  ListSlashCommandsResponse,
  LoadSessionRequest,
  LoadSessionResponse,
  ExportSessionRequest,
  ExportSessionResponse,
  ExportMarkdownRequest,
  ExportMarkdownResponse,
  GitInfoResponse,
  KimiUsageResponse,
  OpenFileRequest,
  OpenEditorRequest,
  OpenPathRequest,
  ReadTextFileRequest,
  ReadTextFileResponse,
  RevertFilesRequest,
  SearchProjectFilesRequest,
  SearchProjectFilesResponse,
  ListSkillsResponse,
  InstallKimiPluginRequest,
  InstallKimiPluginResponse,
  ImportSkillArchiveRequest,
  ImportSkillArchiveResponse,
  InstallSuperpowersResponse,
  SuperpowersBootstrapResponse,
  SaveEnabledSkillsRequest,
  SaveEnabledSkillsResponse,
  OpenTerminalRequest,
  AppInfoResponse,
  CheckUpdateResponse,
  DownloadUpdateProgress,
  DownloadUpdateResponse,
  CopyImageRequest,
  LaunchCommandRequest,
  TriggerShortcutRequest,
  TurnCompleteNotificationRequest,
  ScheduleShutdownRequest,
  GenerateHookRuleRequest,
  GenerateHookRuleResponse,
  SettingsResponse,
  SaveSettingsRequest,
  KimiEventPayload,
  KimiStatusPayload,
  ListTuiSessionsResponse,
  SendTuiKeyRequest,
  ProbeTuiClipboardImageRequest,
  SendTuiInputRequest,
  ApplyPromptSubmitHooksRequest,
  ApplyPromptSubmitHooksResponse,
  ResizeTuiSessionRequest,
  Project,
  VoidResponse,
  TuiEventPayload,
} from "./types/ipc";

const api = {
  // Project
  openProject: (req?: OpenProjectRequest): Promise<OpenProjectResponse> =>
    ipcRenderer.invoke("project:open", req),
  chooseDirectory: (req?: ChooseDirectoryRequest): Promise<ChooseDirectoryResponse> =>
    ipcRenderer.invoke("project:chooseDirectory", req),
  listRecentProjects: (): Promise<ListRecentResponse> =>
    ipcRenderer.invoke("project:listRecent"),
  addRecentProject: (project: Project): Promise<void> =>
    ipcRenderer.invoke("project:addRecent", project),
  removeRecentProject: (id: string): Promise<void> =>
    ipcRenderer.invoke("project:removeRecent", id),
  getGitInfo: (projectPath: string): Promise<GitInfoResponse> =>
    ipcRenderer.invoke("project:getGitInfo", projectPath),
  openProjectPath: (req: OpenPathRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("project:openPath", req),
  readTextFile: (req: ReadTextFileRequest): Promise<ReadTextFileResponse> =>
    ipcRenderer.invoke("project:readTextFile", req),
  openFile: (req: OpenFileRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("project:openFile", req),
  revertFiles: (req: RevertFilesRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("project:revertFiles", req),
  openProjectEditor: (req: OpenEditorRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("project:openEditor", req),
  openProjectTerminal: (req: OpenTerminalRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("project:openTerminal", req),
  searchProjectFiles: (req: SearchProjectFilesRequest): Promise<SearchProjectFilesResponse> =>
    ipcRenderer.invoke("project:searchFiles", req),
  listSkills: (): Promise<ListSkillsResponse> =>
    ipcRenderer.invoke("project:listSkills"),
  saveEnabledSkills: (req: SaveEnabledSkillsRequest): Promise<SaveEnabledSkillsResponse> =>
    ipcRenderer.invoke("project:saveEnabledSkills", req),
  importSkillArchive: (req?: ImportSkillArchiveRequest): Promise<ImportSkillArchiveResponse> =>
    ipcRenderer.invoke("project:importSkillArchive", req),
  installKimiPlugin: (req: InstallKimiPluginRequest): Promise<InstallKimiPluginResponse> =>
    ipcRenderer.invoke("project:installKimiPlugin", req),
  installSuperpowers: (): Promise<InstallSuperpowersResponse> =>
    ipcRenderer.invoke("project:installSuperpowers"),
  getSuperpowersBootstrap: (): Promise<SuperpowersBootstrapResponse> =>
    ipcRenderer.invoke("project:getSuperpowersBootstrap"),

  // Long tasks
  listLongTasks: (req: ListLongTasksRequest): Promise<ListLongTasksResponse> =>
    ipcRenderer.invoke("longTasks:list", req),
  createLongTask: (req: CreateLongTaskRequest): Promise<CreateLongTaskResponse> =>
    ipcRenderer.invoke("longTasks:create", req),
  getLongTaskDetail: (req: GetLongTaskDetailRequest): Promise<GetLongTaskDetailResponse> =>
    ipcRenderer.invoke("longTasks:getDetail", req),
  updateLongTaskState: (req: UpdateLongTaskStateRequest): Promise<UpdateLongTaskStateResponse> =>
    ipcRenderer.invoke("longTasks:updateState", req),
  appendLongTaskRound: (req: AppendLongTaskRoundRequest): Promise<AppendLongTaskRoundResponse> =>
    ipcRenderer.invoke("longTasks:appendRound", req),
  generateHookRule: (req: GenerateHookRuleRequest): Promise<GenerateHookRuleResponse> =>
    ipcRenderer.invoke("hooks:generateRule", req),

  // Kimi
  startSession: (req: StartSessionRequest): Promise<StartSessionResponse> =>
    ipcRenderer.invoke("kimi:startSession", req),
  checkKimiCli: (req?: CheckKimiCliRequest): Promise<CheckKimiCliResponse> =>
    ipcRenderer.invoke("kimi:checkCli", req),
  getKimiAuthStatus: (): Promise<GetKimiAuthStatusResponse> =>
    ipcRenderer.invoke("kimi:getAuthStatus"),
  getKimiModelConfig: (): Promise<GetKimiModelConfigResponse> =>
    ipcRenderer.invoke("kimi:getModelConfig"),
  saveKimiOpenAiProvider: (req: KimiOpenAiProviderConfigRequest): Promise<SaveKimiModelConfigResponse> =>
    ipcRenderer.invoke("kimi:saveOpenAiProvider", req),
  setKimiDefaultModel: (req: SetKimiDefaultModelRequest): Promise<SaveKimiModelConfigResponse> =>
    ipcRenderer.invoke("kimi:setDefaultModel", req),
  testKimiOpenAiProvider: (req: KimiOpenAiProviderConfigRequest): Promise<TestKimiModelConfigResponse> =>
    ipcRenderer.invoke("kimi:testOpenAiProvider", req),
  loginKimi: (): Promise<KimiLoginResponse> =>
    ipcRenderer.invoke("kimi:login"),
  logoutKimi: (): Promise<KimiLogoutResponse> =>
    ipcRenderer.invoke("kimi:logout"),
  listMcpServers: (): Promise<ListMcpServersResponse> =>
    ipcRenderer.invoke("kimi:listMcpServers"),
  addMcpServer: (req: AddMcpServerRequest): Promise<McpServerMutationResponse> =>
    ipcRenderer.invoke("kimi:addMcpServer", req),
  importPluginMcpServer: (req: ImportPluginMcpServerRequest): Promise<McpServerMutationResponse> =>
    ipcRenderer.invoke("kimi:importPluginMcpServer", req),
  removeMcpServer: (req: RemoveMcpServerRequest): Promise<McpServerMutationResponse> =>
    ipcRenderer.invoke("kimi:removeMcpServer", req),
  authMcpServer: (req: McpServerActionRequest): Promise<McpServerMutationResponse> =>
    ipcRenderer.invoke("kimi:authMcpServer", req),
  resetMcpServerAuth: (req: McpServerActionRequest): Promise<McpServerMutationResponse> =>
    ipcRenderer.invoke("kimi:resetMcpServerAuth", req),
  testMcpServer: (req: McpServerActionRequest): Promise<TestMcpServerResponse> =>
    ipcRenderer.invoke("kimi:testMcpServer", req),
  installKimiCli: (): Promise<InstallKimiCliResponse> =>
    ipcRenderer.invoke("kimi:installCli"),
  checkKimiCliUpdate: (): Promise<CheckKimiCliUpdateResponse> =>
    ipcRenderer.invoke("kimi:checkCliUpdate"),
  updateKimiCli: (): Promise<UpdateKimiCliResponse> =>
    ipcRenderer.invoke("kimi:updateCli"),
  sendPrompt: (req: SendPromptRequest): Promise<SendPromptResponse> =>
    ipcRenderer.invoke("kimi:sendPrompt", req),
  setPlanMode: (req: SetPlanModeRequest): Promise<SetPlanModeResponse> =>
    ipcRenderer.invoke("kimi:setPlanMode", req),
  steerPrompt: (req: SteerPromptRequest): Promise<SteerPromptResponse> =>
    ipcRenderer.invoke("kimi:steerPrompt", req),
  stopTurn: (req: StopTurnRequest): Promise<StopTurnResponse> =>
    ipcRenderer.invoke("kimi:stopTurn", req),
  approveRequest: (req: ApproveRequest): Promise<ApproveResponse> =>
    ipcRenderer.invoke("kimi:approveRequest", req),
  respondQuestion: (req: RespondQuestionRequest): Promise<RespondQuestionResponse> =>
    ipcRenderer.invoke("kimi:respondQuestion", req),
  closeSession: (req: CloseSessionRequest): Promise<CloseSessionResponse> =>
    ipcRenderer.invoke("kimi:closeSession", req),
  listSlashCommands: (req: ListSlashCommandsRequest): Promise<ListSlashCommandsResponse> =>
    ipcRenderer.invoke("kimi:listSlashCommands", req),
  listSessions: (req: ListSessionsRequest): Promise<ListSessionsResponse> =>
    ipcRenderer.invoke("kimi:listSessions", req),
  loadSession: (req: LoadSessionRequest): Promise<LoadSessionResponse> =>
    ipcRenderer.invoke("kimi:loadSession", req),
  exportSession: (req?: ExportSessionRequest): Promise<ExportSessionResponse> =>
    ipcRenderer.invoke("kimi:exportSession", req),
  exportMarkdown: (req: ExportMarkdownRequest): Promise<ExportMarkdownResponse> =>
    ipcRenderer.invoke("project:exportMarkdown", req),
  getKimiUsage: (): Promise<KimiUsageResponse> =>
    ipcRenderer.invoke("kimi:getUsage"),
  startKimiVis: (): Promise<VoidResponse> =>
    ipcRenderer.invoke("kimi:startVis"),
  startTuiSession: (req?: StartTuiSessionRequest): Promise<StartTuiSessionResponse> =>
    ipcRenderer.invoke("tui:startSession", req),
  sendTuiInput: (req: SendTuiInputRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("tui:sendInput", req),
  applyPromptSubmitHooks: (req: ApplyPromptSubmitHooksRequest): Promise<ApplyPromptSubmitHooksResponse> =>
    ipcRenderer.invoke("hooks:applyPromptSubmit", req),
  sendTuiKey: (req: SendTuiKeyRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("tui:sendKey", req),
  probeTuiClipboardImage: (req: ProbeTuiClipboardImageRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("tui:probeClipboardImage", req),
  stopTuiSession: (req: StopTuiSessionRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("tui:stopSession", req),
  resizeTuiSession: (req: ResizeTuiSessionRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("tui:resizeSession", req),
  listTuiSessions: (): Promise<ListTuiSessionsResponse> =>
    ipcRenderer.invoke("tui:listSessions"),

  // Event listeners
  onKimiEvent: (callback: (payload: KimiEventPayload) => void) => {
    const handler = (_: unknown, payload: KimiEventPayload) => callback(payload);
    ipcRenderer.on("kimi:event", handler);
    return () => ipcRenderer.off("kimi:event", handler);
  },
  onKimiStatus: (callback: (payload: KimiStatusPayload) => void) => {
    const handler = (_: unknown, payload: KimiStatusPayload) => callback(payload);
    ipcRenderer.on("kimi:status", handler);
    return () => ipcRenderer.off("kimi:status", handler);
  },
  onTuiEvent: (callback: (payload: TuiEventPayload) => void) => {
    const handler = (_: unknown, payload: TuiEventPayload) => callback(payload);
    ipcRenderer.on("tui:event", handler);
    return () => ipcRenderer.off("tui:event", handler);
  },

  // App
  getSettings: (): Promise<SettingsResponse> => ipcRenderer.invoke("app:getSettings"),
  saveSettings: (settings: SaveSettingsRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("app:saveSettings", settings),
  getAppInfo: (): Promise<AppInfoResponse> => ipcRenderer.invoke("app:getInfo"),
  checkForUpdates: (): Promise<CheckUpdateResponse> => ipcRenderer.invoke("app:checkForUpdates"),
  downloadUpdate: (): Promise<DownloadUpdateResponse> => ipcRenderer.invoke("app:downloadUpdate"),
  onDownloadUpdateProgress: (callback: (payload: DownloadUpdateProgress) => void) => {
    const handler = (_: unknown, payload: DownloadUpdateProgress) => callback(payload);
    ipcRenderer.on("app:downloadUpdateProgress", handler);
    return () => ipcRenderer.off("app:downloadUpdateProgress", handler);
  },
  openExternal: (url: string): Promise<VoidResponse> =>
    ipcRenderer.invoke("app:openExternal", url),
  chooseExecutable: (): Promise<VoidResponse> =>
    ipcRenderer.invoke("app:chooseExecutable"),
  launchExecutable: (): Promise<VoidResponse> =>
    ipcRenderer.invoke("app:launchExecutable"),
  setLaunchCommand: (req: LaunchCommandRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("app:setLaunchCommand", req),
  launchCommand: (req?: LaunchCommandRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("app:launchCommand", req),
  copyImage: (req: CopyImageRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("app:copyImage", req),
  triggerShortcut: (req: TriggerShortcutRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("app:triggerShortcut", req),
  notifyTurnComplete: (req: TurnCompleteNotificationRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("app:notifyTurnComplete", req),
  clearTaskbarAttention: (): Promise<VoidResponse> =>
    ipcRenderer.invoke("app:clearTaskbarAttention"),
  scheduleShutdown: (req: ScheduleShutdownRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("app:scheduleShutdown", req),
  cancelShutdown: (): Promise<VoidResponse> =>
    ipcRenderer.invoke("app:cancelShutdown"),

  // Bootstrap
  onBootstrap: (callback: (payload: { project: { id: string; path: string; name: string; lastOpenedAt: number } }) => void) => {
    const handler = (_: unknown, payload: { project: { id: string; path: string; name: string; lastOpenedAt: number } }) => callback(payload);
    ipcRenderer.on("kimix:bootstrap", handler);
    return () => ipcRenderer.off("kimix:bootstrap", handler);
  },

  // Window controls
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  maximizeWindow: (): Promise<void> => ipcRenderer.invoke("window:maximize"),
  reloadWindow: (): Promise<void> => ipcRenderer.invoke("window:reload"),
  setZoomLevel: (delta: number): Promise<{ success: boolean; data: number }> => ipcRenderer.invoke("window:setZoomLevel", delta),
  resetZoom: (): Promise<{ success: boolean; data: number }> => ipcRenderer.invoke("window:resetZoom"),
  toggleFullScreen: (): Promise<{ success: boolean; data: boolean }> => ipcRenderer.invoke("window:toggleFullScreen"),
  isWindowMaximized: (): Promise<{ success: boolean; data: boolean }> => ipcRenderer.invoke("window:isMaximized"),
  onWindowMaximizedChange: (callback: (payload: { maximized: boolean; fullscreen?: boolean }) => void) => {
    const handler = (_: unknown, payload: { maximized: boolean; fullscreen?: boolean }) => callback(payload);
    ipcRenderer.on("window:maximized-change", handler);
    return () => ipcRenderer.off("window:maximized-change", handler);
  },
  closeWindow: (): Promise<void> => ipcRenderer.invoke("window:close"),
};

contextBridge.exposeInMainWorld("api", api);

// Debug: log renderer DOM content after load
window.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    console.log("[KIMIX RENDERER] DOM ready, root content length:", document.getElementById("root")?.innerHTML?.length ?? 0);
  }, 2000);
});

export type WindowAPI = typeof api;
