// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SubagentEvent, TimelineEvent } from "@/types/ui";
import {
  KIMI_WEB_SUBAGENT_DETAIL_VIEWPORT_HEIGHT_PX,
  KimiWebIntermediateTextBlock,
  KimiWebSubagentDetails,
} from "../MessageBubble";

function makeSubagent(detailCount: number): SubagentEvent {
  const events: TimelineEvent[] = Array.from({ length: detailCount }, (_, index) => ({
    id: `assistant-${index}`,
    type: "assistant_message",
    timestamp: index + 1,
    content: `第 ${index + 1} 条子事件详情`,
    isThinking: false,
    isComplete: true,
  }));
  return {
    id: "subagent-1",
    type: "subagent",
    timestamp: 1,
    agentName: "explore",
    status: "running",
    events,
  };
}

describe("MessageBubble Kimi Web rendering", () => {
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

    expect((container.firstElementChild as HTMLElement).style.whiteSpace).toBe("normal");
    expect(container.querySelector(".kimix-streaming-markdown")).not.toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("文案改动");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("code")?.textContent).toBe("gambler");
    expect(container.textContent).not.toContain("**");
  });

  it("keeps a stable inner viewport from the eighth subagent detail onward", async () => {
    await act(async () => {
      root.render(createElement(KimiWebSubagentDetails, { subagent: makeSubagent(8) }));
    });

    const initialViewport = container.querySelector<HTMLElement>('[aria-label="子任务最新事件"]');
    expect(initialViewport).not.toBeNull();
    expect(initialViewport?.style.height).toBe(`${KIMI_WEB_SUBAGENT_DETAIL_VIEWPORT_HEIGHT_PX}px`);
    expect(initialViewport?.style.overflowY).toBe("auto");

    await act(async () => {
      root.render(createElement(KimiWebSubagentDetails, { subagent: makeSubagent(9) }));
    });

    const updatedViewport = container.querySelector<HTMLElement>('[aria-label="子任务最新事件"]');
    expect(updatedViewport).toBe(initialViewport);
    expect(updatedViewport?.style.height).toBe(`${KIMI_WEB_SUBAGENT_DETAIL_VIEWPORT_HEIGHT_PX}px`);
    expect(updatedViewport?.children).toHaveLength(9);
    expect(container.textContent).toContain("显示全部 9 条子事件（还有 1 条）");
    const showAllButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.startsWith("显示全部"));
    expect(showAllButton?.style.height).toBe("32px");
    expect(showAllButton?.style.whiteSpace).toBe("nowrap");
  });

  it("follows new subagent details only while the inner viewport remains at the bottom", async () => {
    let scrollHeight = 400;
    await act(async () => {
      root.render(createElement(KimiWebSubagentDetails, { subagent: makeSubagent(8) }));
    });

    const viewport = container.querySelector<HTMLElement>('[aria-label="子任务最新事件"]');
    expect(viewport).not.toBeNull();
    Object.defineProperties(viewport!, {
      scrollHeight: { configurable: true, get: () => scrollHeight },
      clientHeight: { configurable: true, get: () => KIMI_WEB_SUBAGENT_DETAIL_VIEWPORT_HEIGHT_PX },
    });

    await act(async () => {
      root.render(createElement(KimiWebSubagentDetails, { subagent: makeSubagent(9) }));
    });
    expect(viewport?.scrollTop).toBe(400);

    viewport!.scrollTop = 80;
    act(() => viewport!.dispatchEvent(new Event("scroll", { bubbles: true })));
    scrollHeight = 500;

    await act(async () => {
      root.render(createElement(KimiWebSubagentDetails, { subagent: makeSubagent(10) }));
    });
    expect(viewport?.scrollTop).toBe(80);
  });

  it("renders subagent approval and question events as read-only detail rows", async () => {
    const subagent: SubagentEvent = {
      id: "subagent-2",
      type: "subagent",
      timestamp: 1,
      agentName: "coder",
      status: "running",
      events: [
        {
          id: "approval-1",
          type: "approval_request",
          timestamp: 2,
          requestId: "call-1",
          toolName: "WriteFile",
          description: "写入 src/config.ts",
          details: "write",
          riskLevel: "high",
          status: "pending",
        },
        {
          id: "question-1",
          type: "question_request",
          timestamp: 3,
          requestId: "ask-1",
          rpcRequestId: "ask-1",
          toolCallId: "call-2",
          questions: [{ id: "q1", question: "继续按方案 A 实施？", options: [] }],
          status: "pending",
        },
      ],
    };

    await act(async () => {
      root.render(createElement(KimiWebSubagentDetails, { subagent }));
    });

    expect(container.textContent).toContain("审批");
    expect(container.textContent).toContain("写入 src/config.ts");
    expect(container.textContent).toContain("提问");
    expect(container.textContent).toContain("继续按方案 A 实施？");
    // 只读展示：不渲染任何可交互的审批/提问按钮
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
