export type ThinkingEffortOption = {
  value: string;
  label: string;
  description: string;
};

const THINKING_EFFORT_META: Record<string, Omit<ThinkingEffortOption, "value">> = {
  off: { label: "关闭", description: "优先快速响应" },
  minimal: { label: "最低", description: "只做必要推理" },
  low: { label: "低", description: "轻量分析" },
  medium: { label: "中", description: "平衡速度与深度" },
  high: { label: "高", description: "深入分析" },
  max: { label: "最高", description: "使用最大推理强度" },
  on: { label: "开启", description: "使用模型默认强度" },
};

function normalizeEffort(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function optionFor(value: string): ThinkingEffortOption {
  const meta = THINKING_EFFORT_META[value];
  return {
    value,
    label: meta?.label ?? value,
    description: meta?.description ?? "使用模型声明的思考强度",
  };
}

export function buildThinkingEffortOptions(supportEfforts: readonly string[] | null | undefined) {
  const declared = Array.from(new Set((supportEfforts ?? []).map(normalizeEffort).filter(Boolean)));
  return (declared.length > 0 ? declared : ["off", "on"]).map(optionFor);
}

export function resolveThinkingEffort(
  requested: string | null | undefined,
  options: readonly ThinkingEffortOption[],
  defaultEffort?: string | null,
) {
  const values = new Set(options.map((option) => option.value));
  const normalizedRequested = normalizeEffort(requested);
  if (values.has(normalizedRequested)) return normalizedRequested;

  const normalizedDefault = normalizeEffort(defaultEffort);
  if (values.has(normalizedDefault)) return normalizedDefault;

  if (normalizedRequested === "on") {
    return options.find((option) => option.value !== "off")?.value ?? options[0]?.value ?? "on";
  }
  return options[0]?.value ?? "on";
}

export function thinkingEffortLabel(value: string | null | undefined) {
  const normalized = normalizeEffort(value) || "on";
  return optionFor(normalized).label;
}
