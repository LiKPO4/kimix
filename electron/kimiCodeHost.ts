import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { app } from "electron";
import { candidateKimiShareDirs, findKimiCodeSessionDir, getFirstUserMessage, readKimiCodeSessionMetadata } from "./sessionHistory";
import { collectOwnProcessIds, parseWin32ProcessTable } from "./win32ProcessTree";
import { installNonVisionFetchInterceptor } from "./nonVisionFetchInterceptor";
import { resolveCatalogModelMetadata } from "./providerEffortProbe";
import { kimiCodeServerHost } from "./kimiCodeServerHost";
import { genericAttachmentMediaType, MAX_GENERIC_ATTACHMENT_BYTES, safeGenericAttachmentName } from "./kimiCodeFileAttachments";
import { setTomlSectionValuePreservingLayout } from "../src/utils/tomlSectionEditor";
import {
  buildExperimentalFeatureConfigPatch,
  type KimiCodeExperimentalFeatureId,
} from "./kimiCodeExperimentalFeatures";

import { normalizePathForComparison } from "../src/utils/pathCase";
import { parseOfficialRoomMetadata, selectExistingRoomSession } from "./roomSessionMetadata";
import { KimiCodeStatusSequencer } from "./kimiCodeStatusSequencer";
import { findOfficialCompactionResult, type OfficialCompactionResult } from "./compactionWire";
import type { KimiCodeCapabilityStatus } from "./types/ipc";
import { waitForOfficialSteerUserMessage } from "./steerConfirm";
import { isDaemonLevelPromoteError, PromoteFailureBackoff } from "./kimiCodePromotePolicy";
import { forgetSessionState, type SessionScopedState } from "./kimiCodeSessionState";
import { resolveRuntimeThinkingEffort } from "./kimiCodeRuntimePolicy";
import {
  classifyServerSessionActivity,
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
  type ServerBackgroundTask,
  type ServerMcpServer,
  type ServerOAuthFlow,
  type ServerSession,
  type ServerSkill,
  type ServerSessionStatus,
  type ServerSnapshot,
  type ServerTerminal,
} from "./kimiCodeServerClient";

type JsonObject = Record<string, unknown>;

type KimiCodeHostIdentity = {
  productName: string;
  version: string;
  platform: string;
  userAgentSuffix?: string;
};

