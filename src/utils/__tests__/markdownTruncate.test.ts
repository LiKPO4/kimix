import { describe, expect, it } from "vitest";
import { truncateMarkdownForPreview } from "@/utils/markdownTruncate";

describe("truncateMarkdownForPreview", () => {
  it("returns the original content when it is within the limit", () => {
    const content = "short content";
    expect(truncateMarkdownForPreview(content, 100)).toBe(content);
  });

  it("truncates at a paragraph boundary outside a fenced code block", () => {
    const content = "first paragraph\n\nsecond paragraph\n\nthird paragraph";
    const maxLength = 35;
    const result = truncateMarkdownForPreview(content, maxLength);
    expect(result).toBe("first paragraph\n\nsecond paragraph");
  });

  it("extends to the end of a fenced code block when the limit falls inside", () => {
    const lines = [
      "intro text",
      "",
      "```ts",
      "const a = 1;",
      "const b = 2;",
      "const c = 3;",
      "```",
      "",
      "outro text",
    ];
    const content = lines.join("\n");
    const maxLength = content.indexOf("const b");
    const result = truncateMarkdownForPreview(content, maxLength);
    expect(result).toContain("const b");
    expect(result).toContain("const c");
    expect(result.endsWith("```")).toBe(true);
    expect(result).not.toContain("outro text");
  });

  it("extends to the end of the fenced block when every boundary is inside", () => {
    const content = "```ts\nline1\nline2\nline3\n```\n";
    const maxLength = content.indexOf("line2");
    const result = truncateMarkdownForPreview(content, maxLength);
    expect(result).toContain("```ts");
    expect(result.endsWith("```")).toBe(true);
  });

  it("extends to the end of a math block when the limit falls inside", () => {
    const lines = [
      "intro text",
      "",
      "$$",
      "E = mc^2",
      "\\\\int_0^1 f(x) \\, dx",
      "$$",
      "",
      "outro text",
    ];
    const content = lines.join("\n");
    const maxLength = content.indexOf("E = mc");
    const result = truncateMarkdownForPreview(content, maxLength);
    expect(result).toContain("E = mc^2");
    expect(result).toContain("\\\\int_0^1");
    expect(result.endsWith("$$")).toBe(true);
    expect(result).not.toContain("outro text");
  });

  it("does not truncate inside a math block without extending past its end", () => {
    const content = "prefix text\n\n$$\nlong math line that exceeds the max length significantly\n$$\n\nsuffix text";
    const maxLength = content.indexOf("exceeds");
    const result = truncateMarkdownForPreview(content, maxLength);
    expect(result).not.toContain("suffix text");
    expect(result.endsWith("$$")).toBe(true);
  });

  it("falls back to max length when no safe boundary exists", () => {
    const content = "a".repeat(200);
    const maxLength = 100;
    const result = truncateMarkdownForPreview(content, maxLength);
    expect(result.length).toBe(maxLength);
  });
});
