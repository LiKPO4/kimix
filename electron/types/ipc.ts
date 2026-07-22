import type { RoomSessionMetadataInput } from "../../src/utils/roomSessionMetadata";

export type OpenProjectRequest = {
  defaultPath?: string;
}

export type OpenProjectResponse = {
  success: true;
  data: Project | null;
} | {
  success: false;
  error: string;
};

export type ChooseDirectoryRequest = {
  defaultPath?: string;
};

export type ChooseDirectoryResponse = {
  success: true;
  data: string | null;
} | {
  success: false;
  error: string;
};

export type Project = {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number;
  gitBranch?: string;
  /** 用户置顶的项目固定显示在列表顶部区域。 */
  pinned?: boolean;
  /** 显式排序权重（同区域内升序）；用于拖动排序持久化。 */
  sortOrder?: number;
}

export type LongTaskStage = "drafting" | "planning" | "ready" | "running" | "reviewing" | "paused" | "completed";
export type LongTaskAgentRole = "executor" | "reviewer";

export type LongTaskRecoveryStatus = "none" | "failed" | "interrupted" | "paused";

export type LongTaskRecoveryInfo = {
  status: LongTaskRecoveryStatus;
  reason: string;
  suggestedAction: string;
  updatedAt: number;
};

export type LongTaskSummary = {
  id: string;
  title: string;
  projectPath: string;
  projectName: string;
  taskDir: string;
  bigPlanPath: string;
  executorPromptPath: string;
  reviewerPromptPath: string;
  reviewQueuePath: string;
  executorSessionId: string;
  reviewerSessionId: string;
  stage: LongTaskStage;
  activeAgent: LongTaskAgentRole;
  recovery?: LongTaskRecoveryInfo | null;
  currentStep: number;
  targetStep: number | null;
  reviewedReviewItems?: string[];
  createdAt: number;
  updatedAt: number;
  initialRequest: string;
}

export type ListLongTasksRequest = {
  projectPath: string;
}

export type ListLongTasksResponse = {
  success: true;
  data: LongTaskSummary[];
} | {
  success: false;
  error: string;
};

export type CreateLongTaskRequest = {
  project: Project;
  title?: string;
  initialRequest: string;
  thinking?: boolean;
  yoloMode?: boolean;
  autoMode?: boolean;
}

export type CreateLongTaskResponse = {
  success: true;
  data: LongTaskSummary;
} | {
  success: false;
  error: string;
};

export type GetLongTaskDetailRequest = {
  projectPath: string;
  taskId: string;
}

export type LongTaskRoundRecord = {
  step: number;
  filePath: string;
  content: string;
  updatedAt: number;
}

export type LongTaskDetail = LongTaskSummary & {
  bigPlanContent: string;
  reviewQueueContent: string;
  rounds: LongTaskRoundRecord[];
}

export type GetLongTaskDetailResponse = {
  success: true;
  data: LongTaskDetail;
} | {
  success: false;
  error: string;
};

export type UpdateLongTaskStateRequest = {
  projectPath: string;
  taskId: string;
  patch: Partial<Pick<LongTaskSummary, "stage" | "activeAgent" | "recovery" | "currentStep" | "targetStep" | "reviewedReviewItems" | "executorSessionId" | "reviewerSessionId">>;
}

export type UpdateLongTaskStateResponse = {
  success: true;
  data: LongTaskSummary;
} | {
  success: false;
  error: string;
};

export type AppendLongTaskRoundRequest = {
  projectPath: string;
  taskId: string;
  step: number;
  role: LongTaskAgentRole;
  phase: "execution" | "review" | "fix" | "handoff" | "complete";
  conclusion?: string;
  content: string;
}

export type AppendLongTaskRoundResponse = {
  success: true;
  data: {
    filePath: string;
  };
} | {
  success: false;
  error: string;
};

export type ListRecentResponse = {
  success: true;
  data: Project[];
} | {
  success: false;
  error: string;
};

export type StartSessionRequest = {
  workDir: string;
  sessionId?: string;
  model?: string;
  thinking?: boolean;
  yoloMode?: boolean;
  autoMode?: boolean;
  planMode?: boolean;
  skillsDir?: string;
  agentFile?: string;
  additionalWorkDirs?: string[];
}

export type StartSessionResponse = {
  success: true;
  data: {
    sessionId: string;
    workDir: string;
    model?: string | null;
    slashCommands?: SlashCommandInfo[];
  };
} | {
  success: false;
  error: string;
};

export type SlashCommandInfo = {
  name: string;
  description: string;
  aliases: string[];
  kind?: "slash" | "plugin-command";
  pluginId?: string;
  commandName?: string;
}

export type ListSlashCommandsRequest = {
  sessionId: string;
}

export type ListSlashCommandsResponse = {
  success: true;
  data: SlashCommandInfo[];
} | {
  success: false;
  error: string;
};

export type ImportCcCodexPreviewRequest = {
  workDir?: string;
}

export type ImportCcCodexApplyRequest = {
  previewId: string;
}

export type ImportCcCodexPlanItem = {
  kind: "instruction" | "skill" | "mcp";
  source: string;
  target: string;
  label: string;
  action: "append" | "copy" | "merge" | "skip";
  reason?: string;
}

export type ImportCcCodexPreviewResponse = {
  success: true;
  data: {
    previewId: string;
    kimiHome: string;
    projectRoot?: string;
    items: ImportCcCodexPlanItem[];
    warnings: string[];
  };
} | {
  success: false;
  error: string;
};

export type ImportCcCodexApplyResponse = {
  success: true;
  data: {
    imported: ImportCcCodexPlanItem[];
    skipped: ImportCcCodexPlanItem[];
    backups: string[];
    warnings: string[];
  };
} | {
  success: false;
  error: string;
};

