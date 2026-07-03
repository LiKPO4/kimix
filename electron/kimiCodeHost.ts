import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app } from "electron";
import { candidateKimiShareDirs, findKimiCodeSessionDir, getFirstUserMessage, readKimiCodeSessionMetadata } from "./sessionHistory";
import { installNonVisionFetchInterceptor } from "./nonVisionFetchInterceptor";
import { kimiCodeServerHost } from "./kimiCodeServerHost";
import * as settingsService from "./settingsService";
import {
  flattenServerEvent,
  getKimiCodeSessionAlreadyExistsId,
  isKimiCodeSessionAlreadyExistsError,
  isKimiCodeSessionMissingError,
  isKimiCodeServerSessionRoutingEnabled,
  KimiCodeServerClient,
  mergeServerRelatedSessions,
  normalizeServerTerminalCreateError,
  snapshotMessagesToServerFrames,
  snapshotToHistoryFrames,
  toServerConfigPatch,
  type ServerFrame,
  type ServerAuthSummary,
  type ServerMcpServer,
  type ServerOAuthFlow,
  type ServerSession,
  type ServerSkill,
  type ServerSessionStatus,
  type ServerSnapshot,
  type ServerTerminal,
} from "./kimiCodeServerClient";

type JsonObject = Record<string, unknown>;

type KimiCodeSdkModule = {
  KimiHarness?: new (options: {
    homeDir?: string;
    identity?: { userAgentProduct: string; version: string };
    uiMode?: string;
    skillDirs?: readonly string[];
  }) => KimiHarnessLike;
  createKimiHarness?: (options: {
    homeDir?: string;
    identity?: { userAgentProduct: string; version: string };
    uiMode?: string;
    skillDirs?: readonly string[];
  }) => KimiHarnessLike;
  DEFAULT_CATALOG_URL?: string;
  fetchCatalog?: (url: string, signal?: AbortSignal) => Promise<Record<string, unknown>>;
  inferWireType?: (entry: unknown) => string | undefined;
  catalogBaseUrl?: (entry: unknown, wire: string) => string | undefined;
  catalogProviderModels?: (entry: unknown) => KimiCodeCatalogModel[];
};

type KimiHarnessLike = {
  interactiveAgentId?: string;
  withInteractiveAgent?<T>(agentId: string, fn: () => T): T;
  auth?: {
    login(providerName?: string, options?: {
      signal?: AbortSignal;
      onDeviceCode?: (data: KimiCodeDeviceAuthorization) => void;
    }): Promise<KimiCodeAuthLoginResult>;
    status?(providerName?: string): Promise<unknown>;
    getManagedUsage(providerName?: string): Promise<unknown>;
  };
  createSession(options: CreateKimiCodeSessionOptions): Promise<KimiCodeSessionLike>;
  resumeSession(input: { id: string; additionalDirs?: readonly string[] }): Promise<KimiCodeSessionLike>;
  forkSession?(input: { id: string; forkId?: string; title?: string; metadata?: JsonObject }): Promise<KimiCodeSessionLike>;
  renameSession?(input: { id: string; title: string }): Promise<void>;
  listSessions(options?: { workDir?: string; sessionId?: string; includeArchive?: boolean }): Promise<KimiCodeSessionSummary[]>;
  exportSession(input: KimiCodeExportSessionInput): Promise<KimiCodeExportSessionResult>;
  getConfig(options?: { reload?: boolean }): Promise<KimiCodeConfig>;
  getConfigDiagnostics?(): Promise<KimiCodeConfigDiagnostics>;
  setConfig(patch: KimiCodeConfigPatch): Promise<KimiCodeConfig>;
  listPlugins?(): Promise<readonly KimiCodePluginSummary[]>;
  installPlugin?(source: string): Promise<KimiCodePluginSummary>;
  setPluginEnabled?(id: string, enabled: boolean): Promise<void>;
  setPluginMcpServerEnabled?(id: string, server: string, enabled: boolean): Promise<void>;
  close(): Promise<void>;
};

type KimiCodeConfigDiagnostics = {
  warnings?: string[];
};

type KimiCodeSessionLike = {
  id: string;
  workDir: string;
  summary?: KimiCodeSessionSummary;
  prompt(input: string | KimiCodePromptPart[]): Promise<void>;
  steer(input: string | KimiCodePromptPart[]): Promise<void>;
  swarm?(input: string | KimiCodePromptPart[]): Promise<void>;
  setSwarmMode?(enabled: boolean, trigger?: "manual" | "task"): Promise<void>;
  reloadSession?(options?: { forcePluginSessionStartReminder?: boolean }): Promise<unknown>;
  undoHistory?(count: number): Promise<void>;
  cancel(): Promise<void>;
  setModel?(model: string): Promise<void>;
  setThinking?(level: string): Promise<void>;
  setPlanMode(enabled: boolean): Promise<void>;
  setPermission(mode: KimiCodePermissionMode): Promise<void>;
  compact?(options?: { instruction?: string }): Promise<void>;
  startBtw?(): Promise<string>;
  getStatus(): Promise<KimiCodeSessionStatus>;
  getUsage?(): Promise<KimiCodeSessionUsage>;
  listMcpServers?(): Promise<readonly KimiCodeMcpServerInfo[]>;
  getMcpStartupMetrics?(): Promise<KimiCodeMcpStartupMetrics>;
  reconnectMcpServer?(name: string): Promise<void>;
  listBackgroundTasks?(options?: { activeOnly?: boolean; limit?: number }): Promise<readonly KimiCodeBackgroundTaskInfo[]>;
  getBackgroundTaskOutput?(taskId: string, options?: { tail?: number }): Promise<string>;
  getBackgroundTaskOutputPath?(taskId: string): Promise<string | undefined>;
  stopBackgroundTask?(taskId: string, options?: { reason?: string }): Promise<void>;
  detachBackgroundTask?(taskId: string): Promise<KimiCodeBackgroundTaskInfo | undefined>;
  createGoal?(input: KimiCodeCreateGoalInput): Promise<KimiCodeGoalSnapshot>;
  getGoal?(): Promise<KimiCodeGoalState>;
  pauseGoal?(input?: { reason?: string }): Promise<KimiCodeGoalSnapshot>;
  resumeGoal?(input?: { reason?: string }): Promise<KimiCodeGoalSnapshot>;
  cancelGoal?(input?: { reason?: string }): Promise<KimiCodeGoalSnapshot>;
  listSkills?(): Promise<readonly KimiCodeSkillSummary[]>;
  activateSkill?(name: string, args?: string): Promise<void>;
  listPlugins?(): Promise<readonly KimiCodePluginSummary[]>;
  installPlugin?(source: string): Promise<KimiCodePluginSummary>;
  setPluginEnabled?(id: string, enabled: boolean): Promise<void>;
  setPluginMcpServerEnabled?(id: string, server: string, enabled: boolean): Promise<void>;
  onEvent(listener: (event: unknown) => void): () => void;
  setApprovalHandler?(handler: ((request: unknown) => Promise<KimiCodeApprovalResult>) | undefined): void;
  setQuestionHandler?(handler: ((request: unknown) => Promise<KimiCodeQuestionResult>) | undefined): void;
  close(): Promise<void>;
};

export type KimiCodePermissionMode = "manual" | "auto" | "yolo";

export type KimiCodePromptPart =
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: { url: string; id?: string } };

export type KimiCodeEngineStatus =
  | "idle"
  | "running"
  | "waiting_approval"
  | "waiting_question"
  | "completed"
  | "interrupted"
  | "error";

export type CreateKimiCodeSessionOptions = {
  workDir: string;
  id?: string;
  model?: string;
  thinking?: string;
  permission?: KimiCodePermissionMode;
  planMode?: boolean;
  metadata?: JsonObject;
  additionalDirs?: readonly string[];
};

export type KimiCodeEngineSession = {
  sessionId: string;
  workDir: string;
  status: KimiCodeEngineStatus;
  additionalDirs?: readonly string[];
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
  metadata?: JsonObject;
  additionalDirs?: readonly string[];
};

export type KimiCodeSessionStatus = {
  engineStatus?: KimiCodeEngineStatus;
  model?: string;
  thinkingLevel?: string;
  thinkingEffort?: string;
  permission?: KimiCodePermissionMode;
  planMode?: boolean;
  contextTokens?: number;
  maxContextTokens?: number;
  contextUsage?: number;
  usage?: unknown;
};

export type KimiCodeSessionUsage = Record<string, unknown>;

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

