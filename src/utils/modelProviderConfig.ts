import type { KimiModelConfigSummary, KimiModelProviderSummary } from "@electron/types/ipc";
import { inferModelContextSize } from "./modelContextInference";

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

// ---- 官方 Provider 目录（models.dev）模型条目匹配与预填 ----

export type CatalogModelLike = {
  id: string;
  maxContextSize?: number | null;
  supportEfforts?: string[];
};

/** 大小写不敏感精确匹配目录模型条目；不命中不猜（不做模糊匹配）。 */
export function matchCatalogModel(
  catalog: readonly CatalogModelLike[],
  modelId: string,
): CatalogModelLike | undefined {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) return undefined;
  return catalog.find((model) => model.id.trim().toLowerCase() === normalized);
}

export type CatalogPrefillMode = "select" | "type";

export type CatalogPrefill = {
  /** null 表示保留表单当前值 */
  maxContextSize: number | null;
  /** null 表示保留表单当前值 */
  supportEfforts: string[] | null;
};

/**
 * 按目录命中条目计算「添加模型」表单的预填值。
 * - Context 优先级：探测接口 contextLength > 目录 maxContextSize > 模型名推断；
 *   select（探测下拉选中）全部缺失时保留现值；type（手输模型 ID）沿用「为空才填」，仅当当前为空时填。
 * - 思考档位：目录条目带非空 supportEfforts 且当前未勾选任何档位时填入，其余情况不动；
 *   已手改的档位不被覆盖。
 * - defaultEffort 不在此处预填（留空由 SDK 自动取中间档）。
 */
export function prefillFromCatalog(params: {
  mode: CatalogPrefillMode;
  modelId: string;
  currentContextSize: string;
  currentSupportEfforts: string[];
  catalogModel?: CatalogModelLike | null;
  probeContextLength?: number | null;
}): CatalogPrefill {
  const { mode, modelId, currentContextSize, currentSupportEfforts, catalogModel, probeContextLength } = params;
  const contextEmpty = !currentContextSize.trim();
  const probe =
    typeof probeContextLength === "number" && probeContextLength >= 1_000 && probeContextLength <= 10_000_000
      ? probeContextLength
      : null;
  const catalogLimit =
    catalogModel &&
    typeof catalogModel.maxContextSize === "number" &&
    catalogModel.maxContextSize >= 1_000 &&
    catalogModel.maxContextSize <= 10_000_000
      ? catalogModel.maxContextSize
      : null;

  let maxContextSize: number | null = null;
  if ((mode === "select" || contextEmpty) && modelId.trim()) {
    maxContextSize = probe ?? catalogLimit ?? inferModelContextSize(modelId);
  }

  const supportEfforts =
    currentSupportEfforts.length === 0 &&
    catalogModel?.supportEfforts != null &&
    catalogModel.supportEfforts.length > 0
      ? catalogModel.supportEfforts
      : null;

  return { maxContextSize, supportEfforts };
}