export type ThemePaletteColors = {
  primary: string;
  surface: string;
  accent: string;
}

export type KimiThemePalette = {
  primary: string;
  accent: string;
  text: string;
  textStrong: string;
  textDim: string;
  textMuted: string;
  border: string;
  borderFocus: string;
  success: string;
  warning: string;
  error: string;
  diffAdded: string;
  diffRemoved: string;
  diffAddedStrong: string;
  diffRemovedStrong: string;
  diffGutter: string;
  diffMeta: string;
  roleUser: string;
}

export type KimiThemePreset = {
  id: string;
  name: string;
  displayName: string;
  path?: string;
  base?: "light" | "dark";
  palette: KimiThemePalette;
  colors?: ThemePaletteColors;
  createdAt?: number;
  updatedAt?: number;
}

export type KimiThemeImportItem = {
  id: string;
  name: string;
  displayName: string;
  path: string;
  base: "light" | "dark";
  colors: ThemePaletteColors;
  kimiColors: KimiThemePalette;
  sourceTokens: {
    primary?: string;
    surface?: string;
    accent?: string;
  };
  warning?: string;
}

export type KimiThemeImportPreviewResponse = {
  success: true;
  data: {
    previewId: string;
    themesDir: string;
    items: KimiThemeImportItem[];
    warnings: string[];
  };
} | {
  success: false;
  error: string;
};

export type KimiThemeImportApplyRequest = {
  previewId: string;
  themeId: string;
}

export type KimiThemeImportApplyResponse = {
  success: true;
  data: KimiThemeImportItem;
} | {
  success: false;
  error: string;
};

export type CheckKimiCliResponse = {
  success: true;
  data: {
    available: boolean;
    verified: boolean;
    command: string;
    path?: string;
    output?: string;
    version?: string | null;
    isLegacy?: boolean;
    shellPath?: string | null;
    shellAvailable?: boolean;
    message: string;
  };
} | {
  success: false;
  error: string;
};

export type CheckKimiCliRequest = {
  verify?: boolean;
};

export type KimiAuthStatus = {
  available: boolean;
  path?: string;
  loggedIn: boolean;
  configPath: string;
  mcpConfigPath: string;
  defaultModel: string | null;
  defaultThinking: boolean;
  message: string;
};

export type KimiModelProviderSummary = {
  name: string;
  type: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
  hasEnv: boolean;
  hasOauth: boolean;
};

export type KimiModelAliasSummary = {
  alias: string;
  provider: string | null;
  model: string | null;
  displayName: string | null;
  maxContextSize: number | null;
  adaptiveThinking: boolean | null;
  isDefault: boolean;
};

export type KimiModelConfigSummary = {
  configPath: string;
  exists: boolean;
  defaultModel: string | null;
  providers: KimiModelProviderSummary[];
  models: KimiModelAliasSummary[];
};

export type GetKimiModelConfigResponse = {
  success: true;
  data: KimiModelConfigSummary;
} | {
  success: false;
  error: string;
};

export type KimiOpenAiProviderConfigRequest = {
  providerName: string;
  modelAlias: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  maxContextSize?: number;
  makeDefault?: boolean;
};

export type SaveKimiProviderRequest = {
  providerName: string;
  baseUrl: string;
  apiKey?: string;
};

export type SaveKimiProviderModelRequest = {
  providerName: string;
  modelAlias: string;
  model: string;
  maxContextSize?: number;
  makeDefault?: boolean;
};

export type SetKimiDefaultModelRequest = {
  modelAlias: string;
};

export type SetKimiModelAdaptiveThinkingRequest = {
  modelAlias: string;
  adaptiveThinking: boolean;
};

export type RemoveKimiModelConfigRequest = {
  modelAlias: string;
};

export type RemoveKimiProviderConfigRequest = {
  providerName: string;
};

export type KimiProviderCatalogModelSummary = {
  id: string;
  name: string | null;
  maxContextSize: number | null;
  thinking: boolean;
  toolUse: boolean;
};

export type KimiProviderCatalogEntrySummary = {
  providerId: string;
  type: string;
  baseUrl: string | null;
  modelCount: number;
  models: KimiProviderCatalogModelSummary[];
};

export type SaveKimiModelConfigResponse = {
  success: true;
  data: KimiModelConfigSummary & {
    message: string;
  };
} | {
  success: false;
  error: string;
};

export type TestKimiModelConfigResponse = {
  success: true;
  data: {
    message: string;
    output: string;
  };
} | {
  success: false;
  error: string;
};

export type ListKimiProviderCatalogResponse = {
  success: true;
  data: {
    providers: KimiProviderCatalogEntrySummary[];
  };
} | {
  success: false;
  error: string;
};

export type KimiDoctorConfigResponse = {
  success: true;
  data: {
    ok: boolean;
    output: string;
    message: string;
    environment?: {
      kimiCodeHome: string;
      proxy: {
        key: "HTTP_PROXY" | "HTTPS_PROXY" | "ALL_PROXY" | "NO_PROXY";
        configured: boolean;
        value: string;
      }[];
    };
  };
} | {
  success: false;
  error: string;
};

export type GetKimiAuthStatusResponse = {
  success: true;
  data: KimiAuthStatus;
} | {
  success: false;
  error: string;
};

export type KimiLoginResponse = {
  success: true;
  data: KimiAuthStatus & {
    verificationUrl?: string;
    message: string;
  };
} | {
  success: false;
  error: string;
};

export type KimiLogoutResponse = {
  success: true;
  data: KimiAuthStatus & {
    message: string;
  };
} | {
  success: false;
  error: string;
};

