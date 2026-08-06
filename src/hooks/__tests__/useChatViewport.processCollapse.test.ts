/** @vitest-environment jsdom */
/**
 * 视口「完成后尾部空白」回归测试（自动折叠 → 尾部补偿残留）。
 *
 * 症状：一轮输出完成后，最后一条 assistant 消息下方出现大段空白，
 * 用户滚动到滚动容器视觉底部也消不掉（补偿撑出的底部本身就是空白）。
 *
 * 根因（两条残留路径，均已修复）：
 * 1. detached 模式下内容收缩（自动折叠）时 planDetachedViewportRestore
 *    设置尾部补偿（--kimix-detached-tail-compensation 撑起 scrollHeight
 *    防止 anchor 写入被 clamp）。释放条件 canReleaseViewportTailCompensation
 *    只认 scrollTop <= 自然最大滚动位置；用户滚到「补偿后的视觉底部」时
 *    scrollTop = 自然最大 + 补偿 > 自然最大，永不释放 → 修复为「滚到视觉
 *    底部也释放并贴自然底」。
 * 2. 无稳定 anchor（折叠节点本身就是用户视口锚点，如正在阅读的思考被
 *    自动折叠，selectStableAnchor 采样元素在 collapsingNode 内被判 unstable）
 *    时仍设置补偿——补偿 = 视口底部悬空量，折叠后无内容增长消费 → 修复为
 *    无 anchor 且需要补偿时直接贴自然底。
 *
 * 测试设施注意：每个测试显式 unmount 根（残留的 process-collapse 监听器
 * 会跨测试串扰），mount 期的 rAF 贴底链用 fake timers 统一 flush。
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
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
const activeRoots: Root[] = [];

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
    ),
  );
}

function renderTest(options: Partial<UseChatViewportOptions> = {}) {
  latestViewport = null;
  const merged = { ...defaultOptions, ...options };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  activeRoots.push(root);
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

function dispatchProcessCollapse(
  phase: "before" | "after",
  transactionId: string,
  options: { sessionId?: string; contentAnchor?: HTMLElement | null } = {},
) {
  act(() => {
    window.dispatchEvent(new CustomEvent("kimix:process-collapse-viewport", {
      detail: {
        phase,
        transactionId,
        sessionId: options.sessionId ?? "session-1",
        eventId: "assistant-1",
        agentTurnId: "turn-1",
        roomAgentId: undefined,
        summaryAnchor: null,
        contentAnchor: options.contentAnchor ?? null,
        collapsingNode: null,
      },
    }));
  });
}

/** 建立「贴底 + 内容 1000 / 视口 200」的初始视口。 */
function setupViewport(harness: ReturnType<typeof renderTest>) {
  const { scroll, content } = harness;
  Object.defineProperties(scroll, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, writable: true, value: 1000 },
    scrollTop: { configurable: true, writable: true, value: 800 },
  });
  Object.defineProperty(content, "scrollHeight", { configurable: true, writable: true, value: 1000 });
}

/** 模拟折叠：内容收缩 400px（1000 → 600）。 */
function collapseContent(harness: ReturnType<typeof renderTest>) {
  const { scroll, content, rerender } = harness;
  Object.defineProperty(scroll, "scrollHeight", { configurable: true, writable: true, value: 600 });
  Object.defineProperty(content, "scrollHeight", { configurable: true, writable: true, value: 600 });
  rerender({ contentVersion: "v2" });
}

function enterDetached(harness: ReturnType<typeof renderTest>, scrollTop: number) {
  const { viewport, scroll, rerender } = harness;
  act(() => {
    viewport().handlers.onWheel({ deltaY: -10 } as React.WheelEvent<HTMLDivElement>);
  });
  expect(viewport().getScrollDiagSnapshot()).toMatchObject({
    autoFollow: false,
    userScroll: true,
  });
  // 先刷一次 contentVersion，让 contentResizeSnapshotRef 记录 detached 状态，
  // 避免折叠 commit 时被「上一次跟随态快照」的收缩贴底逻辑误写。
  rerender({ contentVersion: "v1-d" });
  Object.defineProperty(scroll, "scrollTop", { configurable: true, writable: true, value: scrollTop });
}

function tailCompensationOf(harness: ReturnType<typeof renderTest>) {
  return harness.content.style.getPropertyValue("--kimix-detached-tail-compensation");
}

/** 视口内折叠节点之外的稳定锚点（selectStableAnchor 采样行上方）。 */
function mountStableAnchor(scroll: HTMLElement) {
  const contentAnchor = document.createElement("span");
  scroll.appendChild(contentAnchor);
  vi.spyOn(contentAnchor, "getBoundingClientRect").mockReturnValue({
    top: 50,
    left: 0,
    right: 100,
    bottom: 50,
    width: 100,
    height: 0,
    x: 0,
    y: 50,
    toJSON: () => ({}),
  } as DOMRect);
  return contentAnchor;
}

