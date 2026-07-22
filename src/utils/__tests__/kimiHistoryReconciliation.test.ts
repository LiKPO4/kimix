import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import * as reportError from "@/utils/reportError";
import {
  hasEquivalentKimiHistoryTurnBodies,
  mergeMissingLatestCanonicalAssistant,
  mergeMissingUsageStatusEvents,
  removeIdentityCoveredDuplicateToolCalls,
  shouldReplaceWithCanonicalKimiHistory,
} from "../kimiHistoryReconciliation";

const userMessage: TimelineEvent = {
  id: "user-1",
  type: "user_message",
  timestamp: 1,
  content: "hello",
};

function assistant(content: string, overrides: Partial<Extract<TimelineEvent, { type: "assistant_message" }>> = {}): TimelineEvent {
  return {
    id: `assistant-${content.slice(0, 8)}`,
    type: "assistant_message",
    timestamp: 2,
    content,
    isThinking: false,
    isComplete: true,
    ...overrides,
  };
}

function subagentWithContent(content: string, status: Extract<TimelineEvent, { type: "subagent" }>["status"] = "completed"): TimelineEvent {
  return {
    id: "sub-1",
    type: "subagent",
    timestamp: 2,
    agentId: "agent-1",
    agentName: "coder",
    status,
    events: [assistant(content)],
  };
}

