import { describe, it, expect } from "vitest";
import { mapStreamEvent, mergeEvents, mapHistoryEvents } from "../eventMapper";
import type { TimelineEvent } from "@/types/ui";

describe("mapStreamEvent", () => {
  it("returns null for non-object input", () => {
    expect(mapStreamEvent(null)).toBeNull();
    expect(mapStreamEvent("string")).toBeNull();
    expect(mapStreamEvent(42)).toBeNull();
  });

  it("returns null for unknown type", () => {
    expect(mapStreamEvent({ type: "UnknownType", payload: {} })).toBeNull();
  });

  it("maps TurnBegin to user_message", () => {
    const event = mapStreamEvent({
      type: "TurnBegin",
      payload: { user_input: "Hello" },
    });
    expect(event).not.toBeNull();
    expect(event?.type).toBe("user_message");
    expect((event as Extract<TimelineEvent, { type: "user_message" }>).content).toBe("Hello");
  });

  it("ignores empty TurnBegin", () => {
    expect(mapStreamEvent({ type: "TurnBegin", payload: { user_input: "" } })).toBeNull();
  });

  it("ignores official system-reminder TurnBegin text", () => {
    expect(mapStreamEvent({
      type: "TurnBegin",
      payload: {
        user_input: "<system-reminder>\nAuto permission mode is active.\n</system-reminder>",
      },
    })).toBeNull();
  });

  it("removes official system-reminder parts from array user_input", () => {
    const event = mapStreamEvent({
      type: "TurnBegin",
      payload: {
        user_input: [
          { type: "text", text: "<system-reminder>\nAuto permission mode is active.\n</system-reminder>" },
          { type: "text", text: "真实用户消息" },
        ],
      },
    });
    const user = event as Extract<TimelineEvent, { type: "user_message" }>;
    expect(user.type).toBe("user_message");
    expect(user.content).toBe("真实用户消息");
  });

  it("maps ContentPart text to assistant_message", () => {
    const event = mapStreamEvent({
      type: "ContentPart",
      payload: { type: "text", text: "Hi there" },
    });
    expect(event?.type).toBe("assistant_message");
    const assistant = event as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(assistant.content).toBe("Hi there");
    expect(assistant.isThinking).toBe(false);
    expect(assistant.isComplete).toBe(false);
  });

  it("maps ContentPart think to assistant_message with thinking", () => {
    const event = mapStreamEvent({
      type: "ContentPart",
      payload: { type: "think", think: "Let me think..." },
    });
    expect(event?.type).toBe("assistant_message");
    const assistant = event as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(assistant.thinking).toBe("Let me think...");
    expect(assistant.isThinking).toBe(true);
  });

  it("maps ToolCall", () => {
    const event = mapStreamEvent({
      type: "ToolCall",
      payload: {
        function: { name: "read_file", arguments: '{"path": "a.ts"}' },
        id: "tc-1",
      },
    });
    expect(event?.type).toBe("tool_call");
    const tool = event as Extract<TimelineEvent, { type: "tool_call" }>;
    expect(tool.toolName).toBe("read_file");
    expect(tool.arguments).toEqual({ path: "a.ts" });
  });

  it("maps SteerInput", () => {
    const event = mapStreamEvent({
      type: "SteerInput",
      payload: { user_input: "Please fix" },
    });
    expect(event?.type).toBe("steer_message");
    expect((event as Extract<TimelineEvent, { type: "steer_message" }>).content).toBe("Please fix");
  });

  it("maps SteerInput images", () => {
    const event = mapStreamEvent({
      type: "SteerInput",
      payload: {
        user_input: [
          { type: "text", text: "Please inspect" },
          { type: "image_url", image_url: { url: "data:image/png;base64,steer" } },
        ],
      },
    });
    const steer = event as Extract<TimelineEvent, { type: "steer_message" }>;
    expect(steer.content).toBe("Please inspect");
    expect(steer.images).toHaveLength(1);
    expect(steer.images?.[0].dataUrl).toBe("data:image/png;base64,steer");
  });

  it("maps ApprovalRequest", () => {
    const event = mapStreamEvent({
      type: "ApprovalRequest",
      payload: { id: "ar-1", sender: "editor", description: "Edit file", action: "write" },
    });
    expect(event?.type).toBe("approval_request");
    const req = event as Extract<TimelineEvent, { type: "approval_request" }>;
    expect(req.status).toBe("pending");
    expect(req.riskLevel).toBe("medium");
  });

  it("maps StatusUpdate", () => {
    const event = mapStreamEvent({
      type: "StatusUpdate",
      payload: {
        token_usage: { output: 50, input_other: 10, input_cache_read: 5, input_cache_creation: 0 },
        context_usage: 200,
      },
    });
    expect(event?.type).toBe("status_update");
    const status = event as Extract<TimelineEvent, { type: "status_update" }>;
    expect(status.tokenCount).toBe(50);
    expect(status.inputTokenCount).toBe(15);
    expect(status.contextSize).toBe(200);
  });

  it("keeps missing StatusUpdate context unknown instead of fabricating zero", () => {
    const event = mapStreamEvent({
      type: "StatusUpdate",
      payload: {
        model: "deepseek-v4-flash",
        token_usage: { output: 206 },
      },
    });
    const status = event as Extract<TimelineEvent, { type: "status_update" }>;
    expect(status.contextSize).toBeUndefined();
    expect(status.contextLimit).toBeUndefined();
  });

  it("maps TurnChanges", () => {
    const event = mapStreamEvent({
      type: "TurnChanges",
      payload: {
        files: [{ path: "a.ts", additions: 3, deletions: 1 }],
      },
    });
    expect(event?.type).toBe("change_summary");
    const change = event as Extract<TimelineEvent, { type: "change_summary" }>;
    expect(change.files).toHaveLength(1);
    expect(change.additions).toBe(3);
    expect(change.deletions).toBe(1);
  });

  it("returns null for TurnChanges with no files", () => {
    expect(mapStreamEvent({ type: "TurnChanges", payload: { files: [] } })).toBeNull();
  });

  it("maps Error", () => {
    const event = mapStreamEvent({
      type: "Error",
      payload: { message: "Something broke" },
    });
    expect(event?.type).toBe("error");
    expect((event as Extract<TimelineEvent, { type: "error" }>).message).toBe("Something broke");
  });

  it("maps CompactionBegin and CompactionEnd", () => {
    const begin = mapStreamEvent({ type: "CompactionBegin", payload: {} });
    expect(begin?.type).toBe("compaction");
    expect((begin as Extract<TimelineEvent, { type: "compaction" }>).phase).toBe("begin");

    const end = mapStreamEvent({ type: "CompactionEnd", payload: {} });
    expect(end?.type).toBe("compaction");
    expect((end as Extract<TimelineEvent, { type: "compaction" }>).phase).toBe("end");
  });

  it("strips Kimix clarification instructions from user input", () => {
    const event = mapStreamEvent({
      type: "TurnBegin",
      payload: {
        user_input: "【Kimix 需求澄清工具：自动判断】\n\n用户原始需求：\n\nHello world",
      },
    });
    expect((event as Extract<TimelineEvent, { type: "user_message" }>).content.trim()).toBe("Hello world");
  });

  it("extracts images from array user_input", () => {
    const event = mapStreamEvent({
      type: "TurnBegin",
      payload: {
        user_input: [
          { type: "text", text: "Look at this" },
          { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
        ],
      },
    });
    const user = event as Extract<TimelineEvent, { type: "user_message" }>;
    expect(user.content).toBe("Look at this");
    expect(user.images).toHaveLength(1);
    expect(user.images[0].dataUrl).toBe("data:image/png;base64,abc");
  });

  it("extracts images from camelCase imageUrl user_input", () => {
    const event = mapStreamEvent({
      type: "TurnBegin",
      payload: {
        user_input: [
          { type: "text", text: "Look at this" },
          { type: "image_url", imageUrl: { url: "data:image/png;base64,abc", id: "shot.png" } },
        ],
      },
    });
    const user = event as Extract<TimelineEvent, { type: "user_message" }>;
    expect(user.content).toBe("Look at this");
    expect(user.images).toHaveLength(1);
    expect(user.images[0].name).toBe("shot.png");
    expect(user.images[0].dataUrl).toBe("data:image/png;base64,abc");
  });
});

describe("mergeEvents", () => {
  it("appends non-duplicate events", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "user_message", timestamp: 1, content: "Hi" },
    ];
    const incoming: TimelineEvent = { id: "2", type: "assistant_message", timestamp: 2, content: "Hello", isThinking: false, isComplete: true };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(2);
    expect(result[1].type).toBe("assistant_message");
  });

  it("merges streaming assistant content", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "assistant_message", timestamp: 1, content: "Hel", isThinking: false, isComplete: false },
    ];
    const incoming: TimelineEvent = { id: "2", type: "assistant_message", timestamp: 2, content: "lo", isThinking: false, isComplete: false };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(1);
    expect((result[0] as Extract<TimelineEvent, { type: "assistant_message" }>).content).toBe("Hello");
  });

  it("preserves exact assistant delta concatenation across a tool boundary", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "assistant_message", timestamp: 1, content: "先读取关键文件确认当前代码状态。", isThinking: false, isComplete: false },
      { id: "2", type: "tool_call", timestamp: 2, toolCallId: "tc-1", toolName: "Read", status: "completed", arguments: {}, rawArguments: "{}" },
      { id: "3", type: "tool_result", timestamp: 3, toolCallId: "tc-1", toolName: "Read", result: "ok" },
    ];
    const incoming: TimelineEvent = {
      id: "4",
      type: "assistant_message",
      timestamp: 4,
      content: "现在开始并行修复批次1的安全类P0问题。",
      isThinking: false,
      isComplete: false,
    };
    const result = mergeEvents(existing, incoming);
    const assistant = result[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(assistant.content).toBe("先读取关键文件确认当前代码状态。现在开始并行修复批次1的安全类P0问题。");
  });

  it("does not split an unfinished bold label across a tool boundary", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "assistant_message", timestamp: 1, content: "- **Achiever**：图鉴\n- **", isThinking: false, isComplete: false },
      { id: "2", type: "tool_call", timestamp: 2, toolCallId: "tc-1", toolName: "Read", status: "completed", arguments: {}, rawArguments: "{}" },
      { id: "3", type: "tool_result", timestamp: 3, toolCallId: "tc-1", toolName: "Read", result: "ok" },
    ];
    const incoming: TimelineEvent = {
      id: "4",
      type: "assistant_message",
      timestamp: 4,
      content: "Explorer**：骰子组合、法宝协同",
      isThinking: false,
      isComplete: false,
    };

    const result = mergeEvents(existing, incoming);
    const assistant = result[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(assistant.content).toBe("- **Achiever**：图鉴\n- **Explorer**：骰子组合、法宝协同");
  });

  it("does not split list text or words at arbitrary process boundaries", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "assistant_message", timestamp: 1, content: "4. **负面骰子标签化**：让玩家有 informed", isThinking: false, isComplete: false },
      { id: "2", type: "subagent", timestamp: 2, agentId: "agent-1", agentName: "reviewer", status: "completed", events: [] },
    ];
    const choice: TimelineEvent = { id: "3", type: "assistant_message", timestamp: 3, content: " choice。\n5. **奖励多样性**：增加构筑资源。\n\n# 二、2D 游戏分析（game", isThinking: false, isComplete: false };
    const afterChoice = mergeEvents(existing, choice);
    const boundary: TimelineEvent = { id: "4", type: "tool_call", timestamp: 4, toolCallId: "tc-2", toolName: "Read", status: "success", arguments: {} };
    const afterBoundary = mergeEvents(afterChoice, boundary);
    const suffix: TimelineEvent = { id: "5", type: "assistant_message", timestamp: 5, content: "-development/2d-games）", isThinking: false, isComplete: false };
    const result = mergeEvents(afterBoundary, suffix);
    const assistant = result[0] as Extract<TimelineEvent, { type: "assistant_message" }>;

    expect(assistant.content).toContain("informed choice。\n5. **奖励多样性**");
    expect(assistant.content).toContain("# 二、2D 游戏分析（game-development/2d-games）");
  });

  it("keeps inline code path fragments together across tool boundaries", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "assistant_message", timestamp: 1, content: "- `lib", isThinking: false, isComplete: false },
      { id: "2", type: "tool_call", timestamp: 2, toolCallId: "tc-1", toolName: "Read", status: "completed", arguments: {}, rawArguments: "{}" },
      { id: "3", type: "tool_result", timestamp: 3, toolCallId: "tc-1", toolName: "Read", result: "ok" },
    ];
    const firstIncoming: TimelineEvent = {
      id: "4",
      type: "assistant_message",
      timestamp: 4,
      content: "/features/run/p",
      isThinking: false,
      isComplete: false,
    };
    const firstResult = mergeEvents(existing, firstIncoming);
    const secondIncoming: TimelineEvent = {
      id: "5",
      type: "assistant_message",
      timestamp: 5,
      content: "resentation/run_page.dart`：新增按钮。",
      isThinking: false,
      isComplete: false,
    };
    const secondResult = mergeEvents(firstResult, secondIncoming);
    const assistant = secondResult[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(assistant.content).toBe("- `lib/features/run/presentation/run_page.dart`：新增按钮。");
  });

  it("completes assistant message on TurnEnd", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "assistant_message", timestamp: 1, content: "Done", isThinking: false, isComplete: false },
    ];
    const incoming: TimelineEvent = { id: "2", type: "assistant_message", timestamp: 2, content: "", isThinking: false, isComplete: true };
    const result = mergeEvents(existing, incoming);
    expect((result[0] as Extract<TimelineEvent, { type: "assistant_message" }>).isComplete).toBe(true);
  });

  it("does not keep implausible restored assistant durations", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "assistant_message", timestamp: 1_000, content: "Done", isThinking: false, isComplete: false },
    ];
    const incoming: TimelineEvent = {
      id: "2",
      type: "assistant_message",
      timestamp: 1_000 + 13 * 60 * 60 * 1000,
      content: "",
      isThinking: false,
      isComplete: true,
    };

    const result = mergeEvents(existing, incoming);
    const assistant = result[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(assistant.isComplete).toBe(true);
    expect(assistant.durationMs).toBeUndefined();
  });

  it("falls back to the turn start when restored assistant duration is too short", () => {
    const existing: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1_000, content: "开始处理" },
      { id: "assistant-1", type: "assistant_message", timestamp: 31_000, content: "Done", isThinking: false, isComplete: false },
    ];
    const incoming: TimelineEvent = {
      id: "turn-end",
      type: "assistant_message",
      timestamp: 32_000,
      content: "",
      isThinking: false,
      isComplete: true,
    };

    const result = mergeEvents(existing, incoming);
    const assistant = result[1] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(assistant.isComplete).toBe(true);
    expect(assistant.durationMs).toBe(31_000);
  });

  it("uses the whole user turn even when a valid assistant phase duration exists", () => {
    const existing: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1_000, content: "开始处理" },
      { id: "assistant-1", type: "assistant_message", timestamp: 21_000, content: "处理中", isThinking: false, isComplete: false, durationMs: 5_000 },
    ];
    const incoming: TimelineEvent = {
      id: "turn-end",
      type: "assistant_message",
      timestamp: 32_000,
      content: "",
      isThinking: false,
      isComplete: true,
      durationMs: 11_000,
    };

    const result = mergeEvents(existing, incoming);
    const assistant = result[1] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(assistant.durationMs).toBe(31_000);
  });

  it("merges streaming tool calls by toolCallId", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "tool_call", timestamp: 1, toolCallId: "tc-1", toolName: "read", status: "running", arguments: { path: "a" }, rawArguments: '{"path":"a"}' },
    ];
    const incoming: TimelineEvent = { id: "2", type: "tool_call", timestamp: 2, toolCallId: "tc-1", toolName: "read", status: "running", arguments: {}, rawArguments: '{"path":"b"}' };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(1);
    const tool = result[0] as Extract<TimelineEvent, { type: "tool_call" }>;
    expect(tool.rawArguments).toBe('{"path":"a"}{"path":"b"}');
  });

  it("does not duplicate identical full raw arguments for the same running tool", () => {
    const rawArguments = JSON.stringify({
      path: "D:/WORKS/Android Project/Project04/AGENTS.md",
      content: "# AGENTS.md\n\n".repeat(100),
    });
    const existing: TimelineEvent[] = [
      {
        id: "1",
        type: "tool_call",
        timestamp: 1,
        toolCallId: "tc-1",
        toolName: "Write",
        status: "running",
        arguments: { path: "D:/WORKS/Android Project/Project04/AGENTS.md", content: "# AGENTS.md\n\n" },
        rawArguments,
      },
    ];
    const incoming: TimelineEvent = {
      id: "2",
      type: "tool_call",
      timestamp: 2,
      toolCallId: "tc-1",
      toolName: "Write",
      status: "running",
      arguments: { path: "D:/WORKS/Android Project/Project04/AGENTS.md", content: "# AGENTS.md\n\n" },
      rawArguments,
    };

    const result = mergeEvents(existing, incoming);
    const tool = result[0] as Extract<TimelineEvent, { type: "tool_call" }>;
    expect(tool.rawArguments).toBe(rawArguments);
    expect(tool.rawArguments).not.toBe(`${rawArguments}${rawArguments}`);
  });

  it("deduplicates user messages", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "assistant_message", timestamp: 1, content: "Hi", isThinking: false, isComplete: true },
      { id: "2", type: "user_message", timestamp: 2, content: "Hello" },
    ];
    const incoming: TimelineEvent = { id: "3", type: "user_message", timestamp: 3, content: "Hello" };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(2);
  });

  it("deduplicates an optimistic built-in Skill command against the official echo", () => {
    const existing: TimelineEvent[] = [
      { id: "local-skill", type: "user_message", timestamp: 1_000, content: "/custom-theme 做一套蓝色海盐风格主题" },
    ];
    const incoming: TimelineEvent = {
      id: "official-skill",
      type: "user_message",
      timestamp: 2_000,
      content: "/custom-theme 做一套蓝色海盐风格主题",
    };

    const result = mergeEvents(existing, incoming);

    expect(result).toEqual(existing);
  });

  it("updates steer_message status on duplicate", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "steer_message", timestamp: 1, content: "Fix it", status: "sending" },
    ];
    const incoming: TimelineEvent = { id: "2", type: "steer_message", timestamp: 2, content: "Fix it", status: "sent" };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(1);
    expect((result[0] as Extract<TimelineEvent, { type: "steer_message" }>).status).toBe("sent");
  });

  it("keeps the previous assistant running when a steer is officially confirmed", () => {
    const existing: TimelineEvent[] = [
      { id: "assistant-1", type: "assistant_message", timestamp: 1_000, content: "Before", isThinking: true, isComplete: false },
      { id: "steer-1", type: "steer_message", timestamp: 2_000, content: "Fix it", status: "accepted" },
    ];
    const incoming: TimelineEvent = { id: "steer-2", type: "steer_message", timestamp: 4_000, content: "Fix it", status: "sent" };
    const result = mergeEvents(existing, incoming);
    const assistant = result[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    const steer = result[1] as Extract<TimelineEvent, { type: "steer_message" }>;

    expect(assistant.isComplete).toBe(false);
    expect(assistant.isThinking).toBe(true);
    expect(assistant.durationMs).toBeUndefined();
    expect(steer.status).toBe("sent");
  });

  it("closes the previous assistant timer when the post-steer assistant starts", () => {
    const existing: TimelineEvent[] = [
      { id: "assistant-1", type: "assistant_message", timestamp: 1_000, content: "Before", isThinking: true, isComplete: false },
      { id: "steer-1", type: "steer_message", timestamp: 2_000, content: "Fix it", status: "accepted" },
    ];
    const confirmed: TimelineEvent = { id: "steer-2", type: "steer_message", timestamp: 4_000, content: "Fix it", status: "sent" };
    const status: TimelineEvent = { id: "status-1", type: "status_update", timestamp: 4_500, message: "下一步准备中" };
    const nextAssistant: TimelineEvent = { id: "assistant-2", type: "assistant_message", timestamp: 5_000, content: "After", isThinking: false, isComplete: false };

    const afterConfirm = mergeEvents(existing, confirmed);
    const afterStatus = mergeEvents(afterConfirm, status);
    const result = mergeEvents(afterStatus, nextAssistant);
    const before = result[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    const after = result[3] as Extract<TimelineEvent, { type: "assistant_message" }>;

    expect((afterStatus[0] as Extract<TimelineEvent, { type: "assistant_message" }>).isComplete).toBe(false);
    expect(before.isComplete).toBe(true);
    expect(before.isThinking).toBe(false);
    expect(before.durationMs).toBe(4_000);
    expect(result[1].type).toBe("steer_message");
    expect(result[2].type).toBe("status_update");
    expect(after.content).toBe("After");
    expect(after.isComplete).toBe(false);
  });

  it("does not complete the post-steer assistant on an empty completion marker", () => {
    const existing: TimelineEvent[] = [
      { id: "assistant-1", type: "assistant_message", timestamp: 1_000, content: "Before", isThinking: false, isComplete: true },
      { id: "steer-1", type: "steer_message", timestamp: 2_000, content: "Fix it", status: "sent" },
      { id: "assistant-2", type: "assistant_message", timestamp: 3_000, content: "After", isThinking: false, isComplete: false },
    ];
    const incoming: TimelineEvent = {
      id: "turn-end",
      type: "assistant_message",
      timestamp: 4_000,
      content: "",
      isThinking: false,
      isComplete: true,
    };

    const result = mergeEvents(existing, incoming);
    const after = result[2] as Extract<TimelineEvent, { type: "assistant_message" }>;

    expect(after.content).toBe("After");
    expect(after.isComplete).toBe(false);
    expect(after.durationMs).toBeUndefined();
  });

  it("keeps local steer images when official confirmation has no images", () => {
    const existing: TimelineEvent[] = [
      {
        id: "1",
        type: "steer_message",
        timestamp: 1,
        content: "Fix it",
        images: [{ id: "img-1", name: "shot.png", dataUrl: "data:image/png;base64,local" }],
        status: "sending",
      },
    ];
    const incoming: TimelineEvent = { id: "2", type: "steer_message", timestamp: 2, content: "Fix it", status: "sent" };
    const result = mergeEvents(existing, incoming);
    const steer = result[0] as Extract<TimelineEvent, { type: "steer_message" }>;
    expect(steer.images).toHaveLength(1);
    expect(steer.images?.[0].dataUrl).toBe("data:image/png;base64,local");
  });

  it("keeps local steer images when official confirmation only has a file-like image id", () => {
    const existing: TimelineEvent[] = [
      {
        id: "1",
        type: "steer_message",
        timestamp: 1,
        content: "Fix it",
        images: [{ id: "img-1", name: "shot.png", dataUrl: "data:image/png;base64,local" }],
        status: "sending",
      },
    ];
    const incoming: TimelineEvent = {
      id: "2",
      type: "steer_message",
      timestamp: 2,
      content: "Fix it",
      images: [{ name: "image.png", dataUrl: "image.png" }],
      status: "sent",
    };
    const result = mergeEvents(existing, incoming);
    const steer = result[0] as Extract<TimelineEvent, { type: "steer_message" }>;
    expect(steer.images).toHaveLength(1);
    expect(steer.images?.[0].dataUrl).toBe("data:image/png;base64,local");
  });

  it("confirms local full steer message when official steer input is truncated", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "steer_message", timestamp: 1, content: "1、按照精确的\n2、输出在对话里就行", status: "sending" },
    ];
    const incoming: TimelineEvent = { id: "2", type: "steer_message", timestamp: 2, content: "1、按照精确的", status: "sent" };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(1);
    const steer = result[0] as Extract<TimelineEvent, { type: "steer_message" }>;
    expect(steer.content).toBe("1、按照精确的\n2、输出在对话里就行");
    expect(steer.status).toBe("sent");
  });

  it("keeps assistant chunks before an unconfirmed steer boundary", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "assistant_message", timestamp: 1, content: "Before", isThinking: false, isComplete: false },
      { id: "2", type: "steer_message", timestamp: 2, content: "Fix it", status: "sending" },
    ];
    const incoming: TimelineEvent = { id: "3", type: "assistant_message", timestamp: 3, content: "After", isThinking: false, isComplete: false };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(2);
    expect((result[0] as Extract<TimelineEvent, { type: "assistant_message" }>).content).toBe("BeforeAfter");
    expect(result[1].type).toBe("steer_message");
  });

  it("starts a new assistant chunk after a confirmed steer", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "assistant_message", timestamp: 1, content: "Before", isThinking: false, isComplete: false },
      { id: "2", type: "steer_message", timestamp: 2, content: "Fix it", status: "sent" },
    ];
    const incoming: TimelineEvent = { id: "3", type: "assistant_message", timestamp: 3, content: "After", isThinking: false, isComplete: false };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(3);
    const before = result[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(before.content).toBe("Before");
    expect(before.isComplete).toBe(true);
    expect(result[1].type).toBe("steer_message");
    expect((result[2] as Extract<TimelineEvent, { type: "assistant_message" }>).content).toBe("After");
  });

  it("keeps a post-steer file path tail with the previous assistant body", () => {
    const existing: TimelineEvent[] = [
      {
        id: "1",
        type: "assistant_message",
        timestamp: 1,
        content: "APK 还在 `tv_browser/build/app/outputs/flutter-apk/app-release.ap",
        isThinking: false,
        isComplete: false,
      },
      { id: "2", type: "steer_message", timestamp: 2, content: "目录下有无云端密钥", status: "sent" },
    ];
    const incoming: TimelineEvent = {
      id: "3",
      type: "assistant_message",
      timestamp: 3,
      content: "k。\n\n是否需要我现在按 AGENTS.md 的发布流程推到服务器？",
      isThinking: false,
      isComplete: false,
    };

    const result = mergeEvents(existing, incoming);
    const before = result[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    const after = result[2] as Extract<TimelineEvent, { type: "assistant_message" }>;

    expect(before.content).toBe("APK 还在 `tv_browser/build/app/outputs/flutter-apk/app-release.apk。");
    expect(before.isComplete).toBe(true);
    expect(result[1].type).toBe("steer_message");
    expect(after.content).toBe("是否需要我现在按 AGENTS.md 的发布流程推到服务器？");
  });

  it("keeps a post-steer markdown table continuation with the previous assistant body", () => {
    const existing: TimelineEvent[] = [
      {
        id: "1",
        type: "assistant_message",
        timestamp: 1,
        content: "查到了。\n\n关键发现\n\n项目目录下有一个旧 APK:\n\n| APK | 版本 | 日期 | min",
        isThinking: false,
        isComplete: false,
      },
      { id: "2", type: "steer_message", timestamp: 2, content: "顺便把该更新的 agent 文档也更新更新", status: "sent" },
    ];
    const tableContinuation: TimelineEvent = {
      id: "3",
      type: "assistant_message",
      timestamp: 3,
      content: "Sdk | compileSdk |\n| --- | --- | --- | --- | --- |\n| server/downloads/tv-browser-release.apk | 2.0.41+2000042 | 今天 | 24 | 36 |",
      isThinking: false,
      isComplete: false,
    };

    const result = mergeEvents(existing, tableContinuation);
    expect(result).toHaveLength(2);
    const before = result[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(before.content).toContain("| APK | 版本 | 日期 | minSdk | compileSdk |");
    expect(before.content).toContain("| server/downloads/tv-browser-release.apk | 2.0.41+2000042 | 今天 | 24 | 36 |");
    expect(before.isComplete).toBe(false);
    expect(result[1].type).toBe("steer_message");

    const nextAssistant: TimelineEvent = {
      id: "4",
      type: "assistant_message",
      timestamp: 4,
      content: "我会继续修正文档里的错误。",
      isThinking: false,
      isComplete: false,
    };
    const next = mergeEvents(result, nextAssistant);
    expect(next).toHaveLength(3);
    expect((next[0] as Extract<TimelineEvent, { type: "assistant_message" }>).isComplete).toBe(true);
    expect((next[2] as Extract<TimelineEvent, { type: "assistant_message" }>).content).toBe("我会继续修正文档里的错误。");
  });

  it("keeps a post-steer fenced markdown tail with the previous assistant body", () => {
    const existing: TimelineEvent[] = [
      {
        id: "1",
        type: "assistant_message",
        timestamp: 1,
        content: [
          "好的，下面是当前 `AGENTS.md` 的全文：",
          "",
          "```markdown",
          "# AGENTS.md",
          "",
          "## 环境与兼容性",
          "- `minSdkVersion` 由当前 Flutter SDK 默认决定",
          "- 老 TV 盒子如需兼容，需在 `android/app/build.gradle` 显式设置 `minSdkVersion 21",
        ].join("\n"),
        isThinking: false,
        isComplete: false,
      },
      { id: "2", type: "steer_message", timestamp: 2, content: "让你列出不是列出文件", status: "sent" },
    ];
    const tail: TimelineEvent = {
      id: "3",
      type: "assistant_message",
      timestamp: 3,
      content: [
        "`，并自行测试插件兼容性",
        "- `compileSdk` 只影响编译，不影响用户设备的最低安装版本",
        "",
        "## 常用命令",
        "- `flutter analyze` - 本地静态检查",
        "```",
        "",
        "你看看有没有需要再调整的地方。",
      ].join("\n"),
      isThinking: false,
      isComplete: false,
    };

    const result = mergeEvents(existing, tail);
    expect(result).toHaveLength(2);
    const before = result[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(before.content).toContain("`minSdkVersion 21`，并自行测试插件兼容性");
    expect(before.content).toContain("## 常用命令");
    expect(before.content).toContain("你看看有没有需要再调整的地方。");
    expect(result[1].type).toBe("steer_message");

    const nextAssistant: TimelineEvent = {
      id: "4",
      type: "assistant_message",
      timestamp: 4,
      content: "抱歉，理解错了。下面是修改建议条目。",
      isThinking: false,
      isComplete: false,
    };
    const next = mergeEvents(result, nextAssistant);
    expect(next).toHaveLength(3);
    expect((next[0] as Extract<TimelineEvent, { type: "assistant_message" }>).isComplete).toBe(true);
    expect((next[2] as Extract<TimelineEvent, { type: "assistant_message" }>).content).toBe("抱歉，理解错了。下面是修改建议条目。");
  });

  it("dedupes a post-steer assistant snapshot that repeats the previous fenced prefix", () => {
    const prefix = [
      "好的，下面是当前 `AGENTS.md` 的全文：",
      "",
      "```markdown",
      "# AGENTS.md",
      "",
      "## 技术栈",
      "- Flutter 3.44.0",
    ].join("\n");
    const existing: TimelineEvent[] = [
      {
        id: "1",
        type: "assistant_message",
        timestamp: 1,
        content: prefix,
        isThinking: false,
        isComplete: false,
      },
      { id: "2", type: "steer_message", timestamp: 2, content: "让你列出不是列出文件", status: "sent" },
    ];
    const snapshot: TimelineEvent = {
      id: "3",
      type: "assistant_message",
      timestamp: 3,
      content: `${prefix}\n- Riverpod / WebView\n\`\`\``,
      isThinking: false,
      isComplete: false,
    };

    const result = mergeEvents(existing, snapshot);
    expect(result).toHaveLength(2);
    const before = result[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(before.content).toBe(`${prefix}\n- Riverpod / WebView\n\`\`\``);
    expect(before.content.match(/好的，下面是当前/g)).toHaveLength(1);
  });

  it("keeps a post-steer markdown table cell continuation with the previous assistant body", () => {
    const existing: TimelineEvent[] = [
      {
        id: "1",
        type: "assistant_message",
        timestamp: 1,
        content: [
          "确实，这两轮提交信息太笼统了，后面查历史时会看不懂。",
          "",
          "那两轮实际做了什么",
          "",
          "| 原 Commit | 原 Message | 实际内容 |",
          "| --- | --- | --- |",
          "| 9848517 | \"修复已知问题\" | 新增 browser-selection.js、重构 browser_page.dart、新增 player_error_card.dart、将 formatClock / formatDuration |",
        ].join("\n"),
        isThinking: false,
        isComplete: false,
      },
      { id: "2", type: "steer_message", timestamp: 2, content: "agent 文档里要把这个约束好", status: "sent" },
    ];
    const continuation: TimelineEvent = {
      id: "3",
      type: "assistant_message",
      timestamp: 3,
      content: [
        "抽到 core/formatters.dart、首页搜索支持缓存未命中时联网查找 |",
        "| 28711dd | \"修复已知问题\" | MainActivity.kt 中 BACK 键不再拦截，放行给 Flutter PopScope 处理返回逻辑 |",
        "",
        "修正方案",
        "",
        "我倾向于只重写 commit message，不拆分历史。",
      ].join("\n"),
      isThinking: false,
      isComplete: false,
    };

    const result = mergeEvents(existing, continuation);
    expect(result).toHaveLength(3);
    const before = result[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    const after = result[2] as Extract<TimelineEvent, { type: "assistant_message" }>;

    expect(before.content).toContain("formatClock / formatDuration 抽到 core/formatters.dart");
    expect(before.content).toContain("| 28711dd | \"修复已知问题\" | MainActivity.kt 中 BACK 键不再拦截");
    expect(before.content).not.toContain("formatDuration |抽到");
    expect(before.isComplete).toBe(true);
    expect(result[1].type).toBe("steer_message");
    expect(after.content).toBe("修正方案\n\n我倾向于只重写 commit message，不拆分历史。");
  });

  it("does not merge a new post-steer markdown table into the previous assistant body", () => {
    const existing: TimelineEvent[] = [
      {
        id: "1",
        type: "assistant_message",
        timestamp: 1,
        content: [
          "已有记录如下：",
          "",
          "| 文件 | 状态 |",
          "| --- | --- |",
          "| AGENTS.md | 已更新 |",
        ].join("\n"),
        isThinking: false,
        isComplete: false,
      },
      { id: "2", type: "steer_message", timestamp: 2, content: "再列一下后续事项", status: "sent" },
    ];
    const incoming: TimelineEvent = {
      id: "3",
      type: "assistant_message",
      timestamp: 3,
      content: [
        "| 后续事项 | 状态 |",
        "| --- | --- |",
        "| 补 release notes | 待办 |",
      ].join("\n"),
      isThinking: false,
      isComplete: false,
    };

    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(3);
    expect((result[0] as Extract<TimelineEvent, { type: "assistant_message" }>).content).toContain("| AGENTS.md | 已更新 |");
    expect((result[2] as Extract<TimelineEvent, { type: "assistant_message" }>).content).toContain("| 后续事项 | 状态 |");
  });

  it("keeps assistant chunks before an accepted steer until official confirmation arrives", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "assistant_message", timestamp: 1, content: "Before", isThinking: false, isComplete: false },
      { id: "2", type: "steer_message", timestamp: 2, content: "Fix it", status: "accepted" },
    ];
    const incoming: TimelineEvent = { id: "3", type: "assistant_message", timestamp: 3, content: "After", isThinking: false, isComplete: false };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(2);
    expect((result[0] as Extract<TimelineEvent, { type: "assistant_message" }>).content).toBe("BeforeAfter");
    const steer = result[1] as Extract<TimelineEvent, { type: "steer_message" }>;
    expect(steer.status).toBe("accepted");
  });

  it("keeps tool calls before an unconfirmed trailing steer", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "steer_message", timestamp: 1, content: "Fix it", status: "sending" },
    ];
    const incoming: TimelineEvent = { id: "2", type: "tool_call", timestamp: 2, toolCallId: "t1", toolName: "read", status: "running", arguments: {}, rawArguments: "" };
    const result = mergeEvents(existing, incoming);
    expect(result.map((event) => event.type)).toEqual(["tool_call", "steer_message"]);
  });

  it("keeps status updates before an accepted trailing steer", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "steer_message", timestamp: 1, content: "Fix it", status: "accepted" },
    ];
    const incoming: TimelineEvent = { id: "2", type: "status_update", timestamp: 2, message: "步骤开始" };
    const result = mergeEvents(existing, incoming);
    expect(result.map((event) => event.type)).toEqual(["status_update", "steer_message"]);
    expect((result[1] as Extract<TimelineEvent, { type: "steer_message" }>).status).toBe("accepted");
  });

  it("merges question_request by requestId", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "question_request", timestamp: 1, requestId: "q1", toolCallId: "", questions: [], status: "pending" },
    ];
    const incoming: TimelineEvent = { id: "2", type: "question_request", timestamp: 2, requestId: "q1", toolCallId: "", questions: [], status: "answered" };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(1);
    expect((result[0] as Extract<TimelineEvent, { type: "question_request" }>).status).toBe("answered");
  });

  it("updates tool_result and linked tool_call", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "tool_call", timestamp: 1, toolCallId: "tc-1", toolName: "read", status: "running", arguments: {} },
    ];
    const incoming: TimelineEvent = { id: "2", type: "tool_result", timestamp: 2, toolCallId: "tc-1", toolName: "read", result: "file content" };
    const result = mergeEvents(existing, incoming);
    const toolCall = result[0] as Extract<TimelineEvent, { type: "tool_call" }>;
    expect(toolCall.status).toBe("success");
    expect(toolCall.result).toBe("file content");
    expect(result).toHaveLength(1); // tool_call absorbed the result; no diff/todo appended
  });

  it("does not turn a late recovery interruption into hours of tool duration", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "tool_call", timestamp: 1_000, toolCallId: "tc-stale", toolName: "Bash", status: "running", arguments: {} },
    ];
    const incoming: TimelineEvent = {
      id: "2",
      type: "tool_result",
      timestamp: 8 * 60 * 60 * 1000,
      toolCallId: "tc-stale",
      toolName: "Bash",
      result: {
        output: "Tool execution was interrupted before its result was recorded.",
        isError: true,
      },
    };

    const result = mergeEvents(existing, incoming);
    const toolCall = result[0] as Extract<TimelineEvent, { type: "tool_call" }>;
    expect(toolCall.status).toBe("error");
    expect(toolCall.durationMs).toBeUndefined();
  });

  it("adds change summary and diff when tool_result contains structured diff", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "tool_call", timestamp: 1, toolCallId: "tc-1", toolName: "edit", status: "running", arguments: {} },
    ];
    const incoming: TimelineEvent = {
      id: "2",
      type: "tool_result",
      timestamp: 2,
      toolCallId: "tc-1",
      toolName: "edit",
      result: "ok",
      display: { diff: { path: "src/app.ts", oldText: "before", newText: "after\nmore" } },
    };
    const result = mergeEvents(existing, incoming);
    expect(result.map((event) => event.type)).toEqual(["tool_call", "change_summary", "diff"]);
    const change = result[1] as Extract<TimelineEvent, { type: "change_summary" }>;
    expect(change.files[0].path).toBe("src/app.ts");
    expect(change.additions).toBe(1);
    const diff = result[2] as Extract<TimelineEvent, { type: "diff" }>;
    expect(diff.filePath).toBe("src/app.ts");
  });

  it("adds change summary for successful Write tool without structured diff", () => {
    const existing: TimelineEvent[] = [
      {
        id: "1",
        type: "tool_call",
        timestamp: 1,
        toolCallId: "tc-1",
        toolName: "Write",
        status: "running",
        arguments: { path: "plans/next.md", content: "a\nb\n" },
      },
    ];
    const incoming: TimelineEvent = {
      id: "2",
      type: "tool_result",
      timestamp: 2,
      toolCallId: "tc-1",
      toolName: "Write",
      result: "Wrote 4 bytes",
    };
    const result = mergeEvents(existing, incoming);
    expect(result.map((event) => event.type)).toEqual(["tool_call", "change_summary"]);
    const change = result[1] as Extract<TimelineEvent, { type: "change_summary" }>;
    expect(change.files[0].path).toBe("plans/next.md");
    expect(change.additions).toBe(2);
  });

  it("does not add change summary for successful Read tool with a path", () => {
    const existing: TimelineEvent[] = [
      {
        id: "1",
        type: "tool_call",
        timestamp: 1,
        toolCallId: "tc-1",
        toolName: "Read",
        status: "running",
        arguments: { path: "plans/next.md" },
      },
    ];
    const incoming: TimelineEvent = {
      id: "2",
      type: "tool_result",
      timestamp: 2,
      toolCallId: "tc-1",
      toolName: "Read",
      result: "content",
    };
    const result = mergeEvents(existing, incoming);
    expect(result.map((event) => event.type)).toEqual(["tool_call"]);
  });

  it("replaces consecutive status_update", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "status_update", timestamp: 1, tokenCount: 10, inputTokenCount: 5, contextSize: 100, contextLimit: 256000 },
    ];
    const incoming: TimelineEvent = { id: "2", type: "status_update", timestamp: 2, tokenCount: 20, inputTokenCount: 10, contextSize: 200, contextLimit: 256000 };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(1);
    expect((result[0] as Extract<TimelineEvent, { type: "status_update" }>).tokenCount).toBe(20);
  });

  it("merges subagent events by agentName", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "subagent", timestamp: 1, agentName: "explorer", status: "running", events: [] },
    ];
    const incoming: TimelineEvent = { id: "2", type: "subagent", timestamp: 2, agentName: "explorer", status: "completed", events: [] };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(1);
    expect((result[0] as Extract<TimelineEvent, { type: "subagent" }>).status).toBe("completed");
  });

  it("appends change_summary after moving last status_update before it", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "status_update", timestamp: 1, tokenCount: 10, inputTokenCount: 5, contextSize: 100, contextLimit: 256000 },
      { id: "2", type: "assistant_message", timestamp: 2, content: "Done", isThinking: false, isComplete: true },
    ];
    const incoming: TimelineEvent = { id: "3", type: "change_summary", timestamp: 3, files: [{ path: "a.ts", additions: 1, deletions: 0 }], additions: 1, deletions: 0 };
    const result = mergeEvents(existing, incoming);
    expect(result[result.length - 1].type).toBe("change_summary");
    expect(result[result.length - 2].type).toBe("status_update");
  });
});