export type McpServerInfo = {
  name: string;
  transport: "http" | "sse" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  auth?: "oauth" | string;
};

export type PluginMcpServerInfo = McpServerInfo & {
  pluginId: string;
  pluginName: string;
  pluginPath: string;
  manifestPath: string;
  enabled: boolean;
};

export type ListMcpServersResponse = {
  success: true;
  data: {
    configPath: string;
    servers: McpServerInfo[];
    pluginServers: PluginMcpServerInfo[];
    rawExists: boolean;
  };
} | {
  success: false;
  error: string;
};

export type AddMcpServerRequest = {
  name: string;
  transport: "http" | "sse" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  env?: string[];
  headers?: string[];
  auth?: "oauth";
};

export type ImportPluginMcpServerRequest = {
  manifestPath: string;
  name: string;
};

export type RemoveMcpServerRequest = {
  name: string;
};

export type McpServerActionRequest = {
  name: string;
};

export type McpServerMutationResponse = {
  success: true;
  data: {
    message: string;
  };
} | {
  success: false;
  error: string;
};

export type TestMcpServerResponse = {
  success: true;
  data: {
    success: boolean;
    output: string;
  };
} | {
  success: false;
  error: string;
};

export type InstallKimiCliResponse = {
  success: true;
  data: {
    path?: string;
    output?: string;
    message: string;
  };
} | {
  success: false;
  error: string;
};

export type KimiCliUpdateInfo = {
  available: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  hasUpdate: boolean;
  isLegacy?: boolean;
  migrationHint?: string;
  path?: string;
  message: string;
};

export type CheckKimiCliUpdateResponse = {
  success: true;
  data: KimiCliUpdateInfo;
} | {
  success: false;
  error: string;
};

export type UpdateKimiCliResponse = {
  success: true;
  data: KimiCliUpdateInfo & {
    output?: string;
  };
} | {
  success: false;
  error: string;
};

export type SendPromptRequest = {
  sessionId: string;
  content: string;
  images?: {
    name: string;
    dataUrl: string;
  }[];
  thinking?: boolean;
  yoloMode?: boolean;
  autoMode?: boolean;
  planMode?: boolean;
}

export type SendPromptResponse = {
  success: true;
  data: {
    turnId: string;
  };
} | {
  success: false;
  error: string;
};

export type SetPlanModeRequest = {
  sessionId: string;
  enabled: boolean;
}

export type SetPlanModeResponse = {
  success: true;
  data: {
    enabled: boolean;
  };
} | {
  success: false;
  error: string;
};

export type SteerPromptRequest = {
  sessionId: string;
  content: string;
  images?: {
    name: string;
    dataUrl: string;
  }[];
}

export type SteerPromptResponse = {
  success: true;
  data: void;
} | {
  success: false;
  error: string;
};

export type StopTurnRequest = {
  sessionId: string;
}

export type StopTurnResponse = {
  success: true;
  data: void;
} | {
  success: false;
  error: string;
};

export type ApproveRequest = {
  sessionId: string;
  requestId: string;
  approved: boolean;
  scope?: "once" | "session";
}

export type ApproveResponse = {
  success: true;
  data: void;
} | {
  success: false;
  error: string;
};

export type RespondQuestionRequest = {
  sessionId: string;
  rpcRequestId: string;
  questionRequestId: string;
  answers: Record<string, string>;
}

export type RespondQuestionResponse = {
  success: true;
  data: void;
} | {
  success: false;
  error: string;
};

export type CloseSessionRequest = {
  sessionId: string;
}

export type CloseSessionResponse = {
  success: true;
  data: void;
} | {
  success: false;
  error: string;
};

export type ListSessionsRequest = {
  workDir: string;
}

export type SessionInfo = {
  id: string;
  workDir: string;
  updatedAt: number;
  brief: string;
}

export type ListSessionsResponse = {
  success: true;
  data: SessionInfo[];
} | {
  success: false;
  error: string;
};

export type LoadSessionRequest = {
  workDir: string;
  sessionId: string;
}

export type LoadSessionResponse = {
  success: true;
  data: {
    sessionId: string;
    events: unknown[];
  };
} | {
  success: false;
  error: string;
};

export type ExportSessionRequest = {
  sessionId?: string;
  title?: string;
  agents?: Array<{
    roomAgentId: string;
    displayName: string;
    sessionId: string;
  }>;
}

export type SessionBackupSnapshot = {
  schemaVersion: number;
  appVersion?: string;
  exportedAt?: string;
  source?: string;
  sessions: unknown[];
  pendingMessages: unknown[];
  projects: unknown[];
  archivedTombstones: unknown[];
  hiddenHandoffSessionIds: string[];
  roomAgentActivities?: unknown[];
  activeContext?: unknown;
};

export type ExportSessionBackupRequest = {
  snapshot: SessionBackupSnapshot;
  suggestedName?: string;
}

export type ImportSessionBackupRequest = {
  path?: string;
}

export type ExportMarkdownRequest = {
  title?: string;
  content: string;
}

export type ExportMarkdownResponse = {
  success: true;
  data: {
    path: string;
    output?: string;
  };
} | {
  success: false;
  error: string;
};

export type ExportSessionResponse = {
  success: true;
  data: {
    path: string;
    output?: string;
    selectedAgentId?: string;
    selectedAgentName?: string;
  };
} | {
  success: false;
  error: string;
};

export type ExportSessionBackupResponse = {
  success: true;
  data: {
    path: string;
    output?: string;
  };
} | {
  success: false;
  error: string;
};

export type ImportSessionBackupResponse = {
  success: true;
  data: {
    path: string;
    snapshot: SessionBackupSnapshot;
    canceled?: boolean;
  };
} | {
  success: false;
  error: string;
};

