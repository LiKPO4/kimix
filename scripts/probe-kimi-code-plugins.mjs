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
const probeRoot = path.join(os.tmpdir(), "kimix-kimi-code-plugins-probe");
const workDir = path.join(probeRoot, "work");

async function main() {
  await mkdir(workDir, { recursive: true });
  const { KimiHarness } = await import(pathToFileURL(sdkEntry).href);
  const harness = new KimiHarness({
    homeDir: process.env.KIMI_CODE_HOME,
    identity: {
      userAgentProduct: "kimi-code-cli",
      version: process.env.KIMI_CODE_SMOKE_VERSION ?? "0.6.0",
    },
    uiMode: "kimix-plugins-probe",
  });

  try {
    const session = await harness.createSession({
      workDir,
      metadata: { source: "kimix-plugins-probe" },
    });
    const plugins = await session.listPlugins();
    await session.close();
    console.log(JSON.stringify({
      ok: true,
      sdkEntry,
      workDir,
      sessionId: session.id,
      count: plugins.length,
      plugins: plugins.map((plugin) => ({
        id: plugin.id,
        displayName: plugin.displayName,
        enabled: plugin.enabled,
        state: plugin.state,
        source: plugin.source,
        skillCount: plugin.skillCount,
        mcpServerCount: plugin.mcpServerCount,
        enabledMcpServerCount: plugin.enabledMcpServerCount,
        hasErrors: plugin.hasErrors,
      })),
    }, null, 2));
  } finally {
    await harness.close();
  }
}

await main();