export type KimiCodeServerRuntimeDiagnostics = {
  session: KimiCodeSessionStatus;
  tools: Array<{
    name: string;
    description: string;
    source: "builtin" | "skill" | "mcp";
    mcpServerId?: string;
    inputSchema: unknown;
  }>;
  mcpServers: KimiCodeMcpServerInfo[];
  connections: Array<{
    id: string;
    connectedAt: string;
    remoteAddress: string | null;
    userAgent: string | null;
    hasClientHello: boolean;
    subscriptions: string[];
    subscribedToCurrentSession: boolean;
  }>;
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

export type KimiCodeBackgroundTaskStatus =
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "killed"
  | "lost";

export type KimiCodeBackgroundTaskInfo = {
  taskId: string;
  command: string;
  description: string;
  status: KimiCodeBackgroundTaskStatus;
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

export type KimiCodeExportSessionInput = {
  id: string;
  outputPath?: string;
  includeGlobalLog?: boolean;
  version?: string;
  installSource?: string;
  shellEnv?: unknown;
};

export type KimiCodeExportSessionResult = {
  zipPath: string;
  entries: readonly string[];
  sessionDir: string;
  manifest: unknown;
};

export type KimiCodePluginSource = "local-path" | "zip-url" | "github";
export type KimiCodePluginState = "ok" | "error";

export type KimiCodePluginSummary = {
  id: string;
  displayName: string;
  version?: string;
  enabled: boolean;
  state: KimiCodePluginState;
  skillCount: number;
  mcpServerCount: number;
  enabledMcpServerCount: number;
  hasErrors: boolean;
  source: KimiCodePluginSource;
  originalSource?: string;
  github?: unknown;
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

export type KimiCodeConfig = {
  providers?: Record<string, KimiCodeProviderConfig>;
  defaultProvider?: string;
  defaultModel?: string;
  models?: Record<string, KimiCodeModelAlias>;
  thinking?: {
    mode?: "auto" | "on" | "off";
    enabled?: boolean;
    effort?: string;
  };
  defaultThinking?: boolean;
  raw?: unknown;
};

export type KimiCodeProviderConfig = {
  type?: string;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  oauth?: unknown;
  env?: Record<string, string>;
  customHeaders?: Record<string, string>;
  source?: unknown;
};

export type KimiCodeModelAlias = {
  provider?: string;
  model?: string;
  maxContextSize?: number;
  maxOutputSize?: number;
  capabilities?: string[];
  displayName?: string;
  reasoningKey?: string;
  adaptiveThinking?: boolean;
  supportEfforts?: string[];
  defaultEffort?: string;
  overrides?: Partial<Omit<KimiCodeModelAlias, "overrides">>;
};

export type KimiCodeConfigPatch = Partial<KimiCodeConfig>;

export type KimiCodeCatalogModel = {
  id: string;
  name?: string;
  maxOutputSize?: number;
  reasoningKey?: string;
  capability?: {
    image_in?: boolean;
    video_in?: boolean;
    audio_in?: boolean;
    thinking?: boolean;
    tool_use?: boolean;
    max_context_tokens?: number;
  };
};

export type KimiCodeProviderCatalogEntry = {
  providerId: string;
  type: string;
  baseUrl: string | null;
  modelCount: number;
  models: {
    id: string;
    name: string | null;
    maxContextSize: number | null;
    thinking: boolean;
    toolUse: boolean;
  }[];
};

export type KimiCodeDeviceAuthorization = {
  userCode: string;
  deviceCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number | null;
  interval: number;
};

export type KimiCodeAuthLoginResult = {
  providerName: string;
  ok: true;
  defaultModel?: string;
  defaultThinking?: boolean;
  configPath?: string;
};

export type KimiCodeLoginResult = {
  providerName: string;
  verificationUrl?: string;
  userCode?: string;
  defaultModel?: string;
  defaultThinking?: boolean;
  configPath?: string;
  completed: boolean;
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

export type KimiCodeApprovalResult = {
  decision: "approved" | "rejected" | "cancelled";
  scope?: "session";
  feedback?: string;
  selectedLabel?: string;
};

export type KimiCodeQuestionResult = null | Record<string, string | true> | {
  answers: Record<string, string | true>;
  method?: "enter" | "space" | "number_key";
};

export type KimiCodeBtwResult = {
  agentId: string;
  content: string;
  thinking: string;
  reason?: string;
};

export type KimiCodeGoalStatus = "active" | "paused" | "blocked" | "complete";

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
  status: KimiCodeGoalStatus | string;
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

export type KimiCodeCreateGoalInput = {
  objective: string;
  completionCriterion?: string;
  replace?: boolean;
};

type ManagedSession = {
  session: KimiCodeSessionLike;
  status: KimiCodeEngineStatus;
  model?: string;
  thinking?: string;
  permission: KimiCodePermissionMode;
  planMode?: boolean;
  additionalDirs: readonly string[];
  unsubscribe: () => void;
  hiddenAgentIds: Set<string>;
  btwRuns: Map<string, BtwRun>;
};

type ServerManagedSession = {
  session: ServerSession;
  workDir: string;
  status: KimiCodeEngineStatus;
  model?: string;
  thinking: string;
  permission: KimiCodePermissionMode;
  planMode: boolean;
  additionalDirs: readonly string[];
  btwRuns: Map<string, BtwRun>;
};

export type BtwRun = {
  agentId: string;
  parts: string[];
  thinkingParts: string[];
  ended: boolean;
  endReason?: string;
  error?: string;
};

type PendingApproval = {
  sessionId: string;
  resolve: (result: KimiCodeApprovalResult) => void;
};

type PendingQuestion = {
  sessionId: string;
  resolve: (result: KimiCodeQuestionResult) => void;
};

type EventSink = (payload: KimiCodeEventPayload) => void;
type StatusSink = (payload: KimiCodeStatusPayload) => void;

let harness: KimiHarnessLike | null = null;
const sessions = new Map<string, ManagedSession>();
const serverSessions = new Map<string, ServerManagedSession>();
/** Server 会话 mid-turn 失败后迁移到 SDK 会话的映射（old server id -> new sdk id）。 */
const serverSessionMigrations = new Map<string, string>();
const serverApprovalIds = new Set<string>();
const serverQuestionIds = new Set<string>();

function resolveMigratedSessionId(sessionId: string): string {
  return serverSessionMigrations.get(sessionId) ?? sessionId;
}

function recordServerSessionMigration(serverSessionId: string, sdkSessionId: string): void {
  serverSessionMigrations.set(serverSessionId, sdkSessionId);
}

const serverQuestionRequests = new Map<string, Record<string, unknown>>();
let serverClient: KimiCodeServerClient | null = null;
let unsubscribeServerFrames: (() => void) | null = null;
let serverRecoveryPromise: Promise<void> | null = null;
let nextServerRecoveryAt = 0;
const pendingApprovals = new Map<string, PendingApproval>();
const pendingQuestions = new Map<string, PendingQuestion>();
let eventSink: EventSink | null = null;
let statusSink: StatusSink | null = null;

const STEER_WIRE_CONFIRM_TIMEOUT_MS = 15_000;
const STEER_WIRE_CONFIRM_INTERVAL_MS = 120;
const SERVER_RELOAD_UNSUPPORTED_MESSAGE = "当前官方 Server 会话暂不支持直接重载配置；如需刷新 Skill、Plugin 或配置，请新建或 fork 会话。";
const SERVER_GOAL_UNSUPPORTED_MESSAGE = "当前官方 Server 会话暂未公开 Goal API；请使用兼容会话或等待官方 Server 支持。";
const SERVER_SWARM_UNSUPPORTED_MESSAGE = "当前官方 Server 会话暂未公开 Swarm API；请使用兼容会话或等待官方 Server 支持。";
let nextRequestId = 0;
let activeLoginAbort: AbortController | null = null;
const KIMI_CODE_MANAGED_PROVIDER_NAME = "managed:kimi-code";

export function setKimiCodeEventSink(sink: EventSink | null) {
  eventSink = sink;
}

export function setKimiCodeStatusSink(sink: StatusSink | null) {
  statusSink = sink;
}

export { isKimiCodeSessionMissingError };
export { isKimiCodeSessionAlreadyExistsError };

export async function createSession(options: CreateKimiCodeSessionOptions): Promise<KimiCodeEngineSession> {
  if (shouldRouteNewSessionToServer()) {
    try {
      const client = getServerClient();
      const session = await client.createSession(options);
      return registerServerSession(session, options.workDir, options);
    } catch (error) {
      const existingSessionId = getKimiCodeSessionAlreadyExistsId(error);
      if (existingSessionId) {
        const client = getServerClient();
        const session = await client.getSession(existingSessionId);
        const workDir = typeof session.metadata?.cwd === "string" ? session.metadata.cwd : options.workDir;
        return registerServerSession(session, workDir, options);
      }
      markServerRuntimeFailure(error);
      console.warn("[KimiCodeServerHost] create session failed; falling back to SDK:", error);
    }
  }
  return createSdkSession(options);
}

export async function resumeSession(sessionId: string, options: { additionalDirs?: readonly string[] } = {}): Promise<KimiCodeEngineSession> {
  const existingServer = serverSessions.get(sessionId);
  if (existingServer) return toServerEngineSession(existingServer);
  if (shouldRouteNewSessionToServer()) {
    try {
      const client = getServerClient();
      const session = await client.getSession(sessionId);
      const workDir = typeof session.metadata?.cwd === "string" ? session.metadata.cwd : process.cwd();
      return registerServerSession(session, workDir, {});
    } catch (error) {
      if (isKimiCodeSessionMissingError(error)) throw error;
      markServerRuntimeFailure(error);
      console.warn("[KimiCodeServerHost] resume session failed; falling back to SDK:", error);
    }
  }
  const existing = sessions.get(sessionId);
  if (existing) return toEngineSession(existing.session, existing.status);

  const sdkHarness = await getHarness();
  const session = await sdkHarness.resumeSession({ id: sessionId, additionalDirs: options.additionalDirs });
  // The resumed session keeps whatever permission it was persisted with; read it
  // back from the SDK so the yolo auto-approve guard reflects reality until the
  // caller re-applies the UI permission mode via setPermission().
  let resumedStatus: KimiCodeSessionStatus | undefined;
  let resumedPermission: KimiCodePermissionMode = "manual";
  try {
    const status = await session.getStatus();
    resumedStatus = status;
    if (status.permission === "manual" || status.permission === "auto" || status.permission === "yolo") {
      resumedPermission = status.permission;
    }
  } catch {
    // Best effort: fall back to "manual" if the status read fails.
  }
  return registerSession(session, "idle", {
    model: resumedStatus?.model,
    thinking: resumedStatus?.thinkingEffort ?? resumedStatus?.thinkingLevel,
    permission: resumedPermission,
    planMode: resumedStatus?.planMode,
  });
}

async function createSdkSession(options: CreateKimiCodeSessionOptions): Promise<KimiCodeEngineSession> {
  const sdkHarness = await getHarness();
  let session: KimiCodeSessionLike;
  try {
    session = await sdkHarness.createSession(options);
  } catch (error) {
    const existingSessionId = getKimiCodeSessionAlreadyExistsId(error);
    if (!existingSessionId) throw error;
    session = await sdkHarness.resumeSession({ id: existingSessionId, additionalDirs: options.additionalDirs });
  }
  return registerSession(session, "idle", {
    model: options.model,
    thinking: options.thinking,
    permission: options.permission ?? "manual",
    planMode: options.planMode ?? false,
  });
}

async function createSdkFallbackSession(
  _serverSessionId: string,
  serverManaged: ServerManagedSession,
): Promise<KimiCodeEngineSession> {
  const sdkHarness = await getHarness();
  let session: KimiCodeSessionLike;
  try {
    session = await sdkHarness.createSession({
      workDir: serverManaged.workDir,
      model: serverManaged.model,
      thinking: serverManaged.thinking,
      permission: serverManaged.permission,
      planMode: serverManaged.planMode,
      additionalDirs: serverManaged.additionalDirs,
    });
  } catch (error) {
    const existingSessionId = getKimiCodeSessionAlreadyExistsId(error);
    if (!existingSessionId) throw error;
    session = await sdkHarness.resumeSession({ id: existingSessionId, additionalDirs: serverManaged.additionalDirs });
  }
  return registerSession(session, "idle", {
    model: serverManaged.model,
    thinking: serverManaged.thinking,
    permission: serverManaged.permission,
    planMode: serverManaged.planMode,
  });
}

export async function forkSession(
  sessionId: string,
  options: { forkId?: string; title?: string; metadata?: JsonObject } = {},
): Promise<KimiCodeEngineSession> {
  const parent = serverSessions.get(sessionId);
  if (parent) {
    const session = await getServerClient().forkSession(sessionId, {
      title: options.title,
      metadata: options.metadata,
    });
    const workDir = typeof session.metadata?.cwd === "string" ? session.metadata.cwd : parent.workDir;
    return registerServerSession(session, workDir, {
      model: parent.model,
      thinking: parent.thinking,
      permission: parent.permission,
      planMode: parent.planMode,
    });
  }
  const sdkHarness = await getHarness();
  if (!sdkHarness.forkSession) throw new Error("当前兼容链路不支持会话派生。");
  const session = await sdkHarness.forkSession({
    id: sessionId,
    forkId: options.forkId,
    title: options.title,
    metadata: options.metadata,
  });
  let forkStatus: KimiCodeSessionStatus | undefined;
  let forkPermission: KimiCodePermissionMode = "manual";
  try {
    const status = await session.getStatus();
    forkStatus = status;
    if (status.permission === "manual" || status.permission === "auto" || status.permission === "yolo") {
      forkPermission = status.permission;
    }
  } catch {
    // Best effort: keep the fork usable even if status hydration is unavailable.
  }
  return registerSession(session, "idle", {
    model: forkStatus?.model,
    thinking: forkStatus?.thinkingEffort ?? forkStatus?.thinkingLevel,
    permission: forkPermission,
    planMode: forkStatus?.planMode,
  });
}

export async function listChildSessions(sessionId: string): Promise<KimiCodeSessionSummary[]> {
  const client = getServerClient();
  const [children, sessions] = await Promise.all([client.listChildren(sessionId), client.listSessions()]);
  return mergeServerRelatedSessions(sessionId, children, sessions).map(serverSessionSummary);
}

export async function createChildSession(
  sessionId: string,
  options: { title?: string; metadata?: JsonObject } = {},
): Promise<KimiCodeEngineSession> {
  const parent = serverSessions.get(sessionId);
  if (!parent) throw new Error("官方子会话创建当前仅由实验性 Kimi Server 提供。");
  const session = await getServerClient().createChild(sessionId, options);
  const workDir = typeof session.metadata?.cwd === "string" ? session.metadata.cwd : parent.workDir;
  return registerServerSession(session, workDir, {
    model: parent.model,
    thinking: parent.thinking,
    permission: parent.permission,
    planMode: parent.planMode,
  });
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    serverManaged.session = await getServerClient().renameSession(sessionId, title);
    return;
  }
  const sdkHarness = await getHarness();
  if (!sdkHarness.renameSession) throw new Error("当前兼容链路不支持会话重命名。");
  await sdkHarness.renameSession({ id: sessionId, title });
}

export async function reloadSession(sessionId: string): Promise<void> {
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    throw new Error(SERVER_RELOAD_UNSUPPORTED_MESSAGE);
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.reloadSession) throw new Error("当前兼容链路不支持会话重载。");
  await managed.session.reloadSession({ forcePluginSessionStartReminder: true });
}

export async function setModel(sessionId: string, model: string): Promise<void> {
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    if (serverManaged.model === model) return;
    await getServerClient().updateSession(sessionId, { model });
    serverManaged.model = model;
    return;
  }
  const managed = getManagedSession(sessionId);
  if (managed.model === model) return;
  if (!managed.session.setModel) throw new Error("当前兼容链路不支持会话模型切换。");
  await managed.session.setModel(model);
  managed.model = model;
}

export async function reloadIdleSessions(): Promise<{ reloaded: string[]; skipped: string[]; errors: { sessionId: string; message: string }[] }> {
  const reloaded: string[] = [];
  const skipped: string[] = [];
  const errors: { sessionId: string; message: string }[] = [];
  for (const [sessionId, managed] of sessions) {
    if (!managed.session.reloadSession) {
      skipped.push(sessionId);
      continue;
    }
    if (managed.status === "running" || managed.status === "waiting_approval" || managed.status === "waiting_question") {
      skipped.push(sessionId);
      continue;
    }
    try {
      await managed.session.reloadSession();
      reloaded.push(sessionId);
    } catch (error) {
      errors.push({ sessionId, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { reloaded, skipped, errors };
}

export type KimiCodePromptRouteResult = {
  route: "server" | "sdk" | "sdk-fallback";
  fallbackReason?: string;
};

const normalizedModelOutputLimits = new Set<string>();

export function missingOpenAiModelOutputLimitPatch(
  config: KimiCodeConfig,
  model: string | undefined,
): KimiCodeConfigPatch | null {
  if (!model) return null;
  const aliasConfig = config.models?.[model];
  const providerConfig = aliasConfig?.provider ? config.providers?.[aliasConfig.provider] : undefined;
  if (
    !aliasConfig ||
    providerConfig?.type !== "openai" ||
    (typeof (aliasConfig.overrides?.maxOutputSize ?? aliasConfig.maxOutputSize) === "number"
      && (aliasConfig.overrides?.maxOutputSize ?? aliasConfig.maxOutputSize ?? 0) > 0)
  ) {
    return null;
  }
  return {
    models: {
      [model]: {
        overrides: {
          ...aliasConfig.overrides,
          maxOutputSize: Math.min(
            65536,
            aliasConfig.overrides?.maxContextSize ?? aliasConfig.maxContextSize ?? 65536,
          ),
        },
      },
    },
  };
}

async function ensureModelOutputLimitBeforePrompt(model: string | undefined): Promise<void> {
  if (!model || normalizedModelOutputLimits.has(model)) return;
  try {
    const patch = missingOpenAiModelOutputLimitPatch(await getConfig({ reload: true }), model);
    if (patch) await setConfig(patch);
    normalizedModelOutputLimits.add(model);
  } catch (error) {
    console.warn(`[KimiCodeHost] lazy model output-limit normalization failed for ${model}:`, error);
  }
}

export async function sendPrompt(sessionId: string, input: string | KimiCodePromptPart[]): Promise<KimiCodePromptRouteResult> {
  sessionId = resolveMigratedSessionId(sessionId);
  let serverManaged = serverSessions.get(sessionId);
  if (!serverManaged && !sessions.has(sessionId)) {
    await resumeSession(sessionId);
    serverManaged = serverSessions.get(sessionId);
  }
  await ensureModelOutputLimitBeforePrompt(serverManaged?.model ?? sessions.get(sessionId)?.model);
  serverManaged ??= await promoteSdkSessionToServer(sessionId);
  if (serverManaged) {
    setStatus(sessionId, "running");
    try {
      await getServerClient().prompt(sessionId, input, serverControls(serverManaged));
      return { route: "server" };
    } catch (error) {
      console.warn("[KimiCodeServerHost] prompt failed mid-turn; error will propagate to caller without fallback:", error);
      // Don't fallback mid-turn: create a fresh SDK session for the next turn,
      // notify the renderer of the migration, then propagate the error.
      const fallbackSession = await createSdkFallbackSession(sessionId, serverManaged);
      recordServerSessionMigration(sessionId, fallbackSession.sessionId);
      statusSink?.({ sessionId, status: "error", migratedTo: fallbackSession.sessionId });
      markServerRuntimeFailure(error);
      serverSessions.delete(sessionId);
      setStatus(sessionId, "error");
      throw error;
    }
  }
  const managed = getManagedSession(sessionId);
  scheduleServerRecovery();
  setStatus(sessionId, "running");
  try {
    await managed.session.prompt(input);
    const serverStatus = kimiCodeServerHost.getStatus();
    return {
      route: "sdk",
      ...(serverStatus.enabled && !kimiCodeServerHost.isReady()
        ? { fallbackReason: serverStatus.error ?? `Kimi Server 状态：${serverStatus.state}` }
        : {}),
    };
  } catch (error) {
    setStatus(sessionId, "error");
    throw error;
  }
}

async function promoteSdkSessionToServer(sessionId: string): Promise<ServerManagedSession | undefined> {
  const sdkManaged = sessions.get(sessionId);
  if (!sdkManaged || !shouldRouteNewSessionToServer()) return undefined;
  if (sdkManaged.status === "running" || sdkManaged.status === "waiting_approval" || sdkManaged.status === "waiting_question") {
    return undefined;
  }
  try {
    const client = getServerClient();
    const session = await client.getSession(sessionId);
    const workDir = typeof session.metadata?.cwd === "string"
      ? session.metadata.cwd
      : getSessionWorkDir(sessionId) ?? process.cwd();
    await registerServerSession(session, workDir, {
      model: sdkManaged.model,
      thinking: sdkManaged.thinking,
      permission: sdkManaged.permission,
      planMode: sdkManaged.planMode,
    });
    sessions.delete(sessionId);
    sdkManaged.unsubscribe();
    return serverSessions.get(sessionId);
  } catch (error) {
    serverSessions.delete(sessionId);
    if (!isKimiCodeSessionMissingError(error)) {
      markServerRuntimeFailure(error);
      console.warn("[KimiCodeServerHost] SDK session promotion failed; keeping SDK route:", error);
    }
    return undefined;
  }
}

function scheduleServerRecovery() {
  const status = kimiCodeServerHost.getStatus();
  if (!status.enabled || kimiCodeServerHost.isReady() || serverRecoveryPromise || Date.now() < nextServerRecoveryAt) return;
  if (!isKimiCodeServerSessionRoutingEnabled(process.env, settingsService.loadSettings())) return;
  nextServerRecoveryAt = Date.now() + 30_000;
  serverRecoveryPromise = kimiCodeServerHost.start()
    .then(() => undefined)
    .catch((error) => console.warn("[KimiCodeServerHost] background recovery failed:", error))
    .finally(() => {
      serverRecoveryPromise = null;
    });
}

export async function setSwarmMode(sessionId: string, enabled: boolean, trigger: "manual" | "task" = "manual"): Promise<void> {
  if (serverSessions.has(sessionId)) throw new Error(SERVER_SWARM_UNSUPPORTED_MESSAGE);
  const managed = getManagedSession(sessionId);
  if (!managed.session.setSwarmMode) throw new Error("当前兼容链路不支持 Swarm 模式。");
  await managed.session.setSwarmMode(enabled, trigger);
}

export async function swarm(sessionId: string, input: string | KimiCodePromptPart[]): Promise<void> {
  if (serverSessions.has(sessionId)) throw new Error(SERVER_SWARM_UNSUPPORTED_MESSAGE);
  const managed = getManagedSession(sessionId);
  if (!managed.session.swarm) throw new Error("当前兼容链路不支持 Swarm。");
  setStatus(sessionId, "running");
  try {
    await managed.session.swarm(input);
  } catch (error) {
    setStatus(sessionId, "error");
    throw error;
  }
}

export async function askBtw(
  sessionId: string,
  input: string | KimiCodePromptPart[],
  options: { timeoutMs?: number } = {},
): Promise<KimiCodeBtwResult> {
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    if (serverManaged.status !== "idle" && serverManaged.status !== "completed" && serverManaged.status !== "interrupted" && serverManaged.status !== "error") {
      throw new Error("当前轮次结束后再使用 BTW 侧问。");
    }
    const client = getServerClient();
    const { agent_id: agentId } = await client.startBtwSession(sessionId);
    const run: BtwRun = { agentId, parts: [], thinkingParts: [], ended: false };
    serverManaged.btwRuns.set(agentId, run);
    try {
      await client.prompt(sessionId, input, { ...serverControls(serverManaged), agent_id: agentId });
      await waitForBtwRun(run, options.timeoutMs ?? 120_000);
      if (run.error) throw new Error(run.error);
      return {
        agentId,
        content: run.parts.join("").trim(),
        thinking: run.thinkingParts.join("").trim(),
        reason: run.endReason,
      };
    } finally {
      serverManaged.btwRuns.delete(agentId);
    }
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.startBtw) throw new Error("当前兼容链路不支持 BTW 侧问。");
  if (managed.status !== "idle" && managed.status !== "completed" && managed.status !== "interrupted" && managed.status !== "error") {
    throw new Error("当前轮次结束后再使用 BTW 侧问。");
  }

  const sdkHarness = await getHarness();
  const agentId = await managed.session.startBtw();
  const run: BtwRun = { agentId, parts: [], thinkingParts: [], ended: false };
  managed.hiddenAgentIds.add(agentId);
  managed.btwRuns.set(agentId, run);

  try {
    await runWithInteractiveAgent(sdkHarness, agentId, () => managed.session.prompt(input));
    await waitForBtwRun(run, options.timeoutMs ?? 120_000);
    if (run.error) throw new Error(run.error);
    return {
      agentId,
      content: run.parts.join("").trim(),
      thinking: run.thinkingParts.join("").trim(),
      reason: run.endReason,
    };
  } finally {
    managed.btwRuns.delete(agentId);
    managed.hiddenAgentIds.delete(agentId);
  }
}

export async function steer(sessionId: string, input: string | KimiCodePromptPart[]): Promise<void> {
  sessionId = resolveMigratedSessionId(sessionId);
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    await getServerClient().steer(sessionId, input, serverControls(serverManaged));
    eventSink?.({ sessionId, event: syntheticSteerRecord(input, Date.now()) });
    return;
  }
  const managed = getManagedSession(sessionId);
  const startedAt = Date.now();
  await managed.session.steer(input);
  eventSink?.({ sessionId, event: syntheticSteerRecord(input, startedAt) });
  void waitForOfficialSteerRecord(sessionId, managed.session.workDir, input, startedAt)
    .then((officialSteer) => {
      if (officialSteer.source === "kimix-fallback") return;
      eventSink?.({ sessionId, event: officialSteer });
    })
    .catch(() => undefined);
}

export async function undoHistory(sessionId: string, count: number): Promise<void> {
  if (serverSessions.has(sessionId)) {
    await getServerClient().undoSession(sessionId, count);
    return;
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.undoHistory) throw new Error("当前兼容链路不支持撤回历史。");
  await managed.session.undoHistory(count);
}

export async function cancel(sessionId: string): Promise<void> {
  sessionId = resolveMigratedSessionId(sessionId);
  if (serverSessions.has(sessionId)) {
    const client = getServerClient();
    await client.abort(sessionId);
    const prompts = await client.listPrompts(sessionId).catch(() => null);
    setStatus(sessionId, prompts && (prompts.active || prompts.queued.length > 0) ? "running" : "interrupted");
    return;
  }
  const managed = getManagedSession(sessionId);
  settlePendingForSession(sessionId, "cancelled");
  await managed.session.cancel();
}

export async function setPlanMode(sessionId: string, enabled: boolean): Promise<void> {
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    if (serverManaged.planMode === enabled) return;
    await getServerClient().updateSession(sessionId, { plan_mode: enabled });
    serverManaged.planMode = enabled;
    return;
  }
  const managed = getManagedSession(sessionId);
  if (managed.planMode === enabled) return;
  await managed.session.setPlanMode(enabled);
  managed.planMode = enabled;
}

export async function setThinking(sessionId: string, level: string): Promise<void> {
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    if (serverManaged.thinking === level) return;
    await getServerClient().updateSession(sessionId, { thinking: level });
    serverManaged.thinking = level;
    return;
  }
  const managed = getManagedSession(sessionId);
  if (managed.thinking === level) return;
  if (!managed.session.setThinking) throw new Error("当前兼容链路不支持切换思考强度。");
  await managed.session.setThinking(level);
  managed.thinking = level;
}

export async function setPermission(sessionId: string, mode: KimiCodePermissionMode): Promise<void> {
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    if (serverManaged.permission === mode) return;
    await getServerClient().updateSession(sessionId, { permission_mode: mode });
    serverManaged.permission = mode;
    return;
  }
  const managed = getManagedSession(sessionId);
  if (managed.permission === mode) return;
  await managed.session.setPermission(mode);
  managed.permission = mode;
}