describe("mapHistoryEvents", () => {
  it("collapses internal user-triggered Skill instructions into the original slash command", () => {
    const result = mapHistoryEvents([{
      type: "TurnBegin",
      payload: {
        user_input: [{
          type: "text",
          text: 'User activated the skill "find-skills". Follow the loaded skill instructions.\n\n<kimi-skill-loaded name="find-skills" trigger="user-slash" args="找一个游戏策划 skill">\ninternal instructions\n</kimi-skill-loaded>',
        }],
      },
    }]);

    expect(result).toMatchObject([{ type: "user_message", content: "/skill:find-skills 找一个游戏策划 skill" }]);
  });

  it("keeps model-triggered Skill instructions out of user message bubbles", () => {
    const result = mapHistoryEvents([{
      type: "TurnBegin",
      payload: {
        user_input: 'Skill tool loaded instructions.\n\n<kimi-skill-loaded name="game-development" trigger="model-tool" args="分析项目">\ninternal instructions\n</kimi-skill-loaded>',
      },
    }]);

    expect(result).toMatchObject([{ type: "status_update", message: "已调用 Skill：game-development" }]);
  });

  it("maps an array of raw events", () => {
    const raw = [
      { type: "TurnBegin", payload: { user_input: "Hi" } },
      { type: "ContentPart", payload: { type: "text", text: "Hello" } },
      { type: "TurnEnd", payload: {} },
    ];
    const result = mapHistoryEvents(raw);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("user_message");
    expect(result[1].type).toBe("assistant_message");
    expect((result[1] as Extract<TimelineEvent, { type: "assistant_message" }>).isComplete).toBe(true);
  });

  it("filters out null mappings", () => {
    const raw = [
      { type: "TurnBegin", payload: { user_input: "" } },
      { type: "ContentPart", payload: { type: "text", text: "Hello" } },
    ];
    const result = mapHistoryEvents(raw);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("assistant_message");
  });

  it("handles empty array", () => {
    expect(mapHistoryEvents([])).toEqual([]);
  });

  it("replays native kimi-code compaction without finishing the active assistant", () => {
    const result = mapHistoryEvents([
      { type: "assistant.delta", payload: { delta: "压缩前" }, time: 100 },
      { type: "compaction.completed", payload: {}, time: 120 },
      { type: "assistant.delta", payload: { delta: "继续输出后半段内容" }, time: 140 },
      { type: "tool.call.started", payload: { toolCallId: "call-1", name: "Bash", args: { command: "pwd" } }, time: 150 },
      { type: "tool.progress", payload: { toolCallId: "call-1", update: { kind: "stdout", text: "D:/WORKS\n" } }, time: 160 },
      { type: "turn.ended", payload: {}, time: 200 },
    ]);

    const assistant = result.find((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => event.type === "assistant_message");
    const compaction = result.find((event): event is Extract<TimelineEvent, { type: "compaction" }> => event.type === "compaction");
    const tool = result.find((event): event is Extract<TimelineEvent, { type: "tool_call" }> => event.type === "tool_call");
    expect(assistant?.content).toBe("压缩前继续输出后半段内容");
    expect(assistant?.isComplete).toBe(true);
    expect(compaction?.phase).toBe("end");
    expect(tool?.status).toBe("success");
    expect(tool?.result).toBe("D:/WORKS\n");
  });

  it("maps official Server snapshot history replay into user and assistant messages", () => {
    const result = mapHistoryEvents([
      {
        type: "TurnBegin",
        payload: {
          snapshotReplay: "history",
          user_input: [{ type: "text", text: "用户历史问题" }],
        },
        time: "2026-06-21T10:00:00.000Z",
      },
      {
        type: "content.part",
        payload: {
          snapshotReplay: "history",
          part: { type: "text", text: "官方历史回答" },
        },
        time: "2026-06-21T10:00:01.000Z",
      },
      {
        type: "turn.ended",
        payload: { snapshotReplay: "history" },
        time: "2026-06-21T10:00:02.000Z",
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: "user_message", content: "用户历史问题" });
    expect(result[1]).toMatchObject({ type: "assistant_message", content: "官方历史回答", isComplete: true });
  });
});
