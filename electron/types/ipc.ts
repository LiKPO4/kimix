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

export type Project = {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number;
  gitBranch?: string;
}

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

export type SendPromptRequest = {
  sessionId: string;
  content: string;
  images?: {
    name: string;
    dataUrl: string;
  }[];
  thinking?: boolean;
  yoloMode?: boolean;
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
    branch: string;
    status: string;
  };
} | {
  success: false;
  error: string;
};

export type OpenPathRequest = {
  path: string;
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
  maxTurns: number;
  enableCompaction: boolean;
  defaultPermissionMode: "manual" | "approve_for_session" | "yolo";
  theme: "dark" | "light" | "system";
  fontSize: number;
  showThinking: boolean;
  detailedContext: boolean;
  expandToolCalls: boolean;
  defaultOpenDir?: string;
  autoReadAgentsMd: boolean;
  autoShowGitStatus: boolean;
}

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

