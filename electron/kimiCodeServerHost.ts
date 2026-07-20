import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";

const DEFAULT_PORT = 58_627;
const START_TIMEOUT_MS = 20_000;
const SERVER_LOCK_STARTUP_GRACE_MS = 30_000;
const MANAGED_PORT_ATTEMPTS = 20;
const REQUIRED_PATHS = [
  "/api/v1/sessions",
  "/api/v1/sessions/{session_id}/snapshot",
  "/api/v1/sessions/{session_id}/prompts",
  "/api/v1/sessions/{session_id}/approvals",
  "/api/v1/sessions/{session_id}/questions",
  "/api/v1/sessions/{session_id}/{tail}",
  "/api/v1/sessions/{session_id}/children",
  "/api/v1/sessions/{session_id}/tasks",
  "/api/v1/sessions/{session_id}/terminals",
  "/api/v1/tools",
  "/api/v1/workspaces",
] as const;

export type KimiCodeServerCapabilities = {
  serverId: string;
  serverVersion: string;
  openapiVersion: string;
  asyncapiVersion: string;
  websocketChannel: boolean;
  requiredPaths: Record<(typeof REQUIRED_PATHS)[number], boolean>;
};

export type KimiCodeServerHostStatus = {
  enabled: boolean;
  state: "disabled" | "starting" | "attached" | "managed" | "fallback" | "stopped";
  endpoint: string;
  routing: "sdk" | "server";
  managed: boolean;
  capabilities?: KimiCodeServerCapabilities;
  error?: string;
};

type ServerEnvelope<T> = { code: number; msg?: string; data: T };

export function isKimiCodeServerExperimentEnabled(
  env: NodeJS.ProcessEnv = process.env,
) {
  const override = env.KIMIX_EXPERIMENTAL_KIMI_SERVER?.trim();
  if (override !== undefined) return override === "1";
  return true;
}

export function inspectKimiCodeServerContract(
  meta: { server_id?: unknown; server_version?: unknown },
  openapi: { info?: { version?: unknown }; paths?: Record<string, unknown> },
  asyncapi: { info?: { version?: unknown }; channels?: Record<string, unknown> },
): KimiCodeServerCapabilities {
  const paths = openapi.paths ?? {};
  const requiredPaths = Object.fromEntries(
    REQUIRED_PATHS.map((item) => [item, Object.hasOwn(paths, item)]),
  ) as KimiCodeServerCapabilities["requiredPaths"];
  return {
    serverId: typeof meta.server_id === "string" ? meta.server_id : "",
    serverVersion: typeof meta.server_version === "string" ? meta.server_version : "unknown",
    openapiVersion: typeof openapi.info?.version === "string" ? openapi.info.version : "unknown",
    asyncapiVersion: typeof asyncapi.info?.version === "string" ? asyncapi.info.version : "unknown",
    websocketChannel: Object.hasOwn(asyncapi.channels ?? {}, "kimiCodeWebSocket"),
    requiredPaths,
  };
}

