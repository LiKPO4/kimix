import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const executable = process.env.KIMIX_KIMI_EXECUTABLE ?? path.join(os.homedir(), ".kimi-code", "bin", "kimi.exe");
const port = Number(process.env.KIMIX_KIMI_SERVER_PROBE_PORT ?? 58_641);
const baseUrl = `http://127.0.0.1:${port}/api/v1`;
const workspace = await mkdtemp(path.join(os.tmpdir(), "kimix-server-skill-mcp-"));
let server;

async function request(route, options = {}, allowError = false) {
  const response = await fetch(`${baseUrl}${route}`, {
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
      const result = await request("/healthz");
      if (result.data?.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Kimi Server 启动超时");
}

async function main() {
  const skillDir = path.join(workspace, ".kimi-code", "skills", "kimix-probe");
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), [
    "---",
    "name: kimix-probe",
    "description: Kimix Server Skill activation probe",
    "---",
    "",
    "Reply with KIMIX_SKILL_PROBE_OK and $ARGUMENTS.",
    "",
  ].join("\n"), "utf8");

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

  const created = await request("/sessions", {
    method: "POST",
    body: JSON.stringify({ metadata: { cwd: workspace, source: "kimix-skill-mcp-probe" } }),
  });
  const sessionId = created.data.id;
  const skills = await request(`/sessions/${encodeURIComponent(sessionId)}/skills`);
  const probeSkill = skills.data.skills.find((skill) => skill.name === "kimix-probe");
  const activation = await request(`/sessions/${encodeURIComponent(sessionId)}/skills/kimix-probe:activate`, {
    method: "POST",
    body: JSON.stringify({ args: "ARG_OK" }),
  });
  const mcp = await request("/mcp/servers");
  const missingRestart = await request("/mcp/servers/kimix-guaranteed-missing:restart", {
    method: "POST",
    body: "{}",
  }, true);

  console.log(JSON.stringify({
    ok: Boolean(probeSkill && activation.data?.activated && missingRestart.code === 40408),
    cli: executable,
    sessionId,
    skills: { count: skills.data.skills.length, probeSkill },
    activation: activation.data,
    mcp: { count: mcp.data.servers.length, servers: mcp.data.servers },
    missingRestart: { code: missingRestart.code, msg: missingRestart.msg },
    stderr,
  }, null, 2));

  await request(`/sessions/${encodeURIComponent(sessionId)}:archive`, { method: "POST", body: "{}" }, true);
}

try {
  await main();
} finally {
  if (server?.exitCode === null) {
    await request("/shutdown", { method: "POST", body: "{}" }, true).catch(() => server.kill());
  }
  await rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
