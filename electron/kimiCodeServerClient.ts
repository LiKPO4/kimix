export type ServerPromptPart =
  | { type: "text"; text: string }
  | { type: "image"; source: { kind: "url"; url: string } | { kind: "base64"; media_type: string; data: string } | { kind: "file"; file_id: string } };

type ServerPromptUpload = (input: { name: string; mediaType: string; data: string }) => Promise<{ id: string }>;
type ServerClientOptions = {
  onReconnecting?: () => void;
  onReconnected?: () => void;
  onRuntimeFailure?: (error: Error) => void;
  reconnectFailureThreshold?: number;
};

export type ServerSession = {
  id: string;
  workspace_id?: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  status: string;
  archived?: boolean;
  metadata?: Record<string, unknown>;
  agent_config?: Record<string, unknown>;
  usage?: Record<string, unknown>;
};

export type ServerWorkspace = {
  id: string;
  root: string;
  name: string;
  is_git_repo: boolean;
  branch: string | null;
  created_at: string;
  last_opened_at: string;
  session_count: number;
};

export type ServerFsSearchHit = {
  path: string;
  name: string;
  kind: "file" | "directory" | "symlink";
  score: number;
  match_positions: number[];
};

export type ServerFsReadResult = {
  path: string;
  content: string;
  encoding: "utf-8" | "base64";
  size: number;
  truncated: boolean;
  etag: string;
  mime: string;
  language_id?: string;
  line_count?: number;
  is_binary: boolean;
};

export type ServerSessionStatus = {
  status: string;
  model?: string;
  thinking_level: string;
  permission: string;
  plan_mode: boolean;
  swarm_mode: boolean;
  context_tokens: number;
  max_context_tokens: number;
  context_usage: number;
};

export type ServerSkill = {
  name: string;
  description: string;
  path: string;
  source: string;
  type?: string;
  disable_model_invocation?: boolean;
};

export type ServerMcpServer = {
  id: string;
  name: string;
  transport: "stdio" | "http" | "sse";
  status: "connected" | "connecting" | "disconnected" | "error";
  last_error?: string;
  tool_count: number;
};

export type ServerTool = {
  name: string;
  description: string;
  input_schema: unknown;
  source: "builtin" | "skill" | "mcp";
  mcp_server_id?: string;
};

export type ServerConnection = {
  id: string;
  connected_at: string;
  remote_address: string | null;
  user_agent: string | null;
  has_client_hello: boolean;
  subscriptions: string[];
};

export type ServerAuthSummary = {
  ready: boolean;
  providers_count: number;
  default_model: string | null;
  managed_provider: { name: string; status: "authenticated" | "expired" | "revoked" | "unauthenticated" } | null;
};

export type ServerOAuthFlow = {
  flow_id: string;
  provider: string;
  verification_uri: string;
  verification_uri_complete: string;
  user_code: string;
  expires_in: number;
  interval: number;
  status: "pending";
  expires_at: string;
};

export type ServerModelCatalogItem = {
  provider: string;
  model: string;
  display_name?: string;
  max_context_size: number;
  capabilities?: string[];
};

export type ServerProviderCatalogItem = {
  id: string;
  type: string;
  base_url?: string;
  default_model?: string;
  has_api_key: boolean;
  status: "connected" | "error" | "unconfigured";
  models?: string[];
};

export type ServerBackgroundTask = {
  id: string;
  session_id: string;
  kind: "subagent" | "bash" | "tool";
  description: string;
  status: "running" | "completed" | "failed" | "cancelled";
  command?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  output_preview?: string;
  output_bytes?: number;
};

export type ServerMessageSummary = {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: unknown[];
  created_at: string;
  prompt_id?: string;
};

export type ServerPromptSummary = {
  prompt_id: string;
  user_message_id: string;
  status: string;
  created_at: string;
};

export type ServerTerminal = {
  id: string;
  session_id: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  status: "running" | "exited";
  created_at: string;
  exited_at?: string;
  exit_code?: number | null;
};

export type ServerFrame = {
  type: string;
  id?: string;
  code?: number;
  msg?: string;
  seq?: number;
  epoch?: string;
  volatile?: boolean;
  session_id?: string;
  payload?: unknown;
};

type ServerEnvelope<T> = { code: number; msg?: string; data: T };
type FrameListener = (frame: ServerFrame) => void;
type ServerCursor = { seq: number; epoch?: string };

export type ServerSnapshot = {
  as_of_seq: number;
  epoch?: string;
  session: ServerSession;
  messages?: { items?: unknown[]; has_more?: boolean };
  in_flight_turn?: unknown;
  pending_approvals?: unknown[];
  pending_questions?: unknown[];
};

  const CONTROL_TIMEOUT_MS = 5_000;
  const PROMPT_TIMEOUT_MS = 120_000;
  const UPLOAD_TIMEOUT_MS = 300_000;

