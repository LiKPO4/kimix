// Kimi Code 0.26.0 子代理/工具事件探针：验证 coder 子代理扩展（后台任务/嵌套 agent/Todo）后，
// 官方 Server 事件流仍满足 Kimix 子代理投影与工具渲染的字段假设（runtime-routing 18c/18d、35）。
// 证据写入 docs/kimi-code-0.26-subagent-probe.md。
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const port = Number(process.env.KIMIX_KIMI_SUBAGENT_PROBE_PORT ?? 58_731);
const baseUrl = `http://127.0.0.1:${port}`;
const kimi = path.join(os.homedir(), ".kimi-code", "bin", process.platform === "win32" ? "kimi.exe" : "kimi");
const token = readFileSync(path.join(os.homedir(), ".kimi-code", "server.token"), "utf8").trim();
const authHeaders = { authorization: `Bearer ${token}`, "x-kimi-server-token": token };

const server = spawn(kimi, ["server", "run", "--foreground", "--port", String(port), "--log-level", "warn"], {
  stdio: ["ignore", "ignore", "pipe"], windowsHide: true, shell: false,
});

async function req(p, options = {}) {
  const r = await fetch(`${baseUrl}/api/v1${p}`, {
    ...options,
    headers: { accept: "application/json", ...authHeaders, ...(options.body ? { "content-type": "application/json" } : {}) },
  });
  const j = await r.json();
  if (typeof j?.code !== "number" || j.code !== 0) throw new Error(`${options.method ?? "GET"} ${p}: code=${j?.code} msg=${j?.msg}`);
  return j.data;
}

const frames = [];
const checks = [];
function check(name, ok, detail) { checks.push({ name, ok, detail }); }
const countByType = (list) => list.reduce((acc, f) => { acc[f.type] = (acc[f.type] ?? 0) + 1; return acc; }, {});

