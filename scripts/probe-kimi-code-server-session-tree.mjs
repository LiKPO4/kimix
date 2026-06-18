import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const executable = process.env.KIMIX_KIMI_EXECUTABLE ?? path.join(os.homedir(), ".kimi-code", "bin", "kimi.exe");
const port = Number(process.env.KIMIX_KIMI_SERVER_PROBE_PORT ?? 58_642);
const apiBase = `http://127.0.0.1:${port}/api/v1`;
const workspace = await mkdtemp(path.join(os.tmpdir(), "kimix-server-tree-"));
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

async function archive(sessionId) {
  await request(`/sessions/${encodeURIComponent(sessionId)}:archive`, { method: "POST", body: "{}" }, true);
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

  const parent = (await request("/sessions", {
    method: "POST",
    body: JSON.stringify({ title: "Kimix tree parent", metadata: { cwd: workspace, source: "kimix-tree-probe" } }),
  })).data;
  const fork = (await request(`/sessions/${encodeURIComponent(parent.id)}:fork`, {
    method: "POST",
    body: JSON.stringify({ title: "Kimix tree fork", metadata: { source: "kimix-fork", forkedFrom: parent.id } }),
  })).data;
  const child = (await request(`/sessions/${encodeURIComponent(parent.id)}/children`, {
    method: "POST",
    body: JSON.stringify({ title: "Kimix tree child" }),
  })).data;
  const children = (await request(`/sessions/${encodeURIComponent(parent.id)}/children?page_size=100`)).data.items;
  const childChildren = (await request(`/sessions/${encodeURIComponent(child.id)}/children?page_size=100`)).data.items;
  const resumedChild = (await request(`/sessions/${encodeURIComponent(child.id)}`)).data;
  const sessions = (await request("/sessions?page_size=100")).data.items;
  const forks = sessions.filter((item) => item.metadata?.forkedFrom === parent.id);
  const officialChildIds = new Set(children.map((item) => item.id));
  const combinedIds = new Set([...children, ...forks].map((item) => item.id));

  console.log(JSON.stringify({
    ok: combinedIds.has(fork.id) && combinedIds.has(child.id) && resumedChild.id === child.id,
    cli: executable,
    parent: { id: parent.id, title: parent.title },
    fork: { id: fork.id, title: fork.title, parentSessionId: fork.metadata?.parent_session_id },
    child: { id: child.id, title: child.title, parentSessionId: child.metadata?.parent_session_id },
    listedChildren: children.map((item) => ({ id: item.id, title: item.title, parentSessionId: item.metadata?.parent_session_id })),
    officialChildrenIncludesFork: officialChildIds.has(fork.id),
    kimixForksByMetadata: forks.map((item) => ({ id: item.id, title: item.title, forkedFrom: item.metadata?.forkedFrom })),
    kimixCombinedNodeCount: combinedIds.size,
    childChildrenCount: childChildren.length,
    stderr,
  }, null, 2));

  await Promise.all([archive(fork.id), archive(child.id), archive(parent.id)]);
  if (!combinedIds.has(fork.id) || !combinedIds.has(child.id)) process.exitCode = 1;
}

try {
  await main();
} finally {
  if (server?.exitCode === null) {
    await request("/shutdown", { method: "POST", body: "{}" }, true).catch(() => server.kill());
  }
  await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
