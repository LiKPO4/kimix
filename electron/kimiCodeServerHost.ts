import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";

const DEFAULT_PORT = 58_627;
const START_TIMEOUT_MS = 20_000;
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

function serverLockPath() {
  return path.join(os.homedir(), ".kimi-code", "server", "lock");
}

function readServerLock(): ServerLockContents | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(serverLockPath(), "utf-8")) as Partial<ServerLockContents> | undefined;
    if (typeof parsed?.pid === "number" && typeof parsed?.port === "number") return parsed as ServerLockContents;
  } catch {
    // 锁缺失或不可读时按无锁处理。
  }
  return undefined;
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

    try {
      const capabilities = await this.probe();
      this.status = { ...this.status, state: "attached", managed: false, capabilities };
      return this.getStatus();
    } catch {
      // No compatible server is listening; start the installed CLI below.
    }

    // Kimi Code 0.24+ 单例锁：锁记录的活实例无法被第二个 server 取代，改为直连该实例；
    // 死 pid 残留锁（上游 lock.ts 在 Windows 上可能误判存活）清理后再走正常启动。
    const lock = readServerLock();
    if (lock) {
      if (await isLockOwnerAlive(lock.pid)) {
        const lockEndpoint = `http://${lock.host ?? "127.0.0.1"}:${lock.port}`;
        try {
          const capabilities = await this.probe(lockEndpoint);
          this.status = { ...this.status, state: "attached", managed: false, endpoint: lockEndpoint, capabilities };
        } catch (error) {
          this.status = {
            ...this.status,
            state: "fallback",
            managed: false,
            error: `检测到运行中的 Kimi Server（pid ${lock.pid}，${lockEndpoint}），但能力探测失败：${errorMessage(error)}`,
          };
        }
        return this.getStatus();
      }
      try {
        fs.unlinkSync(serverLockPath());
      } catch {
        // 清理失败时让 spawn 的错误原样上报，不掩盖真实原因。
      }
    }

    try {
      const executable = this.resolveExecutable();
      const port = new URL(this.status.endpoint).port || String(DEFAULT_PORT);
      this.child = spawn(executable, [
        "server", "run", "--foreground", "--port", port, "--log-level", "warn",
      ], {
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
      const capabilities = await this.waitUntilReady();
      this.status = { ...this.status, state: "managed", managed: true, capabilities };
    } catch (error) {
      this.child?.kill();
      this.child = null;
      this.status = {
        ...this.status,
        state: "fallback",
        managed: false,
        error: [errorMessage(error), this.stderr.trim()].filter(Boolean).join("\n").slice(0, 4_000),
      };
    }
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

  private async waitUntilReady() {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.child?.exitCode !== null) throw new Error(`Kimi Server 提前退出：${String(this.child?.exitCode)}`);
      try {
        return await this.probe();
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
