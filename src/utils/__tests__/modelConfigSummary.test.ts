import { describe, expect, it } from "vitest";
import type { KimiModelConfigSummary } from "@electron/types/ipc";
import { mergeRuntimeAndDiskModelConfig } from "../modelConfigSummary";

function summary(overrides: Partial<KimiModelConfigSummary> = {}): KimiModelConfigSummary {
  return {
    configPath: "C:/Users/test/.kimi-code/config.toml",
    exists: true,
    defaultModel: "opencode-go/mimo-v2.5",
    providers: [{
      name: "opencode-go",
      type: "openai",
      baseUrl: "https://example.test/v1",
      hasApiKey: true,
      hasEnv: false,
      hasOauth: false,
    }],
    models: [],
    ...overrides,
  };
}

describe("mergeRuntimeAndDiskModelConfig", () => {
  it("保留已落盘但 SDK reload 旧快照尚未返回的新模型", () => {
    const oldRuntime = summary({
      models: [{
        alias: "opencode-go/mimo-v2.5",
        provider: "opencode-go",
        model: "mimo-v2.5",
        displayName: "opencode-go/mimo-v2.5",
        maxContextSize: 1_000_000,
        adaptiveThinking: null,
        isDefault: true,
      }],
    });
    const disk = summary({
      models: [
        ...oldRuntime.models,
        {
          alias: "opencode-go/qwen3.7-plus",
          provider: "opencode-go",
          model: "qwen3.7-plus",
          displayName: "opencode-go/qwen3.7-plus",
          maxContextSize: 1_000_000,
          adaptiveThinking: null,
          isDefault: false,
        },
      ],
    });

    const merged = mergeRuntimeAndDiskModelConfig(oldRuntime, disk);

    expect(merged.models.map((model) => model.alias)).toEqual([
      "opencode-go/mimo-v2.5",
      "opencode-go/qwen3.7-plus",
    ]);
  });

  it("保留 SDK 注入但未写入 config.toml 的受管模型和凭据能力", () => {
    const runtime = summary({
      providers: [{
        name: "managed:kimi-code",
        type: "kimi",
        baseUrl: null,
        hasApiKey: false,
        hasEnv: false,
        hasOauth: true,
      }],
      models: [{
        alias: "kimi-code/kimi-for-coding",
        provider: "managed:kimi-code",
        model: "kimi-for-coding",
        displayName: "Kimi for Coding",
        maxContextSize: 262_144,
        adaptiveThinking: null,
        isDefault: false,
      }],
    });

    const merged = mergeRuntimeAndDiskModelConfig(runtime, summary());

    expect(merged.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "managed:kimi-code", hasOauth: true }),
      expect.objectContaining({ name: "opencode-go", hasApiKey: true }),
    ]));
    expect(merged.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ alias: "kimi-code/kimi-for-coding" }),
    ]));
  });

  it("不会用 SDK 旧快照复活已从磁盘删除的外部模型", () => {
    const modelA = {
      alias: "opencode-go/mimo-v2.5",
      provider: "opencode-go",
      model: "mimo-v2.5",
      displayName: "opencode-go/mimo-v2.5",
      maxContextSize: 1_000_000,
      adaptiveThinking: null,
      isDefault: true,
    };
    const staleDeletedModel = {
      ...modelA,
      alias: "opencode-go/deleted",
      model: "deleted",
      displayName: "opencode-go/deleted",
      isDefault: false,
    };

    const merged = mergeRuntimeAndDiskModelConfig(
      summary({ models: [modelA, staleDeletedModel] }),
      summary({ models: [modelA] }),
    );

    expect(merged.models.map((model) => model.alias)).toEqual([modelA.alias]);
  });
});
