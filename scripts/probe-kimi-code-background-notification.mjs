// 根因快照探针：一轮对话已结束、后台 bash 仍在运行，之后后台任务完成时，
// Server 到底广播了什么帧序列（通知注入是否开新轮、新轮有没有 prompt.completed）。
// 用法：node scripts/probe-kimi-code-background-notification.mjs
// 产物：docs/issue-background-notification-turn-events-snapshot.md（帧序列 + 结论）
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const kimiExecutable = process.env.KIMIX_KIMI_EXECUTABLE ??
  path.join(os.homedir(), ".kimi-code", "bin", process.platform === "win32" ? "kimi.exe" : "kimi");
const serverLockPath = path.join(os.homedir(), ".kimi-code", "server", "lock");

function readServerLock() {
  try {
    const lock = JSON.parse(readFileSync(serverLockPath, "utf8"));
    if (!Number.isInteger(lock?.port) || lock.port <= 0 || lock.port > 65_535) return undefined;
    const host = typeof lock.host === "string" && /^(?:127\.0\.0\.1|localhost|::1)$/.test(lock.host) ? lock.host : "127.0.0.1";
    return { ...lock, host };
  } catch {
    return undefined;
  }
}

const existingServerLock = readServerLock();
const port = Number(process.env.KIMIX_KIMI_SERVER_PROBE_PORT ?? existingServerLock?.port ?? 58_639);
const host = process.env.KIMIX_KIMI_SERVER_PROBE_HOST ?? existingServerLock?.host ?? "127.0.0.1";
const baseUrl = `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
const apiBase = `${baseUrl}/api/v1`;
const reportPath = path.join(repoRoot, "docs", "issue-background-notification-turn-events-snapshot.md");

function readServerToken() {
  try {
    return readFileSync(path.join(os.homedir(), ".kimi-code", "server.token"), "utf8").trim() || "";
  } catch {
    return "";
  }
}

const serverToken = readServerToken();
const authHeaders = serverToken ? { authorization: `Bearer ${serverToken}`, "x-kimi-server-token": serverToken } : {};
const wsTokenQuery = serverToken ? `?token=${encodeURIComponent(serverToken)}` : "";
const wsProtocols = serverToken ? [`kimi-code.bearer.${serverToken}`] : undefined;

const startedAt = Date.now();
const frames = [];
const statusPolls = [];
const taskPolls = [];

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizePayload(type, payload) {
  if (!isRecord(payload)) return payload;
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "delta" && typeof value === "string") { out.deltaLen = value.length; continue; }
    if (key === "part" && isRecord(value)) { out.part = { type: value.type, textLen: typeof value.text === "string" ? value.text.length : undefined }; continue; }
    if (typeof value === "string" && value.length > 300) { out[key] = `${value.slice(0, 300)}…(${value.length})`; continue; }
    out[key] = value;
  }
  if (type === "turn.started" || type === "turn.ended" || type === "prompt.completed") return payload;
  return out;
}

async function request(relativePath, options = {}) {
  const response = await fetch(`${apiBase}${relativePath}`, {
    ...options,
    headers: {
      accept: "application/json",
      ...authHeaders,
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

function waitForSocketFrame(queue, waiters, match, timeoutMs = 60_000) {
  const queuedIndex = queue.findIndex(match);
  if (queuedIndex >= 0) return Promise.resolve(queue.splice(queuedIndex, 1)[0]);
  return new Promise((resolve, reject) => {
    const waiter = { match, resolve, reject, timer: undefined };
    waiter.timer = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error(`frame wait timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    waiters.push(waiter);
  });
}

