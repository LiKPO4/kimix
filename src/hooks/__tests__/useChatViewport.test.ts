/** @vitest-environment jsdom */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React, { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { useChatViewport, type UseChatViewportOptions } from "@/hooks/useChatViewport";
import type { RenderItem } from "@/types/chatRender";

const defaultOptions: UseChatViewportOptions = {
  sessionId: "session-1",
  runtimeSessionId: "runtime-1",
  runningSessionId: null,
  contentVersion: "v1",
  renderItems: [],
  olderItemsPage: 0,
  expandedInitialTailSessionId: null,
  hasMoreOlderItems: false,
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
  if (options.viewportReady === false) {
    return createElement("div", { "data-testid": "loading" });
  }
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
          "data-kimix-event-ids": item.type === "event" ? item.sourceEventIds?.join(" ") : undefined,
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
    vi.useRealTimers();
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

  it("treats an ordinary upward wheel only as user scroll intent", () => {
    const { viewport } = renderTest({
      sessionId: "session-1",
      expandedInitialTailSessionId: null,
      renderItems: [eventRenderItem("a"), eventRenderItem("b")],
    });

    act(() => {
      viewport().handlers.onWheel({ deltaY: -10 } as React.WheelEvent<HTMLDivElement>);
    });

    expect(viewport().userHasScrolled).toBe(true);
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
    const { viewport, rerender, scroll } = renderTest({ sessionId: "session-1", renderItems: [eventRenderItem("a")] });
    const scrollTo = vi.fn();
    Object.defineProperties(scroll, {
      scrollTop: { configurable: true, writable: true, value: 120 },
      scrollTo: { configurable: true, value: scrollTo },
    });

    act(() => {
      viewport().handlers.onWheel({ deltaY: -10 } as React.WheelEvent<HTMLDivElement>);
    });
    expect(viewport().userHasScrolled).toBe(true);

    rerender({ sessionId: "session-2", renderItems: [eventRenderItem("b")] });

    expect(viewport().userHasScrolled).toBe(false);
    expect(scrollTo).toHaveBeenCalledWith({ top: 120, behavior: "auto" });
  });

  it("primes the session after a loading placeholder is replaced by the scroll viewport", () => {
    vi.useFakeTimers();
    const { viewport, rerender, container } = renderTest({ viewportReady: false });

    act(() => {
      vi.runAllTimers();
    });
    expect(viewport().scrollRef.current).toBeNull();
    expect(viewport().isSessionScrollPrimed).toBe(false);

    rerender({ viewportReady: true });
    expect(container.querySelector("[data-testid='scroll']")).toBeInstanceOf(HTMLDivElement);
    act(() => {
      vi.runAllTimers();
    });

    expect(viewport().isSessionScrollPrimed).toBe(true);
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

  it("lets a later click focus a target that mounted after a terminal miss", () => {
    vi.useFakeTimers();
    const onHighlight = vi.fn();
    const { viewport, rerender } = renderTest({
      renderItems: [eventRenderItem("a")],
      onHighlightEvent: onHighlight,
    });

    let firstResult = true;
    act(() => {
      firstResult = viewport().focusTimelineEvent("later");
    });
    expect(firstResult).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2_500);
    });
    rerender({ renderItems: [eventRenderItem("a"), eventRenderItem("later")] });

    let secondResult = false;
    act(() => {
      secondResult = viewport().focusTimelineEvent("later");
    });
    expect(secondResult).toBe(true);
    expect(onHighlight).toHaveBeenCalledWith("later");
  });

  it("keeps the latest navigation highlight for its full lease", () => {
    vi.useFakeTimers();
    const onHighlight = vi.fn();
    const { viewport } = renderTest({
      renderItems: [eventRenderItem("a"), eventRenderItem("b")],
      onHighlightEvent: onHighlight,
    });
    onHighlight.mockClear();

    act(() => {
      viewport().focusTimelineEvent("a");
      vi.advanceTimersByTime(1_000);
      viewport().focusTimelineEvent("b");
      vi.advanceTimersByTime(1_201);
    });
    expect(onHighlight.mock.calls).toEqual([["a"], ["b"]]);

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(onHighlight.mock.calls).toEqual([["a"], ["b"], [null]]);
  });

  it("can place an Agent item header at the vertical center", () => {
    const { viewport, scroll } = renderTest({ renderItems: [eventRenderItem("a"), eventRenderItem("b")] });
    const target = scroll.querySelector<HTMLElement>("[data-kimix-event-id='b']")!;
    const scrollTo = vi.fn();
    Object.defineProperties(scroll, {
      clientHeight: { configurable: true, value: 600 },
      scrollTop: { configurable: true, writable: true, value: 100 },
      scrollTo: { configurable: true, value: scrollTo },
    });
    vi.spyOn(scroll, "getBoundingClientRect").mockReturnValue({ top: 20 } as DOMRect);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 600 } as DOMRect);

    act(() => {
      viewport().focusTimelineEvent("b", undefined, "start-center");
    });

    expect(scrollTo).toHaveBeenCalledWith({ top: 380, behavior: "smooth" });
  });

  it("invalidates the old viewport anchor before navigation so streaming cannot pull it back", () => {
    const { viewport, scroll, rerender } = renderTest({
      contentVersion: "v1",
      renderItems: [eventRenderItem("a"), eventRenderItem("b")],
    });
    const first = scroll.querySelector<HTMLElement>("[data-kimix-event-id='a']")!;
    const target = scroll.querySelector<HTMLElement>("[data-kimix-event-id='b']")!;
    Object.defineProperties(scroll, {
      clientHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, writable: true, value: 0 },
      scrollTo: {
        configurable: true,
        value: vi.fn(({ top }: ScrollToOptions) => {
          scroll.scrollTop = Number(top ?? 0);
        }),
      },
    });
    vi.spyOn(scroll, "getBoundingClientRect").mockImplementation(() => ({ top: 0 } as DOMRect));
    vi.spyOn(first, "getBoundingClientRect").mockImplementation(() => ({
      top: 100 - scroll.scrollTop,
      bottom: 200 - scroll.scrollTop,
    } as DOMRect));
    vi.spyOn(target, "getBoundingClientRect").mockImplementation(() => ({
      top: 700 - scroll.scrollTop,
      bottom: 800 - scroll.scrollTop,
    } as DOMRect));

    act(() => {
      viewport().captureResizeAnchor();
      viewport().focusTimelineEvent("b", undefined, "start-center");
    });
    expect(scroll.scrollTop).toBe(600);

    rerender({ contentVersion: "v2" });

    expect(scroll.scrollTop).toBe(600);
    expect(viewport().getScrollDiagSnapshot()).toMatchObject({
      autoFollow: false,
      userScroll: true,
    });
  });

  it("does not let a mid-smooth-scroll anchor capture pull the viewport back after rail navigation", () => {
    // 现场：跟随态点左侧刻度跳转，smooth 滚动落定前 140ms 闲时捕获落在旧位置，
    // 700ms 抑制窗过后下一次内容刷新按过期锚点把视口拖回跳转前位置（约 1 秒跳回）。
    // Date 必须一起 fake，否则抑制窗按真实时钟永远判定"刚滚动过"。
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "Date"],
    });
    const { viewport, scroll, rerender } = renderTest({
      contentVersion: "v1",
      renderItems: [eventRenderItem("a"), eventRenderItem("b")],
    });
    const first = scroll.querySelector<HTMLElement>("[data-kimix-event-id='a']")!;
    const target = scroll.querySelector<HTMLElement>("[data-kimix-event-id='b']")!;
    Object.defineProperties(scroll, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, writable: true, value: 1000 },
      scrollTop: { configurable: true, writable: true, value: 800 },
      scrollTo: {
        configurable: true,
        value: vi.fn(({ top }: ScrollToOptions) => {
          // smooth 滚动约 300ms 后落定（jsdom 无真实动画，用定时器模拟）。
          window.setTimeout(() => {
            scroll.scrollTop = Number(top ?? 0);
          }, 300);
        }),
      },
    });
    vi.spyOn(scroll, "getBoundingClientRect").mockImplementation(() => ({ top: 0 } as DOMRect));
    vi.spyOn(first, "getBoundingClientRect").mockImplementation(() => ({
      top: 100 - scroll.scrollTop,
      bottom: 200 - scroll.scrollTop,
    } as DOMRect));
    vi.spyOn(target, "getBoundingClientRect").mockImplementation(() => ({
      top: 700 - scroll.scrollTop,
      bottom: 800 - scroll.scrollTop,
    } as DOMRect));

    act(() => {
      vi.advanceTimersByTime(50);
    });
    scroll.scrollTop = 800;

    act(() => {
      viewport().focusTimelineEvent("a", undefined, "start");
    });
    // 140ms 闲时捕获窗口过去时 smooth 尚未落定；修复后该捕获必须被取消。
    act(() => {
      vi.advanceTimersByTime(140);
    });
    // smooth 落定 + 锚点落定捕获（连续稳定帧）。
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(scroll.scrollTop).toBe(84);

    // 抑制窗（700ms）过后的内容刷新不得把视口拖回旧位置。
    act(() => {
      vi.advanceTimersByTime(500);
      rerender({ contentVersion: "v2" });
    });
    expect(scroll.scrollTop).toBe(84);
  });

  it("suppresses a sub-threshold anchor drift without a scrollTop write and recaptures the new baseline", () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
    });
    const writeDiag = (window as any).api.writeDiag as ReturnType<typeof vi.fn>;
    const { viewport, scroll } = renderTest({
      sessionId: "session-1",
      contentVersion: "v1",
      renderItems: [eventRenderItem("a"), eventRenderItem("b")],
    });
    const anchorEl = scroll.querySelector<HTMLElement>("[data-kimix-event-id='b']")!;
    Object.defineProperties(scroll, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, writable: true, value: 1000 },
      scrollTop: { configurable: true, writable: true, value: 800 },
    });
    vi.spyOn(scroll, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    const bRectMock = vi.fn(() => ({ top: 700 - scroll.scrollTop, bottom: 800 - scroll.scrollTop } as DOMRect));
    vi.spyOn(anchorEl, "getBoundingClientRect").mockImplementation(bRectMock as unknown as () => DOMRect);

    // Flush the mount-time priming rAFs (scroll-to-bottom) so they cannot clobber
    // scrollTop mid-test, then place the viewport at the detached working offset.
    act(() => {
      vi.advanceTimersByTime(50);
    });
    Object.defineProperty(scroll, "scrollTop", { configurable: true, writable: true, value: 700 });

    // User scrolls up (detached) and the viewport captures an anchor at offset 0.
    act(() => {
      viewport().handlers.onWheel({ deltaY: -10 } as React.WheelEvent<HTMLDivElement>);
      viewport().captureResizeAnchor();
    });
    expect(viewport().getScrollDiagSnapshot()).toMatchObject({ userScroll: true });

    // Plain→Rich settle swap drifts the anchored item down 13px (≤ 32px threshold).
    bRectMock.mockImplementation(() => ({ top: 713 - scroll.scrollTop, bottom: 813 - scroll.scrollTop } as DOMRect));
    writeDiag.mockClear();

    let restored = false;
    act(() => {
      restored = viewport().restoreResizeAnchor("contentVersion:user-scroll");
    });
    expect(restored).toBe(true);
    expect(scroll.scrollTop).toBe(700); // self-drift must not write scrollTop
    expect(writeDiag).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ suppressedByMinDelta: true }) }),
    );

    // The drifted position is re-captured as the new baseline via the rAF pass.
    const rectCallsAfterRestore = bRectMock.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(32);
    });
    expect(bRectMock.mock.calls.length).toBeGreaterThan(rectCallsAfterRestore);

    // Real content displacement above the threshold still compensates as before.
    bRectMock.mockImplementation(() => ({ top: 753 - scroll.scrollTop, bottom: 853 - scroll.scrollTop } as DOMRect));
    let restoredLarge = false;
    act(() => {
      restoredLarge = viewport().restoreResizeAnchor("contentVersion:user-scroll");
    });
    expect(restoredLarge).toBe(true);
    expect(scroll.scrollTop).toBe(740);
  });

  it("pins to the bottom when content grows after the session settle window expired", () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
    const { viewport, scroll, rerender } = renderTest({
      sessionId: "session-1",
      contentVersion: "v1",
      renderItems: [eventRenderItem("a"), eventRenderItem("b")],
    });
    Object.defineProperties(scroll, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, writable: true, value: 1000 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });

    // The open-session settle loop pins to the bottom, then exits early after
    // consecutive stable polls (which also closes the settle window).
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(scroll.scrollTop).toBe(800);
    expect(viewport().getScrollDiagSnapshot()).toMatchObject({
      autoFollow: true,
      userScroll: false,
    });

    // Long after the settle window expired, restored-session content
    // (history reconciliation / sub-agent reveals) grows the scroll height.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, writable: true, value: 1400 });
    rerender({ contentVersion: "v2" });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // The follow branch must write the bottom directly; calling the expired
    // settleSessionAtBottom here is a no-op that leaves scrollTop stale.
    expect(scroll.scrollTop).toBe(1200);
  });

  it("preserves a pending focus request while switching to its target session", async () => {
    const onHighlight = vi.fn();
    const { rerender } = renderTest({
      sessionId: "session-1",
      renderItems: [eventRenderItem("a")],
      onHighlightEvent: onHighlight,
    });

    act(() => {
      window.dispatchEvent(new CustomEvent("kimix:focus-timeline-event", {
        detail: { sessionId: "session-2", eventId: "target-event" },
      }));
    });
    rerender({
      sessionId: "session-2",
      renderItems: [eventRenderItem("target-event")],
    });
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(onHighlight).toHaveBeenCalledWith("target-event");
  });

  it("focuses a notification-targeted event aligned to the top when detail carries alignment start", async () => {
    const onHighlight = vi.fn();
    const { scroll } = renderTest({
      sessionId: "session-focus",
      renderItems: [eventRenderItem("a")],
      onHighlightEvent: onHighlight,
    });
    scroll.scrollTo = vi.fn();

    act(() => {
      window.dispatchEvent(new CustomEvent("kimix:focus-timeline-event", {
        detail: { sessionId: "session-focus", eventId: "a", alignment: "start" },
      }));
    });
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(onHighlight).toHaveBeenCalledWith("a");
    // "start" alignment must scroll the container to the target's top; the
    // center fallback would call scrollIntoView instead and leave scrollTo alone.
    expect(scroll.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
  });

  it("reveals a collapsed merged event before selecting its exact search text", async () => {
    const onHighlight = vi.fn();
    const merged = eventRenderItem("assistant:turn-1");
    if (merged.type !== "event") return;
    merged.sourceEventIds = ["assistant-step-2"];
    const { viewport, container, scroll } = renderTest({
      renderItems: [merged],
      onHighlightEvent: onHighlight,
    });
    scroll.scrollTo = vi.fn();
    const target = container.querySelector<HTMLElement>("[data-kimix-event-id='assistant:turn-1']")!;
    const reveal = document.createElement("button");
    reveal.dataset.kimixSearchExpand = "true";
    reveal.setAttribute("aria-expanded", "false");
    reveal.addEventListener("click", () => {
      reveal.setAttribute("aria-expanded", "true");
      const detail = document.createElement("span");
      detail.textContent = "这里是精准命中的内容";
      target.appendChild(detail);
    });
    target.appendChild(reveal);
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 100, height: 16 }),
    });

    act(() => {
      expect(viewport().focusTimelineEvent("assistant-step-2", "精准命中")).toBe(false);
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });

    expect(reveal.getAttribute("aria-expanded")).toBe("true");
    expect(window.getSelection()?.toString()).toBe("精准命中");
    expect(onHighlight).toHaveBeenCalledWith("assistant-step-2");
  });

  it("prepare expand helpers capture anchors without throwing", () => {
    const { viewport } = renderTest({ renderItems: [eventRenderItem("a"), eventRenderItem("b")] });

    expect(() => {
      viewport().prepareInitialTailExpand();
      viewport().prepareOlderItemsExpand();
      viewport().prepareOlderItemsExpandToEnd();
    }).not.toThrow();
  });

  it("aborts recursive focusTimelineEvent after too many attempts", async () => {
    const onExpand = vi.fn();
    const { viewport } = renderTest({
      hasMoreOlderItems: true,
      onExpandOlderItemsToEnd: onExpand,
      renderItems: [eventRenderItem("a")],
    });

    act(() => {
      viewport().focusTimelineEvent("missing");
    });

    // Each recursive attempt schedules two rAFs before expanding again.
    // Wait enough frames for the guard to hit MAX_FOCUS_RECURSIVE_ATTEMPTS.
    for (let i = 0; i < 18; i++) {
      await act(async () => {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      });
    }

    expect(onExpand).toHaveBeenCalledTimes(10);
  });

  it("resets focus recursion state when the session changes", () => {
    const onExpand = vi.fn();
    const { viewport, rerender } = renderTest({
      sessionId: "session-1",
      hasMoreOlderItems: true,
      onExpandOlderItemsToEnd: onExpand,
      renderItems: [eventRenderItem("a")],
    });

    for (let i = 0; i < 10; i++) {
      act(() => {
        viewport().focusTimelineEvent("missing");
      });
    }
    expect(onExpand).toHaveBeenCalledTimes(10);

    rerender({ sessionId: "session-2" });
    onExpand.mockClear();

    for (let i = 0; i < 5; i++) {
      act(() => {
        viewport().focusTimelineEvent("missing");
      });
    }
    expect(onExpand).toHaveBeenCalledTimes(5);
  });

  it("exposes a reactive following state that flips with pause/resume and resets per session", () => {
    // overflow-anchor is only disabled in detached mode; the reactive mirror keeps
    // the scroll container's class in sync so following mode retains native anchoring.
    if (!Element.prototype.scrollTo) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Element.prototype.scrollTo = vi.fn() as any;
    }
    const { viewport, rerender } = renderTest({ sessionId: "session-1" });
    expect(viewport().isFollowing).toBe(true);

    act(() => viewport().pauseAutoFollowForUser());
    expect(viewport().isFollowing).toBe(false);

    act(() => viewport().enableAutoFollow());
    expect(viewport().isFollowing).toBe(true);

    act(() => viewport().pauseAutoFollowForUser());
    expect(viewport().isFollowing).toBe(false);
    rerender({ sessionId: "session-2" });
    expect(viewport().isFollowing).toBe(true);
  });
});
