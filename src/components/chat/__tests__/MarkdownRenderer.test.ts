// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MarkdownRenderer, normalizeMarkdownContent } from "../MarkdownRenderer";

describe("MarkdownRenderer streaming blocks", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("keeps completed markdown block DOM stable while the tail grows", async () => {
    await act(async () => {
      root.render(createElement(MarkdownRenderer, {
        content: "第一段稳定内容。\n\n第二段",
        streaming: true,
      }));
    });

    const streamRoot = container.querySelector(".kimix-streaming-markdown");
    expect(streamRoot).not.toBeNull();
    const firstBlock = streamRoot?.firstElementChild;
    expect(firstBlock?.textContent).toContain("第一段稳定内容");

    await act(async () => {
      root.render(createElement(MarkdownRenderer, {
        content: "第一段稳定内容。\n\n第二段继续增长。",
        streaming: true,
      }));
    });

    const updatedStreamRoot = container.querySelector(".kimix-streaming-markdown");
    expect(updatedStreamRoot?.firstElementChild).toBe(firstBlock);
    expect(updatedStreamRoot?.textContent).toContain("第二段继续增长");
  });

  it("re-highlights a streaming code block when its text changes on the reused DOM node", async () => {
    // 流式增量场景：首次 idle 着色后 <code> 带 hljs 类；React 复用同一节点更新
    // 文本时，旧守卫会因 hljs 类直接 return，增量代码永远保持旧高亮。
    await act(async () => {
      root.render(createElement(MarkdownRenderer, {
        content: ["```js", "const alphaToken = 1;", "```"].join("\n"),
        streaming: true,
      }));
    });
    // idle/timeout 着色（jsdom 无 requestIdleCallback 时走 120ms 兜底）
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    const code = container.querySelector<HTMLElement>("code.language-js");
    expect(code).not.toBeNull();
    expect(code?.classList.contains("hljs")).toBe(true);
    expect(code?.textContent).toContain("alphaToken");

    await act(async () => {
      root.render(createElement(MarkdownRenderer, {
        content: ["```js", "const betaToken = 2;", "```"].join("\n"),
        streaming: true,
      }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    const updated = container.querySelector<HTMLElement>("code.language-js");
    expect(updated?.textContent).toContain("betaToken");
    expect(updated?.textContent).not.toContain("alphaToken");
    // 重新着色发生：hljs 类保留且高亮 span 基于新文本（不再含旧标识符的 span）
    expect(updated?.classList.contains("hljs")).toBe(true);
    expect(updated?.innerHTML).not.toContain("alphaToken");
    expect(updated?.querySelector(".hljs-keyword, .hljs-title, .hljs-literal, span")).not.toBeNull();
  });

  it("applies assistant progress restoration inside the renderer", () => {
    const content = `先${"检查状态".repeat(12)}。现在${"继续构建".repeat(12)}。然后${"运行验证".repeat(12)}。下一步整理结果。`;
    expect(normalizeMarkdownContent(content, true)).toContain("。\n\n现在");
    expect(normalizeMarkdownContent(content, true)).toContain("。\n\n然后");
    expect(normalizeMarkdownContent(content, false)).toBe(content);
  });

  it("repairs broken tables in both progress and default normalization modes", () => {
    const content = [
      "| 优先级 | 事项 |",
      "|",
      "",
      "----------|------|",
      "| P1 | 修复 |",
    ].join("\n");

    const repaired = [
      "| 优先级 | 事项 |",
      "|----------|------|",
      "| P1 | 修复 |",
    ].join("\n");
    expect(normalizeMarkdownContent(content, true)).toBe(repaired);
    expect(normalizeMarkdownContent(content, false)).toBe(repaired);
  });

  it("lets markdown columns size themselves from their content", async () => {
    await act(async () => {
      root.render(createElement(MarkdownRenderer, {
        content: [
          "| 文件名 | 场景 | 提示词 |",
          "| --- | --- | --- |",
          "| `merchant.webp` | 落难商人 | A much longer prompt that should receive more room. |",
        ].join("\n"),
      }));
    });

    const table = container.querySelector<HTMLTableElement>("table");
    const cells = Array.from(container.querySelectorAll<HTMLTableCellElement>("tbody td"));
    expect(table?.style.tableLayout).toBe("auto");
    expect(table?.style.overflowWrap).toBe("break-word");
    expect(table?.parentElement?.className).toContain("overflow-x-auto");
    expect(table?.parentElement?.className).toContain("kimix-markdown-table-frame");
    expect(table?.className).toContain("kimix-markdown-table");
    expect(cells[0]?.className).toContain("kimix-markdown-table-cell-compact");
    expect(cells[0]?.className).toContain("kimix-markdown-table-cell");
    expect(cells[0]?.style.whiteSpace).toBe("nowrap");
    expect(cells[1]?.className).toContain("kimix-markdown-table-cell-compact");
    expect(cells[1]?.style.whiteSpace).toBe("nowrap");
    expect(cells[2]?.className).not.toContain("kimix-markdown-table-cell-compact");
    expect(cells[2]?.style.whiteSpace).toBe("normal");
  });
});
