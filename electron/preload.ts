import { contextBridge, ipcRenderer, webUtils } from "electron";
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
  SetKimiModelAdaptiveThinkingRequest,
  RemoveKimiModelConfigRequest,
  KimiDoctorConfigResponse,
  ListMcpServersResponse,
  ListKimiProviderCatalogResponse,
  AddMcpServerRequest,
  ImportPluginMcpServerRequest,
  RemoveMcpServerRequest,
  McpServerActionRequest,
  McpServerMutationResponse,
  TestMcpServerResponse,
  TestKimiModelConfigResponse,
  UpdateKimiCliResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  ListSlashCommandsRequest,
  ListSlashCommandsResponse,
  ImportCcCodexApplyRequest,
  ImportCcCodexApplyResponse,
  ImportCcCodexPreviewRequest,
  ImportCcCodexPreviewResponse,
  KimiThemeImportApplyRequest,
  KimiThemeImportApplyResponse,
  KimiThemeImportPreviewResponse,
  KimiThemeSourceDeleteRequest,
  KimiThemeSourceDeleteResponse,
  ExportSessionRequest,
  ExportSessionResponse,
  ExportSessionBackupRequest,
  ExportSessionBackupResponse,
  ImportSessionBackupRequest,
  ImportSessionBackupResponse,
  ExportMarkdownRequest,
  ExportMarkdownResponse,
  GitInfoResponse,
  GitDetailsResponse,
  GitGraphRequest,
  GitGraphResponse,
  GitCommitRequest,
  GitPullRequest,
  GitPushRequest,
  GitActionResponse,
  KimiUsageResponse,
  OpenFileRequest,
  OpenEditorRequest,
  OpenPathRequest,
  ListPreviewFilesRequest,
  ListPreviewFilesResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  RevertFilesRequest,
  CheckRevertConflictsRequest,
  CheckRevertConflictsResponse,
  SearchProjectFilesRequest,
  SearchProjectFilesResponse,
  ListSkillsResponse,
  ImportSkillArchiveRequest,
  ImportSkillArchiveResponse,
  SaveEnabledSkillsRequest,
  SaveEnabledSkillsResponse,
  PrepareKimiSkillRequest,
  PrepareKimiSkillResponse,
  SyncKimiAgentSkillsResponse,
  OpenTerminalRequest,
  AppInfoResponse,
  CheckUpdateResponse,
  DownloadUpdateProgress,
  DownloadUpdateResponse,
  CopyImageRequest,
  LaunchCommandRequest,
  TriggerShortcutRequest,
  TurnCompleteNotificationRequest,
  RendererHeartbeatPayload,
  RendererStartupMark,
  ScheduleShutdownRequest,
  GetScheduledShutdownResponse,
  GenerateHookRuleRequest,
  GenerateHookRuleResponse,
  SettingsResponse,
  SaveSettingsRequest,
  KimiCodeApprovalResponseRequest,
  KimiCodeActivatePluginCommandRequest,
  KimiCodeCreateSessionRequest,
  KimiCodeEventPayload,
  KimiCodeBackgroundTaskOutputPathResponse,
  KimiCodeBackgroundTaskOutputResponse,
  KimiCodeBackgroundTaskRequest,
  KimiCodeBackgroundTaskResponse,
  KimiCodeChildSessionRequest,
  KimiCodeInstallPluginRequest,
  KimiCodeListBackgroundTasksRequest,
  KimiCodeListBackgroundTasksResponse,
  KimiCodeListSessionsRequest,
  KimiCodeListSessionsResponse,
  KimiCodeListServerTerminalsResponse,
  KimiCodeOpenWebRequest,
  KimiCodeLoadSessionRequest,
  KimiCodeLoadSessionResponse,
  KimiCodeListMcpServersResponse,
  KimiCodeListPluginsResponse,
  KimiCodeListSkillsResponse,
  KimiCodeListMarketplaceResponse,
  KimiCodeConfigDiagnosticsResponse,
  KimiCodeManagedUsageRequest,
  KimiCodeManagedUsageResponse,
  KimiCodeMcpServerRequest,
  KimiCodeMcpStartupMetricsResponse,
  KimiCodeServerRuntimeDiagnosticsResponse,
  KimiCodePromptQueueResponse,
  KimiCodeServerModelCatalogResponse,
  KimiCodeArchivedSessionResponse,
  KimiCodeArchivedSessionsResponse,
  KimiCodeSetExperimentalFeatureRequest,
  KimiCodeSetExperimentalFeatureResponse,
  KimiCodePluginResponse,
  KimiCodePromptResponse,
  KimiCodeBtwRequest,
  KimiCodeBtwResponse,
  KimiCodeCreateGoalRequest,
  KimiCodeGoalActionRequest,
  KimiCodeGoalResponse,
  KimiCodeForkSessionRequest,
  KimiCodePromptRequest,
  KimiCodeQuestionResponseRequest,
  KimiCodeRenameSessionRequest,
  KimiCodeResumeSessionRequest,
  KimiCodeSessionRequest,
  KimiCodeSessionResponse,
  KimiCodeServerTerminalRequest,
  KimiCodeServerTerminalResponse,
  KimiCodeSwarmRequest,
  KimiCodeUndoHistoryRequest,
  KimiCodeSetPluginEnabledRequest,
  KimiCodeSetPluginMcpServerEnabledRequest,
  KimiCodeSetPermissionRequest,
  KimiCodeSetPlanModeRequest,
  KimiCodeSetModelRequest,
  KimiCodeStatusPayload,
  KimiCodeStatusResponse,
  KimiCodeUsageResponse,
  KimiCodeVoidResponse,
  Project,
  VoidResponse,
  LoggerWriteRequest,
  LoggerWriteResponse,
} from "./types/ipc";

