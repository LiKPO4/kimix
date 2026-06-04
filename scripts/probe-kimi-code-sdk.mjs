import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const officialRepo =
  process.env.KIMIX_KIMI_CODE_RESEARCH_REPO ??
  path.join(os.homedir(), "AppData", "Local", "Temp", "kimix-kimi-code-research");
const probeRoot = path.join(os.tmpdir(), "kimix-kimi-code-sdk-probe");
const workDir = path.join(probeRoot, "work");
const homeDir = process.env.KIMI_CODE_HOME ?? path.join(os.homedir(), ".kimi-code");
const reportPath = path.join(repoRoot, "docs", "kimi-code-sdk-probe-result.md");

const timeoutMs = Number(process.env.KIMIX_PROBE_TIMEOUT_MS ?? 45_000);
const heavyTimeoutMs = Number(process.env.KIMIX_PROBE_HEAVY_TIMEOUT_MS ?? 180_000);
const skipHeavy = process.env.KIMIX_PROBE_SKIP_HEAVY === "1";
const skipDocWrite = process.env.KIMIX_PROBE_SKIP_DOC_WRITE === "1";

const results = [];

function nowIso() {
  return new Date().toISOString();
}

function summarizeError(error) {
  if (!error) return "unknown error";
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function pass(name, detail = {}) {
  results.push({ name, status: "pass", detail });
}

function fail(name, error, detail = {}) {
  results.push({ name, status: "fail", error: summarizeError(error), detail });
}

function skip(name, reason, detail = {}) {
  results.push({ name, status: "skip", reason, detail });
}

function runCommand(command, args, options = {}) {
  const cwd = options.cwd ?? repoRoot;
  const env = { ...process.env, ...(options.env ?? {}) };
  const limit = options.timeoutMs ?? timeoutMs;

  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let child;

    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({
        command: [command, ...args].join(" "),
        cwd,
        code: null,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        spawnError: summarizeError(error),
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // Best effort; the result records the timeout.
      }
    }, limit);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        command: [command, ...args].join(" "),
        cwd,
        code: null,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        spawnError: summarizeError(error),
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        command: [command, ...args].join(" "),
        cwd,
        code,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
  });
}

function countItems(items) {
  const counts = {};
  for (const item of items) {
    counts[item] = (counts[item] ?? 0) + 1;
  }
  return counts;
}

async function recordCommand(name, command, args, options = {}) {
  const result = await runCommand(command, args, options);
  if (result.code === 0 && !result.timedOut && !result.spawnError) {
    pass(name, result);
  } else {
    fail(name, result.spawnError ?? `exit ${String(result.code)}`, result);
  }
  return result;
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function probeInstalledOldSdk() {
  try {
    const pkgPath = path.join(repoRoot, "node_modules", "@moonshot-ai", "kimi-agent-sdk", "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
    const mod = await import("@moonshot-ai/kimi-agent-sdk");
    pass("installed @moonshot-ai/kimi-agent-sdk", {
      version: pkg.version,
      exports: Object.keys(mod).sort(),
    });
    return mod;
  } catch (error) {
    fail("installed @moonshot-ai/kimi-agent-sdk", error);
    return undefined;
  }
}

async function probeOldProtocolClient(agentSdk) {
  if (!agentSdk?.ProtocolClient) {
    skip("old ProtocolClient wire handshake", "ProtocolClient export is unavailable");
    return;
  }

  async function runHandshake(name) {
    const client = new agentSdk.ProtocolClient();
    try {
      const init = await client.start({
        workDir,
        executablePath: "kimi",
        environmentVariables: {
          ...process.env,
          KIMI_CODE_HOME: homeDir,
        },
        clientInfo: { name: "kimix-p0-probe", version: "0.0.0" },
      });
      pass(name, {
        init,
        isRunning: client.isRunning,
      });
      return true;
    } catch (error) {
      fail(name, error);
      return false;
    } finally {
      try {
        await client.stop();
      } catch {
        // The original failure is more useful.
      }
    }
  }

  const originalOk = await runHandshake("old ProtocolClient wire handshake");
  if (originalOk) return;

  const proto = agentSdk.ProtocolClient.prototype;
  if (typeof proto.buildArgs !== "function") {
    skip("old ProtocolClient wire handshake with Kimix compat patch", "buildArgs is not patchable");
    return;
  }

  const originalBuildArgs = proto.buildArgs;
  proto.buildArgs = function patchedBuildArgs(options) {
    const args = originalBuildArgs.call(this, options);
    const workDirIndex = args.indexOf("--work-dir");
    if (workDirIndex >= 0) {
      args.splice(workDirIndex, args[workDirIndex + 1] ? 2 : 1);
    }
    return args;
  };

  try {
    await runHandshake("old ProtocolClient wire handshake with Kimix compat patch");
  } finally {
    proto.buildArgs = originalBuildArgs;
  }
}

async function probeWireRawLaunch() {
  const child = spawn("kimi", ["--wire"], {
    cwd: workDir,
    env: { ...process.env, KIMI_CODE_HOME: homeDir },
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const startedAt = Date.now();
  let stdout = "";
  let stderr = "";
  let firstLine;
  let settled = false;

  const result = await new Promise((resolve) => {
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // Best effort.
      }
      finish({ kind: "timeout" });
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
      const line = stdout.split(/\r?\n/).find((item) => item.trim().length > 0);
      if (line && firstLine === undefined) {
        firstLine = line;
        clearTimeout(timer);
        finish({ kind: "stdout-line", firstLine });
      }
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ kind: "error", error: summarizeError(error) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ kind: "close", code });
    });
  });

  try {
    child.kill("SIGTERM");
  } catch {
    // The process may already be gone.
  }

  const detail = {
    ...result,
    durationMs: Date.now() - startedAt,
    stdout,
    stderr,
  };

  if (result.kind === "stdout-line" || result.kind === "timeout") {
    pass("kimi --wire raw launch", detail);
  } else {
    fail("kimi --wire raw launch", result.error ?? `closed with ${String(result.code)}`, detail);
  }
}

