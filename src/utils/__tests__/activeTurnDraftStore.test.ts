import { describe, expect, it, beforeEach } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import {
  appendStreamingText,
  applyActiveTurnDraftDelta,
  clearActiveTurnDraft,
  clearActiveTurnDraftsForSession,
  draftToAssistantEvent,
  getActiveTurnDraft,
  isAuthoritativeAssistantBodyEvent,
  makeActiveTurnDraftKey,
  pickDraftText,
  resetActiveTurnDraftStoreForTests,
  subscribeActiveTurnDraft,
  takeActiveTurnDraft,
} from "../activeTurnDraftStore";

function delta(content: string, patch: Partial<Extract<TimelineEvent, { type: "assistant_message" }>> = {}): Extract<TimelineEvent, { type: "assistant_message" }> {
  return {
    id: patch.id ?? "delta-1",
    type: "assistant_message",
    timestamp: patch.timestamp ?? 1,
    content,
    thinking: patch.thinking,
    thinkingParts: patch.thinkingParts,
    isThinking: Boolean(patch.thinking),
    isComplete: false,
    agentTurnId: patch.agentTurnId ?? "turn-1",
    roomAgentId: patch.roomAgentId ?? "agent-1",
    roomMessageId: patch.roomMessageId ?? "msg-1",
    ...patch,
  };
}

