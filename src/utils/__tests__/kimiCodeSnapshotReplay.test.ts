import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../../types/ui";
import { shouldSkipKimiCodeSnapshotReplay } from "../kimiCodeSnapshotReplay";

describe("shouldSkipKimiCodeSnapshotReplay", () => {
  it("skips historical assistant snapshot chunks already present in the local timeline", () => {
    const events: TimelineEvent[] = [{
      id: "assistant-1",
      type: "assistant_message",
      timestamp: 1,
      content: "已经恢复的回答",
      isThinking: false,
      isComplete: true,
    }];

    expect(shouldSkipKimiCodeSnapshotReplay({
      snapshotReplay: "history",
      snapshotRole: "assistant",
      snapshotMessageText: "已经恢复的回答",
    }, events)).toBe(true);
  });

  it("keeps missing historical assistant snapshot chunks and all in-flight chunks", () => {
    expect(shouldSkipKimiCodeSnapshotReplay({
      snapshotReplay: "history",
      snapshotRole: "assistant",
      snapshotMessageText: "本地缺失的回答",
    }, [])).toBe(false);
    expect(shouldSkipKimiCodeSnapshotReplay({
      snapshotReplay: "in_flight",
      snapshotRole: "assistant",
      snapshotMessageText: "正在恢复的回答",
    }, [])).toBe(false);
  });

  it("skips historical tool results with the same tool call and output", () => {
    const events: TimelineEvent[] = [{
      id: "tool-1",
      type: "tool_result",
      timestamp: 1,
      toolCallId: "call-1",
      toolName: "Bash",
      result: "工具输出",
    }];

    expect(shouldSkipKimiCodeSnapshotReplay({
      snapshotReplay: "history",
      snapshotRole: "tool",
      snapshotMessageText: "工具输出",
      toolCallId: "call-1",
    }, events)).toBe(true);
  });
});
