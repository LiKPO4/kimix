import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import * as settingsService from "./settingsService";

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
  settings?: { experimentalKimiServer?: boolean },
) {
  return env.KIMIX_EXPERIMENTAL_KIMI_SERVER?.trim() === "1" || settings?.experimentalKimiServer === true;
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

export class KimiCodeServerHost {
  private child: ReturnType<typeof spawn> | null = null;
  private stderr = "";
  private status: KimiCodeServerHostStatus;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {
    const port = Number(env.KIMIX_KIMI_SERVER_PORT ?? DEFAULT_PORT);
    const endpoint = env.KIMIX_KIMI_SERVER_URL?.trim() || `http://127.0.0.1:${Number.isFinite(port) ? port : DEFAULT_PORT}`;
    const settings = settingsService.loadSettings();
    const enabled = isKimiCodeServerExperimentEnabled(env, settings);
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
    return this.status.state === "attached" || this.status.state === "managed";
  }

  setRouting(routing: "sdk" | "server") {
    this.status = { ...this.status, routing };
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

  async stop(): Promise<void> {
    if (this.child && this.child.exitCode === null) {
      try {
        await this.fetchEnvelope<unknown>("/api/v1/shutdown", { method: "POST", body: "{}" });
      } catch {
        this.child.kill();
      }
      await Promise.race([
        new Promise<void>((resolve) => this.child?.once("close", () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
      ]);
      if (this.child.exitCode === null) this.child.kill();
      await this.waitUntilStopped();
    }
    this.child = null;
    this.status = { ...this.status, state: this.status.enabled ? "stopped" : "disabled", managed: false };
  }

  private async probe(): Promise<KimiCodeServerCapabilities> {
    const [health, meta, openapi, asyncapi] = await Promise.all([
      this.fetchEnvelope<{ ok?: boolean }>("/api/v1/healthz"),
      this.fetchEnvelope<{ server_id?: unknown; server_version?: unknown }>("/api/v1/meta"),
      this.fetchJson<{ info?: { version?: unknown }; paths?: Record<string, unknown> }>("/openapi.json"),
      this.fetchJson<{ info?: { version?: unknown }; channels?: Record<string, unknown> }>("/asyncapi.json"),
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

  private async fetchEnvelope<T>(pathname: string, options?: RequestInit): Promise<T> {
    const envelope = await this.fetchJson<ServerEnvelope<T>>(pathname, options);
    if (envelope.code !== 0) throw new Error(`${pathname}: ${envelope.msg ?? `code=${envelope.code}`}`);
    return envelope.data;
  }

  private async fetchJson<T>(pathname: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.status.endpoint}${pathname}`, {
      ...options,
      headers: {
        accept: "application/json",
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
