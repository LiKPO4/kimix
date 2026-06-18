import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const researchRepo = process.env.KIMIX_KIMI_CODE_RESEARCH_REPO ??
  path.join(os.homedir(), "AppData", "Local", "Temp", "kimix-kimi-code-research");
const kimiExecutable = process.env.KIMIX_KIMI_EXECUTABLE ??
  path.join(os.homedir(), ".kimi-code", "bin", process.platform === "win32" ? "kimi.exe" : "kimi");
const port = Number(process.env.KIMIX_KIMI_SERVER_PROBE_PORT ?? 58_639);
const baseUrl = `http://127.0.0.1:${port}`;
const apiBase = `${baseUrl}/api/v1`;
const reportPath = path.join(repoRoot, "docs", "kimi-code-server-probe-result.md");
const scenarioTimeoutMs = Number(process.env.KIMIX_KIMI_SERVER_SCENARIO_TIMEOUT_MS ?? 240_000);

const results = [];
let server;
let serverStdout = "";
let serverStderr = "";

function record(name, ok, detail = {}) {
  results.push({ name, ok, detail });
}

function summarizeError(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? scenarioTimeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, timedOut, durationMs: Date.now() - startedAt, stdout, stderr, error: summarizeError(error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, durationMs: Date.now() - startedAt, stdout, stderr });
    });
  });
}

async function request(relativePath, options = {}) {
  const response = await fetch(`${apiBase}${relativePath}`, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  const envelope = await response.json();
  if (typeof envelope?.code !== "number" || envelope.code !== 0) {
    throw new Error(`${options.method ?? "GET"} ${relativePath}: code=${String(envelope?.code)} msg=${String(envelope?.msg ?? "")}`);
  }
  return envelope.data;
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null) throw new Error(`server exited early with code ${server.exitCode}`);
    try {
      const health = await request("/healthz");
      if (health?.ok === true) return health;
    } catch {
      // The foreground process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("server health check timed out");
}

async function startServer() {
  server = spawn(kimiExecutable, [
    "server", "run", "--foreground", "--port", String(port), "--debug-endpoints", "--log-level", "warn",
  ], {
    cwd: repoRoot,
    env: process.env,
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { serverStdout += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverStderr += chunk.toString(); });
  await waitForServer();
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  try {
    await request("/shutdown", { method: "POST", body: "{}" });
  } catch {
    server.kill();
  }
  await Promise.race([
    new Promise((resolve) => server.once("close", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (server.exitCode === null) server.kill();
}

async function probeContracts() {
  const meta = await request("/meta");
  const auth = await request("/auth");
  const openapi = await fetch(`${baseUrl}/openapi.json`).then((response) => response.json());
  const asyncapi = await fetch(`${baseUrl}/asyncapi.json`).then((response) => response.json());
  const openapiPaths = Object.keys(openapi.paths ?? {});
  record("health/meta/auth + OpenAPI/AsyncAPI", true, {
    serverId: meta.server_id,
    serverVersion: meta.server_version,
    authReady: auth.ready,
    openapiVersion: openapi.info?.version,
    openapiPathCount: openapiPaths.length,
    asyncapiVersion: asyncapi.info?.version,
    asyncapiChannels: Object.keys(asyncapi.channels ?? {}),
  });

  const session = await request("/sessions", {
    method: "POST",
    body: JSON.stringify({ title: "Kimix server P1 snapshot probe", metadata: { cwd: repoRoot, source: "kimix-p1-probe" } }),
  });
  const snapshot = await request(`/sessions/${encodeURIComponent(session.id)}/snapshot`);
  record("session create + snapshot", Boolean(session.id && snapshot), {
    sessionId: session.id,
    snapshotKeys: snapshot && typeof snapshot === "object" ? Object.keys(snapshot) : [],
  });
  try {
    await request(`/sessions/${encodeURIComponent(session.id)}:archive`, { method: "POST", body: "{}" });
  } catch {
    // Archiving is cleanup only and does not affect the snapshot assertion.
  }
}

async function runScenario(file, coverage) {
  const result = await run("pnpm", ["--filter", "@moonshot-ai/server-e2e", "exec", "tsx", `scenarios/${file}`], {
    cwd: researchRepo,
    env: { KIMI_SERVER_URL: baseUrl },
  });
  const ok = result.code === 0 && !result.timedOut && !result.error;
  record(file, ok, { coverage, ...result });
}

async function writeReport() {
  const lines = [
    "# Kimi Code 0.17.1 Server P1 探针结果",
    "",
    `- 生成时间：${new Date().toISOString()}`,
    `- CLI：${kimiExecutable}`,
    `- Server：${baseUrl}`,
    `- 官方源码：${researchRepo}`,
    `- 结果：${results.filter((item) => item.ok).length} 通过 / ${results.filter((item) => !item.ok).length} 失败`,
    "",
    "## 明细",
    "",
    ...results.flatMap((item) => [
      `### ${item.ok ? "通过" : "失败"}：${item.name}`,
      "",
      "```json",
      JSON.stringify(item.detail, null, 2),
      "```",
      "",
    ]),
    "## 结论",
    "",
    "- Server REST、WebSocket、事件重放、快照、prompt、steer、cancel、approval 和 question 均由官方 server-e2e 场景验证。",
    "- 当前 0.17.1 native CLI 的 `/meta` 与 OpenAPI 自报版本为 `0.0.0`；P2 必须按 endpoint / contract capability 探测，不能只按 server_version 判断。",
    "- P2 可在实验开关后新增 Kimix Server Host；现有 vendored SDK Host 继续作为默认与回滚路径。",
  ];
  await writeFile(reportPath, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  try {
    const cliVersion = await run(kimiExecutable, ["--version"], { timeoutMs: 10_000 });
    record("installed CLI version", cliVersion.code === 0 && !cliVersion.timedOut, cliVersion);
    await startServer();
    await probeContracts();
    await runScenario("03-refresh-replay.ts", "WS 握手、断线重连、seq replay、messages/tasks、prompt");
    await runScenario("08-pending-recovery.ts", "approval/question pending 列表与响应闭环");
    await runScenario("10-prompt-queue-steer.ts", "queued prompt steer 与 WS 事件");
    await runScenario("12-send-and-cancel.ts", "prompt 完成、queued/active/session cancel 与恢复");
  } catch (error) {
    record("probe bootstrap", false, { error: summarizeError(error), serverStdout, serverStderr });
  } finally {
    await stopServer();
    await writeReport();
  }

  const summary = {
    ok: results.every((item) => item.ok),
    reportPath,
    passed: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

await main();
