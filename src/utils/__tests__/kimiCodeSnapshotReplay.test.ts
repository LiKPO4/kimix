import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../../types/ui";
import { reconcileRunningKimiSnapshot, shouldSkipKimiCodeSnapshotReplay } from "../kimiCodeSnapshotReplay";

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

  it("does not let a historical turn end close a new local assistant placeholder", () => {
    const events: TimelineEvent[] = [{
      id: "user-new",
      type: "user_message",
      timestamp: 8,
      content: "新问题",
    }, {
      id: "status-new",
      type: "status_update",
      timestamp: 9,
      message: "消息发送中",
      source: "ipc",
      parentEventId: "user-new",
    }, {
      id: "assistant-pending",
      type: "assistant_message",
      timestamp: 10,
      content: "",
      isThinking: false,
      isComplete: false,
    }];

    expect(shouldSkipKimiCodeSnapshotReplay({
      type: "turn.ended",
      snapshotReplay: "history",
      snapshotRole: "assistant",
    }, events)).toBe(true);
  });
});

describe("reconcileRunningKimiSnapshot", () => {
  const pendingTurn: TimelineEvent[] = [{
    id: "user-new", type: "user_message", timestamp: 8, content: "新问题",
  }, {
    id: "status-new", type: "status_update", timestamp: 9, message: "消息发送中", source: "ipc", parentEventId: "user-new",
  }, {
    id: "assistant-pending", type: "assistant_message", timestamp: 10, content: "", isThinking: false, isComplete: false,
  }];

  it("keeps the local assistant header when a running snapshot has not recorded it yet", () => {
    const snapshot: TimelineEvent[] = [{
      id: "official-user", type: "user_message", timestamp: 8, content: "新问题",
    }];
    const result = reconcileRunningKimiSnapshot(pendingTurn, snapshot);
    expect(result.filter((event) => event.type === "user_message")).toHaveLength(1);
    expect(result.find((event) => event.id === "assistant-pending")).toMatchObject({ isComplete: false });
  });

  it("merges an in-flight official assistant into the mounted local row", () => {
    const snapshot: TimelineEvent[] = [{
      id: "official-assistant", type: "assistant_message", timestamp: 11, content: "处理中", isThinking: false, isComplete: false,
    }];
    const result = reconcileRunningKimiSnapshot(pendingTurn, snapshot);
    expect(result.at(-1)).toMatchObject({ id: "assistant-pending", content: "处理中", isComplete: false });
  });

  it("retains stable ids for historical rows across repeated snapshots", () => {
    const local: TimelineEvent[] = [{
      id: "mounted-assistant", type: "assistant_message", timestamp: 1, content: "旧回复", isThinking: false, isComplete: true,
    }];
    const snapshot: TimelineEvent[] = [{
      id: "remapped-assistant", type: "assistant_message", timestamp: 1, content: "旧回复", isThinking: false, isComplete: true,
    }];
    expect(reconcileRunningKimiSnapshot(local, snapshot)).toEqual(local);
  });
});
