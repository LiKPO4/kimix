import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const officialRepo =
  process.env.KIMIX_KIMI_CODE_RESEARCH_REPO ??
  path.join(os.homedir(), "AppData", "Local", "Temp", "kimix-kimi-code-research");
const sdkEntry =
  process.env.KIMIX_KIMI_CODE_SDK_ENTRY ??
  path.join(repoRoot, "vendor", "kimi-code-sdk", "index.mjs");
const probeRoot = path.join(os.tmpdir(), "kimix-kimi-code-host-probe");
const workDir = path.join(probeRoot, "work");
const timeoutMs = Number(process.env.KIMIX_HOST_PROBE_TIMEOUT_MS ?? 180_000);

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitForTurn(session, action) {
  const startedAt = Date.now();
  const ended = createDeferred();
  let activeTurnId;
  let firstDeltaMs;
  const eventTypeCounts = {};
  const unsubscribe = session.onEvent((event) => {
    eventTypeCounts[event.type] = (eventTypeCounts[event.type] ?? 0) + 1;
    if (event.type === "turn.started" && activeTurnId === undefined) {
      activeTurnId = event.turnId;
    }
    if (
      firstDeltaMs === undefined &&
      (event.type === "assistant.delta" || event.type === "thinking.delta")
    ) {
      firstDeltaMs = Date.now() - startedAt;
    }
    if (event.type === "error") {
      ended.reject(new Error(`${event.code}: ${event.message}`));
    }
    if (event.type === "turn.ended" && (activeTurnId === undefined || event.turnId === activeTurnId)) {
      ended.resolve(event);
    }
  });
  const timer = setTimeout(() => ended.reject(new Error("Timed out waiting for turn.ended")), timeoutMs);
  try {
    await action();
    const endEvent = await ended.promise;
    return {
      turnId: activeTurnId,
      firstDeltaMs,
      endedMs: Date.now() - startedAt,
      reason: endEvent.reason,
      eventTypeCounts,
    };
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}

async function main() {
  await mkdir(workDir, { recursive: true });
  await writeFile(path.join(workDir, "README.md"), "Kimix KimiCodeHost probe directory.\n", "utf-8");

  const sdk = await import(pathToFileURL(sdkEntry).href);
  const options = {
    homeDir: process.env.KIMI_CODE_HOME,
    identity: {
      userAgentProduct: "kimi-code-cli",
      version: process.env.KIMI_CODE_SMOKE_VERSION ?? "0.6.0",
    },
    uiMode: "kimix-host-probe",
  };
  const harness = typeof sdk.createKimiHarness === "function"
    ? sdk.createKimiHarness(options)
    : new sdk.KimiHarness(options);

  try {
    const config = await harness.getConfig();
    const model = process.env.KIMIX_HOST_PROBE_MODEL ?? config.defaultModel;
    if (!model) throw new Error("No default model configured.");

    const session = await harness.createSession({
      workDir,
      model,
      metadata: { source: "kimix-host-probe" },
    });

    const prompt = await waitForTurn(session, () =>
      session.prompt("请用一句话回复：Kimix KimiCodeHost P1 探针在线。不要修改文件。"),
    );

    const steering = waitForTurn(session, () =>
      session.prompt("请分三条简短说明 KimiCodeHost 为什么适合桌面 UI。"),
    );
    await new Promise((resolve) => setTimeout(resolve, 800));
    await session.steer("补充一句：steer 必须保持同一个官方 sessionId。");
    const steer = await steering;

    const canceling = waitForTurn(session, () =>
      session.prompt("请持续输出一个长清单，用于验证 cancel。"),
    );
    await new Promise((resolve) => setTimeout(resolve, 800));
    await session.cancel();
    const cancel = await canceling;

    const sessions = await harness.listSessions({ workDir });
    await session.close();

    console.log(JSON.stringify({
      ok: true,
      sdkEntry,
      workDir,
      sessionId: session.id,
      sessionCountForWorkDir: sessions.length,
      prompt,
      steer,
      cancel,
    }, null, 2));
  } finally {
    await harness.close();
  }
}

await main();
