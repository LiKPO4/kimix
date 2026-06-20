import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const executable = process.env.KIMIX_KIMI_EXECUTABLE ??
  path.join(os.homedir(), ".kimi-code", "bin", process.platform === "win32" ? "kimi.exe" : "kimi");
const port = Number(process.env.KIMIX_KIMI_SERVER_SLASH_PROBE_PORT ?? 58_642);
const baseHttp = `http://127.0.0.1:${port}`;
const apiBase = `${baseHttp}/api/v1`;
const workspace = await mkdtemp(path.join(os.tmpdir(), "kimix-server-slash-probe-"));
const commandTimeoutMs = Number(process.env.KIMIX_KIMI_SERVER_SLASH_PROBE_TIMEOUT_MS ?? 60_000);
const includeMutating = process.env.KIMIX_KIMI_SERVER_SLASH_PROBE_MUTATING === "1";

const safeSlashCommands = [
  { command: "/status", risk: "safe" },
  { command: "/usage", risk: "safe" },
  { command: "/reload", risk: "safe" },
  { command: "/plan off", risk: "safe" },
  { command: "/goal status", risk: "safe" },
];

const mutatingSlashCommands = [
  { command: "/compact 保留 Kimix slash 探针结果", risk: "mutating" },
  { command: "/undo 1", risk: "mutating" },
  { command: "/btw Kimix slash probe: reply with KIMIX_BTW_PROBE_OK", risk: "mutating" },
  { command: "/swarm off", risk: "mutating" },
];

let server;
let stderr = "";

function summarizeError(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function request(route, options = {}, allowError = false) {
  const response = await fetch(`${apiBase}${route}`, {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  const envelope = await response.json();
  if (!allowError && envelope.code !== 0) {
    throw new Error(`${route}: code=${envelope.code} msg=${envelope.msg ?? ""}`);
  }
  return envelope;
}

async function waitUntilReady() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const result = await request("/healthz");
      if (result.data?.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Kimi Server 启动超时：${stderr.trim()}`);
}

function waitForSocketFrame(queue, waiters, match, timeoutMs) {
  const queuedIndex = queue.findIndex(match);
  if (queuedIndex >= 0) return Promise.resolve(queue.splice(queuedIndex, 1)[0]);
  return new Promise((resolve, reject) => {
    const waiter = { match, resolve, reject, timer: undefined };
    waiter.timer = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error(`WebSocket frame wait timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    waiters.push(waiter);
  });
}

async function openProbeSocket(sessionId) {
  const socket = new WebSocket(`${baseHttp.replace(/^http/, "ws")}/api/v1/ws`);
  const queue = [];
  const waiters = [];
  socket.addEventListener("message", (event) => {
    const frame = JSON.parse(String(event.data));
    const waiterIndex = waiters.findIndex((item) => item.match(frame));
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(frame);
      return;
    }
    queue.push(frame);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("probe WebSocket failed to open")), { once: true });
  });
  const waitFor = (match, timeoutMs = commandTimeoutMs) => waitForSocketFrame(queue, waiters, match, timeoutMs);
  await waitFor((frame) => frame.type === "server_hello", 5_000);
  const helloId = `kimix-slash-probe-${Date.now()}`;
  socket.send(JSON.stringify({
    type: "client_hello",
    id: helloId,
    payload: { client_id: `kimix-slash-probe-${process.pid}`, subscriptions: [sessionId] },
  }));
  const ack = await waitFor((frame) => frame.type === "ack" && frame.id === helloId, 5_000);
  if (ack.code !== 0) throw new Error(`probe client_hello rejected: ${ack.msg ?? ack.code}`);
  return { socket, waitFor };
}

function extractPromptId(frame) {
  const payload = frame?.payload && typeof frame.payload === "object" ? frame.payload : {};
  return payload.prompt_id ?? payload.promptId ?? frame.prompt_id ?? frame.promptId;
}

function summarizeFrame(frame) {
  const payload = frame?.payload && typeof frame.payload === "object" ? frame.payload : {};
  return {
    type: frame?.type,
    reason: payload.reason ?? payload.status ?? undefined,
    error: payload.error ?? payload.message ?? frame?.msg ?? undefined,
  };
}

async function probeSlashCommand(sessionId, socketProbe, item) {
  const startedAt = Date.now();
  const submit = await request(`/sessions/${encodeURIComponent(sessionId)}/prompts`, {
    method: "POST",
    body: JSON.stringify({
      content: [{ type: "text", text: item.command }],
      thinking: "off",
      permission_mode: "manual",
      plan_mode: false,
    }),
  }, true);
  if (submit.code !== 0) {
    return {
      ...item,
      accepted: false,
      completed: false,
      durationMs: Date.now() - startedAt,
      submit: { code: submit.code, msg: submit.msg },
    };
  }

  const promptId = submit.data?.prompt_id;
  try {
    const frame = await socketProbe.waitFor((candidate) => {
      if (candidate.session_id !== sessionId) return false;
      if (!["prompt.completed", "error"].includes(candidate.type)) return false;
      const candidatePromptId = extractPromptId(candidate);
      return !promptId || !candidatePromptId || candidatePromptId === promptId;
    }, commandTimeoutMs);
    return {
      ...item,
      accepted: true,
      completed: frame.type === "prompt.completed",
      durationMs: Date.now() - startedAt,
      promptId,
      terminalFrame: summarizeFrame(frame),
    };
  } catch (error) {
    return {
      ...item,
      accepted: true,
      completed: false,
      durationMs: Date.now() - startedAt,
      promptId,
      error: summarizeError(error),
    };
  }
}

async function main() {
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, "README.md"), "Kimix Kimi Server slash probe workspace.\n", "utf8");

  server = spawn(executable, ["server", "run", "--foreground", "--port", String(port), "--log-level", "warn"], {
    cwd: workspace,
    env: { ...process.env, KIMI_CODE_NO_AUTO_UPDATE: "1" },
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "ignore", "pipe"],
  });
  server.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
  await waitUntilReady();

  const created = await request("/sessions", {
    method: "POST",
    body: JSON.stringify({
      title: "Kimix Server slash probe",
      metadata: { cwd: workspace, source: "kimix-server-slash-probe" },
      agent_config: {
        thinking: "off",
        permission_mode: "manual",
        plan_mode: false,
      },
    }),
  });
  const sessionId = created.data.id;
  const socketProbe = await openProbeSocket(sessionId);
  const commands = includeMutating ? [...safeSlashCommands, ...mutatingSlashCommands] : safeSlashCommands;
  const results = [];
  for (const item of commands) {
    results.push(await probeSlashCommand(sessionId, socketProbe, item));
  }
  socketProbe.socket.close();

  const failed = results.filter((item) => !item.accepted || !item.completed);
  console.log(JSON.stringify({
    ok: failed.length === 0,
    cli: executable,
    workspace,
    sessionId,
    mutatingEnabled: includeMutating,
    summary: {
      total: results.length,
      completed: results.filter((item) => item.completed).length,
      failed: failed.length,
    },
    results,
    stderr,
  }, null, 2));

  await request(`/sessions/${encodeURIComponent(sessionId)}:archive`, { method: "POST", body: "{}" }, true);
  if (failed.length > 0) process.exitCode = 1;
}

try {
  await main();
} finally {
  if (server?.exitCode === null) {
    await request("/shutdown", { method: "POST", body: "{}" }, true).catch(() => server.kill());
  }
  await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
