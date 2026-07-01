import type { KimiCodeServerModelCatalog, KimiModelConfigSummary } from "../../electron/types/ipc";
import { compactModelDisplayName } from "@/utils/modelDisplay";

export type SessionModelOption = {
  id: string;
  label: string;
  provider: string;
  providerLabel: string;
  maxContextSize: number | null;
};

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