type KimiCodeSdkModule = {
  KimiHarness?: new (options: {
    homeDir?: string;
    identity?: KimiCodeHostIdentity;
    uiMode?: string;
    skillDirs?: readonly string[];
  }) => KimiHarnessLike;
  createKimiHarness?: (options: {
    homeDir?: string;
    identity?: KimiCodeHostIdentity;
    uiMode?: string;
    skillDirs?: readonly string[];
  }) => KimiHarnessLike;
  // v2 引擎（SDKRpcClientV2）：与 v1 同一 KimiHarness 类型面、写同一份会话存储，
  // 行为细节差异见 getHarness 注释。
  createKimiHarnessV2?: (options: {
    homeDir?: string;
    identity?: KimiCodeHostIdentity;
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
  reloadSession?(input: { id: string; forcePluginSessionStartReminder?: boolean }): Promise<KimiCodeSessionLike>;
  // 官方内置能力（kimi-cu / kimi-webbridge）：仅 v2 引擎提供，v1 抛 TypeError。
  listCapabilities?(): Promise<readonly KimiCodeCapabilityStatus[]>;
  installCapability?(id: string): Promise<KimiCodeCapabilityStatus>;
  close(): Promise<void>;
};

type KimiCodeConfigDiagnostics = {
  warnings?: string[];
};

type KimiCodeSessionLike = {
  id: string;
  workDir: string;
  summary?: KimiCodeSessionSummary;
  prompt(input: string | KimiCodePromptPart[], options?: { promptId?: string }): Promise<void>;
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
  listPluginCommands?(): Promise<readonly KimiCodePluginCommandSummary[]>;
  activatePluginCommand?(pluginId: string, commandName: string, args?: string): Promise<void>;
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
  | { type: "image_url"; imageUrl: { url: string; id?: string } }
  | { type: "video_url"; videoUrl: { url?: string; id?: string; fileId?: string } }
  | {
      type: "file";
      file: {
        name: string;
        filePath?: string;
        fileId?: string;
        mediaType?: string;
        size?: number;
      };
    };

export type KimiCodeEngineStatus =
  | "idle"
  | "unknown"
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
  model?: string;
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
  lastTurnReason?: string;
  source?: "server" | "sdk";
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
  swarmMode?: boolean;
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
  status: "pending" | "connected" | "failed" | "disabled" | "needs-auth" | "removed";
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
    active?: boolean;
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
  agents: Array<{
    agentId: string;
    kind?: string;
    subagentType?: string;
    description?: string;
    status?: string;
    parentToolCallId?: string;
    runInBackground?: boolean;
    createdAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    disposedObservedAt: string | null;
  }>;
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
  /** 官方 Server 直接导出（POST /sessions/:id/export）返回的 ZIP 字节流。 */
  zip?: Buffer;
  /** 导出来源：server = 官方 Server 链路；sdk = 兼容 SDK 链路。 */
  source?: "server" | "sdk";
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

export type KimiCodeConfig = {
  providers?: Record<string, KimiCodeProviderConfig>;
  defaultProvider?: string;
  defaultModel?: string;
  models?: Record<string, KimiCodeModelAlias>;
  secondaryModel?: {
    model?: string;
    defaultEffort?: string;
  };
  experimental?: Record<string, boolean>;
  thinking?: {
    mode?: "auto" | "on" | "off";
    enabled?: boolean;
    effort?: string;
  };
  defaultThinking?: boolean;
  extraSkillDirs?: string[];
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

// ===== config.toml [secondary_model] 写前校验与重写（纯函数，main.ts 与单测共用）=====
// main.ts 模块级副作用较多、无法被 vitest 直接导入，secondary_model 段的校验与
// 重写逻辑抽到这里保持可测；以下 TOML 工具与 main.ts 内私有实现逐行保持一致。

function unescapeTomlString(value: string) {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function escapeTomlString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function toTomlTableKey(name: string) {
  return /^[A-Za-z0-9_-]+$/.test(name) ? name : `"${escapeTomlString(name)}"`;
}

function readTomlSectionBody(raw: string, sectionName: string) {
  const sectionPattern = /^\s*\[([^\]]+)\]\s*$/gm;
  const matches = Array.from(raw.matchAll(sectionPattern));
  const matchIndex = matches.findIndex((match) => match[1].trim() === sectionName);
  if (matchIndex < 0) return null;
  const match = matches[matchIndex];
  return raw.slice((match.index ?? 0) + match[0].length, matches[matchIndex + 1]?.index ?? raw.length);
}

function readTomlStringArray(sectionText: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sectionText.match(new RegExp(`^\\s*${escaped}\\s*=\\s*\\[([^\\]]*)\\]\\s*$`, "m"));
  if (!match) return null;
  return Array.from(match[1].matchAll(/"((?:\\.|[^"])*)"/g)).map((item) => unescapeTomlString(item[1]));
}

function removeTomlSection(raw: string, sectionName: string) {
  const sectionPattern = /^\s*\[([^\]]+)\]\s*$/gm;
  const matches = Array.from(raw.matchAll(sectionPattern));
  // Remove ALL matching sections, not just the first, so duplicate writes do
  // not accumulate.
  const targetIndexes: number[] = [];
  matches.forEach((match, index) => {
    if (match[1].trim() === sectionName) targetIndexes.push(index);
  });
  if (targetIndexes.length === 0) return raw;
  let result = raw;
  // Process from last to first so indexes stay valid.
  for (let i = targetIndexes.length - 1; i >= 0; i--) {
    const matchIndex = targetIndexes[i];
    const start = matches[matchIndex].index ?? 0;
    const end = matches[matchIndex + 1]?.index ?? result.length;
    const before = result.slice(0, start).trimEnd();
    const after = result.slice(end).trimStart();
    result = `${before}${before && after ? "\n\n" : ""}${after}`;
  }
  return result;
}

// 写前校验：先按 Provider 协议规范化档位（OpenAI max→xhigh），再以模型在
// config.toml 中声明的 support_efforts 校验；无法回到声明集合时提前抛出中文错误。
// 模型无 support_efforts 声明、或未同时提供 model 与 defaultEffort 时只做协议规范化。
export function assertSecondaryModelEffortDeclared(rawConfigToml: string, modelAlias: string | null, defaultEffort: string | null) {
  if (!modelAlias || !defaultEffort) return defaultEffort;
  const body = readTomlSectionBody(rawConfigToml, `models.${toTomlTableKey(modelAlias)}`);
  if (!body) return defaultEffort;
  const providerName = readTomlString(body, "provider");
  const providerBody = providerName
    ? readTomlSectionBody(rawConfigToml, `providers.${toTomlTableKey(providerName)}`)
    : null;
  const providerType = providerBody ? readTomlString(providerBody, "type") : null;
  const supportEfforts = readTomlStringArray(body, "support_efforts");
  const resolved = resolveRuntimeThinkingEffort({
    requestedEffort: defaultEffort,
    supportEfforts,
    defaultEffort,
    providerType,
  });
  if (supportEfforts && supportEfforts.length > 0 && resolved.reason === "first-supported") {
    throw new Error(`模型 ${modelAlias} 未声明思考档位 "${defaultEffort}"（可用：${supportEfforts.join("、")}）`);
  }
  return resolved.effort ?? defaultEffort;
}

function normalizedSecondarySupportEfforts(rawConfigToml: string, modelAlias: string | null, resolvedDefaultEffort: string | null) {
  if (!modelAlias || !resolvedDefaultEffort) return null;
  const body = readTomlSectionBody(rawConfigToml, `models.${toTomlTableKey(modelAlias)}`);
  if (!body) return null;
  const supportEfforts = readTomlStringArray(body, "support_efforts");
  if (!supportEfforts || supportEfforts.length === 0) return null;
  const providerName = readTomlString(body, "provider");
  const providerBody = providerName
    ? readTomlSectionBody(rawConfigToml, `providers.${toTomlTableKey(providerName)}`)
    : null;
  const providerType = providerBody ? readTomlString(providerBody, "type") : null;
  const normalized = Array.from(new Set(supportEfforts.map((effort) => (
    resolveRuntimeThinkingEffort({ requestedEffort: effort, providerType }).effort ?? effort
  ))));
  return normalized.includes(resolvedDefaultEffort) ? normalized : null;
}

function readTomlString(sectionText: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sectionText.match(new RegExp(`^\\s*${escaped}\\s*=\\s*"((?:\\\\.|[^"])*)"\\s*$`, "m"));
  return match ? unescapeTomlString(match[1]) : null;
}

// 校验 + 重写 config.toml 文本并返回新内容；校验失败抛错时调用方不得写盘。
export function applySecondaryModelConfigToml(raw: string, model: string | null, defaultEffort: string | null) {
  const resolvedDefaultEffort = assertSecondaryModelEffortDeclared(raw, model, defaultEffort);
  const resolvedSupportEfforts = normalizedSecondarySupportEfforts(raw, model, resolvedDefaultEffort);
  // Remove ALL existing [secondary_model] sections first (prior writes may have
  // left duplicates with non-standard formatting that the TOML editor cannot
  // match), then write a single clean section if needed.
  let next = removeTomlSection(raw, "secondary_model");
  // Also strip any malformed inline-section remnants like `[secondary_model]key = ...`
  next = next.replace(/^\s*\[secondary_model\][^\n]*$/gm, "");
  next = next.replace(/\n{3,}/g, "\n\n");
  if (model || resolvedDefaultEffort) {
    const newline = next.includes("\r\n") ? "\r\n" : "\n";
    const lines: string[] = [`[secondary_model]`];
    if (model) lines.push(`model = "${escapeTomlString(model)}"`);
    if (resolvedSupportEfforts && resolvedDefaultEffort !== defaultEffort) {
      lines.push(`support_efforts = [ ${resolvedSupportEfforts.map((effort) => `"${escapeTomlString(effort)}"`).join(", ")} ]`);
    }
    if (resolvedDefaultEffort) lines.push(`default_effort = "${escapeTomlString(resolvedDefaultEffort)}"`);
    const base = next.trimEnd();
    next = `${base}${base ? `${newline}${newline}` : ""}${lines.join(newline)}${newline}`;
  }
  // Kimi Code 0.31+ allows experimental flags to be persisted. This makes the
  // same secondary-model recipe effective in an externally launched `kimi web`
  // process, which does not inherit Kimix's managed-process environment.
  if (model) {
    next = setTomlSectionValuePreservingLayout(next, "experimental", "secondary-model", "true");
  }
  return next;
}

export type KimiCodeCatalogModel = {
  id: string;
  name?: string;
  maxOutputSize?: number;
  reasoningKey?: string;
  supportEfforts?: string[];
  offEffort?: string;
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
    supportEfforts?: string[];
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
  metadata?: JsonObject;
  unsubscribe: () => void;
  hiddenAgentIds: Set<string>;
  btwRuns: Map<string, BtwRun>;
};

// agent.created/disposed 帧无官方时间戳，记录主进程本地观测时间用于归属审计
type ServerAgentLifecycle = {
  createdObservedAt?: string;
  disposedObservedAt?: string;
};

type ServerManagedSession = {
  session: ServerSession;
  workDir: string;
  status: KimiCodeEngineStatus;
  mainTurnActive?: boolean;
  model?: string;
  modelRevision: number;
  modelMutation?: Promise<void>;
  thinking?: string;
  permission: KimiCodePermissionMode;
  planMode: boolean;
  swarmMode: boolean;
  additionalDirs: readonly string[];
  metadata?: JsonObject;
  btwRuns: Map<string, BtwRun>;
  agentLifecycle: Map<string, ServerAgentLifecycle>;
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
// 同指纹 snapshot（as_of_seq/epoch/inFlight/条数均不变）不重放历史帧：idle 90s 重连与探针
// 恢复会反复拿到同一快照，每次重放数十个 turn.ended 进渲染管线（diag 实测 4700 次
// 重复投递、单批 2ms 内数十帧），对大会话是周期性卡顿 bursts，纯浪费。
const snapshotReplayFingerprints = new Map<string, string>();
// 增量重放：按上一次 snapshot 最新消息 id 切片，只重放新增历史消息 + in_flight，
// 全量 100 条历史合成帧（50+ turn.ended）灌入渲染管线造成大会话卡死与状态错位。
const lastSnapshotLatestMessageIds = new Map<string, string>();
const serverQuestionIds = new Set<string>();

function resolveMigratedSessionId(sessionId: string): string {
  return serverSessionMigrations.get(sessionId) ?? sessionId;
}

function recordServerSessionMigration(serverSessionId: string, sdkSessionId: string): void {
  serverSessionMigrations.set(serverSessionId, sdkSessionId);
}

function cleanupSessionMigrationEntries(sessionId: string): void {
  // 迁移映射键是旧 Server 会话 id；关闭的是迁移后的 SDK 会话 id 或旧 id，双向清理。
  for (const [serverId, sdkId] of serverSessionMigrations) {
    if (serverId === sessionId || sdkId === sessionId) serverSessionMigrations.delete(serverId);
  }
}

const serverQuestionRequests = new Map<string, Record<string, unknown>>();
// 会话关闭/删除时统一清理的按会话作用域状态表（清理逻辑见 kimiCodeSessionState.ts）。
const sessionScopedState: SessionScopedState = {
  fingerprintBySession: snapshotReplayFingerprints,
  latestMessageIdBySession: lastSnapshotLatestMessageIds,
  approvalKeys: serverApprovalIds,
  questionKeys: serverQuestionIds,
  questionRequests: serverQuestionRequests,
};
let serverClient: KimiCodeServerClient | null = null;
let unsubscribeServerFrames: (() => void) | null = null;
let serverRecoveryPromise: Promise<void> | null = null;
let nextServerRecoveryAt = 0;
const pendingApprovals = new Map<string, PendingApproval>();
const pendingQuestions = new Map<string, PendingQuestion>();
let eventSink: EventSink | null = null;
let statusSink: StatusSink | null = null;
const statusSequencer = new KimiCodeStatusSequencer((sessionId, status) => setStatus(sessionId, status));
// 上下文缓存过期提醒（上游 0.34.0 #2646）：每会话最后一次 LLM 轮次完成时间。
// 只有终态帧计入：turn.ended / prompt.completed，以及压缩终态的两套名字——
// emit 事件 compaction.completed/cancelled 与 wire 记录 full_compaction.complete/cancel
// （compactSession 直接读 wire 文件拿到的是记录名）；blocked 不计入（压缩未执行）。
// 快照重放帧（payload.snapshotReplay，含合成失败终态帧）不计入，避免污染闲置计时；closeSession 时清理。
const lastTurnCompletedAt = new Map<string, number>();

function eventTypeOf(event: unknown): unknown {
  return event && typeof event === "object" ? (event as { type?: unknown }).type : undefined;
}

export function isTurnCompletionEventType(type: unknown): boolean {
  return type === "turn.ended" || type === "prompt.completed" ||
    type === "compaction.completed" || type === "compaction.cancelled" ||
    type === "full_compaction.complete" || type === "full_compaction.cancel";
}

/** 快照重放帧（含合成失败终态帧）不得计入轮次活动。 */
export function isSnapshotReplayFrame(frame: { payload?: unknown }): boolean {
  const payload = frame.payload;
  return typeof payload === "object" && payload !== null &&
    typeof (payload as { snapshotReplay?: unknown }).snapshotReplay === "string";
}

function recordTurnCompletion(sessionId: string): void {
  const now = Date.now();
  const previous = lastTurnCompletedAt.get(sessionId) ?? 0;
  if (now <= previous) return;
  lastTurnCompletedAt.set(sessionId, now);
  eventSink?.({ sessionId, event: { type: "kimix.turn.activity", lastActiveAt: now } });
}


const STEER_WIRE_CONFIRM_TIMEOUT_MS = 15_000;
const STEER_WIRE_CONFIRM_INTERVAL_MS = 120;
const COMPACTION_WIRE_CONFIRM_TIMEOUT_MS = 10 * 60 * 1000;
const COMPACTION_WIRE_CONFIRM_INTERVAL_MS = 250;
const COMPACTION_WIRE_TAIL_BYTES = 256 * 1024;
const SERVER_RELOAD_UNSUPPORTED_MESSAGE = "当前官方 Server 会话暂不支持直接重载配置；如需刷新 Skill、Plugin 或配置，请新建或 fork 会话。";
const SERVER_GOAL_UNSUPPORTED_MESSAGE = "官方 Server 仅支持读取 Goal 状态；创建/暂停/恢复请使用兼容会话或等待官方 Server 支持。";
const sdkPinnedSessionIds = new Set<string>();
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

async function resolveConfiguredThinkingEffort(modelAlias: string | undefined, requestedEffort: string) {
  try {
    const config = await getConfig({ reload: true });
    const alias = modelAlias ?? config.defaultModel;
    const model = alias ? config.models?.[alias] : undefined;
    const provider = model?.provider ? config.providers?.[model.provider] : undefined;
    const resolved = resolveRuntimeThinkingEffort({
      requestedEffort,
      supportEfforts: model?.overrides?.supportEfforts ?? model?.supportEfforts,
      defaultEffort: model?.overrides?.defaultEffort ?? model?.defaultEffort,
      providerType: provider?.type,
    });
    if (resolved.changed && resolved.effort) {
      console.warn(`[KimiCodeHost] normalized thinking effort for ${alias ?? "unknown model"}: ${requestedEffort} -> ${resolved.effort} (${resolved.reason})`);
    }
    return resolved.effort ?? requestedEffort;
  } catch (error) {
    console.warn("[KimiCodeHost] thinking effort validation unavailable; preserving requested value:", error);
    return requestedEffort;
  }
}

async function normalizeSessionThinkingOptions(options: CreateKimiCodeSessionOptions): Promise<CreateKimiCodeSessionOptions> {
  if (!options.thinking) return options;
  const thinking = await resolveConfiguredThinkingEffort(options.model, options.thinking);
  return thinking === options.thinking ? options : { ...options, thinking };
}

export async function createSession(options: CreateKimiCodeSessionOptions): Promise<KimiCodeEngineSession> {
  options = await normalizeSessionThinkingOptions(options);
  const roomMetadata = parseOfficialRoomMetadata(options.metadata);
  if (roomMetadata) {
    const existing = await findExistingRoomSession(options.workDir, roomMetadata);
    if (existing) {
      return resumeSession(existing.id, { additionalDirs: options.additionalDirs });
    }
  }
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
  if (existingServer) {
    await refreshServerSessionStatus(sessionId, true).catch((error) => {
      if (isKimiCodeSessionMissingError(error)) throw error;
      console.warn(`[KimiCodeServerHost] refresh resumed status failed for ${sessionId}:`, error);
    });
    return toServerEngineSession(existingServer);
  }
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
  if (existing) return toEngineSession(existing.session, existing.status, existing.model);

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
    metadata: session.summary?.metadata,
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
    metadata: options.metadata ?? session.summary?.metadata,
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
      metadata: serverManaged.metadata,
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
    metadata: serverManaged.metadata ?? session.summary?.metadata,
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
  if (!kimiCodeServerHost.isReady()) throw new Error("会话子级列表仅由实验性 Kimi Server 提供。");
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
    await migrateServerSessionToSdk(sessionId, serverManaged, {
      forcePluginSessionStartReminder: true,
      runningMessage: "当前轮正在运行，不能刷新 Skill 注册表。请等本轮结束后重试。",
      // reload 的目的是让 SDK 重载 Skill/Plugin 注册表；钉在 SDK，避免 Server 恢复后被
      // promoteSdkSessionToServer 弹回导致 reload 效果丢失与链路反复横跳（与 Swarm pin 语义一致）。
      pinToSdk: true,
    });
    return;
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.reloadSession) throw new Error("当前兼容链路不支持会话重载。");
  // v2 引擎忽略 forcePluginSessionStartReminder（reload 本身仍会重载 Skill/Plugin 注册表）。
  await managed.session.reloadSession({ forcePluginSessionStartReminder: true });
}

async function migrateServerSessionToSdk(
  sessionId: string,
  serverManaged: ServerManagedSession,
  options: {
    forcePluginSessionStartReminder?: boolean;
    pinToSdk?: boolean;
    runningMessage: string;
  },
): Promise<ManagedSession> {
  if (serverManaged.status === "running" || serverManaged.status === "waiting_approval" || serverManaged.status === "waiting_question") {
    throw new Error(options.runningMessage);
  }

  const sdkHarness = await getHarness();
  let session: KimiCodeSessionLike;
  // v2 引擎忽略 forcePluginSessionStartReminder 参数；此分支仅保证 v1 下语义一致。
  if (options.forcePluginSessionStartReminder && sdkHarness.reloadSession) {
    session = await sdkHarness.reloadSession({
      id: sessionId,
      forcePluginSessionStartReminder: true,
    });
  } else {
    session = await sdkHarness.resumeSession({
      id: sessionId,
      additionalDirs: serverManaged.additionalDirs,
    });
    if (options.forcePluginSessionStartReminder) {
      if (!session.reloadSession) throw new Error(SERVER_RELOAD_UNSUPPORTED_MESSAGE);
      await session.reloadSession({ forcePluginSessionStartReminder: true });
    }
  }

  let status: KimiCodeSessionStatus | undefined;
  let permission = serverManaged.permission;
  try {
    status = await session.getStatus();
    if (status.permission === "manual" || status.permission === "auto" || status.permission === "yolo") {
      permission = status.permission;
    }
  } catch {
    // Best effort: keep the previous Server profile when SDK status is unavailable.
  }

  serverSessions.delete(sessionId);
  await getServerClient().unsubscribe(sessionId).catch((error) => {
    console.warn(`[KimiCodeServerHost] unsubscribe Server session ${sessionId} after SDK reload failed:`, error);
  });
  if (serverSessions.size === 0) {
    unsubscribeServerFrames?.();
    unsubscribeServerFrames = null;
    await serverClient?.close().catch(() => undefined);
    serverClient = null;
    kimiCodeServerHost.setRouting("sdk");
  }

  if (options.pinToSdk) {
    sdkPinnedSessionIds.add(sessionId);
  }
  registerSession(session, "idle", {
    model: status?.model ?? serverManaged.model,
    thinking: status?.thinkingEffort ?? status?.thinkingLevel ?? serverManaged.thinking,
    permission,
    planMode: status?.planMode ?? serverManaged.planMode,
    metadata: serverManaged.metadata ?? session.summary?.metadata,
  });
  // 迁移显式化：同 id 迁到兼容链路后发一次 idle 状态，渲染层据此刷新 runtime 绑定；
  // Server 恢复后未 pin 的会话仍可能被 promoteSdkSessionToServer 弹回，见调用方注释。
  emitStatus(sessionId, "idle");
  return getManagedSession(sessionId);
}

export async function setModel(sessionId: string, model: string): Promise<void> {
  sessionId = resolveMigratedSessionId(sessionId);
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    const previous = serverManaged.modelMutation ?? Promise.resolve();
    const mutation = previous
      .catch(() => undefined)
      .then(async () => {
        if (serverManaged.model === model) return;
        serverManaged.modelRevision += 1;
        await getServerClient().updateSession(sessionId, { model });
        serverManaged.model = model;
      });
    serverManaged.modelMutation = mutation;
    try {
      await mutation;
    } finally {
      if (serverManaged.modelMutation === mutation) serverManaged.modelMutation = undefined;
    }
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

export async function loadServerFile(fileId: string): Promise<{ fileId: string; mediaType: string; dataUrl: string }> {
  const normalizedFileId = fileId.trim();
  if (!normalizedFileId) throw new Error("Missing fileId");
  const file = await getServerClient().downloadFile(normalizedFileId);
  return {
    fileId: file.fileId,
    mediaType: file.mediaType,
    dataUrl: `data:${file.mediaType};base64,${file.data.toString("base64")}`,
  };
}

export async function materializeVideoFileReferences(input: string | KimiCodePromptPart[]): Promise<string | KimiCodePromptPart[]> {
  if (typeof input === "string" || !input.some((part) => part.type === "video_url" && part.videoUrl.fileId && !part.videoUrl.url?.startsWith("data:"))) return input;
  return Promise.all(input.map(async (part): Promise<KimiCodePromptPart> => {
    // Retried/steered history can carry both fileId and a local data: URL; the
    // data: URL is already sendable, so skip the redundant server download.
    if (part.type !== "video_url" || !part.videoUrl.fileId || part.videoUrl.url?.startsWith("data:")) return part;
    const file = await loadServerFile(part.videoUrl.fileId);
    return { type: "video_url", videoUrl: { url: file.dataUrl, id: part.videoUrl.id } };
  }));
}

async function sdkSessionDir(sessionId: string, workDir: string): Promise<string> {
  const direct = sessions.get(sessionId)?.session.summary?.sessionDir;
  if (direct) return direct;
  const summaries = await (await getHarness()).listSessions({ sessionId });
  const summary = summaries.find((item) => item.id === sessionId && item.sessionDir);
  if (summary?.sessionDir) return summary.sessionDir;
  for (const shareDir of candidateKimiShareDirs()) {
    const found = await findKimiCodeSessionDir(shareDir, workDir, sessionId);
    if (found) return found;
  }
  throw new Error(`无法定位会话 ${sessionId} 的附件目录`);
}

export async function materializeSdkFilePartInDirectory(
  attachmentsDir: string,
  file: Extract<KimiCodePromptPart, { type: "file" }>["file"],
): Promise<Extract<KimiCodePromptPart, { type: "text" }>> {
  const safeName = safeGenericAttachmentName(file.name, file.filePath);
  await fs.promises.mkdir(attachmentsDir, { recursive: true });

  let size: number;
  let mediaType = file.mediaType?.trim() || genericAttachmentMediaType(safeName);
  let targetPath: string;
  if (file.filePath?.trim()) {
    const sourcePath = path.resolve(file.filePath.trim());
    const stat = await fs.promises.stat(sourcePath);
    if (!stat.isFile()) throw new Error(`附件不是普通文件：${file.name}`);
    if (stat.size > MAX_GENERIC_ATTACHMENT_BYTES) {
      throw new Error(`附件“${file.name}”超过 50MB 上限`);
    }
    size = stat.size;
    const fingerprint = createHash("sha256")
      .update(`${sourcePath}\0${stat.size}\0${stat.mtimeMs}`)
      .digest("hex")
      .slice(0, 32);
    targetPath = path.join(attachmentsDir, `${fingerprint}-${safeName}`);
    const existing = await fs.promises.stat(targetPath).catch(() => null);
    if (!existing || existing.size !== stat.size) await fs.promises.copyFile(sourcePath, targetPath);
  } else if (file.fileId?.trim()) {
    if (file.size !== undefined && file.size > MAX_GENERIC_ATTACHMENT_BYTES) {
      throw new Error(`附件“${file.name}”超过 50MB 上限`);
    }
    const downloaded = await loadServerFile(file.fileId.trim());
    const match = downloaded.dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
    if (!match) throw new Error(`无法读取附件“${file.name}”`);
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.byteLength > MAX_GENERIC_ATTACHMENT_BYTES) {
      throw new Error(`附件“${file.name}”超过 50MB 上限`);
    }
    size = bytes.byteLength;
    mediaType = file.mediaType?.trim() || match[1] || mediaType;
    const fingerprint = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
    targetPath = path.join(attachmentsDir, `${fingerprint}-${safeName}`);
    const existing = await fs.promises.stat(targetPath).catch(() => null);
    if (!existing || existing.size !== size) await fs.promises.writeFile(targetPath, bytes);
  } else {
    throw new Error(`附件“${file.name}”缺少可读取的文件路径`);
  }

  return {
    type: "text",
    text: `Attached file "${safeName}" (${mediaType}, ${size} bytes): ${targetPath} — open it with the Read tool`,
  };
}

export async function materializeSdkFileReferences(
  sessionId: string,
  input: string | KimiCodePromptPart[],
): Promise<string | KimiCodePromptPart[]> {
  if (typeof input === "string" || !input.some((part) => part.type === "file")) return input;
  const workDir = getManagedSession(sessionId).session.workDir;
  const attachmentsDir = path.join(await sdkSessionDir(sessionId, workDir), "attachments");
  return Promise.all(input.map((part) => (
    part.type === "file" ? materializeSdkFilePartInDirectory(attachmentsDir, part.file) : Promise.resolve(part)
  )));
}

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

export function resolvePromptModel(expectedModel: string | undefined, managedModel: string | undefined): string | undefined {
  return expectedModel?.trim() || managedModel?.trim() || undefined;
}

export function shouldApplyServerModelRefresh(
  refreshRevision: number,
  currentRevision: number,
  modelMutationPending: boolean,
): boolean {
  return refreshRevision === currentRevision && !modelMutationPending;
}

export function resolveServerModelRefresh(
  statusModel: string | undefined,
  managedModel: string | undefined,
  applyStatusModel: boolean,
  modelMutationPending: boolean,
): string | undefined {
  if (applyStatusModel) return statusModel?.trim() || managedModel?.trim() || undefined;
  if (modelMutationPending) return undefined;
  return managedModel?.trim() || undefined;
}

const MODEL_NOT_CONFIGURED_PATTERN = /not configured in config\.toml/i;

function isModelNotConfiguredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return MODEL_NOT_CONFIGURED_PATTERN.test(message);
}

async function isModelConfiguredLocally(model: string): Promise<boolean> {
  try {
    const config = await getConfig({ reload: true });
    return Boolean(config.models?.[model]);
  } catch {
    return false;
  }
}

export async function sendPrompt(
  sessionId: string,
  input: string | KimiCodePromptPart[],
  expectedModel?: string,
  promptId?: string,
): Promise<KimiCodePromptRouteResult> {
  sessionId = resolveMigratedSessionId(sessionId);
  let serverManaged = serverSessions.get(sessionId);
  if (!serverManaged && !sessions.has(sessionId)) {
    await resumeSession(sessionId);
    serverManaged = serverSessions.get(sessionId);
  }
  const promptModel = resolvePromptModel(expectedModel, serverManaged?.model ?? sessions.get(sessionId)?.model);
  if (promptModel && promptModel !== (serverManaged?.model ?? sessions.get(sessionId)?.model)) {
    await setModel(sessionId, promptModel);
    // 本地期望值是用户对本轮的权威意图：setModel 之外直接注入，防止
    // server 状态刷新（busy 期间仍可能回写）把选择器刷回旧值。
    const managedNow = serverSessions.get(sessionId) ?? sessions.get(sessionId);
    if (managedNow) managedNow.model = promptModel;
    serverManaged = serverSessions.get(sessionId);
  }
  await ensureModelOutputLimitBeforePrompt(promptModel);

  // 本轮权威模型（不变量 65：dispatch 起不可变）立即通知渲染层盖到当轮 assistant——
  // server 路由 live 不产出 usage 状态卡，否则消息头徽标/底部模型信息要等切会话
  // 触发的历史对账 backfill 才显示。
  if (promptModel) eventSink?.({ sessionId, event: { type: "kimix.turn.model", model: promptModel, phase: "dispatch" } });
  serverManaged ??= sdkPinnedSessionIds.has(sessionId) ? undefined : await promoteSdkSessionToServer(sessionId);
  if (serverManaged) {
    setStatus(sessionId, "running");
    serverManaged.mainTurnActive = true;
    try {
      await getServerClient().prompt(sessionId, input, serverControls(serverManaged, promptModel));
      return { route: "server" };
    } catch (error) {
      // 保存新模型后运行中的 Server 可能仍用旧内存配置，prompt 校验报 not configured；
      // 模型已在本地配置时迁到兼容链路（读最新 TOML）重试一次，避免用户必须重启。
      if (isModelNotConfiguredError(error) && promptModel && (await isModelConfiguredLocally(promptModel))) {
        let migrated: ManagedSession | null = null;
        try {
          setStatus(sessionId, "interrupted");
          migrated = await migrateServerSessionToSdk(sessionId, serverManaged, {
            pinToSdk: true,
            runningMessage: "当前轮正在运行，不能切换运行时。请等本轮结束后重试。",
          });
          setStatus(sessionId, "running");
          const migratedFiles = await materializeSdkFileReferences(sessionId, input);
          await migrated.session.prompt(await materializeVideoFileReferences(migratedFiles), { promptId });
          return { route: "sdk-fallback", fallbackReason: "server model config stale, migrated to SDK" };
        } catch (retryError) {
          if (migrated) {
            setStatus(sessionId, "error");
            throw retryError;
          }
          console.warn("[KimiCodeServerHost] stale model config migration failed; original error path:", retryError);
        }
      }
      console.warn("[KimiCodeServerHost] prompt failed mid-turn; error will propagate to caller without fallback:", error);
      // Don't fallback mid-turn: create a fresh SDK session for the next turn,
      // notify the renderer of the migration, then propagate the error.
      const fallbackSession = await createSdkFallbackSession(sessionId, serverManaged);
      recordServerSessionMigration(sessionId, fallbackSession.sessionId);
      statusSink?.({ sessionId, status: "error", migratedTo: fallbackSession.sessionId });
      markServerRuntimeFailure(error);
      serverSessions.delete(sessionId);
      forgetSessionState(sessionScopedState, sessionId);
      setStatus(sessionId, "error");
      throw error;
    }
  }
  const managed = getManagedSession(sessionId);
  scheduleServerRecovery();
  setStatus(sessionId, "running");
  try {
    const materializedFiles = await materializeSdkFileReferences(sessionId, input);
    await managed.session.prompt(await materializeVideoFileReferences(materializedFiles), { promptId });
    const serverStatus = kimiCodeServerHost.getStatus();
    return {
      route: "sdk",
      ...(serverStatus.enabled && !kimiCodeServerHost.isReady()
        ? { fallbackReason: serverStatus.error ?? `Kimi Server 状态：${serverStatus.state}` }
        : {}),
    };
  } catch (error) {
    // SDK 链路同样可能内存配置陈旧（保存模型时运行中的会话不在 idle 重载覆盖内）；重载重试一次。
    if (
      isModelNotConfiguredError(error) &&
      promptModel &&
      managed.session.reloadSession &&
      (await isModelConfiguredLocally(promptModel))
    ) {
      try {
        setStatus(sessionId, "interrupted");
        await managed.session.reloadSession();
        setStatus(sessionId, "running");
        const retryFiles = await materializeSdkFileReferences(sessionId, input);
        await managed.session.prompt(await materializeVideoFileReferences(retryFiles), { promptId });
        return { route: "sdk" };
      } catch (retryError) {
        console.warn("[KimiCodeServerHost] stale model config SDK reload recovery failed:", retryError);
      }
    }
    setStatus(sessionId, "error");
    throw error;
  }
}

const promoteFailureBackoff = new PromoteFailureBackoff();

async function promoteSdkSessionToServer(sessionId: string): Promise<ServerManagedSession | undefined> {
  if (sdkPinnedSessionIds.has(sessionId)) return undefined;
  if (promoteFailureBackoff.isActive(sessionId)) return undefined;
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
      metadata: sdkManaged.metadata,
    });
    sessions.delete(sessionId);
    sdkManaged.unsubscribe();
    promoteFailureBackoff.clear(sessionId);
    return serverSessions.get(sessionId);
  } catch (error) {
    serverSessions.delete(sessionId);
    if (isKimiCodeSessionMissingError(error)) return undefined;
    if (isDaemonLevelPromoteError(error)) {
      // 明确的网络/守护进程级故障才允许升级全局 fallback
      markServerRuntimeFailure(error);
      console.warn("[KimiCodeServerHost] SDK session promotion hit daemon-level failure; keeping SDK route:", error);
      return undefined;
    }
    // 会话级失败（daemon 活着但该会话记录损坏/注册失败等）：只跳过该会话并指数退避，
    // 不得升级全局 runtime failure——否则单个损坏会话会让 10s 巡检每轮杀一次整个
    // daemon 并迁走全部空闲会话，自维持循环还会打断其他会话运行中的轮次。
    const retryAt = promoteFailureBackoff.noteFailure(sessionId);
    console.warn(
      `[KimiCodeServerHost] SDK session promotion failed (session-level, backoff until ${new Date(retryAt).toISOString()}):`,
      error,
    );
    return undefined;
  }
}

