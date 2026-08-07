import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NumberInput } from "../NumberInput";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;

describe("NumberInput", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderInput(props: { value: number; min?: number; max?: number; onCommit: (value: number) => void }) {
    act(() => {
      root = createRoot(container);
      root.render(createElement(NumberInput, { min: 11, max: 20, ...props }));
    });
    return container.querySelector("input")!;
  }

  function type(input: HTMLInputElement, text: string) {
    act(() => {
      nativeValueSetter.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("越界中间态不打断输入：草稿保留、不提交；落回范围内实时提交", () => {
    const onCommit = vi.fn();
    const input = renderInput({ value: 15, onCommit });
    act(() => { input.focus(); });
    // 想输 15：第一个字符「1」越界（[11,20]），旧实现会被压成 11
    type(input, "1");
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("1");
    // 补全「15」落在范围内，实时提交
    type(input, "15");
    expect(onCommit).toHaveBeenCalledWith(15);
    expect(input.value).toBe("15");
  });

  it("失焦时越界草稿钳制提交", () => {
    const onCommit = vi.fn();
    const input = renderInput({ value: 15, onCommit });
    act(() => { input.focus(); });
    type(input, "30");
    expect(onCommit).not.toHaveBeenCalled();
    act(() => { input.blur(); });
    expect(onCommit).toHaveBeenCalledWith(20);
    expect(input.value).toBe("20");
  });

  it("空草稿/非法草稿失焦回退到原值，不提交", () => {
    const onCommit = vi.fn();
    const input = renderInput({ value: 15, onCommit });
    act(() => { input.focus(); });
    type(input, "");
    act(() => { input.blur(); });
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe("15");
  });

  it("Enter 提交并失焦", () => {
    const onCommit = vi.fn();
    const input = renderInput({ value: 15, onCommit });
    act(() => { input.focus(); });
    type(input, "18");
    expect(onCommit).toHaveBeenCalledWith(18);
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(document.activeElement).not.toBe(input);
  });

  it("非聚焦时外部值变化同步显示", () => {
    const onCommit = vi.fn();
    act(() => {
      root = createRoot(container);
      root.render(createElement(NumberInput, { value: 15, min: 11, max: 20, onCommit }));
    });
    const input = container.querySelector("input")!;
    expect(input.value).toBe("15");
    act(() => {
      root.render(createElement(NumberInput, { value: 12, min: 11, max: 20, onCommit }));
    });
    expect(input.value).toBe("12");
  });
});