function toolCall(name = "ReadFile"): TimelineEvent {
  return {
    id: "tool-1",
    type: "tool_call",
    timestamp: 2,
    toolCallId: "call-1",
    toolName: name,
    status: "success",
    arguments: {},
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("shouldReplaceWithCanonicalKimiHistory", () => {
  it("certifies a clean turn-equivalent cache without requiring replacement", () => {
    const cached: TimelineEvent[] = [{
      id: "local-user", type: "user_message", timestamp: 100, content: "  同一个问题 ",
    }, assistant("同一个回答", { id: "local-answer" })];
    const canonical: TimelineEvent[] = [{
      id: "official-user", type: "user_message", timestamp: 200, content: "同一个问题",
    }, assistant("同一个回答", {
      id: "official-answer",
      snapshotMessageId: "msg-answer",
      snapshotMessageIdStable: true,
    })];

    expect(shouldReplaceWithCanonicalKimiHistory(cached, canonical)).toBe(false);
    expect(hasEquivalentKimiHistoryTurnBodies(cached, canonical)).toBe(true);
  });

  it("does not certify equal global text mounted beneath different user boundaries", () => {
    const first = "第一轮正式回答正文。";
    const second = "第二轮正式回答正文。";
    const cached: TimelineEvent[] = [
      { id: "local-user-1", type: "user_message", timestamp: 100, content: "问题一" },
      { id: "local-user-2", type: "user_message", timestamp: 200, content: "问题二" },
      assistant(first, { id: "local-answer-1" }),
      assistant(second, { id: "local-answer-2" }),
    ];
    const canonical: TimelineEvent[] = [
      { id: "official-user-1", type: "user_message", timestamp: 100, content: "问题一" },
      assistant(first, { id: "official-answer-1" }),
      { id: "official-user-2", type: "user_message", timestamp: 200, content: "问题二" },
      assistant(second, { id: "official-answer-2" }),
    ];

    expect(hasEquivalentKimiHistoryTurnBodies(cached, canonical)).toBe(false);
  });

  it("replaces when canonical has more assistant body text", () => {
    const local = [userMessage, assistant("short")];
    const canonical = [userMessage, assistant("much longer body text here")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(true);
  });

  it("does not replace when canonical has less assistant body text", () => {
    const local = [userMessage, assistant("local has more content here")];
    const canonical = [userMessage, assistant("short")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("repairs a longer local assistant whose stable snapshot id belongs to another user turn", () => {
    const local: TimelineEvent[] = [{
      id: "user-old", type: "user_message", timestamp: 100, content: "旧问题",
    }, {
      id: "user-current", type: "user_message", timestamp: 1_000, content: "新问题",
    }, assistant("当前回答\n错误拼入的旧回答", {
      id: "polluted-current",
      timestamp: 1_100,
      snapshotMessageId: "msg-old",
      snapshotMessageIdStable: true,
      isComplete: false,
    })];
    const canonical: TimelineEvent[] = [{
      id: "official-user-old", type: "user_message", timestamp: 100, content: "旧问题",
    }, assistant("旧回答", {
      id: "official-old",
      timestamp: 200,
      snapshotMessageId: "msg-old",
      snapshotMessageIdStable: true,
    }), {
      id: "official-user-current", type: "user_message", timestamp: 1_000, content: "新问题",
    }, assistant("当前回答", {
      id: "official-current",
      timestamp: 1_100,
      snapshotMessageId: "msg-current",
      snapshotMessageIdStable: true,
    })];

    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(true);
  });

  it("repairs a stable snapshot message whose body expanded after its original user boundary was lost", () => {
    const officialOldReply = "这是官方稳定消息原本唯一的完整回答，长度足以证明它不是偶然引用。";
    const currentReply = "这是当前轮唯一应当显示的回答，不能与旧消息合并。";
    const local: TimelineEvent[] = [{
      id: "local-current-user",
      type: "user_message",
      timestamp: 1_000,
      content: "当前问题",
    }, assistant(currentReply, {
      id: "local-current-reply",
      snapshotMessageId: "msg-current",
      snapshotMessageIdStable: true,
    }), assistant(`${officialOldReply}\n\n这是被错误串入同一稳定 ID 的其他多轮回复，而且原始用户边界已经不在官方窗口内。`, {
      id: "polluted-stable-old-reply",
      timestamp: 1_100,
      snapshotMessageId: "msg-old-orphaned",
      snapshotMessageIdStable: true,
    })];
    const canonical: TimelineEvent[] = [assistant(officialOldReply, {
      id: "official-old-reply",
      timestamp: 100,
      snapshotMessageId: "msg-old-orphaned",
      snapshotMessageIdStable: true,
    }), {
      id: "official-current-user",
      type: "user_message",
      timestamp: 1_000,
      content: "当前问题",
    }, assistant(currentReply, {
      id: "official-current-reply",
      timestamp: 1_050,
      snapshotMessageId: "msg-current",
      snapshotMessageIdStable: true,
    })];

    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(true);
  });

  it("repairs a stable local cross-turn composition from identity-less startup fallback history", () => {
    const oldReply = "这是较早用户轮次的完整官方回答，长度足以作为严格的跨轮匹配证据。";
    const currentReply = "这是当前用户轮次唯一正确的官方回答，同样具有足够长度。";
    const local: TimelineEvent[] = [{
      id: "current-user",
      type: "user_message",
      timestamp: 1_000,
      content: "当前问题",
    }, assistant(currentReply, { id: "current-local" }), assistant(oldReply, {
      id: "polluted-stable-row",
      snapshotMessageId: "msg-old",
      snapshotMessageIdStable: true,
    })];
    const canonical: TimelineEvent[] = [{
      id: "old-user",
      type: "user_message",
      timestamp: 100,
      content: "较早问题",
    }, assistant(oldReply, { id: "old-official" }), {
      id: "current-official-user",
      type: "user_message",
      timestamp: 1_000,
      content: "当前问题",
    }, assistant(currentReply, { id: "current-official" })];

    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(true);
  });

  it("repairs a cached assistant composed of stable canonical replies from multiple user turns", () => {
    const oldAnswer = "这是上一轮已经完成的正式回答，长度足以排除短语偶然重合。";
    const currentAnswer = "这是当前这一轮的正式回答，应该单独显示在当前消息气泡中。";
    const local: TimelineEvent[] = [{
      id: "local-user-old", type: "user_message", timestamp: 100, content: "旧问题",
    }, assistant(oldAnswer, { id: "local-old", timestamp: 200 }), {
      id: "local-user-current", type: "user_message", timestamp: 1_000, content: "新问题",
    }, assistant(`${currentAnswer}\n\n${oldAnswer}`, {
      id: "polluted-current",
      timestamp: 1_100,
      isComplete: false,
    })];
    const canonical: TimelineEvent[] = [{
      id: "official-user-old", type: "user_message", timestamp: 100, content: "旧问题",
    }, assistant(oldAnswer, {
      id: "official-old",
      timestamp: 200,
      snapshotMessageId: "msg-old",
      snapshotMessageIdStable: true,
    }), {
      id: "official-user-current", type: "user_message", timestamp: 1_000, content: "新问题",
    }, assistant(currentAnswer, {
      id: "official-current",
      timestamp: 1_100,
      snapshotMessageId: "msg-current",
      snapshotMessageIdStable: true,
    })];

    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(true);
  });

  it("repairs multiple cached assistant rows from different canonical turns under one user boundary", () => {
    const oldAnswer = "这是上一轮已经完成的正式回答，长度足以排除短语偶然重合。";
    const currentAnswer = "这是当前这一轮的正式回答，应该单独显示在当前消息气泡中。";
    const local: TimelineEvent[] = [{
      id: "local-user-old", type: "user_message", timestamp: 100, content: "旧问题",
    }, assistant(oldAnswer, { id: "local-old", timestamp: 200 }), {
      id: "local-user-current", type: "user_message", timestamp: 1_000, content: "新问题",
    }, assistant(currentAnswer, {
      id: "local-current",
      timestamp: 1_100,
    }), assistant(oldAnswer, {
      id: "identity-less-replayed-old",
      timestamp: 1_101,
    })];
    const canonical: TimelineEvent[] = [{
      id: "official-user-old", type: "user_message", timestamp: 100, content: "旧问题",
    }, assistant(oldAnswer, {
      id: "official-old",
      snapshotMessageId: "msg-old",
      snapshotMessageIdStable: true,
    }), {
      id: "official-user-current", type: "user_message", timestamp: 1_000, content: "新问题",
    }, assistant(currentAnswer, {
      id: "official-current",
      snapshotMessageId: "msg-current",
      snapshotMessageIdStable: true,
    })];

    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(true);
  });

  it("does not treat a short quotation from an older canonical reply as cross-turn pollution", () => {
    const oldAnswer = "这是上一轮已经完成的正式回答，长度足以排除短语偶然重合。";
    const currentAnswer = "这是当前这一轮的正式回答，应该单独显示在当前消息气泡中。";
    const local: TimelineEvent[] = [{
      id: "local-user-current", type: "user_message", timestamp: 1_000, content: "新问题",
    }, assistant(`${currentAnswer}\n\n引用旧答：${oldAnswer}\n\n这里还有大量独立分析，不能被官方较短快照破坏性覆盖。`, {
      id: "quoted-current",
      timestamp: 1_100,
    })];
    const canonical: TimelineEvent[] = [{
      id: "official-user-old", type: "user_message", timestamp: 100, content: "旧问题",
    }, assistant(oldAnswer, {
      id: "official-old",
      snapshotMessageId: "msg-old",
      snapshotMessageIdStable: true,
    }), {
      id: "official-user-current", type: "user_message", timestamp: 1_000, content: "新问题",
    }, assistant(currentAnswer, {
      id: "official-current",
      snapshotMessageId: "msg-current",
      snapshotMessageIdStable: true,
    })];

    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("does not replace shorter assistant body when canonical thinking differs", () => {
    const local = [userMessage, assistant("local complete answer", { thinking: "local thought" })];
    const canonical = [userMessage, assistant("short", { thinking: "different canonical thought" })];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("does not replace shorter assistant body just because canonical has an extra image", () => {
    const local = [userMessage, assistant("local complete answer")];
    const canonical: TimelineEvent[] = [{
      ...userMessage,
      images: [{ name: "img.png", dataUrl: "data:image/png;base64,abc" }],
    }, assistant("short")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("replaces when body text differs and canonical is longer", () => {
    const local = [userMessage, assistant("local body")];
    const canonical = [userMessage, assistant("canonical body text")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(true);
  });

  it("does not replace when body text differs but canonical is shorter", () => {
    const local = [userMessage, assistant("local body text")];
    const canonical = [userMessage, assistant("short")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("does not replace when canonical is empty", () => {
    const local = [userMessage, assistant("local body")];
    const canonical: TimelineEvent[] = [];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("replaces when canonical has more process events", () => {
    const local = [userMessage, assistant("body")];
    const canonical = [userMessage, toolCall(), assistant("body")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(true);
  });

  it("does not replace when canonical has fewer process events", () => {
    const local = [userMessage, toolCall(), assistant("body")];
    const canonical = [userMessage, assistant("body")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("replaces duplicated replayed tools when canonical covers every tool identity", () => {
    const original = toolCall();
    const replayed = {
      ...original,
      id: "tool-replayed-under-retry",
      timestamp: 10_000,
    };
    const local = [userMessage, original, assistant("body"), replayed];
    const canonical = [userMessage, original, assistant("body")];

    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(true);
  });

  it("keeps duplicate repair closed when canonical misses a distinct local tool", () => {
    const first = toolCall();
    const replayed = { ...first, id: "tool-replayed", timestamp: 10_000 };
    const localOnly = { ...first, id: "tool-local", toolCallId: "call-local" };
    const local = [userMessage, first, localOnly, assistant("body"), replayed];
    const canonical = [userMessage, first, assistant("body")];

    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("replaces when canonical has subagent content that local lacks", () => {
    const local = [userMessage, assistant("")];
    const canonical = [userMessage, subagentWithContent("subagent body")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(true);
  });

  it("does not replace when local has subagent content but canonical lacks it", () => {
    const local = [userMessage, subagentWithContent("subagent body")];
    const canonical = [userMessage, assistant("")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("does not replace when canonical has fewer process events even if body text exists", () => {
    // Local has a real tool call; canonical only has body text. Replacing would lose the tool.
    const local = [userMessage, toolCall(), assistant("body")];
    const canonical = [userMessage, assistant("canonical body")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("replaces when canonical has more displayable user images", () => {
    const local = [userMessage, assistant("body")];
    const canonical: TimelineEvent[] = [{
      id: "user-2",
      type: "user_message",
      timestamp: 1,
      content: "with image",
      images: [{ name: "img.png", dataUrl: "data:image/png;base64,abc" }],
    }, assistant("body")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(true);
  });

  it("replaces when canonical has different thinking", () => {
    const local = [userMessage, assistant("body", { thinking: "local thought" })];
    const canonical = [userMessage, assistant("body", { thinking: "canonical thought" })];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(true);
  });

  it("does not replace when canonical has shorter thinking history", () => {
    const local = [userMessage, assistant("body", { thinking: "a much longer local thought here" })];
    const canonical = [userMessage, assistant("body", { thinking: "short" })];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("does not replace richer body when doing so would shrink thinking history", () => {
    const local = [userMessage, assistant("body", { thinking: "a much longer local thought here" })];
    const canonical = [userMessage, assistant("a richer canonical body", { thinking: "short" })];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
  });

  it("does not replace when canonical is identical", () => {
    const events = [userMessage, assistant("same body")];
    expect(shouldReplaceWithCanonicalKimiHistory(events, events)).toBe(false);
  });
});

describe("mergeMissingLatestCanonicalAssistant", () => {
  const failedAssistant = assistant("本轮请求未能开始生成：第三方模型余额不足。", {
    id: "canonical-failed-assistant",
    timestamp: 10_100,
    snapshotMessageId: "msg-failed-assistant",
    snapshotMessageIdStable: true,
  });

  it("keeps richer local history and patches only the missing latest failed assistant", () => {
    const local: TimelineEvent[] = [
      { id: "local-old-user", type: "user_message", timestamp: 100, content: "旧问题" },
      assistant("本地保留的旧回复正文远比官方当前窗口更长，不能被整体替换。".repeat(20), {
        id: "local-rich-answer",
        timestamp: 200,
      }),
      {
        id: "local-latest-user",
        type: "user_message",
        timestamp: 10_000,
        content: "把铸剑事件拉出来我看下",
      },
    ];
    const canonical: TimelineEvent[] = [
      {
        id: "official-latest-user",
        type: "user_message",
        timestamp: 10_001,
        content: "把铸剑事件拉出来我看下",
      },
      {
        id: "canonical-interrupted",
        type: "status_update",
        timestamp: 10_050,
        message: "输出打断",
      },
      {
        ...failedAssistant,
      },
    ];

    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical)).toBe(false);
    const patched = mergeMissingLatestCanonicalAssistant(local, canonical);

    expect(patched.slice(0, local.length)).toEqual(local);
    expect(patched).toHaveLength(local.length + 2);
    expect(patched.at(-2)).toMatchObject({ type: "status_update", message: "输出打断" });
    expect(patched.at(-1)).toMatchObject({
      type: "assistant_message",
      snapshotMessageId: "msg-failed-assistant",
      content: "本轮请求未能开始生成：第三方模型余额不足。",
    });
    expect(mergeMissingLatestCanonicalAssistant(patched, canonical)).toEqual(patched);
  });

  it("patches an interrupted status when the stable failed assistant is already mounted", () => {
    const local: TimelineEvent[] = [{
      id: "local-user",
      type: "user_message",
      timestamp: 10_000,
      content: "？？？",
    }, failedAssistant];
    const canonical: TimelineEvent[] = [{
      id: "canonical-user",
      type: "user_message",
      timestamp: 10_001,
      content: "？？？",
    }, {
      id: "canonical-interrupted",
      type: "status_update",
      timestamp: 10_050,
      message: "输出打断",
    }, failedAssistant];

    const patched = mergeMissingLatestCanonicalAssistant(local, canonical);
    expect(patched).toHaveLength(local.length + 1);
    expect(patched.at(-2)).toMatchObject({ snapshotMessageId: "msg-failed-assistant" });
    expect(patched.at(-1)).toMatchObject({ type: "status_update", message: "输出打断" });
  });

  it("does not patch a different latest user turn", () => {
    const local: TimelineEvent[] = [{
      id: "local-user",
      type: "user_message",
      timestamp: 10_000,
      content: "另一个问题",
      roomMessageId: "room-message-other",
      agentTurnId: "turn-other",
    }];
    const canonical: TimelineEvent[] = [{
      id: "canonical-user",
      type: "user_message",
      timestamp: 10_000,
      content: "当前问题",
      roomMessageId: "room-message-current",
      agentTurnId: "turn-current",
    }, failedAssistant];

    expect(mergeMissingLatestCanonicalAssistant(local, canonical)).toBe(local);
  });

  it("does not patch an assistant without stable official identity", () => {
    const local: TimelineEvent[] = [{
      id: "same-user",
      type: "user_message",
      timestamp: 10_000,
      content: "当前问题",
    }];
    const canonical: TimelineEvent[] = [local[0], assistant("失败", {
      id: "identity-less-assistant",
      snapshotMessageId: "assistant:失败",
      snapshotMessageIdStable: false,
    })];

    expect(mergeMissingLatestCanonicalAssistant(local, canonical)).toBe(local);
  });

  it("does not patch when the local latest turn already has visible output", () => {
    const local: TimelineEvent[] = [{
      id: "same-user",
      type: "user_message",
      timestamp: 10_000,
      content: "当前问题",
    }, {
      id: "local-tool-call",
      type: "tool_call",
      timestamp: 10_050,
      toolCallId: "call-1",
      toolName: "read_file",
      status: "success",
      arguments: {},
    }];
    const canonical: TimelineEvent[] = [local[0], failedAssistant];

    expect(mergeMissingLatestCanonicalAssistant(local, canonical)).toBe(local);
  });

  it("patches the canonical failed assistant when the local latest turn only has a transient error", () => {
    // A transient `error` event is a status signal, not Assistant body output;
    // the canonical failed Assistant must still be patched in so the failed
    // turn shows a visible message header instead of disappearing.
    const local: TimelineEvent[] = [{
      id: "same-user",
      type: "user_message",
      timestamp: 10_000,
      content: "当前问题",
    }, {
      id: "local-error",
      type: "error",
      timestamp: 10_050,
      message: "本地已经显示失败原因",
      canDismiss: false,
    }];
    const canonical: TimelineEvent[] = [local[0], failedAssistant];

    const patched = mergeMissingLatestCanonicalAssistant(local, canonical);
    expect(patched).not.toBe(local);
    expect(patched.at(-1)).toMatchObject({
      type: "assistant_message",
      snapshotMessageId: "msg-failed-assistant",
      content: "本轮请求未能开始生成：第三方模型余额不足。",
    });
  });
});

describe("removeIdentityCoveredDuplicateToolCalls", () => {
  it("removes only duplicated call ids covered by canonical history", () => {
    const covered = toolCall();
    const localOnly = { ...toolCall(), id: "local-only", toolCallId: "call-local" };
    const local: TimelineEvent[] = [
      covered,
      localOnly,
      { ...covered, id: "covered-replay", timestamp: 10_000 },
      { ...localOnly, id: "local-replay", timestamp: 10_001 },
    ];

    const repaired = removeIdentityCoveredDuplicateToolCalls(local, [covered]);
    expect(repaired.filter((event) => event.type === "tool_call" && event.toolCallId === "call-1")).toHaveLength(1);
    expect(repaired.filter((event) => event.type === "tool_call" && event.toolCallId === "call-local")).toHaveLength(2);
    expect(repaired[0]).toBe(covered);
  });

  it("uses an already persisted stable snapshot row to clean duplicates outside the current history page", () => {
    const stable = { ...toolCall(), id: "snapshot:msg-old:tool%3Acall-1:0" };
    const replayed = { ...stable, id: "late-replay", timestamp: 10_000 };

    const repaired = removeIdentityCoveredDuplicateToolCalls([stable, replayed], []);
    expect(repaired).toEqual([stable]);
  });
});

describe("shouldReplaceWithCanonicalKimiHistory instrumentation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("logs accepted reconciliation with context", () => {
    const logEventSpy = vi.spyOn(reportError, "logEvent").mockImplementation(() => {});
    const context = { sessionId: "s-1", roomAgentId: "agent-a", reason: "history-load" };
    const local = [userMessage, assistant("short")];
    const canonical = [userMessage, assistant("much longer canonical body text")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical, context)).toBe(true);
    expect(logEventSpy).toHaveBeenCalledTimes(1);
    expect(logEventSpy).toHaveBeenCalledWith(
      "kimiHistoryReconciliation.accepted",
      expect.objectContaining({
        sessionId: "s-1",
        roomAgentId: "agent-a",
        reason: "history-load",
        localSize: "short".length,
        canonicalSize: "much longer canonical body text".length,
      }),
    );
  });

  it("logs rejected reconciliation when canonical has fewer process events", () => {
    const logEventSpy = vi.spyOn(reportError, "logEvent").mockImplementation(() => {});
    const context = { sessionId: "s-1", roomAgentId: "agent-a" };
    const local = [userMessage, toolCall(), assistant("body")];
    const canonical = [userMessage, assistant("body")];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical, context)).toBe(false);
    expect(logEventSpy).toHaveBeenCalledTimes(1);
    expect(logEventSpy).toHaveBeenCalledWith(
      "kimiHistoryReconciliation.rejected",
      expect.objectContaining({
        sessionId: "s-1",
        roomAgentId: "agent-a",
        reason: "process-history-regression",
        localProcessEvents: 1,
        canonicalProcessEvents: 0,
      }),
    );
  });

  it("logs rejected reconciliation when canonical assistant body regresses", () => {
    const logEventSpy = vi.spyOn(reportError, "logEvent").mockImplementation(() => {});
    const local = [userMessage, assistant("local complete answer")];
    const canonical = [userMessage, assistant("short", { thinking: "different thought" })];
    expect(shouldReplaceWithCanonicalKimiHistory(local, canonical, { sessionId: "s-1" })).toBe(false);
    expect(logEventSpy).toHaveBeenCalledWith(
      "kimiHistoryReconciliation.rejected",
      expect.objectContaining({
        sessionId: "s-1",
        reason: "assistant-body-regression",
        localSize: "local complete answer".length,
        canonicalSize: "short".length,
      }),
    );
  });

  it("does not log when no decision is made", () => {
    const logEventSpy = vi.spyOn(reportError, "logEvent").mockImplementation(() => {});
    const events = [userMessage, assistant("same body")];
    expect(shouldReplaceWithCanonicalKimiHistory(events, events)).toBe(false);
    expect(logEventSpy).not.toHaveBeenCalled();
  });
});
describe("mergeMissingUsageStatusEvents", () => {
  const usageStatus = (timestamp: number, tokenCount: number, inputTokenCount: number, id = `st-${timestamp}`): TimelineEvent => ({
    id,
    type: "status_update",
    timestamp,
    tokenCount,
    inputTokenCount,
    message: "模型：kimi-code/kimi-for-coding",
  });

  it("hydrates missing usage statuses in timestamp order without mutating inputs", () => {
    const base: TimelineEvent[] = [
      { id: "u1", type: "user_message", timestamp: 10, content: "第一轮" },
      assistant("回复一", { timestamp: 20 }),
      usageStatus(25, 54, 22386),
      { id: "u2", type: "user_message", timestamp: 30, content: "第二轮" },
      assistant("回复二", { timestamp: 40 }),
    ];
    const canonical: TimelineEvent[] = [
      usageStatus(25, 54, 22386),
      usageStatus(45, 262, 22472),
    ];
    const merged = mergeMissingUsageStatusEvents(base, canonical);
    expect(merged).toHaveLength(6);
    // 第一轮直播状态已存在：按身份去重不重复补水合
    expect(merged.filter((event) => event.type === "status_update")).toHaveLength(2);
    const second = merged.find((event) => event.type === "status_update" && event.tokenCount === 262);
    expect(second).toBeDefined();
    // 时间序插入：落在第二轮用户边界之后
    expect(merged.indexOf(second!)).toBeGreaterThan(merged.findIndex((event) => event.id === "u2"));
    expect(base).toHaveLength(5);
    expect(canonical).toHaveLength(2);
  });

  it("returns the base events untouched when nothing is missing", () => {
    const base = [assistant("回复"), usageStatus(25, 54, 22386)];
    expect(mergeMissingUsageStatusEvents(base, [usageStatus(25, 54, 22386)])).toBe(base);
    expect(mergeMissingUsageStatusEvents(base, [])).toBe(base);
  });
});
