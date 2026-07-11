import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const officialRepo =
  process.env.KIMIX_KIMI_CODE_RESEARCH_REPO ??
  path.join(os.homedir(), "AppData", "Local", "Temp", "kimix-kimi-code-research");
const sdkEntry =
  process.env.KIMIX_KIMI_CODE_SDK_ENTRY ??
  path.join(officialRepo, "packages", "node-sdk", "dist", "index.mjs");
const probeRoot = path.join(os.tmpdir(), "kimix-kimi-code-runtime-capabilities-probe");
const workDir = path.join(probeRoot, "work");

async function capture(name, fn) {
  try {
    return { ok: true, name, data: await fn() };
  } catch (error) {
    return {
      ok: false,
      name,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  await mkdir(workDir, { recursive: true });
  const sdk = await import(pathToFileURL(sdkEntry).href);
  const options = {
    homeDir: process.env.KIMI_CODE_HOME,
    identity: {
      userAgentProduct: "kimi-code-cli",
      version: process.env.KIMI_CODE_SMOKE_VERSION ?? "0.6.0",
    },
    uiMode: "kimix-runtime-capabilities-probe",
  };
  const harness = typeof sdk.createKimiHarness === "function"
    ? sdk.createKimiHarness(options)
    : new sdk.KimiHarness(options);

  let session;
  try {
    session = await harness.createSession({
      workDir,
      metadata: { source: "kimix-runtime-capabilities-probe" },
    });
    const results = await Promise.all([
      capture("session.getUsage", () => session.getUsage()),
      capture("session.listMcpServers", () => session.listMcpServers()),
      capture("session.getMcpStartupMetrics", () => session.getMcpStartupMetrics()),
      capture("session.listBackgroundTasks", () => session.listBackgroundTasks()),
      capture("session.listBackgroundTasks(activeOnly)", () => session.listBackgroundTasks({ activeOnly: true })),
      capture("session.getBackgroundTaskOutput(unknown)", () => session.getBackgroundTaskOutput("bash-deadbeef", { tail: 2000 })),
      capture("session.getBackgroundTaskOutputPath(unknown)", () => session.getBackgroundTaskOutputPath("bash-deadbeef")),
      capture("session.stopBackgroundTask(unknown)", () => session.stopBackgroundTask("bash-deadbeef", { reason: "kimix probe" })),
      capture("harness.auth.getManagedUsage", () => harness.auth.getManagedUsage()),
    ]);
    console.log(JSON.stringify({
      ok: true,
      sdkEntry,
      workDir,
      sessionId: session.id,
      results: results.map((result) => {
        if (!result.ok) return result;
        if (result.name === "session.listMcpServers") {
          return {
            ...result,
            count: Array.isArray(result.data) ? result.data.length : null,
            data: Array.isArray(result.data)
              ? result.data.map((server) => ({
                  name: server.name,
                  transport: server.transport,
                  status: server.status,
                  toolCount: server.toolCount,
                  error: server.error,
                }))
              : result.data,
          };
        }
        if (result.name.startsWith("session.listBackgroundTasks")) {
          return {
            ...result,
            count: Array.isArray(result.data) ? result.data.length : null,
            data: Array.isArray(result.data)
              ? result.data.map((task) => ({
                  taskId: task.taskId,
                  status: task.status,
                  command: task.command,
                  description: task.description,
                  pid: task.pid,
                  exitCode: task.exitCode,
                  startedAt: task.startedAt,
                  endedAt: task.endedAt,
                }))
              : result.data,
          };
        }
        return result;
      }),
    }, null, 2));
  } finally {
    if (session) await session.close();
    await harness.close();
  }
}

await main();