export async function compactSession(sessionId: string, instruction?: string): Promise<void> {
  if (serverSessions.has(sessionId)) {
    await getServerClient().compactSession(sessionId, instruction);
    return;
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.compact) throw new Error("当前兼容链路不支持上下文压缩。");
  await managed.session.compact(instruction ? { instruction } : undefined);
}

export async function archiveSession(sessionId: string): Promise<void> {
  sessionId = resolveMigratedSessionId(sessionId);
  const managed = serverSessions.get(sessionId);
  if (managed) {
    await getServerClient().archiveSession(sessionId);
    serverSessions.delete(sessionId);
    settlePendingForSession(sessionId, "cancelled");
    await getServerClient().unsubscribe(sessionId).catch((error) => {
      console.warn(`[KimiCodeServerHost] unsubscribe archived session ${sessionId} failed:`, error);
    });
    return;
  }
  if (!shouldRouteNewSessionToServer()) {
    const sdkHarness = await getHarness();
    await archiveSdkSession(sdkHarness, sessionId, () => closeSession(sessionId));
    for (const [serverSessionId, migratedSessionId] of serverSessionMigrations) {
      if (serverSessionId === sessionId || migratedSessionId === sessionId) {
        serverSessionMigrations.delete(serverSessionId);
      }
    }
    return;
  }
  await getServerClient().archiveSession(sessionId);
}