describe("useChatViewport · 自动折叠尾部空白回归", () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "api", {
      value: { writeDiag: vi.fn(() => Promise.resolve()) },
      configurable: true,
      writable: true,
    });
    // fake rAF/timers：mount 期的贴底 rAF 链与 settle 定时器统一由测试驱动，
    // 避免真实 16ms rAF 在后续 act 中竞态写 scrollTop。
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"],
    });
  });

  afterEach(() => {
    // 显式卸载全部根：残留的 process-collapse 监听器会跨测试串扰。
    for (const root of activeRoots.splice(0)) {
      act(() => root.unmount());
    }
    vi.useRealTimers();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).api;
    latestViewport = null;
    document.body.replaceChildren();
  });

  it("跟随模式下自动折叠后重新贴底，不留下尾部空白", () => {
    const harness = renderTest({
      renderItems: [eventRenderItem("a"), eventRenderItem("b")],
    });
    const { viewport, scroll } = harness;
    // flush mount 期的贴底 rAF 链，然后建立确定性视口状态。
    act(() => {
      vi.advanceTimersByTime(50);
    });
    setupViewport(harness);

    dispatchProcessCollapse("before", "t-follow");
    collapseContent(harness);
    dispatchProcessCollapse("after", "t-follow");

    // scrollToBottom 走下一帧 rAF；flush 后必须贴到新底部且无补偿变量。
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(scroll.scrollTop).toBe(400);
    expect(tailCompensationOf(harness)).toBe("");
    expect(viewport().getScrollDiagSnapshot()).toMatchObject({
      autoFollow: true,
      userScroll: false,
    });
  });

  it("detached 且无稳定 anchor 的折叠直接贴自然底（不撑尾部空白）", () => {
    const harness = renderTest({
      renderItems: [eventRenderItem("a"), eventRenderItem("b")],
    });
    const { viewport, scroll } = harness;
    act(() => {
      vi.advanceTimersByTime(50);
    });
    setupViewport(harness);

    // 用户在流式输出期间上翻（detached，阅读位置 700）；视口内锚点采样
    // 落在折叠节点内（jsdom elementFromPoint 无命中、无 contentAnchor）→
    // selectStableAnchor 返回 null → 无稳定 anchor。
    enterDetached(harness, 700);

    dispatchProcessCollapse("before", "t-detached-no-anchor");
    collapseContent(harness);
    dispatchProcessCollapse("after", "t-detached-no-anchor");

    // 修复后：无 anchor 可保护时，补偿只会撑出滚不掉的尾部空白 → 直接贴底。
    expect(scroll.scrollTop).toBe(400);
    expect(tailCompensationOf(harness)).toBe("");
    expect(viewport().getScrollDiagSnapshot()).toMatchObject({
      autoFollow: false,
      userScroll: true,
    });
  });

  it("detached 且有稳定 anchor 的折叠保持阅读位置，用户滚到视觉底部时释放补偿并贴底", () => {
    const harness = renderTest({
      renderItems: [eventRenderItem("a"), eventRenderItem("b")],
    });
    const { viewport, scroll } = harness;
    act(() => {
      vi.advanceTimersByTime(50);
    });
    setupViewport(harness);

    const contentAnchor = mountStableAnchor(scroll);
    enterDetached(harness, 700);

    dispatchProcessCollapse("before", "t-detached-anchor", { contentAnchor });
    collapseContent(harness);
    dispatchProcessCollapse("after", "t-detached-anchor", { contentAnchor });

    // 模拟浏览器布局：padding-bottom 补偿计入 scrollHeight（自然 600 + 补偿 300）。
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, writable: true, value: 900 });

    // 有稳定 anchor：折叠后阅读位置被保护（scrollTop 保持 700，不抢滚动），
    // 补偿撑起 scrollHeight（700 + 200 = 900 > 自然 600）。
    expect(scroll.scrollTop).toBe(700);
    expect(tailCompensationOf(harness)).toBe("300px");

    // 用户向下滚动到「补偿后的视觉底部」（自然最大 400 + 补偿 300 = 700）。
    Object.defineProperty(scroll, "scrollTop", { configurable: true, writable: true, value: 700 });
    act(() => {
      viewport().handlers.onScroll({} as React.UIEvent<HTMLDivElement>);
    });

    // 修复后：滚到视觉底部 = 到达内容底部意图，补偿释放、自然贴底、空白消失。
    expect(tailCompensationOf(harness)).toBe("0px");
    expect(scroll.scrollTop).toBe(400);
  });

  it("detached 折叠后停在补偿空间内部（未到底）时不得提前释放补偿", () => {
    const harness = renderTest({
      renderItems: [eventRenderItem("a"), eventRenderItem("b")],
    });
    const { viewport, scroll } = harness;
    act(() => {
      vi.advanceTimersByTime(50);
    });
    setupViewport(harness);

    const contentAnchor = mountStableAnchor(scroll);
    enterDetached(harness, 700);

    dispatchProcessCollapse("before", "t-mid", { contentAnchor });
    collapseContent(harness);
    dispatchProcessCollapse("after", "t-mid", { contentAnchor });
    // 模拟浏览器布局：padding-bottom 补偿计入 scrollHeight（自然 600 + 补偿 300）。
    Object.defineProperty(scroll, "scrollHeight", { configurable: true, writable: true, value: 900 });
    expect(tailCompensationOf(harness)).toBe("300px");

    // 用户在补偿空间内部轻滚（scrollTop 700 → 640，仍 > 自然最大 400）。
    Object.defineProperty(scroll, "scrollTop", { configurable: true, writable: true, value: 640 });
    act(() => {
      viewport().handlers.onScroll({} as React.UIEvent<HTMLDivElement>);
    });

    // 用户尚未到底：补偿必须保留（阅读位置仍受保护），不得抢滚动。
    expect(tailCompensationOf(harness)).toBe("300px");
    expect(scroll.scrollTop).toBe(640);
  });
});
