import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const executable = process.env.KIMIX_KIMI_EXECUTABLE ?? path.join(os.homedir(), ".kimi-code", "bin", "kimi.exe");
const port = Number(process.env.KIMIX_KIMI_SERVER_PROBE_PORT ?? 58_643);
const baseUrl = `http://127.0.0.1:${port}`;
const apiBase = `${baseUrl}/api/v1`;
const workspace = await mkdtemp(path.join(os.tmpdir(), "kimix-server-tools-"));
let server;
let socket;

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

async function connectAndSubscribe(sessionId) {
  socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/api/v1/ws`);
  const queue = [];
  const waiters = [];
  const waitFor = (match, timeoutMs = 5_000) => {
    const index = queue.findIndex(match);
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve, timer: undefined };
      waiter.timer = setTimeout(() => {
        const waiterIndex = waiters.indexOf(waiter);
        if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
        reject(new Error("WebSocket frame timeout"));
      }, timeoutMs);
      waiters.push(waiter);
    });
  };
  socket.addEventListener("message", (event) => {
    const frame = JSON.parse(String(event.data));
    const index = waiters.findIndex((waiter) => waiter.match(frame));
    if (index >= 0) {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(frame);
    } else queue.push(frame);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("WebSocket open failed")), { once: true });
  });
  await waitFor((frame) => frame.type === "server_hello");
  const id = `kimix-tools-${Date.now()}`;
  socket.send(JSON.stringify({
    type: "client_hello",
    id,
    payload: { client_id: "kimix-tools-probe", subscriptions: [sessionId] },
  }));
  const ack = await waitFor((frame) => frame.type === "ack" && frame.id === id);
  if (ack.code !== 0) throw new Error(`client_hello failed: ${ack.msg ?? ack.code}`);
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
  const session = (await request("/sessions", {
    method: "POST",
    body: JSON.stringify({ title: "Kimix tools probe", metadata: { cwd: workspace, source: "kimix-tools-probe" } }),
  })).data;
  await connectAndSubscribe(session.id);

  const tools = (await request(`/tools?session_id=${encodeURIComponent(session.id)}`)).data.tools;
  const mcpServers = (await request("/mcp/servers")).data.servers;
  const connections = (await request("/connections")).data.connections;
  const subscribed = connections.filter((connection) => connection.has_client_hello && connection.subscriptions.includes(session.id));
  const sourceCounts = tools.reduce((counts, tool) => ({ ...counts, [tool.source]: (counts[tool.source] ?? 0) + 1 }), {});

  console.log(JSON.stringify({
    ok: tools.length > 0 && subscribed.length > 0,
    cli: executable,
    sessionId: session.id,
    tools: { count: tools.length, sourceCounts, sample: tools.slice(0, 8).map((tool) => ({ name: tool.name, source: tool.source, mcpServerId: tool.mcp_server_id })) },
    mcp: { count: mcpServers.length, connected: mcpServers.filter((item) => item.status === "connected").length, toolCount: mcpServers.reduce((sum, item) => sum + item.tool_count, 0) },
    connections: { count: connections.length, subscribedToCurrentSession: subscribed.length, clients: subscribed.map((connection) => ({ id: connection.id, hasClientHello: connection.has_client_hello, subscriptions: connection.subscriptions })) },
    stderr,
  }, null, 2));

  await request(`/sessions/${encodeURIComponent(session.id)}:archive`, { method: "POST", body: "{}" }, true);
  if (tools.length === 0 || subscribed.length === 0) process.exitCode = 1;
}

try {
  await main();
} finally {
  try { socket?.close(); } catch {}
  if (server?.exitCode === null) await request("/shutdown", { method: "POST", body: "{}" }, true).catch(() => server.kill());
  await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
