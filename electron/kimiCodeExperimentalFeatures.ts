import { z } from "zod";

export const KIMI_CODE_EXPERIMENTAL_FEATURE_IDS = [
  "tool-select",
  "subagent_fork",
] as const;

export type KimiCodeExperimentalFeatureId = typeof KIMI_CODE_EXPERIMENTAL_FEATURE_IDS[number];

export const KimiCodeExperimentalFeatureSchema = z.object({
  id: z.enum(KIMI_CODE_EXPERIMENTAL_FEATURE_IDS),
  enabled: z.boolean(),
});

export function buildExperimentalFeatureConfigPatch(id: KimiCodeExperimentalFeatureId, enabled: boolean) {
  return { experimental: { [id]: enabled } };
}
