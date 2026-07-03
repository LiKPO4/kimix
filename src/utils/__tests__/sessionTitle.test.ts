import { describe, it, expect } from "vitest";
import { deriveSessionTitle, isDefaultSessionTitle, truncateSessionTitle } from "../sessionTitle";
import type { TimelineEvent } from "@/types/ui";

describe("truncateSessionTitle", () => {
  it("returns short text unchanged", () => {
    expect(truncateSessionTitle("Hello world")).toBe("Hello world");
  });

  it("truncates long text with ellipsis", () => {
    const long = "a".repeat(50);
    expect(truncateSessionTitle(long)).toBe("a".repeat(30) + "...");
  });

  it("strips markdown code blocks on a single line", () => {
    expect(truncateSessionTitle("```const x = 1;``` Hello")).toBe("Hello");
  });

  it("strips inline code backticks", () => {
    expect(truncateSessionTitle("Use `foo()` bar")).toBe("Use foo() bar");
  });

  it("strips images and links", () => {
    expect(truncateSessionTitle("See [link](url) and ![img](src)")).toBe("See and");
  });

  it("strips heading markers", () => {
    expect(truncateSessionTitle("## Heading")).toBe("Heading");
  });

  it("picks first meaningful line", () => {
    expect(truncateSessionTitle("\n\n  \nReal content here")).toBe("Real content here");
  });
});

describe("isDefaultSessionTitle", () => {
  it("recognizes English and Chinese placeholder titles", () => {
    expect(isDefaultSessionTitle("New Session")).toBe(true);
    expect(isDefaultSessionTitle("新会话")).toBe(true);
    expect(isDefaultSessionTitle("介绍一下你有什么功能")).toBe(false);
  });
});

describe("deriveSessionTitle", () => {
  it("returns fallback when no events", () => {
    expect(deriveSessionTitle([], "默认")).toBe("默认");
  });

  it("derives title from first user message", () => {
    const events: TimelineEvent[] = [
      { id: "1", type: "user_message", timestamp: 1, content: "Scan recent changes and summarize risks" },
    ];
    expect(deriveSessionTitle(events)).toBe("Scan recent changes and summar...");
  });

  it("prefers first user message over assistant greeting", () => {
    const events: TimelineEvent[] = [
      { id: "1", type: "user_message", timestamp: 1, content: "Review drawing board layout" },
      { id: "2", type: "assistant_message", timestamp: 2, content: "Hello there", isThinking: false, isComplete: true },
    ];
    expect(deriveSessionTitle(events)).toBe("Review drawing board layout");
  });

  it("falls back to assistant message when user content is not meaningful", () => {
    const events: TimelineEvent[] = [
      { id: "1", type: "user_message", timestamp: 1, content: "Hi" },
      { id: "2", type: "assistant_message", timestamp: 2, content: "Hello there", isThinking: false, isComplete: true },
    ];
    expect(deriveSessionTitle(events)).toBe("Hello there");
  });

  it("uses fallback param when provided", () => {
    expect(deriveSessionTitle([], "Custom Fallback")).toBe("Custom Fallback");
  });
});
