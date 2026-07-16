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

  it("v2 快照把进行中轮次的已提交文本作为 complete 助手带回时，不得提前关闭本地未完成助手", () => {
    const live: TimelineEvent[] = [{
      id: "user-1", type: "user_message", timestamp: 1, content: "读三个文件",
    }, {
      id: "assistant-live",
      type: "assistant_message",
      timestamp: 2,
      content: "我先读第一个文件。",
      thinking: "先想一下。",
      thinkingParts: [{ id: "tp-1", timestamp: 2, text: "先想一下。" }],
      isThinking: true,
      isComplete: false,
    }];
    const snapshot: TimelineEvent[] = [{
      id: "user-1", type: "user_message", timestamp: 1, content: "读三个文件",
    }, {
      id: "official-assistant-1",
      type: "assistant_message",
      timestamp: 3,
      content: "我先读第一个文件。",
      thinking: "先想一下。",
      isThinking: false,
      isComplete: true,
    }];
    const result = reconcileRunningKimiSnapshot(live, snapshot);
    const assistant = result.find((event) => event.type === "assistant_message");
    expect(assistant).toMatchObject({ id: "assistant-live", isComplete: false });
  });

  it("canonical 当前轮内容更长时按未完成补齐合并，绝不提前关闭；完成态只来自真实 turn 结束", () => {
    const live: TimelineEvent[] = [{
      id: "user-1", type: "user_message", timestamp: 100, content: "继续",
    }, {
      id: "assistant-live",
      type: "assistant_message",
      timestamp: 200,
      content: "我先读第一个文件。",
      thinking: "先想一下。",
      isThinking: true,
      isComplete: false,
    }];
    const snapshot: TimelineEvent[] = [{
      id: "user-1", type: "user_message", timestamp: 100, content: "继续",
    }, {
      id: "official-assistant-1",
      type: "assistant_message",
      timestamp: 300,
      content: "我先读第一个文件。现在读第二个。",
      thinking: "先想一下。再想一下。",
      isThinking: false,
      isComplete: true,
    }];
    const result = reconcileRunningKimiSnapshot(live, snapshot);
    const assistants = result.filter((event) => event.type === "assistant_message");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({ id: "assistant-live", isComplete: false });
    expect(assistants[0].content).toContain("现在读第二个");
    expect(assistants[0].thinking).toContain("再想一下");
  });

  it("旧轮次（最后用户消息之前）的 canonical complete 助手保持历史完成态", () => {
    const live: TimelineEvent[] = [{
      id: "user-old", type: "user_message", timestamp: 50, content: "第一个问题",
    }, {
      id: "assistant-old-live", type: "assistant_message", timestamp: 60, content: "旧回答", isThinking: false, isComplete: true,
    }, {
      id: "user-new", type: "user_message", timestamp: 1000, content: "继续",
    }, {
      id: "assistant-new-live", type: "assistant_message", timestamp: 1100, content: "", isThinking: false, isComplete: false,
    }];
    const snapshot: TimelineEvent[] = [{
      id: "user-old", type: "user_message", timestamp: 50, content: "第一个问题",
    }, {
      id: "official-old", type: "assistant_message", timestamp: 60, content: "旧回答", isThinking: false, isComplete: true,
    }, {
      id: "user-new", type: "user_message", timestamp: 1000, content: "继续",
    }];
    const result = reconcileRunningKimiSnapshot(live, snapshot);
    const old = result.find((event) => event.type === "assistant_message" && event.content === "旧回答");
    expect(old).toMatchObject({ isComplete: true });
  });
});
