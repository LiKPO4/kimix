import { describe, expect, it } from "vitest";
import { forgetSessionState, type SessionScopedState } from "../../../electron/kimiCodeSessionState";

function freshState(): SessionScopedState {
  return {
    fingerprintBySession: new Map([
      ["s1", "fp-1"],
      ["s2", "fp-2"],
    ]),
    latestMessageIdBySession: new Map([
      ["s1", "msg-1"],
      ["s2", "msg-2"],
    ]),
    approvalKeys: new Set(["s1:req-a", "s1:req-b", "s2:req-c"]),
    questionKeys: new Set(["s1:q-1", "s2:q-2"]),
    questionRequests: new Map([
      ["s1:q-1", { text: "问题甲" }],
      ["s2:q-2", { text: "问题乙" }],
    ]),
  };
}

describe("forgetSessionState", () => {
  it("删除该会话的全部按会话作用域状态（指纹表 + 审批/问题请求表）", () => {
    const state = freshState();
    forgetSessionState(state, "s1");
    expect(state.fingerprintBySession.has("s1")).toBe(false);
    expect(state.latestMessageIdBySession.has("s1")).toBe(false);
    expect(state.approvalKeys.has("s1:req-a")).toBe(false);
    expect(state.approvalKeys.has("s1:req-b")).toBe(false);
    expect(state.questionKeys.has("s1:q-1")).toBe(false);
    expect(state.questionRequests.has("s1:q-1")).toBe(false);
  });

  it("不影响其他会话的状态", () => {
    const state = freshState();
    forgetSessionState(state, "s1");
    expect(state.fingerprintBySession.get("s2")).toBe("fp-2");
    expect(state.latestMessageIdBySession.get("s2")).toBe("msg-2");
    expect(state.approvalKeys.has("s2:req-c")).toBe(true);
    expect(state.questionKeys.has("s2:q-2")).toBe(true);
    expect(state.questionRequests.get("s2:q-2")).toEqual({ text: "问题乙" });
  });

  it("前缀过滤不误伤以该会话 id 开头的其他会话（s1 vs s10）", () => {
    const state = freshState();
    state.approvalKeys.add("s10:req-x");
    state.questionRequests.set("s10:q-x", { text: "x" });
    forgetSessionState(state, "s1");
    expect(state.approvalKeys.has("s10:req-x")).toBe(true);
    expect(state.questionRequests.has("s10:q-x")).toBe(true);
  });

  it("对不存在的会话幂等，不抛错也不删任何条目", () => {
    const state = freshState();
    expect(() => forgetSessionState(state, "no-such-session")).not.toThrow();
    expect(state.fingerprintBySession.size).toBe(2);
    expect(state.latestMessageIdBySession.size).toBe(2);
    expect(state.approvalKeys.size).toBe(3);
    expect(state.questionKeys.size).toBe(2);
    expect(state.questionRequests.size).toBe(2);
  });

  it("会话 id 自身含冒号时仍按 `${sessionId}:` 前缀精确清理", () => {
    const state = freshState();
    const oddId = "odd:id";
    state.approvalKeys.add(`${oddId}:req`);
    state.questionKeys.add(`${oddId}:q`);
    forgetSessionState(state, oddId);
    expect(state.approvalKeys.has(`${oddId}:req`)).toBe(false);
    expect(state.questionKeys.has(`${oddId}:q`)).toBe(false);
    expect(state.approvalKeys.has("s2:req-c")).toBe(true);
  });
});