const SERVER_RECOVERY_TICK_MS = 10_000;
let serverRecoveryTicker: ReturnType<typeof setInterval> | null = null;

/**
 * daemon 静默退出或启动失败时，没有发送、也没有显式失败会触发 recovery，
 * 故障后第一次发送只能落 SDK（现场「经 SDK 发送」持续了 17 分钟）。
 * 周期自检把 SDK 窗口压缩到一个 tick；恢复后再把空闲兼容会话批量
 * promote 回 Server，不等下次发送逐条 promote。SDK 只作最后兜底。
 */
export function startServerRecoveryTicker() {
  if (serverRecoveryTicker) return;
  serverRecoveryTicker = setInterval(() => {
    if (!isKimiCodeServerSessionRoutingEnabled(process.env)) return;
    if (kimiCodeServerHost.isReady()) void promoteIdleSdkSessionsToServer();
    else scheduleServerRecovery();
  }, SERVER_RECOVERY_TICK_MS);
  (serverRecoveryTicker as { unref?: () => void }).unref?.();
}

async function promoteIdleSdkSessionsToServer() {
  for (const sessionId of [...sessions.keys()]) {
    if (sdkPinnedSessionIds.has(sessionId)) continue;
    try {
      const promoted = await promoteSdkSessionToServer(sessionId);
      if (promoted) console.info(`[KimiCodeServerHost] promoted idle SDK session ${sessionId} back to Server`);
    } catch (error) {
      console.warn(`[KimiCodeServerHost] idle SDK promotion sweep failed for ${sessionId}:`, error);
    }
  }
}

function scheduleServerRecovery() {
  startServerRecoveryTicker();
  const status = kimiCodeServerHost.getStatus();
  if (!status.enabled || kimiCodeServerHost.isReady() || serverRecoveryPromise || Date.now() < nextServerRecoveryAt) return;
  if (!isKimiCodeServerSessionRoutingEnabled(process.env)) return;
  nextServerRecoveryAt = Date.now() + SERVER_RECOVERY_TICK_MS;
  serverRecoveryPromise = kimiCodeServerHost.start()
    .then(() => {
      void promoteIdleSdkSessionsToServer();
    })
    .catch((error) => console.warn("[KimiCodeServerHost] background recovery failed:", error))
    .finally(() => {
      serverRecoveryPromise = null;
    });
}

export async function setSwarmMode(sessionId: string, enabled: boolean, trigger: "manual" | "task" = "manual"): Promise<void> {
  sessionId = resolveMigratedSessionId(sessionId);
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    // 官方 0.31+ Server 原生支持 swarm_mode（profile agent_config，已实测），与官方
    // Web 完全同链路，不再迁移到 SDK。轮次运行中开启仍拒绝（渲染层会先记 desired
    // 下轮生效）；关闭随时允许。
    if (enabled && (serverManaged.status === "running" || serverManaged.status === "waiting_approval" || serverManaged.status === "waiting_question")) {
      throw new Error("当前轮正在运行，不能开启 Swarm。请等本轮结束后重试。");
    }
    await getServerClient().updateSession(sessionId, { swarm_mode: enabled });
    serverManaged.swarmMode = enabled;
    return;
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.setSwarmMode) throw new Error("当前兼容链路不支持 Swarm 模式。");
  await managed.session.setSwarmMode(enabled, trigger);
  sdkPinnedSessionIds.add(sessionId);
}