export function isKimiCodeServerSessionRoutingEnabled(
  env: NodeJS.ProcessEnv = process.env,
  settings?: { experimentalKimiServerSessions?: boolean },
) {
  const override = env.KIMIX_EXPERIMENTAL_KIMI_SERVER_SESSIONS?.trim();
  if (override !== undefined) return override === "1";
  return settings?.experimentalKimiServerSessions !== false;
}

/** HTTP 状态码或协议级别的 "not found" 错误识别。
 *  优先检查 error 上的数字状态码，正则作向后兼容兜底。 */
// 404=不存在 410=已归档；409 是 Conflict（非 missing），归 inactive 检查
const SESSION_NOT_FOUND_CODES = [404, 410];
const SESSION_NOT_FOUND_RE = /(?:HTTP\s+404|session not found|was not found|unknown session|does not exist|会话不存在|session.*missing)/i;

function getErrorStatusCode(error: unknown): number | undefined {
  const err = error as Record<string, unknown>;
  return typeof err.statusCode === "number" ? err.statusCode
    : typeof err.code === "number" ? err.code
    : err.cause && typeof (err.cause as Record<string, unknown>).statusCode === "number"
      ? (err.cause as Record<string, unknown>).statusCode as number
      : undefined;
}

export function isKimiCodeSessionMissingError(error: unknown) {
  const statusCode = getErrorStatusCode(error);
  if (statusCode !== undefined) return SESSION_NOT_FOUND_CODES.includes(statusCode);
  const message = error instanceof Error ? error.message : String(error);
  return SESSION_NOT_FOUND_RE.test(message);
}

export function getKimiCodeSessionAlreadyExistsId(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!/already exists/i.test(message)) return null;
  return message.match(/Session\s+"([^"]+)"/i)?.[1]
    ?? message.match(/\bsession[_-][0-9a-z-]+/i)?.[0]
    ?? null;
}

export function isKimiCodeSessionAlreadyExistsError(error: unknown) {
  return getKimiCodeSessionAlreadyExistsId(error) !== null;
}

export function toServerConfigPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const topLevelKeys: Record<string, string> = {
    defaultProvider: "default_provider",
    defaultModel: "default_model",
    defaultThinking: "default_thinking",
  };
  const providerKeys: Record<string, string> = {
    apiKey: "api_key",
    baseUrl: "base_url",
    defaultModel: "default_model",
    customHeaders: "custom_headers",
  };
  const modelKeys: Record<string, string> = {
    maxContextSize: "max_context_size",
    maxOutputSize: "max_output_size",
    displayName: "display_name",
    reasoningKey: "reasoning_key",
    adaptiveThinking: "adaptive_thinking",
  };
  const rename = (value: unknown, keys: Record<string, string>) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [keys[key] ?? key, item]));
  };
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => {
    if (key === "providers" && value && typeof value === "object" && !Array.isArray(value)) {
      return [key, Object.fromEntries(Object.entries(value).map(([id, provider]) => [id, rename(provider, providerKeys)]))];
    }
    if (key === "models" && value && typeof value === "object" && !Array.isArray(value)) {
      return [key, Object.fromEntries(Object.entries(value).map(([id, model]) => [id, rename(model, modelKeys)]))];
    }
    return [topLevelKeys[key] ?? key, value];
  }));
}

export async function toServerPromptContent(
  input: string | Array<{ type: string; text?: string; imageUrl?: { url: string; id?: string } }>,
  upload?: ServerPromptUpload,
): Promise<ServerPromptPart[]> {
  if (typeof input === "string") return [{ type: "text", text: input }];
  return Promise.all(input.map(async (part) => {
    if (part.type === "text") return { type: "text", text: part.text ?? "" };
    const url = part.imageUrl?.url ?? "";
    const dataUrl = url.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
    if (dataUrl) {
      const mediaType = sniffImageMediaType(dataUrl[2]) ?? dataUrl[1];
      if (upload) {
        const file = await upload({
          name: part.imageUrl?.id?.trim() || "image",
          mediaType,
          data: dataUrl[2],
        });
        return { type: "image", source: { kind: "file", file_id: file.id } };
      }
      return { type: "image", source: { kind: "base64", media_type: mediaType, data: dataUrl[2] } };
    }
    return { type: "image", source: { kind: "url", url } };
  }));
}

function sniffImageMediaType(base64: string): string | undefined {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return undefined;
  }
  if (bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6) {
    const header = bytes.subarray(0, 6).toString("ascii");
    if (header === "GIF87a" || header === "GIF89a") return "image/gif";
  }
  if (bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return undefined;
}

export function flattenServerEvent(frame: ServerFrame): Record<string, unknown> {
  const payload = frame.payload && typeof frame.payload === "object"
    ? frame.payload as Record<string, unknown>
    : {};
  return { type: frame.type, ...payload, seq: frame.seq };
}

export function mergeServerRelatedSessions(parentId: string, children: ServerSession[], sessions: ServerSession[]): ServerSession[] {
  const related = new Map(children.map((session) => [session.id, session]));
  for (const session of sessions) {
    if (session.metadata?.forkedFrom === parentId) related.set(session.id, session);
  }
  return [...related.values()];
}

