import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app } from "electron";
import { candidateKimiShareDirs, findKimiCodeSessionDir, readKimiCodeSessionMetadata } from "./sessionHistory";

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
  resumeSession(input: { id: string }): Promise<KimiCodeSessionLike>;
  forkSession?(input: { id: string; forkId?: string; title?: string; metadata?: JsonObject }): Promise<KimiCodeSessionLike>;
  renameSession?(input: { id: string; title: string }): Promise<void>;
  listSessions(options?: { workDir?: string; sessionId?: string }): Promise<KimiCodeSessionSummary[]>;
  exportSession(input: KimiCodeExportSessionInput): Promise<KimiCodeExportSessionResult>;
  getConfig(options?: { reload?: boolean }): Promise<KimiCodeConfig>;
  getConfigDiagnostics?(): Promise<KimiCodeConfigDiagnostics>;
  setConfig(patch: KimiCodeConfigPatch): Promise<KimiCodeConfig>;
  close(): Promise<void>;
};

type KimiCodeConfigDiagnostics = {
  warnings?: string[];
};

type KimiCodeSessionLike = {
  id: string;
  workDir: string;
  prompt(input: string | KimiCodePromptPart[]): Promise<void>;
  steer(input: string | KimiCodePromptPart[]): Promise<void>;
  swarm?(input: string | KimiCodePromptPart[]): Promise<void>;
  setSwarmMode?(enabled: boolean, trigger?: "manual" | "task"): Promise<void>;
  reloadSession?(): Promise<unknown>;
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
  createGoal?(input: KimiCodeCreateGoalInput): Promise<KimiCodeGoalSnapshot>;
  getGoal?(): Promise<KimiCodeGoalState>;
  pauseGoal?(input?: { reason?: string }): Promise<KimiCodeGoalSnapshot>;
  resumeGoal?(input?: { reason?: string }): Promise<KimiCodeGoalSnapshot>;
  cancelGoal?(input?: { reason?: string }): Promise<KimiCodeGoalSnapshot>;
  listSkills?(): Promise<readonly KimiCodeSkillSummary[]>;
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
};

export type KimiCodeEngineSession = {
  sessionId: string;
  workDir: string;
  status: KimiCodeEngineStatus;
};

export type KimiCodeSessionSummary = {
  id: string;
  title?: string;
  lastPrompt?: string;
  workDir: string;
  sessionDir: string;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
  metadata?: JsonObject;
};

export type KimiCodeSessionStatus = {
  model?: string;
  thinkingLevel?: string;
  permission?: KimiCodePermissionMode;
  planMode?: boolean;
  contextTokens?: number;
  maxContextTokens?: number;
  contextUsage?: number;
  usage?: unknown;
};

export type KimiCodeSessionUsage = Record<string, unknown>;

export type KimiCodeMcpServerInfo = {
  name: string;
  transport: "stdio" | "http";
  status: "pending" | "connected" | "failed" | "disabled" | "needs-auth";
  toolCount: number;
  error?: string;
};

export type KimiCodeMcpStartupMetrics = {
  durationMs: number;
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
  permission: KimiCodePermissionMode;
  unsubscribe: () => void;
  hiddenAgentIds: Set<string>;
  btwRuns: Map<string, BtwRun>;
};