export async function swarm(sessionId: string, input: string | KimiCodePromptPart[]): Promise<void> {
  sessionId = resolveMigratedSessionId(sessionId);
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    if (serverManaged.status === "running" || serverManaged.status === "waiting_approval" || serverManaged.status === "waiting_question") {
      throw new Error("当前轮正在运行，不能发起 Swarm。请等本轮结束后重试。");
    }
    // 官方 Server 的 Swarm 任务 = 会话 swarm_mode（profile）+ 请求级 swarm_mode
    // 标记（0.31+ prompts schema，已实测），子代理事件走同一条 WS，不再需要 SDK
    // 迁移。
    if (!serverManaged.swarmMode) {
      await getServerClient().updateSession(sessionId, { swarm_mode: true });
      serverManaged.swarmMode = true;
    }
    setStatus(sessionId, "running");
    try {
      await getServerClient().prompt(sessionId, input, serverControls(serverManaged));
    } catch (error) {
      setStatus(sessionId, "error");
      throw error;
    }
    return;
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.swarm) throw new Error("当前兼容链路不支持 Swarm。");
  setStatus(sessionId, "running");
  try {
    await managed.session.swarm(await materializeSdkFileReferences(sessionId, input));
    sdkPinnedSessionIds.add(sessionId);
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
  sessionId = resolveMigratedSessionId(sessionId);
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
    const materializedInput = await materializeSdkFileReferences(sessionId, input);
    await runWithInteractiveAgent(sdkHarness, agentId, () => managed.session.prompt(materializedInput));
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

async function runWithInteractiveAgent<T>(
  harness: KimiHarnessLike,
  agentId: string,
  run: () => Promise<T>,
): Promise<T> {
  if (harness.withInteractiveAgent) {
    return await harness.withInteractiveAgent(agentId, run);
  }
  const previousAgentId = harness.interactiveAgentId;
  harness.interactiveAgentId = agentId;
  try {
    return await run();
  } finally {
    harness.interactiveAgentId = previousAgentId;
  }
}

export async function steer(sessionId: string, input: string | KimiCodePromptPart[]): Promise<{
  steered: boolean;
  disposition?: "queued" | "running";
}> {
  sessionId = resolveMigratedSessionId(sessionId);
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    const result = await getServerClient().steer(sessionId, input, serverControls(serverManaged));
    // 只有真正注入当前轮才发「已接受」合成记录；落入官方队列/已开跑的由渲染层
    // 按 IPC 结果单独呈现，官方侧届时会出自己的 user 边界。
    if (result.steered) {
      const startedAt = Date.now();
      eventSink?.({ sessionId, event: syntheticSteerRecord(input, startedAt) });
      // live WS 不推送 steer 的官方确认（无 context.spliced/prompt.steered 帧，实测
      // 仅轮末完成屏障回放携带该 user 消息），进行中气泡会一直卡「等待官方写入」。
      // 轮询官方消息列表：steer 内容作为 user 消息落库（context.append_message，
      // 实测延迟约 15s）即发合成确认帧，渲染层据此立即收敛 accepted→sent。
      void waitForOfficialSteerUserMessage(getServerClient(), sessionId, input, startedAt)
        .then((official) => {
          if (official) eventSink?.({ sessionId, event: official });
        })
        .catch(() => undefined);
    }
    return result;
  }
  const managed = getManagedSession(sessionId);
  const startedAt = Date.now();
  const materializedFiles = await materializeSdkFileReferences(sessionId, input);
  const materializedInput = await materializeVideoFileReferences(materializedFiles);
  await managed.session.steer(materializedInput);
  eventSink?.({ sessionId, event: syntheticSteerRecord(materializedInput, startedAt) });
  void waitForOfficialSteerRecord(sessionId, managed.session.workDir, materializedInput, startedAt)
    .then((officialSteer) => {
      if (officialSteer.source === "kimix-fallback") return;
      eventSink?.({ sessionId, event: officialSteer });
    })
    .catch(() => undefined);
  return { steered: true };
}

export async function undoHistory(sessionId: string, count: number): Promise<void> {
  sessionId = resolveMigratedSessionId(sessionId);
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
  sessionId = resolveMigratedSessionId(sessionId);
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
  sessionId = resolveMigratedSessionId(sessionId);
  const serverManaged = serverSessions.get(sessionId);
  const resolvedLevel = await resolveConfiguredThinkingEffort(serverManaged?.model ?? sessions.get(sessionId)?.model, level);
  if (serverManaged) {
    if (serverManaged.thinking === resolvedLevel) return;
    await getServerClient().updateSession(sessionId, { thinking: resolvedLevel });
    serverManaged.thinking = resolvedLevel;
    return;
  }
  const managed = getManagedSession(sessionId);
  if (managed.thinking === resolvedLevel) return;
  if (!managed.session.setThinking) throw new Error("当前兼容链路不支持切换思考强度。");
  await managed.session.setThinking(resolvedLevel);
  managed.thinking = resolvedLevel;
}

/**
 * 权限写盘决策：以 refresh 回来的 server 真值（而非本地缓存）对比目标模式，
 * 一致则不写。幂等重申也必须先回读再决定，避免缓存==目标值时吞掉显式调整。
 */
export function shouldWritePermissionToServer(
  current: KimiCodePermissionMode | undefined,
  target: KimiCodePermissionMode,
): boolean {
  return current !== target;
}

export async function setPermission(sessionId: string, mode: KimiCodePermissionMode): Promise<void> {
  sessionId = resolveMigratedSessionId(sessionId);
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    // 先回读再决定：managed.permission 只是缓存，web 端可经 prompt 改写 server
    // profile 使缓存过期；必须用 server 真值做 early-return 判断，否则缓存==目标
    // 值时显式调整被静默吞掉（连写后回读也被跳过）。回读失败不阻塞写入，catch
    // 记录后继续按当前缓存值判断。
    await refreshServerSessionStatus(sessionId, true).catch((error) => {
      console.warn(`[KimiCodeServerHost] refresh before permission change failed for ${sessionId}:`, error);
    });
    if (!shouldWritePermissionToServer(serverManaged.permission, mode)) return;
    await getServerClient().updateSession(sessionId, { permission_mode: mode });
    serverManaged.permission = mode;
    // 写后回读：校准 managed.permission 并 emit agent.status.updated，让渲染层
    // 立即收到权威权限值，避免后续切换基于过期缓存 early-return 被吞掉。
    await refreshServerSessionStatus(sessionId, true).catch((error) => {
      console.warn(`[KimiCodeServerHost] refresh after permission change failed for ${sessionId}:`, error);
    });
    return;
  }
  const managed = getManagedSession(sessionId);
  if (managed.permission === mode) return;
  await managed.session.setPermission(mode);
  managed.permission = mode;
}

