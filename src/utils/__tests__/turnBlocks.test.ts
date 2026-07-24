import { describe, expect, it } from "vitest";
import { buildRenderItems } from "@/components/chat/ChatThread";
import type { TimelineEvent, ToolCallEvent } from "@/types/ui";
import { buildTurnBlocks, countTurnBlockKind, turnBlocksText, type TurnBlock } from "../turnBlocks";

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

  it("keeps an unmatched Agent call as a plain tool block (historical fallback)", () => {
    const events: TimelineEvent[] = [
      assistant("a1", "正文", "思考"),
      agentTool("tool-agent-x", "call-x", "孤立任务", fixtureTimestamp),
    ];
    const blocks = buildTurnBlocks(events);
    expect(blocks.map((block) => block.kind)).toEqual(["thinking", "text", "tool"]);
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