type BtwRun = {
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
const pendingApprovals = new Map<string, PendingApproval>();
const pendingQuestions = new Map<string, PendingQuestion>();
let eventSink: EventSink | null = null;
let statusSink: StatusSink | null = null;

const STEER_WIRE_CONFIRM_TIMEOUT_MS = 15_000;
const STEER_WIRE_CONFIRM_INTERVAL_MS = 120;
let nextRequestId = 0;
let activeLoginAbort: AbortController | null = null;
const KIMI_CODE_MANAGED_PROVIDER_NAME = "managed:kimi-code";

export function setKimiCodeEventSink(sink: EventSink | null) {
  eventSink = sink;
}

export function setKimiCodeStatusSink(sink: StatusSink | null) {
  statusSink = sink;
}

export async function createSession(options: CreateKimiCodeSessionOptions): Promise<KimiCodeEngineSession> {
  const sdkHarness = await getHarness();
  const session = await sdkHarness.createSession(options);
  return registerSession(session, "idle", options.permission ?? "manual");
}

export async function resumeSession(sessionId: string): Promise<KimiCodeEngineSession> {
  const existing = sessions.get(sessionId);
  if (existing) return toEngineSession(existing.session, existing.status);

  const sdkHarness = await getHarness();
  const session = await sdkHarness.resumeSession({ id: sessionId });
  // The resumed session keeps whatever permission it was persisted with; read it
  // back from the SDK so the yolo auto-approve guard reflects reality until the
  // caller re-applies the UI permission mode via setPermission().
  let resumedPermission: KimiCodePermissionMode = "manual";
  try {
    const status = await session.getStatus();
    if (status.permission === "manual" || status.permission === "auto" || status.permission === "yolo") {
      resumedPermission = status.permission;
    }
  } catch {
    // Best effort: fall back to "manual" if the status read fails.
  }
  return registerSession(session, "idle", resumedPermission);
}

export async function forkSession(
  sessionId: string,
  options: { forkId?: string; title?: string; metadata?: JsonObject } = {},
): Promise<KimiCodeEngineSession> {
  const sdkHarness = await getHarness();
  if (!sdkHarness.forkSession) throw new Error("当前 Kimi Code SDK 不支持会话派生。");
  const session = await sdkHarness.forkSession({
    id: sessionId,
    forkId: options.forkId,
    title: options.title,
    metadata: options.metadata,
  });
  let forkPermission: KimiCodePermissionMode = "manual";
  try {
    const status = await session.getStatus();
    if (status.permission === "manual" || status.permission === "auto" || status.permission === "yolo") {
      forkPermission = status.permission;
    }
  } catch {
    // Best effort: keep the fork usable even if status hydration is unavailable.
  }
  return registerSession(session, "idle", forkPermission);
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  const sdkHarness = await getHarness();
  if (!sdkHarness.renameSession) throw new Error("当前 Kimi Code SDK 不支持会话重命名。");
  await sdkHarness.renameSession({ id: sessionId, title });
}

export async function reloadSession(sessionId: string): Promise<void> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.reloadSession) throw new Error("当前 Kimi Code SDK 不支持会话重载。");
  await managed.session.reloadSession();
}

export async function setModel(sessionId: string, model: string): Promise<void> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.setModel) throw new Error("当前 Kimi Code SDK 不支持会话模型切换。");
  await managed.session.setModel(model);
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

export async function sendPrompt(sessionId: string, input: string | KimiCodePromptPart[]): Promise<void> {
  const managed = getManagedSession(sessionId);
  setStatus(sessionId, "running");
  try {
    await managed.session.prompt(input);
  } catch (error) {
    setStatus(sessionId, "error");
    throw error;
  }
}

export async function setSwarmMode(sessionId: string, enabled: boolean, trigger: "manual" | "task" = "manual"): Promise<void> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.setSwarmMode) throw new Error("当前 Kimi Code SDK 不支持 Swarm 模式。");
  await managed.session.setSwarmMode(enabled, trigger);
}

export async function swarm(sessionId: string, input: string | KimiCodePromptPart[]): Promise<void> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.swarm) throw new Error("当前 Kimi Code SDK 不支持 Swarm。");
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
  const managed = getManagedSession(sessionId);
  if (!managed.session.startBtw) throw new Error("当前 Kimi Code SDK 不支持 BTW 侧问。");
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
  const managed = getManagedSession(sessionId);
  if (!managed.session.undoHistory) throw new Error("Official Kimi Code SDK does not expose undoHistory on this session");
  await managed.session.undoHistory(count);
}

export async function cancel(sessionId: string): Promise<void> {
  const managed = getManagedSession(sessionId);
  settlePendingForSession(sessionId, "cancelled");
  await managed.session.cancel();
}

export async function setPlanMode(sessionId: string, enabled: boolean): Promise<void> {
  const managed = getManagedSession(sessionId);
  await managed.session.setPlanMode(enabled);
}

export async function setThinking(sessionId: string, level: string): Promise<void> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.setThinking) throw new Error("Official Kimi Code SDK does not expose setThinking on this session");
  await managed.session.setThinking(level);
}

export async function setPermission(sessionId: string, mode: KimiCodePermissionMode): Promise<void> {
  const managed = getManagedSession(sessionId);
  await managed.session.setPermission(mode);
  managed.permission = mode;
}

export async function compactSession(sessionId: string, instruction?: string): Promise<void> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.compact) throw new Error("Official Kimi Code SDK does not expose compact on this session");
  await managed.session.compact(instruction ? { instruction } : undefined);
}

export async function createGoal(sessionId: string, input: KimiCodeCreateGoalInput): Promise<KimiCodeGoalState> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.createGoal) throw new Error("当前 Kimi Code SDK 不支持官方 Goal。");
  const goal = await managed.session.createGoal(input);
  return { goal };
}

export async function getGoal(sessionId: string): Promise<KimiCodeGoalState> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.getGoal) throw new Error("当前 Kimi Code SDK 不支持官方 Goal。");
  return managed.session.getGoal();
}

