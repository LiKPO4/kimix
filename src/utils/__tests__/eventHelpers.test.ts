import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import { hasMalformedAssistantMarkdown, sanitizeKimiSkillActivationTitle, sanitizePersistedEvents, settleInactiveEvents } from "../eventHelpers";

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