export type GitInfoResponse = {
  success: true;
  data: {
    branch?: string;
    status: string;
    gitRoot?: string;
    upstream?: string;
    remoteName?: string;
    remoteUrl?: string;
    ahead?: number;
    behind?: number;
  };
} | {
  success: false;
  error: string;
};

export type GitStatusFile = {
  path: string;
  status: string;
  additions?: number;
  deletions?: number;
};

export type GitDetailsResponse = {
  success: true;
  data: {
    branch?: string;
    status: string;
    gitRoot?: string;
    upstream?: string;
    remoteName?: string;
    remoteUrl?: string;
    ahead?: number;
    behind?: number;
    files: GitStatusFile[];
    totalFileCount?: number;
    truncated?: boolean;
  };
} | {
  success: false;
  error: string;
};

export type GitGraphEntry = {
  graph: string;
  shortHash: string;
  hash: string;
  parents: string[];
  author: string;
  date: string;
  refs: string[];
  subject: string;
};

export type GitGraphRequest = {
  projectPath: string;
  limit?: number;
};

export type GitGraphResponse = {
  success: true;
  data: {
    branch?: string;
    gitRoot?: string;
    commits: GitGraphEntry[];
    limit: number;
    truncated?: boolean;
  };
} | {
  success: false;
  error: string;
};

export type GitCommitRequest = {
  projectPath: string;
  message: string;
  files?: string[];
};

export type GitPullRequest = {
  projectPath: string;
};

export type GitPushRequest = {
  projectPath: string;
};

export type GitActionResponse = {
  success: true;
  data: {
    branch?: string;
    status: string;
    upstream?: string;
    remoteName?: string;
    remoteUrl?: string;
    ahead?: number;
    behind?: number;
    output: string;
  };
} | {
  success: false;
  error: string;
};

export type UsagePeriod = {
  label: string;
  used?: number;
  limit?: number;
  percent?: number;
  available: boolean;
  refreshAt?: number;
  /** Actual window duration in milliseconds, if known from the upstream response. */
  windowMs?: number;
  message?: string;
};

export type ExtraUsageInfo = {
  balanceCents: number;
  totalCents: number;
  monthlyChargeLimitEnabled: boolean;
  monthlyChargeLimitCents: number;
  monthlyUsedCents: number;
  currency: string;
};

export type KimiUsageResponse = {
  success: true;
  data: {
    available: boolean;
    updatedAt: number;
    source: string;
    totalQuota?: number;
    extraUsage?: ExtraUsageInfo;
    periods: UsagePeriod[];
    message?: string;
  };
} | {
  success: false;
  error: string;
};

export type OpenPathRequest = {
  path: string;
}

export type ReadTextFileRequest = {
  path: string;
  projectPath?: string;
  sessionId?: string;
}

export type ReadTextFileResponse = {
  success: true;
  data: {
    path: string;
    content: string;
    updatedAt: number;
    missing?: boolean;
    message?: string;
  };
} | {
  success: false;
  error: string;
};

export type ListPreviewFilesRequest = {
  projectPath: string;
  extensions?: string[];
}

export type PreviewFileInfo = {
  path: string;
  name: string;
  extension: string;
  size: number;
  updatedAt: number;
}

export type ListPreviewFilesResponse = {
  success: true;
  data: PreviewFileInfo[];
} | {
  success: false;
  error: string;
};

export type OpenFileRequest = {
  projectPath: string;
  filePath: string;
}

export type ChangePreviewRequest = {
  projectPath: string;
  filePath: string;
  eventTimestamp?: number;
  commitSha?: string;
}

export type ChangePreviewResponse = {
  success: true;
  data: {
    source: "commit" | "workspace" | "unavailable";
    patch: string;
    additions?: number;
    deletions?: number;
    commitSha?: string;
    truncated?: boolean;
  };
} | {
  success: false;
  error: string;
};

export type RevertFilesRequest = {
  projectPath: string;
  additionalWorkDirs?: string[];
  files: Array<string | {
    path: string;
    additions?: number;
    deletions?: number;
    snapshotHash?: string;
  }>;
  force?: boolean;
}

export type RevertConflict = {
  path: string;
  snapshotHash: string;
  currentHash: string;
  currentText: string;
  oldText?: string;
};

export type CheckRevertConflictsRequest = {
  projectPath: string;
  additionalWorkDirs?: string[];
  files: Array<{
    path: string;
    snapshotHash?: string;
  }>;
};

export type CheckRevertConflictsResponse = {
  success: true;
  conflicts: RevertConflict[];
} | {
  success: false;
  error: string;
};

export type OpenEditorRequest = {
  path: string;
  editor: "vscode";
}

export type OpenTerminalRequest = {
  path: string;
}

export type KimiCodeOpenWebRequest = {
  sessionId?: string;
}

export type SearchProjectFilesRequest = {
  projectPath: string;
  sessionId?: string;
  query?: string;
  limit?: number;
  additionalWorkDirs?: string[];
}

export type ProjectFileCandidate = {
  path: string;
  name: string;
  rootPath?: string;
  sourceLabel?: string;
}

export type SearchProjectFilesResponse = {
  success: true;
  data: ProjectFileCandidate[];
} | {
  success: false;
  error: string;
};

export type SkillInfo = {
  id: string;
  name: string;
  description: string;
  path: string;
  source: string;
  sourceLabel?: string;
  trustLevel?: "kimi-official" | "curated" | "third-party" | "local";
  enabled: boolean;
};

export type ListSkillsResponse = {
  success: true;
  data: {
    skills: SkillInfo[];
    scanErrors: { path: string; reason: string }[];
    enabledIds: string[];
    enabledDir: string;
  };
} | {
  success: false;
  error: string;
};