async function openProbeSocket(sessionId) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/api/v1/ws${wsTokenQuery}`, wsProtocols);
  const queue = [];
  const waiters = [];
  socket.addEventListener("message", (event) => {
    const frame = JSON.parse(String(event.data));
    if (frame.type && frame.type !== "ack" && frame.type !== "server_hello") {
      frames.push({
        t: Date.now() - startedAt,
        type: frame.type,
        seq: frame.seq,
        volatile: frame.volatile,
        payload: summarizePayload(frame.type, frame.payload),
      });
    }
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
  const waitFor = (match, timeoutMs) => waitForSocketFrame(queue, waiters, match, timeoutMs);
  await waitFor((frame) => frame.type === "server_hello", 5_000);
  const helloId = `kimix-bg-probe-${Date.now()}`;
  socket.send(JSON.stringify({
    type: "client_hello",
    id: helloId,
    payload: { client_id: `kimix-bg-probe-${process.pid}`, subscriptions: [sessionId] },
  }));
  const ack = await waitFor((frame) => frame.type === "ack" && frame.id === helloId, 5_000);
  if (ack.code !== 0) throw new Error(`client_hello rejected: ${ack.msg ?? ack.code}`);
  return { socket, waitFor };
}

async function checkHealth() {
  const health = await request("/healthz");
  return health?.ok === true;
}

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (server?.exitCode !== null && server != null) throw new Error(`server exited early with code ${server.exitCode}`);
    try {
      if (await checkHealth()) return;
    } catch {
      // still starting
    }
    if (Date.now() > deadline) throw new Error("server did not become healthy");
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

let server;
let ownsServer = false;
async function ensureServer() {
  try {
    if (await checkHealth()) return;
  } catch {}
  if (!existsSync(kimiExecutable)) throw new Error(`kimi executable not found: ${kimiExecutable}`);
  ownsServer = true;
  server = spawn(kimiExecutable, ["web", "--no-open", "--port", String(port), "--log-level", "warn"], {
    cwd: repoRoot,
    env: { ...process.env },
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", () => {});
  server.stderr.on("data", () => {});
  await waitForServer();
}

async function pickProbeModel() {
  const catalog = await request("/models");
  const items = Array.isArray(catalog?.items) ? catalog.items : [];
  const ids = items.map((item) => item?.model).filter((value) => typeof value === "string");
  return ids.find((id) => id === "kimi-code/kimi-for-coding") ?? ids.find((id) => id.startsWith("kimi-code/")) ?? ids[0] ?? null;
}

async function pollStatusAndTasks(sessionId, stopRef) {
  while (!stopRef.stop) {
    try {
      const status = await request(`/sessions/${encodeURIComponent(sessionId)}/status`);
      const last = statusPolls[statusPolls.length - 1];
      const row = { t: Date.now() - startedAt, status: status?.status, busy: status?.busy, inFlight: status?.in_flight_turn != null };
      if (!last || last.status !== row.status || last.busy !== row.busy || last.inFlight !== row.inFlight) statusPolls.push(row);
    } catch {}
    try {
      const tasks = await request("/tasks");
      const items = Array.isArray(tasks?.items) ? tasks.items : [];
      taskPolls.push({ t: Date.now() - startedAt, tasks: items.map((item) => ({ id: item?.id ?? item?.task_id, status: item?.status })) });
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

async function main() {
  await ensureServer();
  const session = await request("/sessions", {
    method: "POST",
    body: JSON.stringify({ title: "Kimix background notification probe", metadata: { cwd: repoRoot, source: "kimix-bg-notification-probe" } }),
  });
  const model = await pickProbeModel();
  await request(`/sessions/${encodeURIComponent(session.id)}/profile`, {
    method: "POST",
    body: JSON.stringify({ agent_config: { model } }),
  });
  const ws = await openProbeSocket(session.id);
  const stopRef = { stop: false };
  const poller = pollStatusAndTasks(session.id, stopRef);

  const prompt = await request(`/sessions/${encodeURIComponent(session.id)}/prompts`, {
    method: "POST",
    body: JSON.stringify({
      content: [{
        type: "text",
        text: "请调用 Bash 工具并设置 run_in_background=true，在后台运行命令：sleep 8 && echo KIMIX_BG_PROBE_DONE。工具返回后台任务已启动后，本轮只回复 KIMIX_BG_PROBE_STARTED 一句话就结束，绝对不要等待或轮询后台任务。",
      }],
    }),
  });

  // 第一阶段：等主轮 prompt.completed
  await ws.waitFor((frame) => {
    if (frame.type !== "prompt.completed" || frame.session_id !== session.id) return false;
    const payload = isRecord(frame.payload) ? frame.payload : {};
    return (payload.prompt_id ?? payload.promptId) === prompt.prompt_id;
  }, 180_000);
  const firstTurnDoneAt = Date.now() - startedAt;

  // 第二阶段：等后台任务终止 + 可能的通知新轮（最多 90 秒）
  let terminatedFrame;
  try {
    terminatedFrame = await ws.waitFor((frame) => (
      frame.session_id === session.id &&
      (frame.type === "background.task.terminated" || frame.type === "task.terminated")
    ), 90_000);
  } catch {}
  const terminatedAt = terminatedFrame ? Date.now() - startedAt : undefined;

  // 终止后再收 60 秒，看是否有 turn.started(origin=task) → assistant.delta → turn.ended → prompt.completed
  const postTermFramesBefore = frames.length;
  if (terminatedFrame) {
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }

  stopRef.stop = true;
  await poller.catch(() => {});
  try { ws.socket.close(); } catch {}

  const snapshot = await request(`/sessions/${encodeURIComponent(session.id)}/snapshot`).catch(() => undefined);
  const snapshotRoles = Array.isArray(snapshot?.messages?.items)
    ? snapshot.messages.items.map((item) => ({
      id: item?.id,
      role: item?.role,
      origin: item?.metadata?.origin ?? item?.origin,
      textHead: typeof item?.content === "string" ? item.content.slice(0, 120)
        : Array.isArray(item?.content) ? JSON.stringify(item.content).slice(0, 120) : undefined,
    }))
    : [];

  const postTerm = frames.slice(postTermFramesBefore);
  const report = [
    "# issue-background-notification-turn-events-snapshot",
    "",
    `> 抓取时间：${new Date().toISOString()}；探针：scripts/probe-kimi-code-background-notification.mjs`,
    `> 场景：主轮结束后后台 bash（sleep 8）仍在运行，之后任务终止，观察 Server 广播帧序列。`,
    "",
    "## 关键时间线",
    "",
    `- 主轮 prompt.completed：t=${firstTurnDoneAt}ms`,
    `- background/task terminated 帧：${terminatedFrame ? `t=${terminatedAt}ms type=${terminatedFrame.type}` : "未收到"}`,
    `- 终止后 60s 内新增帧数：${postTerm.length}`,
    `- 终止后是否出现新 turn.started：${postTerm.some((f) => f.type === "turn.started")}`,
    `- 终止后是否出现 assistant.delta：${postTerm.some((f) => f.type === "assistant.delta")}`,
    `- 终止后是否出现 turn.ended：${postTerm.some((f) => f.type === "turn.ended")}`,
    `- 终止后是否出现 prompt.completed：${postTerm.some((f) => f.type === "prompt.completed")}`,
    "",
    "## 状态轮询（/status 变化）",
    "",
    "```json",
    JSON.stringify(statusPolls, null, 2),
    "```",
    "",
    "## 任务列表轮询（/tasks）",
    "",
    "```json",
    JSON.stringify(taskPolls.filter((p, i) => i === 0 || JSON.stringify(p.tasks) !== JSON.stringify(taskPolls[i - 1].tasks)), null, 2),
    "```",
    "",
    "## 全部帧（按时序）",
    "",
    "```json",
    JSON.stringify(frames, null, 2),
    "```",
    "",
    "## 终态快照消息列表（role / origin / 文本头）",
    "",
    "```json",
    JSON.stringify(snapshotRoles, null, 2),
    "```",
    "",
  ].join("\n");
  await writeFile(reportPath, report, "utf8");
  console.log(`report written: ${reportPath}`);
  console.log(`frames=${frames.length} firstTurnDone=${firstTurnDoneAt}ms terminatedAt=${terminatedAt ?? "-"} postTermFrames=${postTerm.length}`);

  try {
    await request(`/sessions/${encodeURIComponent(session.id)}:archive`, { method: "POST", body: "{}" });
  } catch {}
  if (ownsServer && server) server.kill();
}

main().catch((error) => {
  console.error(error);
  if (ownsServer && server) server.kill();
  process.exit(1);
});
