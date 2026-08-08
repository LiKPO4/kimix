// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SubagentEvent, TimelineEvent, ToolCallEvent } from "@/types/ui";
import {
  KIMI_WEB_SUBAGENT_DETAIL_VIEWPORT_HEIGHT_PX,
  KimiWebIntermediateTextBlock,
  KimiWebProcessList,
  KimiWebSubagentDetails,
  KimiWebSubagentGroupCard,
  KimiWebTaskCard,
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

describe("MessageBubble kimi-web cards stay collapsed unless the user expands them", () => {
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

  function runningTaskFixture() {
    const subagent: SubagentEvent = {
      id: "subagent-1",
      type: "subagent",
      timestamp: 1,
      agentName: "explore",
      description: "集成 C+D 选中主体算法",
      status: "running",
      events: [
        {
          id: "assistant-1",
          type: "assistant_message",
          timestamp: 2,
          content: "第 1 条子事件详情",
          isThinking: false,
          isComplete: true,
        },
      ],
    };
    const tool: ToolCallEvent = {
      id: "tool-1",
      type: "tool_call",
      timestamp: 1,
      toolCallId: "call-1",
      toolName: "Agent",
      status: "running",
      arguments: { prompt: "完整委托 prompt：把选中主体算法集成到 C+D 模块" },
      agentTurnId: "turn-1",
    };
    return { subagent, tool };
  }

  it("keeps a running task card collapsed on mount, expanding only on user click (falsifies old auto-expand)", async () => {
    const { subagent, tool } = runningTaskFixture();
    await act(async () => {
      root.render(createElement(KimiWebTaskCard, { subagent, tool }));
    });

    // 旧实现 useState(isRunning)：running 子代理挂载即展开，prompt 全文直接铺开。
    expect(container.textContent).not.toContain("完整委托 prompt");
    const header = container.querySelector("button");
    expect(header).not.toBeNull();
    act(() => header!.click());
    expect(container.textContent).toContain("完整委托 prompt");
  });

  it("keeps a completed task card collapsed (result summary only after user click)", async () => {
    const { subagent, tool } = runningTaskFixture();
    await act(async () => {
      root.render(createElement(KimiWebTaskCard, {
        subagent: { ...subagent, status: "completed", resultSummary: "C+D 集成总结：全部通过" },
        tool,
      }));
    });

    expect(container.textContent).not.toContain("C+D 集成总结：全部通过");
    act(() => container.querySelector("button")!.click());
    expect(container.textContent).toContain("C+D 集成总结：全部通过");
  });

  it("keeps a Swarm group card collapsed while subagents are active (falsifies old auto-expand)", async () => {
    const running = (id: string, agentName: string): SubagentEvent => ({
      id,
      type: "subagent",
      timestamp: 1,
      agentName,
      status: "running",
      events: [],
    });
    await act(async () => {
      root.render(createElement(KimiWebSubagentGroupCard, {
        subagents: [running("s1", "explore"), running("s2", "coder")],
      }));
    });

    // 旧实现 useState(activeCount > 0)：挂载即展开整张子代理行列表。
    expect(container.textContent).not.toContain("explore");
    act(() => container.querySelector("button")!.click());
    expect(container.textContent).toContain("explore");
    expect(container.textContent).toContain("coder");
  });

  it("expanding the parent process list only reveals entries: inner subagent/tool cards stay collapsed", async () => {
    const { subagent, tool } = runningTaskFixture();
    const runningTool: ToolCallEvent = {
      ...tool,
      id: "tool-2",
      toolCallId: "call-2",
      toolName: "Bash",
      // 不带 prompt 参数：工具行折叠态的 header 会显示参数预览（displayTarget），
      // 用 result 文本断言工具行折叠才可靠。
      arguments: { command: "npm test" },
      result: "工具输出内容：npm test 全部通过",
    };
    await act(async () => {
      root.render(createElement(KimiWebProcessList, {
        items: [
          { type: "subagent", subagent },
          { type: "tool", tool: runningTool },
        ],
        isActiveAssistant: true,
      }));
    });

    expect(container.textContent).not.toContain("第 1 条子事件详情");
    expect(container.textContent).not.toContain("工具输出内容：npm test 全部通过");
    // 父级展开只露出条目列表；对任务卡自己的操作才展开其详情。
    act(() => container.querySelector("button")!.click());
    expect(container.textContent).toContain("第 1 条子事件详情");
  });
});