export type SaveEnabledSkillsRequest = {
  ids: string[];
};

export type SaveEnabledSkillsResponse = {
  success: true;
  data: {
    enabledIds: string[];
    enabledDir: string;
  };
} | {
  success: false;
  error: string;
};

export type PrepareKimiSkillRequest = {
  name: string;
};

export type PrepareKimiSkillResponse = {
  success: true;
  data: {
    name: string;
    path: string;
    copied: boolean;
  };
} | {
  success: false;
  error: string;
};

export type KimiThemeSourceDeleteRequest = {
  path: string;
}

export type KimiThemeSourceDeleteResponse = {
  success: true;
  data: {
    path: string;
  };
} | {
  success: false;
  error: string;
};

export type SyncKimiAgentSkillsResponse = {
  success: true;
  data: {
    names: string[];
    copiedNames: string[];
    latestModifiedAt: number;
    warnings: string[];
  };
} | {
  success: false;
  error: string;
};

export type ImportSkillArchiveRequest = {
  archivePath?: string;
};

export type ImportSkillArchiveResponse = {
  success: true;
  data: {
    imported: SkillInfo[];
    skills: SkillInfo[];
  };
} | {
  success: false;
  error: string;
};

export type AppInfoResponse = {
  success: true;
  data: {
    name: string;
    version: string;
    author: string;
    repository: string;
  };
} | {
  success: false;
  error: string;
};

export type ReleaseInfo = {
  tagName: string;
  name: string;
  body: string;
  publishedAt: string;
  htmlUrl: string;
  assets: {
    name: string;
    downloadUrl: string;
  }[];
};

export type CheckUpdateResponse = {
  success: true;
  data: {
    currentVersion: string;
    latest: ReleaseInfo | null;
    releases: ReleaseInfo[];
    hasUpdate: boolean;
    message: string;
  };
} | {
  success: false;
  error: string;
};

export type DownloadUpdateResponse = {
  success: true;
  data: {
    filePath: string;
    assetName: string;
    message: string;
  };
} | {
  success: false;
  error: string;
};

export type DownloadUpdateProgress = {
  percent: number;
  receivedBytes: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  scope?: "kimix" | "kimi-code";
  phase?: "script" | "manifest" | "binary" | "install" | "done";
  message?: string;
};

export type CopyImageRequest = {
  dataUrl: string;
}

export type TriggerShortcutRequest = {
  shortcut: string;
}

export type TurnCompleteNotificationRequest = {
  title?: string;
  body?: string;
  fallbackBody?: string;
  sessionId?: string;
  roomAgentId?: string;
  agentTurnId?: string;
  eventId?: string;
  windowFocused?: boolean;
  pageVisible?: boolean;
}

export type NotificationClickPayload = {
  sessionId: string;
  roomAgentId?: string;
  agentTurnId?: string;
  eventId?: string;
}

export type RendererHeartbeatPayload = {
  at: string;
  performanceNow: number;
  visibilityState: string;
  focused: boolean;
  url?: string;
  runningSessionId?: string | null;
  currentProject?: {
    id: string;
    name: string;
    path: string;
  } | null;
  currentSession?: {
    id: string;
    title?: string;
    engine?: string;
    runtimeSessionId?: string;
    officialSessionId?: string;
    projectPath?: string;
    eventCount: number;
    isLoading?: boolean;
    updatedAt?: number;
    lastEventType?: string;
    lastEventTimestamp?: number;
  } | null;
  panels?: {
    workspaceView?: string;
    settingsOpen?: boolean;
    searchOpen?: boolean;
    longTasksOpen?: boolean;
    longTaskInspectorOpen?: boolean;
    diffPanelOpen?: boolean;
  };
  memory?: {
    usedJSHeapSize?: number;
    totalJSHeapSize?: number;
    jsHeapSizeLimit?: number;
  } | null;
}

export type ScheduleShutdownRequest = {
  delaySeconds: number;
  reason?: string;
  taskId?: string;
}

export type ScheduledShutdownState = {
  deadline: number;
  reason: string;
  taskId: string;
};

export type GetScheduledShutdownResponse = {
  success: true;
  data: ScheduledShutdownState | null;
} | {
  success: false;
  error: string;
};

export type LaunchCommandRequest = {
  command?: string;
  cwd?: string;
}

export type VoidResponse = {
  success: true;
  data: void;
} | {
  success: false;
  error: string;
};

export type AppSettings = {
  defaultModel: string;
  defaultThinking: boolean;
  defaultPlanMode: boolean;
  maxTurns: number;
  enableCompaction: boolean;
  defaultPermissionMode: "manual" | "auto" | "yolo";
  theme: "dark" | "light" | "system";
  themePalette: "warm-paper" | "neutral-gray" | "soft-green" | "warm-orange" | "custom" | `kimi:${string}`;
  customThemePalette: {
    primary: string;
    surface: string;
    accent: string;
  };
  kimiThemePalettes: KimiThemePreset[];
  kimiThemePalette?: KimiThemePalette;
  fontSize: number;
  fontSizeBaselineVersion?: number;
  showThinking: boolean;
  detailedContext: boolean;
  statusUpdateDisplay: "each" | "turn_end" | "never";
  sessionRecommendationEnabled: boolean;
  sessionRecommendationTurnLimit: number;
  voiceShortcut: string;
  notificationMode: "never" | "unfocused" | "always";
  notificationShowContent: boolean;
  filePreviewExtensions: string[];
  expandToolCalls: boolean;
  experimentalKimiServer: boolean;
  experimentalKimiServerSessions: boolean;
  experimentalKimiToolSelect: boolean;
  defaultOpenDir?: string;
  selectedExecutablePath?: string;
  selectedLaunchCommand?: string;
  autoReadAgentsMd: boolean;
  autoShowGitStatus: boolean;
  enabledSkillNames: string[];
  enabledSkillsDir?: string;
  additionalWorkDirs?: string[];
  hookRules?: HookRule[];
  hookRunLog?: HookRunLogEntry[];
}

