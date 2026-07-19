import { describe, expect, it } from "vitest";
import { setTomlSectionValuePreservingLayout } from "../tomlSectionEditor";

describe("setTomlSectionValuePreservingLayout", () => {
  it("updates a provider in place without moving it behind nested tables", () => {
    const raw = [
      "[providers.openai]",
      'type = "openai"',
      'base_url = "https://old.example/v1"',
      'custom_header = "preserve-me"',
      "",
      "[providers.openai.env]",
      'api_key = "OPENAI_API_KEY"',
      "",
      "[models.gpt]",
      'provider = "openai"',
      "",
    ].join("\n");

    const next = setTomlSectionValuePreservingLayout(raw, "providers.openai", "base_url", '"https://new.example/v1"');

    expect(next).toContain('base_url = "https://new.example/v1"');
    expect(next).toContain('custom_header = "preserve-me"');
    expect(next.indexOf("[providers.openai]")).toBeLessThan(next.indexOf("[providers.openai.env]"));
    expect(next.indexOf("[providers.openai.env]")).toBeLessThan(next.indexOf("[models.gpt]"));
  });

  it("adds a missing field before a provider nested table", () => {
    const raw = [
      "[providers.openai]",
      'type = "openai"',
      "",
      "[providers.openai.oauth]",
      'client_id = "existing"',
      "",
    ].join("\n");

    const next = setTomlSectionValuePreservingLayout(raw, "providers.openai", "base_url", '"https://api.example/v1"');

    expect(next.indexOf('base_url = "https://api.example/v1"')).toBeLessThan(next.indexOf("[providers.openai.oauth]"));
    expect(next).toContain('client_id = "existing"');
  });

  it("appends a missing section without rewriting existing content", () => {
    const raw = 'default_model = "kimi-for-coding"\n';
    const next = setTomlSectionValuePreservingLayout(raw, "providers.openai", "type", '"openai"');

    expect(next).toBe([
      'default_model = "kimi-for-coding"',
      "",
      "[providers.openai]",
      'type = "openai"',
      "",
    ].join("\n"));
  });
});
