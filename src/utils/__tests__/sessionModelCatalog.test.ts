import { describe, expect, it } from "vitest";
import { buildSessionModelOptions, groupSessionModelOptions } from "../sessionModelCatalog";

describe("session model catalog", () => {
  it("uses configured aliases and groups models by provider", () => {
    const options = buildSessionModelOptions({
      configPath: "config.toml",
      exists: true,
      defaultModel: "kimi-code/kimi-for-coding",
      providers: [],
      models: [
        { alias: "opencode/minimax-m3", provider: "opencode", model: "minimax-m3", displayName: null, maxContextSize: 1_000_000, adaptiveThinking: null, isDefault: false },
        { alias: "kimi-code/kimi-for-coding", provider: "managed:kimi-code", model: "kimi-for-coding", displayName: "K2.7 Code", maxContextSize: 262_144, adaptiveThinking: true, isDefault: true },
      ],
    }, null);

    expect(options.map((option) => option.id)).toContain("opencode/minimax-m3");
    expect(options.find((option) => option.id === "opencode/minimax-m3")?.label).toBe("minimax-m3");
    expect(options.find((option) => option.id === "kimi-code/kimi-for-coding")?.providerLabel).toBe("Kimi Code");
    expect(groupSessionModelOptions(options)).toHaveLength(2);
  });

  it("uses the server catalog only to enrich configured aliases", () => {
    const options = buildSessionModelOptions({
      configPath: "config.toml",
      exists: true,
      defaultModel: null,
      providers: [],
      models: [
        { alias: "deepseek/v4", provider: "deepseek", model: "v4", displayName: "deepseek/DeepSeek V4", maxContextSize: null, adaptiveThinking: null, isDefault: false },
      ],
    }, {
      auth: { ready: true, providerCount: 1, defaultModel: null, managedProvider: null },
      config: {},
      models: [
        { provider: "deepseek", model: "v4", displayName: "duplicate", maxContextSize: 100, capabilities: ["thinking"], supportEfforts: ["low", "high"], defaultEffort: "high" },
        { provider: "deepseek", model: "flash", displayName: "Flash", maxContextSize: 200, capabilities: [], supportEfforts: [] },
      ],
      providers: [],
    });

    expect(options).toHaveLength(1);
    expect(options.find((option) => option.id === "deepseek/v4")?.label).toBe("DeepSeek V4");
    expect(options.find((option) => option.id === "deepseek/v4")).toMatchObject({
      supportEfforts: ["low", "high"],
      defaultEffort: "high",
    });
    expect(options.map((option) => option.id)).not.toContain("deepseek/flash");
  });
});
