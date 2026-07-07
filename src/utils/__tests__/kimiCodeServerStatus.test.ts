import { describe, expect, it } from "vitest";
import { missingOpenAiModelOutputLimitPatch, normalizeSdkSessionStatus, serverStatusToAgentEvent } from "../../../electron/kimiCodeHost";

describe("Kimi Server session status adapter", () => {
  it("maps SDK 0.12 thinking effort onto the stable Kimix status field", () => {
    expect(normalizeSdkSessionStatus({
      model: "kimi-code/kimi-for-coding",
      thinkingEffort: "high",
      permission: "auto",
      planMode: false,
    }, "idle")).toMatchObject({
      engineStatus: "idle",
      thinkingLevel: "high",
      thinkingEffort: "high",
    });
  });

  it("adds a conservative output limit lazily for an OpenAI-compatible alias", () => {
    expect(missingOpenAiModelOutputLimitPatch({
      providers: { gateway: { type: "openai" } },
      models: { "gateway/deepseek": { provider: "gateway", model: "deepseek", maxContextSize: 1_000_000 } },
    }, "gateway/deepseek")).toEqual({
      models: {
        "gateway/deepseek": {
          overrides: { maxOutputSize: 65536 },
        },
      },
    });
  });

  it("keeps managed and already bounded models unchanged", () => {
    expect(missingOpenAiModelOutputLimitPatch({
      providers: { kimi: { type: "kimi" }, gateway: { type: "openai" } },
      models: {
        kimi: { provider: "kimi", model: "kimi-for-coding", maxContextSize: 262144 },
        bounded: { provider: "gateway", model: "bounded", maxContextSize: 100000, maxOutputSize: 8192 },
      },
    }, "kimi")).toBeNull();
    expect(missingOpenAiModelOutputLimitPatch({
      providers: { gateway: { type: "openai" } },
      models: { bounded: { provider: "gateway", model: "bounded", maxOutputSize: 8192 } },
    }, "bounded")).toBeNull();
    expect(missingOpenAiModelOutputLimitPatch({
      providers: { gateway: { type: "openai" } },
      models: { bounded: { provider: "gateway", model: "bounded", overrides: { maxOutputSize: 16384 } } },
    }, "bounded")).toBeNull();
  });

  it("maps official context and swarm fields to the existing SDK status event", () => {
    expect(serverStatusToAgentEvent({
      status: "idle",
      model: "kimi-code/kimi-for-coding",
      thinking_level: "high",
      permission: "manual",
      plan_mode: true,
      swarm_mode: true,
      context_tokens: 64000,
      max_context_tokens: 256000,
      context_usage: 0.25,
    })).toEqual({
      type: "agent.status.updated",
      model: "kimi-code/kimi-for-coding",
      thinkingLevel: "high",
      permission: "manual",
      planMode: true,
      swarmMode: true,
      contextTokens: 64000,
      maxContextTokens: 256000,
      contextUsage: 0.25,
    });
  });
});