export async function archiveSdkSession(
  sdkHarness: { listSessions: (input: { sessionId: string }) => Promise<KimiCodeSessionSummary[]> },
  sessionId: string,
  closeManagedSession: () => Promise<void> = async () => {},
): Promise<void> {
  const summaries = await sdkHarness.listSessions({ sessionId });
  const summary = summaries.find((item) => item.id === sessionId);
  if (!summary?.sessionDir) {
    throw new Error(`Session "${sessionId}" was not found`);
  }
  await closeManagedSession();
  const statePath = path.join(summary.sessionDir, "state.json");
  let state: unknown;
  try {
    state = JSON.parse(await fs.promises.readFile(statePath, "utf-8"));
  } catch (error) {
    throw new Error(`Session "${sessionId}" state.json was not found`, { cause: error });
  }
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error(`Session "${sessionId}" state.json is invalid`);
  }
  const next = {
    ...state,
    archived: true,
    updatedAt: new Date().toISOString(),
  };
  await fs.promises.writeFile(statePath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
}

export async function createGoal(sessionId: string, input: KimiCodeCreateGoalInput): Promise<KimiCodeGoalState> {
  if (serverSessions.has(sessionId)) throw new Error(SERVER_GOAL_UNSUPPORTED_MESSAGE);
  const managed = getManagedSession(sessionId);
  if (!managed.session.createGoal) throw new Error("当前兼容链路不支持官方 Goal。");
  const goal = await managed.session.createGoal(input);
  return { goal };
}

export async function getGoal(sessionId: string): Promise<KimiCodeGoalState> {
  if (serverSessions.has(sessionId)) throw new Error(SERVER_GOAL_UNSUPPORTED_MESSAGE);
  const managed = getManagedSession(sessionId);
  if (!managed.session.getGoal) throw new Error("当前兼容链路不支持官方 Goal。");
  return managed.session.getGoal();
}

export async function pauseGoal(sessionId: string, reason?: string): Promise<KimiCodeGoalState> {
  if (serverSessions.has(sessionId)) throw new Error(SERVER_GOAL_UNSUPPORTED_MESSAGE);
  const managed = getManagedSession(sessionId);
  if (!managed.session.pauseGoal) throw new Error("当前兼容链路不支持官方 Goal。");
  const goal = await managed.session.pauseGoal({ reason });
  return { goal };
}

export async function resumeGoal(sessionId: string, reason?: string): Promise<KimiCodeGoalState> {
  if (serverSessions.has(sessionId)) throw new Error(SERVER_GOAL_UNSUPPORTED_MESSAGE);
  const managed = getManagedSession(sessionId);
  if (!managed.session.resumeGoal) throw new Error("当前兼容链路不支持官方 Goal。");
  const goal = await managed.session.resumeGoal({ reason });
  return { goal };
}

export async function cancelGoal(sessionId: string, reason?: string): Promise<KimiCodeGoalState> {
  if (serverSessions.has(sessionId)) throw new Error(SERVER_GOAL_UNSUPPORTED_MESSAGE);
  const managed = getManagedSession(sessionId);
  if (!managed.session.cancelGoal) throw new Error("当前兼容链路不支持官方 Goal。");
  const goal = await managed.session.cancelGoal({ reason });
  return { goal: null, cancelledGoal: goal };
}

export async function getStatus(sessionId: string): Promise<KimiCodeSessionStatus> {
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    return serverStatusToKimiCodeStatus(await refreshServerSessionStatus(sessionId, false), serverManaged.session.usage);
  }
  const managed = getManagedSession(sessionId);
  return normalizeSdkSessionStatus(await managed.session.getStatus(), managed.status);
}

export function normalizeSdkSessionStatus(
  status: KimiCodeSessionStatus,
  engineStatus?: KimiCodeEngineStatus,
): KimiCodeSessionStatus {
  const thinkingLevel = status.thinkingEffort ?? status.thinkingLevel;
  return {
    ...status,
    ...(engineStatus === undefined ? {} : { engineStatus }),
    ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
  };
}

export async function getUsage(sessionId: string): Promise<KimiCodeSessionUsage> {
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    const session = await getServerClient().getSession(sessionId);
    serverManaged.session = session;
    return session.usage ?? {};
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.getUsage) throw new Error("当前兼容链路不支持读取会话用量。");
  return managed.session.getUsage();
}

export async function getManagedUsage(providerName?: string): Promise<unknown> {
  const sdkHarness = await getHarness();
  if (!sdkHarness.auth?.getManagedUsage) throw new Error("当前兼容链路不支持读取套餐用量。");
  return sdkHarness.auth.getManagedUsage(providerName);
}

export async function login(
  providerName = KIMI_CODE_MANAGED_PROVIDER_NAME,
  options: { onDeviceCode?: (data: KimiCodeDeviceAuthorization) => void } = {},
): Promise<KimiCodeLoginResult> {
  const sdkHarness = await getHarness();
  if (!sdkHarness.auth?.login) throw new Error("当前兼容链路不支持登录。");
  activeLoginAbort?.abort();
  let deviceAuthorization: KimiCodeDeviceAuthorization | undefined;
  const controller = new AbortController();
  activeLoginAbort = controller;
  let resolveDeviceCode: (data: KimiCodeDeviceAuthorization) => void = () => {};
  const deviceCodePromise = new Promise<KimiCodeDeviceAuthorization>((resolve) => {
    resolveDeviceCode = resolve;
  });
  const deviceCodeTimeout = setTimeout(() => controller.abort(), 30_000);
  const loginPromise = sdkHarness.auth.login(providerName, {
    signal: controller.signal,
    onDeviceCode: (data) => {
      clearTimeout(deviceCodeTimeout);
      deviceAuthorization = data;
      options.onDeviceCode?.(data);
      resolveDeviceCode(data);
    },
  }).finally(() => {
    clearTimeout(deviceCodeTimeout);
    if (activeLoginAbort === controller) activeLoginAbort = null;
  });

  const first = await Promise.race([
    deviceCodePromise.then((deviceCode) => ({ type: "device" as const, deviceCode })),
    loginPromise.then((result) => ({ type: "completed" as const, result })),
  ]);

  if (first.type === "device") {
    return {
      providerName,
      verificationUrl: first.deviceCode.verificationUriComplete || first.deviceCode.verificationUri,
      userCode: first.deviceCode.userCode,
      completed: false,
    };
  }

  return {
    providerName: first.result.providerName,
    verificationUrl: deviceAuthorization?.verificationUriComplete || deviceAuthorization?.verificationUri,
    userCode: deviceAuthorization?.userCode,
    defaultModel: first.result.defaultModel,
    defaultThinking: first.result.defaultThinking,
    configPath: first.result.configPath,
    completed: true,
  };
}

export async function listMcpServers(sessionId: string): Promise<KimiCodeMcpServerInfo[]> {
  if (serverSessions.has(sessionId)) {
    return (await getServerClient().listMcpServers()).map(toKimiCodeMcpServerInfo);
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.listMcpServers) throw new Error("当前兼容链路不支持读取 MCP 服务。");
  return [...await managed.session.listMcpServers()];
}

export async function getMcpStartupMetrics(sessionId: string): Promise<KimiCodeMcpStartupMetrics> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.getMcpStartupMetrics) throw new Error("当前兼容链路不支持读取 MCP 启动指标。");
  return managed.session.getMcpStartupMetrics();
}

export async function reconnectMcpServer(sessionId: string, name: string): Promise<void> {
  if (serverSessions.has(sessionId)) {
    const servers = await getServerClient().listMcpServers();
    const server = servers.find((item) => item.id === name || item.name === name);
    if (!server) throw new Error(`Kimi Server MCP 服务不存在：${name}`);
    await getServerClient().restartMcpServer(server.id);
    return;
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.reconnectMcpServer) throw new Error("当前兼容链路不支持重连 MCP 服务。");
  await managed.session.reconnectMcpServer(name);
}

export async function getServerRuntimeDiagnostics(sessionId: string): Promise<KimiCodeServerRuntimeDiagnostics> {
  if (!serverSessions.has(sessionId)) throw new Error("官方 Server 运行时诊断仅适用于 Server 会话。");
  const client = getServerClient();
  const [status, tools, mcpServers, connections, messages, prompts] = await Promise.all([
    client.getSessionStatus(sessionId),
    client.listTools(sessionId),
    client.listMcpServers(),
    client.listConnections(),
    client.listMessages(sessionId, 20),
    client.listPrompts(sessionId),
  ]);
  return {
    session: serverStatusToKimiCodeStatus(status, serverSessions.get(sessionId)?.session.usage),
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      source: tool.source,
      mcpServerId: tool.mcp_server_id,
      inputSchema: tool.input_schema,
    })),
    mcpServers: mcpServers.map(toKimiCodeMcpServerInfo),
    connections: connections.map((connection) => ({
      id: connection.id,
      connectedAt: connection.connected_at,
      remoteAddress: connection.remote_address,
      userAgent: connection.user_agent,
      hasClientHello: connection.has_client_hello,
      subscriptions: connection.subscriptions,
      subscribedToCurrentSession: connection.subscriptions.includes(sessionId),
    })),
    messages: {
      sampled: messages.items.length,
      hasMore: messages.has_more,
      roles: messages.items.reduce<Record<string, number>>((counts, message) => {
        counts[message.role] = (counts[message.role] ?? 0) + 1;
        return counts;
      }, {}),
      latestCreatedAt: messages.items.reduce<string | null>((latest, message) => (
        !latest || Date.parse(message.created_at) > Date.parse(latest) ? message.created_at : latest
      ), null),
    },
    prompts: {
      activeId: prompts.active?.prompt_id ?? null,
      activeStatus: prompts.active?.status ?? null,
      queuedCount: prompts.queued.length,
    },
  };
}

export async function getPromptQueueState(sessionId: string): Promise<{
  supported: boolean;
  activeId: string | null;
  activeStatus: string | null;
  queuedIds: string[];
}> {
  if (!serverSessions.has(sessionId)) {
    return { supported: false, activeId: null, activeStatus: null, queuedIds: [] };
  }
  const prompts = await getServerClient().listPrompts(sessionId);
  return {
    supported: true,
    activeId: prompts.active?.prompt_id ?? null,
    activeStatus: prompts.active?.status ?? null,
    queuedIds: prompts.queued.map((prompt) => prompt.prompt_id),
  };
}

export async function searchServerSessionFiles(
  sessionId: string,
  workDir: string,
  query: string,
  limit: number,
): Promise<Array<{ path: string; name: string }> | undefined> {
  const managed = serverSessions.get(sessionId);
  if (!managed) return undefined;
  const expectedRoot = path.resolve(workDir).replace(/\\/g, "/").toLowerCase();
  const sessionRoot = path.resolve(managed.workDir).replace(/\\/g, "/").toLowerCase();
  if (expectedRoot !== sessionRoot) return undefined;
  const result = await getServerClient().searchFiles(sessionId, query, limit);
  return result.items
    .filter((item) => item.kind === "file")
    .map((item) => ({ path: item.path, name: item.name }));
}