async function probeOfficialSdkSource() {
  const pkgPath = path.join(officialRepo, "packages", "node-sdk", "package.json");
  if (!(await fileExists(pkgPath))) {
    fail("official packages/node-sdk source", `not found: ${pkgPath}`);
    return;
  }

  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  pass("official packages/node-sdk source", {
    repo: officialRepo,
    name: pkg.name,
    version: pkg.version,
    private: pkg.private,
    exports: pkg.exports,
  });

  await recordCommand("official repo git head", "git", ["-C", officialRepo, "log", "-1", "--pretty=format:%h %ci %s"]);
  await recordCommand("official packages/node-sdk build", "pnpm", ["--filter", "@moonshot-ai/kimi-code-sdk", "build"], {
    cwd: officialRepo,
    timeoutMs: heavyTimeoutMs,
  });
}

async function locateSessionDir(sessionId) {
  const sessionsRoot = path.join(homeDir, "sessions");
  const stack = [sessionsRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name === sessionId) return full;
      stack.push(full);
    }
  }
  return undefined;
}

async function runPromptStream(session, prompt, options = {}) {
  const waitForFirstDelta = options.waitForFirstDelta ?? true;
  const limit = options.timeoutMs ?? heavyTimeoutMs;
  const events = [];
  let activeTurnId;
  let firstDeltaAt;
  let turnStartedAt;
  let endedAt;
  let turnEndEvent;

  const startedAt = Date.now();
  let unsubscribe;
  const watcher = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for SDK stream events"));
    }, limit);

    unsubscribe = session.onEvent((event) => {
      events.push({
        type: event.type,
        turnId: event.turnId,
        reason: event.reason,
        atMs: Date.now() - startedAt,
      });

      if (event.type === "error") {
        clearTimeout(timer);
        reject(new Error(`${event.code}: ${event.message}`));
        return;
      }

      if (event.type === "turn.started" && activeTurnId === undefined) {
        activeTurnId = event.turnId;
        turnStartedAt = Date.now();
      }

      if (
        firstDeltaAt === undefined &&
        (event.type === "assistant.delta" || event.type === "thinking.delta")
      ) {
        firstDeltaAt = Date.now();
        if (waitForFirstDelta) {
          resolve({ phase: "first-delta", turnId: activeTurnId, events });
        }
      }

      if (
        event.type === "turn.ended" &&
        (activeTurnId === undefined || event.turnId === activeTurnId)
      ) {
        clearTimeout(timer);
        endedAt = Date.now();
        turnEndEvent = event;
        resolve({ phase: "ended", turnId: activeTurnId, events });
      }
    });
  });

  const promptPromise = session.prompt(prompt);
  const firstPhase = await watcher;
  if (waitForFirstDelta && firstPhase.phase === "first-delta") {
    await promptPromise;
  }

  while (turnEndEvent === undefined) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (Date.now() - startedAt > limit) {
      throw new Error("Timed out waiting for turn end after first delta");
    }
  }

  unsubscribe?.();
  return {
    turnId: activeTurnId,
    eventCount: events.length,
    firstEventMs: events[0]?.atMs,
    firstDeltaMs: firstDeltaAt === undefined ? undefined : firstDeltaAt - startedAt,
    turnStartedMs: turnStartedAt === undefined ? undefined : turnStartedAt - startedAt,
    endedMs: endedAt === undefined ? undefined : endedAt - startedAt,
    turnEnd: {
      type: turnEndEvent.type,
      reason: turnEndEvent.reason,
      turnId: turnEndEvent.turnId,
    },
    eventTypeCounts: countItems(events.map((event) => event.type)),
    eventTypePreview: events.slice(0, 20).map((event) => event.type),
  };
}

