import { describe, expect, it } from "vitest";
import { buildRenderItems } from "@/components/chat/ChatThread";
import type { TimelineEvent, ToolCallEvent } from "@/types/ui";
import { buildTurnBlocks, computeFinalTextBlockContent, computeFinalTextBlockIndex, computeStreamingTrailingTextContent, countTurnBlockKind, groupTurnBlocks, mergeLiveDraftBlocks, turnBlocksText, type TurnBlock } from "../turnBlocks";

type AssistantEvent = Extract<TimelineEvent, { type: "assistant_message" }>;
type SubagentEvent = Extract<TimelineEvent, { type: "subagent" }>;

// Fixture mirrors the official wire/snapshot sequence of session
// session_dd37beb3-d8c3-4896-96f1-851519f3ba43's final turn (see
// docs/issue-turn-block-order-events-snapshot.md): five steps, each
// think → text → tool.call(s). Official data stamps the think part and its
// following tool call with the SAME millisecond, so the fixture deliberately
// reuses timestamps to prove ordering comes from array position only.
let fixtureTimestamp = 1784858377300;
function nextTimestamp() {
  fixtureTimestamp += 1;
  return fixtureTimestamp;
}

function assistant(id: string, content: string, thinking?: string, timestamp = nextTimestamp()): AssistantEvent {
  return {
    id,
    type: "assistant_message",
    timestamp,
    content,
    thinking,
    isThinking: false,
    isComplete: true,
    agentTurnId: "turn-1",
  };
}

function agentTool(id: string, toolCallId: string, description: string, timestamp: number): ToolCallEvent {
  return {
    id,
    type: "tool_call",
    timestamp,
    toolCallId,
    toolName: "Agent",
    status: "success",
    arguments: { description, subagent_type: "explore" },
    description,
    result: "子代理结果",
    agentTurnId: "turn-1",
  };
}

function readTool(id: string, toolCallId: string, path: string, timestamp: number): ToolCallEvent {
  return {
    id,
    type: "tool_call",
    timestamp,
    toolCallId,
    toolName: "Read",
    status: "success",
    arguments: { path },
    result: "file body",
    agentTurnId: "turn-1",
  };
}

function subagent(id: string, parentToolCallId: string, description: string, internalOutput: string, timestamp: number): SubagentEvent {
  return {
    id,
    type: "subagent",
    timestamp,
    agentId: id,
    parentToolCallId,
    description,
    agentName: "explore",
    status: "completed",
    agentTurnId: "turn-1",
    events: [
      {
        id: `${id}-inner`,
        type: "assistant_message",
        timestamp,
        content: internalOutput,
        thinking: `${description} 的内部思考`,
        isThinking: false,
        isComplete: true,
      },
    ],
  } as SubagentEvent;
}