export async function readServerSessionTextFile(
  sessionId: string,
  workDir: string,
  filePath: string,
): Promise<{ path: string; content: string } | undefined> {
  const managed = serverSessions.get(sessionId);
  if (!managed) return undefined;
  const expectedRoot = path.resolve(workDir).replace(/\\/g, "/").toLowerCase();
  const sessionRoot = path.resolve(managed.workDir).replace(/\\/g, "/").toLowerCase();
  if (expectedRoot !== sessionRoot) return undefined;
  const result = await getServerClient().readFile(sessionId, filePath);
  if (result.is_binary || result.encoding !== "utf-8") throw new Error("Only text files can be read");
  if (result.truncated || result.size > 1_048_576) throw new Error("Text file is too large");
  return { path: result.path, content: result.content };
}

export async function getServerModelCatalog(): Promise<KimiCodeServerModelCatalog> {
  const client = getServerClient();
  const [auth, config, models, providers] = await Promise.all([
    client.getAuthSummary(),
    client.getRedactedConfig(),
    client.listModels(),
    client.listProviders(),
  ]);
  return {
    auth: {
      ready: auth.ready,
      providerCount: auth.providers_count,
      defaultModel: auth.default_model,
      managedProvider: auth.managed_provider,
    },
    config,
    models: models.map((model) => ({
      provider: model.provider,
      model: model.model,
      displayName: model.display_name,
      maxContextSize: model.max_context_size,
      capabilities: model.capabilities ?? [],
      supportEfforts: model.support_efforts ?? [],
      defaultEffort: model.default_effort,
    })),
    providers: providers.map((provider) => ({
      id: provider.id,
      type: provider.type,
      baseUrl: provider.base_url,
      defaultModel: provider.default_model,
      hasApiKey: provider.has_api_key,
      status: provider.status,
      models: provider.models ?? [],
    })),
  };
}

export async function getServerAuthSummaryIfReady(): Promise<ServerAuthSummary | undefined> {
  if (!kimiCodeServerHost.isReady()) return undefined;
  return getServerClient().getAuthSummary();
}

export async function startServerOAuthLogin(): Promise<ServerOAuthFlow | undefined> {
  if (!kimiCodeServerHost.isReady()) return undefined;
  activeLoginAbort?.abort();
  return getServerClient().startOAuthLogin();
}

export async function logoutServerOAuth(): Promise<boolean> {
  if (!kimiCodeServerHost.isReady()) return false;
  await getServerClient().cancelOAuthLogin().catch(() => undefined);
  await getServerClient().logoutOAuth();
  return true;
}

export async function listBackgroundTasks(sessionId: string, options: { activeOnly?: boolean; limit?: number } = {}): Promise<KimiCodeBackgroundTaskInfo[]> {
  if (serverSessions.has(sessionId)) {
    const tasks = await getServerClient().listTasks(sessionId, options.activeOnly ? "running" : undefined);
    const mapped = tasks.map((task) => ({
      taskId: task.id,
      command: task.command ?? "",
      description: task.description,
      status: task.status === "cancelled" ? "killed" as const : task.status,
      pid: 0,
      exitCode: null,
      startedAt: Date.parse(task.started_at ?? task.created_at),
      endedAt: task.completed_at ? Date.parse(task.completed_at) : null,
      subagentType: task.kind,
      outputBytes: task.output_bytes,
      outputPreview: task.output_preview,
      transport: "server" as const,
      stopReason: task.status === "cancelled" ? "任务已被官方 Server 标记为取消。" : undefined,
      failureReason: task.status === "failed" && task.output_bytes ? `任务失败，已有约 ${formatBytes(task.output_bytes)} 输出可查看。` : undefined,
    }));
    return options.limit ? mapped.slice(0, options.limit) : mapped;
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.listBackgroundTasks) throw new Error("当前兼容链路不支持读取后台任务。");
  return [...await managed.session.listBackgroundTasks(options)].map((task) => ({
    ...task,
    transport: "sdk" as const,
  }));
}

export async function getBackgroundTaskOutput(sessionId: string, taskId: string, options: { tail?: number } = {}): Promise<string> {
  if (serverSessions.has(sessionId)) {
    const task = await getServerClient().getTask(sessionId, taskId, Math.max(1_024, (options.tail ?? 200) * 256));
    return task.output_preview ?? "";
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.getBackgroundTaskOutput) throw new Error("当前兼容链路不支持读取后台任务输出。");
  return managed.session.getBackgroundTaskOutput(taskId, options);
}

export async function getBackgroundTaskOutputPath(sessionId: string, taskId: string): Promise<string | undefined> {
  if (serverSessions.has(sessionId)) return undefined;
  const managed = getManagedSession(sessionId);
  if (!managed.session.getBackgroundTaskOutputPath) throw new Error("当前兼容链路不支持读取后台任务输出路径。");
  return managed.session.getBackgroundTaskOutputPath(taskId);
}

export async function stopBackgroundTask(sessionId: string, taskId: string, reason?: string): Promise<void> {
  if (serverSessions.has(sessionId)) {
    await getServerClient().cancelTask(sessionId, taskId);
    return;
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.stopBackgroundTask) throw new Error("当前兼容链路不支持停止后台任务。");
  await managed.session.stopBackgroundTask(taskId, reason ? { reason } : {});
}

export async function detachBackgroundTask(sessionId: string, taskId: string): Promise<KimiCodeBackgroundTaskInfo | undefined> {
  if (serverSessions.has(sessionId)) {
    throw new Error("官方 Server 暂未公开前台任务转后台接口。已在后台运行的任务仍可查看、复制输出或停止。");
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.detachBackgroundTask) throw new Error("当前兼容链路不支持前台任务转后台。");
  const task = await managed.session.detachBackgroundTask(taskId);
  return task ? { ...task, transport: "sdk" as const } : undefined;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export async function listServerTerminals(sessionId: string): Promise<KimiCodeServerTerminalInfo[]> {
  if (!serverSessions.has(sessionId)) throw new Error("官方终端当前仅由实验性 Kimi Server 提供。");
  return (await getServerClient().listTerminals(sessionId)).map(toServerTerminalInfo);
}

export async function createServerTerminal(
  sessionId: string,
  options: { cwd?: string; shell?: string; cols?: number; rows?: number } = {},
): Promise<KimiCodeServerTerminalInfo> {
  if (!serverSessions.has(sessionId)) throw new Error("官方终端当前仅由实验性 Kimi Server 提供。");
  try {
    return toServerTerminalInfo(await getServerClient().createTerminal(sessionId, options));
  } catch (error) {
    throw normalizeServerTerminalCreateError(error);
  }
}

export async function closeServerTerminal(sessionId: string, terminalId: string): Promise<void> {
  if (!serverSessions.has(sessionId)) throw new Error("官方终端当前仅由实验性 Kimi Server 提供。");
  await getServerClient().closeTerminal(sessionId, terminalId);
}

export async function attachServerTerminal(sessionId: string, terminalId: string, sinceSeq?: number): Promise<unknown> {
  if (!serverSessions.has(sessionId)) throw new Error("官方终端当前仅由实验性 Kimi Server 提供。");
  return getServerClient().attachTerminal(sessionId, terminalId, sinceSeq);
}

export async function detachServerTerminal(sessionId: string, terminalId: string): Promise<void> {
  if (!serverSessions.has(sessionId)) throw new Error("官方终端当前仅由实验性 Kimi Server 提供。");
  await getServerClient().detachTerminal(sessionId, terminalId);
}

export async function writeServerTerminal(sessionId: string, terminalId: string, data: string): Promise<void> {
  if (!serverSessions.has(sessionId)) throw new Error("官方终端当前仅由实验性 Kimi Server 提供。");
  await getServerClient().writeTerminal(sessionId, terminalId, data);
}

export async function resizeServerTerminal(
  sessionId: string,
  terminalId: string,
  cols: number,
  rows: number,
): Promise<void> {
  if (!serverSessions.has(sessionId)) throw new Error("官方终端当前仅由实验性 Kimi Server 提供。");
  await getServerClient().resizeTerminal(sessionId, terminalId, cols, rows);
}

// Lazily-created session for plugin management when no chat session is active.
let pluginSessionPromise: Promise<KimiCodeSessionLike> | null = null;

async function getOrCreatePluginSession(): Promise<KimiCodeSessionLike> {
  if (pluginSessionPromise) {
    try { return await pluginSessionPromise; } catch { pluginSessionPromise = null; }
  }
  const sdkHarness = await getHarness();
  const config = await sdkHarness.getConfig();
  const workDir = path.join(os.tmpdir(), "kimix-plugin-mgmt");
  fs.mkdirSync(workDir, { recursive: true });
  pluginSessionPromise = sdkHarness.createSession({
    workDir,
    model: config.defaultModel,
    permission: "manual",
    planMode: false,
    metadata: { source: "kimix-plugin-management" },
  });
  return pluginSessionPromise;
}

async function closePluginManagementSession(): Promise<void> {
  if (!pluginSessionPromise) return;
  const sessionPromise = pluginSessionPromise;
  pluginSessionPromise = null;
  try {
    const session = await sessionPromise;
    await session.close().catch(() => undefined);
  } catch {
    // Ignore a failed management-session bootstrap; the next call can create a fresh one.
  }
}

function resolvePluginSession(sessionId?: string): Promise<KimiCodeSessionLike> | KimiCodeSessionLike {
  if (sessionId && serverSessions.has(sessionId)) return getOrCreatePluginSession();
  if (sessionId) return getManagedSession(sessionId).session;
  return getOrCreatePluginSession();
}

export async function listPlugins(sessionId?: string): Promise<KimiCodePluginSummary[]> {
  if (!sessionId) {
    const sdkHarness = await getHarness();
    if (sdkHarness.listPlugins) return [...await sdkHarness.listPlugins()];
  }
  const session = await resolvePluginSession(sessionId);
  if (!session.listPlugins) throw new Error("当前兼容链路不支持读取插件列表。");
  return [...await session.listPlugins()];
}

export async function listSkills(sessionId?: string): Promise<KimiCodeSkillSummary[]> {
  if (sessionId && serverSessions.has(sessionId)) {
    return (await getServerClient().listSkills(sessionId)).map(toKimiCodeSkillSummary);
  }
  const session = await resolvePluginSession(sessionId);
  if (!session.listSkills) throw new Error("当前兼容链路不支持读取 Skill 列表。");
  return [...await session.listSkills()];
}

export async function activateSkill(sessionId: string, name: string, args?: string): Promise<void> {
  if (serverSessions.has(sessionId)) {
    await getServerClient().activateSkill(sessionId, name, args);
    return;
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.activateSkill) throw new Error("当前兼容链路不支持激活 Skill。");
  await managed.session.activateSkill(name, args);
}

export function toKimiCodeSkillSummary(skill: ServerSkill): KimiCodeSkillSummary {
  return {
    name: skill.name,
    description: skill.description,
    path: skill.path,
    source: skill.source,
    type: skill.type,
    disableModelInvocation: skill.disable_model_invocation,
    isSubSkill: skill.type === "sub-skill",
  };
}

export function toKimiCodeMcpServerInfo(server: ServerMcpServer): KimiCodeMcpServerInfo {
  const status = server.status === "connected"
    ? "connected" as const
    : server.status === "connecting"
      ? "pending" as const
      : server.status === "error"
        ? "failed" as const
        : "disabled" as const;
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    status,
    toolCount: server.tool_count,
    error: server.last_error,
  };
}

export async function installPlugin(source: string, sessionId?: string): Promise<KimiCodePluginSummary> {
  if (!sessionId || serverSessions.has(sessionId)) {
    await closePluginManagementSession();
    const sdkHarness = await getHarness();
    if (sdkHarness.installPlugin) return sdkHarness.installPlugin(source);
  }
  const session = await resolvePluginSession(sessionId);
  if (!session.installPlugin) throw new Error("当前兼容链路不支持安装插件。");
  return session.installPlugin(source);
}

export async function setPluginEnabled(id: string, enabled: boolean, sessionId?: string): Promise<void> {
  if (!sessionId) {
    const sdkHarness = await getHarness();
    if (sdkHarness.setPluginEnabled) {
      await sdkHarness.setPluginEnabled(id, enabled);
      return;
    }
  }
  const session = await resolvePluginSession(sessionId);
  if (!session.setPluginEnabled) throw new Error("当前兼容链路不支持切换插件状态。");
  await session.setPluginEnabled(id, enabled);
}

