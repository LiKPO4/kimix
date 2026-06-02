import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const officialRepo =
  process.env.KIMIX_KIMI_CODE_RESEARCH_REPO ??
  path.join(os.homedir(), "AppData", "Local", "Temp", "kimix-kimi-code-research");
const sdkEntry =
  process.env.KIMIX_KIMI_CODE_SDK_ENTRY ??
  path.join(officialRepo, "packages", "node-sdk", "dist", "index.mjs");

async function main() {
  const { KimiHarness } = await import(pathToFileURL(sdkEntry).href);
  const harness = new KimiHarness({
    homeDir: process.env.KIMI_CODE_HOME,
    identity: {
      userAgentProduct: "kimi-code-cli",
      version: process.env.KIMI_CODE_SMOKE_VERSION ?? "0.6.0",
    },
    uiMode: "kimix-model-config-probe",
  });

  try {
    const config = await harness.getConfig({ reload: true });
    const providers = Object.entries(config.providers ?? {});
    const models = Object.entries(config.models ?? {});
    console.log(JSON.stringify({
      ok: true,
      sdkEntry,
      defaultProvider: config.defaultProvider ?? null,
      defaultModel: config.defaultModel ?? null,
      providerCount: providers.length,
      modelCount: models.length,
      providers: providers.map(([name, provider]) => ({
        name,
        type: provider.type ?? null,
        baseUrl: provider.baseUrl ?? null,
        defaultModel: provider.defaultModel ?? null,
        hasApiKey: Boolean(provider.apiKey),
        hasOauth: Boolean(provider.oauth),
      })),
      models: models.map(([alias, model]) => ({
        alias,
        provider: model.provider ?? null,
        model: model.model ?? null,
        displayName: model.displayName ?? null,
        maxContextSize: model.maxContextSize ?? null,
        isDefault: alias === config.defaultModel,
      })),
    }, null, 2));
  } finally {
    await harness.close();
  }
}

await main();
