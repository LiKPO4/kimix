// Regenerate the vendored, self-contained official Kimi Code SDK bundle.
//
// Why this exists: `@moonshot-ai/kimi-code-sdk` (the official Node SDK / KimiHarness)
// is NOT published to npm and is marked `private` in the official repo. Its built
// `dist/index.mjs` is also NOT self-contained — it still bare-imports zod, ajv,
// google-auth-library, @modelcontextprotocol/sdk, etc. from node_modules. So we
// cannot just copy `dist/` into the repo: it would crash on any machine without the
// research repo's node_modules (CI, packaged app, a fresh checkout).
//
// This script re-bundles that built `dist/index.mjs` into ONE self-contained file
// (`vendor/kimi-code-sdk/index.mjs`) with every JS dependency inlined, so the new
// main engine no longer depends on a %TEMP% research directory at runtime.
//
// Usage:
//   KIMIX_KIMI_CODE_RESEARCH_REPO=/path/to/kimi-code  node scripts/vendor-kimi-code-sdk.mjs
// (defaults to %LOCALAPPDATA%/Temp/kimix-kimi-code-research on Windows)
//
// After running, re-validate with the self-containment + createSession smoke that
// scripts/probe-kimi-code-sdk.mjs performs, then commit the regenerated bundle and
// update vendor/kimi-code-sdk/README.md with the new source commit / versions.

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";

const repoRoot = path.resolve(import.meta.dirname, "..");
const researchRepo =
  process.env.KIMIX_KIMI_CODE_RESEARCH_REPO ??
  path.join(os.homedir(), "AppData", "Local", "Temp", "kimix-kimi-code-research");

const entry = path.join(researchRepo, "packages", "node-sdk", "dist", "index.mjs");
const outFile = path.join(repoRoot, "vendor", "kimi-code-sdk", "index.mjs");

// Optional native addons that consuming libraries (ws, linkedom/@mozilla/readability)
// already guard with try/catch — never bundle native .node addons.
const externalOptionalNatives = ["bufferutil", "utf-8-validate", "canvas"];
const upstreamMcpTimeout = "DEFAULT_STARTUP_TIMEOUT_MS = 3e4;";
const kimixMcpTimeout =
  'DEFAULT_STARTUP_TIMEOUT_MS = Math.max(1, Number.parseInt(process.env.KIMIX_KIMI_CODE_MCP_STARTUP_TIMEOUT_MS ?? "4000", 10) || 4e3);';

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function tryGitHead() {
  try {
    return execFileSync("git", ["-C", researchRepo, "log", "-1", "--pretty=format:%H %ci %s"], {
      encoding: "utf-8",
    }).trim();
  } catch {
    return "unknown";
  }
}

async function main() {
  if (!(await fileExists(entry))) {
    throw new Error(
      `Built SDK entry not found: ${entry}\n` +
        "Build the research repo first: pnpm install && pnpm --filter @moonshot-ai/kimi-code-sdk build\n" +
        "(the tsdown bundle step is enough; the failing build:dts step only affects .d.ts).",
    );
  }

  await mkdir(path.dirname(outFile), { recursive: true });

  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: outFile,
    external: externalOptionalNatives,
    // The bundle inlines CJS deps whose code calls require() dynamically (fs, etc.).
    // ESM output has no require, so inject a createRequire shim.
    banner: {
      js: "import { createRequire as __kimixCreateRequire } from 'node:module'; const require = __kimixCreateRequire(import.meta.url);",
    },
    logLevel: "error",
  });

  // A failed optional MCP must not hold the first model request for the
  // upstream 30-second default. Explicit per-server startupTimeoutMs values
  // still win; this only narrows the fallback used by unconfigured servers.
  const bundled = await readFile(outFile, "utf8");
  if (!bundled.includes(upstreamMcpTimeout)) {
    throw new Error("Upstream MCP startup-timeout marker changed; review the Kimix vendor patch before publishing.");
  }
  await writeFile(outFile, bundled.replace(upstreamMcpTimeout, kimixMcpTimeout), "utf8");

  const size = (await stat(outFile)).size;
  console.log(JSON.stringify({
    outFile,
    bytes: size,
    sourceRepo: researchRepo,
    sourceHead: tryGitHead(),
    externalOptionalNatives,
  }, null, 2));
}

await main();