async function promptWithHandlerFlag(session, prompt, flag, options = {}) {
  const promptResult = await runPromptStream(session, prompt, {
    waitForFirstDelta: false,
    timeoutMs: options.timeoutMs ?? heavyTimeoutMs,
  });
  return {
    handlerInvoked: flag.value,
    prompt: promptResult,
  };
}

async function probeOfficialSdkRuntime() {
  const sdkEntry = path.join(officialRepo, "packages", "node-sdk", "dist", "index.mjs");
  if (!(await fileExists(sdkEntry))) {
    skip("official SDK runtime smoke", `built dist not found: ${sdkEntry}`);
    return;
  }

  let sdk;
  try {
    sdk = await import(`file://${sdkEntry.replaceAll("\\", "/")}`);
  } catch (error) {
    fail("official SDK import from built source", error);
    return;
  }
  pass("official SDK import from built source", { entry: sdkEntry });

  let harness;
  let session;
  try {
    const createHarness = sdk.createKimiHarness ?? ((options) => new sdk.KimiHarness(options));
    harness = createHarness({
      homeDir,
      identity: {
        userAgentProduct: "kimi-code-cli",
        version: process.env.KIMI_CODE_SMOKE_VERSION ?? "0.0.0-kimix-probe",
      },
      uiMode: "kimix-probe",
    });

    const config = await harness.getConfig();
    const model = process.env.KIMIX_PROBE_MODEL ?? config.defaultModel;
    if (!model) {
      throw new Error("No default model found in Kimi config.");
    }

    session = await harness.createSession({
      workDir,
      model,
      metadata: {
        source: "kimix-p0-probe",
        createdAt: nowIso(),
      },
    });

    const sessionDir = await locateSessionDir(session.id);
    const wirePath = sessionDir && path.join(sessionDir, "agents", "main", "wire.jsonl");
    pass("official SDK create session", {
      sessionId: session.id,
      workDir: session.workDir,
      model,
      sessionDir,
      wirePath,
      wireExists: wirePath ? await fileExists(wirePath) : false,
    });

    await session.close();
    session = await harness.resumeSession({ id: session.id });
    pass("official SDK resume session", {
      sessionId: session.id,
      workDir: session.workDir,
      resumeStateKeys: session.getResumeState() ? Object.keys(session.getResumeState()) : [],
    });

    const promptResult = await runPromptStream(
      session,
      process.env.KIMIX_PROBE_PROMPT ??
        "请用一句话回复：Kimix P0 SDK 探针在线。不要修改任何文件。",
    );
    pass("official SDK prompt streaming", promptResult);

    const sessionCountBeforeSteer = (await harness.listSessions({ workDir })).length;
    const streamPromise = runPromptStream(
      session,
      process.env.KIMIX_PROBE_LONG_PROMPT ??
        "请分三段简短说明桌面应用接入 SDK 事件流时要注意什么。",
      { waitForFirstDelta: true },
    );
    await new Promise((resolve) => setTimeout(resolve, 800));
    await session.steer(process.env.KIMIX_PROBE_STEER ?? "补充一句：steer 必须保留在同一个 session。");
    const steerPromptResult = await streamPromise;
    const sessionCountAfterSteer = (await harness.listSessions({ workDir })).length;
    pass("official SDK steer same session", {
      sessionId: session.id,
      sessionCountBeforeSteer,
      sessionCountAfterSteer,
      prompt: steerPromptResult,
    });

    let cancelEnd;
    const cancelStreamPromise = runPromptStream(
      session,
      process.env.KIMIX_PROBE_CANCEL_PROMPT ??
        "请持续输出一个较长的编号清单，用于验证 cancel 能否中断本轮。",
      { waitForFirstDelta: true },
    );
    await new Promise((resolve) => setTimeout(resolve, 800));
    await session.cancel();
    try {
      cancelEnd = await cancelStreamPromise;
    } catch (error) {
      cancelEnd = { error: summarizeError(error) };
    }
    pass("official SDK cancel", cancelEnd);

    const approvalFlag = { value: false };
    try {
      session.setApprovalHandler(async (request) => {
        approvalFlag.value = true;
        return { decision: "deny", feedback: "Kimix P0 probe denies mutations." };
      });
      await session.setPermission("manual");
      const approvalResult = await promptWithHandlerFlag(
        session,
        process.env.KIMIX_PROBE_APPROVAL_PROMPT ??
          "请尝试在当前工作目录创建一个名为 kimix-probe-approval.txt 的文件，内容为 P0 probe。若需要权限，请请求审批。",
        approvalFlag,
      );
      if (approvalResult.handlerInvoked) {
        pass("official SDK approval handler roundtrip", approvalResult);
      } else {
        fail("official SDK approval handler roundtrip", "approval handler was not invoked", approvalResult);
      }
    } catch (error) {
      fail("official SDK approval handler roundtrip", error);
    }

    const questionFlag = { value: false };
    try {
      session.setQuestionHandler(async (request) => {
        questionFlag.value = true;
        const fields = Array.isArray(request?.fields) ? request.fields : [];
        const answers = {};
        for (const field of fields) {
          if (field?.id) answers[field.id] = "Kimix P0 probe answer";
        }
        return Object.keys(answers).length > 0 ? answers : "Kimix P0 probe answer";
      });
      const questionResult = await promptWithHandlerFlag(
        session,
        process.env.KIMIX_PROBE_QUESTION_PROMPT ??
          "请必须通过需求澄清/提问能力向用户询问一个简短问题：Kimix P0 question handler 是否在线？不要只在正文里提问。",
        questionFlag,
      );
      if (questionResult.handlerInvoked) {
        pass("official SDK question handler roundtrip", questionResult);
      } else {
        fail("official SDK question handler roundtrip", "question handler was not invoked", questionResult);
      }
    } catch (error) {
      fail("official SDK question handler roundtrip", error);
    }
  } catch (error) {
    fail("official SDK runtime smoke", error);
  } finally {
    try {
      await session?.close?.();
    } catch {
      // Continue closing the harness.
    }
    try {
      await harness?.close?.();
    } catch {
      // The report already contains the primary result.
    }
  }
}

