export type OpenProjectRequest = {
  defaultPath?: string;
}

export type OpenProjectResponse = {
  success: true;
  data: {
    path: string;
    name: string;
  } | null;
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
}

export type StartSessionResponse = {
  success: true;
  data: {
    sessionId: string;
    workDir: string;
  };
} | {
  success: false;
  error: string;
};

export type SendPromptRequest = {
  sessionId: string;
  content: string;
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

export type AppSettings = {
  defaultModel: string;
  defaultThinking: boolean;
  maxTurns: number;
  enableCompaction: boolean;
  defaultPermissionMode: "manual" | "approve_for_session" | "yolo";
  theme: "dark" | "light" | "system";
  fontSize: number;
  showThinking: boolean;
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

export type KimiEventPayload = {
  sessionId: string;
  event: unknown;
}

export type KimiStatusPayload = {
  sessionId: string;
  status: "idle" | "running" | "error" | "interrupted" | "completed";
}

