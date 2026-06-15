import { describe, expect, it } from "vitest";
import { restoreInlineMarkdownHeadings, restoreMarkdownTables } from "../assistantParagraphs";

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

describe("restoreMarkdownTables", () => {
  it("restores table separators split by streaming line breaks", () => {
    expect(restoreMarkdownTables([
      "| 优先级 | 该做的事 | 依据 |",
      "|",
      "",
      "--------|",
      "",
      "----------|------|",
      "| ⭐ 最应该 | **发布版本 `1.4.425`** | `TASK_STATE.md` 已明确写为\"下一步最小行动\" |",
      "| 其次 | **真机跑一局核心流程** | 同样是 `TASK_STATE.md` 下一步 |",
    ].join("\n"))).toBe([
      "| 优先级 | 该做的事 | 依据 |",
      "|--------|----------|------|",
      "| ⭐ 最应该 | **发布版本 `1.4.425`** | `TASK_STATE.md` 已明确写为\"下一步最小行动\" |",
      "| 其次 | **真机跑一局核心流程** | 同样是 `TASK_STATE.md` 下一步 |",
    ].join("\n"));
  });
});
