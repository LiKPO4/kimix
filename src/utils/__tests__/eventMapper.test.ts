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

  it("separates assistant content resumed after a tool boundary", () => {
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
    expect(assistant.content).toBe("先读取关键文件确认当前代码状态。\n\n现在开始并行修复批次1的安全类P0问题。");
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

  it("deduplicates user messages", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "assistant_message", timestamp: 1, content: "Hi", isThinking: false, isComplete: true },
      { id: "2", type: "user_message", timestamp: 2, content: "Hello" },
    ];
    const incoming: TimelineEvent = { id: "3", type: "user_message", timestamp: 3, content: "Hello" };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(2);
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

  it("closes the previous assistant timer when a steer is officially confirmed", () => {
    const existing: TimelineEvent[] = [
      { id: "assistant-1", type: "assistant_message", timestamp: 1_000, content: "Before", isThinking: true, isComplete: false },
      { id: "steer-1", type: "steer_message", timestamp: 2_000, content: "Fix it", status: "accepted" },
    ];
    const incoming: TimelineEvent = { id: "steer-2", type: "steer_message", timestamp: 4_000, content: "Fix it", status: "sent" };
    const result = mergeEvents(existing, incoming);
    const assistant = result[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    const steer = result[1] as Extract<TimelineEvent, { type: "steer_message" }>;

    expect(assistant.isComplete).toBe(true);
    expect(assistant.isThinking).toBe(false);
    expect(assistant.durationMs).toBe(3_000);
    expect(steer.status).toBe("sent");
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
    expect((result[0] as Extract<TimelineEvent, { type: "assistant_message" }>).content).toBe("Before");
    expect(result[1].type).toBe("steer_message");
    expect((result[2] as Extract<TimelineEvent, { type: "assistant_message" }>).content).toBe("After");
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
});
