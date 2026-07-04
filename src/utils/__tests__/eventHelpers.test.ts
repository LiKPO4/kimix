import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import { formatKimiSkillActivationCommand, hasLocalFailedSendAttempt, hasLocalOrphanUserSendAttempt, hasMalformedAssistantMarkdown, removeLocalUserSendAttempt, sanitizeKimiSkillActivationTitle, sanitizePersistedEvents, settleInactiveEvents } from "../eventHelpers";

describe("eventHelpers", () => {
  it("keeps assistant messages that only have thinking parts when settling", () => {
    const events: TimelineEvent[] = [{
      id: "assistant-1",
      type: "assistant_message",
      timestamp: 1,
      content: "",
      thinkingParts: [{ id: "think-1", timestamp: 1, text: "分析项目结构" }],
      isThinking: true,
      isComplete: false,
    }];

    const settled = settleInactiveEvents(events);
    expect(settled).toHaveLength(1);
    const assistant = settled[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(assistant.isComplete).toBe(true);
    expect(assistant.isThinking).toBe(false);
    expect(assistant.thinkingParts?.[0]?.text).toBe("分析项目结构");
  });

  it("settles stale running tools as interrupted without inventing a duration", () => {
    const now = 10 * 60 * 1000;
    const events: TimelineEvent[] = [{
      id: "tool-1",
      type: "tool_call",
      timestamp: 1,
      toolCallId: "tc-1",
      toolName: "bash",
      status: "running",
      arguments: { command: "ls" },
    }];

    const settled = settleInactiveEvents(events, now);
    expect(settled).toHaveLength(1);
    const tool = settled[0] as Extract<TimelineEvent, { type: "tool_call" }>;
    expect(tool.status).toBe("error");
    expect(tool.durationMs).toBeUndefined();
    expect(tool.result).toContain("中断");
  });

  it("keeps recently running tools unchanged", () => {
    const now = 10 * 60 * 1000;
    const events: TimelineEvent[] = [{
      id: "tool-1",
      type: "tool_call",
      timestamp: now - 30_000,
      toolCallId: "tc-1",
      toolName: "bash",
      status: "running",
      arguments: { command: "ls" },
    }];

    const settled = settleInactiveEvents(events, now);
    expect(settled).toHaveLength(1);
    const tool = settled[0] as Extract<TimelineEvent, { type: "tool_call" }>;
    expect(tool.status).toBe("running");
    expect(tool.durationMs).toBeUndefined();
  });

  it("removes a local failed send attempt with its status, empty placeholder, and error", () => {
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "卡住了吗" },
      { id: "status-1", type: "status_update", timestamp: 2, message: "消息发送中", parentEventId: "user-1", source: "ipc" },
      { id: "assistant-empty", type: "assistant_message", timestamp: 3, content: "", isThinking: false, isComplete: true },
      { id: "error-1", type: "error", timestamp: 4, message: "Cannot launch a new turn while another turn is active", source: "ipc" },
      { id: "user-2", type: "user_message", timestamp: 5, content: "下一条" },
    ];

    expect(removeLocalUserSendAttempt(events, "user-1").map((event) => event.id))
      .toEqual(["user-2"]);
  });

  it("marks only local failed send attempts as deletable", () => {
    const failedEvents: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "卡住了吗" },
      { id: "status-1", type: "status_update", timestamp: 2, message: "消息发送中", parentEventId: "user-1", source: "ipc" },
      { id: "error-1", type: "error", timestamp: 3, message: "Cannot launch a new turn while another turn is active", source: "ipc" },
    ];
    const completedEvents: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "你好" },
      { id: "assistant-1", type: "assistant_message", timestamp: 2, content: "你好，有什么可以帮你？", isThinking: false, isComplete: true },
      { id: "error-later", type: "error", timestamp: 3, message: "unrelated", source: "ipc" },
    ];

    expect(hasLocalFailedSendAttempt(failedEvents, "user-1")).toBe(true);
    expect(hasLocalFailedSendAttempt(completedEvents, "user-1")).toBe(false);
  });

  it("marks a trailing user message without real output as a local orphan attempt", () => {
    const events: TimelineEvent[] = [
      { id: "assistant-1", type: "assistant_message", timestamp: 1, content: "继续说。", isThinking: false, isComplete: true },
      { id: "user-1", type: "user_message", timestamp: 2, content: "卡住了吗" },
    ];

    expect(hasLocalOrphanUserSendAttempt(events, "user-1")).toBe(true);
  });

  it("does not mark a user message with real assistant output as an orphan attempt", () => {
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "你好" },
      { id: "assistant-1", type: "assistant_message", timestamp: 2, content: "你好。", isThinking: false, isComplete: true },
    ];

    expect(hasLocalOrphanUserSendAttempt(events, "user-1")).toBe(false);
  });

  it("does not remove real assistant content after deleting a user message", () => {
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "你好" },
      { id: "assistant-1", type: "assistant_message", timestamp: 2, content: "你好，有什么可以帮你？", isThinking: false, isComplete: true },
      { id: "error-later", type: "error", timestamp: 3, message: "unrelated", source: "ipc" },
    ];

    expect(removeLocalUserSendAttempt(events, "user-1").map((event) => event.id))
      .toEqual(["assistant-1", "error-later"]);
  });
});