export async function setPluginMcpServerEnabled(id: string, server: string, enabled: boolean, sessionId?: string): Promise<void> {
  if (!sessionId) {
    const sdkHarness = await getHarness();
    if (sdkHarness.setPluginMcpServerEnabled) {
      await sdkHarness.setPluginMcpServerEnabled(id, server, enabled);
      return;
    }
  }
  const session = await resolvePluginSession(sessionId);
  if (!session.setPluginMcpServerEnabled) throw new Error("当前兼容链路不支持切换 Plugin MCP 状态。");
  await session.setPluginMcpServerEnabled(id, server, enabled);
}

export async function listSessions(workDir?: string): Promise<KimiCodeSessionSummary[]> {
  if (shouldRouteNewSessionToServer()) {
    const normalizedWorkDir = workDir ? path.resolve(workDir).toLowerCase() : undefined;
    return (await getServerClient().listSessions())
      .filter((session) => !normalizedWorkDir || (
        typeof session.metadata?.cwd === "string" && path.resolve(session.metadata.cwd).toLowerCase() === normalizedWorkDir
      ))
      .map(serverSessionSummary);
  }
  const sdkHarness = await getHarness();
  const sessions = [...await sdkHarness.listSessions({ ...(workDir ? { workDir } : {}), includeArchive: true })];
  // SDK may return empty title/lastPrompt; backfill from state.json if available.
  for (const session of sessions) {
    session.source = "sdk";
    session.title = sanitizeSkillActivationTitle(session.title);
    try {
      const metadata = readKimiCodeSessionMetadata(session.sessionDir);
      session.isCustomTitle = metadata?.isCustomTitle === true;
      if (metadata) {
        const forkedFrom = typeof metadata.forkedFrom === "string"
          ? metadata.forkedFrom
          : typeof metadata.custom?.forkedFrom === "string"
            ? metadata.custom.forkedFrom
            : undefined;
        session.metadata = {
          ...session.metadata,
          ...metadata.custom,
          ...(forkedFrom ? { forkedFrom } : {}),
        };
      }
      if (!session.title?.trim() && metadata?.title?.trim()) {
        session.title = sanitizeSkillActivationTitle(metadata.title.trim());
      }
      if (!session.lastPrompt?.trim() && metadata?.lastPrompt?.trim()) {
        session.lastPrompt = metadata.lastPrompt.trim();
      }
      if (session.archived !== true && session.isCustomTitle !== true) {
        const firstPrompt = await getFirstUserMessage(path.join(session.sessionDir, "agents", "main", "wire.jsonl"));
        if (firstPrompt.trim()) session.brief = firstPrompt.trim();
      }
    } catch {
      // ignore unreadable metadata
    }
  }
  return sessions.filter((session) => session.archived === true || Boolean(session.lastPrompt?.trim()));
}

export async function loadServerSessionHistory(sessionId: string): Promise<{ events: Array<{ type: string; payload: unknown; time?: unknown }>; source: "server" }> {
  const snapshot = await getServerClient().getSnapshot(sessionId);
  const frames = snapshotToHistoryFrames(snapshot, sessionId);
  return {
    events: frames.map((frame) => ({
      type: frame.type,
      payload: frame.payload ?? {},
      time: serverReplayTimestamp(frame),
    })),
    source: "server",
  };
}

function serverReplayTimestamp(frame: ServerFrame): unknown {
  const payload = frame.payload && typeof frame.payload === "object"
    ? frame.payload as Record<string, unknown>
    : {};
  const createdAt = payload.created_at ?? payload.createdAt;
  if (typeof createdAt === "string" || typeof createdAt === "number") return createdAt;
  return undefined;
}

export async function exportSession(input: KimiCodeExportSessionInput): Promise<KimiCodeExportSessionResult> {
  const sdkHarness = await getHarness();
  return sdkHarness.exportSession({
    ...input,
    version: input.version ?? process.env.npm_package_version ?? "0.0.0",
    installSource: input.installSource ?? "kimix-sdk-host",
  });
}

export async function getConfig(options?: { reload?: boolean }): Promise<KimiCodeConfig> {
  const sdkHarness = await getHarness();
  return sdkHarness.getConfig(options);
}

export async function getConfigDiagnostics(): Promise<KimiCodeConfigDiagnostics> {
  const sdkHarness = await getHarness();
  if (!sdkHarness.getConfigDiagnostics) return { warnings: [] };
  return sdkHarness.getConfigDiagnostics();
}

export async function setConfig(patch: KimiCodeConfigPatch): Promise<KimiCodeConfig> {
  const sdkHarness = await getHarness();
  if (kimiCodeServerHost.isReady()) {
    try {
      const entries = Object.entries(patch);
      if (entries.length === 1 && typeof patch.defaultModel === "string") {
        await getServerClient().setDefaultModel(patch.defaultModel);
      } else {
        await getServerClient().setConfig(toServerConfigPatch(patch as Record<string, unknown>));
      }
      return sdkHarness.getConfig({ reload: true });
    } catch (error) {
      console.warn("[KimiCodeServerHost] config update failed; falling back to SDK:", error);
    }
  }
  return sdkHarness.setConfig(patch);
}

function normalizeCatalogMaxContextSize(value: number | null) {
  const fallback = 262144;
  const input = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(1, input);
}

export async function listProviderCatalog(): Promise<KimiCodeProviderCatalogEntry[]> {
  const sdk = await loadSdk();
  if (!sdk.fetchCatalog || !sdk.inferWireType || !sdk.catalogProviderModels || !sdk.catalogBaseUrl) {
    throw new Error("当前兼容链路未公开 Provider catalog API");
  }
  const catalogUrl = sdk.DEFAULT_CATALOG_URL ?? "https://models.dev/api.json";
  const catalog = await sdk.fetchCatalog(catalogUrl);
  return Object.entries(catalog)
    .map(([providerId, provider]) => {
      const wire = sdk.inferWireType?.(provider);
      if (wire !== "openai") return null;
      const baseUrl = sdk.catalogBaseUrl?.(provider, wire) ?? null;
      const models = (sdk.catalogProviderModels?.(provider) ?? [])
        .filter((model) => typeof model.id === "string" && model.id.length > 0)
        .map((model) => {
          const rawMaxContextSize = typeof model.capability?.max_context_tokens === "number" ? model.capability.max_context_tokens : null;
          return {
            id: model.id,
            name: typeof model.name === "string" && model.name.length > 0 ? model.name : null,
            maxContextSize: normalizeCatalogMaxContextSize(rawMaxContextSize),
            thinking: Boolean(model.capability?.thinking),
            toolUse: model.capability?.tool_use !== false,
          };
        })
        .sort((a, b) => a.id.localeCompare(b.id, "zh-CN"));
      if (!baseUrl || models.length === 0) return null;
      return {
        providerId,
        type: wire,
        baseUrl,
        modelCount: models.length,
        models,
      };
    })
    .filter((entry): entry is KimiCodeProviderCatalogEntry => Boolean(entry))
    .sort((a, b) => a.providerId.localeCompare(b.providerId, "zh-CN"));
}

export async function closeSession(sessionId: string): Promise<void> {
  sessionId = resolveMigratedSessionId(sessionId);
  if (serverSessions.has(sessionId)) {
    serverSessions.delete(sessionId);
    await getServerClient().unsubscribe(sessionId);
    if (serverSessions.size === 0) {
      unsubscribeServerFrames?.();
      unsubscribeServerFrames = null;
      await serverClient?.close();
      serverClient = null;
      kimiCodeServerHost.setRouting("sdk");
    }
    return;
  }
  const managed = sessions.get(sessionId);
  if (!managed) return;
  sessions.delete(sessionId);
  settlePendingForSession(sessionId, "cancelled");
  managed.unsubscribe();
  await managed.session.close();
}

export async function closeAllSessions(): Promise<void> {
  await closePluginManagementSession();
  await Promise.all([...sessions.keys(), ...serverSessions.keys()].map((sessionId) => closeSession(sessionId).catch(() => {})));
  if (harness) {
    await harness.close();
    harness = null;
  }
}

/**
 * Run an isolated one-shot prompt — creates a temporary session, sends content,
 * collects the assistant's text response, then closes the session.
 *
 * This is intentionally separate from the normal session cache: it does NOT call
 * registerSession(), does NOT fire the global eventSink, and does NOT touch the
 * sessions Map. Events from this prompt will not leak into open chat windows.
 */