function contractIsUsable(capabilities: KimiCodeServerCapabilities) {
  return Boolean(
    capabilities.serverId &&
    capabilities.websocketChannel &&
    Object.values(capabilities.requiredPaths).every(Boolean),
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Kimi Code 0.24+（agent-core-v2）对全部 /api/* 与 /openapi.json、/asyncapi.json 强制
// bearer 鉴权；与 electron/kimiCodeServerClient.ts 保持同一 token 来源。
function readServerToken() {
  try {
    const token = fs.readFileSync(path.join(os.homedir(), ".kimi-code", "server.token"), "utf-8").trim();
    return token || null;
  } catch {
    return null;
  }
}

function serverAuthHeaders(): Record<string, string> {
  const token = readServerToken();
  return token ? { authorization: `Bearer ${token}`, "x-kimi-server-token": token } : {};
}

type ServerLockContents = { pid: number; port: number; host?: string; started_at?: string };

export type KimiServerInstanceRecord = {
  serverId?: string;
  pid: number;
  host: string;
  port: number;
  startedAtMs: number;
  heartbeatAtMs?: number;
  source: "instance" | "legacy-lock";
};

export function shouldClearUnresponsiveServerLock(
  lock: Pick<ServerLockContents, "started_at">,
  now = Date.now(),
) {
  const startedAt = Date.parse(lock.started_at ?? "");
  return Number.isFinite(startedAt) && now - startedAt >= SERVER_LOCK_STARTUP_GRACE_MS;
}

function serverHomeDir() {
  return path.join(os.homedir(), ".kimi-code", "server");
}

function serverLockPath() {
  return path.join(serverHomeDir(), "lock");
}

/**
 * Kimi Code 0.28+ removed `kimi server …` (deprecated notice + exit 1).
 * Managed runtimes must launch the same foreground server via `kimi web --no-open`.
 */
export function buildManagedKimiServerArgs(port: string | number): string[] {
  return ["web", "--no-open", "--port", String(port), "--log-level", "warn"];
}

export function preferredKimiServerPorts(preferredPort: number, attempts = MANAGED_PORT_ATTEMPTS): number[] {
  const base = Number.isFinite(preferredPort) && preferredPort > 0 ? Math.floor(preferredPort) : DEFAULT_PORT;
  const count = Math.max(1, Math.floor(attempts));
  return Array.from({ length: count }, (_, index) => base + index);
}

export function endpointForKimiServerInstance(instance: Pick<KimiServerInstanceRecord, "host" | "port">): string {
  return `http://${instance.host || "127.0.0.1"}:${instance.port}`;
}

function toStartedAtMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber < 1e12 ? asNumber * 1000 : asNumber;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function parseKimiServerInstanceRecord(
  value: unknown,
  source: KimiServerInstanceRecord["source"] = "instance",
): KimiServerInstanceRecord | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const pid = typeof record.pid === "number" ? record.pid : Number(record.pid);
  const port = typeof record.port === "number" ? record.port : Number(record.port);
  if (!Number.isFinite(pid) || !Number.isFinite(port) || port <= 0) return undefined;
  const host = typeof record.host === "string" && record.host.trim() ? record.host.trim() : "127.0.0.1";
  const serverId = typeof record.server_id === "string" && record.server_id.trim()
    ? record.server_id.trim()
    : typeof record.serverId === "string" && record.serverId.trim()
      ? record.serverId.trim()
      : undefined;
  return {
    serverId,
    pid: Math.floor(pid),
    host,
    port: Math.floor(port),
    startedAtMs: toStartedAtMs(record.started_at ?? record.startedAt),
    heartbeatAtMs: (() => {
      const raw = record.heartbeat_at ?? record.heartbeatAt;
      const ms = toStartedAtMs(raw);
      return ms > 0 ? ms : undefined;
    })(),
    source,
  };
}

/** Read 0.28+ multi-instance registry plus the legacy singleton lock file. */
export function listKimiServerInstanceRecords(homeDir = serverHomeDir()): KimiServerInstanceRecord[] {
  const records: KimiServerInstanceRecord[] = [];
  const seen = new Set<string>();
  const push = (record: KimiServerInstanceRecord | undefined) => {
    if (!record) return;
    const key = `${record.host}:${record.port}:${record.pid}`;
    if (seen.has(key)) return;
    seen.add(key);
    records.push(record);
  };

  const instancesDir = path.join(homeDir, "instances");
  try {
    for (const name of fs.readdirSync(instancesDir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(instancesDir, name), "utf-8")) as unknown;
        push(parseKimiServerInstanceRecord(raw, "instance"));
      } catch {
        // Skip unreadable instance files.
      }
    }
  } catch {
    // instances dir may be absent on older installs.
  }

  try {
    const legacy = JSON.parse(fs.readFileSync(path.join(homeDir, "lock"), "utf-8")) as unknown;
    push(parseKimiServerInstanceRecord(legacy, "legacy-lock"));
  } catch {
    // legacy lock optional
  }

  return records;
}

/**
 * Prefer the configured port when a live registry entry matches it; otherwise
 * attach to the longest-running instance (stable shared home multi-server).
 */
