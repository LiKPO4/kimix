import { describe, it, expect } from "vitest";
import { inferModelContextSize } from "../modelContextInference";

describe("inferModelContextSize", () => {
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

  it("infers context size for Gemini models", () => {
    expect(inferModelContextSize("gemini-1.5-pro")).toBe(1_048_576);
    expect(inferModelContextSize("gemini-2.0-flash-exp")).toBe(1_048_576);
  });

  it("infers context size for Claude models", () => {
    expect(inferModelContextSize("claude-3-5-sonnet-20241022")).toBe(200_000);
    expect(inferModelContextSize("claude-3-7-sonnet")).toBe(200_000);
  });

  it("infers context size for DeepSeek and Qwen models", () => {
    expect(inferModelContextSize("deepseek-chat")).toBe(128_000);
    expect(inferModelContextSize("deepseek-v3")).toBe(128_000);
    expect(inferModelContextSize("deepseek-r1")).toBe(128_000);
    expect(inferModelContextSize("qwen-2.5-coder-7b-instruct")).toBe(128_000);
  });

  it("infers context size for OpenAI GPT and O-series models", () => {
    expect(inferModelContextSize("gpt-4o")).toBe(128_000);
    expect(inferModelContextSize("o1-mini")).toBe(128_000);
    expect(inferModelContextSize("o3-mini")).toBe(128_000);
    expect(inferModelContextSize("gpt-3.5-turbo")).toBe(16_385);
  });

  it("falls back to 128,000 for unknown model IDs without API context length", () => {
    expect(inferModelContextSize("unknown-custom-llm")).toBe(128_000);
  });
});