describe("activeTurnDraftStore", () => {
  beforeEach(() => {
    resetActiveTurnDraftStoreForTests();
  });

  it("appends content and thinking deltas per turn key", () => {
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    applyActiveTurnDraftDelta(key, delta("你好"));
    applyActiveTurnDraftDelta(key, delta("世界", { thinking: "想一下" }));
    applyActiveTurnDraftDelta(key, delta("", { thinking: "再想" }));

    expect(getActiveTurnDraft(key)).toMatchObject({
      content: "你好世界",
      thinking: "想一下再想",
      revision: 3,
      agentTurnId: "turn-1",
    });
  });

  it("isolates drafts by session/agent/turn", () => {
    const a = makeActiveTurnDraftKey("s1", "agent-a", "turn-1");
    const b = makeActiveTurnDraftKey("s1", "agent-b", "turn-1");
    const c = makeActiveTurnDraftKey("s1", "agent-a", "turn-2");
    applyActiveTurnDraftDelta(a, delta("A"));
    applyActiveTurnDraftDelta(b, delta("B"));
    applyActiveTurnDraftDelta(c, delta("C", { roomMessageId: "msg-2" }));

    expect(getActiveTurnDraft(a)?.content).toBe("A");
    expect(getActiveTurnDraft(b)?.content).toBe("B");
    expect(getActiveTurnDraft(c)?.content).toBe("C");
  });

  it("rekeys one room message draft without reversing text when the turn identity changes", () => {
    const optimisticKey = makeActiveTurnDraftKey("s1", "agent-1", "turn-local");
    const officialKey = makeActiveTurnDraftKey("s1", "agent-1", "turn-official");

    applyActiveTurnDraftDelta(optimisticKey, delta("你好", {
      agentTurnId: "turn-local",
      roomMessageId: "room-message-1",
    }));
    applyActiveTurnDraftDelta(officialKey, delta("霖江路。我会补上焦点归还。", {
      agentTurnId: "turn-official",
      roomMessageId: "room-message-1",
    }));

    expect(getActiveTurnDraft(optimisticKey)).toBeNull();
    expect(getActiveTurnDraft(officialKey)).toMatchObject({
      content: "你好霖江路。我会补上焦点归还。",
      agentTurnId: "turn-official",
      roomMessageId: "room-message-1",
      revision: 2,
    });
  });

  it("take clears the draft and returns a commit snapshot", () => {
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    applyActiveTurnDraftDelta(key, delta("正文", { thinking: "思考" }));
    const taken = takeActiveTurnDraft(key);
    expect(taken).toMatchObject({ content: "正文", thinking: "思考" });
    expect(getActiveTurnDraft(key)).toBeNull();
    expect(draftToAssistantEvent(key, taken!).content).toBe("正文");
  });

  it("clears all drafts for a session", () => {
    applyActiveTurnDraftDelta(makeActiveTurnDraftKey("s1", "a", "t1"), delta("1"));
    applyActiveTurnDraftDelta(makeActiveTurnDraftKey("s1", "b", "t2"), delta("2"));
    applyActiveTurnDraftDelta(makeActiveTurnDraftKey("s2", "a", "t1"), delta("3"));
    clearActiveTurnDraftsForSession("s1");
    expect(getActiveTurnDraft(makeActiveTurnDraftKey("s1", "a", "t1"))).toBeNull();
    expect(getActiveTurnDraft(makeActiveTurnDraftKey("s1", "b", "t2"))).toBeNull();
    expect(getActiveTurnDraft(makeActiveTurnDraftKey("s2", "a", "t1"))?.content).toBe("3");
  });

  it("batches delta notifications to one per frame", async () => {
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    let calls = 0;
    const unsubscribe = subscribeActiveTurnDraft(key, () => { calls += 1; });
    applyActiveTurnDraftDelta(key, delta("你"));
    applyActiveTurnDraftDelta(key, delta("好"));
    applyActiveTurnDraftDelta(key, delta("世"));
    expect(calls).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls).toBe(1);
    expect(getActiveTurnDraft(key)?.content).toBe("你好世");
    unsubscribe();
  });

  it("take delivers pending notifications synchronously", () => {
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    let calls = 0;
    const unsubscribe = subscribeActiveTurnDraft(key, () => { calls += 1; });
    applyActiveTurnDraftDelta(key, delta("正文"));
    const taken = takeActiveTurnDraft(key);
    expect(taken?.content).toBe("正文");
    expect(calls).toBeGreaterThanOrEqual(1);
    unsubscribe();
  });

  it("accumulates thinking parts across append-only deltas", () => {
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    applyActiveTurnDraftDelta(key, delta("", { thinkingParts: [{ id: "p1", timestamp: 1, text: "第一段" }] }));
    applyActiveTurnDraftDelta(key, delta("", { thinkingParts: [{ id: "p2", timestamp: 2, text: "第二段" }] }));
    expect(getActiveTurnDraft(key)?.thinkingParts?.map((part) => part.text)).toEqual(["第一段", "第二段"]);
  });

  it("does not duplicate thinking parts when a cumulative frame supersedes its fragments", () => {
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    applyActiveTurnDraftDelta(key, delta("", { thinkingParts: [{ id: "p1", timestamp: 1, text: "第一步：读取配置。" }] }));
    applyActiveTurnDraftDelta(key, delta("", { thinkingParts: [{ id: "p2", timestamp: 2, text: "第二步：汇总结果。" }] }));
    // Full replay of the same thought: supersedes both fragments in place.
    applyActiveTurnDraftDelta(key, delta("", { thinkingParts: [{ id: "p3", timestamp: 3, text: "第一步：读取配置。第二步：汇总结果。" }] }));
    // A late fragment already covered by the full frame is skipped.
    applyActiveTurnDraftDelta(key, delta("", { thinkingParts: [{ id: "p4", timestamp: 4, text: "第一步：读取配置。" }] }));
    expect(getActiveTurnDraft(key)?.thinkingParts?.map((part) => part.text))
      .toEqual(["第一步：读取配置。第二步：汇总结果。"]);
  });

  it("does not duplicate thinking text when a cumulative replay follows fragments", () => {
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    applyActiveTurnDraftDelta(key, delta("", { thinking: "先读配置。" }));
    applyActiveTurnDraftDelta(key, delta("", { thinking: "先读配置。\n再汇总。" }));
    // Same thought replayed with whitespace drift only.
    applyActiveTurnDraftDelta(key, delta("", { thinking: "先读配置。 再汇总。" }));
    expect(getActiveTurnDraft(key)?.thinking).toBe("先读配置。\n再汇总。");
  });

  it("pickDraftText prefers the longer snapshot", () => {
    expect(pickDraftText("hello world", "hello")).toBe("hello world");
    expect(pickDraftText("hi", "hello")).toBe("hello");
    expect(pickDraftText(undefined, "event")).toBe("event");
  });

  it("appendStreamingText does not double cumulative frames and keeps pure deltas", () => {
    expect(appendStreamingText("你好霖江路", "你好霖江路\n\n本轮目标")).toBe("你好霖江路\n\n本轮目标");
    expect(appendStreamingText("你好", "世界")).toBe("你好世界");
    expect(appendStreamingText("Hel", "lo")).toBe("Hello");
  });

  it("does not double greeting when cumulative content.part frames arrive as draft deltas", () => {
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    applyActiveTurnDraftDelta(key, delta("你好霖江路"));
    applyActiveTurnDraftDelta(key, delta("你好霖江路\n\n接手中：先读 TASK_STATE.md"));
    applyActiveTurnDraftDelta(key, delta("你好霖江路\n\n接手中：先读 TASK_STATE.md\n\n## 本轮目标"));
    const content = getActiveTurnDraft(key)?.content ?? "";
    expect(content.startsWith("你好霖江路")).toBe(true);
    expect(content.match(/你好霖江路/g)?.length).toBe(1);
    expect(content).toContain("## 本轮目标");
  });

  it("assembles thinking by stream offset and skips duplicated tails", () => {
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    applyActiveTurnDraftDelta(key, delta("", { thinking: "项目根目录是", streamOffset: 0 }));
    applyActiveTurnDraftDelta(key, delta("", { thinking: " D:/WORKS，", streamOffset: 6 }));
    applyActiveTurnDraftDelta(key, delta("", { thinking: "看起来是一个工具。", streamOffset: 16 }));
    // 重复/回放尾部（offset 小于已累积长度）必须跳过
    applyActiveTurnDraftDelta(key, delta("", { thinking: " D:/WORKS，", streamOffset: 6 }));
    const draft = getActiveTurnDraft(key);
    expect(draft?.thinking).toBe("项目根目录是 D:/WORKS，看起来是一个工具。");
    expect(draft?.thinkingParts).toHaveLength(1);
    expect(draft?.thinkingParts?.[0]?.text).toBe("项目根目录是 D:/WORKS，看起来是一个工具。");
  });

  it("replaces live thinking when the stream restarts at offset 0", () => {
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    applyActiveTurnDraftDelta(key, delta("", { thinking: "旧的思考流", streamOffset: 0 }));
    applyActiveTurnDraftDelta(key, delta("", { thinking: "继续", streamOffset: 5 }));
    // 服务端重试/重连后流从 0 重启：旧流作废，以新流为准
    applyActiveTurnDraftDelta(key, delta("", { thinking: "新的思考流", streamOffset: 0 }));
    applyActiveTurnDraftDelta(key, delta("", { thinking: "继续", streamOffset: 5 }));
    expect(getActiveTurnDraft(key)?.thinking).toBe("新的思考流继续");
  });

  it("does not splice an unreadable fragment into the draft when an offset gap is detected", () => {
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    applyActiveTurnDraftDelta(key, delta("", { thinking: "第一段", streamOffset: 0 }));
    // offset 跳跃代表中间帧已丢失；等待快照，不能把第三段硬接到第一段。
    applyActiveTurnDraftDelta(key, delta("", { thinking: "第三段", streamOffset: 99 }));
    expect(getActiveTurnDraft(key)?.thinking).toBe("第一段");
  });

  it("can resume from a non-zero offset after an authoritative snapshot supplied the prefix", () => {
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    applyActiveTurnDraftDelta(key, delta("快照后的续写", { streamOffset: 40 }));
    applyActiveTurnDraftDelta(key, delta("。", { streamOffset: 46 }));
    expect(getActiveTurnDraft(key)?.content).toBe("快照后的续写。");
  });

  it("anchors assistant content deltas by stream offset", () => {
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    applyActiveTurnDraftDelta(key, delta("你好", { streamOffset: 0 }));
    applyActiveTurnDraftDelta(key, delta("霖江路", { streamOffset: 2 }));
    applyActiveTurnDraftDelta(key, delta("江路", { streamOffset: 3 }));
    expect(getActiveTurnDraft(key)?.content).toBe("你好霖江路");
  });

  it("restarts the offset cursor for each step after a boundary commit", () => {
    // Offsets are per-step (verified with unsampled `[live] anchor` rows),
    // so a committed segment must not leave an anchor behind: the next
    // step's opening delta arrives at offset 0 and has to be accepted.
    // The previous version of this test asserted a turn-global cursor and
    // encoded the very assumption that froze the anchor and dropped whole
    // steps (814/932 thinking, 146/308 body deltas measured as rejected).
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    applyActiveTurnDraftDelta(key, delta("先读 DamageService。", { streamOffset: 0 }));
    expect(takeActiveTurnDraft(key)?.content).toBe("先读 DamageService。");

    applyActiveTurnDraftDelta(key, delta("再看调用方。", { streamOffset: 0 }));
    expect(getActiveTurnDraft(key)?.content).toBe("再看调用方。");
    applyActiveTurnDraftDelta(key, delta("继续。", { streamOffset: "再看调用方。".length }));
    expect(getActiveTurnDraft(key)?.content).toBe("再看调用方。继续。");
  });

  it("resumes on the next delta when a step opening looks like a replay", () => {
    // Replies here often open with the same words, so a committed-prefix
    // match can be a false positive. Rejecting one keeps the anchor null,
    // so only that delta is lost and the step resumes immediately instead
    // of freezing for the rest of the step.
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    applyActiveTurnDraftDelta(key, delta("你好霖江路。先看现有实现。", { streamOffset: 0 }));
    expect(takeActiveTurnDraft(key)?.content).toBe("你好霖江路。先看现有实现。");

    // Same opening words as the committed segment: treated as a replay.
    applyActiveTurnDraftDelta(key, delta("你好霖江路。", { streamOffset: 0 }));
    expect(getActiveTurnDraft(key)).toBeNull();

    // The very next delta resumes from its non-zero offset.
    applyActiveTurnDraftDelta(key, delta("再看调用方。", { streamOffset: "你好霖江路。".length }));
    expect(getActiveTurnDraft(key)?.content).toBe("再看调用方。");
  });

  it("does not rematerialize a committed segment when reconnect replays offset 0", () => {
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    const firstText = "先找版本文案，再看模型探测。";
    applyActiveTurnDraftDelta(key, delta(firstText, { streamOffset: 0 }));
    expect(takeActiveTurnDraft(key)?.content).toBe(firstText);

    // A reconnect replay re-sends the already-committed prefix at offset 0.
    // It must not create a second materialization of that same segment.
    applyActiveTurnDraftDelta(key, delta(firstText, { streamOffset: 0 }));
    expect(getActiveTurnDraft(key)).toBeNull();

    applyActiveTurnDraftDelta(key, delta("继续检查 IPC。", { streamOffset: firstText.length }));
    expect(getActiveTurnDraft(key)?.content).toBe("继续检查 IPC。");
  });

  it("still rejects a committed-prefix replay after an authoritative clear (step boundary)", () => {
    // 实机（steer 后同一段思考出现两个块）：step 完成权威帧触发
    // clearActiveTurnDraft，旧实现把 committedSegments 一并删除，下一步
    // offset=0 的同前缀重放增量失去判定基准，被当作新内容接受并重新材料化。
    // 修复：clear 只清 draft 与流锚点，已提交段文本保留为回放判定基准。
    const key = makeActiveTurnDraftKey("session-1", "agent-1", "turn-1");
    const firstThink = "But wait — potential issue: the bootstrapper architecture!";
    applyActiveTurnDraftDelta(key, delta("", { thinking: firstThink, streamOffset: 0 }));
    expect(takeActiveTurnDraft(key)?.thinking).toBe(firstThink);

    // 权威帧（如 turn.step.completed 映射的完整消息）清空 draft。
    clearActiveTurnDraft(key);
    expect(getActiveTurnDraft(key)).toBeNull();

    // 同前缀重放（offset=0）仍应被拒绝，不得重新材料化。
    applyActiveTurnDraftDelta(key, delta("", { thinking: firstThink, streamOffset: 0 }));
    expect(getActiveTurnDraft(key)).toBeNull();

    // 下一步非零 offset 正常恢复（self-heal，不冻结整步）。
    applyActiveTurnDraftDelta(key, delta("", { thinking: "继续分析缓存键。", streamOffset: firstThink.length }));
    expect(getActiveTurnDraft(key)?.thinking).toBe("继续分析缓存键。");
  });

  it("marks complete/barrier bodies as authoritative", () => {
    expect(isAuthoritativeAssistantBodyEvent(delta("全文", { isComplete: true }))).toBe(true);
    expect(isAuthoritativeAssistantBodyEvent(delta("全文", { completionBarrierReplay: true }))).toBe(true);
    expect(isAuthoritativeAssistantBodyEvent(delta("全文", { snapshotMessageIdStable: true, snapshotMessageId: "m1" }))).toBe(true);
    expect(isAuthoritativeAssistantBodyEvent(delta("增量"))).toBe(false);
    expect(isAuthoritativeAssistantBodyEvent(delta("", { isComplete: true }))).toBe(false);
  });
});

