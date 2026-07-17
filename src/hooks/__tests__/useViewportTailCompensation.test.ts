/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  useViewportTailCompensation,
  type UseViewportTailCompensationResult,
} from "@/hooks/useChatViewport/useViewportTailCompensation";

let latestResult: UseViewportTailCompensationResult | null = null;

function TestComponent() {
  const streamContentRef = useRef<HTMLDivElement | null>(null);
  latestResult = useViewportTailCompensation(streamContentRef);
  return createElement("div", { ref: streamContentRef });
}

describe("useViewportTailCompensation", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    latestResult = null;
    document.body.replaceChildren();
  });

  it("remembers the minimum height and consumes compensation as natural content grows", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(createElement(TestComponent)));
    const result = latestResult!;
    const node = container.firstElementChild as HTMLDivElement;

    act(() => result.setDetachedTailCompensation(120, 2000));
    expect(node.style.getPropertyValue("--kimix-detached-tail-compensation")).toBe("120px");

    Object.defineProperty(node, "scrollHeight", { configurable: true, value: 2080 });
    act(() => result.reconcileDetachedViewportCompensation(node));
    expect(node.style.getPropertyValue("--kimix-detached-tail-compensation")).toBe("40px");

    Object.defineProperty(node, "scrollHeight", { configurable: true, value: 2040 });
    act(() => result.reconcileDetachedViewportCompensation(node));
    expect(node.style.getPropertyValue("--kimix-detached-tail-compensation")).toBe("0px");

    act(() => root.unmount());
  });
});
