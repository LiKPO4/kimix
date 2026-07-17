import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComposerToolbarPopover } from "../ComposerToolbarPopover";

describe("ComposerToolbarPopover", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("统一工具栏左侧弹窗的向上和向右展开规则", () => {
    act(() => {
      root.render(createElement(ComposerToolbarPopover, { align: "start", width: 260, children: "内容" }));
    });

    const panel = container.firstElementChild as HTMLDivElement;
    expect(panel.dataset.composerToolbarPopover).toBe("start");
    expect(panel.style.bottom).toBe("100%");
    expect(panel.style.left).toBe("0px");
    expect(panel.style.right).toBe("auto");
    expect(panel.style.marginBottom).toBe("8px");
    expect(panel.style.padding).toBe("16px");
    expect(panel.style.borderRadius).toBe("16px");
  });

  it("统一工具栏右侧弹窗的向上和向左展开规则", () => {
    act(() => {
      root.render(createElement(ComposerToolbarPopover, { align: "end", width: 320, children: "内容" }));
    });

    const panel = container.firstElementChild as HTMLDivElement;
    expect(panel.dataset.composerToolbarPopover).toBe("end");
    expect(panel.style.left).toBe("auto");
    expect(panel.style.right).toBe("0px");
    expect(panel.style.width).toBe("320px");
    expect(panel.style.maxWidth).toBe("calc(100vw - 40px)");
  });
});
