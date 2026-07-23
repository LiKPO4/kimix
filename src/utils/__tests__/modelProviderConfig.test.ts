import { describe, expect, it } from "vitest";
import type { KimiModelConfigSummary } from "@electron/types/ipc";
import {
  chooseInitialModelProvider,
  defaultModelAliasForProvider,
  groupModelsByProvider,
} from "../modelProviderConfig";

const config: KimiModelConfigSummary = {
  configPath: "config.toml",
  exists: true,
  defaultModel: "openai/gpt-5.1",
  providers: [
    { name: "managed:kimi-code", type: "kimi", baseUrl: null, hasApiKey: true, hasEnv: false, hasOauth: true },
    { name: "openai", type: "openai", baseUrl: "https://api.openai.com/v1", hasApiKey: true, hasEnv: false, hasOauth: false },
  ],
  models: [
    { alias: "kimi-for-coding", provider: "managed:kimi-code", model: "kimi-for-coding", displayName: "Kimi", maxContextSize: 262144, adaptiveThinking: true, supportEfforts: null, defaultEffort: null, isDefault: false },
    { alias: "openai/gpt-5.1", provider: "openai", model: "gpt-5.1", displayName: "GPT-5.1", maxContextSize: 400000, adaptiveThinking: null, supportEfforts: null, defaultEffort: null, isDefault: true },
    { alias: "openai/gpt-4.1", provider: "openai", model: "gpt-4.1", displayName: "GPT-4.1", maxContextSize: 1000000, adaptiveThinking: null, supportEfforts: null, defaultEffort: null, isDefault: false },
  ],
};

describe("model provider config", () => {
  it("groups existing models under one provider without duplicating credentials", () => {
    const groups = groupModelsByProvider(config);
    expect(groups.map((group) => group.provider.name)).toEqual(["managed:kimi-code", "openai"]);
    expect(groups[1].models.map((model) => model.alias)).toEqual(["openai/gpt-5.1", "openai/gpt-4.1"]);
  });

  it("selects the provider used by the default model during migration", () => {
    expect(chooseInitialModelProvider(config)).toBe("openai");
    expect(chooseInitialModelProvider(config, "managed:kimi-code")).toBe("managed:kimi-code");
  });

  it("keeps orphaned legacy models visible instead of dropping them", () => {
    const groups = groupModelsByProvider({
      ...config,
      models: [...config.models, { alias: "legacy", provider: null, model: "legacy", displayName: null, maxContextSize: null, adaptiveThinking: null, supportEfforts: null, defaultEffort: null, isDefault: false }],
    });
    const unbound = groups.find((group) => group.provider.name === "__unbound__");
    expect(unbound?.models[0].alias).toBe("legacy");
  });

  it("derives a stable alias for newly added provider models", () => {
    expect(defaultModelAliasForProvider("moonshot", "kimi-k2")).toBe("moonshot/kimi-k2");
  });
});