function buildOfficialOrderFixture(): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      id: "user-1",
      type: "user_message",
      timestamp: nextTimestamp(),
      content: "1、版本号不同步 2、检查更新卡住与复制失败",
      agentTurnId: "turn-1",
    } as TimelineEvent,
  ];
  // step 1: think → text → 2×Agent（think 与 tool.call 同毫秒，官方数据如此）
  const step1Think = assistant("a1", "你好霖江路。两个问题的调查我拆成两路并行委派。", "思考1：用户报告了两个问题，需要分两路调查。");
  events.push(step1Think);
  const sharedTs1 = step1Think.timestamp;
  events.push(agentTool("tool-agent-1", "call-1", "调查安卓版本号不同步", sharedTs1));
  events.push(agentTool("tool-agent-2", "call-2", "调查安卓两个 bug 根因", sharedTs1));
  events.push(subagent("sub-1", "call-1", "调查安卓版本号不同步", "子代理1内部结论：CURRENT_VERSION 没同步。", nextTimestamp()));
  events.push(subagent("sub-2", "call-2", "调查安卓两个 bug 根因", "子代理2内部结论：超时与复制两处根因。", nextTimestamp()));
  // step 2: think → text → Agent
  events.push(assistant("a2", "你好霖江路。两路调查都拿到了精确根因，我先整合。", "思考2：两个调查子代理返回了详细结论。"));
  const sharedTs2 = fixtureTimestamp;
  events.push(agentTool("tool-agent-3", "call-3", "修复版本同步与两个安卓 bug", sharedTs2));
  events.push(subagent("sub-3", "call-3", "修复版本同步与两个安卓 bug", "子代理3内部输出：已改 4 个文件。", nextTimestamp()));
  // step 3: think → text → 3×Read
  events.push(assistant("a3", "你好霖江路。我来审查修复。", "思考3：coder 完成修复，让我审查。"));
  events.push(readTool("tool-read-1", "call-r1", "src/App.tsx", fixtureTimestamp));
  events.push(readTool("tool-read-2", "call-r2", "docs/release-checklist.md", nextTimestamp()));
  events.push(readTool("tool-read-3", "call-r3", "src-tauri/tauri.properties", nextTimestamp()));
  // step 4: think → text → Agent（续派）
  events.push(assistant("a4", "你好霖江路。抽查确认，还有一处超时要补。", "思考4：抽查结果确认。"));
  events.push(agentTool("tool-agent-4", "call-4", "修正下载路径超时设置", fixtureTimestamp));
  events.push(subagent("sub-4", "call-4", "修正下载路径超时设置", "子代理4内部输出：已补超时。", nextTimestamp()));
  // step 5: think → final text
  events.push(assistant("a5", "你好霖江路。全部完成，最终报告。", "思考5：全部完成。"));
  return events;
}

const EXPECTED_KIND_SEQUENCE = [
  "thinking", "text",
  "subagent", "subagent",
  "thinking", "text",
  "subagent",
  "thinking", "text",
  "tool", "tool", "tool",
  "thinking", "text",
  "subagent",
  "thinking", "text",
];

describe("buildTurnBlocks", () => {
  it("keeps official step order: thinking → text → tools, never timestamp-sorted", () => {
    const blocks = buildTurnBlocks(buildOfficialOrderFixture());
    expect(blocks.map((block) => block.kind)).toEqual(EXPECTED_KIND_SEQUENCE);
  });

  it("keeps each step's text as its own segment in order", () => {
    const blocks = buildTurnBlocks(buildOfficialOrderFixture());
    const texts = blocks.filter((block): block is Extract<TurnBlock, { kind: "text" }> => block.kind === "text");
    expect(texts.map((block) => block.content)).toEqual([
      "你好霖江路。两个问题的调查我拆成两路并行委派。",
      "你好霖江路。两路调查都拿到了精确根因，我先整合。",
      "你好霖江路。我来审查修复。",
      "你好霖江路。抽查确认，还有一处超时要补。",
      "你好霖江路。全部完成，最终报告。",
    ]);
    expect(turnBlocksText(blocks)).toContain("你好霖江路。我来审查修复。");
  });

  it("absorbs Agent dispatch calls into subagent blocks instead of tool blocks", () => {
    const blocks = buildTurnBlocks(buildOfficialOrderFixture());
    const toolBlocks = blocks.filter((block): block is Extract<TurnBlock, { kind: "tool" }> => block.kind === "tool");
    expect(toolBlocks.map((block) => block.tool.toolName)).toEqual(["Read", "Read", "Read"]);
    const subagentBlocks = blocks.filter((block): block is Extract<TurnBlock, { kind: "subagent" }> => block.kind === "subagent");
    expect(subagentBlocks).toHaveLength(4);
    expect(subagentBlocks.every((block) => block.tool?.toolName === "Agent")).toBe(true);
    const counts = countTurnBlockKind(blocks);
    expect(counts).toEqual({ thinking: 5, tools: 3, subagents: 4, approvals: 0 });
  });

  it("synthesizes a task subagent block for an unmatched settled Agent call (restore path)", () => {
    const events: TimelineEvent[] = [
      assistant("a1", "正文", "思考"),
      agentTool("tool-agent-x", "call-x", "孤立任务", fixtureTimestamp),
    ];
    const blocks = buildTurnBlocks(events);
    expect(blocks.map((block) => block.kind)).toEqual(["thinking", "text", "subagent"]);
    const block = blocks[2] as Extract<TurnBlock, { kind: "subagent" }>;
    expect(block.subagent.description).toBe("孤立任务");
    expect(block.subagent.status).toBe("completed");
  });

  it("keeps subagent-internal output out of every top-level text block", () => {
    const blocks = buildTurnBlocks(buildOfficialOrderFixture());
    const joined = turnBlocksText(blocks);
    expect(joined).not.toContain("子代理1内部结论");
    expect(joined).not.toContain("子代理2内部结论");
    expect(joined).not.toContain("内部思考");
  });

  it("does not merge text blocks across a content-less step boundary", () => {
    // Server route emits a content-less assistant_message (step.end /
    // turn.ended) between two text-bearing steps. That boundary must split
    // them into independent text blocks so the final answer stays separated
    // from intermediate body text.
    const events: TimelineEvent[] = [
      assistant("a-step1", "中途正文：先分析一下问题。"),
      assistant("a-step1-end", "", undefined, nextTimestamp()),
      assistant("a-step2", "最终答案：问题已解决。"),
    ];
    const blocks = buildTurnBlocks(events);
    const textBlocks = blocks.filter((b): b is Extract<TurnBlock, { kind: "text" }> => b.kind === "text");
    expect(textBlocks.length).toBe(2);
    expect(textBlocks[0].content).toBe("中途正文：先分析一下问题。");
    expect(textBlocks[1].content).toBe("最终答案：问题已解决。");
  });

  it("still merges adjacent text deltas inside one step", () => {
    // Streaming deltas within the same step (no content-less boundary between
    // them) must keep merging into one text block.
    const events: TimelineEvent[] = [
      assistant("a-delta1", "第一段。"),
      assistant("a-delta2", "第二段。"),
    ];
    const blocks = buildTurnBlocks(events);
    const textBlocks = blocks.filter((b): b is Extract<TurnBlock, { kind: "text" }> => b.kind === "text");
    expect(textBlocks.length).toBe(1);
    expect(textBlocks[0].content).toBe("第一段。\n\n第二段。");
  });
});

