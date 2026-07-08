import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import { hasCanonicalKimiThinkingHistory, hasRicherKimiProcessHistory, kimiHistoryProcessEventCount } from "../kimiHistoryCache";

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
