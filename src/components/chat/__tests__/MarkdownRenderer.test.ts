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
});
