import { z } from "zod";

export const KIMI_CODE_EXPERIMENTAL_FEATURE_IDS = [
  "tool-select",
  "subagent_fork",
  "tower",
] as const;

export type KimiCodeExperimentalFeatureId = typeof KIMI_CODE_EXPERIMENTAL_FEATURE_IDS[number];

export const KimiCodeExperimentalFeatureSchema = z.object({
  id: z.enum(KIMI_CODE_EXPERIMENTAL_FEATURE_IDS),
  enabled: z.boolean(),
});

export function buildExperimentalFeatureConfigPatch(id: KimiCodeExperimentalFeatureId, enabled: boolean) {
  return { experimental: { [id]: enabled } };
}

export function experimentalFeatureRequiresRestart(id: KimiCodeExperimentalFeatureId): boolean {
  // Tower 的工具和 agent profile 在 App scope 组装；官方要求重启进程后才会注册。
  return id === "tower";
}