describe("buildRenderItems with official-order turn", () => {
  it("never promotes subagent-internal content into the main timeline body", () => {
    const items = buildRenderItems(buildOfficialOrderFixture(), "kimi-code");
    const assistantItems = items.filter((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistantItems.length).toBeGreaterThan(0);
    for (const item of assistantItems) {
      if (item.type !== "event" || item.event.type !== "assistant_message") continue;
      expect(item.event.id).not.toContain(":subagents");
      expect(item.event.content).not.toContain("子代理1内部结论");
      expect(item.event.content).not.toContain("子代理4内部输出");
      expect(item.event.thinking ?? "").not.toContain("内部思考");
    }
  });

  it("never synthesizes a body from subagent output when the main turn has no assistant text", () => {
    const events: TimelineEvent[] = [
      {
        id: "user-1",
        type: "user_message",
        timestamp: nextTimestamp(),
        content: "查一下两个问题",
        agentTurnId: "turn-1",
      } as TimelineEvent,
      agentTool("tool-agent-1", "call-1", "调查问题", nextTimestamp()),
      subagent("sub-1", "call-1", "调查问题", "子代理内部结论：不应出现在主时间线正文。", nextTimestamp()),
    ];
    const items = buildRenderItems(events, "kimi-code");
    for (const item of items) {
      if (item.type !== "event" || item.event.type !== "assistant_message") continue;
      expect(item.event.id).not.toContain(":subagents");
      expect(item.event.content).not.toContain("子代理内部结论");
      expect(item.event.thinking ?? "").not.toContain("内部思考");
    }
  });

  it("attaches ordered turn blocks to the assistant bubble", () => {
    const items = buildRenderItems(buildOfficialOrderFixture(), "kimi-code");
    const bubble = items.find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(bubble && bubble.type === "event" ? bubble.turnBlocks : undefined).toBeDefined();
    const blocks = bubble && bubble.type === "event" ? bubble.turnBlocks ?? [] : [];
    expect(blocks.map((block) => block.kind)).toEqual(EXPECTED_KIND_SEQUENCE);
  });
});

describe("computeFinalTextBlockContent", () => {
  const fullText = "这是完整正文，1060 字符的完整分析结果。";
  const partialText = "中途分析文本";

  function textBlock(content: string, key = "text-1"): TurnBlock {
    return { kind: "text", key, events: [], content };
  }
  function timestampedTextBlock(content: string, timestamp: number, key: string): TurnBlock {
    return {
      kind: "text",
      key,
      events: [assistant(`${key}-event`, content, undefined, timestamp)],
      content,
    };
  }
  function toolBlock(key = "tool-1"): TurnBlock {
    return { kind: "tool", key, tool: { type: "tool_call", toolCallId: "c1", toolName: "Read", timestamp: 1, status: "success", arguments: {} } as never };
  }

  it("returns displayContent when turnBlocks is undefined", () => {
    expect(computeFinalTextBlockContent(undefined, "fallback", true)).toBe("fallback");
  });

  it("returns displayContent when turnBlocks has no text blocks", () => {
    const blocks: TurnBlock[] = [toolBlock()];
    expect(computeFinalTextBlockContent(blocks, "fallback", true)).toBe("fallback");
  });

  it("returns single complete text block content despite trailing tools (P0 bugfix)", () => {
    // Single text block + trailing tools + isComplete=true → show the full text.
    const blocks: TurnBlock[] = [textBlock(fullText), toolBlock(), toolBlock()];
    expect(computeFinalTextBlockContent(blocks, "draft", true)).toBe(fullText);
  });

  it("returns empty string for incomplete single text block with trailing tools", () => {
    // Single text block + trailing tools + isComplete=false → the final answer
    // segment hasn't arrived yet, suppress body.
    const blocks: TurnBlock[] = [textBlock(partialText), toolBlock()];
    expect(computeFinalTextBlockContent(blocks, "draft", false)).toBe("");
  });

  it("returns last text block for complete multi-segment turns even with trailing tools", () => {
    // Complete multi-step turns often have late tools after the final answer
    // (or snapshot recovery re-appends tools). Hiding the body made restart
    // show "输出完成" with no body while local content and official web still
    // had the answer.
    const finalAnswer = "需要你知晓/决策的 3 个点\n\n1. 燃血…";
    const blocks: TurnBlock[] = [
      textBlock("发现两个要点，继续确认…", "text-mid"),
      toolBlock("tool-mid"),
      textBlock(finalAnswer, "text-final"),
      toolBlock("tool-late"),
    ];
    expect(computeFinalTextBlockContent(blocks, "draft", true)).toBe(finalAnswer);
  });

  it("returns last text block content when no trailing process blocks", () => {
    const blocks: TurnBlock[] = [textBlock("中间正文"), textBlock("最终答案")];
    expect(computeFinalTextBlockContent(blocks, "draft", true)).toBe("最终答案");
  });

  it("keeps the chronologically final body when an older stable snapshot is appended late", () => {
    const blocks: TurnBlock[] = [
      timestampedTextBlock("最终完整正文", 300, "text-final"),
      timestampedTextBlock("较早阶段短句", 200, "text-late-replay"),
    ];
    expect(computeFinalTextBlockContent(blocks, "draft", true)).toBe("最终完整正文");
  });

  it("preserves array order for text blocks with the same official timestamp", () => {
    const blocks: TurnBlock[] = [
      timestampedTextBlock("同毫秒第一段", 300, "text-first"),
      timestampedTextBlock("同毫秒第二段", 300, "text-second"),
    ];
    expect(computeFinalTextBlockContent(blocks, "draft", true)).toBe("同毫秒第二段");
  });

  it("aligns the process-timeline skip with the body pick when tools arrive late (trigger A)", () => {
    // 触发 A：最后文本块后还有迟到工具。正文区选中 text-final，过程流也必须
    // 跳过 text-final；旧的"数组最后文本组 + 无尾随 process"启发式会漏跳，
    // 导致同一正文在正文区和过程流各显示一次。
    const blocks: TurnBlock[] = [
      timestampedTextBlock("中段正文", 100, "text-mid"),
      timestampedTextBlock("最终答案", 200, "text-final"),
      toolBlock("tool-late"),
    ];
    expect(computeFinalTextBlockContent(blocks, "draft", true)).toBe("最终答案");
    const finalIndex = computeFinalTextBlockIndex(blocks, true);
    expect(finalIndex).toBe(1);
    const finalKey = blocks[finalIndex].kind === "text" ? blocks[finalIndex].key : undefined;
    // 过程流按 key 跳过的组正是正文区选中的那一块，其余文本组保持可见
    const textGroups = groupTurnBlocks(blocks).filter((group) => group.type === "text");
    expect(textGroups.map((group) => group.key)).toEqual(["text-mid", "text-final"]);
    expect(textGroups.filter((group) => group.key === finalKey)).toHaveLength(1);
    expect(textGroups.filter((group) => group.key !== finalKey).map((group) => group.key)).toEqual(["text-mid"]);
  });

  it("keeps the official final answer visible exactly once when replay appends an older step (trigger B)", () => {
    // 触发 B：回放对账把带旧官方时间戳的 step 追加到数组尾部，"时间戳最大块 ≠
    // 数组最后文本组"。正文区选中时间戳最大块 text-final，过程流按同一身份跳过；
    // 数组尾部的旧 step 留在过程流可见，不再两边都不出现。
    const blocks: TurnBlock[] = [
      timestampedTextBlock("官方最终答案", 300, "text-final"),
      timestampedTextBlock("较早阶段短句", 200, "text-late-replay"),
    ];
    expect(computeFinalTextBlockContent(blocks, "draft", true)).toBe("官方最终答案");
    const finalIndex = computeFinalTextBlockIndex(blocks, true);
    expect(finalIndex).toBe(0);
    const finalKey = blocks[finalIndex].kind === "text" ? blocks[finalIndex].key : undefined;
    const textGroups = groupTurnBlocks(blocks).filter((group) => group.type === "text");
    expect(textGroups.map((group) => group.key)).toEqual(["text-final", "text-late-replay"]);
    expect(textGroups.filter((group) => group.key === finalKey)).toHaveLength(1);
    expect(textGroups.filter((group) => group.key !== finalKey).map((group) => group.key)).toEqual(["text-late-replay"]);
  });

  it("keeps all text segments folded while the turn is streaming (no trailing tools yet)", () => {
    // Streaming turn (isComplete=false) with a text block that is currently the
    // last block: showing it caused a flash-then-fold flip once tools arrived.
    // All segments must stay in the collapsed process timeline while streaming.
    const blocks: TurnBlock[] = [textBlock("你好霖江路，我先全面了解一下项目结构。")];
    expect(computeFinalTextBlockContent(blocks, "draft", false)).toBe("");
  });

  it("keeps all text segments folded while streaming even with tools already present", () => {
    const blocks: TurnBlock[] = [textBlock("预告段"), toolBlock(), textBlock("中段")];
    expect(computeFinalTextBlockContent(blocks, "draft", false)).toBe("");
  });
});

describe("question_request turn blocks", () => {
  it("keeps resolved questions in stream position and skips pending ones", () => {
    const question = (id: string, status: "pending" | "answered"): TimelineEvent => ({
      id,
      type: "question_request",
      timestamp: nextTimestamp(),
      requestId: id,
      rpcRequestId: `${id}-rpc`,
      toolCallId: "call-q",
      questions: [{ id: "q1", question: "反噬打谁？", options: [] }],
      status,
    });
    const events: TimelineEvent[] = [
      assistant("a1", "先分析", "思考"),
      question("q-resolved", "answered"),
      assistant("a2", "继续改"),
      question("q-pending", "pending"),
    ];
    const blocks = buildTurnBlocks(events);
    expect(blocks.map((block) => block.kind)).toEqual(["thinking", "text", "question", "text"]);
    expect(blocks[2]).toMatchObject({ kind: "question", key: "question:q-resolved" });
  });
});

describe("computeStreamingTrailingTextContent", () => {
  it("streams the trailing text segment while the turn is active", () => {
    const blocks = buildTurnBlocks([
      assistant("a1", "中间过渡句", "思考"),
      readTool("tool-1", "call-1", "a.ts", nextTimestamp()),
      assistant("a2", "最终答案的前半"),
    ]);
    expect(computeStreamingTrailingTextContent(blocks)).toBe("最终答案的前半");
  });

  it("keeps the text when only a thinking phase follows it", () => {
    const blocks = buildTurnBlocks([
      assistant("a1", "候选正文", undefined),
      assistant("a2", "", "后续思考"),
    ]);
    expect(computeStreamingTrailingTextContent(blocks)).toBe("候选正文");
  });

  it("demotes the text once a tool, approval, or question follows", () => {
    const withTool = buildTurnBlocks([
      assistant("a1", "过渡句"),
      readTool("tool-1", "call-1", "a.ts", nextTimestamp()),
    ]);
    expect(computeStreamingTrailingTextContent(withTool)).toBe("");
    const withQuestion = buildTurnBlocks([
      assistant("a1", "过渡句"),
      {
        id: "q1",
        type: "question_request",
        timestamp: nextTimestamp(),
        requestId: "q1",
        rpcRequestId: "q1-rpc",
        toolCallId: "call-q",
        questions: [{ id: "q1", question: "继续？", options: [] }],
        status: "answered",
      } as TimelineEvent,
    ]);
    expect(computeStreamingTrailingTextContent(withQuestion)).toBe("");
  });

  it("returns empty for no text and for missing blocks", () => {
    expect(computeStreamingTrailingTextContent(buildTurnBlocks([
      readTool("tool-1", "call-1", "a.ts", nextTimestamp()),
    ]))).toBe("");
    expect(computeStreamingTrailingTextContent(undefined)).toBe("");
  });
});

describe("mergeLiveDraftBlocks", () => {
  it("continues the trailing formal text block with the draft tail", () => {
    const formal = buildTurnBlocks([assistant("a1", "正式前半", "思考")]);
    const merged = mergeLiveDraftBlocks(formal, { textTail: "，尾巴" });
    expect(merged.map((block) => block.kind)).toEqual(["thinking", "text"]);
    expect((merged[1] as Extract<TurnBlock, { kind: "text" }>).content).toBe("正式前半，尾巴");
  });

  it("appends the draft text AFTER a live thinking phase", () => {
    const formal = buildTurnBlocks([assistant("a1", "正式正文")]);
    const merged = mergeLiveDraftBlocks(formal, {
      thinkingBlocks: [{ id: "t1", timestamp: 1, text: "新思考", summary: "新思考" }],
      thinkingBlockKey: "thinking:live:k",
      textTail: "新段落",
      textBlockKey: "text:live:k",
    });
    expect(merged.map((block) => block.kind)).toEqual(["text", "thinking", "text"]);
    expect(merged[1].key).toBe("thinking:live:k");
    expect(merged[2].key).toBe("text:live:k");
    expect((merged[2] as Extract<TurnBlock, { kind: "text" }>).content).toBe("新段落");
  });

  it("starts a new text block when the formal tail is a tool", () => {
    const formal = buildTurnBlocks([
      assistant("a1", "过渡句"),
      readTool("tool-1", "call-1", "a.ts", nextTimestamp()),
    ]);
    const merged = mergeLiveDraftBlocks(formal, { textTail: "新段" });
    expect(merged.map((block) => block.kind)).toEqual(["text", "tool", "text"]);
  });

  it("returns the formal blocks untouched when there is no live content", () => {
    const formal = buildTurnBlocks([assistant("a1", "正文")]);
    expect(mergeLiveDraftBlocks(formal, {})).toEqual(formal);
  });
});

describe("groupTurnBlocks", () => {
  it("keeps each dispatching Agent tool call index-aligned in subagent groups", () => {
    const ts = nextTimestamp();
    const events: TimelineEvent[] = [
      agentTool("tool-agent-1", "call-1", "摸清机制", ts),
      subagent("sub-1", "call-1", "摸清机制", "内部输出", ts),
      agentTool("tool-agent-2", "call-2", "并行二", ts + 1),
      subagent("sub-2", "call-2", "并行二", "内部输出", ts + 1),
    ];
    const groups = groupTurnBlocks(buildTurnBlocks(events));
    expect(groups).toHaveLength(1);
    const group = groups[0];
    if (group.type !== "subagent") throw new Error("expected subagent group");
    expect(group.subagents.map((s) => s.id)).toEqual(["sub-1", "sub-2"]);
    expect(group.tools.map((tool) => tool?.id)).toEqual(["tool-agent-1", "tool-agent-2"]);
  });

  it("exposes the dispatch tool prompt for a single task card", () => {
    const ts = nextTimestamp();
    const dispatch = agentTool("tool-agent-1", "call-1", "摸清机制", ts);
    const events: TimelineEvent[] = [
      dispatch,
      subagent("sub-1", "call-1", "摸清机制", "内部输出", ts),
    ];
    const groups = groupTurnBlocks(buildTurnBlocks(events));
    const group = groups[0];
    if (group.type !== "subagent") throw new Error("expected subagent group");
    expect(group.subagents).toHaveLength(1);
    expect(group.tools[0]?.id).toBe("tool-agent-1");
    expect(group.tools[0]?.arguments).toMatchObject({ description: "摸清机制" });
  });
});

describe("agent dispatch synthesis on restore", () => {
  it("synthesizes a subagent block for a settled Agent call with no subagent event", () => {
    const ts = nextTimestamp();
    const blocks = buildTurnBlocks([
      assistant("a1", "我先委派探索。", "思考"),
      {
        id: "tool-agent-restore",
        type: "tool_call",
        timestamp: ts,
        toolCallId: "call-restore",
        toolName: "Agent",
        status: "success",
        arguments: { description: "摸清机制", prompt: "完整委派指令", subagent_type: "explore" },
        result: "子代理最终报告",
        agentTurnId: "turn-1",
      } as TimelineEvent,
    ]);
    expect(blocks.map((block) => block.kind)).toEqual(["thinking", "text", "subagent"]);
    const block = blocks[2] as Extract<TurnBlock, { kind: "subagent" }>;
    expect(block.subagent).toMatchObject({
      parentToolCallId: "call-restore",
      description: "摸清机制",
      agentName: "explore",
      status: "completed",
      resultSummary: "子代理最终报告",
    });
    expect(block.tool?.id).toBe("tool-agent-restore");
  });

  it("keeps a running unmatched Agent call as a plain tool block (live-safe)", () => {
    const ts = nextTimestamp();
    const blocks = buildTurnBlocks([
      {
        id: "tool-agent-live",
        type: "tool_call",
        timestamp: ts,
        toolCallId: "call-live",
        toolName: "Agent",
        status: "running",
        arguments: { description: "摸清机制", subagent_type: "explore" },
        agentTurnId: "turn-1",
      } as TimelineEvent,
    ]);
    expect(blocks.map((block) => block.kind)).toEqual(["tool"]);
  });

  it("marks a failed Agent dispatch as an errored subagent", () => {
    const ts = nextTimestamp();
    const blocks = buildTurnBlocks([
      {
        id: "tool-agent-failed",
        type: "tool_call",
        timestamp: ts,
        toolCallId: "call-failed",
        toolName: "Agent",
        status: "error",
        arguments: { description: "摸清机制", subagent_type: "explore" },
        result: "Failed to launch: model unavailable",
        agentTurnId: "turn-1",
      } as TimelineEvent,
    ]);
    const block = blocks[0] as Extract<TurnBlock, { kind: "subagent" }>;
    expect(block.subagent.status).toBe("error");
    expect(block.subagent.error).toBe("Failed to launch: model unavailable");
    expect(block.subagent.resultSummary).toBeUndefined();
  });
});
