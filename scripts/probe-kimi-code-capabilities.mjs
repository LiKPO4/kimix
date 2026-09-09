/**
 * 官方内置能力（capability：kimi-cu / kimi-webbridge）只读探针。
 *
 * 直接用 vendor SDK 创建 v2 harness，调用 listCapabilities / getCapability，
 * 验证 vendored bundle 的能力面可用性。默认只读，不触发安装；
 * 需要验证安装链路时显式传 --install <id>（会下载托管运行时，慎用）。
 *
 * 用法：node scripts/probe-kimi-code-capabilities.mjs [--install kimi-cu]
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sdkEntry =
  process.env.KIMIX_KIMI_CODE_SDK_ENTRY ??
  path.join(repoRoot, "vendor", "kimi-code-sdk", "index.mjs");

const installId = (() => {
  const index = process.argv.indexOf("--install");
  return index >= 0 ? process.argv[index + 1] : undefined;
})();

async function main() {
  const sdk = await import(pathToFileURL(sdkEntry).href);
  // 官方 0.42.0 起删除 createKimiHarnessV2 导出，createKimiHarness 即 v2 引擎；≤0.41 bundle 优先取 V2 导出。
  const v2Factory = sdk.createKimiHarnessV2 ?? sdk.createKimiHarness;
  if (typeof v2Factory !== "function") {
    throw new Error("SDK bundle 未导出 v2 引擎创建函数，capability 面不可用。");
  }
  const harness = v2Factory({
    homeDir: process.env.KIMI_CODE_HOME,
    identity: {
      productName: "Kimix",
      version: process.env.KIMI_CODE_SMOKE_VERSION ?? "0.6.0",
      platform: "kimi_code_desktop",
    },
    uiMode: "kimix-capability-probe",
  });

  try {
    if (typeof harness.listCapabilities !== "function") {
      throw new Error("harness 无 listCapabilities 方法（bundle 过旧？）。");
    }
    const capabilities = await harness.listCapabilities();
    console.log(JSON.stringify({ ok: true, sdkEntry, capabilities }, null, 2));

    if (installId) {
      console.log(`安装 ${installId} ...`);
      const status = await harness.installCapability(installId);
      console.log(JSON.stringify({ ok: true, installed: status }, null, 2));
    }
  } finally {
    await harness.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
