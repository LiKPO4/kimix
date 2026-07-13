import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import { applyCanonicalUndoHistory } from "@/utils/undoHistory";

describe("applyCanonicalUndoHistory", () => {
  it("accepts a shorter official history and drops the withdrawn turn", () => {
    const local: TimelineEvent[] = [{ id: "kept", type: "user_message", timestamp: 1, content: "第一轮" }, {
      id: "withdrawn", type: "user_message", timestamp: 2, content: "撤回这一轮",
    }, {
      id: "old-answer", type: "assistant_message", timestamp: 3, content: "旧回复", isThinking: false, isComplete: true,
    }];
    const canonical: TimelineEvent[] = [{ id: "official-kept", type: "user_message", timestamp: 1, content: "第一轮" }];

    expect(applyCanonicalUndoHistory(local, canonical)).toEqual(canonical);
  });

  it("accepts an empty official history after undoing the first turn", () => {
    const local: TimelineEvent[] = [{ id: "only", type: "user_message", timestamp: 1, content: "唯一一轮" }];
    expect(applyCanonicalUndoHistory(local, [])).toEqual([]);
  });
});