export async function compactSession(sessionId: string, instruction?: string): Promise<void> {
  sessionId = resolveMigratedSessionId(sessionId);
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    const startedAt = Date.now();
    await getServerClient().compactSession(sessionId, instruction);
    const result = await waitForOfficialCompactionResult(sessionId, serverManaged.workDir, startedAt);
    eventSink?.({ sessionId, event: result.terminal });
    if (result.usage) eventSink?.({ sessionId, event: result.usage });
    if (isTurnCompletionEventType(result.terminal.type)) recordTurnCompletion(sessionId);
    await refreshServerSessionStatus(sessionId, true).catch((error) => {
      console.warn(`[KimiCodeServerHost] refresh after compaction failed for ${sessionId}:`, error);
    });
    if (result.terminal.type === "full_compaction.cancel") {
      throw new Error("Server 取消了本次上下文压缩。");
    }
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
    forgetSessionState(sessionScopedState, sessionId);
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

function serverSessionProjectPath(session: ServerSession) {
  const cwd = session.metadata?.cwd;
  return typeof cwd === "string" ? cwd : "";
}

function toArchivedSessionSummary(session: ServerSession): KimiCodeArchivedSessionSummary {
  return {
    id: session.id,
    title: session.title?.trim() || "未命名对话",
    projectPath: serverSessionProjectPath(session),
    archivedAt: session.updated_at ?? "",
    updatedAt: session.updated_at ?? "",
    createdAt: session.created_at ?? "",
  };
}

function sdkSessionTimestamp(value: number) {
  return new Date(value > 1e12 ? value : value * 1_000).toISOString();
}

export function toSdkArchivedSessionSummary(session: KimiCodeSessionSummary): KimiCodeArchivedSessionSummary {
  return {
    id: session.id,
    title: session.title?.trim() || session.lastPrompt?.trim() || "未命名对话",
    projectPath: session.workDir,
    archivedAt: sdkSessionTimestamp(session.updatedAt),
    updatedAt: sdkSessionTimestamp(session.updatedAt),
    createdAt: sdkSessionTimestamp(session.createdAt),
  };
}

export async function listArchivedSessions(): Promise<KimiCodeArchivedSessionSummary[]> {
  if (!shouldRouteNewSessionToServer()) {
    const sessions = await listSdkSessionSummaries(undefined, { includeBrief: false });
    return sessions.filter((session) => session.archived === true).map(toSdkArchivedSessionSummary);
  }
  const sessions = await getServerClient().listArchivedSessions();
  return sessions.map(toArchivedSessionSummary);
}

export async function restoreArchivedSession(sessionId: string): Promise<KimiCodeArchivedSessionSummary> {
  if (!shouldRouteNewSessionToServer()) {
    return restoreSdkArchivedSession(await getHarness(), sessionId);
  }
  const restored = await getServerClient().restoreSession(sessionId);
  return toArchivedSessionSummary(restored);
}

export async function restoreSdkArchivedSession(
  sdkHarness: { listSessions: (input: { sessionId: string; includeArchive: boolean }) => Promise<KimiCodeSessionSummary[]> },
  sessionId: string,
): Promise<KimiCodeArchivedSessionSummary> {
  const summaries = await sdkHarness.listSessions({ sessionId, includeArchive: true });
  const summary = summaries.find((item) => item.id === sessionId);
  if (!summary?.sessionDir) {
    throw new Error(`Session "${sessionId}" was not found`);
  }
  const statePath = path.join(summary.sessionDir, "state.json");
  let state: JsonObject;
  try {
    const parsed = JSON.parse(await fs.promises.readFile(statePath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid state");
    state = parsed as JsonObject;
  } catch (error) {
    throw new Error(`Session "${sessionId}" state.json was not found`, { cause: error });
  }
  const { archived: _archived, ...restoredState } = state;
  const restoredAt = new Date().toISOString();
  await fs.promises.writeFile(statePath, `${JSON.stringify({ ...restoredState, updatedAt: restoredAt }, null, 2)}\n`, "utf-8");
  return {
    ...toSdkArchivedSessionSummary({ ...summary, archived: false, updatedAt: Date.parse(restoredAt) }),
    title: typeof state.title === "string" && state.title.trim()
      ? state.title.trim()
      : toSdkArchivedSessionSummary(summary).title,
  };
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
  if (serverSessions.has(sessionId)) {
    const data = await getServerClient().getGoal(sessionId) as { goal?: KimiCodeGoalSnapshot | null } | null;
    return { goal: data?.goal ?? null };
  }
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
  sessionId = resolveMigratedSessionId(sessionId);
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    return serverStatusToKimiCodeStatus(
      await refreshServerSessionStatus(sessionId, false),
      serverManaged.session.usage,
      serverManaged.status,
    );
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
  sessionId = resolveMigratedSessionId(sessionId);
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
  if (kimiCodeServerHost.isReady()) {
    try {
      return { source: "server", payload: await getServerClient().getOAuthUsage() };
    } catch (error) {
      console.warn("[KimiCodeServerHost] server usage failed; falling back to SDK:", error);
    }
  }
  const sdkHarness = await getHarness();
  if (!sdkHarness.auth?.getManagedUsage) throw new Error("当前兼容链路不支持读取套餐用量。");
  return { source: "sdk", payload: await sdkHarness.auth.getManagedUsage(providerName) };
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
  sessionId = resolveMigratedSessionId(sessionId);
  if (serverSessions.has(sessionId)) {
    return (await getServerClient().listMcpServers()).map(toKimiCodeMcpServerInfo);
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.listMcpServers) throw new Error("当前兼容链路不支持读取 MCP 服务。");
  return [...await managed.session.listMcpServers()];
}

export async function getMcpStartupMetrics(sessionId: string): Promise<KimiCodeMcpStartupMetrics> {
  sessionId = resolveMigratedSessionId(sessionId);
  if (serverSessions.has(sessionId)) throw new Error("当前官方 Server 会话未提供 MCP 启动指标；该数据仅由兼容链路提供。");
  const managed = getManagedSession(sessionId);
  if (!managed.session.getMcpStartupMetrics) throw new Error("当前兼容链路不支持读取 MCP 启动指标。");
  return managed.session.getMcpStartupMetrics();
}

export async function reconnectMcpServer(sessionId: string, name: string): Promise<void> {
  sessionId = resolveMigratedSessionId(sessionId);
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
  const managed = serverSessions.get(sessionId);
  const [status, tools, mcpServers, connections, messages, prompts, snapshot] = await Promise.all([
    client.getSessionStatus(sessionId),
    client.listTools(sessionId),
    client.listMcpServers(),
    client.listConnections(),
    client.listMessages(sessionId, 20),
    client.listPrompts(sessionId),
    client.getSnapshot(sessionId),
  ]);
  return {
    session: serverStatusToKimiCodeStatus(status, serverSessions.get(sessionId)?.session.usage),
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      source: tool.source,
      mcpServerId: tool.mcp_server_id,
      inputSchema: tool.input_schema,
      active: tool.active,
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
    agents: (() => {
      const snapshotAgents = Array.isArray(snapshot.subagents) ? snapshot.subagents : [];
      const mapped: KimiCodeServerRuntimeDiagnostics["agents"] = snapshotAgents.map((agent) => ({
        agentId: agent.id,
        kind: agent.kind,
        subagentType: agent.subagent_type,
        description: agent.description,
        status: agent.subagent_phase ?? agent.status,
        parentToolCallId: agent.parent_tool_call_id,
        runInBackground: agent.run_in_background === true,
        createdAt: agent.created_at ?? null,
        startedAt: agent.started_at ?? null,
        completedAt: agent.completed_at ?? null,
        disposedObservedAt: managed?.agentLifecycle.get(agent.id)?.disposedObservedAt ?? null,
      }));
      const known = new Set(mapped.map((agent) => agent.agentId));
      for (const [agentId, lifecycle] of managed?.agentLifecycle ?? []) {
        if (known.has(agentId)) continue;
        mapped.push({
          agentId,
          createdAt: lifecycle.createdObservedAt ?? null,
          startedAt: null,
          completedAt: null,
          disposedObservedAt: lifecycle.disposedObservedAt ?? null,
        });
      }
      return mapped;
    })(),
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
  const expectedRoot = normalizePathForComparison(path.resolve(workDir));
  const sessionRoot = normalizePathForComparison(path.resolve(managed.workDir));
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
  const expectedRoot = normalizePathForComparison(path.resolve(workDir));
  const sessionRoot = normalizePathForComparison(path.resolve(managed.workDir));
  if (expectedRoot !== sessionRoot) return undefined;
  const result = await getServerClient().readFile(sessionId, filePath);
  if (result.is_binary || result.encoding !== "utf-8") throw new Error("Only text files can be read");
  if (result.truncated || result.size > 1_048_576) throw new Error("Text file is too large");
  return { path: result.path, content: result.content };
}

export async function readServerSessionPlan(
  sessionId: string,
  workDir: string,
): Promise<{ path?: string; content: string } | undefined> {
  const managed = serverSessions.get(sessionId);
  if (!managed) return undefined;
  const expectedRoot = normalizePathForComparison(path.resolve(workDir));
  const sessionRoot = normalizePathForComparison(path.resolve(managed.workDir));
  if (expectedRoot !== sessionRoot) return undefined;
  const result = await getServerClient().listTranscriptPlans(sessionId, "main");
  const latestPlan = result.plans.at(-1);
  if (!latestPlan || typeof latestPlan.plan !== "string" || !latestPlan.plan.trim()) return undefined;
  if (Buffer.byteLength(latestPlan.plan, "utf8") > 1_048_576) throw new Error("Plan content is too large");
  return { path: latestPlan.path, content: latestPlan.plan };
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
  sessionId = resolveMigratedSessionId(sessionId);
  try {
    const tasks = await getServerClient().listTasks(sessionId, options.activeOnly ? "running" : undefined);
    const mapped = tasks.map(mapServerBackgroundTask);
    return options.limit ? mapped.slice(0, options.limit) : mapped;
  } catch (serverErr) {
    if (serverSessions.has(sessionId)) throw serverErr;
    try {
      const managed = getManagedSession(sessionId);
      if (!managed.session.listBackgroundTasks) throw new Error("当前兼容链路不支持读取后台任务。");
      return [...await managed.session.listBackgroundTasks(options)].map((task) => ({
        ...task,
        transport: "sdk" as const,
      }));
    } catch {
      throw serverErr;
    }
  }
}

export async function getBackgroundTaskOutput(sessionId: string, taskId: string, options: { tail?: number } = {}): Promise<string> {
  sessionId = resolveMigratedSessionId(sessionId);
  if (serverSessions.has(sessionId)) {
    const task = await getServerClient().getTask(sessionId, taskId, Math.max(1_024, (options.tail ?? 200) * 256));
    return task.output_preview ?? "";
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.getBackgroundTaskOutput) throw new Error("当前兼容链路不支持读取后台任务输出。");
  return managed.session.getBackgroundTaskOutput(taskId, options);
}

export async function getBackgroundTaskOutputPath(sessionId: string, taskId: string): Promise<string | undefined> {
  sessionId = resolveMigratedSessionId(sessionId);
  if (serverSessions.has(sessionId)) return undefined;
  const managed = getManagedSession(sessionId);
  if (!managed.session.getBackgroundTaskOutputPath) throw new Error("当前兼容链路不支持读取后台任务输出路径。");
  return managed.session.getBackgroundTaskOutputPath(taskId);
}

export async function stopBackgroundTask(sessionId: string, taskId: string, reason?: string): Promise<void> {
  sessionId = resolveMigratedSessionId(sessionId);
  if (serverSessions.has(sessionId)) {
    await getServerClient().cancelTask(sessionId, taskId);
    return;
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.stopBackgroundTask) throw new Error("当前兼容链路不支持停止后台任务。");
  await managed.session.stopBackgroundTask(taskId, reason ? { reason } : {});
}

export async function detachBackgroundTask(sessionId: string, taskId: string): Promise<KimiCodeBackgroundTaskInfo | undefined> {
  sessionId = resolveMigratedSessionId(sessionId);
  if (serverSessions.has(sessionId)) {
    await getServerClient().detachTask(sessionId, taskId);
    const task = await getServerClient().getTask(sessionId, taskId);
    return mapServerBackgroundTask(task);
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.detachBackgroundTask) throw new Error("当前兼容链路不支持前台任务转后台。");
  const task = await managed.session.detachBackgroundTask(taskId);
  return task ? { ...task, transport: "sdk" as const } : undefined;
}

function mapServerBackgroundTask(task: ServerBackgroundTask): KimiCodeBackgroundTaskInfo {
  return {
    taskId: task.id,
    command: task.command ?? "",
    description: task.description,
    status: task.status === "cancelled" ? "killed" : task.status,
    pid: 0,
    exitCode: null,
    startedAt: Date.parse(task.started_at ?? task.created_at),
    endedAt: task.completed_at ? Date.parse(task.completed_at) : null,
    agentId: task.agent_id,
    subagentType: task.kind,
    outputBytes: task.output_bytes,
    outputPreview: task.output_preview,
    transport: "server",
    stopReason: task.status === "cancelled" ? "任务已被官方 Server 标记为取消。" : undefined,
    failureReason: task.status === "failed" && task.output_bytes ? `任务失败，已有约 ${formatBytes(task.output_bytes)} 输出可查看。` : undefined,
  };
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
  if (sessionId) sessionId = resolveMigratedSessionId(sessionId);
  if (sessionId && serverSessions.has(sessionId)) {
    return (await getServerClient().listSkills(sessionId)).map(toKimiCodeSkillSummary);
  }
  const session = await resolvePluginSession(sessionId);
  if (!session.listSkills) throw new Error("当前兼容链路不支持读取 Skill 列表。");
  return [...await session.listSkills()];
}

function isCapabilityUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /capability surface is unavailable|requires v2/i.test(message);
}

// 官方内置能力（kimi-cu / kimi-webbridge）：app 级，不需要会话；v1 引擎/旧 bundle 降级为空列表。
export async function listCapabilities(): Promise<KimiCodeCapabilityStatus[]> {
  const sdkHarness = await getHarness();
  if (!sdkHarness.listCapabilities) return [];
  try {
    return [...await sdkHarness.listCapabilities()];
  } catch (error) {
    if (isCapabilityUnsupportedError(error)) return [];
    throw error;
  }
}

/**
 * 官方安装器把下载的可执行文件 rename 到能力 bin 目录；运行中的二进制会占用目标文件，
 * rename 以 EPERM 失败并把 capability 标记为“部分就绪”。Windows 下先结束 Kimix 自己拉起的
 * 同名二进制再触发安装：只按 PID 定向结束（当前进程的后代，或父进程已退出、来自上一实例的
 * 残留孤儿），不用 taskkill /IM 按镜像名全局结束，避免误杀其他 Kimi 系工具的同名进程。
 */
const CAPABILITY_BINARY_NAMES: Record<string, string> = {
  "kimi-webbridge": "kimi-webbridge.exe",
  "kimi-cu": "kimi-cu.exe",
};

function listWin32ProcessTable(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command",
        "Get-CimInstance Win32_Process | Select-Object Name,ProcessId,ParentProcessId | ConvertTo-Json -Compress"],
      { windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => { if (error) reject(error); else resolve(stdout); },
    );
  });
}

function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile("taskkill", ["/F", "/T", "/PID", String(pid)], { windowsHide: true }, () => resolve());
  });
}

async function stopCapabilityBinary(id: string): Promise<void> {
  const processName = CAPABILITY_BINARY_NAMES[id];
  if (process.platform !== "win32" || !processName) return;
  try {
    const table = parseWin32ProcessTable(await listWin32ProcessTable());
    const pids = collectOwnProcessIds(table, process.pid, processName);
    for (const pid of pids) await killProcessTree(pid);
    if (pids.length > 0) {
      console.warn(`[KimiCodeHost] capability install: stopped own ${processName} before install (pids: ${pids.join(", ")})`);
    }
  } catch (error) {
    // 枚举失败时跳过预清理；文件确被占用时安装仍按原行为报部分就绪，不额外扩大影响面。
    console.warn("[KimiCodeHost] capability pre-install stop skipped:", error);
  }
}

export async function installCapability(id: string): Promise<KimiCodeCapabilityStatus> {
  await stopCapabilityBinary(id);
  const sdkHarness = await getHarness();
  if (!sdkHarness.installCapability) throw new Error("当前引擎不支持官方内置能力（需要 SDK v2 引擎）。");
  try {
    return await sdkHarness.installCapability(id);
  } catch (error) {
    if (isCapabilityUnsupportedError(error)) throw new Error("当前引擎不支持官方内置能力（需要 SDK v2 引擎）。");
    throw error;
  }
}

export async function activateSkill(
  sessionId: string,
  name: string,
  args?: string,
  attachments: KimiCodePromptPart[] = [],
): Promise<void> {
  sessionId = resolveMigratedSessionId(sessionId);
  if (serverSessions.has(sessionId)) {
    await getServerClient().activateSkill(sessionId, name, args, attachments);
    return;
  }
  const managed = getManagedSession(sessionId);
  if (attachments.length > 0) throw new Error("当前 SDK 兼容链路尚不支持 Skill 附件，请等待 Kimi Server 恢复后重试。");
  if (!managed.session.activateSkill) throw new Error("当前兼容链路不支持激活 Skill。");
  await managed.session.activateSkill(name, args);
}

export async function listPluginCommands(sessionId: string): Promise<KimiCodePluginCommandSummary[]> {
  if (serverSessions.has(sessionId)) {
    throw new Error("当前 Server 会话暂不支持读取 Plugin 命令。请等待官方 Server API 暴露等价能力，或在 SDK route 会话中使用。");
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.listPluginCommands) throw new Error("当前兼容链路不支持读取 Plugin 命令。");
  return [...await managed.session.listPluginCommands()];
}

export async function activatePluginCommand(sessionId: string, pluginId: string, commandName: string, args?: string): Promise<void> {
  if (serverSessions.has(sessionId)) {
    throw new Error("当前 Server 会话暂不支持激活 Plugin 命令。请等待官方 Server API 暴露等价能力，或在 SDK route 会话中使用。");
  }
  const managed = getManagedSession(sessionId);
  if (!managed.session.activatePluginCommand) throw new Error("当前兼容链路不支持激活 Plugin 命令。");
  await managed.session.activatePluginCommand(pluginId, commandName, args);
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
  // Server 路由仍返回旧枚举（connecting/error/disconnected），SDK 会话路由返回
  // 上游 0.34.0 新枚举（pending/failed/disabled/needs-auth/removed）；统一归一化到渲染枚举。
  const status = server.status === "connected"
    ? "connected" as const
    : server.status === "pending" || server.status === "connecting"
      ? "pending" as const
      : server.status === "failed" || server.status === "error"
        ? "failed" as const
        : server.status === "needs-auth"
          ? "needs-auth" as const
          : server.status === "removed"
            ? "removed" as const
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

async function listSdkSessionSummaries(
  workDir: string | undefined,
  options: { includeBrief: boolean },
): Promise<KimiCodeSessionSummary[]> {
  const sdkHarness = await getHarness();
  const sessions = [...await sdkHarness.listSessions({ ...(workDir ? { workDir } : {}), includeArchive: true })];
  // SDK may return empty metadata/title/lastPrompt; backfill from state.json if available.
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
      if (options.includeBrief && session.archived !== true && session.isCustomTitle !== true) {
        const firstPrompt = await getFirstUserMessage(path.join(session.sessionDir, "agents", "main", "wire.jsonl"));
        if (firstPrompt.trim()) session.brief = firstPrompt.trim();
      }
    } catch {
      // ignore unreadable metadata
    }
  }
  return sessions;
}

async function findExistingRoomSession(
  workDir: string,
  roomMetadata: NonNullable<ReturnType<typeof parseOfficialRoomMetadata>>,
): Promise<KimiCodeSessionSummary | null> {
  const candidates = shouldRouteNewSessionToServer()
    ? (await getServerClient().listSessions()).map(serverSessionSummary)
    : await listSdkSessionSummaries(workDir, { includeBrief: false });
  return selectExistingRoomSession(candidates, roomMetadata, workDir);
}

export async function listSessions(workDir?: string): Promise<KimiCodeSessionSummary[]> {
  if (shouldRouteNewSessionToServer()) {
    const normalizedWorkDir = workDir ? normalizePathForComparison(path.resolve(workDir)) : undefined;
    const matchesWorkDir = (session: ServerSession) => !normalizedWorkDir || (
      typeof session.metadata?.cwd === "string" && normalizePathForComparison(path.resolve(session.metadata.cwd)) === normalizedWorkDir
    );
    // 活动目录（exclude_empty）+ 归档目录合并：reconcile 需要 archived:true 行作为
    // 「官方明确归档」的显式证据，否则只能靠目录缺席猜测，误归档有内容的会话。
    const [active, archived] = await Promise.all([
      getServerClient().listSessions(),
      getServerClient().listArchivedSessions().catch(() => [] as ServerSession[]),
    ]);
    const merged = new Map<string, ServerSession>();
    for (const session of [...archived, ...active]) {
      if (matchesWorkDir(session)) merged.set(session.id, session);
    }
    return [...merged.values()].map(serverSessionSummary);
  }
  const sessions = await listSdkSessionSummaries(workDir, { includeBrief: true });
  return sessions.filter((session) => session.archived === true || Boolean(session.lastPrompt?.trim()));
}

