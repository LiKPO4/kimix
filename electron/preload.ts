import { contextBridge, ipcRenderer } from "electron";
import type {
  OpenProjectRequest,
  OpenProjectResponse,
  ListRecentResponse,
  StartSessionRequest,
  StartSessionResponse,
  CheckKimiCliRequest,
  CheckKimiCliResponse,
  SendPromptRequest,
  SendPromptResponse,
  SteerPromptRequest,
  SteerPromptResponse,
  StopTurnRequest,
  StopTurnResponse,
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
  GitInfoResponse,
  KimiUsageResponse,
  OpenFileRequest,
  OpenEditorRequest,
  OpenPathRequest,
  RevertFilesRequest,
  SearchProjectFilesRequest,
  SearchProjectFilesResponse,
  ListSkillsResponse,
  ImportSkillArchiveRequest,
  ImportSkillArchiveResponse,
  SaveEnabledSkillsRequest,
  SaveEnabledSkillsResponse,
  OpenTerminalRequest,
  AppInfoResponse,
  CheckUpdateResponse,
  CopyImageRequest,
  TriggerShortcutRequest,
  SettingsResponse,
  SaveSettingsRequest,
  KimiEventPayload,
  KimiStatusPayload,
  Project,
  VoidResponse,
} from "./types/ipc";

const api = {
  // Project
  openProject: (req?: OpenProjectRequest): Promise<OpenProjectResponse> =>
    ipcRenderer.invoke("project:open", req),
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

  // Kimi
  startSession: (req: StartSessionRequest): Promise<StartSessionResponse> =>
    ipcRenderer.invoke("kimi:startSession", req),
  checkKimiCli: (req?: CheckKimiCliRequest): Promise<CheckKimiCliResponse> =>
    ipcRenderer.invoke("kimi:checkCli", req),
  sendPrompt: (req: SendPromptRequest): Promise<SendPromptResponse> =>
    ipcRenderer.invoke("kimi:sendPrompt", req),
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
  getKimiUsage: (): Promise<KimiUsageResponse> =>
    ipcRenderer.invoke("kimi:getUsage"),

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

  // App
  getSettings: (): Promise<SettingsResponse> => ipcRenderer.invoke("app:getSettings"),
  saveSettings: (settings: SaveSettingsRequest): Promise<void> =>
    ipcRenderer.invoke("app:saveSettings", settings),
  getAppInfo: (): Promise<AppInfoResponse> => ipcRenderer.invoke("app:getInfo"),
  checkForUpdates: (): Promise<CheckUpdateResponse> => ipcRenderer.invoke("app:checkForUpdates"),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("app:openExternal", url),
  copyImage: (req: CopyImageRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("app:copyImage", req),
  triggerShortcut: (req: TriggerShortcutRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("app:triggerShortcut", req),

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
  onWindowMaximizedChange: (callback: (payload: { maximized: boolean }) => void) => {
    const handler = (_: unknown, payload: { maximized: boolean }) => callback(payload);
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
