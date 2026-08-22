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

  const sortModelsByAlias = (models: KimiModelConfigSummary["models"]) =>
    [...models].sort((left, right) => left.alias.localeCompare(right.alias, "zh-CN"));

  const groups = config.providers.map((provider) => ({
    provider,
    models: sortModelsByAlias(modelsByProvider.get(provider.name) ?? []),
    managed: isManagedModelProvider(provider),
  }));

  const unboundModels = sortModelsByAlias(modelsByProvider.get("__unbound__") ?? []);
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

export function buildModelMetadataAiQuestion(input: {
  providerName: string;
  baseUrl?: string | null;
  modelId: string;
  modelAlias?: string | null;
  missingFields?: readonly ("context" | "efforts")[];
  matchResult?: string | null;
  currentContextSize?: string | null;
  currentSupportEfforts?: readonly string[] | null;
  currentDefaultEffort?: string | null;
}): string {
  const baseUrl = (() => {
    const value = input.baseUrl?.trim();
    if (!value) return "未提供";
    try {
      const url = new URL(value);
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return value.split(/[?#]/, 1)[0] || "未提供";
    }
  })();
  const missing = input.missingFields ?? ["context", "efforts"];
  const questions = [
    ...(missing.includes("context")
      ? ["- 该供应商实际开放的最大上下文窗口是多少 token？请区分模型原生上限和供应商路由上限。"]
      : []),
    ...(missing.includes("efforts")
      ? ["- 该线路实际接受并生效的 reasoning_effort 精确值有哪些（off/minimal/low/medium/high/xhigh/max）？默认值是什么？"]
      : []),
  ];
  return [
    "请帮我核实下面这个具体供应商线路的模型元数据。不要只根据模型名称、通用 OpenAI 参数枚举或 HTTP 2xx 猜测；优先查供应商和模型官方文档，并附可访问的来源链接。无法可靠确认的字段请明确写“未知”。",
    "",
    `供应商：${input.providerName.trim() || "未知"}`,
    `Base URL：${baseUrl}`,
    `模型名称/ID：${input.modelId.trim() || "未知"}`,
    `Kimix 模型别名：${input.modelAlias?.trim() || "未提供"}`,
    `Kimix 目录匹配结果：${input.matchResult?.trim() || "未提供"}`,
    `当前 Context：${input.currentContextSize?.trim() || "未设置"}`,
    `当前思考档位：${input.currentSupportEfforts?.length ? input.currentSupportEfforts.join(", ") : "未设置"}`,
    `当前默认档：${input.currentDefaultEffort?.trim() || "未设置"}`,
    "",
    "请确认：",
    ...questions,
    "",
    "最后请给出一段可直接填入 Kimix 的结果：Context=<整数或未知>；reasoning_effort=<逗号分隔的精确值或未知>；default_effort=<精确值或未知>。",
  ].join("\n");
}

// ---- 官方 Provider 目录（models.dev）模型条目匹配与预填 ----

export type CatalogModelLike = {
  id: string;
  maxContextSize?: number | null;
  supportEfforts?: string[];
};

export type CatalogProviderLike<TModel extends CatalogModelLike = CatalogModelLike> = {
  providerId: string;
  baseUrl?: string | null;
  models: TModel[];
};

function normalizeCatalogProviderUrl(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  try {
    const url = new URL(value.trim());
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.href.toLowerCase();
  } catch {
    return value.trim().replace(/\/+$/, "").toLowerCase();
  }
}

/** 先按 provider id，再按规范化 Base URL 唯一匹配，避免同名模型跨供应商串档。 */
export function matchCatalogProvider<TModel extends CatalogModelLike>(
  catalog: readonly CatalogProviderLike<TModel>[],
  providerName: string,
  baseUrl?: string | null,
): CatalogProviderLike<TModel> | undefined {
  const normalizedName = providerName.trim().toLowerCase();
  const byId = normalizedName
    ? catalog.find((provider) => provider.providerId.trim().toLowerCase() === normalizedName)
    : undefined;
  if (byId) return byId;
  const normalizedUrl = normalizeCatalogProviderUrl(baseUrl);
  if (!normalizedUrl) return undefined;
  const byUrl = catalog.filter((provider) => normalizeCatalogProviderUrl(provider.baseUrl) === normalizedUrl);
  return byUrl.length === 1 ? byUrl[0] : undefined;
}

/**
 * 目录模型条目匹配：先大小写不敏感精确匹配；不中时回退「剥离 catalog id 的 provider
 * 前缀后裸 id 精确匹配」（models.dev 部分条目带前缀如 openai/gpt-5.1，探测接口返回裸
 * id 如 gpt-5.1）。前缀回退仅在唯一命中时采用，避免多个 provider 同裸 id 时误取。
 */
export function matchCatalogModel(
  catalog: readonly CatalogModelLike[],
  modelId: string,
): CatalogModelLike | undefined {
  const normalized = modelId.trim().toLowerCase();
  if (!normalized) return undefined;
  const exact = catalog.find((model) => model.id.trim().toLowerCase() === normalized);
  if (exact) return exact;
  const bareMatches = catalog.filter((model) => {
    const id = model.id.trim().toLowerCase();
    const slash = id.indexOf("/");
    return slash > 0 && id.slice(slash + 1) === normalized;
  });
  return bareMatches.length === 1 ? bareMatches[0] : undefined;
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
 * - 思考档位：select（探测下拉选中）视为新意图，目录带档位时覆盖、无档位时清空（与
 *   Context 对称，避免「Context 跟新模型、档位留旧模型」的不对称，含目录未声明档位时
 *   不残留上一模型的档位）；type（手输）仅在当前未勾选任何档位时填入，已手改不被覆盖。
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

  const catalogEfforts =
    catalogModel?.supportEfforts != null && catalogModel.supportEfforts.length > 0
      ? catalogModel.supportEfforts
      : null;
  const supportEfforts = mode === "select"
    ? (catalogEfforts ?? [])
    : (catalogEfforts && currentSupportEfforts.length === 0 ? catalogEfforts : null);

  return { maxContextSize, supportEfforts };
}