export type HookRule = {
  id: string;
  name: string;
  event: "PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "Notification" | "Stop" | "StopFailure" | "Interrupt" | "UserPromptSubmit" | "SessionStart" | "SessionEnd" | "SubagentStart" | "SubagentStop" | "PreCompact" | "PostCompact";
  matcher: string;
  action: "allow" | "block" | "notify" | "run_command";
  command?: string;
  reason?: string;
  timeout?: number;
  enabled: boolean;
  scope: "global" | "project";
  projectPath?: string;
  createdAt: number;
  updatedAt: number;
}

export type HookRunLogEntry = {
  id: string;
  ruleId: string;
  ruleName: string;
  event: HookRule["event"];
  action: HookRule["action"];
  result: "allow" | "block" | "notify" | "run_command" | "error";
  message: string;
  timestamp: number;
}

export type GenerateHookRuleRequest = {
  description: string;
  projectPath?: string;
}

export type GenerateHookRuleResponse = {
  success: true;
  data: HookRule;
} | {
  success: false;
  error: string;
};

export type SettingsResponse = {
  success: true;
  data: AppSettings;
} | {
  success: false;
  error: string;
};

export type SaveSettingsRequest = Partial<AppSettings>;

export type KimiCodeSetExperimentalFeatureRequest = {
  id: string;
  enabled: boolean;
};

export type KimiCodePermissionMode = "manual" | "auto" | "yolo";

export type KimiCodeEngineStatus =
  | "idle"
  | "unknown"
  | "running"
  | "waiting_approval"
  | "waiting_question"
  | "completed"
  | "interrupted"
  | "error";

export type KimiCodePromptPart =
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: { url: string; id?: string } };

export type KimiCodeSessionInfo = {
  sessionId: string;
  workDir: string;
  status: KimiCodeEngineStatus;
  model?: string | null;
  additionalDirs?: readonly string[];
};

export type KimiCodeSessionStatus = {
  engineStatus?: KimiCodeEngineStatus;
  model?: string;
  thinkingLevel?: string;
  permission?: KimiCodePermissionMode;
  planMode?: boolean;
  swarmMode?: boolean;
  contextTokens?: number;
  maxContextTokens?: number;
  contextUsage?: number;
  usage?: unknown;
};

export type KimiCodeMcpServerInfo = {
  id?: string;
  name: string;
  transport: "stdio" | "http" | "sse";
  status: "pending" | "connected" | "failed" | "disabled" | "needs-auth";
  toolCount: number;
  error?: string;
};

export type KimiCodeMcpStartupMetrics = {
  durationMs: number;
};

export type KimiCodeServerToolInfo = {
  name: string;
  description: string;
  source: "builtin" | "skill" | "mcp";
  mcpServerId?: string;
  inputSchema: unknown;
};

export type KimiCodeServerConnectionInfo = {
  id: string;
  connectedAt: string;
  remoteAddress: string | null;
  userAgent: string | null;
  hasClientHello: boolean;
  subscriptions: string[];
  subscribedToCurrentSession: boolean;
};

export type KimiCodeServerRuntimeDiagnostics = {
  session: KimiCodeSessionStatus;
  tools: KimiCodeServerToolInfo[];
  mcpServers: KimiCodeMcpServerInfo[];
  connections: KimiCodeServerConnectionInfo[];
  messages: {
    sampled: number;
    hasMore: boolean;
    roles: Record<string, number>;
    latestCreatedAt: string | null;
  };
  prompts: {
    activeId: string | null;
    activeStatus: string | null;
    queuedCount: number;
  };
};

export type KimiCodeServerModelCatalog = {
  auth: {
    ready: boolean;
    providerCount: number;
    defaultModel: string | null;
    managedProvider: { name: string; status: string } | null;
  };
  config: Record<string, unknown>;
  models: Array<{
    provider: string;
    model: string;
    displayName?: string;
    maxContextSize: number;
    capabilities: string[];
    supportEfforts: string[];
    defaultEffort?: string;
  }>;
  providers: Array<{
    id: string;
    type: string;
    baseUrl?: string;
    defaultModel?: string;
    hasApiKey: boolean;
    status: "connected" | "error" | "unconfigured";
    models: string[];
  }>;
};

export type KimiCodeArchivedSessionSummary = {
  id: string;
  title: string;
  projectPath: string;
  archivedAt: string;
  updatedAt: string;
  createdAt: string;
};

export type KimiCodeBackgroundTaskInfo = {
  taskId: string;
  command: string;
  description: string;
  status: string;
  pid: number;
  exitCode: number | null;
  startedAt: number;
  endedAt: number | null;
  approvalReason?: string;
  timedOut?: boolean;
  stopReason?: string;
  timeoutMs?: number;
  agentId?: string;
  subagentType?: string;
  failureReason?: string;
  outputBytes?: number;
  outputPreview?: string;
  transport?: "server" | "sdk";
};

export type KimiCodeServerTerminalInfo = {
  id: string;
  sessionId: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  status: "running" | "exited";
  createdAt: string;
  exitedAt?: string;
  exitCode?: number | null;
};

export type KimiCodePluginSummary = {
  id: string;
  displayName: string;
  version?: string;
  enabled: boolean;
  state: "ok" | "error";
  skillCount: number;
  mcpServerCount: number;
  enabledMcpServerCount: number;
  hasErrors: boolean;
  source: "local-path" | "zip-url" | "github";
  originalSource?: string;
  github?: unknown;
};

