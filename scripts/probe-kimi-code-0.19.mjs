import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sdkEntry = process.env.KIMIX_KIMI_CODE_SDK_ENTRY ??
  path.join(repoRoot, "vendor", "kimi-code-sdk", "index.mjs");
const probeRoot = path.join(os.tmpdir(), "kimix-kimi-code-0.19-probe");
const primaryWorkDir = path.join(probeRoot, "primary");
const initialAdditionalDir = path.join(probeRoot, "additional-initial");
const runtimeAdditionalDir = path.join(probeRoot, "additional-runtime");
const kimiExecutable = process.env.KIMIX_KIMI_EXECUTABLE ??
  path.join(os.homedir(), ".kimi-code", "bin", process.platform === "win32" ? "kimi.exe" : "kimi");
const port = Number(process.env.KIMIX_KIMI_SERVER_019_PROBE_PORT ?? 58_719);
const apiBase = `http://127.0.0.1:${port}/api/v1`;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function includesPath(paths, target) {
  const normalizedTarget = path.resolve(target).toLowerCase();
  return asArray(paths).some((item) => typeof item === "string" && path.resolve(item).toLowerCase() === normalizedTarget);
}

async function createHarness() {
  const sdk = await import(pathToFileURL(sdkEntry).href);
  const options = {
    homeDir: process.env.KIMI_CODE_HOME,
    identity: {
      userAgentProduct: "kimi-code-cli",
      version: process.env.KIMI_CODE_SMOKE_VERSION ?? "0.19.0",
    },
    uiMode: "kimix-0.19-probe",
  };
  if (typeof sdk.createKimiHarness === "function") return sdk.createKimiHarness(options);
  return new sdk.KimiHarness(options);
}

function summarizeError(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function request(relativePath, options = {}) {
  const response = await fetch(`${apiBase}${relativePath}`, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(10_000),
    headers: {
      accept: "application/json",
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  const envelope = await response.json();
  if (!response.ok || envelope?.code !== 0) {
    throw new Error(`${options.method ?? "GET"} ${relativePath}: HTTP ${response.status} code=${String(envelope?.code)} msg=${String(envelope?.msg ?? "")}`);
  }
  return envelope.data;
}

async function waitForServer(server) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`server exited early with code ${server.exitCode}`);
    try {
      const health = await request("/healthz");
      if (health?.ok === true) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("server health check timed out");
}

async function probeServerSnapshotSchema() {
  const server = spawn(kimiExecutable, [
    "server", "run", "--foreground", "--port", String(port), "--debug-endpoints", "--log-level", "warn",
  ], {
    cwd: repoRoot,
    env: process.env,
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  server.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  server.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  let session;
  try {
    await waitForServer(server);
    session = await request("/sessions", {
      method: "POST",
      body: JSON.stringify({
        title: "Kimix 0.19 snapshot schema probe",
        metadata: { cwd: primaryWorkDir, source: "kimix-0.19-snapshot-probe" },
      }),
    });
    const snapshot = await request(`/sessions/${encodeURIComponent(session.id)}/snapshot`);
    const messages = snapshot?.messages;
    const ok = Boolean(
      session?.id &&
      snapshot?.session?.id === session.id &&
      Number.isFinite(snapshot?.as_of_seq) &&
      (!("epoch" in snapshot) || typeof snapshot.epoch === "string" || snapshot.epoch === undefined || snapshot.epoch === null) &&
      messages && typeof messages === "object" &&
      Array.isArray(messages.items) &&
      (typeof messages.has_more === "boolean" || messages.has_more === undefined) &&
      (Array.isArray(snapshot.pending_approvals) || snapshot.pending_approvals === undefined) &&
      (Array.isArray(snapshot.pending_questions) || snapshot.pending_questions === undefined)
    );
    return {
      ok,
      sessionId: session.id,
      snapshotKeys: snapshot && typeof snapshot === "object" ? Object.keys(snapshot) : [],
      sessionStatus: snapshot?.session?.status,
      asOfSeq: snapshot?.as_of_seq,
      epochType: typeof snapshot?.epoch,
      messageCount: Array.isArray(messages?.items) ? messages.items.length : null,
      hasMore: messages?.has_more,
      pendingApprovals: Array.isArray(snapshot?.pending_approvals) ? snapshot.pending_approvals.length : 0,
      pendingQuestions: Array.isArray(snapshot?.pending_questions) ? snapshot.pending_questions.length : 0,
    };
  } catch (error) {
    return { ok: false, error: summarizeError(error), stdout, stderr };
  } finally {
    if (session?.id) {
      try {
        await request(`/sessions/${encodeURIComponent(session.id)}:archive`, { method: "POST", body: "{}" });
      } catch {
        // Cleanup only.
      }
    }
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
}

async function main() {
  await Promise.all([
    mkdir(primaryWorkDir, { recursive: true }),
    mkdir(initialAdditionalDir, { recursive: true }),
    mkdir(runtimeAdditionalDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(primaryWorkDir, "README.md"), "Kimix 0.19 primary workdir.\n", "utf-8"),
    writeFile(path.join(initialAdditionalDir, "INITIAL.md"), "Kimix 0.19 initial additional dir.\n", "utf-8"),
    writeFile(path.join(runtimeAdditionalDir, "RUNTIME.md"), "Kimix 0.19 runtime additional dir.\n", "utf-8"),
  ]);

  const harness = await createHarness();
  let session;
  try {
    session = await harness.createSession({
      workDir: primaryWorkDir,
      additionalDirs: [initialAdditionalDir],
      metadata: { source: "kimix-0.19-additional-dirs-probe" },
    });

    const createdAdditionalDirs = session.summary?.additionalDirs ?? [];
    const createdHasInitial = includesPath(createdAdditionalDirs, initialAdditionalDir);

    const addResult = await session.addAdditionalDir(runtimeAdditionalDir, { persist: false });
    const addHasInitial = includesPath(addResult.additionalDirs, initialAdditionalDir);
    const addHasRuntime = includesPath(addResult.additionalDirs, runtimeAdditionalDir);
    const summaryHasRuntime = includesPath(session.summary?.additionalDirs, runtimeAdditionalDir);

    await session.close();

    const resumed = await harness.resumeSession({
      id: session.id,
      additionalDirs: [runtimeAdditionalDir],
    });
    const resumedAdditionalDirs = resumed.summary?.additionalDirs ?? [];
    const resumedHasRuntime = includesPath(resumedAdditionalDirs, runtimeAdditionalDir);
    await resumed.close();

    const ok = createdHasInitial && addHasInitial && addHasRuntime && summaryHasRuntime && resumedHasRuntime;
    const serverSnapshot = await probeServerSnapshotSchema();
    console.log(JSON.stringify({
      ok: ok && serverSnapshot.ok,
      sdkEntry,
      sessionId: session.id,
      workDir: primaryWorkDir,
      initialAdditionalDir,
      runtimeAdditionalDir,
      createdAdditionalDirs,
      addResult,
      resumedAdditionalDirs,
      serverSnapshot,
    }, null, 2));
    if (!ok || !serverSnapshot.ok) process.exitCode = 1;
  } finally {
    if (session) {
      try {
        await session.close();
      } catch {
        // Already closed.
      }
    }
    await harness.close();
  }
}

await main();
