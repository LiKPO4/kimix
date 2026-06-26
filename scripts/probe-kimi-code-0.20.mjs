import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sdkEntry = process.env.KIMIX_KIMI_CODE_SDK_ENTRY ??
  path.join(repoRoot, "vendor", "kimi-code-sdk", "index.mjs");
const probeRoot = path.join(os.tmpdir(), "kimix-kimi-code-0.20-probe");
const workDir = path.join(probeRoot, "workspace");

async function createHarness() {
  const sdk = await import(pathToFileURL(sdkEntry).href);
  const options = {
    homeDir: process.env.KIMI_CODE_HOME,
    identity: {
      userAgentProduct: "kimi-code-cli",
      version: process.env.KIMI_CODE_SMOKE_VERSION ?? "0.20.0",
    },
    uiMode: "kimix-0.20-probe",
  };
  if (typeof sdk.createKimiHarness === "function") return sdk.createKimiHarness(options);
  return new sdk.KimiHarness(options);
}

function summarizeError(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function main() {
  await mkdir(workDir, { recursive: true });
  await writeFile(path.join(workDir, "README.md"), "Kimix 0.20 probe workspace.\n", "utf-8");

  const harness = await createHarness();
  let session;
  try {
    session = await harness.createSession({
      workDir,
      metadata: { source: "kimix-0.20-reload-probe" },
    });

    const reloadResult = await session.reloadSession({ forcePluginSessionStartReminder: true });
    const plugins = typeof session.listPlugins === "function" ? await session.listPlugins() : null;

    console.log(JSON.stringify({
      ok: true,
      sdkEntry,
      sessionId: session.id,
      workDir,
      reloadResult: reloadResult && typeof reloadResult === "object" ? {
        id: reloadResult.id,
        title: reloadResult.title,
        archived: reloadResult.archived,
        updatedAt: reloadResult.updatedAt,
        additionalDirCount: Array.isArray(reloadResult.additionalDirs) ? reloadResult.additionalDirs.length : null,
      } : reloadResult,
      pluginCount: Array.isArray(plugins) ? plugins.length : null,
      hasListPlugins: typeof session.listPlugins === "function",
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      ok: false,
      sdkEntry,
      workDir,
      error: summarizeError(error),
    }, null, 2));
    process.exitCode = 1;
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