async function waitMainCompleted(sessionId, promptId, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (frames.some((f) => f.type === "prompt.completed" && f.session_id === sessionId
      && (f.payload?.promptId ?? f.payload?.prompt_id) === promptId)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  for (let i = 0; i < 40; i++) {
    try { const h = await req("/healthz"); if (h?.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const models = await req("/models");
  const ids = (models?.items ?? []).map((m) => m?.model).filter((v) => typeof v === "string");
  const model = ids.find((id) => id === "kimi-code/kimi-for-coding") ?? ids.find((id) => id.startsWith("kimi-code/")) ?? ids[0];
  check("catalog model", Boolean(model), { model });

  const session = await req("/sessions", {
    method: "POST",
    body: JSON.stringify({ title: "subagent probe", metadata: { cwd: repoRoot, source: "kimix-subagent-probe" } }),
  });
  await req(`/sessions/${session.id}/profile`, { method: "POST", body: JSON.stringify({ agent_config: { model, permission_mode: "yolo" } }) });

  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/ws`, [`kimi-code.bearer.${token}`]);
  ws.addEventListener("message", (e) => frames.push(JSON.parse(String(e.data))));
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.send(JSON.stringify({ type: "client_hello", id: "h1", payload: { client_id: "kimix-subagent-probe", subscriptions: [session.id] } }));
  await new Promise((r) => setTimeout(r, 800));

  // 阶段 1：强制一次 Bash 工具调用，验证 tool.call/tool.result 线上帧。
  const toolPrompt = await req(`/sessions/${session.id}/prompts`, {
    method: "POST",
    body: JSON.stringify({
      content: [{ type: "text", text: "Run exactly this one command with the Bash tool: echo TOOL_PROBE_OK. Then reply with the single word TOOL_PHASE_DONE." }],
    }),
  });
  check("tool phase prompt completed", await waitMainCompleted(session.id, toolPrompt.prompt_id), {});
  // v2 线上拼写为 tool.call.started（tool.call 留在 context.append_loop_event 历史内），两者都算。
  const toolFrames = frames.filter((f) => f.type === "tool.call" || f.type === "tool.call.started" || f.type === "tool.result");
  check("tool.call(.started)/tool.result frames observed", toolFrames.length > 0, countByType(toolFrames));
  const bashCall = toolFrames.find((f) => f.type === "tool.call" || f.type === "tool.call.started")?.payload;
  check("tool.call payload has id+name", Boolean(bashCall && typeof (bashCall.toolCallId ?? bashCall.tool_call_id ?? bashCall.id) === "string"), bashCall ? Object.keys(bashCall).slice(0, 12) : undefined);

  // 阶段 2：强制一次 coder 子代理，验证生命周期与嵌套归属。
  const subPrompt = await req(`/sessions/${session.id}/prompts`, {
    method: "POST",
    body: JSON.stringify({
      content: [{ type: "text", text: "Use the Agent tool exactly once to launch a coder subagent with this task: reply with the single word SUBAGENT_PROBE_OK. Do not do anything else. After it completes, reply with the single word MAIN_DONE." }],
    }),
  });
  check("subagent phase prompt completed", await waitMainCompleted(session.id, subPrompt.prompt_id), {});

  const sub = frames.filter((f) => typeof f.type === "string" && f.type.startsWith("subagent."));
  check("subagent lifecycle frames present", sub.length > 0, countByType(sub));

  const spawned = sub.find((f) => f.type === "subagent.spawned")?.payload;
  check("spawned payload fields", Boolean(spawned && typeof spawned.subagentId === "string" && typeof spawned.subagentName === "string" && typeof spawned.parentToolCallId === "string"), spawned ? {
    subagentId: spawned.subagentId,
    subagentName: spawned.subagentName,
    parentAgentId: spawned.parentAgentId,
    callerAgentId: spawned.callerAgentId,
    hasSwarmIndex: spawned.swarmIndex !== undefined,
    runInBackground: spawned.runInBackground,
  } : undefined);

  const completedEvt = sub.find((f) => f.type === "subagent.completed")?.payload;
  check("completed payload has resultSummary", Boolean(completedEvt && typeof completedEvt.resultSummary === "string"), completedEvt ? {
    subagentId: completedEvt.subagentId,
    summaryLength: completedEvt.resultSummary?.length,
  } : undefined);

  const nested = frames.filter((f) => {
    const a = f.payload?.agentId;
    return typeof a === "string" && a !== "main" && spawned && a === spawned.subagentId;
  });
  check("nested agent frames scoped to subagentId", nested.length > 0, countByType(nested));

  const snapshot = await req(`/sessions/${session.id}/snapshot`);
  check("snapshot has subagents key", Object.prototype.hasOwnProperty.call(snapshot ?? {}, "subagents"), {
    subagentsType: Array.isArray(snapshot?.subagents) ? `array(${snapshot.subagents.length})` : typeof snapshot?.subagents,
  });

  await req(`/sessions/${session.id}:archive`, { method: "POST", body: "{}" });
  ws.close();
}

const checksSummary = () => ({ ok: checks.every((c) => c.ok), passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length });
try {
  await main();
} catch (error) {
  check("probe run", false, { error: String(error?.message ?? error) });
} finally {
  try { await req("/shutdown", { method: "POST", body: "{}" }); } catch { server.kill(); }
  await new Promise((r) => setTimeout(r, 1_500));
  server.kill();
  const lines = [
    "# Kimi Code 0.26.0 子代理/工具事件探针",
    "",
    `- 生成时间：${new Date().toISOString()}`,
    `- 帧总数：${frames.length}`,
    `- 结果：${checksSummary().passed} 通过 / ${checksSummary().failed} 失败`,
    "",
    ...checks.map((c) => `- ${c.ok ? "通过" : "失败"}：${c.name}${c.detail && Object.keys(c.detail).length ? ` — \`${JSON.stringify(c.detail)}\`` : ""}`),
    "",
  ];
  await writeFile(path.join(repoRoot, "docs", "kimi-code-0.26-subagent-probe.md"), `${lines.join("\n")}\n`, "utf8");
  console.log(JSON.stringify(checksSummary()));
  if (!checksSummary().ok) process.exitCode = 1;
}
