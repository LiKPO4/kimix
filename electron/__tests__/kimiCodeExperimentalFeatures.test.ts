import { describe, expect, it } from "vitest";
import { toServerConfigPatch } from "../kimiCodeServerClient";
import { DEFAULT_SETTINGS } from "../settingsService";
import {
  buildExperimentalFeatureConfigPatch,
  experimentalFeatureRequiresRestart,
  KimiCodeExperimentalFeatureSchema,
} from "../kimiCodeExperimentalFeatures";

describe("Kimi Code 实验功能", () => {
  it("子 Agent 上下文 fork 默认关闭", () => {
    expect(DEFAULT_SETTINGS.experimentalKimiSubagentFork).toBe(false);
    expect(DEFAULT_SETTINGS.experimentalKimiTower).toBe(false);
  });

  it("只接受受支持的官方 feature id", () => {
    expect(KimiCodeExperimentalFeatureSchema.parse({ id: "tool-select", enabled: true }))
      .toEqual({ id: "tool-select", enabled: true });
    expect(KimiCodeExperimentalFeatureSchema.parse({ id: "subagent_fork", enabled: false }))
      .toEqual({ id: "subagent_fork", enabled: false });
    expect(KimiCodeExperimentalFeatureSchema.parse({ id: "tower", enabled: true }))
      .toEqual({ id: "tower", enabled: true });
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

  it("Tower 写入官方配置键且必须重启后组装", () => {
    expect(buildExperimentalFeatureConfigPatch("tower", true)).toEqual({
      experimental: { tower: true },
    });
    expect(experimentalFeatureRequiresRestart("tower")).toBe(true);
    expect(experimentalFeatureRequiresRestart("subagent_fork")).toBe(false);
  });
});
