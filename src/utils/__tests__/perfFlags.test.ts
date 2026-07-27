import { afterEach, describe, expect, it } from "vitest";
import { shouldUsePlainStreamingMarkdown, STREAMING_PLAIN_MARKDOWN_KEY, STREAMING_RICH_MARKDOWN_KEY } from "../perfFlags";

afterEach(() => {
  localStorage.removeItem(STREAMING_PLAIN_MARKDOWN_KEY);
  localStorage.removeItem(STREAMING_RICH_MARKDOWN_KEY);
});

describe("shouldUsePlainStreamingMarkdown", () => {
  it("defaults to the rich streaming path", () => {
    expect(shouldUsePlainStreamingMarkdown()).toBe(false);
  });

  it("honors an explicit plain opt-in", () => {
    localStorage.setItem(STREAMING_PLAIN_MARKDOWN_KEY, "1");
    expect(shouldUsePlainStreamingMarkdown()).toBe(true);
  });

  it("falls back to plain when rich is explicitly disabled", () => {
    localStorage.setItem(STREAMING_RICH_MARKDOWN_KEY, "0");
    expect(shouldUsePlainStreamingMarkdown()).toBe(true);
  });

  it("rich opt-out wins over an unset plain flag", () => {
    localStorage.setItem(STREAMING_RICH_MARKDOWN_KEY, "0");
    localStorage.setItem(STREAMING_PLAIN_MARKDOWN_KEY, "0");
    expect(shouldUsePlainStreamingMarkdown()).toBe(true);
  });
});
