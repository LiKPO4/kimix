import { describe, expect, it, beforeEach } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import {
  appendStreamingText,
  applyActiveTurnDraftDelta,
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
    applyActiveTurnDraftDelta(c, delta("C"));

    expect(getActiveTurnDraft(a)?.content).toBe("A");
    expect(getActiveTurnDraft(b)?.content).toBe("B");
    expect(getActiveTurnDraft(c)?.content).toBe("C");
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

  it("marks complete/barrier bodies as authoritative", () => {
    expect(isAuthoritativeAssistantBodyEvent(delta("全文", { isComplete: true }))).toBe(true);
    expect(isAuthoritativeAssistantBodyEvent(delta("全文", { completionBarrierReplay: true }))).toBe(true);
    expect(isAuthoritativeAssistantBodyEvent(delta("全文", { snapshotMessageIdStable: true, snapshotMessageId: "m1" }))).toBe(true);
    expect(isAuthoritativeAssistantBodyEvent(delta("增量"))).toBe(false);
    expect(isAuthoritativeAssistantBodyEvent(delta("", { isComplete: true }))).toBe(false);
  });
});
