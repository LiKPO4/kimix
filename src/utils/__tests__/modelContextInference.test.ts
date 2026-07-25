import { describe, it, expect } from "vitest";
import { inferModelContextSize } from "../modelContextInference";

describe("inferModelContextSize (grounded in official provider docs for latest & previous gen models)", () => {
  it("uses explicit API context length when provided and valid", () => {
    expect(inferModelContextSize("custom-model", 200_000)).toBe(200_000);
    expect(inferModelContextSize("some-model", 32_768)).toBe(32_768);
  });

  it("parses explicit capacity tokens in model names", () => {
    expect(inferModelContextSize("deepseek/deepseek-v4-pro-1000k")).toBe(1_000_000);
    expect(inferModelContextSize("qwen-1m")).toBe(1_000_000);
    expect(inferModelContextSize("my-model-128k")).toBe(128_000);
    expect(inferModelContextSize("model-64k")).toBe(64_000);
    expect(inferModelContextSize("model-32k")).toBe(32_000);
    expect(inferModelContextSize("model-200k")).toBe(200_000);
  });

  it("infers official context size for Google Gemini models (2M Pro / 1M Flash)", () => {
    expect(inferModelContextSize("gemini-1.5-pro")).toBe(2_097_152);
    expect(inferModelContextSize("gemini-2.0-pro-exp")).toBe(2_097_152);
    expect(inferModelContextSize("gemini-1.5-flash")).toBe(1_048_576);
    expect(inferModelContextSize("gemini-2.0-flash-exp")).toBe(1_048_576);
  });

  it("infers official context size for Anthropic Claude models (200,000)", () => {
    expect(inferModelContextSize("claude-3-7-sonnet")).toBe(200_000);
    expect(inferModelContextSize("claude-3-5-sonnet-20241022")).toBe(200_000);
    expect(inferModelContextSize("claude-3-5-haiku")).toBe(200_000);
    expect(inferModelContextSize("claude-3-haiku")).toBe(200_000);
  });

  it("infers official context size for DeepSeek models (1M V4 / 128k V3 & R1)", () => {
    expect(inferModelContextSize("deepseek-v4-flash")).toBe(1_000_000);
    expect(inferModelContextSize("deepseek-chat")).toBe(128_000);
    expect(inferModelContextSize("deepseek-v3")).toBe(128_000);
    expect(inferModelContextSize("deepseek-r1")).toBe(128_000);
  });

  it("infers official context size for OpenAI GPT and O-series models", () => {
    expect(inferModelContextSize("gpt-4.5-preview")).toBe(128_000);
    expect(inferModelContextSize("gpt-4o")).toBe(128_000);
    expect(inferModelContextSize("gpt-4o-mini")).toBe(128_000);
    expect(inferModelContextSize("o1")).toBe(200_000);
    expect(inferModelContextSize("o1-mini")).toBe(200_000);
    expect(inferModelContextSize("o3-mini")).toBe(200_000);
    expect(inferModelContextSize("gpt-3.5-turbo")).toBe(16_385);
  });

  it("infers official context size for xAI Grok models (1M Grok 3 / 128k Grok 2)", () => {
    expect(inferModelContextSize("grok-3")).toBe(1_000_000);
    expect(inferModelContextSize("grok-2-1212")).toBe(131_072);
  });

  it("infers official context size for Qwen and Llama models", () => {
    expect(inferModelContextSize("qwen-2.5-72b-instruct")).toBe(131_072);
    expect(inferModelContextSize("qwq-32b")).toBe(131_072);
    expect(inferModelContextSize("qwen-long")).toBe(10_000_000);
    expect(inferModelContextSize("llama-3.3-70b-instruct")).toBe(131_072);
    expect(inferModelContextSize("llama-3.1-405b")).toBe(131_072);
    expect(inferModelContextSize("llama-3-70b")).toBe(8_192);
  });

  it("infers official context size for Baidu ERNIE, Cohere, MiniMax, and Yi", () => {
    expect(inferModelContextSize("ernie-4.0-turbo-128k")).toBe(128_000);
    expect(inferModelContextSize("ernie-4.0-pro")).toBe(8_192);
    expect(inferModelContextSize("command-r-plus")).toBe(128_000);
    expect(inferModelContextSize("minimax-abab6.5")).toBe(245_760);
    expect(inferModelContextSize("yi-lightning")).toBe(128_000);
  });

  it("falls back to 128,000 for unknown model IDs without API context length", () => {
    expect(inferModelContextSize("unknown-custom-llm")).toBe(128_000);
  });
});