export function isSdkManagedRuntimeSession(sessionId: string): boolean {
  return sessions.has(sessionId) || sdkPinnedSessionIds.has(sessionId);
}

export async function loadServerSessionHistory(sessionId: string): Promise<{ events: Array<{ type: string; payload: unknown; time?: unknown }>; source: "server"; truncated?: boolean }> {
  // Server 快照只对该 server 进程实际管理的会话有权威。兼容链路（SDK）管理的
  // 会话在 server 侧是休眠空壳：SDK 轮次进行中读它的快照会看到
  // “idle + 空正文 assistant” 的过渡态，触发失败帧合成（模型请求失败误报）。
  // 交给调用方 fallback 到本地 wire 镜像。
  if (isSdkManagedRuntimeSession(sessionId)) {
    throw new Error(`Session ${sessionId} 当前由兼容链路管理，改用本地 wire 镜像加载历史。`);
  }
  const snapshot = await getServerClient().getSnapshot(sessionId);
  const frames = snapshotToHistoryFrames(snapshot, sessionId);
  return {
    events: frames.map((frame) => ({
      type: frame.type,
      payload: frame.payload ?? {},
      time: serverReplayTimestamp(frame),
    })),
    source: "server",
    // 0.29 快照只回最近 100 条消息（messages.has_more），调用方需改用本地 wire 全量镜像
    truncated: snapshot.messages?.has_more === true,
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
  if (kimiCodeServerHost.isReady() && input.id) {
    try {
      const zip = await getServerClient().exportSession(input.id);
      return {
        zipPath: "",
        entries: [],
        sessionDir: "",
        manifest: null,
        zip,
        source: "server",
      };
    } catch (error) {
      console.warn("[KimiCodeServerHost] server export failed; falling back to SDK:", error);
    }
  }
  const sdkHarness = await getHarness();
  const result = await sdkHarness.exportSession({
    ...input,
    version: input.version ?? process.env.npm_package_version ?? "0.0.0",
    installSource: input.installSource ?? "kimix-sdk-host",
  });
  return { ...result, source: "sdk" };
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

export type ThinkingEffortProbeResult = {
  supportEfforts?: string[];
  maxContextSize?: number;
  defaultEffort?: string;
  endpoint: string;
};

/**
 * 从 models.dev 目录匹配模型 Context 与思考档位声明。两项元数据彼此独立；
 * OpenAI-compatible completion 端点的 2xx 不能证明具体模型支持某个思考档位。
 */
export async function probeModelThinkingEfforts(modelAlias: string): Promise<ThinkingEffortProbeResult> {
  const config = await getConfig({ reload: true });
  const model = config.models?.[modelAlias];
  if (!model?.model) throw new Error(`未找到模型「${modelAlias}」，请先保存模型配置。`);
  const providerName = model.provider ?? config.defaultProvider ?? "";
  const provider = config.providers?.[providerName];
  const resolution = resolveCatalogModelMetadata({
    providerName,
    baseUrl: provider?.baseUrl,
    modelId: model.model,
    providers: await listProviderCatalog(),
  });
  if (resolution.status !== "resolved") {
    const reason = resolution.status === "ambiguous"
      ? "目录中同名模型的元数据不一致"
      : resolution.status === "undeclared"
        ? "目录已收录该模型，但未声明可用的 Context 或思考档位"
        : "目录未找到该模型的元数据";
    throw new Error(`${reason}。供应商返回 2xx 只能证明网关接受参数，不能证明模型支持；请手动声明或留空。`);
  }
  const efforts = resolution.supportEfforts;
  const defaultEffort = model.defaultEffort && efforts?.includes(model.defaultEffort)
    ? model.defaultEffort
    : undefined;
  return {
    ...(efforts ? { supportEfforts: efforts } : {}),
    ...(resolution.maxContextSize ? { maxContextSize: resolution.maxContextSize } : {}),
    defaultEffort,
    endpoint: `models.dev:${resolution.providerId}`,
  };
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

export async function setExperimentalFeature(id: KimiCodeExperimentalFeatureId, enabled: boolean): Promise<KimiCodeConfig> {
  return setConfig(buildExperimentalFeatureConfigPatch(id, enabled) as KimiCodeConfigPatch);
}

function normalizeCatalogMaxContextSize(value: number | null): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

// models.dev 思考档位 → Kimix 词表（off/minimal/low/medium/high/xhigh/max）：
// none→off、low→low、medium→medium、high→high、xhigh→xhigh、max→max、minimal→minimal。
// xhigh 不再降级为 max：OpenAI 兼容 provider 只接受 xhigh 不接受 max，
// 降级会导致 reasoning_effort=max 被 provider 400 拒绝。
// 未认识的值一律丢弃（不猜测）；无档位信息时返回 undefined，不编造档位。
const CATALOG_EFFORT_TO_KIMIX: Readonly<Record<string, string>> = {
  none: "off",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
  minimal: "minimal",
};

function mapCatalogEffortValues(values: string[] | undefined): string[] | undefined {
  if (!Array.isArray(values) || values.length === 0) return undefined;
  const mapped = values
    .map((value) => CATALOG_EFFORT_TO_KIMIX[value.toLowerCase()])
    .filter((value): value is string => value !== undefined);
  return mapped.length > 0 ? mapped : undefined;
}

export async function listProviderCatalog(): Promise<KimiCodeProviderCatalogEntry[]> {
  const sdk = await loadSdk();
  if (!sdk.fetchCatalog || !sdk.inferWireType || !sdk.catalogProviderModels || !sdk.catalogBaseUrl) {
    throw new Error("当前兼容链路未公开 Provider catalog API");
  }
  const catalogUrl = sdk.DEFAULT_CATALOG_URL ?? "https://models.dev/api.json";
  const catalog = await sdk.fetchCatalog(catalogUrl);
  const entries: KimiCodeProviderCatalogEntry[] = [];
  for (const [providerId, provider] of Object.entries(catalog)) {
      const wire = sdk.inferWireType?.(provider);
      if (wire !== "openai") continue;
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
            supportEfforts: mapCatalogEffortValues([
              ...(model.offEffort ? [model.offEffort] : []),
              ...(model.supportEfforts ?? []),
            ]),
          };
        })
        .sort((a, b) => a.id.localeCompare(b.id, "zh-CN"));
      if (!baseUrl || models.length === 0) continue;
      entries.push({
        providerId,
        type: wire,
        baseUrl,
        modelCount: models.length,
        models,
      });
  }
  return entries.sort((a, b) => a.providerId.localeCompare(b.providerId, "zh-CN"));
}

