import { mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const officialRepo =
  process.env.KIMIX_KIMI_CODE_RESEARCH_REPO ??
  path.join(os.homedir(), "AppData", "Local", "Temp", "kimix-kimi-code-research");
const sdkEntry =
  process.env.KIMIX_KIMI_CODE_SDK_ENTRY ??
  path.join(officialRepo, "packages", "node-sdk", "dist", "index.mjs");
const probeRoot = path.join(os.tmpdir(), "kimix-kimi-code-export-probe");
const workDir = path.join(probeRoot, "work");
const outputPath = path.join(probeRoot, `kimix-sdk-export-${Date.now()}.zip`);

async function main() {
  await mkdir(workDir, { recursive: true });
  const sdk = await import(pathToFileURL(sdkEntry).href);
  const options = {
    homeDir: process.env.KIMI_CODE_HOME,
    identity: {
      userAgentProduct: "kimi-code-cli",
      version: process.env.KIMI_CODE_SMOKE_VERSION ?? "0.6.0",
    },
    uiMode: "kimix-export-probe",
  };
  const harness = typeof sdk.createKimiHarness === "function"
    ? sdk.createKimiHarness(options)
    : new sdk.KimiHarness(options);

  try {
    const session = await harness.createSession({
      workDir,
      metadata: { source: "kimix-export-probe" },
    });
    const result = await harness.exportSession({
      id: session.id,
      outputPath,
      includeGlobalLog: false,
      version: process.env.KIMI_CODE_SMOKE_VERSION ?? "0.6.0",
      installSource: "kimix-export-probe",
    });
    const zipStats = await stat(result.zipPath);
    await session.close();
    console.log(JSON.stringify({
      ok: true,
      sdkEntry,
      workDir,
      sessionId: session.id,
      outputPath: result.zipPath,
      size: zipStats.size,
      entries: result.entries.length,
      sessionDir: result.sessionDir,
      manifestSessionId: result.manifest?.sessionId,
    }, null, 2));
  } finally {
    await harness.close();
  }
}

await main();
