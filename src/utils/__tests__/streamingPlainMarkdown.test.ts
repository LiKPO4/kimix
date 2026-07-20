import { describe, expect, it } from "vitest";
import { renderStreamingPlainBlockToHtml, splitStreamingPlainBlocks } from "../streamingPlainMarkdown";

describe("splitStreamingPlainBlocks", () => {
  it("splits paragraphs outside fences", () => {
    expect(splitStreamingPlainBlocks("a\n\nb\n\nc")).toEqual(["a", "b", "c"]);
  });

  it("keeps an open fence as one block", () => {
    const blocks = splitStreamingPlainBlocks("before\n\n```ts\nconst x = 1\n");
    expect(blocks).toEqual(["before", "```ts\nconst x = 1\n"]);
  });

  it("keeps a closed fence intact", () => {
    const blocks = splitStreamingPlainBlocks("```js\nconsole.log(1)\n```\n\nafter");
    expect(blocks[0]).toContain("```js");
    expect(blocks[0]).toContain("console.log(1)");
    expect(blocks.at(-1)).toBe("after");
  });

  it("does not split on blank lines inside a fence", () => {
    const blocks = splitStreamingPlainBlocks("```\nline1\n\nline2\n```");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("line1\n\nline2");
  });
});

describe("renderStreamingPlainBlockToHtml", () => {
  it("escapes html in paragraphs", () => {
    expect(renderStreamingPlainBlockToHtml("<script>x</script>")).toContain("&lt;script&gt;");
  });

  it("renders fenced code without highlight classes", () => {
    const html = renderStreamingPlainBlockToHtml("```ts\nconst a = 1\n```");
    expect(html).toContain("kimix-streaming-plain-code");
    expect(html).not.toContain("hljs");
    expect(html).toContain("const a = 1");
  });
});
