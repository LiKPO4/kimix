import type { KimiModelConfigSummary, KimiModelProviderSummary } from "@electron/types/ipc";

export type ModelProviderGroup = {
  provider: KimiModelProviderSummary;
  models: KimiModelConfigSummary["models"];
  managed: boolean;
};

export function isManagedModelProvider(provider: Pick<KimiModelProviderSummary, "type" | "hasOauth">) {
  return provider.type !== "openai" || provider.hasOauth;
}

export function groupModelsByProvider(config: KimiModelConfigSummary): ModelProviderGroup[] {
  const modelsByProvider = new Map<string, KimiModelConfigSummary["models"]>();
  for (const model of config.models) {
    const providerName = model.provider ?? "__unbound__";
    const models = modelsByProvider.get(providerName) ?? [];
    models.push(model);
    modelsByProvider.set(providerName, models);
  }

  const groups = config.providers.map((provider) => ({
    provider,
    models: modelsByProvider.get(provider.name) ?? [],
    managed: isManagedModelProvider(provider),
  }));

  const unboundModels = modelsByProvider.get("__unbound__") ?? [];
  if (unboundModels.length > 0) {
    groups.push({
      provider: {
        name: "__unbound__",
        type: null,
        baseUrl: null,
        hasApiKey: false,
        hasEnv: false,
        hasOauth: false,
      },
      models: unboundModels,
      managed: true,
    });
  }

  return groups.sort((left, right) => {
    if (left.managed !== right.managed) return left.managed ? -1 : 1;
    return left.provider.name.localeCompare(right.provider.name, "zh-CN");
  });
}

export function chooseInitialModelProvider(config: KimiModelConfigSummary, preferredProvider?: string | null) {
  const groups = groupModelsByProvider(config);
  if (preferredProvider && groups.some((group) => group.provider.name === preferredProvider)) return preferredProvider;
  const defaultProvider = config.models.find((model) => model.alias === config.defaultModel)?.provider;
  if (defaultProvider && groups.some((group) => group.provider.name === defaultProvider)) return defaultProvider;
  return groups.find((group) => !group.managed)?.provider.name ?? groups[0]?.provider.name ?? "";
}

export function defaultModelAliasForProvider(providerName: string, modelId: string) {
  const normalizedProvider = providerName.trim();
  const normalizedModel = modelId.trim();
  if (!normalizedProvider) return normalizedModel;
  if (!normalizedModel) return `${normalizedProvider}/`;
  return `${normalizedProvider}/${normalizedModel}`;
}
