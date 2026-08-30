import type {
  KimiModelAliasSummary,
  KimiModelConfigSummary,
  KimiModelProviderSummary,
} from "@electron/types/ipc";

function mergeProvider(
  runtime: KimiModelProviderSummary | undefined,
  disk: KimiModelProviderSummary | undefined,
): KimiModelProviderSummary {
  const base = disk ?? runtime;
  if (!base) throw new Error("Provider summary is required");
  return {
    ...runtime,
    ...disk,
    name: base.name,
    type: disk?.type ?? runtime?.type ?? null,
    baseUrl: disk?.baseUrl ?? runtime?.baseUrl ?? null,
    hasApiKey: Boolean(runtime?.hasApiKey || disk?.hasApiKey),
    hasEnv: Boolean(runtime?.hasEnv || disk?.hasEnv),
    hasOauth: Boolean(runtime?.hasOauth || disk?.hasOauth),
  };
}

export function mergeRuntimeAndDiskModelConfig(
  runtime: KimiModelConfigSummary,
  disk: KimiModelConfigSummary,
): KimiModelConfigSummary {
  const diskProviderNames = new Set(disk.providers.map((provider) => provider.name));
  const runtimeProviders = new Map(runtime.providers.map((provider) => [provider.name, provider]));
  const isRuntimeManagedProvider = (providerName: string | null) => {
    if (!providerName) return false;
    const provider = runtimeProviders.get(providerName);
    return Boolean(provider && (provider.name.startsWith("managed:") || provider.type !== "openai" || provider.hasOauth));
  };
  const providers = new Map<string, KimiModelProviderSummary>();
  for (const provider of runtime.providers) {
    if (diskProviderNames.has(provider.name) || provider.name.startsWith("managed:") || provider.type !== "openai" || provider.hasOauth) {
      providers.set(provider.name, mergeProvider(provider, undefined));
    }
  }
  for (const provider of disk.providers) providers.set(provider.name, mergeProvider(providers.get(provider.name), provider));

  const models = new Map<string, KimiModelAliasSummary>();
  for (const model of runtime.models) {
    if (isRuntimeManagedProvider(model.provider)) models.set(model.alias, model);
  }
  // config.toml is the durable source for user mutations. It must override an
  // SDK reload that may still expose its pre-write in-memory snapshot.
  for (const model of disk.models) models.set(model.alias, model);

  const defaultModel = disk.defaultModel ?? runtime.defaultModel;
  return {
    configPath: disk.configPath || runtime.configPath,
    exists: disk.exists || runtime.exists,
    defaultModel,
    providers: [...providers.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    // 保持插入顺序（runtime 受管模型按 SDK 配置顺序在前，磁盘模型按 config.toml 书写顺序在后），
    // 设置页模型列表按「从老到新」展示，切换默认模型不再改变列表位置。
    models: [...models.values()]
      .map((model) => ({ ...model, isDefault: model.alias === defaultModel })),
    secondaryModel: disk.secondaryModel ?? runtime.secondaryModel ?? null,
  };
}
