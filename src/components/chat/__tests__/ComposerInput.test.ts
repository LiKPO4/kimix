import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateComposerScrollbarMetrics, ComposerInput } from "../ComposerInput";

const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight");

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return this.value.length > 80 ? 240 : 52;
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalScrollHeight) Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", originalScrollHeight);
  else Reflect.deleteProperty(HTMLTextAreaElement.prototype, "scrollHeight");
});

describe("ComposerInput overlay scrollbar", () => {
  it("recalculates height when a long controlled value is restored without an input event", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const props = {
      placeholder: "输入消息",
      onChange: vi.fn(),
      onSubmit: vi.fn(),
    };

    act(() => root.render(createElement(ComposerInput, { ...props, value: "短草稿" })));
    expect(container.querySelector("textarea")?.style.height).toBe("52px");

    act(() => root.render(createElement(ComposerInput, { ...props, value: "恢复的长草稿".repeat(20) })));
    expect(container.querySelector("textarea")?.style.height).toBe("132px");

    act(() => root.render(createElement(ComposerInput, { ...props, value: "" })));
    expect(container.querySelector("textarea")?.style.height).toBe("52px");

    act(() => root.unmount());
    container.remove();
  });

  it("stays hidden while the textarea content fits", () => {
    expect(calculateComposerScrollbarMetrics({
      clientHeight: 100,
      scrollHeight: 100,
      scrollTop: 0,
    })).toEqual({ visible: false, thumbHeight: 0, thumbTop: 0 });
  });

  it("maps textarea scrolling onto an overlay thumb without changing textarea width", () => {
    const start = calculateComposerScrollbarMetrics({
      clientHeight: 132,
      scrollHeight: 396,
      scrollTop: 0,
    });
    const end = calculateComposerScrollbarMetrics({
      clientHeight: 132,
      scrollHeight: 396,
      scrollTop: 264,
    });

    expect(start.visible).toBe(true);
    expect(start.thumbHeight).toBe(41);
    expect(start.thumbTop).toBe(0);
    expect(end.thumbTop).toBe(82);

    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    expect(css).toMatch(
      /\.kimix-composer-input::-webkit-scrollbar\s*\{[^}]*width:\s*0;[^}]*height:\s*0;/s,
    );
  });
});
