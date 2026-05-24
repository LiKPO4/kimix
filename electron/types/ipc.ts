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
  afkMode?: boolean;
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
  patch: Partial<Pick<LongTaskSummary, "stage" | "activeAgent" | "currentStep" | "targetStep" | "reviewedReviewItems" | "executorSessionId" | "reviewerSessionId">>;
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
  planMode?: boolean;
  afkMode?: boolean;
  skillsDir?: string;
  agentFile?: string;
  additionalWorkDirs?: string[];
}

export type StartSessionResponse = {
  success: true;
  data: {
    sessionId: string;
    workDir: string;
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
    message: string;
  };
} | {
  success: false;
  error: string;
};

export type CheckKimiCliRequest = {
  verify?: boolean;
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
  planMode?: boolean;
  afkMode?: boolean;
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
  defaultAfkMode: boolean;
  maxTurns: number;
  enableCompaction: boolean;
  defaultPermissionMode: "manual" | "approve_for_session" | "yolo";
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

