import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import { settleInactiveEvents } from "../eventHelpers";

describe("eventHelpers", () => {
  it("keeps assistant messages that only have thinking parts when settling", () => {
    const events: TimelineEvent[] = [{
      id: "assistant-1",
      type: "assistant_message",
      timestamp: 1,
      content: "",
      thinkingParts: [{ id: "think-1", timestamp: 1, text: "分析项目结构" }],
      isThinking: true,
      isComplete: false,
    }];

    const settled = settleInactiveEvents(events);
    expect(settled).toHaveLength(1);
    const assistant = settled[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(assistant.isComplete).toBe(true);
    expect(assistant.isThinking).toBe(false);
    expect(assistant.thinkingParts?.[0]?.text).toBe("分析项目结构");
  });
});
