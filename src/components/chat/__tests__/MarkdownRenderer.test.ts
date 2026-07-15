// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MarkdownRenderer } from "../MarkdownRenderer";

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
});
