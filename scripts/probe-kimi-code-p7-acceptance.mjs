import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const officialRepo =
  process.env.KIMIX_KIMI_CODE_RESEARCH_REPO ??
  path.join(os.homedir(), "AppData", "Local", "Temp", "kimix-kimi-code-research");
const sdkEntry =
  process.env.KIMIX_KIMI_CODE_SDK_ENTRY ??
  path.join(officialRepo, "packages", "node-sdk", "dist", "index.mjs");
const probeRoot = path.join(os.tmpdir(), "kimix-kimi-code-p7-acceptance");
const workDir = path.join(probeRoot, "work");
const timeoutMs = Number(process.env.KIMIX_P7_PROBE_TIMEOUT_MS ?? 300_000);

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function countItems(items) {
  const counts = {};
  for (const item of items) counts[item] = (counts[item] ?? 0) + 1;
  return counts;
}

async function waitForTurn(session, action, options = {}) {
  const startedAt = Date.now();
  const ended = createDeferred();
  const events = [];
  let activeTurnId;
  let firstDeltaMs;
  const unsubscribe = session.onEvent((event) => {
    events.push({ type: event.type, turnId: event.turnId, reason: event.reason, atMs: Date.now() - startedAt });
    if (event.type === "turn.started" && activeTurnId === undefined) activeTurnId = event.turnId;
    if (firstDeltaMs === undefined && (event.type === "assistant.delta" || event.type === "thinking.delta")) {
      firstDeltaMs = Date.now() - startedAt;
      if (options.afterFirstDelta) void options.afterFirstDelta();
    }
    if (event.type === "error") ended.reject(new Error(`${event.code}: ${event.message}`));
    if (event.type === "turn.ended" && (activeTurnId === undefined || event.turnId === activeTurnId)) {
      ended.resolve(event);
    }
  });
  const timer = setTimeout(() => ended.reject(new Error(`Timed out waiting for turn.ended: ${options.label ?? "unnamed turn"}`)), options.timeoutMs ?? timeoutMs);
  try {
    await action();
    const endEvent = await ended.promise;
    return {
      turnId: activeTurnId,
      firstDeltaMs,
      endedMs: Date.now() - startedAt,
      reason: endEvent.reason,
      eventCount: events.length,
      eventTypeCounts: countItems(events.map((event) => event.type)),
    };
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}

async function main() {
  await mkdir(workDir, { recursive: true });
  await writeFile(path.join(workDir, "README.md"), "Kimix P7 acceptance probe directory.\n", "utf-8");

  const { KimiHarness } = await import(pathToFileURL(sdkEntry).href);
  const harness = new KimiHarness({
    homeDir: process.env.KIMI_CODE_HOME,
    identity: {
      userAgentProduct: "kimi-code-cli",
      version: process.env.KIMI_CODE_SMOKE_VERSION ?? "0.6.0",
    },
    uiMode: "kimix-p7-acceptance",
  });

  const checks = [];
  const fail = (name, detail) => checks.push({ name, ok: false, detail });
  const pass = (name, detail) => checks.push({ name, ok: true, detail });

  let session;
  try {
    const config = await harness.getConfig();
    const model = process.env.KIMIX_P7_PROBE_MODEL ?? config.defaultModel;
    if (!model) throw new Error("No default model configured.");

    session = await harness.createSession({
      workDir,
      model,
      metadata: { source: "kimix-p7-acceptance", createdAt: new Date().toISOString() },
    });
    const sessionId = session.id;

    const ordinaryTurns = [];
    for (let i = 1; i <= 10; i += 1) {
      console.error(`[kimix-p7-probe] ordinary turn ${i}/10`);
      ordinaryTurns.push(await waitForTurn(
        session,
        () => session.prompt(`Kimix P7 ordinary ${i}/10. Reply exactly: OK-${i}. Do not edit files.`),
        { label: `ordinary ${i}/10` },
      ));
      if (session.id !== sessionId) fail(`ordinary turn ${i} session`, { expected: sessionId, actual: session.id });
    }
    pass("10 ordinary prompts same session", {
      sessionId,
      turnReasons: ordinaryTurns.map((turn) => turn.reason),
      turnIds: ordinaryTurns.map((turn) => turn.turnId),
      firstDeltaMs: ordinaryTurns.map((turn) => turn.firstDeltaMs),
    });

    console.error("[kimix-p7-probe] steer");
    const steerTurn = await waitForTurn(session, async () => {
      const promptPromise = session.prompt("Kimix P7 steer acceptance. Reply briefly after receiving a steer message. Do not edit files.");
      await new Promise((resolve) => setTimeout(resolve, 900));
      await session.steer("Kimix P7 steer supplement: explicitly say steer keeps the same sessionId.");
      await promptPromise;
    }, { label: "steer" });
    pass("steer same session", { sessionId: session.id, turn: steerTurn });

    console.error("[kimix-p7-probe] cancel");
    const cancelTurn = await waitForTurn(session, async () => {
      const promptPromise = session.prompt("Kimix P7 cancel acceptance. Output a long numbered list until cancelled.");
      await new Promise((resolve) => setTimeout(resolve, 900));
      await session.cancel();
      await promptPromise.catch(() => {});
    }, { label: "cancel" });
    if (cancelTurn.reason === "cancelled") pass("cancel ends turn", cancelTurn);
    else fail("cancel ends turn", cancelTurn);

    console.error("[kimix-p7-probe] approval");
    let approvalInvoked = false;
    session.setApprovalHandler(async () => {
      approvalInvoked = true;
      return { decision: "deny", feedback: "Kimix P7 probe denies mutations." };
    });
    await session.setPermission("manual");
    const approvalTurn = await waitForTurn(session, () =>
      session.prompt("Kimix P7 approval acceptance. Try to create kimix-p7-approval.txt with content P7 probe. Request approval if needed."),
      { label: "approval", timeoutMs },
    );
    if (approvalInvoked) pass("approval handler roundtrip", approvalTurn);
    else fail("approval handler roundtrip", approvalTurn);

    console.error("[kimix-p7-probe] question");
    let questionInvoked = false;
    session.setQuestionHandler(async (request) => {
      questionInvoked = true;
      const fields = Array.isArray(request?.fields) ? request.fields : [];
      const answers = {};
      for (const field of fields) {
        if (field?.id) answers[field.id] = "Kimix P7 probe answer";
      }
      return Object.keys(answers).length > 0 ? answers : "Kimix P7 probe answer";
    });
    const questionTurn = await waitForTurn(session, () =>
      session.prompt("Kimix P7 question acceptance. You must use the ask-user/question tool to ask one short question confirming whether the Kimix P7 question handler is online. Do not only ask in normal prose."),
      { label: "question", timeoutMs },
    );
    if (questionInvoked) pass("question handler roundtrip", questionTurn);
    else fail("question handler roundtrip", questionTurn);

    const failed = checks.filter((check) => !check.ok);
    console.log(JSON.stringify({
      ok: failed.length === 0,
      sdkEntry,
      workDir,
      sessionId,
      model,
      checks,
    }, null, 2));
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    try {
      await session?.close?.();
    } finally {
      await harness.close();
    }
  }
}

await main();
