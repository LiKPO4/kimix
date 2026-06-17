import { describe, expect, it } from "vitest";
import { normalizeIndentedFencedCodeBlocks, normalizeNestedMarkdownFencedCodeBlocks, restoreInlineMarkdownHeadings, restoreMarkdownTables } from "../assistantParagraphs";

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

  it("does not rewrite markdown-looking content inside fenced code blocks", () => {
    expect(restoreMarkdownTables([
      "```text",
      "| not | a table |",
      "|",
      "----|",
      "```",
    ].join("\n"))).toBe([
      "```text",
      "| not | a table |",
      "|",
      "----|",
      "```",
    ].join("\n"));
  });
});

describe("normalizeIndentedFencedCodeBlocks", () => {
  it("keeps list-indented fenced code content inside the code block", () => {
    expect(normalizeIndentedFencedCodeBlocks([
      "2. 若再次遇到全量测试 flake，运行：",
      "   ```bash",
      "   flutter test --con",
      "",
      "currency=1 --reporter=json > test_run.json",
      "   ```",
      "   保留失败用例名称与堆栈。",
    ].join("\n"))).toBe([
      "2. 若再次遇到全量测试 flake，运行：",
      "   ```bash",
      "   flutter test --con",
      "",
      "   currency=1 --reporter=json > test_run.json",
      "   ```",
      "   保留失败用例名称与堆栈。",
    ].join("\n"));
  });
});

describe("normalizeNestedMarkdownFencedCodeBlocks", () => {
  it("upgrades an outer markdown fence when it contains nested backtick fences", () => {
    expect(normalizeNestedMarkdownFencedCodeBlocks([
      "下面是完整文档：",
      "",
      "```markdown",
      "## 发布流程",
      "1. 构建：",
      "```bash",
      "flutter build apk --release",
      "```",
      "## SSH 与服务器",
      "- 当前已免密",
      "```",
      "",
      "你看下是否合理。",
    ].join("\n"))).toBe([
      "下面是完整文档：",
      "",
      "````markdown",
      "## 发布流程",
      "1. 构建：",
      "```bash",
      "flutter build apk --release",
      "```",
      "## SSH 与服务器",
      "- 当前已免密",
      "````",
      "",
      "你看下是否合理。",
    ].join("\n"));
  });

  it("keeps table and heading repairs outside a nested markdown code fence", () => {
    const input = [
      "下面是完整文档：",
      "",
      "```markdown",
      "## 发布流程",
      "```bash",
      "echo ok",
      "```",
      "| not | a table |",
      "|",
      "----|",
      "```",
      "",
      "结尾。 ## 下一步 检查",
    ].join("\n");

    expect(restoreInlineMarkdownHeadings(restoreMarkdownTables(normalizeNestedMarkdownFencedCodeBlocks(input)))).toBe([
      "下面是完整文档：",
      "",
      "````markdown",
      "## 发布流程",
      "```bash",
      "echo ok",
      "```",
      "| not | a table |",
      "|",
      "----|",
      "````",
      "",
      "结尾。\n\n## 下一步 检查",
    ].join("\n"));
  });
});
