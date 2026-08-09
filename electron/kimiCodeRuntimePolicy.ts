export type RuntimeModelPolicyInput = {
  isResume: boolean;
  requestedModel?: string | null;
  resumedModel?: string | null;
  defaultModel?: string | null;
};

export type RuntimeModelPolicy = {
  effectiveModel?: string;
  modelToApply?: string;
};

export type RuntimeThinkingEffortPolicyInput = {
  requestedEffort?: string | null;
  supportEfforts?: readonly string[] | null;
  defaultEffort?: string | null;
  providerType?: string | null;
};

export type RuntimeThinkingEffortPolicy = {
  effort?: string;
  changed: boolean;
  reason: "empty" | "provider-normalized" | "declared" | "default" | "first-supported" | "undeclared";
};

function normalizeModel(model: string | null | undefined): string | undefined {
  return model?.trim() || undefined;
}

function normalizeEffort(effort: string | null | undefined): string | undefined {
  return effort?.trim().toLowerCase() || undefined;
}

function normalizeEffortForProvider(effort: string | undefined, providerType: string | null | undefined) {
  if (!effort) return undefined;
  const type = providerType?.trim().toLowerCase();
  // Kimi's strongest tier is `max`; OpenAI-compatible protocols use `xhigh`.
  // Passing `max` through reasoning_effort is rejected by standard OpenAI providers.
  return (type === "openai" || type === "openai_responses") && effort === "max" ? "xhigh" : effort;
}

/**
 * Normalize and validate a requested effort at the runtime boundary.
 * Empty declarations mean capability is unknown, so only protocol-level
 * normalization is applied; a non-empty declaration additionally gates stale
 * renderer/global selections through default_effort and then the first tier.
 */
export function resolveRuntimeThinkingEffort(input: RuntimeThinkingEffortPolicyInput): RuntimeThinkingEffortPolicy {
  const requestedRaw = normalizeEffort(input.requestedEffort);
  if (!requestedRaw) return { effort: undefined, changed: false, reason: "empty" };

  const requested = normalizeEffortForProvider(requestedRaw, input.providerType);
  const declared = Array.from(new Set((input.supportEfforts ?? [])
    .map((effort) => normalizeEffortForProvider(normalizeEffort(effort), input.providerType))
    .filter((effort): effort is string => Boolean(effort))));
  const normalizedDefault = normalizeEffortForProvider(normalizeEffort(input.defaultEffort), input.providerType);
  const providerChanged = requested !== requestedRaw;

  // `on` delegates to the runtime/model default. Non-Kimi `off` is also a
  // protocol sentinel: the SDK maps it through off_effort or omits the field.
  const providerType = input.providerType?.trim().toLowerCase();
  if (requested === "on" || (requested === "off" && providerType !== "kimi")) {
    return { effort: requested, changed: providerChanged, reason: providerChanged ? "provider-normalized" : "declared" };
  }

  if (declared.length === 0) {
    return { effort: requested, changed: providerChanged, reason: providerChanged ? "provider-normalized" : "undeclared" };
  }
  if (requested && declared.includes(requested)) {
    return { effort: requested, changed: providerChanged, reason: providerChanged ? "provider-normalized" : "declared" };
  }
  if (normalizedDefault && declared.includes(normalizedDefault)) {
    return { effort: normalizedDefault, changed: normalizedDefault !== requestedRaw, reason: "default" };
  }
  return { effort: declared[0], changed: declared[0] !== requestedRaw, reason: "first-supported" };
}

/**
 * Global defaults belong to newly-created sessions only. An existing official
 * session keeps its server profile unless the caller explicitly requests a
 * model switch.
 */
export function resolveRuntimeModelPolicy(input: RuntimeModelPolicyInput): RuntimeModelPolicy {
  const requestedModel = normalizeModel(input.requestedModel);
  const resumedModel = normalizeModel(input.resumedModel);
  const defaultModel = normalizeModel(input.defaultModel);

  if (!input.isResume) {
    return {
      effectiveModel: requestedModel ?? defaultModel,
      modelToApply: undefined,
    };
  }

  return {
    effectiveModel: requestedModel ?? resumedModel,
    modelToApply: requestedModel && requestedModel !== resumedModel ? requestedModel : undefined,
  };
}
