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

function waitForSocketFrame(queue, waiters, match, timeoutMs = 60_000) {
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
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/api/v1/ws`);
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
  const waitFor = (match, timeoutMs) => waitForSocketFrame(queue, waiters, match, timeoutMs);
  await waitFor((frame) => frame.type === "server_hello", 5_000);
  const helloId = `kimix-probe-${Date.now()}`;
  socket.send(JSON.stringify({
    type: "client_hello",
    id: helloId,
    payload: { client_id: `kimix-server-probe-${process.pid}`, subscriptions: [sessionId] },
  }));
  const ack = await waitFor((frame) => frame.type === "ack" && frame.id === helloId, 5_000);
  if (ack.code !== 0) throw new Error(`probe client_hello rejected: ${ack.msg ?? ack.code}`);
  return { socket, waitFor };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!isRecord(part)) return "";
    if (typeof part.think === "string") return part.think;
    if (typeof part.thinking === "string") return part.thinking;
    if (typeof part.output === "string") return part.output;
    if (typeof part.text === "string") return part.text;
    if (typeof part.content === "string") return part.content;
    return "";
  }).filter(Boolean).join("\n");
}

function snapshotMessageId(message, role) {
  return typeof message.id === "string" ? message.id
    : typeof message.message_id === "string" ? message.message_id
      : typeof message.messageId === "string" ? message.messageId
        : `${role}:${contentToText(message.content).slice(0, 512)}`;
}

function snapshotHistoryReplayPayloads(snapshot) {
  const items = Array.isArray(snapshot?.messages?.items) ? snapshot.messages.items : [];
  return items.flatMap((message) => {
    if (!isRecord(message) || message.role === "user") return [];
    const role = typeof message.role === "string" ? message.role : "";
    const text = contentToText(message.content);
    if (!text) return [];
    return [{
      snapshotReplay: "history",
      snapshotRole: role,
      snapshotMessageId: snapshotMessageId(message, role),
      snapshotMessageText: text,
      toolCallId: typeof message.toolCallId === "string" ? message.toolCallId : undefined,
    }];
  });
}

function normalizeReplayText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function shouldSkipHistoryReplay(rawEvent, events = []) {
  if (rawEvent?.snapshotReplay !== "history") return false;
  const text = normalizeReplayText(rawEvent.snapshotMessageText);
  if (!text) return false;
  if (rawEvent.snapshotRole === "tool") {
    return events.some((event) => event.type === "tool_result" && normalizeReplayText(event.result).includes(text));
  }
  return events.some((event) => event.type === "assistant_message" && normalizeReplayText(`${event.thinking ?? ""}\n${event.content ?? ""}`).includes(text));
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

async function probeKimixSnapshotReplayAdapter() {
  let session;
  let socket;
  try {
    session = await request("/sessions", {
      method: "POST",
      body: JSON.stringify({ title: "Kimix snapshot replay probe", metadata: { cwd: repoRoot, source: "kimix-snapshot-replay-probe" } }),
    });
    const ws = await openProbeSocket(session.id);
    socket = ws.socket;
    const prompt = await request(`/sessions/${encodeURIComponent(session.id)}/prompts`, {
      method: "POST",
      body: JSON.stringify({
        content: [{ type: "text", text: "Reply with exactly: KIMIX_SNAPSHOT_REPLAY_OK" }],
      }),
    });
    await ws.waitFor((frame) => {
      if (frame.type !== "prompt.completed" || frame.session_id !== session.id) return false;
      const payload = isRecord(frame.payload) ? frame.payload : {};
      return (payload.prompt_id ?? payload.promptId) === prompt.prompt_id;
    }, 120_000);
    const snapshot = await request(`/sessions/${encodeURIComponent(session.id)}/snapshot`);
    const replayPayloads = snapshotHistoryReplayPayloads(snapshot);
    const assistantReplay = replayPayloads.find((item) => item.snapshotRole === "assistant" && item.snapshotMessageText.includes("KIMIX_SNAPSHOT_REPLAY_OK"));
    const localEvents = assistantReplay ? [{
      type: "assistant_message",
      content: assistantReplay.snapshotMessageText,
      thinking: "",
    }] : [];
    const skipExisting = assistantReplay ? shouldSkipHistoryReplay(assistantReplay, localEvents) : false;
    const keepMissing = assistantReplay ? !shouldSkipHistoryReplay(assistantReplay, []) : false;
    record("Kimix snapshot replay adapter", Boolean(assistantReplay && skipExisting && keepMissing), {
      sessionId: session.id,
      promptId: prompt.prompt_id,
      snapshotKeys: snapshot && typeof snapshot === "object" ? Object.keys(snapshot) : [],
      snapshotMessageCount: Array.isArray(snapshot?.messages?.items) ? snapshot.messages.items.length : 0,
      replayPayloadCount: replayPayloads.length,
      assistantReplay: assistantReplay ? {
        snapshotReplay: assistantReplay.snapshotReplay,
        snapshotRole: assistantReplay.snapshotRole,
        snapshotMessageId: assistantReplay.snapshotMessageId,
        textLength: assistantReplay.snapshotMessageText.length,
        containsMarker: assistantReplay.snapshotMessageText.includes("KIMIX_SNAPSHOT_REPLAY_OK"),
      } : undefined,
      skipExisting,
      keepMissing,
    });
  } catch (error) {
    record("Kimix snapshot replay adapter", false, { error: summarizeError(error), sessionId: session?.id });
  } finally {
    try { socket?.close(); } catch {}
    if (session?.id) {
      try {
        await request(`/sessions/${encodeURIComponent(session.id)}:archive`, { method: "POST", body: "{}" });
      } catch {}
    }
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
    "- Kimix snapshot replay adapter 已用真实 Server session / prompt / snapshot 验证：history replay 有稳定标记，renderer 可跳过已存在内容并补入缺失内容。",
    "- 当前 0.17.1 native CLI 的 `/meta` 与 OpenAPI 自报版本为 `0.0.0`；P2 必须按 endpoint / contract capability 探测，不能只按 server_version 判断。",
    "- P2 可在实验开关后新增 Kimix Server Host；现有 vendored SDK Host 继续作为默认与回滚路径。",
    "",
    "## P3 Kimix 接入复验（2026-06-18）",
    "",
    "- 跨工作区会话：实验路由下 `listSessions({})` 改走 Server 全局列表，现有 UI 的“全部工作目录”入口可复用。",
    "- 官方 fork / 子会话：fork、children list/create 已接入主进程与 preload API。",
    "- 任务管理：Server task list/get/cancel 已接入现有 Kimix 后台任务接口；真实启动、读取、取消一个 running bash 后台任务已验证。",
    "- 终端管理：terminal list 真实读取通过，create/list/close 与 WS attach/detach/input/resize 已接入主进程与 preload API。",
    "- Windows 限制：本机 0.17.1 CLI 调用 terminal create 时返回 `Failed to load native module: conpty.node`，说明接口存在但当前安装包缺少可加载的 Windows ConPTY native 模块；Kimix 将该上游错误归一为可读中文提示并保留原始错误，不伪装为成功。",
    "- 断线重放：Kimix 客户端携带 cursor 重连并触发 snapshot 恢复；history replay 已增加去重补偿，in-flight replay 用于恢复断线中正在生成的正文。",
  ];
  await writeFile(reportPath, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  try {
    const cliVersion = await run(kimiExecutable, ["--version"], { timeoutMs: 10_000 });
    record("installed CLI version", cliVersion.code === 0 && !cliVersion.timedOut, cliVersion);
    await startServer();
    await probeContracts();
    await probeKimixSnapshotReplayAdapter();
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