export async function runOneShotPrompt(options: {
  workDir: string;
  content: string | KimiCodePromptPart[];
  model?: string;
  thinking?: boolean;
  yoloMode?: boolean;
  timeoutMs?: number;
}): Promise<string> {
  const sdkHarness = await getHarness();
  const config = await sdkHarness.getConfig();
  const model = options.model ?? config.defaultModel;
  if (!model) throw new Error("No model configured for one-shot prompt.");

  const session = await sdkHarness.createSession({
    workDir: options.workDir,
    model,
    permission: options.yoloMode ? "yolo" : "manual",
    planMode: false,
    metadata: { source: "kimix-one-shot", createdAt: new Date().toISOString() },
  });

  const timeoutMs = options.timeoutMs ?? 120_000;
  const startedAt = Date.now();
  const parts: string[] = [];
  let ended = false;
  let endError: string | undefined;

  const unsubscribe = session.onEvent((event) => {
    if (event.type === "assistant.delta") {
      if (typeof event.delta === "string") parts.push(event.delta);
    }
    if (event.type === "turn.ended") {
      ended = true;
      if (event.reason === "failed" || event.reason === "error") {
        endError = event.error?.code
          ? `${event.error.code}: ${event.error.message}`
          : event.reason;
      }
    }
    if (event.type === "error") {
      ended = true;
      endError = event.message ?? "Unknown SDK error";
    }
  });

  try {
    await session.prompt(options.content);

    // Wait for the turn to complete or timeout.
    while (!ended && Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    if (!ended) {
      try { await session.cancel(); } catch { /* best effort */ }
      throw new Error(`One-shot prompt timed out after ${timeoutMs}ms`);
    }

    if (endError) {
      throw new Error(`One-shot prompt failed: ${endError}`);
    }

    return parts.join("");
  } finally {
    unsubscribe();
    try { await session.close(); } catch { /* clean up quietly */ }
  }
}

export function getSessionWorkDir(sessionId: string): string | undefined {
  return sessions.get(sessionId)?.session.workDir ?? serverSessions.get(sessionId)?.workDir;
}

export function getSessionModel(sessionId: string): string | undefined {
  return serverSessions.get(sessionId)?.model ?? sessions.get(sessionId)?.model;
}

export function getActiveSessionIds(): string[] {
  return [...sessions.keys(), ...serverSessions.keys()];
}

export function getSessionRuntimeKind(sessionId: string): "server" | "sdk" | null {
  if (serverSessions.has(sessionId)) return "server";
  if (sessions.has(sessionId)) return "sdk";
  return null;
}

export function respondApproval(
  sessionId: string,
  requestId: string,
  approved: boolean,
  scope?: "once" | "session",
  feedback?: string,
): void {
  const serverKey = pendingKey(sessionId, requestId);
  if (serverApprovalIds.delete(serverKey)) {
    setStatus(sessionId, "running");
    void getServerClient().resolveApproval(sessionId, requestId, {
      decision: approved ? "approved" : "rejected",
      scope: approved && scope === "session" ? "session" : undefined,
      feedback,
    }).catch((error) => emitServerError(sessionId, error));
    return;
  }
  const key = pendingKey(sessionId, requestId);
  const pending = pendingApprovals.get(key);
  if (!pending) throw new Error(`Kimi Code approval request is not pending: ${requestId}`);
  pendingApprovals.delete(key);
  setStatus(sessionId, "running");
  pending.resolve({
    decision: approved ? "approved" : "rejected",
    scope: approved && scope === "session" ? "session" : undefined,
    feedback,
    selectedLabel: approved ? (scope === "session" ? "Allow for session" : "Allow") : "Reject",
  });
}

export function respondQuestion(
  sessionId: string,
  requestId: string,
  answers: Record<string, string | true>,
  skipped?: boolean,
): void {
  const serverKey = pendingKey(sessionId, requestId);
  if (serverQuestionIds.delete(serverKey)) {
    setStatus(sessionId, "running");
    const request = serverQuestionRequests.get(serverKey);
    serverQuestionRequests.delete(serverKey);
    void getServerClient().resolveQuestion(sessionId, requestId, {
      answers: toServerQuestionAnswers(answers, request, skipped),
      method: "click",
    })
      .catch((error) => emitServerError(sessionId, error));
    return;
  }
  const key = pendingKey(sessionId, requestId);
  const pending = pendingQuestions.get(key);
  if (!pending) throw new Error(`Kimi Code question request is not pending: ${requestId}`);
  pendingQuestions.delete(key);
  setStatus(sessionId, "running");
  pending.resolve(skipped ? null : { answers, method: "enter" });
}

function registerSession(
  session: KimiCodeSessionLike,
  initialStatus: KimiCodeEngineStatus,
  profile: {
    model?: string;
    thinking?: string;
    permission: KimiCodePermissionMode;
    planMode?: boolean;
  },
): KimiCodeEngineSession {
  sessions.get(session.id)?.unsubscribe();
  attachInteractionHandlers(session);
  const hiddenAgentIds = new Set<string>();
  const btwRuns = new Map<string, BtwRun>();
  const unsubscribe = session.onEvent((event) => {
    const agentId = getEventAgentId(event);
    if (agentId && hiddenAgentIds.has(agentId)) {
      const run = btwRuns.get(agentId);
      if (run) updateBtwRunFromEvent(run, event);
      return;
    }
    eventSink?.({ sessionId: session.id, event });
    updateStatusFromEvent(session.id, event);
  });
  const managed: ManagedSession = {
    session,
    status: initialStatus,
    model: profile.model,
    thinking: profile.thinking,
    permission: profile.permission,
    planMode: profile.planMode,
    additionalDirs: session.summary?.additionalDirs ?? [],
    unsubscribe,
    hiddenAgentIds,
    btwRuns,
  };
  sessions.set(session.id, managed);
  emitStatus(session.id, initialStatus);
  return toEngineSession(session, initialStatus);
}

async function registerServerSession(
  session: ServerSession,
  workDir: string,
  options: Partial<CreateKimiCodeSessionOptions>,
): Promise<KimiCodeEngineSession> {
  const config = session.agent_config ?? {};
  const managed: ServerManagedSession = {
    session,
    workDir,
    status: mapServerStatus(session.status),
    model: typeof config.model === "string" ? config.model : options.model,
    thinking: typeof config.thinking === "string" ? config.thinking : options.thinking ?? "off",
    permission: config.permission_mode === "auto" || config.permission_mode === "yolo"
      ? config.permission_mode
      : options.permission ?? "manual",
    planMode: typeof config.plan_mode === "boolean" ? config.plan_mode : options.planMode ?? false,
    additionalDirs: options.additionalDirs ?? [],
    btwRuns: new Map(),
  };
  serverSessions.set(session.id, managed);
  await getServerClient().subscribe(session.id);
  void refreshServerSessionStatus(session.id, true).catch((error) => {
    if (isKimiCodeSessionMissingError(error)) {
      serverSessions.delete(session.id);
      console.warn(`[KimiCodeServerHost] session ${session.id} vanished during initial status refresh; removed stale Server binding.`);
      return;
    }
    console.warn(`[KimiCodeServerHost] refresh initial status failed for ${session.id}:`, error);
  });
  kimiCodeServerHost.setRouting("server");
  emitStatus(session.id, managed.status);
  return toServerEngineSession(managed);
}

function shouldRouteNewSessionToServer() {
  return isKimiCodeServerSessionRoutingEnabled(process.env, settingsService.loadSettings()) && kimiCodeServerHost.isReady();
}

export function isListingSessionsFromServer() {
  return shouldRouteNewSessionToServer();
}

function markServerRuntimeFailure(error: unknown) {
  kimiCodeServerHost.markFallback(error);
  unsubscribeServerFrames?.();
  unsubscribeServerFrames = null;
  void serverClient?.close().catch(() => undefined);
  serverClient = null;
  scheduleServerRecovery();
}

function getServerClient() {
  if (serverClient) return serverClient;
  if (!kimiCodeServerHost.isReady()) throw new Error("Kimi Server 尚未就绪，已保留兼容链路。");
  serverClient = new KimiCodeServerClient(kimiCodeServerHost.getStatus().endpoint, {
    onReconnecting: () => kimiCodeServerHost.markReconnecting(),
    onReconnected: () => kimiCodeServerHost.markReconnected(),
    onRuntimeFailure: markServerRuntimeFailure,
  });
  unsubscribeServerFrames = serverClient.onFrame(handleServerFrame);
  return serverClient;
}

function handleServerFrame(frame: ServerFrame) {
  const sessionId = frame.session_id;
  if (!sessionId || !serverSessions.has(sessionId)) return;
  const payload = frame.payload && typeof frame.payload === "object"
    ? frame.payload as Record<string, unknown>
    : {};
  if (frame.type === "kimix.server.snapshot") {
    const snapshot = payload as ServerSnapshot;
    const session = snapshot.session;
    const managed = serverSessions.get(sessionId);
    if (session && managed) {
      managed.session = session;
      setStatus(sessionId, mapServerStatus(session.status));
    }
    for (const replayFrame of snapshotMessagesToServerFrames(snapshot, sessionId)) {
      handleServerFrame(replayFrame);
    }
    for (const approval of Array.isArray(payload.pending_approvals) ? payload.pending_approvals : []) {
      if (!approval || typeof approval !== "object") continue;
      handleServerFrame({ type: "event.approval.requested", session_id: sessionId, payload: approval });
    }
    for (const question of Array.isArray(payload.pending_questions) ? payload.pending_questions : []) {
      if (!question || typeof question !== "object") continue;
      handleServerFrame({ type: "event.question.requested", session_id: sessionId, payload: question });
    }
    return;
  }
  if (frame.type === "event.approval.requested") {
    const requestId = typeof payload.approval_id === "string" ? payload.approval_id : undefined;
    if (!requestId) return;
    if (serverSessions.get(sessionId)?.permission === "yolo") {
      setStatus(sessionId, "running");
      void getServerClient().resolveApproval(sessionId, requestId, {
        decision: "approved",
        scope: "session",
      }).catch((error) => emitServerError(sessionId, error));
      return;
    }
    serverApprovalIds.add(pendingKey(sessionId, requestId));
    setStatus(sessionId, "waiting_approval");
    eventSink?.({ sessionId, event: { type: "kimix.approval.request", requestId, request: payload } });
    return;
  }
  if (frame.type === "event.question.requested") {
    const requestId = typeof payload.question_id === "string" ? payload.question_id : undefined;
    if (!requestId) return;
    serverQuestionIds.add(pendingKey(sessionId, requestId));
    serverQuestionRequests.set(pendingKey(sessionId, requestId), payload);
    setStatus(sessionId, "waiting_question");
    eventSink?.({ sessionId, event: { type: "kimix.question.request", requestId, request: payload } });
    return;
  }
  const event = flattenServerEvent(frame);
  const managed = serverSessions.get(sessionId);
  if (managed && consumeBtwEvent(managed.btwRuns, event)) return;
  eventSink?.({ sessionId, event });
  updateStatusFromEvent(sessionId, event);
  if (frame.type === "prompt.completed") {
    const currentStatus = serverSessions.get(sessionId)?.status;
    if (currentStatus !== "interrupted" && currentStatus !== "error") setStatus(sessionId, "completed");
    void refreshServerSessionStatus(sessionId, true).catch((error) => {
      console.warn(`[KimiCodeServerHost] refresh completed status failed for ${sessionId}:`, error);
    });
  }
}

async function refreshServerSessionStatus(sessionId: string, emitEvent: boolean): Promise<ServerSessionStatus> {
  const managed = serverSessions.get(sessionId);
  if (!managed) throw new Error(`Kimi Server session is not active: ${sessionId}`);
  const status = await getServerClient().getSessionStatus(sessionId);
  if (status.model) managed.model = status.model;
  managed.thinking = status.thinking_level;
  if (status.permission === "manual" || status.permission === "auto" || status.permission === "yolo") {
    managed.permission = status.permission;
  }
  managed.planMode = status.plan_mode;
  if (emitEvent) eventSink?.({ sessionId, event: serverStatusToAgentEvent(status) });
  return status;
}

export function serverStatusToAgentEvent(status: ServerSessionStatus): Record<string, unknown> {
  return {
    type: "agent.status.updated",
    model: status.model,
    thinkingLevel: status.thinking_level,
    permission: status.permission,
    planMode: status.plan_mode,
    swarmMode: status.swarm_mode,
    contextTokens: status.context_tokens,
    maxContextTokens: status.max_context_tokens,
    contextUsage: status.context_usage,
  };
}

function serverStatusToKimiCodeStatus(status: ServerSessionStatus, usage: unknown): KimiCodeSessionStatus {
  return {
    engineStatus: mapServerStatus(status.status),
    model: status.model,
    thinkingLevel: status.thinking_level,
    permission: status.permission === "manual" || status.permission === "auto" || status.permission === "yolo"
      ? status.permission
      : undefined,
    planMode: status.plan_mode,
    contextTokens: status.context_tokens,
    maxContextTokens: status.max_context_tokens,
    contextUsage: status.context_usage,
    usage,
  };
}

function emitServerError(sessionId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  setStatus(sessionId, "error");
  eventSink?.({ sessionId, event: { type: "error", message } });
}

function serverControls(managed: ServerManagedSession): Record<string, unknown> {
  return {
    model: managed.model ?? "kimi-code/kimi-for-coding",
    thinking: managed.thinking,
    permission_mode: managed.permission,
    plan_mode: managed.planMode,
  };
}

function toServerQuestionAnswers(
  answers: Record<string, string | true>,
  request: Record<string, unknown> | undefined,
  skipped?: boolean,
): Record<string, unknown> {
  const questions = Array.isArray(request?.questions) ? request.questions : [];
  return Object.fromEntries(questions.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const question = raw as { id?: unknown; options?: unknown };
    if (typeof question.id !== "string") return [];
    if (skipped) return [[question.id, { kind: "skipped" }]];
    const value = answers[question.id];
    const options = Array.isArray(question.options) ? question.options : [];
    const option = options.find((rawOption) => {
      if (!rawOption || typeof rawOption !== "object") return false;
      const item = rawOption as { id?: unknown; label?: unknown };
      return item.id === value || item.label === value;
    }) as { id?: unknown } | undefined;
    if (typeof option?.id === "string") return [[question.id, { kind: "single", option_id: option.id }]];
    if (typeof value === "string") return [[question.id, { kind: "other", text: value }]];
    const first = options[0] as { id?: unknown } | undefined;
    return typeof first?.id === "string" ? [[question.id, { kind: "single", option_id: first.id }]] : [];
  }));
}

function mapServerStatus(status: string): KimiCodeEngineStatus {
  if (status === "running") return "running";
  if (status === "awaiting_approval") return "waiting_approval";
  if (status === "awaiting_question") return "waiting_question";
  if (status === "aborted") return "interrupted";
  return "idle";
}

function toServerEngineSession(managed: ServerManagedSession): KimiCodeEngineSession {
  return { sessionId: managed.session.id, workDir: managed.workDir, status: managed.status, additionalDirs: managed.additionalDirs };
}

function sanitizeSkillActivationTitle(title?: string) {
  if (!title) return title;
  const match = title.match(/^User activated the skill\s+["“]([^"”]+)["”]/i);
  return match ? `使用 ${match[1]}` : title;
}

function serverSessionSummary(session: ServerSession): KimiCodeSessionSummary {
  const workDir = typeof session.metadata?.cwd === "string" ? session.metadata.cwd : "";
  const additionalDirs = Array.isArray(session.metadata?.additionalDirs)
    ? session.metadata.additionalDirs.filter((item): item is string => typeof item === "string")
    : undefined;
  return {
    id: session.id,
    title: sanitizeSkillActivationTitle(session.title),
    workDir,
    sessionDir: "",
    createdAt: session.created_at ? Date.parse(session.created_at) : 0,
    updatedAt: session.updated_at ? Date.parse(session.updated_at) : 0,
    archived: session.archived,
    source: "server",
    metadata: session.metadata,
    additionalDirs,
  };
}

function toServerTerminalInfo(terminal: ServerTerminal): KimiCodeServerTerminalInfo {
  return {
    id: terminal.id,
    sessionId: terminal.session_id,
    cwd: terminal.cwd,
    shell: terminal.shell,
    cols: terminal.cols,
    rows: terminal.rows,
    status: terminal.status,
    createdAt: terminal.created_at,
    exitedAt: terminal.exited_at,
    exitCode: terminal.exit_code,
  };
}

function waitForBtwRun(run: BtwRun, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (run.ended) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`BTW 侧问超时（${Math.round(timeoutMs / 1000)} 秒）。`));
        return;
      }
      setTimeout(tick, 120);
    };
    tick();
  });
}