export async function closeSession(sessionId: string): Promise<void> {
  sessionId = resolveMigratedSessionId(sessionId);
  lastTurnCompletedAt.delete(sessionId);
  sdkPinnedSessionIds.delete(sessionId);
  if (serverSessions.has(sessionId)) {
    serverSessions.delete(sessionId);
    forgetSessionState(sessionScopedState, sessionId);
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
  if (!managed) {
    cleanupSessionMigrationEntries(sessionId);
    forgetSessionState(sessionScopedState, sessionId);
    return;
  }
  sessions.delete(sessionId);
  settlePendingForSession(sessionId, "cancelled");
  managed.unsubscribe();
  await managed.session.close();
  cleanupSessionMigrationEntries(sessionId);
  forgetSessionState(sessionScopedState, sessionId);
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

  const unsubscribe = session.onEvent((rawEvent) => {
    if (!rawEvent || typeof rawEvent !== "object" || !("type" in rawEvent)) return;
    const event = rawEvent as Record<string, unknown>;
    if (event.type === "assistant.delta") {
      if (typeof event.delta === "string") parts.push(event.delta);
    }
    if (event.type === "turn.ended") {
      ended = true;
      if (event.reason === "failed" || event.reason === "error") {
        const eventError = event.error && typeof event.error === "object"
          ? event.error as Record<string, unknown>
          : undefined;
        endError = typeof eventError?.code === "string"
          ? `${eventError.code}: ${String(eventError.message ?? "")}`
          : event.reason;
      }
    }
    if (event.type === "error") {
      ended = true;
      endError = typeof event.message === "string" ? event.message : "Unknown SDK error";
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
  selectedLabel?: string,
): void {
  const serverKey = pendingKey(sessionId, requestId);
  if (serverApprovalIds.delete(serverKey)) {
    setStatus(sessionId, "running");
    void getServerClient().resolveApproval(sessionId, requestId, {
      decision: approved ? "approved" : "rejected",
      scope: approved && scope === "session" ? "session" : undefined,
      feedback,
      selectedLabel: selectedLabel ?? (approved ? (scope === "session" ? "Allow for session" : "Allow") : "Reject"),
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
    selectedLabel: selectedLabel ?? (approved ? (scope === "session" ? "Allow for session" : "Allow") : "Reject"),
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
    metadata?: JsonObject;
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
    if (isTurnCompletionEventType(eventTypeOf(event))) recordTurnCompletion(session.id);
  });

  const managed: ManagedSession = {
    session,
    status: initialStatus,
    model: profile.model,
    thinking: profile.thinking,
    permission: profile.permission,
    planMode: profile.planMode,
    additionalDirs: session.summary?.additionalDirs ?? [],
    metadata: profile.metadata ?? session.summary?.metadata,
    unsubscribe,
    hiddenAgentIds,
    btwRuns,
  };
  sessions.set(session.id, managed);
  emitStatus(session.id, initialStatus);
  return toEngineSession(session, initialStatus, managed.model);
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
    status: resolveServerEngineStatus(session),
    model: typeof config.model === "string" ? config.model : options.model,
    modelRevision: 0,
    thinking: typeof config.thinking === "string" ? config.thinking : options.thinking,
    permission: config.permission_mode === "auto" || config.permission_mode === "yolo"
      ? config.permission_mode
      : options.permission ?? "manual",
    planMode: typeof config.plan_mode === "boolean" ? config.plan_mode : options.planMode ?? false,
    swarmMode: typeof config.swarm_mode === "boolean" ? config.swarm_mode : false,
    additionalDirs: options.additionalDirs ?? [],
    metadata: session.metadata ?? options.metadata,
    btwRuns: new Map(),
    agentLifecycle: new Map(),
  };
  serverSessions.set(session.id, managed);
  await getServerClient().subscribe(session.id);
  await refreshServerSessionStatus(session.id, true).catch((error) => {
    if (isKimiCodeSessionMissingError(error)) {
      serverSessions.delete(session.id);
      console.warn(`[KimiCodeServerHost] session ${session.id} vanished during initial status refresh; removed stale Server binding.`);
      throw error;
    }
    console.warn(`[KimiCodeServerHost] refresh initial status failed for ${session.id}:`, error);
  });
  kimiCodeServerHost.setRouting("server");
  emitStatus(session.id, managed.status);
  return toServerEngineSession(managed);
}

function shouldRouteNewSessionToServer() {
  return isKimiCodeServerSessionRoutingEnabled(process.env) && kimiCodeServerHost.isReady();
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
  // 僵尸会话自愈：已打开的 Server 会话在 fallback 期间若继续停留在 serverSessions，
  // 后续操作会抛「Kimi Server 尚未就绪」且无法使用。把 idle 会话批量迁到 SDK（best effort），
  // 运行中/等待中的会话保留（其失败路径会走 createSdkFallbackSession）。
  void migrateIdleServerSessionsToSdk();
  scheduleServerRecovery();
}

async function migrateIdleServerSessionsToSdk() {
  const idleIds = [...serverSessions.entries()]
    .filter(([, managed]) => managed.status !== "running"
      && managed.status !== "waiting_approval" && managed.status !== "waiting_question")
    .map(([sessionId]) => sessionId);
  for (const sessionId of idleIds) {
    const serverManaged = serverSessions.get(sessionId);
    if (!serverManaged) continue;
    try {
      await migrateServerSessionToSdk(sessionId, serverManaged, {
        runningMessage: "Server 已降级，无法迁移运行中的会话。",
      });
      console.info(`[KimiCodeServerHost] migrated idle Server session ${sessionId} to SDK after runtime failure`);
    } catch (migrationError) {
      console.warn(`[KimiCodeServerHost] failed to migrate idle session ${sessionId} to SDK:`, migrationError);
    }
  }
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

// 临时帧级诊断（定位"实时 delta 缺帧"）：记录每个进入主进程的 WS 帧，
// 包括会被 sessionId 校验丢弃的帧。由 main.ts 通过 setFrameDiagLogger 注入。
let frameDiagLogger: ((line: string) => void) | null = null;
export function setFrameDiagLogger(logger: ((line: string) => void) | null) {
  frameDiagLogger = logger;
}

function handleServerFrame(frame: ServerFrame) {
  const sessionId = frame.session_id;
  if (frameDiagLogger) {
    try {
      const known = sessionId ? serverSessions.has(sessionId) : false;
      const payload = frame.payload && typeof frame.payload === "object" ? frame.payload as Record<string, unknown> : {};
      const partType = typeof payload.part === "object" && payload.part !== null ? (payload.part as { type?: unknown }).type : undefined;
      const reason = typeof payload.reason === "string" ? payload.reason : "";
      const agentId = typeof payload.agentId === "string" ? payload.agentId : "";
      const deltaLen = typeof payload.delta === "string" ? payload.delta.length
        : typeof (payload.part as { text?: unknown } | undefined)?.text === "string"
          ? String((payload.part as { text: string }).text).length
          : undefined;
      const offset = typeof frame.offset === "number" ? frame.offset : undefined;
      const summary = [partType ?? "", reason, agentId].filter(Boolean).join("/");
      const extra = [
        offset !== undefined ? `off=${offset}` : "",
        deltaLen !== undefined ? `dlen=${deltaLen}` : "",
      ].filter(Boolean).join(" ");
      frameDiagLogger(`[wsframe] ${frame.type} sid=${sessionId ? sessionId.slice(-8) : "-"} known=${known} seq=${frame.seq ?? "-"} vol=${frame.volatile === true ? 1 : 0} ${summary}${extra ? ` ${extra}` : ""}`);
    } catch { /* diag must never break frame handling */ }
  }
  if (!sessionId || !serverSessions.has(sessionId)) return;
  const payload = frame.payload && typeof frame.payload === "object"
    ? frame.payload as Record<string, unknown>
    : {};
  if (frame.type === "agent.created" || frame.type === "agent.disposed") {
    const agentId = typeof payload.agentId === "string" ? payload.agentId : undefined;
    const managedForAgent = serverSessions.get(sessionId);
    if (agentId && managedForAgent) {
      const lifecycle = managedForAgent.agentLifecycle.get(agentId) ?? {};
      if (frame.type === "agent.created") lifecycle.createdObservedAt ??= new Date().toISOString();
      else lifecycle.disposedObservedAt = new Date().toISOString();
      managedForAgent.agentLifecycle.set(agentId, lifecycle);
    }
  }
  if (frame.type === "kimix.server.snapshot") {
    const snapshot = payload as ServerSnapshot;
    const session = snapshot.session;
    const managed = serverSessions.get(sessionId);
    if (session && managed) {
      managed.session = session;
      const resolvedStatus = resolveServerEngineStatus(session);
      const terminalish = resolvedStatus !== "running" && resolvedStatus !== "waiting_approval" && resolvedStatus !== "waiting_question";
      const snapshotInFlight = snapshot.in_flight_turn && typeof snapshot.in_flight_turn === "object";
      // pre-POST snapshot 必然「prompt 到达前」(busy=false/inFlight=0)，不得把刚乐观
      // 置 running 的轮降级成 completed（实机：新轮 121ms 被定成「输出完成 1s」）。
      // mainTurnActive 期间终态判定交给 prompt.completed/settle 路径。
      if (!(terminalish && managed.mainTurnActive === true && !snapshotInFlight)) {
        setStatus(sessionId, resolvedStatus);
      }
      managed.mainTurnActive = snapshot.in_flight_turn && typeof snapshot.in_flight_turn === "object" ? true : session?.main_turn_active === true;
    }
    const replayFingerprint = `${snapshot.as_of_seq}|${snapshot.epoch ?? ""}|${snapshot.in_flight_turn && typeof snapshot.in_flight_turn === "object" ? 1 : 0}|${Array.isArray(snapshot.messages?.items) ? snapshot.messages.items.length : 0}`;
    const previousFingerprint = snapshotReplayFingerprints.get(sessionId);
    snapshotReplayFingerprints.set(sessionId, replayFingerprint);
    if (previousFingerprint === replayFingerprint) return;
    const snapshotItems = Array.isArray(snapshot.messages?.items) ? snapshot.messages.items : [];
    const latestItem = snapshotItems.length > 0 ? snapshotItems[snapshotItems.length - 1] : undefined;
    const latestItemId = latestItem && typeof latestItem === "object" && typeof (latestItem as Record<string, unknown>).id === "string"
      ? (latestItem as Record<string, unknown>).id as string
      : undefined;
    const previousLatestId = lastSnapshotLatestMessageIds.get(sessionId);
    if (latestItemId) lastSnapshotLatestMessageIds.set(sessionId, latestItemId);
    let replayStartIndex = 0;
    if (previousLatestId !== undefined) {
      const previousIndex = snapshotItems.findIndex((item) => (
        typeof item === "object" && item !== null && (item as Record<string, unknown>).id === previousLatestId
      ));
      // 找不到（窗口滑动）才全量重放；找到则只重放其后新增消息。
      replayStartIndex = previousIndex >= 0 ? previousIndex + 1 : 0;
    }
    const replaySnapshot: ServerSnapshot = replayStartIndex > 0
      ? { ...snapshot, messages: { ...snapshot.messages, items: snapshotItems.slice(replayStartIndex) } }
      : snapshot;
    for (const replayFrame of snapshotMessagesToServerFrames(replaySnapshot, sessionId)) {
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
    // 快照重放后顺手对账：这份快照的 pending 列表已不含、但本地仍跟踪的提问即外部
    // 已回答（重连恢复路径，外部轮次的 live 帧可能整段缺席）。复用快照免重复抓取。
    void settleExternallyResolvedServerQuestions(sessionId, 0, extractPendingServerQuestionIds(payload));
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
    // 新提问到达即证明同会话此前跟踪的提问已被外部回答（提问阻塞 Agent，单 pending
    // 不变量）：先对账旧条目再登记本条，覆盖「外部答 Q1→立即追问 Q2」无输出帧的场景。
    void settleExternallyResolvedServerQuestions(sessionId);
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
  updateStatusFromEvent(sessionId, event, "prompt");
  if (isTurnCompletionEventType(frame.type) && !isSnapshotReplayFrame(frame)) recordTurnCompletion(sessionId);
  // Live tool frames after a premature completed status prove the Server is still
  // working (agent-core may keep tool work after a prompt.completed delivery
  // barrier). Re-open running so the renderer does not stay on 已连接 / 输出完成
  // while tools continue (diag: settled_complete then tool.call.started via
  // watchdog recoverSnapshot, tool counts still climbing).
  const turnTrack = serverSessions.get(sessionId);
  if (turnTrack && (frame.type === "thinking.delta" || frame.type === "assistant.delta")) turnTrack.mainTurnActive = true;
  if (
    (frame.type === "tool.call.started" || frame.type === "tool.call.delta" || frame.type === "thinking.delta" || frame.type === "assistant.delta")
    && serverSessions.get(sessionId)?.status === "completed"
    && serverSessions.get(sessionId)?.mainTurnActive !== false
  ) {
    setStatus(sessionId, "running");
  }
  // 外部（Web/CLI）回答提问后 Server 不广播 resolved 帧，且外部轮次的
  // prompt.completed/状态迁移可能整段缺席：主 Agent 恢复输出是唯一可靠信号，
  // 翻回 running 并经 setStatus 触发提问对账（helper 已过滤子代理帧与审批场景）。
  if (shouldResumeWaitingQuestionOnFrame(frame.type, serverSessions.get(sessionId)?.status, payload.agentId)) {
    setStatus(sessionId, "running");
  }
  if (frame.type === "prompt.completed") {
    // 0.29 实测：Swarm/Agent 子代理的 prompt.completed 携带子代理自己的 agentId。
    // 只有主 Agent 的 prompt.completed 才可能结束本会话轮次；子代理的完成帧
    // 不得把仍在运行的主轮置为 completed（否则底部误显示「已完成」并抖动）。
    //
    // prompt.completed 是交付屏障，不是 engine 终态：v2 权威信号是 /status.busy。
    // 立刻 setStatus(completed) 会清 runningSessionId、停 poll，UI 把中间 assistant
    // 当最终正文；若 Server 仍 busy/后续还有 tool，表现为伪正文 + 折叠 + 卡住。
    // 必须以 refresh 后的 busy 再落 engine 状态。
    const completedAgentId = typeof payload.agentId === "string" && payload.agentId ? payload.agentId : "main";
    if (completedAgentId === "main") {
      const completedManaged = serverSessions.get(sessionId);
      if (completedManaged) completedManaged.mainTurnActive = false;
      void settleServerSessionAfterPromptCompleted(sessionId).catch((error) => {
        console.warn(`[KimiCodeServerHost] settle after prompt.completed failed for ${sessionId}:`, error);
      });
    }
  }
}

/**
 * Pure decision: after main-agent prompt.completed, map refreshed /status into
 * the engine status we should publish. busy=true keeps running; unknown stays
 * running (do not fake completed); idle maps to completed so the renderer
 * terminal path (which ignores bare idle) still settles.
 */
export function resolveEngineStatusAfterPromptCompleted(
  source: { status?: unknown; busy?: unknown },
  mainTurnActive?: boolean,
): KimiCodeEngineStatus {
  const engine = resolveServerEngineStatus(source);
  // busy=true 但主轮已结束（仅后台任务挂着）：后台任务不钉住轮次 running。
  if (engine === "running" && mainTurnActive === false) return "completed";
  if (engine === "running" || engine === "waiting_approval" || engine === "waiting_question") return engine;
  if (engine === "error" || engine === "interrupted") return engine;
  if (engine === "unknown") return "running";
  // idle / completed
  return "completed";
}

/** Long continuation grace is only justified by explicit continuation work. */
export function shouldDelayServerPromptCompletion(input: {
  goalStatus?: unknown;
  queuedPromptCount?: unknown;
}): boolean {
  const goalStatus = typeof input.goalStatus === "string" ? input.goalStatus.trim().toLowerCase() : "";
  const queuedPromptCount = typeof input.queuedPromptCount === "number" && Number.isFinite(input.queuedPromptCount)
    ? input.queuedPromptCount
    : 0;
  return goalStatus === "active" || queuedPromptCount > 0;
}

/**
 * After main-agent prompt.completed, ask Server /status (busy-authoritative) and
 * only terminalize when activity is not active.
 */
async function settleServerSessionAfterPromptCompleted(sessionId: string): Promise<void> {
  const managed = serverSessions.get(sessionId);
  if (!managed) return;
  const before = managed.status;
  if (before === "interrupted" || before === "error") return;
  try {
    const status = await refreshServerSessionStatus(sessionId, true);
    // re-read: concurrent cancel/error may have landed during refresh
    const current = serverSessions.get(sessionId)?.status;
    if (current === "interrupted" || current === "error") return;
    let mainTurnActive: boolean | undefined;
    try {
      const snap = await getServerClient().getSnapshot(sessionId);
      mainTurnActive = snap.in_flight_turn && typeof snap.in_flight_turn === "object"
        ? true
        : snap.session?.main_turn_active === true;
      const managedNow = serverSessions.get(sessionId);
      if (managedNow) managedNow.mainTurnActive = mainTurnActive;
    } catch {
      mainTurnActive = undefined; // 无法确认时保守按 busy
    }
    const resolved = resolveEngineStatusAfterPromptCompleted(status, mainTurnActive);
    // 中间步骤（活动 Goal / 已排队 prompt）的 prompt.completed 后 REST 会短暂返回
    // idle 且 main_turn_active=false。仅有明确续轮证据时才保留 grace；普通提示立即
    // settle，避免完整输出后仍卡 30s。grace 内 assistant.delta 会重新置 active，
    // 到期回调便不再 settle（实机曾观测 prompt.completed 后延迟续轮）。
    if (resolved === "completed") {
      const [prompts, goalState] = await Promise.all([
        getServerClient().listPrompts(sessionId).catch(() => null),
        getServerClient().getGoal(sessionId).catch(() => null) as Promise<{ goal?: KimiCodeGoalSnapshot | null } | null>,
      ]);
      const shouldDelay = shouldDelayServerPromptCompletion({
        goalStatus: goalState?.goal?.status,
        queuedPromptCount: prompts?.queued.length,
      });
      const publishCompletion = () => {
        const m = serverSessions.get(sessionId);
        if (!m || m.status === "interrupted" || m.status === "error") return;
        if (m.status === "waiting_approval" || m.status === "waiting_question") return;
        if (m.mainTurnActive === true) return; // 续轮已恢复，不 settle
        setStatus(sessionId, "completed");
        const settledTurnModel = status.model?.trim();
        if (settledTurnModel) eventSink?.({ sessionId, event: { type: "kimix.turn.model", model: settledTurnModel, phase: "settle" } });
      };
      if (shouldDelay) {
        setTimeout(publishCompletion, 30_000).unref?.();
      } else {
        publishCompletion();
      }
      return;
    }
    setStatus(sessionId, resolved);
    // settle 后以 server 实际模型补一次当轮盖章：覆盖外部（Web 发起）轮次——它们没有
    // sendPrompt 的意图信号；渲染层只填空，不覆盖 dispatch 时已盖章的值。
    const settledTurnModel = status.model?.trim();
    if (settledTurnModel) eventSink?.({ sessionId, event: { type: "kimix.turn.model", model: settledTurnModel, phase: "settle" } });
  } catch (error) {
    console.warn(`[KimiCodeServerHost] refresh after prompt.completed failed for ${sessionId}:`, error);
    const current = serverSessions.get(sessionId)?.status;
    if (current !== "interrupted" && current !== "error") {
      // 无法确认 busy 时保守保持 running，避免假完成；poll 会再收敛
      setStatus(sessionId, "running");
    }
  }
}

async function refreshServerSessionStatus(sessionId: string, emitEvent: boolean): Promise<ServerSessionStatus> {
  const managed = serverSessions.get(sessionId);
  if (!managed) throw new Error(`Kimi Server session is not active: ${sessionId}`);
  const modelRevision = managed.modelRevision;
  const status = await getServerClient().getSessionStatus(sessionId);
  // 轮中（mainTurnActive）本地模型选择是用户对本轮的意图，server 状态刷新不得回写覆盖
  // （实机：新会话切 k3 发送后被 status 刷回 deepseek）。
  const modelMutationPending = Boolean(managed.modelMutation) || managed.mainTurnActive === true;
  const applyStatusModel = shouldApplyServerModelRefresh(
    modelRevision,
    managed.modelRevision,
    modelMutationPending,
  );
  if (status.model && applyStatusModel) {
    managed.model = status.model;
  }
  const effectiveStatus = {
    ...status,
    model: resolveServerModelRefresh(
      status.model,
      managed.model,
      applyStatusModel,
      modelMutationPending,
    ),
  };
  managed.thinking = status.thinking_level;
  if (status.permission === "manual" || status.permission === "auto" || status.permission === "yolo") {
    managed.permission = status.permission;
  }
  managed.planMode = status.plan_mode;
  managed.swarmMode = status.swarm_mode;
  if (emitEvent) eventSink?.({ sessionId, event: { ...serverStatusToAgentEvent(effectiveStatus), kimixStatusRefresh: true } });
  return effectiveStatus;
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

/**
 * Renderer polling must consume the same effective status as the Host state
 * machine. During the prompt.completed continuation grace, Server REST may
 * already report idle while the Host deliberately remains running. Exposing
 * that raw idle created a second terminal authority in App.tsx and completed
 * a still-open assistant before its buffered body was materialized.
 */
export function resolveEffectiveServerEngineStatus(
  status: { status?: unknown; busy?: unknown },
  managedStatus?: KimiCodeEngineStatus,
): KimiCodeEngineStatus {
  const rawStatus = resolveServerEngineStatus(status);
  if (managedStatus === "waiting_approval" || managedStatus === "waiting_question") return managedStatus;
  if (managedStatus === "error" || managedStatus === "interrupted") return managedStatus;
  if (rawStatus === "running" || rawStatus === "waiting_approval" || rawStatus === "waiting_question") {
    return rawStatus;
  }
  if (managedStatus === "running") return "running";
  return rawStatus;
}

function serverStatusToKimiCodeStatus(
  status: ServerSessionStatus,
  usage: unknown,
  managedStatus?: KimiCodeEngineStatus,
): KimiCodeSessionStatus {
  return {
    engineStatus: resolveEffectiveServerEngineStatus(status, managedStatus),
    model: status.model,
    thinkingLevel: status.thinking_level,
    permission: status.permission === "manual" || status.permission === "auto" || status.permission === "yolo"
      ? status.permission
      : undefined,
    planMode: status.plan_mode,
    swarmMode: status.swarm_mode,
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

function serverControls(managed: ServerManagedSession, promptModel?: string): Record<string, unknown> {
  return {
    model: resolvePromptModel(promptModel, managed.model) ?? "kimi-code/kimi-for-coding",
    // 空串不发送（server zod 要求 >=1 字符，实机新会话 managed.thinking="" 致 POST 被拒）；缺省时 server 用会话默认。
    thinking: typeof managed.thinking === "string" && managed.thinking.length > 0 ? managed.thinking : undefined,
    permission_mode: managed.permission,
    plan_mode: managed.planMode,
    // 会话 swarm_mode 为真时随请求显式携带（官方 0.31+ prompts schema）；为假时
    // 不写字段，避免请求级 false 覆盖会话级 true。
    ...(managed.swarmMode ? { swarm_mode: true } : {}),
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
    const question = raw as { id?: unknown; question?: unknown; label?: unknown; options?: unknown };
    if (typeof question.id !== "string") return [];
    if (skipped) return [[question.id, { kind: "skipped" }]];
    const readableQuestion = typeof question.question === "string"
      ? question.question
      : (typeof question.label === "string" ? question.label : undefined);
    const value = answers[question.id] ?? (readableQuestion ? answers[readableQuestion] : undefined);
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

/**
 * agent-core-v2 的权威运行信号是 busy：整个 prompt 期间（含 step 间隙）保持 true，
 * 且 v2 的 /status 响应不再携带 status 字符串字段。busy 缺失时回退到 v1 status；
 * 缺失、畸形或未来状态保持 unknown，不能伪装成 idle/完成。
 */
export function resolveServerEngineStatus(source: { status?: unknown; busy?: unknown }): KimiCodeEngineStatus {
  const activity = classifyServerSessionActivity(source);
  const status = typeof source.status === "string" ? source.status.trim().toLowerCase() : "";
  if (activity === "active") {
    if (status === "awaiting_approval") return "waiting_approval";
    if (status === "awaiting_question") return "waiting_question";
    return "running";
  }
  if (activity === "terminal") {
    if (status === "aborted" || status === "interrupted" || status === "cancelled" || status === "canceled") return "interrupted";
    if (status === "error" || status === "failed") return "error";
    if (status === "completed") return "completed";
    return "idle";
  }
  return "unknown";
}

function toServerEngineSession(managed: ServerManagedSession): KimiCodeEngineSession {
  return {
    sessionId: managed.session.id,
    workDir: managed.workDir,
    status: managed.status,
    model: managed.model,
    additionalDirs: managed.additionalDirs,
  };
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
    lastTurnReason: session.last_turn_reason,
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

async function readWireTail(wireFile: string): Promise<string> {
  const handle = await fs.promises.open(wireFile, "r");
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, COMPACTION_WIRE_TAIL_BYTES);
    if (length <= 0) return "";
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    return buffer.toString("utf-8");
  } finally {
    await handle.close();
  }
}

async function waitForOfficialCompactionResult(
  sessionId: string,
  workDir: string,
  startedAt: number,
): Promise<OfficialCompactionResult> {
  const deadline = Date.now() + COMPACTION_WIRE_CONFIRM_TIMEOUT_MS;
  let wireFile = await getSessionWireFile(sessionId, workDir);
  while (Date.now() <= deadline) {
    if (!wireFile) wireFile = await getSessionWireFile(sessionId, workDir);
    if (wireFile) {
      const content = await readWireTail(wireFile).catch(() => "");
      const result = findOfficialCompactionResult(content, startedAt);
      if (result) return result;
    }
    await delay(COMPACTION_WIRE_CONFIRM_INTERVAL_MS);
  }
  throw new Error("等待 Server 返回上下文压缩结果超时。");
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

function updateStatusFromEvent(sessionId: string, event: unknown, terminalScope: "turn" | "prompt" = "turn") {
  statusSequencer.handle(sessionId, event, terminalScope);
}

// 其他客户端（如官方 Web）回应审批后 Server 不广播 resolved 帧：只把条目从 pending_approvals
// 移除并让会话状态离开 waiting_approval。不补这条链路，Kimix 的审批卡会永远「待审批」。
// 状态迁移时回读 snapshot，对已不在 pending 列表的审批按去向发 settle 事件
// （running/completed 视为 approved，其余视为 rejected）。本地 respondApproval 路径先删 id
// 再改状态，不会误触发。
// 审批通过后 Server 可能直接进入 waiting_question（继续追问澄清），与
// running/completed 一样视为 approved；只有其余去向（error/interrupted 等）才是 rejected。
export function resolveExternalApprovalSettleStatus(status: KimiCodeEngineStatus): "approved" | "rejected" {
  return status === "running" || status === "completed" || status === "waiting_question" ? "approved" : "rejected";
}

async function settleExternallyResolvedServerApprovals(
  sessionId: string,
  nextStatus: KimiCodeEngineStatus,
  attempt = 0,
): Promise<void> {
  const keys = [...serverApprovalIds].filter((key) => key.startsWith(`${sessionId}:`));
  if (keys.length === 0) return;
  let stillPending: Set<string> | null = null;
  try {
    const snapshot = await getServerClient().getSnapshot(sessionId);
    stillPending = new Set(
      (Array.isArray(snapshot.pending_approvals) ? snapshot.pending_approvals : [])
        .map((approval) => (approval && typeof approval === "object"
          ? (approval as Record<string, unknown>).approval_id
          : undefined))
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );
  } catch {
    // 快照读取失败时保守跳过 settle：无法确认哪些审批已从 pending 移除，
    // 误 settle（把仍在等待的审批报成已批准）比多留一会儿更糟。但本函数是唯一
    // 对账入口，直接放弃会让外部已回应的审批永久「待审批」——做有上限的退避重试。
    if (attempt < 3) {
      setTimeout(() => {
        void settleExternallyResolvedServerApprovals(sessionId, nextStatus, attempt + 1);
      }, 2_000 * (attempt + 1));
    }
    return;
  }
  const settleStatus = resolveExternalApprovalSettleStatus(nextStatus);
  for (const key of keys) {
    const requestId = key.slice(sessionId.length + 1);
    if (stillPending?.has(requestId)) continue;
    serverApprovalIds.delete(key);
    eventSink?.({
      sessionId,
      event: { type: "kimix.approval.resolved", requestId, status: settleStatus },
    });
  }
}

/** 快照 pending_questions → 仍待回答的 question_id 集合（外部 settle 对账用）。 */
export function extractPendingServerQuestionIds(snapshot: { pending_questions?: unknown }): Set<string> {
  return new Set(
    (Array.isArray(snapshot.pending_questions) ? snapshot.pending_questions : [])
      .map((question) => (question && typeof question === "object"
        ? (question as Record<string, unknown>).question_id
        : undefined))
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
}

/** 本地跟踪且已不在官方 pending 列表的提问 → 外部已回答，需要 settle。 */
export function selectExternallyResolvedQuestionIds(trackedIds: readonly string[], pendingIds: ReadonlySet<string>): string[] {
  return trackedIds.filter((requestId) => !pendingIds.has(requestId));
}

/** waiting_question 期间到达即证明提问已被外部回答的轮次活动帧。 */
const WAITING_QUESTION_RESUME_FRAME_TYPES: ReadonlySet<string> = new Set([
  "thinking.delta",
  "assistant.delta",
  "content.part",
  "tool.call.started",
  "tool.call.delta",
  "tool.result",
]);

/**
 * waiting_question 期间收到主 Agent 的轮次活动帧 → 提问已被外部（Web/CLI）回答，
 * 应翻回 running（经 setStatus 触发提问对账）。只认主 Agent 帧：Swarm 子代理在主
 * Agent 阻塞等回答时仍会输出。审批不走这条：拒绝后同样有输出，无法区分去向。
 */
export function shouldResumeWaitingQuestionOnFrame(
  frameType: string,
  status: KimiCodeEngineStatus | undefined,
  agentId: unknown,
): boolean {
  if (status !== "waiting_question") return false;
  if (typeof agentId === "string" && agentId && agentId !== "main") return false;
  return WAITING_QUESTION_RESUME_FRAME_TYPES.has(frameType);
}

// 与审批（settleExternallyResolvedServerApprovals）同理：其他客户端（官方 Web/CLI）
// 回答提问后 Server 不广播 resolved 帧，只把条目从 pending_questions 移除。不补这条
// 链路，Kimix 的提问卡会永远「待回答」。回读 snapshot，对已不在 pending 列表的提问
// 发 settle 事件（外部回答一律视为 answered——提问没有 rejected 去向，过期/失活由
// 本地 settleInactiveEvents 兜底）。本地 respondQuestion 先删 id 再改状态，不会误触发。
// 触发点（实机 v2.20.270：外部轮次的 prompt.completed/状态迁移可能整段缺席，
// 单触发点不可靠，提问卡残留待回答）：
// 1) setStatus 迁出 waiting_question；2) waiting_question 期间主 Agent 输出帧到达
//    （先翻 running 再经 1 触发）；3) 新 question.requested 到达前对账旧条目；
// 4) 快照重放后用手头快照对账（prefetchedPendingIds，免重复抓取）。
async function settleExternallyResolvedServerQuestions(
  sessionId: string,
  attempt = 0,
  prefetchedPendingIds?: ReadonlySet<string>,
): Promise<void> {
  const keys = [...serverQuestionIds].filter((key) => key.startsWith(`${sessionId}:`));
  if (keys.length === 0) return;
  // prefetchedPendingIds：调用方刚拿到的权威快照（快照重放路径）直接复用，免重复抓取。
  let stillPending: Set<string> | null = prefetchedPendingIds ? new Set(prefetchedPendingIds) : null;
  if (!stillPending) {
    try {
      const snapshot = await getServerClient().getSnapshot(sessionId);
      stillPending = extractPendingServerQuestionIds(snapshot);
    } catch {
      // 快照读取失败时保守跳过 settle：无法确认哪些提问已从 pending 移除，
      // 误 settle（把仍在等待的提问报成已回答）比多留一会儿更糟。做有上限的退避重试。
      if (attempt < 3) {
        setTimeout(() => {
          void settleExternallyResolvedServerQuestions(sessionId, attempt + 1);
        }, 2_000 * (attempt + 1));
      }
      return;
    }
  }
  const trackedIds = keys.map((key) => key.slice(sessionId.length + 1));
  for (const requestId of selectExternallyResolvedQuestionIds(trackedIds, stillPending)) {
    serverQuestionIds.delete(pendingKey(sessionId, requestId));
    serverQuestionRequests.delete(pendingKey(sessionId, requestId));
    eventSink?.({
      sessionId,
      event: { type: "kimix.question.resolved", requestId, status: "answered" },
    });
  }
}

function setStatus(sessionId: string, status: KimiCodeEngineStatus) {
  const serverManaged = serverSessions.get(sessionId);
  if (serverManaged) {
    if (serverManaged.status === status) return;
    const previousStatus = serverManaged.status;
    serverManaged.status = status;
    if (previousStatus === "waiting_approval") {
      void settleExternallyResolvedServerApprovals(sessionId, status);
    }
    if (previousStatus === "waiting_question") {
      void settleExternallyResolvedServerQuestions(sessionId);
    }
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

function toEngineSession(
  session: KimiCodeSessionLike,
  status: KimiCodeEngineStatus,
  model?: string,
): KimiCodeEngineSession {
  return {
    sessionId: session.id,
    workDir: session.workDir,
    status,
    model,
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
      productName: "Kimix",
      version: process.env.KIMI_CODE_SMOKE_VERSION ?? app.getVersion(),
      platform: "kimi_code_desktop",
    },
    uiMode: "kimix",
  };
  // 默认走 v2 引擎（SDKRpcClientV2）：两引擎写同一份会话存储（state.json/wire.jsonl 同构），
  // 来回切换无需数据迁移；KIMIX_SDK_ENGINE=v1 时整体回退 v1 引擎。
  const useV1Engine = process.env.KIMIX_SDK_ENGINE === "v1";
  if (!useV1Engine && sdk.createKimiHarnessV2) {
    harness = sdk.createKimiHarnessV2(options);
  } else {
    if (!useV1Engine) {
      // 防御旧 bundle：无 createKimiHarnessV2 导出时回退 v1。
      console.warn("[KimiCodeHost] SDK bundle 未导出 createKimiHarnessV2，回退到 v1 引擎。");
    }
    if (sdk.createKimiHarness) {
      harness = sdk.createKimiHarness(options);
    } else if (sdk.KimiHarness) {
      harness = new sdk.KimiHarness(options);
    } else {
      throw new Error("Official Kimi Code SDK does not export KimiHarness/createKimiHarness.");
    }
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