export async function pauseGoal(sessionId: string, reason?: string): Promise<KimiCodeGoalState> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.pauseGoal) throw new Error("当前 Kimi Code SDK 不支持官方 Goal。");
  const goal = await managed.session.pauseGoal({ reason });
  return { goal };
}

export async function resumeGoal(sessionId: string, reason?: string): Promise<KimiCodeGoalState> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.resumeGoal) throw new Error("当前 Kimi Code SDK 不支持官方 Goal。");
  const goal = await managed.session.resumeGoal({ reason });
  return { goal };
}

export async function cancelGoal(sessionId: string, reason?: string): Promise<KimiCodeGoalState> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.cancelGoal) throw new Error("当前 Kimi Code SDK 不支持官方 Goal。");
  const goal = await managed.session.cancelGoal({ reason });
  return { goal: null, cancelledGoal: goal };
}

export async function getStatus(sessionId: string): Promise<KimiCodeSessionStatus> {
  const managed = getManagedSession(sessionId);
  return managed.session.getStatus();
}

export async function getUsage(sessionId: string): Promise<KimiCodeSessionUsage> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.getUsage) throw new Error("Official Kimi Code SDK does not expose getUsage on this session");
  return managed.session.getUsage();
}

export async function getManagedUsage(providerName?: string): Promise<unknown> {
  const sdkHarness = await getHarness();
  if (!sdkHarness.auth?.getManagedUsage) throw new Error("Official Kimi Code SDK does not expose auth.getManagedUsage on this harness");
  return sdkHarness.auth.getManagedUsage(providerName);
}

export async function login(
  providerName = KIMI_CODE_MANAGED_PROVIDER_NAME,
  options: { onDeviceCode?: (data: KimiCodeDeviceAuthorization) => void } = {},
): Promise<KimiCodeLoginResult> {
  const sdkHarness = await getHarness();
  if (!sdkHarness.auth?.login) throw new Error("Official Kimi Code SDK does not expose auth.login on this harness");
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
  const managed = getManagedSession(sessionId);
  if (!managed.session.listMcpServers) throw new Error("Official Kimi Code SDK does not expose listMcpServers on this session");
  return [...await managed.session.listMcpServers()];
}

export async function getMcpStartupMetrics(sessionId: string): Promise<KimiCodeMcpStartupMetrics> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.getMcpStartupMetrics) throw new Error("Official Kimi Code SDK does not expose getMcpStartupMetrics on this session");
  return managed.session.getMcpStartupMetrics();
}

export async function reconnectMcpServer(sessionId: string, name: string): Promise<void> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.reconnectMcpServer) throw new Error("Official Kimi Code SDK does not expose reconnectMcpServer on this session");
  await managed.session.reconnectMcpServer(name);
}

export async function listBackgroundTasks(sessionId: string, options: { activeOnly?: boolean; limit?: number } = {}): Promise<KimiCodeBackgroundTaskInfo[]> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.listBackgroundTasks) throw new Error("Official Kimi Code SDK does not expose listBackgroundTasks on this session");
  return [...await managed.session.listBackgroundTasks(options)];
}

export async function getBackgroundTaskOutput(sessionId: string, taskId: string, options: { tail?: number } = {}): Promise<string> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.getBackgroundTaskOutput) throw new Error("Official Kimi Code SDK does not expose getBackgroundTaskOutput on this session");
  return managed.session.getBackgroundTaskOutput(taskId, options);
}

export async function getBackgroundTaskOutputPath(sessionId: string, taskId: string): Promise<string | undefined> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.getBackgroundTaskOutputPath) throw new Error("Official Kimi Code SDK does not expose getBackgroundTaskOutputPath on this session");
  return managed.session.getBackgroundTaskOutputPath(taskId);
}