describe("formal coverage replay suppression (steer/reload resync)", () => {
  beforeEach(() => {
    resetActiveTurnDraftStoreForTests();
  });
  const X = "你好霖江路。先看下这条线的性质——它是 AI mask 残留的半透明碎屑，我确认下现有的「透明度下限」功能能不能直接干掉它。";
  const Y = "你好霖江路。两个问题分开答：关于那条竖线，那是 AI mask 的半透明残留，直接把低 alpha 的部分砍掉。";
  const think1 = "The user shows a real photo, checking the alpha floor behavior.";

  it("suppresses a cumulative resync replay against formal coverage, then accepts the new tail", () => {
    const key = makeActiveTurnDraftKey("s1", "a", "t1");
    const coverage = { content: [X, Y, X + Y], think: [] as string[] };
    // 重载后 committedSegments 为空，resync 从 offset=0 累计重放 X+Y
    applyActiveTurnDraftDelta(key, delta(X.slice(0, 40), { streamOffset: 0 }), coverage);
    expect(getActiveTurnDraft(key)?.content ?? "").toBe("");
    applyActiveTurnDraftDelta(key, delta(X.slice(40), { streamOffset: 40 }), coverage);
    expect(getActiveTurnDraft(key)?.content ?? "").toBe("");
    applyActiveTurnDraftDelta(key, delta(Y, { streamOffset: X.length }), coverage);
    expect(getActiveTurnDraft(key)?.content ?? "").toBe("");
    // 重放结束后的真正新内容：offset 超出覆盖长度，正常接受
    applyActiveTurnDraftDelta(key, delta("真正的新正文内容。", { streamOffset: X.length + Y.length }), coverage);
    expect(getActiveTurnDraft(key)?.content ?? "").toBe("真正的新正文内容。");
  });

  it("suppresses a per-step replay of a single formal body", () => {
    const key = makeActiveTurnDraftKey("s1", "a", "t1");
    const coverage = { content: [X, Y, X + Y], think: [] as string[] };
    // 单步重放：offset=0 直接重放 Y（不是从 X 开始的累计流）
    applyActiveTurnDraftDelta(key, delta(Y.slice(0, 30), { streamOffset: 0 }), coverage);
    expect(getActiveTurnDraft(key)?.content ?? "").toBe("");
  });

  it("does not suppress a genuinely new step opening", () => {
    const key = makeActiveTurnDraftKey("s1", "a", "t1");
    const coverage = { content: [X, Y, X + Y], think: [] as string[] };
    applyActiveTurnDraftDelta(key, delta("你好霖江路。好，这轮我们换个方向处理。", { streamOffset: 0 }), coverage);
    expect(getActiveTurnDraft(key)?.content).toBe("你好霖江路。好，这轮我们换个方向处理。");
  });

  it("keeps the short greeting delta of a new step (below suppression threshold)", () => {
    const key = makeActiveTurnDraftKey("s1", "a", "t1");
    const coverage = { content: [X, Y, X + Y], think: [] as string[] };
    applyActiveTurnDraftDelta(key, delta("你好霖江路。", { streamOffset: 0 }), coverage);
    applyActiveTurnDraftDelta(key, delta("新的方向。", { streamOffset: 6 }), coverage);
    expect(getActiveTurnDraft(key)?.content).toBe("你好霖江路。新的方向。");
  });

  it("suppresses a thinking resync replay against formal think coverage", () => {
    const key = makeActiveTurnDraftKey("s1", "a", "t1");
    const coverage = { content: [] as string[], think: [think1] };
    applyActiveTurnDraftDelta(key, delta("", { thinking: think1.slice(0, 30), streamOffset: 0 }), coverage);
    expect(getActiveTurnDraft(key)?.thinking ?? "").toBe("");
  });

  it("accepts deltas when no coverage is provided (legacy path unchanged)", () => {
    const key = makeActiveTurnDraftKey("s1", "a", "t1");
    applyActiveTurnDraftDelta(key, delta(X.slice(0, 40), { streamOffset: 0 }));
    expect(getActiveTurnDraft(key)?.content).toBe(X.slice(0, 40));
  });
});
