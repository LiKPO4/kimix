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

export type TuiSessionStatus = "starting" | "running" | "stopping" | "exited" | "error";

export type TuiToolCallSnapshot = {
  toolCallId: string;
  toolName: string;
  command: string;
  status: "running" | "success" | "error";
  output: string;
};

export type TuiApprovalPreviewSnapshot = {
  kind: "write" | "edit";
  toolName: string;
  filePath: string;
  oldText: string;
  newText: string;
};

export type TuiChangeSummarySnapshot = {
  kind: "write" | "edit";
  filePath: string;
  additions: number;
  deletions: number;
};

export type TuiQuestionSnapshot = {
  questionId: string;
  questionText: string;
};

export type TuiPluginSnapshot = {
  id: string;
  name: string;
  status: "enabled" | "installed" | "disabled" | "available" | "unknown";
  trustLevel: "official" | "curated" | "third-party" | "unknown";
  skillsCount: number | null;
  mcpSummary: string | null;
  version: string | null;
  source: "installed" | "marketplace";
  selected: boolean;
};

export type TuiModelOptionSnapshot = {
  id: string;
  name: string;
  provider: string | null;
  selected: boolean;
  current: boolean;
};

export type TuiScreenSnapshot = {
  cols: number;
  rows: number;
  cursorX: number;
  cursorY: number;
  viewportY: number;
  baseY: number;
  lines: string[];
  assistantText: string;
  answerText: string;
  thinkingText: string;
  approvalText: string;
  approvalPreview: TuiApprovalPreviewSnapshot | null;
  changeSummary: TuiChangeSummarySnapshot | null;
  changeSummaries: TuiChangeSummarySnapshot[];
  toolCalls: TuiToolCallSnapshot[];
  questionRequest: TuiQuestionSnapshot | null;
  permissionMode: "manual" | "auto" | null;
  modelName: string | null;
  models: TuiModelOptionSnapshot[];
  plugins: TuiPluginSnapshot[];
  isBusy: boolean;
  isAwaitingApproval: boolean;
  isInputIdle: boolean;
  updatedAt: number;
};

export type TuiSessionSummary = {
  sessionId: string;
  workDir: string;
  command: string;
  args: string[];
  backend: "pty" | "pipe";
  status: TuiSessionStatus;
  pid: number | null;
  startedAt: number;
  updatedAt: number;
  exitCode: number | null;
  signal: string | number | null;
  interrupted: boolean;
  error: string | null;
  rawOutput: string;
  output: string;
  screen: TuiScreenSnapshot | null;
  officialSessionId?: string | null;
  sessionDir?: string | null;
  wireFile?: string | null;
  rawWireTail?: string;
  semanticEventsTail?: TuiSemanticEvent[];
};

export type StartTuiSessionRequest = {
  workDir?: string;
  command?: string;
  args?: string[];
};

/**
 * TUI 引擎发送前应用 Kimix 自有 UserPromptSubmit hooks（复用 SDK/prompt-mode 同一逻辑）。
 * 返回经 hook 改写后的文本；无匹配 hook 时原样返回。hook 阻断时整体失败。
 */
export type ApplyPromptSubmitHooksRequest = {
  sessionId: string;
  text: string;
  workDir: string;
};

export type ApplyPromptSubmitHooksResponse = {
  success: true;
  data: { text: string };
} | {
  success: false;
  error: string;
};

export type StartTuiSessionResponse = {
  success: true;
  data: TuiSessionSummary;
} | {
  success: false;
  error: string;
};

export type SendTuiInputRequest = {
  sessionId: string;
  text: string;
  images?: { name: string; dataUrl: string }[];
  /**
   * 提交方式。
   * - "enter"（默认）：写入文本后发 Enter，运行中由官方 TUI 排队。
   * - "steer"：写入文本后发 Ctrl+S，立即注入当前运行中的 turn（官方 steer 行为）。
   */
  submit?: "enter" | "steer";
};

export type TuiKeyName = "escape" | "enter" | "space" | "tab" | "arrowUp" | "arrowDown" | "arrowLeft" | "arrowRight" | "ctrlO" | "ctrlS" | "ctrlV";

export type SendTuiKeyRequest = {
  sessionId: string;
  key: TuiKeyName;
};

/**
 * 探针：把一张图片写入系统剪贴板后，向隐藏 TUI 发送 Ctrl+V，
 * 验证官方是否走原生剪贴板粘贴路径（出现 [image:…] 占位 / wire ReadMediaFile）。
 * 仅用于调试页验证，不改动正式发送链路。
 */