export function normalizeServerTerminalCreateError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("conpty.node") || message.includes("Failed to load native module")) {
    return new Error([
      "官方 Kimi Code Server 终端创建失败：当前 Windows 0.17.1 安装包缺少可加载的 ConPTY native 模块（conpty.node）。",
      "Kimix 已接入 terminal create/list/close 与 attach/input/resize 接口，但需要官方 CLI 修复或补齐 native 模块后才能创建内嵌终端。",
      `原始错误：${message}`,
    ].join("\n"));
  }
  return error instanceof Error ? error : new Error(message);
}

export function snapshotMessagesToServerFrames(snapshot: ServerSnapshot, sessionId: string): ServerFrame[] {
  const historyItems = Array.isArray(snapshot.messages?.items) ? snapshot.messages.items : [];
  const inFlight = isRecord(snapshot.in_flight_turn) ? snapshot.in_flight_turn : {};
  const messages = "messages" in inFlight ? inFlight.messages : ("message" in inFlight ? [inFlight.message] : inFlight.items);
  const inFlightItems = Array.isArray(messages) ? messages : [];
  return [
    ...historyItems.flatMap((item) => snapshotMessageToServerFrames(item, sessionId, snapshot.as_of_seq, snapshot.epoch, "history")),
    ...inFlightItems.flatMap((item) => snapshotMessageToServerFrames(item, sessionId, snapshot.as_of_seq, snapshot.epoch, "in_flight")),
  ];
}

export function snapshotToHistoryFrames(snapshot: ServerSnapshot, sessionId: string): ServerFrame[] {
  const frames = snapshotMessagesToServerFrames(snapshot, sessionId);
  const seq = snapshot.as_of_seq;
  const epoch = snapshot.epoch;
  for (const approval of snapshot.pending_approvals ?? []) {
    if (!approval || typeof approval !== "object") continue;
    frames.push({ type: "event.approval.requested", session_id: sessionId, seq, epoch, payload: approval });
  }
  for (const question of snapshot.pending_questions ?? []) {
    if (!question || typeof question !== "object") continue;
    frames.push({ type: "event.question.requested", session_id: sessionId, seq, epoch, payload: question });
  }
  return frames;
}

export class KimiCodeServerClient {
  private socket: WebSocket | null = null;
  private connected: Promise<void> | null = null;
  private readonly listeners = new Set<FrameListener>();
  private readonly subscribed = new Set<string>();
  private readonly cursors = new Map<string, ServerCursor>();
  private readonly recoveringSnapshots = new Set<string>();
  private readonly queued: ServerFrame[] = [];
  private readonly waiters = new Set<{
    match: (frame: ServerFrame) => boolean;
    resolve: (frame: ServerFrame) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private nextId = 0;
  private closing = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private runtimeFailureNotified = false;

  constructor(readonly endpoint: string, private readonly options: ServerClientOptions = {}) {}

  async createSession(input: {
    workDir: string;
    id?: string;
    model?: string;
    thinking?: string;
    permission?: string;
    planMode?: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<ServerSession> {
    const workspace = await this.createWorkspace(input.workDir);
    return this.request("/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify({
        id: input.id,
        workspace_id: workspace.id,
        metadata: { ...input.metadata, cwd: workspace.root },
        agent_config: {
          model: input.model,
          thinking: input.thinking ?? "off",
          permission_mode: input.permission ?? "manual",
          plan_mode: input.planMode ?? false,
        },
      }),
    });
  }

  createWorkspace(root: string, name?: string): Promise<ServerWorkspace> {
    return this.request("/api/v1/workspaces", {
      method: "POST",
      body: JSON.stringify(name ? { root, name } : { root }),
    });
  }

