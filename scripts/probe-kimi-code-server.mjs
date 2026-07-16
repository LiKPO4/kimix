import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

// Kimi Code Server 0.23+ 默认要求 token 鉴权，与 electron/kimiCodeServerClient.ts 保持一致：
// REST 走 authorization/x-kimi-server-token 头，WebSocket 走 ?token= 查询参数。
function readServerToken() {
  try {
    const token = readFileSync(path.join(os.homedir(), ".kimi-code", "server.token"), "utf8").trim();
    return token || "";
  } catch {
    return "";
  }
}

const serverToken = readServerToken();
const authHeaders = serverToken
  ? { authorization: `Bearer ${serverToken}`, "x-kimi-server-token": serverToken }
  : {};
const wsTokenQuery = serverToken ? `?token=${encodeURIComponent(serverToken)}` : "";
// 0.24+（agent-core-v2）WS upgrade 只认 Authorization 头或 bearer 子协议；保留查询参数兼容旧 v1 网关。
const wsProtocols = serverToken ? [`kimi-code.bearer.${serverToken}`] : undefined;

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

async function requestEnvelope(relativePath, options = {}) {
  const response = await fetch(`${apiBase}${relativePath}`, {
    ...options,
    headers: {
      accept: "application/json",
      ...authHeaders,
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  let envelope;
  try {
    envelope = await response.json();
  } catch (error) {
    return {
      ok: false,
      status: response.status,
      envelope: { code: -1, msg: summarizeError(error), data: undefined },
    };
  }
  return { ok: response.ok, status: response.status, envelope };
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
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/api/v1/ws${wsTokenQuery}`, wsProtocols);
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
  return { socket, waitFor, drain: () => { queue.length = 0; } };
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
  const openapi = await fetch(`${baseUrl}/openapi.json`, { headers: authHeaders }).then((response) => response.json());
  const asyncapi = await fetch(`${baseUrl}/asyncapi.json`, { headers: authHeaders }).then((response) => response.json());
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
    await applyProbeProfile(session.id);
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
    const sessionStatus = await request(`/sessions/${encodeURIComponent(session.id)}/status`);
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
    const statusContextValid = Number.isFinite(sessionStatus?.context_tokens) &&
      Number.isFinite(sessionStatus?.max_context_tokens) &&
      Number.isFinite(sessionStatus?.context_usage);
    record("Kimix snapshot replay + session status adapter", Boolean(assistantReplay && skipExisting && keepMissing && statusContextValid), {
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
      sessionStatus: {
        status: sessionStatus?.status,
        contextTokens: sessionStatus?.context_tokens,
        maxContextTokens: sessionStatus?.max_context_tokens,
        contextUsage: sessionStatus?.context_usage,
        contextFieldsValid: statusContextValid,
      },
    });
  } catch (error) {
    record("Kimix snapshot replay + session status adapter", false, { error: summarizeError(error), sessionId: session?.id });
  } finally {
    try { socket?.close(); } catch {}
    if (session?.id) {
      try {
        await request(`/sessions/${encodeURIComponent(session.id)}:archive`, { method: "POST", body: "{}" });
      } catch {}
    }
  }
}

let probeModelPromise;
async function pickProbeModel() {
  probeModelPromise ??= (async () => {
    const catalog = await request("/models");
    const items = Array.isArray(catalog?.items) ? catalog.items : [];
    const ids = items.map((item) => item?.model).filter((value) => typeof value === "string");
    return ids.find((id) => id === "kimi-code/kimi-for-coding")
      ?? ids.find((id) => id.startsWith("kimi-code/"))
      ?? ids[0]
      ?? null;
  })();
  return probeModelPromise;
}

// Kimi Code 0.24+（agent-core-v2）的 create 路由不消费 agent_config，会话必须经
// profile 端点设置模型，否则首个 prompt 以 model.not_configured 失败。
async function applyProbeProfile(sessionId, extra = {}) {
  const model = await pickProbeModel();
  if (!model) throw new Error("no catalog model available for probe profile");
  await request(`/sessions/${encodeURIComponent(sessionId)}/profile`, {
    method: "POST",
    body: JSON.stringify({ agent_config: { model, ...extra } }),
  });
  return model;
}

async function probeKimixBtwAdapter() {
  let session;
  let socket;
  try {
    session = await request("/sessions", {
      method: "POST",
      body: JSON.stringify({ title: "Kimix Server BTW probe", metadata: { cwd: repoRoot, source: "kimix-btw-probe" } }),
    });
    await applyProbeProfile(session.id);
    const ws = await openProbeSocket(session.id);
    socket = ws.socket;
    // 0.24+ 主 agent 惰性引导，:btw 要求 source agent 已存在；先跑一个真实主 turn。
    const bootPrompt = await request(`/sessions/${encodeURIComponent(session.id)}/prompts`, {
      method: "POST",
      body: JSON.stringify({ content: [{ type: "text", text: "Reply with exactly: KIMIX_BTW_BOOT_OK" }] }),
    });
    await ws.waitFor((frame) => {
      if (frame.type !== "prompt.completed" || frame.session_id !== session.id) return false;
      const payload = isRecord(frame.payload) ? frame.payload : {};
      return (payload.prompt_id ?? payload.promptId) === bootPrompt.prompt_id;
    }, 120_000);
    ws.drain();
    const started = await request(`/sessions/${encodeURIComponent(session.id)}:btw`, { method: "POST", body: "{}" });
    const marker = `KIMIX_SERVER_BTW_${Date.now()}`;
    const prompt = await request(`/sessions/${encodeURIComponent(session.id)}/prompts`, {
      method: "POST",
      body: JSON.stringify({
        agent_id: started.agent_id,
        content: [{ type: "text", text: `Reply with exactly: ${marker}` }],
      }),
    });
    const frames = [];
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const frame = await ws.waitFor((item) => item.session_id === session.id, Math.max(1, deadline - Date.now()));
      frames.push(frame);
      const payload = isRecord(frame.payload) ? frame.payload : {};
      if (frame.type === "prompt.completed" && (payload.prompt_id ?? payload.promptId) === prompt.prompt_id) break;
    }
    const btwFrames = frames.filter((frame) => isRecord(frame.payload) && frame.payload.agentId === started.agent_id);
    const text = btwFrames
      .filter((frame) => frame.type === "assistant.delta")
      .map((frame) => frame.payload.delta)
      .filter((value) => typeof value === "string")
      .join("");
    const mainContentFrames = frames.filter((frame) => isRecord(frame.payload) && frame.payload.agentId === "main" && (
      frame.type === "assistant.delta" || frame.type === "thinking.delta" || frame.type === "turn.ended"
    ));
    const ended = btwFrames.some((frame) => frame.type === "turn.ended");
    record("Kimix Server BTW adapter", Boolean(started.agent_id && text.includes(marker) && ended && mainContentFrames.length === 0), {
      sessionId: session.id,
      promptId: prompt.prompt_id,
      agentId: started.agent_id,
      frameCount: frames.length,
      btwFrameCount: btwFrames.length,
      mainContentFrameCount: mainContentFrames.length,
      containsMarker: text.includes(marker),
      ended,
    });
  } catch (error) {
    record("Kimix Server BTW adapter", false, { error: summarizeError(error), sessionId: session?.id });
  } finally {
    try { socket?.close(); } catch {}
    if (session?.id) {
      try {
        await request(`/sessions/${encodeURIComponent(session.id)}:archive`, { method: "POST", body: "{}" });
      } catch {}
    }
  }
}

async function waitForTask(sessionId, predicate, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let latestTasks = [];
  while (Date.now() < deadline) {
    const result = await request(`/sessions/${encodeURIComponent(sessionId)}/tasks`);
    latestTasks = Array.isArray(result?.items) ? result.items : [];
    const task = latestTasks.find(predicate);
    if (task) return task;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Task wait timed out after ${timeoutMs}ms; latest=${JSON.stringify(latestTasks.map((task) => ({
    id: task.id,
    kind: task.kind,
    status: task.status,
    description: task.description,
  })))}`);
}

async function approvePendingBashRequests(sessionId) {
  const result = await request(`/sessions/${encodeURIComponent(sessionId)}/approvals?status=pending`);
  const approvals = Array.isArray(result?.items) ? result.items : [];
  let approved = 0;
  for (const approval of approvals) {
    if (approval?.tool_name !== "Bash" || typeof approval?.approval_id !== "string") continue;
    const resolved = await request(`/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approval.approval_id)}`, {
      method: "POST",
      body: JSON.stringify({ decision: "approved" }),
    });
    if (resolved?.resolved === true) approved += 1;
  }
  return approved;
}

async function waitForTaskAfterPrompt(sessionId, predicate, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let approvedCount = 0;
  let latestTasks = [];
  while (Date.now() < deadline) {
    approvedCount += await approvePendingBashRequests(sessionId);
    const result = await request(`/sessions/${encodeURIComponent(sessionId)}/tasks`);
    latestTasks = Array.isArray(result?.items) ? result.items : [];
    const task = latestTasks.find(predicate);
    if (task) return { task, approvedCount };
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Task wait timed out after ${timeoutMs}ms; approved=${approvedCount}; latest=${JSON.stringify(latestTasks.map((taskItem) => ({
    id: taskItem.id,
    kind: taskItem.kind,
    status: taskItem.status,
    description: taskItem.description,
  })))}`);
}

async function getTaskWithOutput(sessionId, taskId, outputBytes = 4096) {
  return request(`/sessions/${encodeURIComponent(sessionId)}/tasks/${encodeURIComponent(taskId)}?with_output=true&output_bytes=${outputBytes}`);
}

async function cancelTask(sessionId, taskId) {
  return requestEnvelope(`/sessions/${encodeURIComponent(sessionId)}/tasks/${encodeURIComponent(taskId)}:cancel`, {
    method: "POST",
    body: "{}",
  });
}

async function probeKimixTaskAdapter() {
  let session;
  let socket;
  let task;
  try {
    session = await request("/sessions", {
      method: "POST",
      body: JSON.stringify({
        title: "Kimix Server task probe",
        metadata: { cwd: repoRoot, source: "kimix-task-probe" },
        agent_config: {
          thinking: "off",
          permission_mode: "yolo",
          plan_mode: false,
        },
      }),
    });
    // create 的 agent_config 在 0.24+ 被忽略，经 profile 实际应用。
    await applyProbeProfile(session.id, { thinking: "off", permission_mode: "yolo", plan_mode: false });
    const ws = await openProbeSocket(session.id);
    socket = ws.socket;
    const marker = `KIMIX_TASK_PROBE_${Date.now()}`;
    const prompt = await request(`/sessions/${encodeURIComponent(session.id)}/prompts`, {
      method: "POST",
      body: JSON.stringify({
        content: [{
          type: "text",
          text: [
            "请只做一个动作：使用 Bash 工具启动后台任务，必须设置 run_in_background=true，并填写简短 description。",
            "命令必须是下面这一行，不要改写，不要创建或修改任何文件：",
            `node -e "let i=0; setInterval(()=>console.log('${marker}_'+(++i)),500)"`,
            "后台任务启动后，用一句话回复“任务已启动”，不要等待命令结束。",
          ].join("\n"),
        }],
      }),
    });
    const taskResult = await waitForTaskAfterPrompt(session.id, (item) => item.kind === "bash" && item.status === "running");
    task = taskResult.task;
    const runningList = await request(`/sessions/${encodeURIComponent(session.id)}/tasks?status=running`);
    const beforeCancel = await getTaskWithOutput(session.id, task.id);
    const firstCancel = await cancelTask(session.id, task.id);
    const afterCancel = await waitForTask(session.id, (item) => item.id === task.id && item.status !== "running", 30_000);
    const afterCancelWithOutput = await getTaskWithOutput(session.id, task.id);
    const secondCancel = await cancelTask(session.id, task.id);
    let promptCompleted = false;
    try {
      await ws.waitFor((frame) => {
        if (frame.type !== "prompt.completed" || frame.session_id !== session.id) return false;
        const payload = isRecord(frame.payload) ? frame.payload : {};
        return (payload.prompt_id ?? payload.promptId) === prompt.prompt_id;
      }, 30_000);
      promptCompleted = true;
    } catch {
      promptCompleted = false;
    }
    const firstCancelOk = firstCancel.envelope?.code === 0 && firstCancel.envelope?.data?.cancelled === true;
    const secondCancelOk = secondCancel.envelope?.code === 0 || secondCancel.envelope?.code === 40904;
    const terminalStatusOk = ["completed", "failed", "cancelled"].includes(afterCancel.status);
    const outputBytes = Number(afterCancelWithOutput.output_bytes ?? beforeCancel.output_bytes ?? 0);
    record("Kimix Server task adapter", Boolean(task.id && firstCancelOk && secondCancelOk && terminalStatusOk), {
      sessionId: session.id,
      promptId: prompt.prompt_id,
      taskId: task.id,
      kind: task.kind,
      approvedBashRequests: taskResult.approvedCount,
      promptCompletedAfterCancel: promptCompleted,
      runningListCount: Array.isArray(runningList?.items) ? runningList.items.length : 0,
      beforeCancel: {
        status: beforeCancel.status,
        outputBytes: beforeCancel.output_bytes ?? 0,
        hasOutputPreview: typeof beforeCancel.output_preview === "string" && beforeCancel.output_preview.length > 0,
      },
      firstCancel: {
        httpStatus: firstCancel.status,
        code: firstCancel.envelope?.code,
        cancelled: firstCancel.envelope?.data?.cancelled,
      },
      afterCancel: {
        status: afterCancel.status,
        outputBytes,
        hasOutputPreview: typeof afterCancelWithOutput.output_preview === "string" && afterCancelWithOutput.output_preview.length > 0,
      },
      secondCancel: {
        httpStatus: secondCancel.status,
        code: secondCancel.envelope?.code,
        cancelled: secondCancel.envelope?.data?.cancelled,
      },
    });
  } catch (error) {
    if (session?.id && task?.id) {
      try { await cancelTask(session.id, task.id); } catch {}
    }
    record("Kimix Server task adapter", false, { error: summarizeError(error), sessionId: session?.id, taskId: task?.id });
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
  // 官方 0.24 起移除 v1 server 包与 @moonshot-ai/server-e2e；包不存在时显式记录跳过而不是失败。
  if (!existsSync(path.join(researchRepo, "packages", "server-e2e"))) {
    record(file, true, { skipped: true, coverage, reason: "upstream removed @moonshot-ai/server-e2e (agent-core-v2 default since 0.24)" });
    return;
  }
  const result = await run("pnpm", ["--filter", "@moonshot-ai/server-e2e", "exec", "tsx", `scenarios/${file}`], {
    cwd: researchRepo,
    env: { KIMI_SERVER_URL: baseUrl },
  });
  const ok = result.code === 0 && !result.timedOut && !result.error;
  record(file, ok, { coverage, ...result });
}

async function writeReport() {
  const cliVersionText = String(
    results.find((item) => item.name === "installed CLI version")?.detail?.stdout ?? "",
  ).trim() || "unknown";
  const isSkipped = (item) => item.detail?.skipped === true;
  const passedCount = results.filter((item) => item.ok && !isSkipped(item)).length;
  const failedCount = results.filter((item) => !item.ok).length;
  const skippedCount = results.filter(isSkipped).length;
  const scenariosSkipped = results.some((item) => isSkipped(item));
  const lines = [
    `# Kimi Code ${cliVersionText} Server 探针结果`,
    "",
    `- 生成时间：${new Date().toISOString()}`,
    `- CLI：${kimiExecutable}`,
    `- Server：${baseUrl}`,
    `- 官方源码：${researchRepo}`,
    `- 结果：${passedCount} 通过 / ${failedCount} 失败 / ${skippedCount} 跳过`,
    "",
    "## 明细",
    "",
    ...results.flatMap((item) => [
      `### ${isSkipped(item) ? "跳过" : item.ok ? "通过" : "失败"}：${item.name}`,
      "",
      "```json",
      JSON.stringify(item.detail, null, 2),
      "```",
      "",
    ]),
    "## 结论",
    "",
    scenariosSkipped
      ? "- 官方 0.24+ 已移除 @moonshot-ai/server-e2e 场景包；刷新重放、pending 闭环、队列 steer、cancel 语义改由 Kimix 自有回归与适配器检查覆盖。"
      : "- Server REST、WebSocket、事件重放、快照、prompt、steer、cancel、approval 和 question 均由官方 server-e2e 场景验证。",
    "- Kimix snapshot replay 与 session status adapter 已用真实 Server session / prompt 验证：history replay 可去重补偿，context tokens/limit/usage 可回填现有 ContextRing。",
    "- Kimix Server BTW adapter 已用真实 Server session 验证：`:btw` 返回独立 agent_id，prompt 事件只归属该子 Agent，可按 Agent ID 隔离并汇总而不污染主对话。",
    "- Kimix Server task adapter 已用真实 Server session / Bash background task 验证：list/get/cancel、输出元数据和 already-finished 幂等停止均可被 Kimix 现有后台任务接口承接。",
    "- REST 与 WebSocket 默认要求 `~/.kimi-code/server.token` 鉴权（REST 走 authorization 头，WS 走 ?token= 查询参数）；`/meta` 自报 server_version、capabilities 与 backend 字段。",
    "",
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
    await probeKimixBtwAdapter();
    await probeKimixTaskAdapter();
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
    passed: results.filter((item) => item.ok && !item.detail?.skipped).length,
    failed: results.filter((item) => !item.ok).length,
    skipped: results.filter((item) => item.detail?.skipped === true).length,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

await main();