export type ProbeTuiClipboardImageRequest = {
  sessionId: string;
  dataUrl: string;
};

export type StopTuiSessionRequest = {
  sessionId: string;
};

export type ResizeTuiSessionRequest = {
  sessionId: string;
  cols: number;
  rows: number;
};

export type ListTuiSessionsResponse = {
  success: true;
  data: TuiSessionSummary[];
} | {
  success: false;
  error: string;
};

export type TuiEventPayload = {
  sessionId: string;
  kind: "started" | "output" | "screen" | "semantic" | "status" | "exit" | "error";
  session: TuiSessionSummary;
  chunk?: string;
  message?: string;
  semanticEvents?: TuiSemanticEvent[];
};

export type TuiSemanticEvent = {
  type: string;
  payload?: Record<string, unknown>;
  time?: number;
  turnId?: string;
  toolCallId?: string;
};

export type SlashCommandInfo = {
  name: string;
  description: string;
  aliases: string[];
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
  hasOauth: boolean;
};

export type KimiModelAliasSummary = {
  alias: string;
  provider: string | null;
  model: string | null;
  displayName: string | null;
  maxContextSize: number | null;
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

export type SetKimiDefaultModelRequest = {
  modelAlias: string;
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
  transport: "http" | "stdio";
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
  transport: "http" | "stdio";
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
  message?: string;
};

export type KimiUsageResponse = {
  success: true;
  data: {
    available: boolean;
    updatedAt: number;
    source: string;
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

export type OpenFileRequest = {
  projectPath: string;
  filePath: string;
}

export type RevertFilesRequest = {
  projectPath: string;
  files: Array<string | {
    path: string;
    additions?: number;
    deletions?: number;
  }>;
}

export type OpenEditorRequest = {
  path: string;
  editor: "vscode" | "trae" | "coder";
}

export type OpenTerminalRequest = {
  path: string;
}

export type SearchProjectFilesRequest = {
  projectPath: string;
  query?: string;
  limit?: number;
}

export type ProjectFileCandidate = {
  path: string;
  name: string;
}

export type SearchProjectFilesResponse = {
  success: true;
  data: ProjectFileCandidate[];
} | {
  success: false;
  error: string;
};

export type SkillInfo = {
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
    enabledNames: string[];
    enabledDir: string;
  };
} | {
  success: false;
  error: string;
};

export type SaveEnabledSkillsRequest = {
  names: string[];
};

export type SaveEnabledSkillsResponse = {
  success: true;
  data: {
    enabledNames: string[];
    enabledDir: string;
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

export type InstallKimiPluginRequest = {
  url: string;
};

export type InstallKimiPluginResponse = {
  success: true;
  data: {
    message: string;
    output: string;
    skills: SkillInfo[];
    enabledNames: string[];
    enabledDir: string;
  };
} | {
  success: false;
  error: string;
};

export type InstallSuperpowersResponse = {
  success: true;
  data: {
    installed: SkillInfo[];
    skills: SkillInfo[];
    enabledNames: string[];
    enabledDir: string;
  };
} | {
  success: false;
  error: string;
};

export type SuperpowersBootstrapResponse = {
  success: true;
  data: {
    enabled: boolean;
    content: string;
    agentFile?: string;
    skillsDir?: string;
    enabledNames?: string[];
    superpowerSkills?: string[];
    agentFileExists?: boolean;
    skillsDirExists?: boolean;
    legacyAgentFileExists?: boolean;
    usingSkillPath?: string;
    diagnostics?: string[];
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
  windowFocused?: boolean;
  pageVisible?: boolean;
}

export type ScheduleShutdownRequest = {
  delaySeconds: number;
  reason?: string;
}

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
  fontSize: number;
  showThinking: boolean;
  detailedContext: boolean;
  statusUpdateDisplay: "each" | "turn_end";
  sessionRecommendationEnabled: boolean;
  sessionRecommendationTurnLimit: number;
  voiceShortcut: string;
  notificationMode: "never" | "unfocused" | "always";
  clarificationToolMode: "off" | "on" | "auto";
  experimentalTuiEngineEnabled: boolean;
  expandToolCalls: boolean;
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
  event: "PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "Notification" | "Stop" | "StopFailure" | "UserPromptSubmit" | "SessionStart" | "SessionEnd" | "SubagentStart" | "SubagentStop" | "PreCompact" | "PostCompact";
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

export type KimiEventPayload = {
  sessionId: string;
  event: unknown;
}

export type KimiStatusPayload = {
  sessionId: string;
  status: "idle" | "running" | "error" | "interrupted" | "completed";
}

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