export function selectKimiServerAttachCandidates(
  instances: readonly KimiServerInstanceRecord[],
  preferredPort: number,
): KimiServerInstanceRecord[] {
  const preferred = Number.isFinite(preferredPort) ? Math.floor(preferredPort) : DEFAULT_PORT;
  return [...instances].sort((left, right) => {
    const leftPreferred = left.port === preferred ? 0 : 1;
    const rightPreferred = right.port === preferred ? 0 : 1;
    if (leftPreferred !== rightPreferred) return leftPreferred - rightPreferred;
    if (left.startedAtMs !== right.startedAtMs) {
      if (left.startedAtMs === 0) return 1;
      if (right.startedAtMs === 0) return -1;
      return left.startedAtMs - right.startedAtMs;
    }
    return left.port - right.port;
  });
}

function readServerLock(): ServerLockContents | undefined {
  const legacy = listKimiServerInstanceRecords().find((item) => item.source === "legacy-lock");
  if (!legacy) return undefined;
  return {
    pid: legacy.pid,
    port: legacy.port,
    host: legacy.host,
    started_at: legacy.startedAtMs > 0 ? new Date(legacy.startedAtMs).toISOString() : undefined,
  };
}

/**
 * Kimi Code 0.24+ 单例锁的存活判定（上游 lock.ts 用 process.kill(pid, 0)；Windows 上死 pid
 * 可能被误判存活，导致 server 永久拒绝启动）。Windows 用 tasklist 做确定性确认；无法判定时
 * 按存活处理，避免误删他人锁。
 */
function isLockOwnerAlive(pid: number): Promise<boolean> {
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      execFile("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], (error, stdout) => {
        if (error) return resolve(true);
        const alive = stdout.split(/\r?\n/).some((line) => line.startsWith('"') && line.split('","')[1] === String(pid));
        resolve(alive);
      });
    });
  }
  try {
    process.kill(pid, 0);
    return Promise.resolve(true);
  } catch (error) {
    return Promise.resolve((error as NodeJS.ErrnoException)?.code !== "ESRCH");
  }
}

export class KimiCodeServerHost {
  private child: ReturnType<typeof spawn> | null = null;
  private stderr = "";
  private status: KimiCodeServerHostStatus;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {
    const port = Number(env.KIMIX_KIMI_SERVER_PORT ?? DEFAULT_PORT);
    const endpoint = env.KIMIX_KIMI_SERVER_URL?.trim() || `http://127.0.0.1:${Number.isFinite(port) ? port : DEFAULT_PORT}`;
    const enabled = isKimiCodeServerExperimentEnabled(env);
    this.status = {
      enabled,
      state: enabled ? "stopped" : "disabled",
      endpoint: endpoint.replace(/\/+$/, ""),
      routing: "sdk",
      managed: false,
    };
  }

  getStatus(): KimiCodeServerHostStatus {
    return { ...this.status, capabilities: this.status.capabilities ? { ...this.status.capabilities } : undefined };
  }

  isReady(): boolean {
    if (this.status.state === "managed" && this.child?.exitCode !== null) {
      this.markStopped(new Error(`Kimi Server 进程已退出：${String(this.child?.exitCode)}`));
    }
    return this.status.state === "attached" || this.status.state === "managed";
  }

  setRouting(routing: "sdk" | "server") {
    this.status = { ...this.status, routing };
  }

  /** 标记 WebSocket 连接断开正在重连，不清除 server sessions。 */
  markReconnecting() {
    this.status = {
      ...this.status,
      state: "starting",
      error: "Kimi Server 连接断开，正在重连…",
    };
  }

  /** WebSocket 重连成功后恢复状态，使 isReady() 重新可用。 */
  markReconnected() {
    const nextState = this.child ? "managed" : "attached";
    this.status = {
      ...this.status,
      state: nextState,
      error: undefined,
    };
  }

  markFallback(error: unknown) {
    this.child?.kill();
    this.child = null;
    this.status = {
      ...this.status,
      state: "fallback",
      routing: "sdk",
      managed: false,
      error: errorMessage(error),
    };
  }

