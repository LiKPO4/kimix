import type { KimiCodeServerModelCatalog, KimiModelConfigSummary } from "../../electron/types/ipc";
import { compactModelDisplayName } from "@/utils/modelDisplay";

export type SessionModelOption = {
  id: string;
  label: string;
  provider: string;
  providerLabel: string;
  maxContextSize: number | null;
  supportEfforts: string[];
  defaultEffort: string | null;
};

export type ModelContextLimitIndex = ReadonlyMap<string, number>;

function normalizeModelLookupKey(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function addContextLimit(
  index: Map<string, number>,
  key: string | null | undefined,
  limit: number | null | undefined,
  overwrite = false,
) {
  const normalizedKey = normalizeModelLookupKey(key);
  if (!normalizedKey || typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return;
  if (overwrite || !index.has(normalizedKey)) index.set(normalizedKey, limit);
}

export function buildModelContextLimitIndex(
  config: KimiModelConfigSummary | null,
  serverCatalog: KimiCodeServerModelCatalog | null,
): ModelContextLimitIndex {
  const index = new Map<string, number>();
  for (const model of config?.models ?? []) {
    addContextLimit(index, model.alias, model.maxContextSize);
    addContextLimit(index, model.model, model.maxContextSize);
    addContextLimit(index, model.displayName, model.maxContextSize);
  }
  // The running Server catalog contains effective values after model
  // overrides, so it wins when persisted configuration and runtime disagree.
  for (const model of serverCatalog?.models ?? []) {
    const provider = model.provider.trim();
    const rawModel = model.model.trim();
    const qualifiedModel = rawModel.includes("/") || !provider ? rawModel : `${provider}/${rawModel}`;
    addContextLimit(index, qualifiedModel, model.maxContextSize, true);
    addContextLimit(index, rawModel, model.maxContextSize, true);
    addContextLimit(index, model.displayName, model.maxContextSize, true);
  }
  return index;
}

export function resolveModelContextLimit(
  index: ModelContextLimitIndex,
  candidates: Array<string | null | undefined>,
): number | undefined {
  for (const candidate of candidates) {
    const normalized = normalizeModelLookupKey(candidate);
    if (!normalized) continue;
    const exact = index.get(normalized);
    if (exact !== undefined) return exact;
    const compact = normalized.split("/").at(-1);
    if (compact) {
      const byCompactName = index.get(compact);
      if (byCompactName !== undefined) return byCompactName;
    }
  }
  return undefined;
}

function providerLabel(provider: string) {
  if (provider === "managed:kimi-code" || provider === "kimi-code") return "Kimi Code";
  return provider.replace(/^managed:/, "") || "其他";
}

export function buildSessionModelOptions(
  config: KimiModelConfigSummary | null,
  serverCatalog: KimiCodeServerModelCatalog | null,
): SessionModelOption[] {
  const options = new Map<string, SessionModelOption>();
  const catalogById = new Map((serverCatalog?.models ?? []).map((model) => {
    const provider = model.provider.trim() || "其他";
    const rawModel = model.model.trim();
    const id = rawModel.includes("/") ? rawModel : `${provider}/${rawModel}`;
    return [id, model] as const;
  }));
  for (const model of config?.models ?? []) {
    const id = model.alias.trim();
    if (!id) continue;
    const provider = model.provider?.trim() || id.split("/")[0] || "其他";
    const catalogModel = catalogById.get(id);
    options.set(id, {
      id,
      label: compactModelDisplayName(model.displayName?.trim() || catalogModel?.displayName?.trim() || id),
      provider,
      providerLabel: providerLabel(provider),
      maxContextSize: model.maxContextSize ?? catalogModel?.maxContextSize ?? null,
      supportEfforts: catalogModel?.supportEfforts?.length ? catalogModel.supportEfforts : (model.supportEfforts ?? []),
      defaultEffort: catalogModel?.defaultEffort ?? model.defaultEffort ?? null,
    });
  }
  return Array.from(options.values()).sort((a, b) => (
    a.providerLabel.localeCompare(b.providerLabel, "zh-CN") || a.label.localeCompare(b.label, "zh-CN")
  ));
}

export function groupSessionModelOptions(options: SessionModelOption[]) {
  const groups = new Map<string, { provider: string; label: string; models: SessionModelOption[] }>();
  for (const option of options) {
    const existing = groups.get(option.provider);
    if (existing) {
      existing.models.push(option);
    } else {
      groups.set(option.provider, { provider: option.provider, label: option.providerLabel, models: [option] });
    }
  }
  return Array.from(groups.values());
}