describe("sanitizePersistedEvents", () => {
  it("removes internal Skill instructions from cached user messages", () => {
    const events: TimelineEvent[] = [{
      id: "skill-1",
      type: "user_message",
      timestamp: 1,
      content: 'User activated the skill "find-skills".\n\n<kimi-skill-loaded name="find-skills" trigger="user-slash" args="查找游戏 Skill">\ninternal\n</kimi-skill-loaded>',
    }];

    expect(sanitizePersistedEvents(events)).toMatchObject([{
      type: "user_message",
      content: "/skill:find-skills 查找游戏 Skill",
    }]);
  });

  it("keeps model-triggered Skill payloads out of cached user bubbles", () => {
    const events: TimelineEvent[] = [{
      id: "skill-2",
      type: "user_message",
      timestamp: 2,
      content: '<kimi-skill-loaded name="game-development/game-design" trigger="model-tool" args="">\ninternal\n</kimi-skill-loaded>',
    }];

    expect(sanitizePersistedEvents(events)).toMatchObject([{
      type: "status_update",
      message: "已调用 Skill：game-development/game-design",
    }]);
  });

  it("sanitizes cached official Skill activation titles", () => {
    expect(sanitizeKimiSkillActivationTitle('User activated the skill "find-skills".'))
      .toBe("使用 find-skills");
  });

  it("preserves built-in Skill command names while keeping external Skills namespaced", () => {
    expect(formatKimiSkillActivationCommand("custom-theme", "做一套暗色主题"))
      .toBe("/custom-theme 做一套暗色主题");
    expect(formatKimiSkillActivationCommand("find-skills", "查找主题 Skill"))
      .toBe("/skill:find-skills 查找主题 Skill");
  });
});

describe("hasMalformedAssistantMarkdown", () => {
  it("detects a bold marker split onto its own line", () => {
    const malformed: TimelineEvent[] = [{
      id: "assistant-2",
      type: "assistant_message",
      timestamp: 1,
      content: "- **Achiever**：图鉴\n- **\n\nExplorer**：骰子组合",
      isThinking: false,
      isComplete: true,
    }];
    const canonical: TimelineEvent[] = [{
      ...malformed[0],
      type: "assistant_message",
      content: "- **Achiever**：图鉴\n- **Explorer**：骰子组合",
    }];

    expect(hasMalformedAssistantMarkdown(malformed)).toBe(true);
    expect(hasMalformedAssistantMarkdown(canonical)).toBe(false);
  });
});