function markdownFence(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return `\`\`\`text\n${text.trimEnd()}\n\`\`\``;
}

function formatResult(result) {
  const icon = result.status === "pass" ? "通过" : result.status === "skip" ? "跳过" : "失败";
  const lines = [`### ${icon}：${result.name}`];
  if (result.reason) lines.push(`- 原因：${result.reason}`);
  if (result.error) lines.push(`- 错误：${result.error}`);
  if (result.detail && Object.keys(result.detail).length > 0) {
    lines.push("", markdownFence(result.detail));
  }
  return lines.join("\n");
}

function inferRecommendation() {
  const npmNewSdk = results.find((item) => item.name === "npm @moonshot-ai/kimi-code-sdk");
  const sourceBuild = results.find((item) => item.name === "official packages/node-sdk build");
  const runtime = results.find((item) => item.name === "official SDK prompt streaming");
  const oldWire = results.find((item) => item.name === "old ProtocolClient wire handshake");

  if (runtime?.status === "pass") {
    return [
      "下一步建议接官方 `packages/node-sdk` 的 `KimiHarness` / `Session` API，事件源使用 `Session.onEvent()`，并用 `session.id` 对齐 `~/.kimi-code/sessions/.../<sessionId>/agents/main/wire.jsonl`。",
      npmNewSdk?.status === "pass"
        ? "npm 上存在 `@moonshot-ai/kimi-code-sdk` 时可优先评估直接依赖 npm 包。"
        : "如果 npm 新包不可安装，短期使用官方源码 `packages/node-sdk` 的 file/vendor 接入；它比旧 `@moonshot-ai/kimi-agent-sdk` 更贴近目标 API。",
    ].join("\n");
  }

  if (sourceBuild?.status === "pass") {
    return "官方源码 SDK 能构建但运行探针未闭环；下一步先修 SDK runtime 初始化/认证/模型配置问题，再进入 P1。";
  }

  if (oldWire?.status === "pass") {
    return "新 SDK 暂不可用时，fallback 可短期走旧 `@moonshot-ai/kimi-agent-sdk` 的 `ProtocolClient`，但只作为过渡，不继续走 hidden TUI screen parser。";
  }

  return "SDK 与 ProtocolClient 都未闭环时，fallback 是继续用 `kimi -p --output-format stream-json` 做短期 prompt-mode，但不能把 hidden TUI 当正式主链路。";
}