export async function stopBackgroundTask(sessionId: string, taskId: string, reason?: string): Promise<void> {
  const managed = getManagedSession(sessionId);
  if (!managed.session.stopBackgroundTask) throw new Error("Official Kimi Code SDK does not expose stopBackgroundTask on this session");
  await managed.session.stopBackgroundTask(taskId, reason ? { reason } : {});
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

function resolvePluginSession(sessionId?: string): Promise<KimiCodeSessionLike> | KimiCodeSessionLike {
  if (sessionId) return getManagedSession(sessionId).session;
  return getOrCreatePluginSession();
}

export async function listPlugins(sessionId?: string): Promise<KimiCodePluginSummary[]> {
  const session = await resolvePluginSession(sessionId);
  if (!session.listPlugins) throw new Error("Official Kimi Code SDK does not expose listPlugins on this session");
  return [...await session.listPlugins()];
}

export async function listSkills(sessionId?: string): Promise<KimiCodeSkillSummary[]> {
  const session = await resolvePluginSession(sessionId);
  if (!session.listSkills) throw new Error("Official Kimi Code SDK does not expose listSkills on this session");
  return [...await session.listSkills()];
}

export async function installPlugin(source: string, sessionId?: string): Promise<KimiCodePluginSummary> {
  const session = await resolvePluginSession(sessionId);
  if (!session.installPlugin) throw new Error("Official Kimi Code SDK does not expose installPlugin on this session");
  return session.installPlugin(source);
}

export async function setPluginEnabled(id: string, enabled: boolean, sessionId?: string): Promise<void> {
  const session = await resolvePluginSession(sessionId);
  if (!session.setPluginEnabled) throw new Error("Official Kimi Code SDK does not expose setPluginEnabled on this session");
  await session.setPluginEnabled(id, enabled);
}

export async function setPluginMcpServerEnabled(id: string, server: string, enabled: boolean, sessionId?: string): Promise<void> {
  const session = await resolvePluginSession(sessionId);
  if (!session.setPluginMcpServerEnabled) throw new Error("Official Kimi Code SDK does not expose setPluginMcpServerEnabled on this session");
  await session.setPluginMcpServerEnabled(id, server, enabled);
}

export async function listSessions(workDir?: string): Promise<KimiCodeSessionSummary[]> {
  const sdkHarness = await getHarness();
  const sessions = [...await sdkHarness.listSessions(workDir ? { workDir } : {})];
  // SDK may return empty title/lastPrompt; backfill from state.json if available.
  for (const session of sessions) {
    if (session.title?.trim() && session.lastPrompt?.trim()) continue;
    try {
      const metadata = readKimiCodeSessionMetadata(session.sessionDir);
      if (!session.title?.trim() && metadata?.title?.trim()) {
        session.title = metadata.title.trim();
      }
      if (!session.lastPrompt?.trim() && metadata?.lastPrompt?.trim()) {
        session.lastPrompt = metadata.lastPrompt.trim();
      }
    } catch {
      // ignore unreadable metadata
    }
  }
  return sessions;
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
  return sdkHarness.setConfig(patch);
}

function normalizeCatalogMaxContextSize(providerId: string, baseUrl: string | null, modelId: string, value: number | null) {
  const fallback = 262144;
  const input = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const signature = `${providerId} ${baseUrl ?? ""} ${modelId}`.toLowerCase();
  const limit = signature.includes("deepseek") ? 65536 : 1048576;
  return Math.max(1, Math.min(limit, input));
}

export async function listProviderCatalog(): Promise<KimiCodeProviderCatalogEntry[]> {
  const sdk = await loadSdk();
  if (!sdk.fetchCatalog || !sdk.inferWireType || !sdk.catalogProviderModels || !sdk.catalogBaseUrl) {
    throw new Error("当前 Kimi Code SDK 未暴露 Provider catalog API");
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
            maxContextSize: normalizeCatalogMaxContextSize(providerId, baseUrl, model.id, rawMaxContextSize),
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
  const managed = sessions.get(sessionId);
  if (!managed) return;
  sessions.delete(sessionId);
  settlePendingForSession(sessionId, "cancelled");
  managed.unsubscribe();
  await managed.session.close();
}

export async function closeAllSessions(): Promise<void> {
  await Promise.all([...sessions.keys()].map((sessionId) => closeSession(sessionId).catch(() => {})));
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
  return sessions.get(sessionId)?.session.workDir;
}

export function getActiveSessionIds(): string[] {
  return [...sessions.keys()];
}

export function respondApproval(
  sessionId: string,
  requestId: string,
  approved: boolean,
  scope?: "once" | "session",
  feedback?: string,
): void {
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
  const key = pendingKey(sessionId, requestId);
  const pending = pendingQuestions.get(key);
  if (!pending) throw new Error(`Kimi Code question request is not pending: ${requestId}`);
  pendingQuestions.delete(key);
  setStatus(sessionId, "running");
  pending.resolve(skipped ? null : { answers, method: "enter" });
}

function registerSession(session: KimiCodeSessionLike, initialStatus: KimiCodeEngineStatus, permission: KimiCodePermissionMode): KimiCodeEngineSession {
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
  const managed: ManagedSession = { session, status: initialStatus, permission, unsubscribe, hiddenAgentIds, btwRuns };
  sessions.set(session.id, managed);
  emitStatus(session.id, initialStatus);
  return toEngineSession(session, initialStatus);
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
