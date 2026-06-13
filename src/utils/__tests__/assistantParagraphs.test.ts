import { describe, expect, it } from "vitest";
import { restoreInlineMarkdownHeadings } from "../assistantParagraphs";

describe("restoreInlineMarkdownHeadings", () => {
  it("moves headings that were appended after a sentence back to line start", () => {
    expect(restoreInlineMarkdownHeadings("你好霖江路。我先扫一遍。 ## 本轮目标 盘点当前工作区\n\n## 计划\n1. 检查状态")).toBe(
      "你好霖江路。我先扫一遍。\n\n## 本轮目标 盘点当前工作区\n\n## 计划\n1. 检查状态",
    );
  });

  it("keeps existing line-start headings unchanged", () => {
    expect(restoreInlineMarkdownHeadings("你好霖江路。\n\n## 本轮目标\n检查状态")).toBe(
      "你好霖江路。\n\n## 本轮目标\n检查状态",
    );
  });
});
