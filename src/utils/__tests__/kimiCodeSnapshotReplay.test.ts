import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "../../types/ui";
import { reconcileRunningKimiSnapshot, shouldSkipKimiCodeSnapshotReplay } from "../kimiCodeSnapshotReplay";

describe("shouldSkipKimiCodeSnapshotReplay", () => {
  it("skips historical assistant snapshot chunks already present in the local timeline", () => {
    const events: TimelineEvent[] = [{
      id: "assistant-1",
      type: "assistant_message",
      timestamp: 1,
      snapshotMessageId: "msg-assistant-1",
      snapshotMessageIdStable: true,
      content: "已经恢复的回答",
      isThinking: false,
      isComplete: true,
    }];

    expect(shouldSkipKimiCodeSnapshotReplay({
      snapshotReplay: "history",
      snapshotRole: "assistant",
      snapshotMessageId: "msg-assistant-1",
      snapshotMessageIdStable: true,
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

  it("does not skip a later-turn assistant merely because an older turn contains the same text", () => {
    const events: TimelineEvent[] = [{
      id: "user-old", type: "user_message", timestamp: 100, content: "旧问题",
    }, {
      id: "assistant-old", type: "assistant_message", timestamp: 200,
      content: "前文。可以。后文。", isThinking: false, isComplete: true,
    }, {
      id: "user-new", type: "user_message", timestamp: 1000, content: "新问题",
    }];

    expect(shouldSkipKimiCodeSnapshotReplay({
      type: "assistant.delta",
      snapshotReplay: "history",
      snapshotRole: "assistant",
      snapshotMessageId: "msg-new-assistant",
      snapshotMessageText: "可以。",
      created_at: 1100,
    }, events)).toBe(false);
  });

  it("does not trust a body-derived snapshot id without a turn timestamp", () => {
    const events: TimelineEvent[] = [{
      id: "assistant-old", type: "assistant_message", timestamp: 200,
      snapshotMessageId: "assistant:可以。", snapshotMessageIdStable: false,
      content: "可以。", isThinking: false, isComplete: true,
    }];

    expect(shouldSkipKimiCodeSnapshotReplay({
      type: "assistant.delta",
      snapshotReplay: "history",
      snapshotRole: "assistant",
      snapshotMessageId: "assistant:可以。",
      snapshotMessageIdStable: false,
      snapshotMessageText: "可以。",
    }, events)).toBe(false);
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

  it("does not let a historical turn end close a non-empty assistant while the runtime is active", () => {
    const events: TimelineEvent[] = [{
      id: "user-live",
      type: "user_message",
      timestamp: 8,
      content: "继续检查",
    }, {
      id: "assistant-live",
      type: "assistant_message",
      timestamp: 10,
      content: "已经完成第一步。",
      thinking: "继续读取剩余文件。",
      isThinking: true,
      isComplete: false,
    }];

    const historicalTurnEnd = {
      type: "turn.ended",
      snapshotReplay: "history",
      snapshotRole: "assistant",
    };
    expect(shouldSkipKimiCodeSnapshotReplay(historicalTurnEnd, events, true)).toBe(true);
    expect(shouldSkipKimiCodeSnapshotReplay(historicalTurnEnd, events, false)).toBe(false);
  });

  it("allows an older identified history turn to settle while a newer turn is active", () => {
    const events: TimelineEvent[] = [{
      id: "assistant-old",
      type: "assistant_message",
      timestamp: 200,
      snapshotMessageId: "msg-old",
      snapshotMessageIdStable: true,
      content: "旧回答",
      isThinking: false,
      isComplete: false,
    }, {
      id: "user-new",
      type: "user_message",
      timestamp: 1_000,
      content: "新问题",
    }, {
      id: "assistant-new",
      type: "assistant_message",
      timestamp: 1_100,
      snapshotMessageId: "msg-new",
      snapshotMessageIdStable: true,
      content: "新回答",
      isThinking: false,
      isComplete: false,
    }];

    expect(shouldSkipKimiCodeSnapshotReplay({
      type: "turn.ended",
      snapshotReplay: "history",
      snapshotRole: "assistant",
      snapshotMessageId: "msg-old",
      snapshotMessageIdStable: true,
      created_at: 220,
    }, events, true)).toBe(false);
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

describe("reconcileRunningKimiSnapshot user replay dedup", () => {
  it("does not re-append snapshot user history on repeated replays", () => {
    // Replay ids are deterministic; before the guard, every replay appended the
    // full user history again and eventually flooded the render window.
    const snapshot: TimelineEvent[] = [{
      id: "snapshot:msg_u1:user:0", type: "user_message", timestamp: 100, content: "第一个问题",
    }, {
      id: "snapshot:msg_u2:user:0", type: "user_message", timestamp: 5000, content: "第二个问题",
    }, {
      id: "assistant-1", type: "assistant_message", timestamp: 5100, content: "回答", isThinking: false, isComplete: true,
    }];
    const once = reconcileRunningKimiSnapshot([], snapshot);
    const twice = reconcileRunningKimiSnapshot(once, snapshot);
    const thrice = reconcileRunningKimiSnapshot(twice, snapshot);
    expect(thrice.filter((event) => event.type === "user_message")).toHaveLength(2);
    expect(thrice.filter((event) => event.type === "assistant_message")).toHaveLength(1);
  });

  it("does not duplicate a local optimistic user when its snapshot echo arrives", () => {
    const live: TimelineEvent[] = [{
      id: "local-user", type: "user_message", timestamp: 1000, content: "本地发送的问题",
    }];
    const snapshot: TimelineEvent[] = [{
      id: "snapshot:msg_u9:user:0", type: "user_message", timestamp: 1001, content: "本地发送的问题",
    }, {
      id: "assistant-1", type: "assistant_message", timestamp: 1100, content: "回答", isThinking: false, isComplete: true,
    }];
    const result = reconcileRunningKimiSnapshot(live, snapshot);
    expect(result.filter((event) => event.type === "user_message")).toHaveLength(1);
    expect(result.filter((event) => event.type === "user_message")[0].id).toBe("local-user");
  });
});

describe("reconcileRunningKimiSnapshot cross-turn pollution guard", () => {
  it("does not merge an older-turn assistant into the current turn placeholder", () => {
    // The current turn has an open placeholder; the snapshot carries an older
    // turn's completed assistant. mergeEvents would append it into the
    // placeholder and replace its content — the exact "一轮夹杂多轮" pollution.
    const live: TimelineEvent[] = [{
      id: "user-old", type: "user_message", timestamp: 100, content: "第一个问题",
    }, {
      id: "assistant-old", type: "assistant_message", timestamp: 110, content: "旧回答", isThinking: false, isComplete: true,
    }, {
      id: "user-new", type: "user_message", timestamp: 1000, content: "新问题",
    }, {
      id: "placeholder", type: "assistant_message", timestamp: 1001, content: "", isThinking: false, isComplete: false,
    }];
    const snapshot: TimelineEvent[] = [{
      id: "snapshot:msg_old:assistant:0", type: "assistant_message", timestamp: 120, content: "另一段旧轮回复", isThinking: false, isComplete: true,
    }];
    const result = reconcileRunningKimiSnapshot(live, snapshot);
    const placeholder = result.find((event) => event.id === "placeholder");
    expect(placeholder).toMatchObject({ content: "", isComplete: false });
    const older = result.find((event) => event.id === "snapshot:msg_old:assistant:0");
    expect(older).toBeDefined();
  });

  it("skips a clean replay body already contained in a locally complete assistant", () => {
    const live: TimelineEvent[] = [{
      id: "user-old", type: "user_message", timestamp: 100, content: "旧问题",
    }, {
      id: "assistant-merged", type: "assistant_message", timestamp: 110,
      content: "开场白。最终总结全文。", isThinking: false, isComplete: true,
    }];
    const snapshot: TimelineEvent[] = [{
      id: "snapshot:user-old:user:0", type: "user_message", timestamp: 100, content: "旧问题",
    }, {
      id: "snapshot:msg_a:assistant:0", type: "assistant_message", timestamp: 120,
      content: "最终总结全文。", isThinking: false, isComplete: true,
    }];
    const result = reconcileRunningKimiSnapshot(live, snapshot);
    expect(result.filter((event) => event.type === "assistant_message")).toHaveLength(1);
  });

  it("preserves a later-turn short assistant even when an older assistant contains its body", () => {
    const live: TimelineEvent[] = [{
      id: "user-old", type: "user_message", timestamp: 100, content: "旧问题",
    }, {
      id: "assistant-old", type: "assistant_message", timestamp: 200,
      content: "前文。可以。后文。", isThinking: false, isComplete: true,
    }, {
      id: "user-new", type: "user_message", timestamp: 1000, content: "新问题",
    }];
    const snapshot: TimelineEvent[] = [{
      id: "snapshot:user-new:user:0", type: "user_message", timestamp: 1000, content: "新问题",
    }, {
      id: "snapshot:assistant-new:assistant:0", type: "assistant_message", timestamp: 1100,
      content: "可以。", isThinking: false, isComplete: true,
    }];

    const result = reconcileRunningKimiSnapshot(live, snapshot);
    expect(result.filter((event) => event.type === "assistant_message").map((event) => event.content))
      .toEqual(["前文。可以。后文。", "可以。"]);
  });
});

describe("reconcileRunningKimiSnapshot chronological order", () => {
  it("reorders replayed older history into chronological position instead of the tail", () => {
    const live: TimelineEvent[] = [{
      id: "user-new", type: "user_message", timestamp: 1000, content: "新问题",
    }, {
      id: "placeholder", type: "assistant_message", timestamp: 1001, content: "", isThinking: false, isComplete: false,
    }];
    const snapshot: TimelineEvent[] = [{
      id: "snapshot:msg_u:user:0", type: "user_message", timestamp: 100, content: "旧问题",
    }, {
      id: "snapshot:msg_a:assistant:0", type: "assistant_message", timestamp: 110, content: "旧回答", isThinking: false, isComplete: true,
    }];
    const result = reconcileRunningKimiSnapshot(live, snapshot);
    const timestamps = result.map((event) => event.timestamp);
    expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps);
    expect(result[0].id).toBe("snapshot:msg_u:user:0");
    expect(result[1].id).toBe("snapshot:msg_a:assistant:0");
    expect(result[2].id).toBe("user-new");
  });

  it("interleaves older replay rows without reordering mounted local causality", () => {
    const live: TimelineEvent[] = [{
      id: "user-current", type: "user_message", timestamp: 1000, content: "当前问题",
    }, {
      // A recovered timestamp may regress even though this row causally follows
      // the user message. Local array order must remain authoritative.
      id: "assistant-current", type: "assistant_message", timestamp: 900,
      content: "当前回答", isThinking: false, isComplete: true,
    }];
    const snapshot: TimelineEvent[] = [{
      id: "snapshot:user-old:user:0", type: "user_message", timestamp: 950, content: "旧问题",
    }, {
      id: "snapshot:assistant-old:assistant:0", type: "assistant_message", timestamp: 960,
      content: "旧回答", isThinking: false, isComplete: true,
    }];

    const result = reconcileRunningKimiSnapshot(live, snapshot);
    expect(result.map((event) => event.id)).toEqual([
      "snapshot:user-old:user:0",
      "snapshot:assistant-old:assistant:0",
      "user-current",
      "assistant-current",
    ]);
  });
});

describe("reconcileRunningKimiSnapshot missing user boundary", () => {
  it("does not downgrade a canonical completed Assistant into an orphan placeholder", () => {
    const local: TimelineEvent[] = [{
      id: "local-complete", type: "assistant_message", timestamp: 100,
      content: "已完成回答", isThinking: false, isComplete: true,
    }, {
      id: "orphan-placeholder", type: "assistant_message", timestamp: 200,
      content: "", isThinking: false, isComplete: false,
    }];
    const snapshot: TimelineEvent[] = [{
      id: "snapshot:msg-complete:assistant:0", type: "assistant_message", timestamp: 100,
      content: "已完成回答", isThinking: false, isComplete: true,
    }];

    const result = reconcileRunningKimiSnapshot(local, snapshot);
    expect(result.filter((event) => event.type === "assistant_message")).toHaveLength(2);
    expect(result.find((event) => event.id === "local-complete")).toMatchObject({ isComplete: true });
    expect(result.find((event) => event.id === "orphan-placeholder")).toMatchObject({
      content: "",
      isComplete: false,
    });
  });
});