async function writeReport() {
  const lines = [
    "# Kimi Code SDK / Wire P0 探针结果",
    "",
    `- 生成时间：${nowIso()}`,
    `- Kimix 仓库：${repoRoot}`,
    `- 官方源码：${officialRepo}`,
    `- 探针工作目录：${workDir}`,
    `- KIMI_CODE_HOME：${homeDir}`,
    "",
    "## 结论",
    "",
    inferRecommendation(),
    "",
    "## 结果明细",
    "",
    ...results.map(formatResult),
    "",
    "## 覆盖与缺口",
    "",
    "- 已覆盖：CLI 版本/help、`--wire` help/轻量启动、新旧 npm 包查询、旧 SDK 导出与 wire 握手、官方源码 SDK 构建、create session、prompt streaming、steer、cancel、handler 注册、sessionId 到 `wire.jsonl` 路径定位。",
    "- approval / question 的 handler 注册可以自动验证；真实 invocation 需要构造会触发审批/澄清的 prompt，避免 P0 探针默认改动用户文件。",
    "- 如果某项失败，以对应命令输出为准；不要凭推测进入正式 UI 改造。",
    "",
  ];

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${lines.join("\n")}\n`, "utf-8");
}

async function main() {
  await mkdir(workDir, { recursive: true });
  await writeFile(path.join(workDir, "README.md"), "Kimix P0 SDK probe work directory.\n", "utf-8");

  await recordCommand("git status --short", "git", ["status", "--short"]);
  await recordCommand("kimi --version", "kimi", ["--version"]);
  await recordCommand("kimi --help", "kimi", ["--help"]);
  await recordCommand("kimi --wire --help", "kimi", ["--wire", "--help"]);
  await probeWireRawLaunch();
  await recordCommand("pnpm view @moonshot-ai/kimi-code-sdk version", "pnpm", [
    "view",
    "@moonshot-ai/kimi-code-sdk",
    "version",
  ]);
  await recordCommand("pnpm view @moonshot-ai/kimi-agent-sdk version", "pnpm", [
    "view",
    "@moonshot-ai/kimi-agent-sdk",
    "version",
  ]);
  const agentSdk = await probeInstalledOldSdk();
  await probeOldProtocolClient(agentSdk);
  await probeOfficialSdkSource();

  if (skipHeavy) {
    skip("official SDK runtime smoke", "KIMIX_PROBE_SKIP_HEAVY=1");
  } else {
    await probeOfficialSdkRuntime();
  }

  if (!skipDocWrite) {
    await writeReport();
  }

  const summary = {
    reportPath,
    passed: results.filter((item) => item.status === "pass").length,
    failed: results.filter((item) => item.status === "fail").length,
    skipped: results.filter((item) => item.status === "skip").length,
    recommendation: inferRecommendation(),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

await main();
