// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KimiWebIntermediateTextBlock } from "../MessageBubble";

describe("KimiWebIntermediateTextBlock", () => {
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

  it("renders process body markdown instead of exposing source markers", async () => {
    await act(async () => {
      root.render(createElement(KimiWebIntermediateTextBlock, {
        content: "**文案改动**\n\n- 赌鬼 `gambler`\n- 邪念敌人",
        streaming: true,
      }));
    });

    expect(container.querySelector(".kimix-streaming-markdown")).not.toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("文案改动");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("code")?.textContent).toBe("gambler");
    expect(container.textContent).not.toContain("**");
  });
});
