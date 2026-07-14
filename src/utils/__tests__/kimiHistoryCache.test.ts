import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import { hasCanonicalKimiThinkingHistory, hasLegacyKimiClarificationWrapper, hasRicherKimiProcessHistory, KIMI_HISTORY_CACHE_VERSION, kimiHistoryProcessEventCount } from "../kimiHistoryCache";

const assistant: TimelineEvent = {
  id: "assistant",
  type: "assistant_message",
  timestamp: 1,
  content: "done",
  isThinking: false,
  isComplete: true,
};

const tool: TimelineEvent = {
  id: "tool",
  type: "tool_call",
  timestamp: 2,
  toolCallId: "tool-1",
  toolName: "ReadFile",
  status: "success",
  arguments: {},
};

describe("Kimi history cache migration", () => {
  it("uses cache version 5 for canonical room binding and history repair across every entry point", () => {
    expect(KIMI_HISTORY_CACHE_VERSION).toBe(5);
  });

  it("detects both generations of legacy clarification wrappers in cached user messages", () => {
    const wrapped = (content: string): TimelineEvent => ({
      id: content,
      type: "user_message",
      timestamp: 1,
      content,
    });
    expect(hasLegacyKimiClarificationWrapper([wrapped("【Kimix 需求澄清：自动判断】\n用户原始需求：\n你好")])).toBe(true);
    expect(hasLegacyKimiClarificationWrapper([wrapped("【Kimix 需求澄清工具：开启】\n用户原始需求：\n你好")])).toBe(true);
    expect(hasLegacyKimiClarificationWrapper([wrapped("你好")])).toBe(false);
  });

  it("prefers canonical history when old cache lost process events", () => {
    expect(kimiHistoryProcessEventCount([assistant])).toBe(0);
    expect(kimiHistoryProcessEventCount([assistant, tool])).toBe(1);
    expect(hasRicherKimiProcessHistory([assistant], [assistant, tool])).toBe(true);
  });

  it("does not replace a richer local process timeline", () => {
    expect(hasRicherKimiProcessHistory([assistant, tool], [assistant])).toBe(false);
    expect(hasRicherKimiProcessHistory([assistant], [])).toBe(false);
  });

  it("prefers canonical thinking when the local mirror duplicated a thought", () => {
    const thought = "Detailed reasoning.\n\nFinal summary.";
    const canonical: TimelineEvent[] = [{
      ...assistant,
      thinking: thought,
      thinkingParts: [{ id: "official-think", timestamp: 1, text: thought }],
    }];
    const cached: TimelineEvent[] = [{
      ...assistant,
      thinking: thought + thought,
      thinkingParts: [
        { id: "cached-think-1", timestamp: 1, text: thought },
        { id: "cached-think-2", timestamp: 2, text: thought },
      ],
    }];

    expect(hasCanonicalKimiThinkingHistory(cached, canonical)).toBe(true);
    expect(hasCanonicalKimiThinkingHistory(canonical, canonical)).toBe(false);
  });

  it("prefers canonical thinking when a cached Chinese list lost its line breaks", () => {
    const canonicalThought = [
      "截图中可见的物品（后期）：",
      "- 超燃蛋小黄物品 1074667572",
      "- 月薪喵物品 1074745391",
      "",
      "早期物品（看不到的）：",
      "- 木哑铃物品 1073913963",
      "- 大理石哑铃物品 1073918025",
    ].join("\n");
    const cachedThought = canonicalThought.replace(/\n(?=- )/g, "");
    const canonical: TimelineEvent[] = [{
      ...assistant,
      thinking: canonicalThought,
      thinkingParts: [{ id: "official-list", timestamp: 1, text: canonicalThought }],
    }];
    const cached: TimelineEvent[] = [{
      ...assistant,
      thinking: cachedThought,
      thinkingParts: [{ id: "cached-list", timestamp: 1, text: cachedThought }],
    }];

    expect(cachedThought).toContain("1074667572- 月薪喵物品");
    expect(hasCanonicalKimiThinkingHistory(cached, canonical)).toBe(true);
  });

  it("ignores subagent-internal thinking when deciding top-level thinking migration", () => {
    // 顶层 assistant 无思考；子代理内部有思考。当前实现只扫描顶层
    // assistant_message，因此不触发迁移判断（整体替换仍会带走子代理）。
    const cachedWithSubagentThought: TimelineEvent[] = [{
      ...assistant,
      content: "",
    }, {
      id: "sub",
      type: "subagent",
      timestamp: 2,
      agentId: "agent-1",
      agentName: "子代理",
      status: "completed",
      events: [{
        ...assistant,
        id: "sub-assistant",
        thinking: "sub thought",
        thinkingParts: [{ id: "sub-think", timestamp: 2, text: "sub thought" }],
      }],
    }];
    const canonicalEmpty: TimelineEvent[] = [{ ...assistant, content: "" }];

    expect(hasCanonicalKimiThinkingHistory(cachedWithSubagentThought, canonicalEmpty)).toBe(false);
  });
});