  async start(): Promise<KimiCodeServerHostStatus> {
    if (!this.status.enabled) return this.getStatus();
    if (this.status.state === "attached" || this.status.state === "managed") return this.getStatus();
    this.status = { ...this.status, state: "starting", error: undefined };
    this.stderr = "";

    const preferredPort = (() => {
      try {
        const port = Number(new URL(this.status.endpoint).port || DEFAULT_PORT);
        return Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT;
      } catch {
        return DEFAULT_PORT;
      }
    })();

    try {
      const capabilities = await this.probe(this.status.endpoint);
      this.status = { ...this.status, state: "attached", managed: false, capabilities };
      return this.getStatus();
    } catch {
      // Preferred endpoint empty; discover registry instances or spawn below.
    }

    // 0.28 multi-instance registry under server/instances/*.json, plus legacy lock.
    const registry = selectKimiServerAttachCandidates(listKimiServerInstanceRecords(), preferredPort);
    for (const instance of registry) {
      if (!(await isLockOwnerAlive(instance.pid))) continue;
      const endpoint = endpointForKimiServerInstance(instance);
      try {
        const capabilities = await this.probe(endpoint);
        this.status = {
          ...this.status,
          state: "attached",
          managed: false,
          endpoint,
          capabilities,
          error: undefined,
        };
        return this.getStatus();
      } catch {
        // Stale registry row or not yet healthy; try the next candidate.
      }
    }

    // Clear a dead or long-unresponsive legacy lock so spawn is not blocked.
    const lock = readServerLock();
    if (lock) {
      const alive = await isLockOwnerAlive(lock.pid);
      if (!alive || shouldClearUnresponsiveServerLock(lock)) {
        try {
          fs.unlinkSync(serverLockPath());
        } catch {
          // ignore
        }
      }
    }

    const executable = this.resolveExecutable();
    const spawnErrors: string[] = [];
    for (const port of preferredKimiServerPorts(preferredPort, MANAGED_PORT_ATTEMPTS)) {
      const endpoint = `http://127.0.0.1:${port}`;
      try {
        const capabilities = await this.probe(endpoint);
        this.status = {
          ...this.status,
          state: "attached",
          managed: false,
          endpoint,
          capabilities,
          error: undefined,
        };
        return this.getStatus();
      } catch {
        // Port free or non-Kimi listener; attempt managed spawn.
      }

      try {
        this.stderr = "";
        this.status = { ...this.status, endpoint };
        // 0.28+: official foreground server entry is `kimi web --no-open`.
        this.child = spawn(executable, buildManagedKimiServerArgs(port), {
          cwd: os.homedir(),
          env: { ...this.env, KIMI_CODE_NO_AUTO_UPDATE: this.env.KIMI_CODE_NO_AUTO_UPDATE || "1" },
          windowsHide: true,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        this.child.stderr?.on("data", (chunk) => {
          this.stderr = `${this.stderr}${chunk.toString()}`.slice(-4_000);
        });
        this.child.once("error", (error) => {
          if (this.child && this.status.state === "starting") {
            this.stderr = `${this.stderr}\n${errorMessage(error)}`.trim().slice(-4_000);
          }
        });
        this.child.once("close", (code, signal) => {
          if (this.status.state !== "managed") return;
          const detail = signal ? `signal ${signal}` : `code ${String(code)}`;
          this.markStopped(new Error(`Kimi Server 进程已退出：${detail}`));
        });
        const capabilities = await this.waitUntilReady(endpoint);
        this.status = {
          ...this.status,
          state: "managed",
          managed: true,
          endpoint,
          capabilities,
          error: undefined,
        };
        return this.getStatus();
      } catch (error) {
        this.child?.kill();
        this.child = null;
        spawnErrors.push(`port ${port}: ${errorMessage(error)}`);
      }
    }

    this.status = {
      ...this.status,
      state: "fallback",
      managed: false,
      error: [
        `无法在端口 ${preferredPort}–${preferredPort + MANAGED_PORT_ATTEMPTS - 1} 附着或启动 Kimi Server`,
        ...spawnErrors.slice(-4),
        this.stderr.trim(),
      ].filter(Boolean).join("\n").slice(0, 4_000),
    };
    return this.getStatus();
  }

  private markStopped(error: unknown) {
    this.child = null;
    this.status = {
      ...this.status,
      state: this.status.enabled ? "stopped" : "disabled",
      routing: "sdk",
      managed: false,
      error: errorMessage(error),
    };
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (child && child.exitCode === null) {
      try {
        await this.fetchEnvelope<unknown>("/api/v1/shutdown", { method: "POST", body: "{}" });
      } catch {
        child.kill();
      }
      await Promise.race([
        new Promise<void>((resolve) => child.once("close", () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
      ]);
      // close 回调会把 this.child 置空；这里只操作局部引用，避免 shutdown 成功后的空指针。
      if (child.exitCode === null) child.kill();
      await this.waitUntilStopped();
    }
    this.child = null;
    this.status = { ...this.status, state: this.status.enabled ? "stopped" : "disabled", managed: false };
  }

  private async probe(endpoint = this.status.endpoint): Promise<KimiCodeServerCapabilities> {
    const [health, meta, openapi, asyncapi] = await Promise.all([
      this.fetchEnvelope<{ ok?: boolean }>("/api/v1/healthz", undefined, endpoint),
      this.fetchEnvelope<{ server_id?: unknown; server_version?: unknown }>("/api/v1/meta", undefined, endpoint),
      this.fetchJson<{ info?: { version?: unknown }; paths?: Record<string, unknown> }>("/openapi.json", undefined, endpoint),
      this.fetchJson<{ info?: { version?: unknown }; channels?: Record<string, unknown> }>("/asyncapi.json", undefined, endpoint),
    ]);
    if (health.ok !== true) throw new Error("Kimi Server healthz 未就绪");
    const capabilities = inspectKimiCodeServerContract(meta, openapi, asyncapi);
    if (!contractIsUsable(capabilities)) throw new Error("Kimi Server capability gate 未通过");
    return capabilities;
  }

  private async waitUntilReady(endpoint = this.status.endpoint) {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.child?.exitCode !== null) throw new Error(`Kimi Server 提前退出：${String(this.child?.exitCode)}`);
      try {
        return await this.probe(endpoint);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
    throw new Error("Kimi Server 启动超时");
  }

  private async fetchEnvelope<T>(pathname: string, options?: RequestInit, endpoint = this.status.endpoint): Promise<T> {
    const envelope = await this.fetchJson<ServerEnvelope<T>>(pathname, options, endpoint);
    if (envelope.code !== 0) throw new Error(`${pathname}: ${envelope.msg ?? `code=${envelope.code}`}`);
    return envelope.data;
  }

  private async fetchJson<T>(pathname: string, options?: RequestInit, endpoint = this.status.endpoint): Promise<T> {
    const response = await fetch(`${endpoint}${pathname}`, {
      ...options,
      headers: {
        accept: "application/json",
        ...serverAuthHeaders(),
        ...(options?.body === undefined ? {} : { "content-type": "application/json" }),
        ...(options?.headers ?? {}),
      },
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) throw new Error(`${pathname}: HTTP ${response.status}`);
    return await response.json() as T;
  }

  private async waitUntilStopped() {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      try {
        await this.fetchEnvelope("/api/v1/healthz");
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch {
        return;
      }
    }
  }

  private resolveExecutable() {
    const fileName = process.platform === "win32" ? "kimi.exe" : "kimi";
    const candidates = [
      this.env.KIMIX_KIMI_EXECUTABLE,
      this.env.KIMI_INSTALL_DIR && path.join(this.env.KIMI_INSTALL_DIR, "bin", fileName),
      path.join(os.homedir(), ".kimi-code", "bin", fileName),
      path.join(os.homedir(), ".local", "bin", fileName),
    ].filter((item): item is string => Boolean(item));
    const found = candidates.find((item) => fs.existsSync(item));
    if (!found) throw new Error("未找到 Kimi Code CLI；可设置 KIMIX_KIMI_EXECUTABLE");
    return found;
  }
}

export const kimiCodeServerHost = new KimiCodeServerHost();
