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
});
