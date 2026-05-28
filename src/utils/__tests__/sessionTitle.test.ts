import { describe, it, expect } from "vitest";
import { deriveSessionTitle, truncateSessionTitle } from "../sessionTitle";
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

describe("deriveSessionTitle", () => {
  it("returns fallback when no events", () => {
    expect(deriveSessionTitle([], "默认")).toBe("默认");
  });

  it("returns fallback when no assistant messages", () => {
    const events: TimelineEvent[] = [
      { id: "1", type: "user_message", timestamp: 1, content: "Hi" },
    ];
    expect(deriveSessionTitle(events)).toBe("新会话");
  });

  it("derives title from first assistant message", () => {
    const events: TimelineEvent[] = [
      { id: "1", type: "user_message", timestamp: 1, content: "Hi" },
      { id: "2", type: "assistant_message", timestamp: 2, content: "Hello there", isThinking: false, isComplete: true },
    ];
    expect(deriveSessionTitle(events)).toBe("Hello there");
  });

  it("ignores assistant messages shorter than 4 chars", () => {
    const events: TimelineEvent[] = [
      { id: "1", type: "assistant_message", timestamp: 1, content: "Ok", isThinking: false, isComplete: true },
    ];
    expect(deriveSessionTitle(events)).toBe("新会话");
  });

  it("uses fallback param when provided", () => {
    expect(deriveSessionTitle([], "Custom Fallback")).toBe("Custom Fallback");
  });
});
