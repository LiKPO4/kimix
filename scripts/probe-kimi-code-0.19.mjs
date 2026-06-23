import { mkdir, writeFile } from "node:fs/promises";
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
    console.log(JSON.stringify({
      ok,
      sdkEntry,
      sessionId: session.id,
      workDir: primaryWorkDir,
      initialAdditionalDir,
      runtimeAdditionalDir,
      createdAdditionalDirs,
      addResult,
      resumedAdditionalDirs,
    }, null, 2));
    if (!ok) process.exitCode = 1;
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
