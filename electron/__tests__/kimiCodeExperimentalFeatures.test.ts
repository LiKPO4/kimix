import { describe, expect, it } from "vitest";
import { toServerConfigPatch } from "../kimiCodeServerClient";
import { DEFAULT_SETTINGS } from "../settingsService";
import {
  buildExperimentalFeatureConfigPatch,
  KimiCodeExperimentalFeatureSchema,
} from "../kimiCodeExperimentalFeatures";

describe("Kimi Code 实验功能", () => {
  it("子 Agent 上下文 fork 默认关闭", () => {
    expect(DEFAULT_SETTINGS.experimentalKimiSubagentFork).toBe(false);
  });

  it("只接受受支持的官方 feature id", () => {
    expect(KimiCodeExperimentalFeatureSchema.parse({ id: "tool-select", enabled: true }))
      .toEqual({ id: "tool-select", enabled: true });
    expect(KimiCodeExperimentalFeatureSchema.parse({ id: "subagent_fork", enabled: false }))
      .toEqual({ id: "subagent_fork", enabled: false });
    expect(KimiCodeExperimentalFeatureSchema.safeParse({ id: "arbitrary-feature", enabled: true }).success)
      .toBe(false);
  });

  it("以官方 subagent_fork 配置键写入 experimental 段", () => {
    const enabled = buildExperimentalFeatureConfigPatch("subagent_fork", true);
    expect(enabled).toEqual({
      experimental: { subagent_fork: true },
    });
    expect(toServerConfigPatch(enabled)).toEqual({
      experimental: { subagent_fork: true },
    });
    expect(buildExperimentalFeatureConfigPatch("subagent_fork", false)).toEqual({
      experimental: { subagent_fork: false },
    });
  });
});