export type KimiCodePluginCommandSummary = {
  pluginId: string;
  name: string;
  description: string;
  path: string;
};

export type KimiCodeSkillSummary = {
  name: string;
  description: string;
  path: string;
  source: string;
  type?: string;
  disableModelInvocation?: boolean;
  isSubSkill?: boolean;
};

export type KimiCodeConfigDiagnostics = {
  warnings?: string[];
};

export type KimiCodeSessionSummary = {
  id: string;
  title?: string;
  lastPrompt?: string;
  brief?: string;
  isCustomTitle?: boolean;
  workDir: string;
  sessionDir: string;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
  source?: "server" | "sdk";
  metadata?: Record<string, unknown>;
};

export type KimiCodeCreateSessionRequest = {
  workDir: string;
  id?: string;
  model?: string;
  thinking?: string;
  permission?: KimiCodePermissionMode;
  planMode?: boolean;
  additionalDirs?: string[];
  additionalWorkDirs?: string[];
  roomMetadata?: KimiCodeRoomMetadataRequest;
};

export type KimiCodeRoomMetadataRequest = RoomSessionMetadataInput;

export type KimiCodeResumeSessionRequest = {
  sessionId: string;
  additionalDirs?: string[];
  additionalWorkDirs?: string[];
};

export type KimiCodeForkSessionRequest = {
  sessionId: string;
  forkId?: string;
  title?: string;
};

export type KimiCodeRenameSessionRequest = {
  sessionId: string;
  title: string;
};

export type KimiCodePromptRequest = {
  sessionId: string;
  content: string;
  images?: { name: string; dataUrl: string }[];
  /** Renderer-selected session model; immutable for this prompt dispatch. */
  model?: string;
};

export type KimiCodeBtwRequest = {
  sessionId: string;
  content: string;
  timeoutMs?: number;
};

export type KimiCodeSwarmRequest = {
  sessionId: string;
  content?: string;
  enabled?: boolean;
  trigger?: "manual" | "task";
};

export type KimiCodeBtwResponse = {
  success: true;
  data: {
    agentId: string;
    content: string;
    thinking: string;
    reason?: string;
  };
} | {
  success: false;
  error: string;
};

export type KimiCodeGoalStatus = "active" | "paused" | "blocked" | "complete" | string;

export type KimiCodeGoalBudget = {
  turnBudget?: number | null;
  tokenBudget?: number | null;
  wallClockBudgetMs?: number | null;
  remainingTurns?: number | null;
  remainingTokens?: number | null;
  remainingWallClockMs?: number | null;
};

export type KimiCodeGoalSnapshot = {
  goalId?: string;
  objective: string;
  completionCriterion?: string;
  status: KimiCodeGoalStatus;
  turnsUsed?: number;
  tokensUsed?: number;
  wallClockMs?: number;
  createdAt?: string;
  updatedAt?: string;
  terminalReason?: string;
  budget?: KimiCodeGoalBudget;
  [key: string]: unknown;
};

export type KimiCodeGoalState = {
  goal: KimiCodeGoalSnapshot | null;
  cancelledGoal?: KimiCodeGoalSnapshot;
};

export type KimiCodeCreateGoalRequest = {
  sessionId: string;
  objective: string;
  completionCriterion?: string;
  replace?: boolean;
};

export type KimiCodeGoalActionRequest = {
  sessionId: string;
  reason?: string;
};

export type KimiCodeGoalResponse = {
  success: true;
  data: KimiCodeGoalState;
} | {
  success: false;
  error: string;
};

export type KimiCodeSetPlanModeRequest = {
  sessionId: string;
  enabled: boolean;
};

export type KimiCodeSetModelRequest = {
  sessionId: string;
  model: string;
};

export type KimiCodeSetPermissionRequest = {
  sessionId: string;
  mode: KimiCodePermissionMode;
};

export type KimiCodeApprovalResponseRequest = {
  sessionId: string;
  requestId: string;
  approved: boolean;
  scope?: "once" | "session";
  selectedLabel?: string;
  feedback?: string;
};

export type RendererStartupMark = {
  label: string;
  elapsedMs: number;
};

export type KimiCodeQuestionResponseRequest = {
  sessionId: string;
  requestId: string;
  answers: Record<string, string | true>;
  skipped?: boolean;
};

export type KimiCodePluginSessionRequest = {
  sessionId: string;
};

export type KimiCodeManagedUsageRequest = {
  providerName?: string;
};

export type KimiCodeMcpServerRequest = {
  sessionId: string;
  name: string;
};

export type KimiCodeListBackgroundTasksRequest = {
  sessionId: string;
  activeOnly?: boolean;
  limit?: number;
};

export type KimiCodeBackgroundTaskRequest = {
  sessionId: string;
  taskId: string;
  tail?: number;
  reason?: string;
};

export type KimiCodeChildSessionRequest = {
  sessionId: string;
  title?: string;
};

export type KimiCodeServerTerminalRequest = {
  sessionId: string;
  terminalId?: string;
  cwd?: string;
  shell?: string;
  cols?: number;
  rows?: number;
  sinceSeq?: number;
  data?: string;
};

export type KimiCodeInstallPluginRequest = {
  sessionId?: string;
  source: string;
};

export type KimiCodeSetPluginEnabledRequest = {
  sessionId?: string;
  id: string;
  enabled: boolean;
};

export type KimiCodeSetPluginMcpServerEnabledRequest = {
  sessionId?: string;
  id: string;
  server: string;
  enabled: boolean;
};

export type KimiCodeSessionRequest = {
  sessionId: string;
  instruction?: string;
};

export type KimiCodeActivatePluginCommandRequest = {
  sessionId: string;
  pluginId: string;
  commandName: string;
  args?: string;
};

