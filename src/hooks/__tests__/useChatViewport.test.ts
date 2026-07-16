/** @vitest-environment jsdom */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useChatViewport, type UseChatViewportOptions } from "@/hooks/useChatViewport";
import type { RenderItem } from "@/components/chat/ChatThread";

const defaultOptions: UseChatViewportOptions = {
  sessionId: "session-1",
  runtimeSessionId: "runtime-1",
  runningSessionId: null,
  contentVersion: "v1",
  renderItems: [],
  olderItemsPage: 0,
  expandedInitialTailSessionId: null,
  hasMoreOlderItems: false,
  onExpandInitialTail: vi.fn(),
  onExpandOlderItemsToEnd: vi.fn(),
  onHighlightEvent: vi.fn(),
};

function eventRenderItem(id: string): RenderItem {
  return {
    type: "event",
    event: {
      id,
      type: "assistant_message",
      timestamp: 1,
      content: `content-${id}`,
      isThinking: false,
      isComplete: true,
    },
  };
}

let latestViewport: ReturnType<typeof useChatViewport> | null = null;

function TestComponent({ options }: { options: UseChatViewportOptions }) {
  const viewport = useChatViewport(options);
  latestViewport = viewport;
  return createElement(
    "div",
    {
      ref: viewport.scrollRef,
      "data-testid": "scroll",
      style: { height: 200, overflow: "auto" },
    },
    createElement(
      "div",
      {
        ref: viewport.streamContentRef,
        "data-testid": "content",
        style: { height: 1000 },
      },
      options.renderItems.map((item) =>
        createElement("div", {
          key: item.type === "event" ? item.event.id : "x",
          "data-kimix-render-key": item.type === "event" ? item.event.id : "x",
          "data-kimix-event-id": item.type === "event" ? item.event.id : undefined,
          style: { height: 100 },
        }),
      ),
      createElement("button", {
        ref: viewport.scrollToBottomButtonRef,
        "aria-label": "滚动到底部",
        type: "button",
      }),
    ),
  );
}

function renderTest(options: Partial<UseChatViewportOptions> = {}) {
  latestViewport = null;
  const merged = { ...defaultOptions, ...options };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(TestComponent, { options: merged }));
  });
  const viewport = () => {
    if (!latestViewport) throw new Error("viewport not ready");
    return latestViewport;
  };
  return {
    root,
    container,
    viewport,
    get scroll() {
      return container.querySelector<HTMLDivElement>("[data-testid='scroll']")!;
    },
    get content() {
      return container.querySelector<HTMLDivElement>("[data-testid='content']")!;
    },
    rerender(next: Partial<UseChatViewportOptions> = {}) {
      const nextMerged = { ...merged, ...next };
      act(() => {
        root.render(createElement(TestComponent, { options: nextMerged }));
      });
    },
  };
}

describe("useChatViewport", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "api", {
      value: { writeDiag: vi.fn(() => Promise.resolve()) },
      configurable: true,
      writable: true,
    });
    if (!Element.prototype.scrollIntoView) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Element.prototype.scrollIntoView = vi.fn() as any;
    }
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).api;
    latestViewport = null;
  });

  it("returns refs and handlers", () => {
    const { viewport } = renderTest();
    expect(viewport().scrollRef.current).toBeInstanceOf(HTMLDivElement);
    expect(viewport().streamContentRef.current).toBeInstanceOf(HTMLDivElement);
    expect(viewport().scrollToBottomButtonRef.current).toBeInstanceOf(HTMLButtonElement);
    expect(typeof viewport().handlers.onScroll).toBe("function");
    expect(typeof viewport().handlers.onWheel).toBe("function");
    expect(typeof viewport().handlers.onPointerDown).toBe("function");
  });

  it("reports scroll metrics via getScrollDiagSnapshot", () => {
    const { viewport } = renderTest({ renderItems: [eventRenderItem("a"), eventRenderItem("b")] });
    const snap = viewport().getScrollDiagSnapshot();
    expect(snap).toHaveProperty("scrollTop");
    expect(snap).toHaveProperty("scrollHeight");
    expect(snap).toHaveProperty("clientHeight");
    expect(snap).toHaveProperty("distance");
    expect(snap).toHaveProperty("autoFollow");
    expect(snap).toHaveProperty("userScroll");
    expect(snap).toHaveProperty("contentOffsetHeight");
    expect(snap).toHaveProperty("contentScrollHeight");
  });

  it("calls onExpandInitialTail when wheeling up in initial tail mode", () => {
    const onExpand = vi.fn();
    const { viewport } = renderTest({
      sessionId: "session-1",
      expandedInitialTailSessionId: null,
      onExpandInitialTail: onExpand,
      renderItems: [eventRenderItem("a"), eventRenderItem("b")],
    });

    act(() => {
      viewport().handlers.onWheel({ deltaY: -10 } as React.WheelEvent<HTMLDivElement>);
    });

    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("does not call onExpandInitialTail when already expanded", () => {
    const onExpand = vi.fn();
    const { viewport } = renderTest({
      sessionId: "session-1",
      expandedInitialTailSessionId: "session-1",
      onExpandInitialTail: onExpand,
      renderItems: [eventRenderItem("a"), eventRenderItem("b")],
    });

    act(() => {
      viewport().handlers.onWheel({ deltaY: -10 } as React.WheelEvent<HTMLDivElement>);
    });

    expect(onExpand).not.toHaveBeenCalled();
  });

  it("tracks userHasScrolled via wheel interactions", () => {
    const { viewport } = renderTest({ renderItems: [eventRenderItem("a"), eventRenderItem("b")] });

    expect(viewport().userHasScrolled).toBe(false);

    act(() => {
      viewport().handlers.onWheel({ deltaY: -10 } as React.WheelEvent<HTMLDivElement>);
    });

    expect(viewport().userHasScrolled).toBe(true);
  });

  it("resets userHasScrolled when the session changes", () => {
    const { viewport, rerender } = renderTest({ sessionId: "session-1", renderItems: [eventRenderItem("a")] });

    act(() => {
      viewport().handlers.onWheel({ deltaY: -10 } as React.WheelEvent<HTMLDivElement>);
    });
    expect(viewport().userHasScrolled).toBe(true);

    rerender({ sessionId: "session-2", renderItems: [eventRenderItem("b")] });

    expect(viewport().userHasScrolled).toBe(false);
  });

  it("focuses a timeline event by id", () => {
    const onHighlight = vi.fn();
    const { viewport } = renderTest({
      renderItems: [eventRenderItem("a"), eventRenderItem("b")],
      onHighlightEvent: onHighlight,
    });

    act(() => {
      viewport().focusTimelineEvent("b");
    });

    expect(onHighlight).toHaveBeenCalledWith("b");
  });

  it("prepare expand helpers capture anchors without throwing", () => {
    const { viewport } = renderTest({ renderItems: [eventRenderItem("a"), eventRenderItem("b")] });

    expect(() => {
      viewport().prepareInitialTailExpand();
      viewport().prepareOlderItemsExpand();
      viewport().prepareOlderItemsExpandToEnd();
    }).not.toThrow();
  });
});
