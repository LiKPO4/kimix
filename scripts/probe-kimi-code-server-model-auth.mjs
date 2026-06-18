import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const executable = process.env.KIMIX_KIMI_EXECUTABLE ?? path.join(os.homedir(), ".kimi-code", "bin", "kimi.exe");
const port = Number(process.env.KIMIX_KIMI_SERVER_PROBE_PORT ?? 58_644);
const baseUrl = `http://127.0.0.1:${port}`;
const apiBase = `${baseUrl}/api/v1`;
const workspace = await mkdtemp(path.join(os.tmpdir(), "kimix-server-model-auth-"));
let server;

async function request(route, options = {}, allowError = false) {
  const response = await fetch(`${apiBase}${route}`, {
    ...options,
    headers: { accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}) },
  });
  const envelope = await response.json();
  if (!allowError && envelope.code !== 0) throw new Error(`${route}: code=${envelope.code} msg=${envelope.msg}`);
  return envelope;
}

async function waitUntilReady() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await request("/healthz")).data?.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Kimi Server 启动超时");
}

async function main() {
  server = spawn(executable, ["server", "run", "--foreground", "--port", String(port), "--log-level", "warn"], {
    cwd: workspace,
    env: { ...process.env, KIMI_CODE_NO_AUTO_UPDATE: "1" },
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  server.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
  await waitUntilReady();

  const auth = (await request("/auth")).data;
  const config = (await request("/config")).data;
  const models = (await request("/models")).data.items;
  const providers = (await request("/providers")).data.items;
  const pendingBefore = (await request("/oauth/login")).data;
  const oauthStartedAt = Date.now();
  let started = null;
  let oauthStartError = null;
  try {
    started = (await request("/oauth/login", {
      method: "POST",
      body: "{}",
      signal: AbortSignal.timeout(10_000),
    })).data;
  } catch (error) {
    oauthStartError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  const pendingDuring = started ? (await request("/oauth/login")).data : null;
  const cancelled = started ? (await request("/oauth/login", { method: "DELETE" })).data : null;
  const pendingAfter = started ? (await request("/oauth/login")).data : null;
  const providerConfigSafe = Object.values(config.providers ?? {}).every((provider) => (
    provider && typeof provider === "object" && !Object.hasOwn(provider, "api_key") && !Object.hasOwn(provider, "apiKey")
  ));

  console.log(JSON.stringify({
    ok: providerConfigSafe && models.length > 0 && providers.length > 0,
    cli: executable,
    auth,
    config: {
      defaultProvider: config.default_provider,
      defaultModel: config.default_model,
      providerCount: Object.keys(config.providers ?? {}).length,
      providerConfigSafe,
      providerFields: Object.fromEntries(Object.entries(config.providers ?? {}).map(([id, provider]) => [id, Object.keys(provider)])),
    },
    models: { count: models.length, items: models },
    providers: { count: providers.length, items: providers },
    oauth: {
      pendingBefore: pendingBefore?.status ?? null,
      startDurationMs: Date.now() - oauthStartedAt,
      startError: oauthStartError,
      started: started ? { flowId: started.flow_id, provider: started.provider, status: started.status, hasVerificationUri: Boolean(started.verification_uri_complete), expiresIn: started.expires_in, interval: started.interval } : null,
      pendingDuring: pendingDuring?.status ?? null,
      cancelled,
      pendingAfter: pendingAfter?.status ?? null,
    },
    stderr,
  }, null, 2));

  if (!providerConfigSafe || models.length === 0 || providers.length === 0) process.exitCode = 1;
}

try {
  await main();
} finally {
  if (server?.exitCode === null) server.kill();
  await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