export type KimiCodeUndoHistoryRequest = {
  sessionId: string;
  count?: number;
};

export type KimiCodeMarketplacePlugin = {
  id: string;
  tier: string;
  displayName: string;
  version: string;
  description: string;
  homepage?: string;
  source: string;
};

export type KimiCodeListMarketplaceResponse = {
  success: true;
  data: KimiCodeMarketplacePlugin[];
} | {
  success: false;
  error: string;
};

export type KimiCodeListSessionsRequest = {
  workDir?: string;
};

export type KimiCodeLoadSessionRequest = {
  workDir: string;
  sessionId: string;
};

export type KimiCodeLoadSessionResponse = {
  success: true;
  data: {
    sessionId: string;
    events: Array<{ type: string; payload: unknown; time?: unknown }>;
    source?: "server" | "local";
  };
} | {
  success: false;
  error: string;
};

export type KimiCodeSessionResponse = {
  success: true;
  data: KimiCodeSessionInfo;
} | {
  success: false;
  error: string;
};

export type KimiCodePromptResponse = {
  success: true;
  data: {
    route: "server" | "sdk" | "sdk-fallback";
    fallbackReason?: string;
  };
} | {
  success: false;
  error: string;
};

export type KimiCodeVoidResponse = {
  success: true;
  data: void;
} | {
  success: false;
  error: string;
};

export type KimiCodeStatusResponse = {
  success: true;
  data: KimiCodeSessionStatus;
} | {
  success: false;
  error: string;
};

export type KimiCodeUsageResponse = {
  success: true;
  data: Record<string, unknown>;
} | {
  success: false;
  error: string;
};

export type KimiCodeConfigDiagnosticsResponse = {
  success: true;
  data: KimiCodeConfigDiagnostics;
} | {
  success: false;
  error: string;
};

export type KimiCodeManagedUsageResponse = {
  success: true;
  data: unknown;
} | {
  success: false;
  error: string;
};

export type KimiCodeListMcpServersResponse = {
  success: true;
  data: KimiCodeMcpServerInfo[];
} | {
  success: false;
  error: string;
};

export type KimiCodeMcpStartupMetricsResponse = {
  success: true;
  data: KimiCodeMcpStartupMetrics;
} | {
  success: false;
  error: string;
};

export type KimiCodeListBackgroundTasksResponse = {
  success: true;
  data: KimiCodeBackgroundTaskInfo[];
} | {
  success: false;
  error: string;
};

export type KimiCodeBackgroundTaskOutputResponse = {
  success: true;
  data: string;
} | {
  success: false;
  error: string;
};

export type KimiCodeBackgroundTaskOutputPathResponse = {
  success: true;
  data?: string;
} | {
  success: false;
  error: string;
};

export type KimiCodeBackgroundTaskResponse = {
  success: true;
  data?: KimiCodeBackgroundTaskInfo;
} | {
  success: false;
  error: string;
};

export type KimiCodeServerRuntimeDiagnosticsResponse = {
  success: true;
  data: KimiCodeServerRuntimeDiagnostics;
} | {
  success: false;
  error: string;
};

export type KimiCodePromptQueueResponse = {
  success: true;
  data: {
    supported: boolean;
    activeId: string | null;
    activeStatus: string | null;
    queuedIds: string[];
  };
} | {
  success: false;
  error: string;
};

export type KimiCodeServerModelCatalogResponse = {
  success: true;
  data: KimiCodeServerModelCatalog;
} | {
  success: false;
  error: string;
};

export type KimiCodeArchivedSessionsResponse = {
  success: true;
  data: KimiCodeArchivedSessionSummary[];
} | {
  success: false;
  error: string;
};

export type KimiCodeArchivedSessionResponse = {
  success: true;
  data: KimiCodeArchivedSessionSummary;
} | {
  success: false;
  error: string;
};

export type KimiCodeSetExperimentalFeatureResponse = {
  success: true;
  data: void;
} | {
  success: false;
  error: string;
};

export type KimiCodeServerTerminalResponse = {
  success: true;
  data: KimiCodeServerTerminalInfo;
} | {
  success: false;
  error: string;
};

export type KimiCodeListServerTerminalsResponse = {
  success: true;
  data: KimiCodeServerTerminalInfo[];
} | {
  success: false;
  error: string;
};

export type KimiCodeListSessionsResponse = {
  success: true;
  data: KimiCodeSessionSummary[];
  source?: "server" | "sdk";
} | {
  success: false;
  error: string;
};

export type KimiCodeListPluginsResponse = {
  success: true;
  data: KimiCodePluginSummary[];
} | {
  success: false;
  error: string;
};

export type KimiCodeListSkillsResponse = {
  success: true;
  data: KimiCodeSkillSummary[];
} | {
  success: false;
  error: string;
};

export type KimiCodePluginResponse = {
  success: true;
  data: KimiCodePluginSummary;
} | {
  success: false;
  error: string;
};

export type KimiCodeEventPayload = {
  sessionId: string;
  event: unknown;
};

export type KimiCodeStatusPayload = {
  sessionId: string;
  status: KimiCodeEngineStatus;
  /** 当 Server 会话被迁移到 SDK 会话时，提供新的 runtime session id。 */
  migratedTo?: string;
};

export type LoggerWriteRequest = {
  level?: "debug" | "info" | "warn" | "error";
  message: string;
  data?: unknown;
};

export type LoggerWriteResponse = {
  success: true;
} | {
  success: false;
  error: string;
};

export type WindowControlResponse = {
  success: true;
} | {
  success: false;
  error: string;
}

export type DefaultWorkDirResponse = {
  success: true;
  data: string;
} | {
  success: false;
  error: string;
}
