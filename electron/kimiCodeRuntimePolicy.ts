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

function normalizeModel(model: string | null | undefined): string | undefined {
  return model?.trim() || undefined;
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
