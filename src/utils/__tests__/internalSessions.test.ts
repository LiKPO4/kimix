import { describe, expect, it, beforeEach } from "vitest";
import {
  isHiddenInternalSession,
  isInternalPromptText,
  resetInternalSessionCachesForTests,
} from "../internalSessions";

describe("isInternalPromptText", () => {
  beforeEach(() => {
    resetInternalSessionCachesForTests();
  });

  it("matches known internal prompt heads", () => {
    expect(isInternalPromptText("只回复 OK")).toBe(true);
    expect(isInternalPromptText("【Kimix 长程任务：执行】hello")).toBe(true);
    expect(isInternalPromptText("普通用户消息")).toBe(false);
  });

  it("only inspects a short head of multi-megabyte bodies", () => {
    const huge = `${"x".repeat(2_000_000)}\n只回复 OK`;
    // Pattern is start-anchored; trailing internal text must not force full-body work.
    expect(isInternalPromptText(huge)).toBe(false);
    // Prefix-anchored patterns still match when the head is internal.
    expect(isInternalPromptText(`【Kimix 长程任务：执行】\n${"y".repeat(2_000_000)}`)).toBe(true);
  });
});

describe("isHiddenInternalSession", () => {
  beforeEach(() => {
    resetInternalSessionCachesForTests();
  });

  it("hides kimix-hidden-hooks sessions and internal titles", () => {
    expect(isHiddenInternalSession({ id: "kimix-hidden-hooks-1", title: "x", events: [] })).toBe(true);
    expect(isHiddenInternalSession({ id: "s1", title: "只回复 NEW", events: [] })).toBe(true);
  });

  it("only inspects the first few user messages, not the whole timeline", () => {
    const events = [
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `u${i}`,
        type: "user_message" as const,
        timestamp: i + 1,
        content: `hello-${i}`,
      })),
      ...Array.from({ length: 2000 }, (_, i) => ({
        id: `a${i}`,
        type: "assistant_message" as const,
        timestamp: 100 + i,
        content: "x".repeat(2000),
        isThinking: false,
        isComplete: true,
      })),
      // Beyond the user-scan limit — must not mark the session internal.
      { id: "u-late", type: "user_message" as const, timestamp: 99999, content: "只回复 OK" },
    ];
    expect(isHiddenInternalSession({ id: "s-big", title: "正常会话", events })).toBe(false);
  });

  it("caches by session object identity", () => {
    const session = {
      id: "s-cache",
      title: "正常",
      events: [{ id: "u1", type: "user_message", timestamp: 1, content: "hi" }],
    };
    expect(isHiddenInternalSession(session)).toBe(false);
    // Mutating in place would be a bug in production (immutable updates); cache must stick to ref.
    (session as { title: string }).title = "只回复 OK";
    expect(isHiddenInternalSession(session)).toBe(false);
    expect(isHiddenInternalSession({ ...session, title: "只回复 OK" })).toBe(true);
  });

  it("detects internal first user turn under collaboration agentEvents", () => {
    const session = {
      id: "room-1",
      title: "Room",
      events: [],
      collaboration: {
        agentEvents: {
          "agent-a": [
            { id: "u1", type: "user_message", timestamp: 1, content: "【Kimix Hooks 上下文】\nrule" },
          ],
        },
      },
    };
    expect(isHiddenInternalSession(session)).toBe(true);
  });
});