const api = {
  platform: process.platform,

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
  setProjectPinned: (req: { id: string; pinned: boolean }): Promise<ListRecentResponse> =>
    ipcRenderer.invoke("project:setPinned", req),
  reorderProjects: (req: { orderedIds: string[] }): Promise<ListRecentResponse> =>
    ipcRenderer.invoke("project:reorder", req),
  getGitInfo: (projectPath: string): Promise<GitInfoResponse> =>
    ipcRenderer.invoke("project:getGitInfo", projectPath),
  getGitDetails: (projectPath: string): Promise<GitDetailsResponse> =>
    ipcRenderer.invoke("project:getGitDetails", projectPath),
  getGitGraph: (req: GitGraphRequest): Promise<GitGraphResponse> =>
    ipcRenderer.invoke("project:getGitGraph", req),
  commitGitChanges: (req: GitCommitRequest): Promise<GitActionResponse> =>
    ipcRenderer.invoke("project:gitCommit", req),
  pullGitChanges: (req: GitPullRequest): Promise<GitActionResponse> =>
    ipcRenderer.invoke("project:gitPull", req),
  pushGitChanges: (req: GitPushRequest): Promise<GitActionResponse> =>
    ipcRenderer.invoke("project:gitPush", req),
  openProjectPath: (req: OpenPathRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("project:openPath", req),
  revealPath: (req: OpenPathRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("project:revealPath", req),
  readTextFile: (req: ReadTextFileRequest): Promise<ReadTextFileResponse> =>
    ipcRenderer.invoke("project:readTextFile", req),
  listPreviewFiles: (req: ListPreviewFilesRequest): Promise<ListPreviewFilesResponse> =>
    ipcRenderer.invoke("project:listPreviewFiles", req),
  openFile: (req: OpenFileRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("project:openFile", req),
  revertFiles: (req: RevertFilesRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("project:revertFiles", req),
  checkRevertConflicts: (req: CheckRevertConflictsRequest): Promise<CheckRevertConflictsResponse> =>
    ipcRenderer.invoke("project:checkRevertConflicts", req),
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
  prepareKimiSkill: (req: PrepareKimiSkillRequest): Promise<PrepareKimiSkillResponse> =>
    ipcRenderer.invoke("project:prepareKimiSkill", req),
  syncKimiAgentSkills: (): Promise<SyncKimiAgentSkillsResponse> =>
    ipcRenderer.invoke("project:syncKimiAgentSkills"),
  importSkillArchive: (req?: ImportSkillArchiveRequest): Promise<ImportSkillArchiveResponse> =>
    ipcRenderer.invoke("project:importSkillArchive", req),
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
  startKimiCodeRuntime: (req: StartSessionRequest): Promise<StartSessionResponse> =>
    ipcRenderer.invoke("kimi-code:startRuntime", req),
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
  setKimiModelAdaptiveThinking: (req: SetKimiModelAdaptiveThinkingRequest): Promise<SaveKimiModelConfigResponse> =>
    ipcRenderer.invoke("kimi:setModelAdaptiveThinking", req),
  removeKimiModelConfig: (req: RemoveKimiModelConfigRequest): Promise<SaveKimiModelConfigResponse> =>
    ipcRenderer.invoke("kimi:removeModelConfig", req),
  listKimiProviderCatalog: (): Promise<ListKimiProviderCatalogResponse> =>
    ipcRenderer.invoke("kimi:listProviderCatalog"),
  doctorKimiConfig: (): Promise<KimiDoctorConfigResponse> =>
    ipcRenderer.invoke("kimi:doctorConfig"),
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
  listKimiCodeSlashCommands: (req: ListSlashCommandsRequest): Promise<ListSlashCommandsResponse> =>
    ipcRenderer.invoke("kimi-code:listSlashCommands", req),
  previewImportFromCcCodex: (req?: ImportCcCodexPreviewRequest): Promise<ImportCcCodexPreviewResponse> =>
    ipcRenderer.invoke("kimi:previewImportFromCcCodex", req),
  applyImportFromCcCodex: (req: ImportCcCodexApplyRequest): Promise<ImportCcCodexApplyResponse> =>
    ipcRenderer.invoke("kimi:applyImportFromCcCodex", req),
  previewKimiThemeImport: (): Promise<KimiThemeImportPreviewResponse> =>
    ipcRenderer.invoke("kimi:previewThemeImport"),
  applyKimiThemeImport: (req: KimiThemeImportApplyRequest): Promise<KimiThemeImportApplyResponse> =>
    ipcRenderer.invoke("kimi:applyThemeImport", req),
  deleteKimiThemeSource: (req: KimiThemeSourceDeleteRequest): Promise<KimiThemeSourceDeleteResponse> =>
    ipcRenderer.invoke("kimi:deleteThemeSource", req),
  listKimiCodeHistorySessions: (req: ListSessionsRequest): Promise<ListSessionsResponse> =>
    ipcRenderer.invoke("kimi-code:listHistorySessions", req),
  exportKimiCodeSession: (req?: ExportSessionRequest): Promise<ExportSessionResponse> =>
    ipcRenderer.invoke("kimi-code:exportSession", req),
  exportSessionBackup: (req: ExportSessionBackupRequest): Promise<ExportSessionBackupResponse> =>
    ipcRenderer.invoke("project:exportSessionBackup", req),
  importSessionBackup: (req?: ImportSessionBackupRequest): Promise<ImportSessionBackupResponse> =>
    ipcRenderer.invoke("project:importSessionBackup", req),
  exportMarkdown: (req: ExportMarkdownRequest): Promise<ExportMarkdownResponse> =>
    ipcRenderer.invoke("project:exportMarkdown", req),
  getKimiCodeAccountUsage: (): Promise<KimiUsageResponse> =>
    ipcRenderer.invoke("kimi-code:getAccountUsage"),
  startKimiCodeVis: (req?: { sessionId?: string; noOpen?: boolean }): Promise<VoidResponse> =>
    ipcRenderer.invoke("kimi-code:startVis", req),
  openKimiCodeWebServer: (req?: KimiCodeOpenWebRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("kimi-code:openWebServer", req),

  // Event listeners
  createKimiCodeSession: (req: KimiCodeCreateSessionRequest): Promise<KimiCodeSessionResponse> =>
    ipcRenderer.invoke("kimi-code:createSession", req),
  resumeKimiCodeSession: (req: KimiCodeResumeSessionRequest): Promise<KimiCodeSessionResponse> =>
    ipcRenderer.invoke("kimi-code:resumeSession", req),
  forkKimiCodeSession: (req: KimiCodeForkSessionRequest): Promise<KimiCodeSessionResponse> =>
    ipcRenderer.invoke("kimi-code:forkSession", req),
  listKimiCodeChildSessions: (req: KimiCodeSessionRequest): Promise<KimiCodeListSessionsResponse> =>
    ipcRenderer.invoke("kimi-code:listChildSessions", req),
  createKimiCodeChildSession: (req: KimiCodeChildSessionRequest): Promise<KimiCodeSessionResponse> =>
    ipcRenderer.invoke("kimi-code:createChildSession", req),
  renameKimiCodeSession: (req: KimiCodeRenameSessionRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:renameSession", req),
  reloadKimiCodeSession: (req: KimiCodeSessionRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:reloadSession", req),
  sendKimiCodePrompt: (req: KimiCodePromptRequest): Promise<KimiCodePromptResponse> =>
    ipcRenderer.invoke("kimi-code:sendPrompt", req),
  askKimiCodeBtw: (req: KimiCodeBtwRequest): Promise<KimiCodeBtwResponse> =>
    ipcRenderer.invoke("kimi-code:askBtw", req),
  swarmKimiCode: (req: KimiCodeSwarmRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:swarm", req),
  createKimiCodeGoal: (req: KimiCodeCreateGoalRequest): Promise<KimiCodeGoalResponse> =>
    ipcRenderer.invoke("kimi-code:createGoal", req),
  getKimiCodeGoal: (req: KimiCodeSessionRequest): Promise<KimiCodeGoalResponse> =>
    ipcRenderer.invoke("kimi-code:getGoal", req),
  pauseKimiCodeGoal: (req: KimiCodeGoalActionRequest): Promise<KimiCodeGoalResponse> =>
    ipcRenderer.invoke("kimi-code:pauseGoal", req),
  resumeKimiCodeGoal: (req: KimiCodeGoalActionRequest): Promise<KimiCodeGoalResponse> =>
    ipcRenderer.invoke("kimi-code:resumeGoal", req),
  cancelKimiCodeGoal: (req: KimiCodeGoalActionRequest): Promise<KimiCodeGoalResponse> =>
    ipcRenderer.invoke("kimi-code:cancelGoal", req),
  steerKimiCode: (req: KimiCodePromptRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:steer", req),
  undoKimiCodeHistory: (req: KimiCodeUndoHistoryRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:undoHistory", req),
  cancelKimiCodeTurn: (req: KimiCodeSessionRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:cancel", req),
  setKimiCodePlanMode: (req: KimiCodeSetPlanModeRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:setPlanMode", req),
  setKimiCodeModel: (req: KimiCodeSetModelRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:setModel", req),
  setKimiCodePermission: (req: KimiCodeSetPermissionRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:setPermission", req),
  compactKimiCodeSession: (req: KimiCodeSessionRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:compact", req),
  archiveKimiCodeSession: (req: KimiCodeSessionRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:archiveSession", req),
  respondKimiCodeApproval: (req: KimiCodeApprovalResponseRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:respondApproval", req),
  respondKimiCodeQuestion: (req: KimiCodeQuestionResponseRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:respondQuestion", req),
  getKimiCodeStatus: (req: KimiCodeSessionRequest): Promise<KimiCodeStatusResponse> =>
    ipcRenderer.invoke("kimi-code:getStatus", req),
  getKimiCodeUsage: (req: KimiCodeSessionRequest): Promise<KimiCodeUsageResponse> =>
    ipcRenderer.invoke("kimi-code:getUsage", req),
  getKimiCodeConfigDiagnostics: (): Promise<KimiCodeConfigDiagnosticsResponse> =>
    ipcRenderer.invoke("kimi-code:getConfigDiagnostics"),
  getKimiCodeManagedUsage: (req?: KimiCodeManagedUsageRequest): Promise<KimiCodeManagedUsageResponse> =>
    ipcRenderer.invoke("kimi-code:getManagedUsage", req),
  listKimiCodeMcpServers: (req: KimiCodeSessionRequest): Promise<KimiCodeListMcpServersResponse> =>
    ipcRenderer.invoke("kimi-code:listMcpServers", req),
  getKimiCodeMcpStartupMetrics: (req: KimiCodeSessionRequest): Promise<KimiCodeMcpStartupMetricsResponse> =>
    ipcRenderer.invoke("kimi-code:getMcpStartupMetrics", req),
  getKimiCodeServerRuntimeDiagnostics: (req: KimiCodeSessionRequest): Promise<KimiCodeServerRuntimeDiagnosticsResponse> =>
    ipcRenderer.invoke("kimi-code:getServerRuntimeDiagnostics", req),
  getKimiCodePromptQueue: (req: KimiCodeSessionRequest): Promise<KimiCodePromptQueueResponse> =>
    ipcRenderer.invoke("kimi-code:getPromptQueue", req),
  getKimiCodeServerModelCatalog: (): Promise<KimiCodeServerModelCatalogResponse> =>
    ipcRenderer.invoke("kimi-code:getServerModelCatalog"),
  listKimiCodeArchivedSessions: (): Promise<KimiCodeArchivedSessionsResponse> =>
    ipcRenderer.invoke("kimi-code:listArchivedSessions"),
  restoreKimiCodeArchivedSession: (req: KimiCodeSessionRequest): Promise<KimiCodeArchivedSessionResponse> =>
    ipcRenderer.invoke("kimi-code:restoreArchivedSession", req),
  setKimiCodeExperimentalFeature: (req: KimiCodeSetExperimentalFeatureRequest): Promise<KimiCodeSetExperimentalFeatureResponse> =>
    ipcRenderer.invoke("kimi-code:setExperimentalFeature", req),
  reconnectKimiCodeMcpServer: (req: KimiCodeMcpServerRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:reconnectMcpServer", req),
  listKimiCodeBackgroundTasks: (req: KimiCodeListBackgroundTasksRequest): Promise<KimiCodeListBackgroundTasksResponse> =>
    ipcRenderer.invoke("kimi-code:listBackgroundTasks", req),
  getKimiCodeBackgroundTaskOutput: (req: KimiCodeBackgroundTaskRequest): Promise<KimiCodeBackgroundTaskOutputResponse> =>
    ipcRenderer.invoke("kimi-code:getBackgroundTaskOutput", req),
  getKimiCodeBackgroundTaskOutputPath: (req: KimiCodeBackgroundTaskRequest): Promise<KimiCodeBackgroundTaskOutputPathResponse> =>
    ipcRenderer.invoke("kimi-code:getBackgroundTaskOutputPath", req),
  stopKimiCodeBackgroundTask: (req: KimiCodeBackgroundTaskRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:stopBackgroundTask", req),
  detachKimiCodeBackgroundTask: (req: KimiCodeBackgroundTaskRequest): Promise<KimiCodeBackgroundTaskResponse> =>
    ipcRenderer.invoke("kimi-code:detachBackgroundTask", req),
  listKimiCodeServerTerminals: (req: KimiCodeSessionRequest): Promise<KimiCodeListServerTerminalsResponse> =>
    ipcRenderer.invoke("kimi-code:listServerTerminals", req),
  createKimiCodeServerTerminal: (req: KimiCodeServerTerminalRequest): Promise<KimiCodeServerTerminalResponse> =>
    ipcRenderer.invoke("kimi-code:createServerTerminal", req),
  closeKimiCodeServerTerminal: (req: KimiCodeServerTerminalRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:closeServerTerminal", req),
  attachKimiCodeServerTerminal: (req: KimiCodeServerTerminalRequest): Promise<{ success: boolean; data?: unknown; error?: string }> =>
    ipcRenderer.invoke("kimi-code:attachServerTerminal", req),
  detachKimiCodeServerTerminal: (req: KimiCodeServerTerminalRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:detachServerTerminal", req),
  writeKimiCodeServerTerminal: (req: KimiCodeServerTerminalRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:writeServerTerminal", req),
  resizeKimiCodeServerTerminal: (req: KimiCodeServerTerminalRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:resizeServerTerminal", req),
  listKimiCodeSessions: (req?: KimiCodeListSessionsRequest): Promise<KimiCodeListSessionsResponse> =>
    ipcRenderer.invoke("kimi-code:listSessions", req),
  closeKimiCodeSession: (req: KimiCodeSessionRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:closeSession", req),
  loadKimiCodeSession: (req: KimiCodeLoadSessionRequest): Promise<KimiCodeLoadSessionResponse> =>
    ipcRenderer.invoke("kimi-code:loadSession", req),
  listKimiCodeMarketplace: (): Promise<KimiCodeListMarketplaceResponse> =>
    ipcRenderer.invoke("kimi-code:listMarketplace"),
  listKimiCodePlugins: (req: { sessionId?: string }): Promise<KimiCodeListPluginsResponse> =>
    ipcRenderer.invoke("kimi-code:listPlugins", req),
  listKimiCodeSkills: (req: { sessionId?: string }): Promise<KimiCodeListSkillsResponse> =>
    ipcRenderer.invoke("kimi-code:listSkills", req),
  activateKimiCodeSkill: (req: { sessionId: string; name: string; args?: string }): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:activateSkill", req),
  activateKimiCodePluginCommand: (req: KimiCodeActivatePluginCommandRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:activatePluginCommand", req),
  installKimiCodePlugin: (req: KimiCodeInstallPluginRequest): Promise<KimiCodePluginResponse> =>
    ipcRenderer.invoke("kimi-code:installPlugin", req),
  setKimiCodePluginEnabled: (req: KimiCodeSetPluginEnabledRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:setPluginEnabled", req),
  setKimiCodePluginMcpServerEnabled: (req: KimiCodeSetPluginMcpServerEnabledRequest): Promise<KimiCodeVoidResponse> =>
    ipcRenderer.invoke("kimi-code:setPluginMcpServerEnabled", req),
  onKimiCodeEvent: (callback: (payload: KimiCodeEventPayload) => void) => {
    const handler = (_: unknown, payload: KimiCodeEventPayload) => callback(payload);
    ipcRenderer.on("kimi-code:event", handler);
    return () => ipcRenderer.off("kimi-code:event", handler);
  },
  onKimiCodeStatus: (callback: (payload: KimiCodeStatusPayload) => void) => {
    const handler = (_: unknown, payload: KimiCodeStatusPayload) => callback(payload);
    ipcRenderer.on("kimi-code:status", handler);
    return () => ipcRenderer.off("kimi-code:status", handler);
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
  writeDiag: (req?: LoggerWriteRequest): Promise<LoggerWriteResponse> =>
    ipcRenderer.invoke("app:writeDiag", req),
  getDiagLogPath: (): Promise<{ success: true; data: string }> =>
    ipcRenderer.invoke("app:getDiagLogPath"),
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
  getDraggedFilePath: (file: File): string => webUtils.getPathForFile(file),
  reportRendererHeartbeat: (payload: RendererHeartbeatPayload): void =>
    ipcRenderer.send("app:rendererHeartbeat", payload),
  reportRendererStartup: (payload: RendererStartupMark): void =>
    ipcRenderer.send("app:rendererStartup", payload),
  clearTaskbarAttention: (): Promise<VoidResponse> =>
    ipcRenderer.invoke("app:clearTaskbarAttention"),
  scheduleShutdown: (req: ScheduleShutdownRequest): Promise<VoidResponse> =>
    ipcRenderer.invoke("app:scheduleShutdown", req),
  cancelShutdown: (): Promise<VoidResponse> =>
    ipcRenderer.invoke("app:cancelShutdown"),
  getScheduledShutdown: (): Promise<GetScheduledShutdownResponse> =>
    ipcRenderer.invoke("app:getScheduledShutdown"),

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

  onMainLog: (callback: (payload: { level: string; message: string }) => void) => {
    const handler = (_: unknown, payload: { level: string; message: string }) => callback(payload);
    ipcRenderer.on("kimix:main-log", handler);
    return () => ipcRenderer.off("kimix:main-log", handler);
  },
};

contextBridge.exposeInMainWorld("api", api);

// Debug: log renderer DOM content after load
window.addEventListener("DOMContentLoaded", () => {
  if (process.env.NODE_ENV === "production") return;
  setTimeout(() => {
    console.log("[KIMIX RENDERER] DOM ready, root content length:", document.getElementById("root")?.innerHTML?.length ?? 0);
  }, 2000);
});

export type WindowAPI = typeof api;