  getSession(sessionId: string): Promise<ServerSession> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}`);
  }

  getSessionStatus(sessionId: string): Promise<ServerSessionStatus> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/status`);
  }

  searchFiles(sessionId: string, query: string, limit = 50): Promise<{ items: ServerFsSearchHit[]; truncated: boolean }> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/fs:search`, {
      method: "POST",
      body: JSON.stringify({
        query,
        limit: Math.max(1, Math.min(200, Math.floor(limit))),
        follow_gitignore: true,
      }),
    });
  }

  readFile(sessionId: string, filePath: string, length = 1_048_576): Promise<ServerFsReadResult> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/fs:read`, {
      method: "POST",
      body: JSON.stringify({
        path: filePath,
        offset: 0,
        length: Math.max(1, Math.min(10_485_760, Math.floor(length))),
        encoding: "utf-8",
      }),
    });
  }

  uploadFile(input: { name: string; mediaType: string; data: string }): Promise<{ id: string; name: string; media_type: string; size: number }> {
    const form = new FormData();
    form.append("name", input.name);
    form.append("file", new Blob([Buffer.from(input.data, "base64")], { type: input.mediaType }), input.name);
    return this.request("/api/v1/files", { method: "POST", body: form, timeoutMs: UPLOAD_TIMEOUT_MS });
  }

  async listSkills(sessionId: string): Promise<ServerSkill[]> {
    const result = await this.request<{ skills: ServerSkill[] }>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/skills`,
    );
    return result.skills;
  }

  activateSkill(sessionId: string, skillName: string, args?: string): Promise<{ activated: true; skill_name: string }> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/skills/${encodeURIComponent(skillName)}:activate`, {
      method: "POST",
      body: JSON.stringify(args ? { args } : {}),
    });
  }

  async listMcpServers(): Promise<ServerMcpServer[]> {
    const result = await this.request<{ servers: ServerMcpServer[] }>("/api/v1/mcp/servers");
    return result.servers;
  }

  async listTools(sessionId?: string): Promise<ServerTool[]> {
    const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
    const result = await this.request<{ tools: ServerTool[] }>(`/api/v1/tools${query}`);
    return result.tools;
  }

  async listConnections(): Promise<ServerConnection[]> {
    const result = await this.request<{ connections: ServerConnection[] }>("/api/v1/connections");
    return result.connections;
  }

  listMessages(sessionId: string, pageSize = 20): Promise<{ items: ServerMessageSummary[]; has_more: boolean }> {
    const query = new URLSearchParams({ page_size: String(Math.max(1, Math.min(100, pageSize))) });
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/messages?${query}`);
  }

  getSnapshot(sessionId: string): Promise<ServerSnapshot> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/snapshot`);
  }

  listPrompts(sessionId: string): Promise<{ active: ServerPromptSummary | null; queued: ServerPromptSummary[] }> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/prompts`);
  }

  getAuthSummary(): Promise<ServerAuthSummary> {
    return this.request("/api/v1/auth");
  }

  startOAuthLogin(): Promise<ServerOAuthFlow> {
    return this.request("/api/v1/oauth/login", { method: "POST", body: "{}" });
  }

  cancelOAuthLogin(): Promise<{ cancelled: boolean; status: string }> {
    return this.request("/api/v1/oauth/login", { method: "DELETE" });
  }

  logoutOAuth(): Promise<{ logged_out: boolean; provider: string }> {
    return this.request("/api/v1/oauth/logout", { method: "POST", body: "{}" });
  }

  getRedactedConfig(): Promise<Record<string, unknown>> {
    return this.request("/api/v1/config");
  }

  setConfig(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("/api/v1/config", { method: "POST", body: JSON.stringify(patch) });
  }

  setDefaultModel(modelId: string): Promise<Record<string, unknown>> {
    return this.request(`/api/v1/models/${encodeURIComponent(modelId)}:set_default`, { method: "POST", body: "{}" });
  }

  async listModels(): Promise<ServerModelCatalogItem[]> {
    const result = await this.request<{ items: ServerModelCatalogItem[] }>("/api/v1/models");
    return result.items;
  }

  async listProviders(): Promise<ServerProviderCatalogItem[]> {
    const result = await this.request<{ items: ServerProviderCatalogItem[] }>("/api/v1/providers");
    return result.items;
  }

  restartMcpServer(serverId: string): Promise<{ restarting: true }> {
    return this.request(`/api/v1/mcp/servers/${encodeURIComponent(serverId)}:restart`, {
      method: "POST",
      body: "{}",
    });
  }

  async listSessions(): Promise<ServerSession[]> {
    const sessions: ServerSession[] = [];
    let afterId: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const query = new URLSearchParams({ page_size: "100" });
      if (afterId) query.set("after_id", afterId);
      const result = await this.request<{ items: ServerSession[]; has_more: boolean }>(`/api/v1/sessions?${query}`);
      sessions.push(...result.items);
      if (!result.has_more || result.items.length === 0) break;
      afterId = result.items.at(-1)?.id;
    }
    return sessions;
  }

  forkSession(sessionId: string, body: { title?: string; metadata?: Record<string, unknown> } = {}) {
    return this.request<ServerSession>(`/api/v1/sessions/${encodeURIComponent(sessionId)}:fork`, {
      method: "POST", body: JSON.stringify(body),
    });
  }

  async listChildren(sessionId: string): Promise<ServerSession[]> {
    const result = await this.request<{ items: ServerSession[] }>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/children?page_size=100`,
    );
    return result.items;
  }

  createChild(sessionId: string, body: { title?: string; metadata?: Record<string, unknown> } = {}) {
    return this.request<ServerSession>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/children`, {
      method: "POST", body: JSON.stringify(body),
    });
  }

  updateSession(sessionId: string, agentConfig: Record<string, unknown>): Promise<ServerSession> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/profile`, {
      method: "POST",
      body: JSON.stringify({ agent_config: agentConfig }),
    });
  }

  renameSession(sessionId: string, title: string): Promise<ServerSession> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/profile`, {
      method: "POST",
      body: JSON.stringify({ title }),
    });
  }

  async subscribe(sessionId: string): Promise<void> {
    this.subscribed.add(sessionId);
    await this.ensureConnected();
    const ack = await this.sendControl("subscribe", {
      session_ids: [sessionId],
      cursors: this.cursorPayload([sessionId]),
    });
    if (ack.code !== 0) throw new Error(`Kimi Server subscribe 失败：${ack.msg ?? ack.code}`);
    await this.handleAckResync(ack);
  }

  async unsubscribe(sessionId: string): Promise<void> {
    this.subscribed.delete(sessionId);
    this.cursors.delete(sessionId);
    if (!this.socket) return;
    await this.sendControl("unsubscribe", { session_ids: [sessionId] }).catch(() => undefined);
  }

  async prompt(sessionId: string, input: unknown, controls: Record<string, unknown>) {
    const content = await toServerPromptContent(
      input as Parameters<typeof toServerPromptContent>[0],
      (file) => this.uploadFile(file),
    );
    const result = await this.request<{ prompt_id: string }>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/prompts`, {
      method: "POST",
      body: JSON.stringify({ content, ...controls }),
      timeoutMs: PROMPT_TIMEOUT_MS,
    });
    await this.waitFor((frame) => {
      if (frame.session_id !== sessionId || frame.type !== "prompt.completed") return false;
      const payload = frame.payload as { promptId?: unknown; prompt_id?: unknown } | undefined;
      return (payload?.promptId ?? payload?.prompt_id) === result.prompt_id;
    }, 180_000);
    return result;
  }

  async steer(sessionId: string, input: unknown, controls: Record<string, unknown>) {
    const content = await toServerPromptContent(
      input as Parameters<typeof toServerPromptContent>[0],
      (file) => this.uploadFile(file),
    );
    const queued = await this.request<{ prompt_id: string }>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/prompts`, {
      method: "POST",
      body: JSON.stringify({ content, ...controls }),
      timeoutMs: PROMPT_TIMEOUT_MS,
    });
    await this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/prompts:steer`, {
      method: "POST",
      body: JSON.stringify({ prompt_ids: [queued.prompt_id] }),
      timeoutMs: PROMPT_TIMEOUT_MS,
    });
    return queued;
  }

  abort(sessionId: string): Promise<unknown> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}:abort`, { method: "POST", body: "{}" });
  }

  compactSession(sessionId: string, instruction?: string): Promise<Record<string, never>> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}:compact`, {
      method: "POST",
      body: JSON.stringify(instruction ? { instruction } : {}),
    });
  }

  undoSession(sessionId: string, count = 1): Promise<unknown> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}:undo`, {
      method: "POST",
      body: JSON.stringify({ count }),
    });
  }

  startBtwSession(sessionId: string): Promise<{ agent_id: string }> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}:btw`, {
      method: "POST",
      body: "{}",
    });
  }

  archiveSession(sessionId: string): Promise<{ archived: true }> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}:archive`, {
      method: "POST",
      body: "{}",
    });
  }

  async listTasks(sessionId: string, status?: ServerBackgroundTask["status"]): Promise<ServerBackgroundTask[]> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    const result = await this.request<{ items: ServerBackgroundTask[] }>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/tasks${query}`,
    );
    return result.items;
  }

  getTask(sessionId: string, taskId: string, outputBytes = 65_536): Promise<ServerBackgroundTask> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/tasks/${encodeURIComponent(taskId)}?with_output=true&output_bytes=${outputBytes}`);
  }

  async cancelTask(sessionId: string, taskId: string): Promise<{ cancelled: boolean }> {
    const pathname = `/api/v1/sessions/${encodeURIComponent(sessionId)}/tasks/${encodeURIComponent(taskId)}:cancel`;
    const response = await fetch(`${this.endpoint}${pathname}`, {
      method: "POST",
      body: "{}",
      headers: { accept: "application/json", "content-type": "application/json" },
    });
    if (!response.ok) throw new Error(`${pathname}: HTTP ${response.status}`);
    const envelope = await response.json() as ServerEnvelope<{ cancelled: boolean }>;
    if (envelope.code === 0) return envelope.data;
    if (envelope.code === 40904) return envelope.data ?? { cancelled: false };
    throw new Error(`${pathname}: ${envelope.msg ?? envelope.code}`);
  }

  async listTerminals(sessionId: string): Promise<ServerTerminal[]> {
    const result = await this.request<{ items: ServerTerminal[] }>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/terminals`,
    );
    return result.items;
  }

  createTerminal(sessionId: string, body: { cwd?: string; shell?: string; cols?: number; rows?: number } = {}) {
    return this.request<ServerTerminal>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/terminals`, {
      method: "POST", body: JSON.stringify(body),
    });
  }

  getTerminal(sessionId: string, terminalId: string) {
    return this.request<ServerTerminal>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(terminalId)}`);
  }

  closeTerminal(sessionId: string, terminalId: string): Promise<{ closed: true }> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(terminalId)}:close`, {
      method: "POST", body: "{}",
    });
  }

  async attachTerminal(sessionId: string, terminalId: string, sinceSeq?: number): Promise<unknown> {
    await this.ensureConnected();
    const ack = await this.sendControl("terminal_attach", {
      session_id: sessionId, terminal_id: terminalId, since_seq: sinceSeq,
    });
    if (ack.code !== 0) throw new Error(`Kimi Server terminal attach 失败：${ack.msg ?? ack.code}`);
    return ack.payload;
  }

  async detachTerminal(sessionId: string, terminalId: string): Promise<void> {
    const ack = await this.sendControl("terminal_detach", { session_id: sessionId, terminal_id: terminalId });
    if (ack.code !== 0) throw new Error(`Kimi Server terminal detach 失败：${ack.msg ?? ack.code}`);
  }

  async writeTerminal(sessionId: string, terminalId: string, data: string): Promise<void> {
    const ack = await this.sendControl("terminal_input", { session_id: sessionId, terminal_id: terminalId, data });
    if (ack.code !== 0) throw new Error(`Kimi Server terminal input 失败：${ack.msg ?? ack.code}`);
  }

  async resizeTerminal(sessionId: string, terminalId: string, cols: number, rows: number): Promise<void> {
    const ack = await this.sendControl("terminal_resize", { session_id: sessionId, terminal_id: terminalId, cols, rows });
    if (ack.code !== 0) throw new Error(`Kimi Server terminal resize 失败：${ack.msg ?? ack.code}`);
  }

  resolveApproval(sessionId: string, approvalId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}`, {
      method: "POST", body: JSON.stringify(body),
    });
  }

  resolveQuestion(sessionId: string, questionId: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(questionId)}`, {
      method: "POST", body: JSON.stringify(body),
    });
  }

  onFrame(listener: FrameListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close() {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.connected = null;
    this.subscribed.clear();
    this.cursors.clear();
    this.recoveringSnapshots.clear();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Kimi Server WebSocket 已关闭"));
    }
    this.waiters.clear();
  }

  async reconnectForProbe(): Promise<void> {
    if (!this.socket) throw new Error("Kimi Server WebSocket 尚未连接");
    const previous = this.socket;
    previous.close();
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (this.socket && this.socket !== previous && this.socket.readyState === WebSocket.OPEN) {
        await this.ensureConnected();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Kimi Server WebSocket 重连探针超时");
  }

  private ensureConnected(): Promise<void> {
    if (this.connected) return this.connected;
    this.connected = this.connect().catch((error) => {
      this.connected = null;
      throw error;
    });
    return this.connected;
  }

  private async connect() {
    this.closing = false;
    const reconnecting = this.reconnectAttempt > 0;
    const socket = new WebSocket(`${this.endpoint.replace(/^http/, "ws")}/api/v1/ws`);
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      try {
        this.receive(JSON.parse(String(event.data)) as ServerFrame);
      } catch {
        // Ignore malformed server frames and keep the live connection usable.
      }
    });
    socket.addEventListener("close", () => this.handleSocketClose(socket));
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("Kimi Server WebSocket 连接失败")), { once: true });
    });
    await this.waitFor((frame) => frame.type === "server_hello", CONTROL_TIMEOUT_MS);
    const ack = await this.sendControl("client_hello", {
      client_id: `kimix-${process.pid}-${Date.now()}`,
      subscriptions: [...this.subscribed],
      cursors: this.cursorPayload(this.subscribed),
    });
    if (ack.code !== 0) throw new Error(`Kimi Server handshake 失败：${ack.msg ?? ack.code}`);
    this.reconnectAttempt = 0;
    await this.handleAckResync(ack);
    this.runtimeFailureNotified = false;
    if (reconnecting) {
      this.options.onReconnected?.();
      for (const sessionId of this.subscribed) await this.recoverSnapshot(sessionId);
    }
  }

  private async sendControl(type: string, payload: unknown) {
    const id = `kimix-${++this.nextId}`;
    this.socket?.send(JSON.stringify({ type, id, payload }));
    return this.waitFor((frame) => frame.type === "ack" && frame.id === id, CONTROL_TIMEOUT_MS);
  }

  private receive(frame: ServerFrame) {
    if (frame.type === "ping") {
      const nonce = (frame.payload as { nonce?: unknown } | undefined)?.nonce;
      this.socket?.send(JSON.stringify({ type: "pong", payload: { nonce } }));
    }
    if (frame.session_id && typeof frame.seq === "number" && frame.volatile !== true) {
      const previous = this.cursors.get(frame.session_id);
      if (!previous || frame.seq >= previous.seq) {
        this.cursors.set(frame.session_id, { seq: frame.seq, epoch: frame.epoch ?? previous?.epoch });
      }
    }
    if (frame.type === "resync_required") {
      const sessionId = (frame.payload as { session_id?: unknown } | undefined)?.session_id;
      if (typeof sessionId === "string") void this.recoverSnapshot(sessionId).catch(() => undefined);
    }
    for (const listener of this.listeners) listener(frame);
    for (const waiter of this.waiters) {
      if (!waiter.match(frame)) continue;
      this.waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(frame);
      return;
    }
    this.queued.push(frame);
    if (this.queued.length > 2_000) {
      const dropped = this.queued.length - 2_000;
      this.queued.splice(0, dropped);
      console.warn(`[KimiCodeServerClient] frame queue overflow: dropped ${dropped} oldest frames`);
    }
  }

  private handleSocketClose(socket: WebSocket) {
    if (socket !== this.socket) return;
    this.socket = null;
    this.connected = null;
    if (this.closing || this.subscribed.size === 0) return;
    // 首次重连立即通知前端，不等 3 次失败后再报
    if (this.reconnectAttempt === 0) {
      this.options.onReconnecting?.();
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.closing) return;
    const delay = Math.min(250 * (2 ** this.reconnectAttempt), 5_000);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureConnected().catch((error) => {
        this.notifyRuntimeFailureAfterRepeatedReconnects(error);
        if (!this.runtimeFailureNotified) this.scheduleReconnect();
      });
    }, delay);
  }

  private notifyRuntimeFailureAfterRepeatedReconnects(error: unknown) {
    const threshold = this.options.reconnectFailureThreshold ?? 3;
    if (this.runtimeFailureNotified || this.reconnectAttempt < threshold) return;
    this.runtimeFailureNotified = true;
    this.options.onRuntimeFailure?.(error instanceof Error ? error : new Error(String(error)));
  }

  private cursorPayload(sessionIds: Iterable<string>) {
    const entries = [...sessionIds].flatMap((sessionId) => {
      const cursor = this.cursors.get(sessionId);
      return cursor ? [[sessionId, cursor] as const] : [];
    });
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  private async handleAckResync(ack: ServerFrame) {
    const payload = ack.payload as { cursors?: Record<string, ServerCursor>; resync_required?: string[] } | undefined;
    for (const [sessionId, cursor] of Object.entries(payload?.cursors ?? {})) {
      const previous = this.cursors.get(sessionId);
      if (!previous || cursor.seq >= previous.seq) this.cursors.set(sessionId, cursor);
    }
    for (const sessionId of payload?.resync_required ?? []) await this.recoverSnapshot(sessionId);
  }

  private async recoverSnapshot(sessionId: string) {
    if (!this.subscribed.has(sessionId)) return;
    if (this.recoveringSnapshots.has(sessionId)) return;
    this.recoveringSnapshots.add(sessionId);
    try {
      const snapshot = await this.request<ServerSnapshot>(
        `/api/v1/sessions/${encodeURIComponent(sessionId)}/snapshot`,
      );
      this.cursors.set(sessionId, { seq: snapshot.as_of_seq, epoch: snapshot.epoch });
      const frame: ServerFrame = {
        type: "kimix.server.snapshot",
        session_id: sessionId,
        seq: snapshot.as_of_seq,
        epoch: snapshot.epoch,
        payload: snapshot,
      };
      for (const listener of this.listeners) listener(frame);
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      const ack = await this.sendControl("subscribe", {
        session_ids: [sessionId],
        cursors: this.cursorPayload([sessionId]),
      });
      if (ack.code !== 0) throw new Error(`Kimi Server snapshot 重订阅失败：${ack.msg ?? ack.code}`);
    } finally {
      this.recoveringSnapshots.delete(sessionId);
    }
  }

  private waitFor(match: (frame: ServerFrame) => boolean, timeoutMs: number): Promise<ServerFrame> {
    const queuedIndex = this.queued.findIndex(match);
    if (queuedIndex >= 0) return Promise.resolve(this.queued.splice(queuedIndex, 1)[0]!);
    return new Promise((resolve, reject) => {
      const waiter = {
        match, resolve, reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`Kimi Server WebSocket 等待超时（${timeoutMs}ms）`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  private async request<T>(pathname: string, options?: RequestInit & { timeoutMs?: number }): Promise<T> {
    const { timeoutMs, ...fetchOptions } = options ?? {};
    const timeout = timeoutMs ?? CONTROL_TIMEOUT_MS;
    const signal = fetchOptions.signal ?? AbortSignal.timeout(timeout);
    const hasJsonBody = Boolean(fetchOptions.body) && !(fetchOptions.body instanceof FormData);
    const response = await fetch(`${this.endpoint}${pathname}`, {
      ...fetchOptions,
      signal,
      headers: { accept: "application/json", ...(hasJsonBody ? { "content-type": "application/json" } : {}) },
    });
    if (!response.ok) {
      const err = Object.assign(new Error(`${pathname}: HTTP ${response.status}`), { statusCode: response.status });
      throw err;
    }
    const envelope = await response.json() as ServerEnvelope<T>;
    if (envelope.code !== 0) {
      const err = Object.assign(new Error(`${pathname}: ${envelope.msg ?? envelope.code}`), { statusCode: envelope.code });
      throw err;
    }
    return envelope.data;
  }
}

function snapshotMessageToServerFrames(
  message: unknown,
  sessionId: string,
  seq: number,
  epoch: string | undefined,
  replayMode: "history" | "in_flight",
): ServerFrame[] {
  if (!isRecord(message)) return [];
  const role = typeof message.role === "string" ? message.role : "";
  const messageTimestamp = snapshotMessageTimestamp(message);
  if (role === "user") {
    const messageText = contentToText(message.content);
    if (replayMode === "history" && messageText) {
      return [{
        type: "TurnBegin",
        session_id: sessionId,
        seq,
        epoch,
        payload: snapshotReplayPayload({ user_input: message.content }, replayMode, snapshotMessageId(message, role), messageText, role, messageTimestamp),
      }];
    }
    return replayMode === "in_flight"
      ? [{ type: "turn.started", session_id: sessionId, seq, epoch, payload: { type: "turn.started" } }]
      : [];
  }
  const messageId = snapshotMessageId(message, role);
  if (role === "assistant") {
    const messageText = contentToText(message.content);
    const frames = contentPartsToFrames(message.content, sessionId, seq, epoch, replayMode, messageId, messageText, messageTimestamp);
    if (frames.length > 0) {
      frames.push({
        type: "turn.ended",
        session_id: sessionId,
        seq,
        epoch,
        payload: snapshotReplayPayload({ type: "turn.ended" }, replayMode, messageId, messageText, role, messageTimestamp),
      });
    }
    return frames;
  }
  if (role === "tool") {
    const toolCallId = stringField(message, "toolCallId") ??
      stringField(message, "tool_call_id") ??
      firstContentStringField(message, "tool_call_id") ??
      firstContentStringField(message, "toolCallId");
    const output = contentToText(message.content);
    if (!toolCallId || !output) return [];
    return [{
      type: "tool.result",
      session_id: sessionId,
      seq,
      epoch,
      payload: snapshotReplayPayload({ type: "tool.result", toolCallId, output }, replayMode, messageId, output, role, messageTimestamp),
    }];
  }
  return [];
}

function contentPartsToFrames(
  content: unknown,
  sessionId: string,
  seq: number,
  epoch: string | undefined,
  replayMode: "history" | "in_flight",
  messageId: string,
  messageText: string,
  messageTimestamp: unknown,
): ServerFrame[] {
  if (typeof content === "string") {
    return content ? [{
      type: "assistant.delta",
      session_id: sessionId,
      seq,
      epoch,
      payload: snapshotReplayPayload({ delta: content }, replayMode, messageId, messageText, "assistant", messageTimestamp),
    }] : [];
  }
  if (!Array.isArray(content)) return [];
  return content.flatMap((part) => {
    if (!isRecord(part)) return [];
    const type = typeof part.type === "string" ? part.type : "";
    if (type === "text" && typeof part.text === "string" && part.text) {
      return [{
        type: "content.part",
        session_id: sessionId,
        seq,
        epoch,
        payload: snapshotReplayPayload({ part: { type: "text", text: part.text } }, replayMode, messageId, messageText, "assistant", messageTimestamp),
      }];
    }
    if ((type === "think" || type === "thinking") && typeof (part.think ?? part.thinking ?? part.text) === "string") {
      const think = String(part.think ?? part.thinking ?? part.text);
      return think ? [{
        type: "content.part",
        session_id: sessionId,
        seq,
        epoch,
        payload: snapshotReplayPayload({ part: { type: "think", think } }, replayMode, messageId, messageText, "assistant", messageTimestamp),
      }] : [];
    }
    return [];
  });
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!isRecord(part)) return "";
    if (typeof part.think === "string") return part.think;
    if (typeof part.thinking === "string") return part.thinking;
    if (typeof part.output === "string") return part.output;
    return typeof part.text === "string"
      ? part.text
      : (typeof part.content === "string" ? part.content : "");
  }).filter(Boolean).join("\n");
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value ? value : undefined;
}

function firstContentStringField(record: Record<string, unknown>, key: string): string | undefined {
  const content = Array.isArray(record.content) ? record.content : [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    const value = stringField(part, key);
    if (value) return value;
  }
  return undefined;
}

function snapshotMessageId(message: Record<string, unknown>, role: string): string {
  return stringField(message, "id") ??
    stringField(message, "message_id") ??
    stringField(message, "messageId") ??
    `${role}:${contentToText(message.content).slice(0, 512)}`;
}

function snapshotMessageTimestamp(message: Record<string, unknown>): unknown {
  return message.created_at ?? message.createdAt ?? message.timestamp ?? message.time;
}

function snapshotReplayPayload(
  payload: Record<string, unknown>,
  replayMode: "history" | "in_flight",
  messageId: string,
  messageText: string,
  role: string,
  messageTimestamp: unknown,
): Record<string, unknown> {
  return {
    ...payload,
    ...(messageTimestamp !== undefined && messageTimestamp !== null ? { created_at: messageTimestamp } : {}),
    snapshotReplay: replayMode,
    snapshotMessageId: messageId,
    snapshotMessageText: messageText,
    snapshotRole: role,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