function updateBtwRunFromEvent(run: BtwRun, event: unknown) {
  const type = event && typeof event === "object" ? (event as { type?: unknown }).type : undefined;
  if (type === "assistant.delta") {
    const delta = (event as { delta?: unknown }).delta;
    if (typeof delta === "string") run.parts.push(delta);
    return;
  }
  if (type === "thinking.delta") {
    const delta = (event as { delta?: unknown }).delta;
    if (typeof delta === "string") run.thinkingParts.push(delta);
    return;
  }
  if (type === "turn.ended") {
    const reason = (event as { reason?: unknown }).reason;
    run.endReason = typeof reason === "string" ? reason : undefined;
    if (run.endReason === "failed" || run.endReason === "error") {
      const error = (event as { error?: { code?: unknown; message?: unknown } }).error;
      const code = typeof error?.code === "string" ? error.code : "";
      const message = typeof error?.message === "string" ? error.message : run.endReason;
      run.error = code ? `${code}: ${message}` : message;
    }
    run.ended = true;
    return;
  }
  if (type === "error") {
    const message = (event as { message?: unknown }).message;
    run.error = typeof message === "string" ? message : "BTW 侧问失败。";
    run.ended = true;
  }
}

export function consumeBtwEvent(runs: Map<string, BtwRun>, event: unknown): boolean {
  const agentId = getEventAgentId(event);
  if (!agentId) return false;
  const run = runs.get(agentId);
  if (!run) return false;
  updateBtwRunFromEvent(run, event);
  return true;
}

function getEventAgentId(event: unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined;
  const direct = (event as { agentId?: unknown }).agentId;
  if (typeof direct === "string" && direct) return direct;
  const agent = (event as { agent?: { id?: unknown } }).agent;
  return typeof agent?.id === "string" && agent.id ? agent.id : undefined;
}

function getLoopEvent(event: unknown): Record<string, unknown> | undefined {
  if (!event || typeof event !== "object") return undefined;
  const record = event as { type?: unknown; event?: unknown };
  if (record.type !== "context.append_loop_event" || !record.event || typeof record.event !== "object") return undefined;
  return record.event as Record<string, unknown>;
}

function normalizeSteerText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function promptInputText(input: string | KimiCodePromptPart[]): string {
  if (typeof input === "string") return input;
  return input
    .flatMap((part) => part.type === "text" ? [part.text] : [])
    .join("\n");
}

function steerRecordText(record: Record<string, unknown>): string {
  const input = record.input;
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return "";
  return input
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const item = part as { type?: unknown; text?: unknown };
      return item.type === "text" && typeof item.text === "string" ? [item.text] : [];
    })
    .join("\n");
}

function isMatchingSteerRecord(
  record: Record<string, unknown>,
  expectedText: string,
  startedAt: number,
): boolean {
  if (record.type !== "turn.steer") return false;
  if (typeof record.time === "number" && record.time < startedAt - 1_000) return false;
  const normalizedExpected = normalizeSteerText(expectedText);
  if (!normalizedExpected) return true;
  const normalizedRecord = normalizeSteerText(steerRecordText(record));
  if (!normalizedRecord) return false;
  return normalizedRecord === normalizedExpected ||
    normalizedRecord.startsWith(normalizedExpected) ||
    normalizedExpected.startsWith(normalizedRecord);
}

async function getSessionWireFile(sessionId: string, workDir: string): Promise<string | null> {
  for (const shareDir of candidateKimiShareDirs()) {
    const sessionDir = await findKimiCodeSessionDir(shareDir, workDir, sessionId);
    if (sessionDir) return path.join(sessionDir, "agents", "main", "wire.jsonl");
  }
  return null;
}

async function findSteerRecordInWire(
  wireFile: string,
  expectedText: string,
  startedAt: number,
): Promise<Record<string, unknown> | null> {
  const content = await fs.promises.readFile(wireFile, "utf-8").catch(() => "");
  if (!content) return null;
  const lines = content.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      if (isMatchingSteerRecord(record, expectedText, startedAt)) return record;
    } catch {
      continue;
    }
  }
  return null;
}

function syntheticSteerRecord(input: string | KimiCodePromptPart[], startedAt: number): Record<string, unknown> {
  return {
    type: "turn.steer",
    time: Date.now(),
    input,
    source: "kimix-fallback",
    startedAt,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOfficialSteerRecord(
  sessionId: string,
  workDir: string,
  input: string | KimiCodePromptPart[],
  startedAt: number,
): Promise<Record<string, unknown>> {
  const expectedText = promptInputText(input);
  const deadline = Date.now() + STEER_WIRE_CONFIRM_TIMEOUT_MS;
  let wireFile = await getSessionWireFile(sessionId, workDir);
  while (Date.now() <= deadline) {
    if (!wireFile) wireFile = await getSessionWireFile(sessionId, workDir);
    if (wireFile) {
      const record = await findSteerRecordInWire(wireFile, expectedText, startedAt);
      if (record) return record;
    }
    await delay(STEER_WIRE_CONFIRM_INTERVAL_MS);
  }
  return syntheticSteerRecord(input, startedAt);
}

function attachInteractionHandlers(session: KimiCodeSessionLike) {
  session.setApprovalHandler?.(async (request) => {
    // Full-access (yolo) bound: never bother the user with an approval card when
    // the session is in full-access mode, even if the SDK still routes the
    // request here (e.g. permission drift). Auto-approve for the whole session.
    if (sessions.get(session.id)?.permission === "yolo") {
      return { decision: "approved", scope: "session", selectedLabel: "Allow for session" };
    }
    const requestId = getRequestId(request, "approval");
    const key = pendingKey(session.id, requestId);
    setStatus(session.id, "waiting_approval");
    eventSink?.({
      sessionId: session.id,
      event: { type: "kimix.approval.request", requestId, request },
    });
    return new Promise<KimiCodeApprovalResult>((resolve) => {
      pendingApprovals.set(key, { sessionId: session.id, resolve });
    });
  });

  session.setQuestionHandler?.(async (request) => {
    const requestId = getRequestId(request, "question");
    const key = pendingKey(session.id, requestId);
    setStatus(session.id, "waiting_question");
    eventSink?.({
      sessionId: session.id,
      event: { type: "kimix.question.request", requestId, request },
    });
    return new Promise<KimiCodeQuestionResult>((resolve) => {
      pendingQuestions.set(key, { sessionId: session.id, resolve });
    });
  });
}

function getRequestId(request: unknown, prefix: "approval" | "question") {
  if (request && typeof request === "object") {
    const toolCallId = (request as { toolCallId?: unknown }).toolCallId;
    if (typeof toolCallId === "string" && toolCallId.trim()) return toolCallId;
  }
  nextRequestId += 1;
  return `${prefix}-${Date.now()}-${nextRequestId}`;
}

function pendingKey(sessionId: string, requestId: string) {
  return `${sessionId}:${requestId}`;
}

function settlePendingForSession(sessionId: string, reason: "cancelled" | "closed") {
  for (const [key, pending] of pendingApprovals) {
    if (pending.sessionId !== sessionId) continue;
    pendingApprovals.delete(key);
    pending.resolve({ decision: reason === "cancelled" ? "cancelled" : "rejected" });
  }
  for (const [key, pending] of pendingQuestions) {
    if (pending.sessionId !== sessionId) continue;
    pendingQuestions.delete(key);
    pending.resolve(null);
  }
}

function updateStatusFromEvent(sessionId: string, event: unknown) {
  const type = event && typeof event === "object" ? (event as { type?: unknown }).type : undefined;
  if (type === "turn.started") {
    setStatus(sessionId, "running");
    return;
  }
  if (type === "turn.ended") {
    const reason = (event as { reason?: unknown }).reason;
    setStatus(sessionId, reason === "cancelled" ? "interrupted" : "completed");
    return;
  }
  const loopEvent = getLoopEvent(event);
  if (loopEvent?.type === "step.end" && loopEvent.finishReason === "end_turn") {
    setStatus(sessionId, "completed");
    return;
  }
  if (type === "error") {
    setStatus(sessionId, "error");
  }
}

function setStatus(sessionId: string, status: KimiCodeEngineStatus) {
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    if (serverManaged.status === status) return;
    serverManaged.status = status;
    emitStatus(sessionId, status);
    return;
  }
  const managed = sessions.get(sessionId);
  if (!managed || managed.status === status) return;
  managed.status = status;
  emitStatus(sessionId, status);
}

function emitStatus(sessionId: string, status: KimiCodeEngineStatus) {
  statusSink?.({ sessionId, status });
}

function toEngineSession(session: KimiCodeSessionLike, status: KimiCodeEngineStatus): KimiCodeEngineSession {
  return {
    sessionId: session.id,
    workDir: session.workDir,
    status,
    additionalDirs: session.summary?.additionalDirs ?? [],
  };
}

function getManagedSession(sessionId: string): ManagedSession {
  const managed = sessions.get(sessionId);
  if (!managed) throw new Error(`Kimi Code session is not active: ${sessionId}`);
  return managed;
}

async function getHarness(): Promise<KimiHarnessLike> {
  if (harness) return harness;
  process.env.KIMI_CODE_NO_AUTO_UPDATE = process.env.KIMI_CODE_NO_AUTO_UPDATE || "1";
  process.env.KIMI_CLI_NO_AUTO_UPDATE = process.env.KIMI_CLI_NO_AUTO_UPDATE || "1";
  const sdk = await loadSdk();
  installNonVisionFetchInterceptor();
  const options = {
    homeDir: process.env.KIMI_CODE_HOME,
    identity: {
      userAgentProduct: "kimi-code-cli",
      version: process.env.KIMI_CODE_SMOKE_VERSION ?? process.env.npm_package_version ?? "0.0.0",
    },
    uiMode: "kimix",
  };
  if (sdk.createKimiHarness) {
    harness = sdk.createKimiHarness(options);
  } else if (sdk.KimiHarness) {
    harness = new sdk.KimiHarness(options);
  } else {
    throw new Error("Official Kimi Code SDK does not export KimiHarness/createKimiHarness.");
  }
  return harness;
}

async function loadSdk(): Promise<KimiCodeSdkModule> {
  const sdkEntry = resolveSdkEntry();
  try {
    return await import(pathToFileURL(sdkEntry).href) as KimiCodeSdkModule;
  } catch (error) {
    throw new Error(`Failed to load official Kimi Code SDK from ${sdkEntry}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveSdkEntry(): string {
  // Primary source is the vendored, self-contained bundle that ships with Kimix
  // (vendor/kimi-code-sdk/index.mjs). See vendor/kimi-code-sdk/README.md for why the
  // official SDK is vendored instead of taken from npm. The %TEMP% research-repo
  // paths and KIMIX_KIMI_CODE_SDK_ENTRY are kept only as local-dev fallbacks for
  // people iterating on the SDK source.
  const vendoredRel = path.join("vendor", "kimi-code-sdk", "index.mjs");

  // app.getAppPath() = project root in dev, …/resources/app.asar when packaged.
  // process.resourcesPath = …/resources, where electron-builder copies extraResources.
  let appPath: string | undefined;
  try {
    appPath = app?.getAppPath?.();
  } catch {
    // app may be unavailable in non-Electron contexts; fall through to other candidates.
  }

  const candidates = [
    process.env.KIMIX_KIMI_CODE_SDK_ENTRY,
    process.resourcesPath ? path.join(process.resourcesPath, vendoredRel) : undefined,
    appPath ? path.join(appPath, vendoredRel) : undefined,
    // Dev-only fallbacks: load straight from a local research checkout's build output.
    path.join(os.homedir(), "AppData", "Local", "Temp", "kimix-kimi-code-research", "packages", "node-sdk", "dist", "index.mjs"),
    path.join(os.tmpdir(), "kimix-kimi-code-research", "packages", "node-sdk", "dist", "index.mjs"),
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate)) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        // Continue to the next candidate.
      }
    }
  }

  throw new Error(
    "Official Kimi Code SDK bundle was not found. Expected the vendored bundle at vendor/kimi-code-sdk/index.mjs " +
      "(regenerate with `node scripts/vendor-kimi-code-sdk.mjs`), or set KIMIX_KIMI_CODE_SDK_ENTRY for local dev.",
  );
}
