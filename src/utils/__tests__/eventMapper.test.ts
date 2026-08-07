import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapStreamEvent, mergeEvents, mapHistoryEvents, preserveLocalUserMediaInCanonicalHistory, deduplicateTimelineEvents, mergeAssistantThinkingText, mergeAssistantThinkingParts, mergeAssistantContentWithOffset } from "../eventMapper";
import * as reportError from "@/utils/reportError";
import type { TimelineEvent } from "@/types/ui";
import { buildRoomDeliveryPrompt } from "../roomContextBridge";

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

  it("folds goal-continuation wire TurnBegin (origin or text prefix) into status_update", () => {
    const byOrigin = mapStreamEvent({
      type: "TurnBegin",
      payload: {
        user_input: "Continue working toward the active goal.",
        origin: { kind: "system_trigger", name: "goal_continuation" },
      },
    });
    const byPrefix = mapStreamEvent({
      type: "TurnBegin",
      payload: { user_input: "The previous goal turn reached the per-turn step limit. 继续执行。" },
    });

    expect(byOrigin).toMatchObject({ type: "status_update", message: "目标续跑", source: "runtime", tone: "info" });
    expect(byPrefix).toMatchObject({ type: "status_update", message: "目标续跑", source: "runtime", tone: "info" });
  });

  it("keeps Resume-the-goal and ordinary wire TurnBegin as user_message", () => {
    const resume = mapStreamEvent({
      type: "TurnBegin",
      payload: { user_input: "Resume the active goal." },
    });
    const ordinary = mapStreamEvent({
      type: "TurnBegin",
      payload: { user_input: "Continue working on this task." },
    });

    expect(resume?.type).toBe("user_message");
    expect(ordinary?.type).toBe("user_message");
  });

  it("hides room context bridge content from the visible user message", () => {
    const event = mapStreamEvent({
      type: "TurnBegin",
      payload: {
        user_input: buildRoomDeliveryPrompt(
          "请检查最新改动",
          {
            mode: "last",
            bridgeId: "room-context:agent-2",
            entryIds: ["assistant:old"],
            content: "旧 Agent：\n历史正文",
            contentChars: 16,
            createdAt: 1,
          },
          { displayName: "Reviewer", mentionName: "reviewer" },
          {
            roomMessageId: "message:review",
            agentTurnId: "turn:review",
            dispatchAttemptId: "attempt:review",
          },
        ),
      },
    });
    expect(event).toMatchObject({
      type: "user_message",
      content: "请检查最新改动",
      roomMessageId: "message:review",
      agentTurnId: "turn:review",
      dispatchAttemptId: "attempt:review",
    });
  });

  it("restores server base64 image parts from TurnBegin history", () => {
    const event = mapStreamEvent({
      type: "TurnBegin",
      payload: {
        user_input: [
          { type: "text", text: "看看这张图" },
          { type: "image", source: { kind: "base64", media_type: "image/png", data: "AA==" } },
        ],
      },
    }) as Extract<TimelineEvent, { type: "user_message" }>;

    expect(event.content).toBe("看看这张图");
    expect(event.images).toEqual([{ name: "图片 2", dataUrl: "data:image/png;base64,AA==" }]);
  });

  it("restores base64 and file-backed videos from TurnBegin history", () => {
    const event = mapStreamEvent({
      type: "TurnBegin",
      payload: {
        user_input: [
          { type: "video", source: { kind: "base64", media_type: "video/webm", data: "AA==" } },
          { type: "video", source: { kind: "file", file_id: "file-video" } },
        ],
      },
    }) as Extract<TimelineEvent, { type: "user_message" }>;

    expect(event.content).toBe("");
    expect(event.images).toEqual([
      { kind: "video", name: "视频 1", mediaType: "video/webm", dataUrl: "data:video/webm;base64,AA==" },
      { kind: "video", name: "视频 2", mediaType: "video/mp4", fileId: "file-video" },
    ]);
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
      payload: { type: "thinking", thinking: "Let me think...", signature: "sig-content" },
    });
    expect(event?.type).toBe("assistant_message");
    const assistant = event as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(assistant.thinking).toBe("Let me think...");
    expect(assistant.thinkingParts?.[0].signature).toBe("sig-content");
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

  it("merges the server-confirm steer sent frame into the pending accepted steer idempotently", () => {
    const existing: TimelineEvent[] = [
      { id: "steer-local", type: "steer_message", timestamp: 1_000, content: "顺便把版本迭代到162行吗", status: "accepted" },
    ];
    const confirm: TimelineEvent = {
      id: "steer-confirm",
      type: "steer_message",
      timestamp: 2_000,
      content: "顺便把版本迭代到162行吗",
      status: "sent",
    };
    const first = mergeEvents(existing, confirm);
    expect(first).toHaveLength(1);
    expect((first[0] as Extract<TimelineEvent, { type: "steer_message" }>).status).toBe("sent");
    // 幂等：确认帧重复合并（重放/重试）不产生第二条气泡、状态不回退
    const second = mergeEvents(first, confirm);
    expect(second).toHaveLength(1);
    expect((second[0] as Extract<TimelineEvent, { type: "steer_message" }>).status).toBe("sent");
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

  it("maps ApprovalRequest plan review display", () => {
    const event = mapStreamEvent({
      type: "ApprovalRequest",
      payload: {
        id: "plan-1",
        sender: "ExitPlanMode",
        display: { kind: "plan_review", plan: "# Plan", path: ".kimi/plans/plan.md" },
      },
    });
    const req = event as Extract<TimelineEvent, { type: "approval_request" }>;
    expect(req.description).toBe("审阅计划");
    expect(req.display?.kind).toBe("plan_review");
    expect(req.display?.path).toBe(".kimi/plans/plan.md");
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
    expect(status.contextLimit).toBeUndefined();
  });

  it("hides official attachment notices and restores the file metadata", () => {
    const fileId = "f_550e8400-e29b-41d4-a716-446655440000";
    const path = `C:\\sessions\\s1\\attachments\\${fileId}-report.pdf`;
    const event = mapStreamEvent({
      type: "TurnBegin",
      payload: {
        user_input: [
          { type: "text", text: "请总结" },
          {
            type: "text",
            text: `Attached file "report.pdf" (application/pdf, 24 bytes): ${path} — open it with the Read tool`,
          },
        ],
      },
    }) as Extract<TimelineEvent, { type: "user_message" }>;

    expect(event.content).toBe("请总结");
    expect(event.images).toEqual([{
      kind: "file",
      name: "report.pdf",
      filePath: path,
      fileId,
      mediaType: "application/pdf",
      size: 24,
    }]);
  });

  it("restores structured generic file parts", () => {
    const event = mapStreamEvent({
      type: "TurnBegin",
      payload: {
        user_input: [
          { type: "text", text: "查看附件" },
          {
            type: "file",
            file_id: "f_01KWK39A0ZC8R2ATZEQMD8716C",
            name: "spec.yaml",
            media_type: "application/yaml",
            size: 42,
          },
        ],
      },
    }) as Extract<TimelineEvent, { type: "user_message" }>;

    expect(event.content).toBe("查看附件");
    expect(event.images).toEqual([{
      kind: "file",
      name: "spec.yaml",
      fileId: "f_01KWK39A0ZC8R2ATZEQMD8716C",
      filePath: undefined,
      mediaType: "application/yaml",
      size: 42,
    }]);
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

  it("keeps missing TurnChanges line statistics unknown", () => {
    const event = mapStreamEvent({
      type: "TurnChanges",
      payload: { files: [{ path: "a.ts" }] },
    }) as Extract<TimelineEvent, { type: "change_summary" }>;

    expect(event.files).toEqual([{ path: "a.ts" }]);
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

  it("maps SubagentEvent with full legacy fields", () => {
    const event = mapStreamEvent({
      type: "SubagentEvent",
      payload: {
        agent_id: "agent-3",
        agent_name: "reviewer",
        parent_tool_call_id: "call-9",
        description: "审查样式",
        swarm_index: 2,
        status: "completed",
        result_summary: "发现两项问题",
        error: "lint 失败",
      },
    });
    expect(event?.type).toBe("subagent");
    const subagent = event as Extract<TimelineEvent, { type: "subagent" }>;
    expect(subagent.agentId).toBe("agent-3");
    expect(subagent.agentName).toBe("reviewer");
    expect(subagent.parentToolCallId).toBe("call-9");
    expect(subagent.description).toBe("审查样式");
    expect(subagent.swarmIndex).toBe(2);
    expect(subagent.status).toBe("completed");
    expect(subagent.resultSummary).toBe("发现两项问题");
    expect(subagent.error).toBe("lint 失败");
  });

  it("maps SubagentEvent camelCase fields and keeps missing fields undefined", () => {
    const event = mapStreamEvent({
      type: "SubagentEvent",
      payload: { agentId: "agent-4", toolCallId: "call-10", swarmIndex: 1 },
    }) as Extract<TimelineEvent, { type: "subagent" }>;

    expect(event.agentId).toBe("agent-4");
    expect(event.parentToolCallId).toBe("call-10");
    expect(event.swarmIndex).toBe(1);
    expect(event.agentName).toBe("子代理");
    expect(event.description).toBeUndefined();
    expect(event.resultSummary).toBeUndefined();
    expect(event.error).toBeUndefined();
  });

  it("maps CompactionBegin and CompactionEnd", () => {
    const begin = mapStreamEvent({ type: "CompactionBegin", payload: {} });
    expect(begin?.type).toBe("compaction");
    expect((begin as Extract<TimelineEvent, { type: "compaction" }>).phase).toBe("begin");

    const end = mapStreamEvent({ type: "CompactionEnd", payload: {} });
    expect(end?.type).toBe("compaction");
    expect((end as Extract<TimelineEvent, { type: "compaction" }>).phase).toBe("end");

    const endWithSummary = mapStreamEvent({
      type: "CompactionEnd",
      payload: { summary: "保留用户目标和已完成文件列表。" },
    });
    expect((endWithSummary as Extract<TimelineEvent, { type: "compaction" }>).summary).toBe("保留用户目标和已完成文件列表。");
  });

  it("maps official full_compaction wire events", () => {
    const begin = mapStreamEvent({ type: "full_compaction.begin", source: "manual", time: 100 });
    const end = mapStreamEvent({ type: "full_compaction.complete", time: 200 });
    const cancelled = mapStreamEvent({ type: "full_compaction.cancel", time: 300 });

    expect(begin).toMatchObject({ type: "compaction", phase: "begin", source: "manual", timestamp: 100 });
    expect(end).toMatchObject({ type: "compaction", phase: "end", outcome: "completed", timestamp: 200 });
    expect(cancelled).toMatchObject({ type: "compaction", phase: "end", outcome: "cancelled", timestamp: 300 });
  });

  it("strips Kimix clarification instructions from user input", () => {
    for (const header of ["【Kimix 需求澄清工具：自动判断】", "【Kimix 需求澄清：自动判断】"]) {
      const event = mapStreamEvent({
        type: "TurnBegin",
        payload: {
          user_input: `${header}\n请先判断需求是否明确。\n\n用户原始需求：\n\nHello world`,
        },
      });
      expect((event as Extract<TimelineEvent, { type: "user_message" }>).content.trim()).toBe("Hello world");
    }
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
    expect(user.images![0].dataUrl).toBe("data:image/png;base64,abc");
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
    expect(user.images![0].name).toBe("shot.png");
    expect(user.images![0].dataUrl).toBe("data:image/png;base64,abc");
  });
});

describe("mergeEvents", () => {
  it("carries an automatic compaction source onto a source-less cancellation", () => {
    const begin: TimelineEvent = {
      id: "compact-begin",
      type: "compaction",
      timestamp: 100,
      phase: "begin",
      source: "auto",
    };
    const cancelled: TimelineEvent = {
      id: "compact-cancel",
      type: "compaction",
      timestamp: 200,
      phase: "end",
      outcome: "cancelled",
    };

    expect(mergeEvents([begin], cancelled)).toEqual([
      begin,
      { ...cancelled, source: "auto" },
    ]);
  });

  it("appends non-duplicate events", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "user_message", timestamp: 1, content: "Hi" },
    ];
    const incoming: TimelineEvent = { id: "2", type: "assistant_message", timestamp: 2, content: "Hello", isThinking: false, isComplete: true };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(2);
    expect(result[1].type).toBe("assistant_message");
  });

  it("replaces open assistant body when a complete frame carries full content (no greeting double)", () => {
    const existing: TimelineEvent[] = [
      { id: "u1", type: "user_message", timestamp: 1, content: "hi", agentTurnId: "turn-1" },
      {
        id: "a-open",
        type: "assistant_message",
        timestamp: 2,
        content: "你好霖江路\n\n接手中：先读",
        isThinking: false,
        isComplete: false,
        agentTurnId: "turn-1",
      },
    ];
    const complete: TimelineEvent = {
      id: "a-done",
      type: "assistant_message",
      timestamp: 3,
      content: "你好霖江路\n\n接手中：先读 TASK_STATE.md\n\n## 本轮目标\n对齐仓库",
      isThinking: false,
      isComplete: true,
      agentTurnId: "turn-1",
    };
    const result = mergeEvents(existing, complete);
    const assistant = result.find((event) => event.type === "assistant_message");
    expect(assistant).toMatchObject({ isComplete: true });
    expect(assistant && assistant.type === "assistant_message" ? assistant.content : "").toBe(
      "你好霖江路\n\n接手中：先读 TASK_STATE.md\n\n## 本轮目标\n对齐仓库",
    );
    expect(assistant && assistant.type === "assistant_message" ? assistant.content.match(/你好霖江路/g)?.length : 0).toBe(1);
  });

  it("overlap-merges live deltas into the open assistant without doubling prefixes", () => {
    const existing: TimelineEvent[] = [
      {
        id: "a-open",
        type: "assistant_message",
        timestamp: 2,
        content: "你好霖江路",
        isThinking: false,
        isComplete: false,
        agentTurnId: "turn-1",
      },
    ];
    const cumulative: TimelineEvent = {
      id: "a-delta",
      type: "assistant_message",
      timestamp: 3,
      content: "你好霖江路\n\n本轮目标",
      isThinking: false,
      isComplete: false,
      agentTurnId: "turn-1",
    };
    const result = mergeEvents(existing, cumulative);
    const assistant = result[0];
    expect(assistant.type === "assistant_message" && assistant.content).toBe("你好霖江路\n\n本轮目标");
  });

  it("keeps local user image data when the official echo only has an image file id", () => {
    const existing: TimelineEvent[] = [
      {
        id: "1",
        type: "user_message",
        timestamp: 1,
        content: "看这张图",
        images: [{ id: "img-1", name: "shot.png", dataUrl: "data:image/png;base64,local" }],
      },
    ];
    const incoming: TimelineEvent = {
      id: "2",
      type: "user_message",
      timestamp: 2,
      content: [
        "看这张图",
        "附件文件：",
        "1. image.png",
        "   绝对路径：未能从系统拖拽事件读取，请提示用户重新选择文件",
      ].join("\n"),
      images: [{ name: "image.png" }],
    };
    const result = mergeEvents(existing, incoming);
    const user = result[0] as Extract<TimelineEvent, { type: "user_message" }>;
    expect(result).toHaveLength(1);
    expect(user.images?.[0].dataUrl).toBe("data:image/png;base64,local");
  });

  it("keeps the local echo when a pure video message replays with only a file id", () => {
    const existing: TimelineEvent[] = [
      {
        id: "1",
        type: "user_message",
        timestamp: 1,
        content: "",
        images: [{ kind: "video", name: "录制.mp4", dataUrl: "data:video/mp4;base64,local" }],
      },
    ];
    const incoming: TimelineEvent = {
      id: "2",
      type: "user_message",
      timestamp: 2,
      content: "",
      images: [{ kind: "video", name: "视频 1", fileId: "file-video-1", mediaType: "video/mp4" }],
    };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(1);
    const user = result[0] as Extract<TimelineEvent, { type: "user_message" }>;
    expect(user.images?.[0].dataUrl).toBe("data:video/mp4;base64,local");
  });

  it("still appends a pure media echo whose media shape differs from the local message", () => {
    const existing: TimelineEvent[] = [
      {
        id: "1",
        type: "user_message",
        timestamp: 1,
        content: "",
        images: [{ kind: "video", name: "录制.mp4", dataUrl: "data:video/mp4;base64,local" }],
      },
    ];
    const incoming: TimelineEvent = {
      id: "2",
      type: "user_message",
      timestamp: 2,
      content: "",
      images: [
        { kind: "video", name: "视频 1", fileId: "file-video-1", mediaType: "video/mp4" },
        { kind: "video", name: "视频 2", fileId: "file-video-2", mediaType: "video/mp4" },
      ],
    };
    expect(mergeEvents(existing, incoming)).toHaveLength(2);
  });

  it("deduplicates delayed room user echoes by stable delivery identity", () => {
    const existing: TimelineEvent[] = [{
      id: "live-user",
      type: "user_message",
      timestamp: 1,
      content: "发一版 release 吧",
      roomMessageId: "room-message-1",
      agentTurnId: "agent-turn-1",
      dispatchAttemptId: "dispatch-attempt-1",
    }];
    const incoming: TimelineEvent = {
      id: "snapshot-user",
      type: "user_message",
      timestamp: 60_001,
      content: "发一版 release 吧",
      roomMessageId: "room-message-1",
      agentTurnId: "agent-turn-1",
      dispatchAttemptId: "dispatch-attempt-1",
    };

    expect(mergeEvents(existing, incoming)).toEqual(existing);
  });

  it("keeps identical room prompts when their stable delivery identities differ", () => {
    const existing: TimelineEvent[] = [{
      id: "first-user",
      type: "user_message",
      timestamp: 1,
      content: "继续",
      roomMessageId: "room-message-1",
      agentTurnId: "agent-turn-1",
      dispatchAttemptId: "dispatch-attempt-1",
    }];
    const incoming: TimelineEvent = {
      id: "second-user",
      type: "user_message",
      timestamp: 2,
      content: "继续",
      roomMessageId: "room-message-2",
      agentTurnId: "agent-turn-2",
      dispatchAttemptId: "dispatch-attempt-2",
    };

    expect(mergeEvents(existing, incoming).map((event) => event.id)).toEqual(["first-user", "second-user"]);
  });

  it("merges streaming assistant content", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "assistant_message", timestamp: 1, content: "Hel", isThinking: false, isComplete: false },
    ];
    const incoming: TimelineEvent = { id: "2", type: "assistant_message", timestamp: 2, content: "lo", model: "new-model", isThinking: false, isComplete: false };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(1);
    expect((result[0] as Extract<TimelineEvent, { type: "assistant_message" }>).content).toBe("Hello");
    expect((result[0] as Extract<TimelineEvent, { type: "assistant_message" }>).model).toBe("new-model");
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
    // With break-segment, the post-tool text becomes a new assistant event.
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(4);
    const preTool = result[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(preTool.content).toBe("先读取关键文件确认当前代码状态。");
    const postTool = result[3] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(postTool.content).toBe("现在开始并行修复批次1的安全类P0问题。");
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

    // With break-segment, the post-tool text is a new assistant event.
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(4);
    const preTool = result[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(preTool.content).toBe("- **Achiever**：图鉴\n- **");
    const postTool = result[3] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(postTool.content).toBe("Explorer**：骰子组合、法宝协同");
  });

  it("does not split list text or words at arbitrary process boundaries", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "assistant_message", timestamp: 1, content: "4. **负面骰子标签化**：让玩家有 informed", isThinking: false, isComplete: false },
      { id: "2", type: "subagent", timestamp: 2, agentId: "agent-1", agentName: "reviewer", status: "completed", events: [] },
    ];
    const choice: TimelineEvent = { id: "3", type: "assistant_message", timestamp: 3, content: " choice。\n5. **奖励多样性**：增加构筑资源。\n\n# 二、2D 游戏分析（game", isThinking: false, isComplete: false };
    // subagent is a process boundary → break segment: text2 appended as new event.
    const afterChoice = mergeEvents(existing, choice);
    expect(afterChoice).toHaveLength(3);
    const boundary: TimelineEvent = { id: "4", type: "tool_call", timestamp: 4, toolCallId: "tc-2", toolName: "Read", status: "success", arguments: {} };
    const afterBoundary = mergeEvents(afterChoice, boundary);
    const suffix: TimelineEvent = { id: "5", type: "assistant_message", timestamp: 5, content: "-development/2d-games）", isThinking: false, isComplete: false };
    // tool is also a process boundary → text3 also appended as new event.
    const result = mergeEvents(afterBoundary, suffix);
    expect(result).toHaveLength(5);
    const preToolText = result[0] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(preToolText.content).toBe("4. **负面骰子标签化**：让玩家有 informed");
    const postSubagentText = result[2] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(postSubagentText.content).toContain("choice。\n5. **奖励多样性**：增加构筑资源。");
    expect(postSubagentText.content).toContain("# 二、2D 游戏分析（game");
    const postToolText = result[4] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(postToolText.content).toBe("-development/2d-games）");
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
    // With break-segment, post-tool text becomes a new assistant event.
    const firstResult = mergeEvents(existing, firstIncoming);
    expect(firstResult).toHaveLength(4);
    const secondIncoming: TimelineEvent = {
      id: "5",
      type: "assistant_message",
      timestamp: 5,
      content: "resentation/run_page.dart`：新增按钮。",
      isThinking: false,
      isComplete: false,
    };
    // Second incoming merges into the post-tool event (no tool between them).
    const secondResult = mergeEvents(firstResult, secondIncoming);
    expect(secondResult).toHaveLength(4);
    const mergedPostTool = secondResult[3] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(mergedPostTool.content).toBe("/features/run/presentation/run_page.dart`：新增按钮。");
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

  it("does not use an older room message as the current Agent turn duration anchor", () => {
    const existing: TimelineEvent[] = [
      { id: "old-user", type: "user_message", timestamp: 1_000, content: "旧消息", roomMessageId: "room-message-old", roomAgentId: "agent-a" },
      {
        id: "assistant-current",
        type: "assistant_message",
        timestamp: 100_000,
        content: "本轮回复",
        isThinking: false,
        isComplete: false,
        roomMessageId: "room-message-current",
        roomAgentId: "agent-a",
        agentTurnId: "turn-current",
      },
    ];
    const incoming: TimelineEvent = {
      id: "turn-end",
      type: "assistant_message",
      timestamp: 110_000,
      content: "",
      isThinking: false,
      isComplete: true,
      roomMessageId: "room-message-current",
      roomAgentId: "agent-a",
      agentTurnId: "turn-current",
    };

    const result = mergeEvents(existing, incoming);
    const assistant = result[1] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(assistant.durationMs).toBe(10_000);
  });

  it("uses only the matching room message as the Agent turn duration anchor", () => {
    const existing: TimelineEvent[] = [
      { id: "old-user", type: "user_message", timestamp: 1_000, content: "旧消息", roomMessageId: "room-message-old", roomAgentId: "agent-a" },
      { id: "current-user", type: "user_message", timestamp: 90_000, content: "当前消息", roomMessageId: "room-message-current", roomAgentId: "agent-a" },
      {
        id: "assistant-current",
        type: "assistant_message",
        timestamp: 100_000,
        content: "本轮回复",
        isThinking: false,
        isComplete: false,
        roomMessageId: "room-message-current",
        roomAgentId: "agent-a",
        agentTurnId: "turn-current",
      },
    ];
    const incoming: TimelineEvent = {
      id: "turn-end",
      type: "assistant_message",
      timestamp: 110_000,
      content: "",
      isThinking: false,
      isComplete: true,
      roomMessageId: "room-message-current",
      roomAgentId: "agent-a",
      agentTurnId: "turn-current",
    };

    const result = mergeEvents(existing, incoming);
    const assistant = result[2] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(assistant.durationMs).toBe(20_000);
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

  it("does not append a replayed tool call after the local lifecycle already completed", () => {
    const existing: TimelineEvent[] = [{
      id: "original",
      type: "tool_call",
      timestamp: 100,
      toolCallId: "call-history",
      toolName: "ReadFile",
      status: "success",
      arguments: { path: "old.dart" },
      result: "old content",
    }];
    const incoming: TimelineEvent = {
      id: "replay",
      type: "tool_call",
      timestamp: 1_000,
      toolCallId: "call-history",
      toolName: "ReadFile",
      status: "running",
      arguments: { path: "old.dart" },
    };

    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "original",
      timestamp: 100,
      toolCallId: "call-history",
      status: "success",
      result: "old content",
    });
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

  it("converges an accepted steer to sent and drops the official replay user bubble", () => {
    // 官方把 steer 内容作为 user 消息落历史（context.spliced / context.append_message），
    // 快照回放以稳定 id（snapshot:msg_...）送达——这是「引导已写入」的权威证据。
    // 旧实现：追加第二条 user 气泡（症状 3 双 user + 伪 turn 边界），accepted 一直挂到
    // 轮次终态才收敛（症状 2 轮次进行中长期「等待写入」）。
    const existing: TimelineEvent[] = [
      { id: "assistant-1", type: "assistant_message", timestamp: 1_000, content: "Before", isThinking: true, isComplete: false },
      { id: "steer-1", type: "steer_message", timestamp: 2_000, content: "你是不是搞错的了", status: "accepted" },
    ];
    const incoming: TimelineEvent = {
      id: "snapshot:msg_01KZB1TZXN5DRENXY6DZYW4SXM:user:0",
      type: "user_message",
      timestamp: 4_000,
      content: "你是不是搞错的了",
      roomAgentId: "room-agent:s1",
    };
    const result = mergeEvents(existing, incoming);
    // 不追加独立 user 气泡（steer 气泡已呈现同一内容）
    expect(result).toHaveLength(2);
    expect(result.some((event) => event.type === "user_message")).toBe(false);
    // accepted 立即收敛为 sent（权威确认，不等轮次终态）
    const steer = result[1] as Extract<TimelineEvent, { type: "steer_message" }>;
    expect(steer.status).toBe("sent");
  });

  it("keeps the official replay user bubble when the matching steer already failed", () => {
    // failed steer 不代表官方已写入（236 语义：失败时内容可能已在官方队列）；
    // 官方随后落历史的 user 消息必须保留，不得被失败 steer 吞掉。
    const existing: TimelineEvent[] = [
      { id: "steer-1", type: "steer_message", timestamp: 2_000, content: "帮我修一下", status: "failed", error: "引导失败" },
    ];
    const incoming: TimelineEvent = {
      id: "snapshot:msg_xxx:user:0",
      type: "user_message",
      timestamp: 4_000,
      content: "帮我修一下",
    };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("user_message");
    // failed steer 保持末尾（appendAroundTrailingSteer 语义），未被吞并
    expect(result[1].type).toBe("steer_message");
  });

  it("does not treat an identity-less local user echo as a steer confirmation", () => {
    // 无官方身份（id 非 snapshot:/user: 前缀、无稳定 snapshotMessageId）的本地
    // user 回显是用户真实新消息，即使内容与 steer 相同也不得收敛/吞并。
    const existing: TimelineEvent[] = [
      { id: "steer-1", type: "steer_message", timestamp: 2_000, content: "再查一遍", status: "accepted" },
    ];
    const incoming: TimelineEvent = {
      id: "local-echo-1",
      type: "user_message",
      timestamp: 4_000,
      content: "再查一遍",
    };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("user_message");
    const steer = result[1] as Extract<TimelineEvent, { type: "steer_message" }>;
    expect(steer.status).toBe("accepted");
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
      { id: "1", type: "question_request", timestamp: 1, requestId: "q1", rpcRequestId: "rpc-q1", toolCallId: "", questions: [], status: "pending" },
    ];
    const incoming: TimelineEvent = { id: "2", type: "question_request", timestamp: 2, requestId: "q1", rpcRequestId: "rpc-q1", toolCallId: "", questions: [], status: "answered" };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(1);
    expect((result[0] as Extract<TimelineEvent, { type: "question_request" }>).status).toBe("answered");
  });

  it("preserves official question and option ids from history", () => {
    const event = mapStreamEvent({
      type: "QuestionRequest",
      timestamp: 10,
      payload: {
        id: "ask-1",
        questions: [{
          id: "q_0",
          question: "请选择",
          options: [{ id: "opt_0_1", label: "继续", description: "继续执行" }],
        }],
      },
    });

    expect(event?.type).toBe("question_request");
    const question = event as Extract<TimelineEvent, { type: "question_request" }>;
    expect(question.questions[0].id).toBe("q_0");
    expect(question.questions[0].options[0]).toMatchObject({ id: "opt_0_1", label: "继续" });
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
    expect(change.additions).toBe(2);
    expect(change.deletions).toBe(1);
    const diff = result[2] as Extract<TimelineEvent, { type: "diff" }>;
    expect(diff.filePath).toBe("src/app.ts");
  });

  it("derives change summary and diff from tool_call args when tool_result has no display.diff", () => {
    // Server 路由的 tool_result 不带 display.diff：fallback 从 tool_call 参数同时派生
    // change_summary（对话流变更卡）与 diff 事件（「最近变更」/change_preview），对齐两条链路。
    const existing: TimelineEvent[] = [
      { id: "1", type: "tool_call", timestamp: 1, toolCallId: "tc-1", toolName: "Edit", status: "running", arguments: { file_path: "src/app.ts", old_string: "before", new_string: "after\nmore" } },
    ];
    const incoming: TimelineEvent = {
      id: "2",
      type: "tool_result",
      timestamp: 2,
      toolCallId: "tc-1",
      toolName: "Edit",
      result: "ok",
    };
    const result = mergeEvents(existing, incoming);
    expect(result.map((event) => event.type)).toEqual(["tool_call", "change_summary", "diff"]);
    const change = result[1] as Extract<TimelineEvent, { type: "change_summary" }>;
    expect(change.files[0].path).toBe("src/app.ts");
    const diff = result[2] as Extract<TimelineEvent, { type: "diff" }>;
    expect(diff.filePath).toBe("src/app.ts");
    expect(diff.oldText).toBe("before");
    expect(diff.newText).toBe("after\nmore");
  });

  it("counts an equal-line structured replacement as both an addition and deletion", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "tool_call", timestamp: 1, toolCallId: "tc-replace", toolName: "edit", status: "running", arguments: {} },
    ];
    const incoming: TimelineEvent = {
      id: "2",
      type: "tool_result",
      timestamp: 2,
      toolCallId: "tc-replace",
      toolName: "edit",
      result: "ok",
      display: { diff: { path: "src/app.ts", oldText: "before", newText: "after" } },
    };

    const result = mergeEvents(existing, incoming);
    const change = result[1] as Extract<TimelineEvent, { type: "change_summary" }>;
    expect(change.files[0]).toMatchObject({ additions: 1, deletions: 1 });
  });

  it("binds current-turn change summaries to a successful git commit", () => {
    const existing: TimelineEvent[] = [
      { id: "user", type: "user_message", timestamp: 1, content: "修改", agentTurnId: "turn-1" },
      { id: "change", type: "change_summary", timestamp: 2, files: [{ path: "src/app.ts", additions: 1, deletions: 1 }], additions: 1, deletions: 1, agentTurnId: "turn-1" },
      {
        id: "commit-call",
        type: "tool_call",
        timestamp: 3,
        toolCallId: "commit-call",
        toolName: "Bash",
        status: "running",
        arguments: { command: "git add src/app.ts && git commit -m fix" },
        agentTurnId: "turn-1",
      },
    ];
    const result = mergeEvents(existing, {
      id: "commit-result",
      type: "tool_result",
      timestamp: 4,
      toolCallId: "commit-call",
      toolName: "Bash",
      result: "[main 2933405] fix\n 1 file changed, 1 insertion(+), 1 deletion(-)",
      agentTurnId: "turn-1",
    });
    const change = result.find((event) => event.type === "change_summary") as Extract<TimelineEvent, { type: "change_summary" }>;
    expect(change.files[0].commitSha).toBe("2933405");
  });

  it("binds a later TurnChanges summary to the current turn commit", () => {
    const existing: TimelineEvent[] = [
      { id: "user", type: "user_message", timestamp: 1, content: "修改", agentTurnId: "turn-1" },
      {
        id: "commit-call",
        type: "tool_call",
        timestamp: 2,
        toolCallId: "commit-call",
        toolName: "Bash",
        status: "success",
        arguments: { command: "git commit -am fix" },
        result: "[main 2933405] fix",
        agentTurnId: "turn-1",
      },
    ];
    const incoming: TimelineEvent = {
      id: "turn-changes",
      type: "change_summary",
      timestamp: 3,
      files: [{ path: "src/app.ts" }],
      additions: 0,
      deletions: 0,
      agentTurnId: "turn-1",
    };
    const result = mergeEvents(existing, incoming);
    const change = result.at(-1) as Extract<TimelineEvent, { type: "change_summary" }>;
    expect(change.files[0]).toMatchObject({ path: "src/app.ts", commitSha: "2933405" });
  });

  it("keeps native tool display metadata on tool calls", () => {
    const mapped = mapStreamEvent({
      type: "tool.call",
      payload: {
        toolCallId: "call-1",
        name: "Bash",
        args: { command: "pnpm build" },
        description: "Running: pnpm build",
        display: { kind: "command", command: "pnpm build", cwd: "D:/WORKS", language: "bash" },
      },
    });

    const tool = mapped as Extract<TimelineEvent, { type: "tool_call" }>;
    expect(tool.description).toBe("Running: pnpm build");
    expect(tool.display?.command).toBe("pnpm build");
    expect(tool.rawArguments).toBe(JSON.stringify({ command: "pnpm build" }));
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
    // fallback 现在也同时派生 diff 事件（「最近变更」/change_preview 对齐）
    expect(result.map((event) => event.type)).toEqual(["tool_call", "change_summary", "diff"]);
    const change = result[1] as Extract<TimelineEvent, { type: "change_summary" }>;
    expect(change.files[0].path).toBe("plans/next.md");
    expect(change.additions).toBe(2);
    const diff = result[2] as Extract<TimelineEvent, { type: "diff" }>;
    expect(diff.filePath).toBe("plans/next.md");
    expect(diff.newText).toBe("a\nb\n");
  });

  it("keeps replayed changes beside their original tool instead of attaching them to a later failed turn", () => {
    const existing: TimelineEvent[] = [
      { id: "user-old", type: "user_message", timestamp: 1, content: "修改文件", agentTurnId: "turn-old" },
      {
        id: "snapshot:tool-call-old",
        type: "tool_call",
        timestamp: 2,
        toolCallId: "tc-old",
        toolName: "Edit",
        status: "success",
        arguments: { path: "TASK_STATE.md", old_string: "a", new_string: "a\nb" },
        agentTurnId: "turn-old",
      },
      { id: "assistant-old", type: "assistant_message", timestamp: 4, content: "完成", isThinking: false, isComplete: true, agentTurnId: "turn-old" },
      { id: "user-failed", type: "user_message", timestamp: 10, content: "继续检查", agentTurnId: "turn-failed" },
      { id: "error-failed", type: "error", timestamp: 11, message: "503 auth_unavailable", source: "sdk", agentTurnId: "turn-failed" },
    ];
    const replayedResult: TimelineEvent = {
      id: "snapshot:tool-result-old",
      type: "tool_result",
      timestamp: 3,
      toolCallId: "tc-old",
      toolName: "Edit",
      result: "Replaced 1 occurrence",
      agentTurnId: "turn-old",
    };

    const once = mergeEvents(existing, replayedResult);
    const twice = mergeEvents(once, replayedResult);
    const changeIndexes = twice.flatMap((event, index) => event.type === "change_summary" ? [index] : []);
    const failedUserIndex = twice.findIndex((event) => event.id === "user-failed");

    expect(changeIndexes).toHaveLength(1);
    expect(changeIndexes[0]).toBeLessThan(failedUserIndex);
    expect(twice[changeIndexes[0]]).toMatchObject({
      agentTurnId: "turn-old",
      files: [{ path: "TASK_STATE.md" }],
    });
  });

  it("dedups derived change events across live and replayed tool results with drifted timestamps", () => {
    const existing: TimelineEvent[] = [
      { id: "call-1", type: "tool_call", timestamp: 1, toolCallId: "tc-1", toolName: "Edit", status: "running", arguments: {} },
    ];
    const liveResult: TimelineEvent = {
      id: "live-random-1",
      type: "tool_result",
      timestamp: 100,
      toolCallId: "tc-1",
      toolName: "Edit",
      result: "ok",
      display: { diff: { path: "src/app.ts", oldText: "before", newText: "after\nmore" } },
    };
    // 同一次工具结果的快照回放：incoming.id 与 timestamp 都与 live 帧不同。
    const replayedResult: TimelineEvent = {
      ...liveResult,
      id: "snapshot:msg-1:tool:tc-1:0",
      timestamp: 105,
    };

    const once = mergeEvents(existing, liveResult);
    const twice = mergeEvents(once, replayedResult);
    const changes = twice.filter((event) => event.type === "change_summary");
    const diffs = twice.filter((event) => event.type === "diff");
    expect(changes).toHaveLength(1);
    expect(diffs).toHaveLength(1);
    const change = changes[0] as Extract<TimelineEvent, { type: "change_summary" }>;
    expect(change.additions).toBe(2);
    expect(change.files[0].diffEventId).toBe(diffs[0].id);
  });

  it("keeps identical edits from different tool calls as separate change summaries", () => {
    const existing: TimelineEvent[] = [
      { id: "call-1", type: "tool_call", timestamp: 1, toolCallId: "tc-1", toolName: "Edit", status: "running", arguments: {} },
      { id: "call-2", type: "tool_call", timestamp: 2, toolCallId: "tc-2", toolName: "Edit", status: "running", arguments: {} },
    ];
    const makeResult = (id: string, toolCallId: string, timestamp: number): TimelineEvent => ({
      id,
      type: "tool_result",
      timestamp,
      toolCallId,
      toolName: "Edit",
      result: "ok",
      display: { diff: { path: "src/app.ts", oldText: "before", newText: "after" } },
    });

    const once = mergeEvents(existing, makeResult("r-1", "tc-1", 3));
    const twice = mergeEvents(once, makeResult("r-2", "tc-2", 4));
    expect(twice.filter((event) => event.type === "change_summary")).toHaveLength(2);
    expect(twice.filter((event) => event.type === "diff")).toHaveLength(2);
  });

  it("keeps an orphaned historical diff before a later user boundary", () => {
    const existing: TimelineEvent[] = [
      { id: "user-old", type: "user_message", timestamp: 1, content: "修改文件" },
      { id: "assistant-old", type: "assistant_message", timestamp: 4, content: "完成", isThinking: false, isComplete: true },
      { id: "user-new", type: "user_message", timestamp: 10, content: "继续检查" },
      { id: "error-new", type: "error", timestamp: 11, message: "503 auth_unavailable", source: "sdk" },
    ];
    const replayedResult: TimelineEvent = {
      id: "snapshot:orphan-result",
      type: "tool_result",
      timestamp: 3,
      toolCallId: "missing-call",
      toolName: "Edit",
      result: "Replaced 1 occurrence",
      display: { diff: { path: "TASK_STATE.md", oldText: "a", newText: "a\nb" } },
    };

    const merged = mergeEvents(existing, replayedResult);
    const changeIndex = merged.findIndex((event) => event.type === "change_summary");
    const newUserIndex = merged.findIndex((event) => event.id === "user-new");

    expect(changeIndex).toBeGreaterThanOrEqual(0);
    expect(changeIndex).toBeLessThan(newUserIndex);
  });

  it("only records quoted deletion paths before shell chaining", () => {
    const existing: TimelineEvent[] = [
      {
        id: "1",
        type: "tool_call",
        timestamp: 1,
        toolCallId: "tc-delete",
        toolName: "Bash",
        status: "running",
        arguments: { command: 'del "release-notes-v2.1.15.md" && git status' },
        display: { cwd: "D:/WORKS/Android Project/WorkHub/clipstash" },
      },
    ];
    const incoming: TimelineEvent = {
      id: "2",
      type: "tool_result",
      timestamp: 2,
      toolCallId: "tc-delete",
      toolName: "Bash",
      result: "deleted",
    };

    const result = mergeEvents(existing, incoming);
    const change = result[1] as Extract<TimelineEvent, { type: "change_summary" }>;
    expect(change.files).toEqual([{ path: "release-notes-v2.1.15.md", additions: 0, deletions: 1 }]);
    expect(change.projectPath).toBe("D:/WORKS/Android Project/WorkHub/clipstash");
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

  it("does not leak notification semantics into an adjacent usage status", () => {
    const existing: TimelineEvent[] = [{
      id: "notification",
      type: "status_update",
      timestamp: 1,
      message: "定时任务触发：检查构建状态",
      source: "runtime",
      tone: "info",
      parentEventId: "user-1",
    }];
    const incoming: TimelineEvent = {
      id: "usage",
      type: "status_update",
      timestamp: 2,
      message: "模型：kimi-code/k3",
      inputTokenCount: 622_188,
      tokenCount: 140,
      usageScope: "turn",
    };

    const result = mergeEvents(existing, incoming);
    // 跨类不折叠（v2.20.182）：通知行与用量行各自独立成行，语义天然互不泄漏。
    expect(result).toHaveLength(2);
    const [notification, usage] = result as Array<Extract<TimelineEvent, { type: "status_update" }>>;
    expect(notification).toMatchObject({
      id: "notification",
      message: "定时任务触发：检查构建状态",
      source: "runtime",
      tone: "info",
    });
    expect(usage).toMatchObject({
      id: "usage",
      message: "模型：kimi-code/k3",
      inputTokenCount: 622_188,
      tokenCount: 140,
      usageScope: "turn",
    });
    expect(usage.source).toBeUndefined();
    expect(usage.tone).toBeUndefined();
    expect(usage.parentEventId).toBeUndefined();
  });

  it("drops a subagent-scoped assistant event when no matching card exists", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "assistant_message", timestamp: 1, content: "主 turn 正文", isThinking: false, isComplete: false },
    ];
    const incoming: TimelineEvent = {
      id: "2",
      type: "assistant_message",
      timestamp: 2,
      agentId: "sub-1",
      content: "子代理文本",
      isThinking: false,
      isComplete: false,
    };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(1);
    expect((result[0] as Extract<TimelineEvent, { type: "assistant_message" }>).content).toBe("主 turn 正文");
  });

  it("still attaches a subagent-scoped event when its card exists", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "assistant_message", timestamp: 1, content: "主 turn 正文", isThinking: false, isComplete: false },
      { id: "2", type: "subagent", timestamp: 2, agentId: "sub-1", agentName: "explore", status: "running", events: [] },
    ];
    const incoming: TimelineEvent = {
      id: "3",
      type: "assistant_message",
      timestamp: 3,
      agentId: "sub-1",
      content: "子代理文本",
      isThinking: false,
      isComplete: false,
    };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(2);
    const card = result[1] as Extract<TimelineEvent, { type: "subagent" }>;
    expect(card.events.some((event) => event.type === "assistant_message" && event.content === "子代理文本")).toBe(true);
    expect((result[0] as Extract<TimelineEvent, { type: "assistant_message" }>).content).toBe("主 turn 正文");
  });

  it("keeps merging assistant events scoped to the main agent", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "assistant_message", timestamp: 1, content: "主", isThinking: false, isComplete: false },
    ];
    const incoming: TimelineEvent = {
      id: "2",
      type: "assistant_message",
      timestamp: 2,
      agentId: "main",
      content: " turn",
      isThinking: false,
      isComplete: false,
    };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(1);
    expect((result[0] as Extract<TimelineEvent, { type: "assistant_message" }>).content).toBe("主 turn");
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

  it("corrects the fallback subagent name when a later frame carries the concrete name", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "subagent", timestamp: 1, agentId: "agent-9", agentName: "子代理", status: "running", events: [] },
    ];
    const incoming: TimelineEvent = { id: "2", type: "subagent", timestamp: 2, agentId: "agent-9", agentName: "coder", status: "running", events: [] };

    const result = mergeEvents(existing, incoming);

    expect(result).toHaveLength(1);
    expect((result[0] as Extract<TimelineEvent, { type: "subagent" }>).agentName).toBe("coder");
  });

  it("keeps the concrete subagent name when a later frame only carries the fallback name", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "subagent", timestamp: 1, agentId: "agent-10", agentName: "coder", status: "running", events: [] },
    ];
    const incoming: TimelineEvent = { id: "2", type: "subagent", timestamp: 2, agentId: "agent-10", agentName: "子代理", status: "completed", events: [] };

    const result = mergeEvents(existing, incoming);

    expect(result).toHaveLength(1);
    expect((result[0] as Extract<TimelineEvent, { type: "subagent" }>).agentName).toBe("coder");
  });

  it("merges a late terminal lifecycle event into an already settled subagent", () => {
    const existing: TimelineEvent[] = [{
      id: "agent-running",
      type: "subagent",
      timestamp: 10,
      agentId: "agent-6",
      agentName: "coder",
      status: "completed",
      events: [{
        id: "child-output",
        type: "assistant_message",
        timestamp: 11,
        content: "审查完成",
        isThinking: false,
        isComplete: true,
      }],
    }];
    const incoming: TimelineEvent = {
      id: "agent-completed",
      type: "subagent",
      timestamp: 12,
      agentId: "agent-6",
      agentName: "子代理",
      status: "completed",
      resultSummary: "发现两项问题",
      events: [],
    };

    const result = mergeEvents(existing, incoming);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "subagent",
      agentId: "agent-6",
      status: "completed",
      resultSummary: "发现两项问题",
    });
    // 迟到的完成事件若用兜底名"子代理"，不应覆盖原有更具体的"coder"。
    expect((result[0] as Extract<TimelineEvent, { type: "subagent" }>).agentName).toBe("coder");
    expect((result[0] as Extract<TimelineEvent, { type: "subagent" }>).events).toHaveLength(1);
  });

  it("does not replace existing subagent events when incoming subagent carries empty events", () => {
    const existing: TimelineEvent[] = [{
      id: "agent-running",
      type: "subagent",
      timestamp: 10,
      agentId: "agent-7",
      agentName: "coder",
      status: "running",
      events: [{
        id: "child-output",
        type: "assistant_message",
        timestamp: 11,
        content: "子代理正文",
        isThinking: false,
        isComplete: true,
      }],
    }];
    const incoming: TimelineEvent = {
      id: "agent-completed",
      type: "subagent",
      timestamp: 12,
      agentId: "agent-7",
      agentName: "coder",
      status: "completed",
      events: [],
    };

    const result = mergeEvents(existing, incoming);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "subagent", status: "completed" });
    expect((result[0] as Extract<TimelineEvent, { type: "subagent" }>).events).toHaveLength(1);
    expect(((result[0] as Extract<TimelineEvent, { type: "subagent" }>).events[0] as Extract<TimelineEvent, { type: "assistant_message" }>).content).toBe("子代理正文");
  });

  it("merges incoming subagent events into existing events instead of replacing them", () => {
    const existing: TimelineEvent[] = [{
      id: "agent-running",
      type: "subagent",
      timestamp: 10,
      agentId: "agent-8",
      agentName: "coder",
      status: "running",
      events: [{
        id: "child-output-1",
        type: "assistant_message",
        timestamp: 11,
        content: "已有正文",
        isThinking: false,
        isComplete: true,
      }],
    }];
    const incoming: TimelineEvent = {
      id: "agent-completed",
      type: "subagent",
      timestamp: 12,
      agentId: "agent-8",
      agentName: "coder",
      status: "completed",
      events: [{
        id: "child-output-2",
        type: "assistant_message",
        timestamp: 13,
        content: "新增正文",
        isThinking: false,
        isComplete: true,
      }],
    };

    const result = mergeEvents(existing, incoming);

    expect(result).toHaveLength(1);
    const subagent = result[0] as Extract<TimelineEvent, { type: "subagent" }>;
    expect(subagent.events).toHaveLength(2);
    const contents = subagent.events
      .filter((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => event.type === "assistant_message")
      .map((event) => event.content);
    expect(contents).toContain("已有正文");
    expect(contents).toContain("新增正文");
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

  it("break-segment: text1 → tool → text2 produces two assistant messages (text2 after tool)", () => {
    const existing: TimelineEvent[] = [
      { id: "u1", type: "user_message" as const, timestamp: 1, content: "hi", agentTurnId: "turn-1" },
      { id: "a1", type: "assistant_message" as const, timestamp: 2, content: "第一段分析", isThinking: false, isComplete: false, agentTurnId: "turn-1" },
      { id: "t1", type: "tool_call" as const, timestamp: 3, toolCallId: "call-1", toolName: "Read", status: "success" as const, arguments: {} },
    ];
    const text2: TimelineEvent = {
      id: "a2", type: "assistant_message" as const, timestamp: 4, content: "第二段最终答案", isThinking: false, isComplete: false, agentTurnId: "turn-1",
    };
    const result = mergeEvents(existing, text2);
    const assistants = result.filter((e) => e.type === "assistant_message");
    expect(assistants).toHaveLength(2);
    // First assistant (pre-tool) has only the first segment's content.
    expect(assistants[0]).toMatchObject({ content: "第一段分析", isComplete: false });
    // Second assistant (post-tool) has the new content.
    expect(assistants[1]).toMatchObject({ content: "第二段最终答案", isComplete: false });
    // Order: text1 before tool, text2 after tool.
    expect(result.indexOf(assistants[0])).toBeLessThan(result.indexOf(assistants[1]));
    expect(result.indexOf(assistants[1])).toBeGreaterThan(result.indexOf(existing[2])); // after tool
  });

  it("break-segment: text1 → text2 (no tool) still merges into one", () => {
    const existing: TimelineEvent[] = [
      { id: "a1", type: "assistant_message" as const, timestamp: 2, content: "第一段", isThinking: false, isComplete: false, agentTurnId: "turn-1" },
    ];
    const text2: TimelineEvent = {
      id: "a2", type: "assistant_message" as const, timestamp: 3, content: "第一段第二段", isThinking: false, isComplete: false, agentTurnId: "turn-1",
    };
    const result = mergeEvents(existing, text2);
    const assistants = result.filter((e) => e.type === "assistant_message");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({ content: "第一段第二段" });
  });

  it("break-segment: text1 → tool → text2 → turn.ended marks text2 complete", () => {
    const existing: TimelineEvent[] = [
      { id: "u1", type: "user_message" as const, timestamp: 1, content: "hi", agentTurnId: "turn-1" },
      { id: "a1", type: "assistant_message" as const, timestamp: 2, content: "分析", isThinking: false, isComplete: false, agentTurnId: "turn-1" },
      { id: "t1", type: "tool_call" as const, timestamp: 3, toolCallId: "call-1", toolName: "Read", status: "success" as const, arguments: {} },
    ];
    // text2 is appended as new assistant after tool.
    const afterText2 = mergeEvents(existing, {
      id: "a2", type: "assistant_message" as const, timestamp: 4, content: "答案", isThinking: false, isComplete: false, agentTurnId: "turn-1",
    });
    // turn.ended: identity terminal marks the last open assistant complete.
    const result = mergeEvents(afterText2, {
      id: "end-turn", type: "assistant_message" as const, timestamp: 5, content: "", isThinking: false, isComplete: true, agentTurnId: "turn-1",
    });
    const assistants = result.filter((e) => e.type === "assistant_message");
    expect(assistants).toHaveLength(2);
    expect(assistants[0]).toMatchObject({ content: "分析", isComplete: false });
    expect(assistants[1]).toMatchObject({ content: "答案", isComplete: true });
  });

  it("break-segment: thinking delta followed by tool also breaks", () => {
    const existing: TimelineEvent[] = [
      { id: "u1", type: "user_message" as const, timestamp: 1, content: "hi", agentTurnId: "turn-1" },
      { id: "a1", type: "assistant_message" as const, timestamp: 2, content: "分析", thinking: "思考1", isThinking: false, isComplete: false, agentTurnId: "turn-1" },
      { id: "t1", type: "tool_call" as const, timestamp: 3, toolCallId: "call-1", toolName: "Read", status: "success" as const, arguments: {} },
    ];
    // thinking delta with text after tool → break
    const result = mergeEvents(existing, {
      id: "a2", type: "assistant_message" as const, timestamp: 4, content: "新分析", thinking: "新思考", isThinking: false, isComplete: false, agentTurnId: "turn-1",
    });
    const assistants = result.filter((e) => e.type === "assistant_message");
    expect(assistants).toHaveLength(2);
    expect(assistants[0]).toMatchObject({ content: "分析", thinking: "思考1" });
    expect(assistants[1]).toMatchObject({ content: "新分析", thinking: "新思考" });
  });

  it("break-segment: completionBarrierReplay still replaces target content", () => {
    const existing: TimelineEvent[] = [
      { id: "u1", type: "user_message" as const, timestamp: 1, content: "hi", agentTurnId: "turn-1" },
      { id: "a1", type: "assistant_message" as const, timestamp: 2, content: "旧内容", isThinking: false, isComplete: false, agentTurnId: "turn-1" },
    ];
    // Barrier replay reuses same turn id → merges, no break.
    const result = mergeEvents(existing, {
      id: "a-barrier", type: "assistant_message" as const, timestamp: 3, content: "替换内容",
      isThinking: false, isComplete: true, agentTurnId: "turn-1", completionBarrierReplay: true,
    });
    const assistants = result.filter((e) => e.type === "assistant_message");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({ content: "替换内容", isComplete: true });
  });

  it("barrier binding sets official timestamp so later unseen stable events sort correctly (P0 order fix)", () => {
    // Simulate the real session_6203... scenario:
    // 1. user message → placeholder assistant (isComplete: false, ts=T0+40ms)
    // 2. barrier replay binds f_000010 (summary, 996 chars, ts=T0+40s) →
    //    must set incoming.timestamp so the event has its official time.
    // 3. unseen stable f_000008 (preview, 33 chars, ts=T0+30s) arrives via
    //    stableSnapshotId path → inserted by timestamp order BEFORE f_000010.
    const T0 = 1000;
    const existing: TimelineEvent[] = [
      { id: "user-1", type: "user_message" as const, timestamp: T0, content: "开始" },
      { id: "placeholder", type: "assistant_message" as const, timestamp: T0 + 40, content: "正在思考",
        isThinking: false, isComplete: false, agentTurnId: "turn-1" },
    ];

    // Step 2: barrier frame f_000010 binds to placeholder.
    const afterBarrier = mergeEvents(existing, {
      id: "barrier-010", type: "assistant_message" as const,
      timestamp: T0 + 40_000, snapshotMessageId: "f_000010",
      snapshotMessageIdStable: true, completionBarrierReplay: true,
      content: "完整汇总共996字符", isThinking: false, isComplete: true,
    });
    const boundEvent = afterBarrier[1] as Extract<TimelineEvent, { type: "assistant_message" }>;
    expect(boundEvent.timestamp).toBe(T0 + 40_000);
    expect(boundEvent.content).toBe("完整汇总共996字符");
    expect(boundEvent.isComplete).toBe(true);

    // Step 3: unseen stable f_000008 (preview, ts=T0+30s, no completionBarrierReplay).
    const afterPreview = mergeEvents(afterBarrier, {
      id: "stable-008", type: "assistant_message" as const,
      timestamp: T0 + 30_000, snapshotMessageId: "f_000008",
      snapshotMessageIdStable: true,
      content: "33字符预告", isThinking: false, isComplete: true,
    });

    // f_000008 should be inserted before f_000010 (earlier timestamp).
    const assistants = afterPreview.filter((e) => e.type === "assistant_message");
    expect(assistants).toHaveLength(2);
    const previewIdx = afterPreview.findIndex((e) => e.type === "assistant_message" && e.content === "33字符预告");
    const summaryIdx = afterPreview.findIndex((e) => e.type === "assistant_message" && e.content === "完整汇总共996字符");
    expect(previewIdx).toBeLessThan(summaryIdx);
  });

  it("does not bind an older pre-tool snapshot step to the newest live draft", () => {
    const existing: TimelineEvent[] = [
      { id: "u1", type: "user_message", timestamp: 1, content: "检查" },
      {
        id: "old-step", type: "assistant_message", timestamp: 10,
        content: "", thinking: "旧步骤", isThinking: false, isComplete: true,
        snapshotMessageId: "f_000710", snapshotMessageIdStable: true,
        agentTurnId: "turn-1",
      },
      {
        id: "tool-1", type: "tool_call", timestamp: 20,
        toolCallId: "call-1", toolName: "Read", status: "success", arguments: {},
      },
      {
        id: "live-draft", type: "assistant_message", timestamp: 30,
        content: "", thinking: "当前步骤", isThinking: true, isComplete: false,
        agentTurnId: "turn-1",
      },
    ];
    const result = mergeEvents(existing, {
      id: "replayed-old-step",
      type: "assistant_message",
      timestamp: 10,
      content: "",
      thinking: "旧步骤的官方全文",
      isThinking: false,
      isComplete: true,
      snapshotMessageId: "f_000711",
      snapshotMessageIdStable: true,
      completionBarrierReplay: true,
      agentTurnId: "turn-1",
    });
    const liveDraft = result.find((event) => event.id === "live-draft");
    expect(liveDraft).toMatchObject({
      type: "assistant_message",
      thinking: "当前步骤",
      isComplete: false,
    });
    expect(liveDraft && "snapshotMessageIdStable" in liveDraft
      ? liveDraft.snapshotMessageIdStable
      : undefined).toBeUndefined();
    expect(result.some((event) => (
      event.type === "assistant_message" &&
      event.snapshotMessageId === "f_000711"
    ))).toBe(true);
  });

  it("binds completed pre-tool replay to its live segment instead of making it the final answer", () => {
    // Live stream has already closed the short pre-tool sentence and moved on
    // to the final draft when /messages replays both official messages.
    const existing: TimelineEvent[] = [
      { id: "user", type: "user_message", timestamp: 1_000, content: "说明两件装备" },
      {
        id: "live-pre-tool", type: "assistant_message", timestamp: 1_100,
        content: "两个的具体效果如下：", isThinking: false, isComplete: true,
        agentTurnId: "turn-1",
      },
      {
        id: "tool", type: "tool_call", timestamp: 1_200,
        toolCallId: "read-1", toolName: "Read", status: "success", arguments: {},
      },
      {
        id: "live-final", type: "assistant_message", timestamp: 1_300,
        content: "玉垒诀的完整效果", isThinking: false, isComplete: false,
        agentTurnId: "turn-1",
      },
    ];

    const withPreTool = mergeEvents(existing, {
      id: "replay-pre-tool", type: "assistant_message", timestamp: 1_050,
      content: "", thinking: "先核对代码实现。", isThinking: true, isComplete: false,
      snapshotMessageId: "msg_session-x_000728", snapshotMessageIdStable: true,
      completionBarrierReplay: true, agentTurnId: "turn-1",
    });
    const withPreToolText = mergeEvents(withPreTool, {
      id: "replay-pre-tool-text", type: "assistant_message", timestamp: 1_050,
      content: "两个的具体效果如下（已核对实现）：", isThinking: false, isComplete: false,
      snapshotMessageId: "msg_session-x_000728", snapshotMessageIdStable: true,
      completionBarrierReplay: true, agentTurnId: "turn-1",
    });
    const completedPreTool = mergeEvents(withPreToolText, {
      id: "replay-pre-tool-end", type: "assistant_message", timestamp: 1_050,
      content: "", isThinking: false, isComplete: true,
      snapshotMessageId: "msg_session-x_000728", snapshotMessageIdStable: true,
      completionBarrierReplay: true, agentTurnId: "turn-1",
    });
    const withFinal = mergeEvents(completedPreTool, {
      id: "replay-final", type: "assistant_message", timestamp: 1_250,
      content: "玉垒诀与雷龟盾的 592 字完整效果。", isThinking: false, isComplete: true,
      snapshotMessageId: "msg_session-x_000730", snapshotMessageIdStable: true,
      completionBarrierReplay: true, agentTurnId: "turn-1",
    });

    const assistants = withFinal.filter((event) => event.type === "assistant_message");
    expect(assistants).toHaveLength(2);
    expect(assistants[0]).toMatchObject({
      id: "live-pre-tool",
      snapshotMessageId: "msg_session-x_000728",
      content: "两个的具体效果如下（已核对实现）：",
      isComplete: true,
    });
    expect(assistants[1]).toMatchObject({
      id: "live-final",
      snapshotMessageId: "msg_session-x_000730",
      content: "玉垒诀与雷龟盾的 592 字完整效果。",
      isComplete: true,
    });
  });

  it("break-segment: different roomAgentId does not merge", () => {
    const existing: TimelineEvent[] = [
      { id: "a1", type: "assistant_message" as const, timestamp: 2, content: "A发言", isThinking: false, isComplete: false, roomAgentId: "agent-1", agentTurnId: "turn-1" },
      { id: "t1", type: "tool_call" as const, timestamp: 3, toolCallId: "call-1", toolName: "Read", status: "success" as const, arguments: {} },
    ];
    // Different roomAgentId → no sameTurn match → appended regardless.
    const result = mergeEvents(existing, {
      id: "a2", type: "assistant_message" as const, timestamp: 4, content: "B发言", isThinking: false, isComplete: false, roomAgentId: "agent-2", agentTurnId: "turn-1",
    });
    const assistants = result.filter((e) => e.type === "assistant_message");
    expect(assistants).toHaveLength(2);
  });

  it("empty identity terminal after all assistants complete does not append noise event", () => {
    // text → tool → text → turn.ended: after break-segment the second text is
    // a new assistant. turn.ended marks it complete but leaves no incomplete
    // target for a second turn.ended → must not append.
    const existing: TimelineEvent[] = [
      { id: "u1", type: "user_message" as const, timestamp: 1, content: "hi" },
      { id: "a1", type: "assistant_message" as const, timestamp: 2, content: "分析", isThinking: false, isComplete: true, agentTurnId: "turn-1" },
      { id: "t1", type: "tool_call" as const, timestamp: 3, toolCallId: "call-1", toolName: "Read", status: "success" as const, arguments: {} },
      { id: "a2", type: "assistant_message" as const, timestamp: 4, content: "答案", isThinking: false, isComplete: true, agentTurnId: "turn-1" },
    ];
    const turnEnded: TimelineEvent = {
      id: "end", type: "assistant_message" as const, timestamp: 5, content: "", isThinking: false, isComplete: true,
    };
    const result = mergeEvents(existing, turnEnded);
    expect(result).toHaveLength(existing.length);
    expect(result.every((e) => e.type !== "assistant_message" || e.isComplete)).toBe(true);
  });

  it("normal step.end with uncompleted target still marks it complete", () => {
    const existing: TimelineEvent[] = [
      { id: "a1", type: "assistant_message" as const, timestamp: 2, content: "正在思考", isThinking: false, isComplete: false, agentTurnId: "turn-1" },
    ];
    const stepEnd: TimelineEvent = {
      id: "end", type: "assistant_message" as const, timestamp: 3, content: "", isThinking: false, isComplete: true, agentTurnId: "turn-1",
    };
    const result = mergeEvents(existing, stepEnd);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ content: "正在思考", isComplete: true });
  });

  it("identity terminal is idempotent: two merges same as one", () => {
    const base: TimelineEvent[] = [
      { id: "a1", type: "assistant_message" as const, timestamp: 2, content: "正文", isThinking: false, isComplete: true },
    ];
    const emptyFrame: TimelineEvent = {
      id: "empty", type: "assistant_message" as const, timestamp: 3, content: "", isThinking: false, isComplete: true,
    };
    const once = mergeEvents(base, emptyFrame);
    const twice = mergeEvents(once, emptyFrame);
    expect(twice).toEqual(once);
  });
});

describe("mergeAssistantContentWithOffset", () => {
  it("orders out-of-order deltas by streamOffset", () => {
    // arrival: "霖江路"(offset 2) → "最近几"(offset 6) → "你好"(offset 0)
    // expected: "你好霖江路最近几"
    // First delta merge would be handled by mergeEvents append,
    // so we test the pure function with accumulated state.
    const step1 = mergeAssistantContentWithOffset(
      { content: "", streamOffset: undefined },
      { content: "霖江路", streamOffset: 2 },
    );
    expect(step1).toBe("霖江路");
    const step2 = mergeAssistantContentWithOffset(
      { content: "霖江路", streamOffset: 2 },
      { content: "最近几", streamOffset: 6 },
    );
    expect(step2).toBe("霖江路最近几");
    const step3 = mergeAssistantContentWithOffset(
      { content: "霖江路最近几", streamOffset: 2 },
      { content: "你好", streamOffset: 0 },
    );
    expect(step3).toBe("你好霖江路最近几");
  });

  it("sequential deltas produce same result as appendAssistantContent", () => {
    const result = mergeAssistantContentWithOffset(
      { content: "你好", streamOffset: 0 },
      { content: "霖江路", streamOffset: 2 },
    );
    expect(result).toBe("你好霖江路");
  });

  it("overlapping deltas deduplicate overlapping region", () => {
    // "AB" at offset 0, "BC" at offset 1 → "ABC"
    const result = mergeAssistantContentWithOffset(
      { content: "AB", streamOffset: 0 },
      { content: "BC", streamOffset: 1 },
    );
    expect(result).toBe("ABC");
  });

  it("falls back to prefix-safe merge when offsets are undefined", () => {
    const result = mergeAssistantContentWithOffset(
      { content: "你好", streamOffset: undefined },
      { content: "霖江路", streamOffset: undefined },
    );
    expect(result).toBe("你好霖江路");
    // Also test with mixed: one has offset, other doesn't.
    const mixed = mergeAssistantContentWithOffset(
      { content: "你好", streamOffset: 0 },
      { content: "霖江路", streamOffset: undefined },
    );
    expect(mixed).toBe("你好霖江路");
  });

  it("startsWith replacement works: incoming extends existing text", () => {
    // incoming starts with existing → cumulative delta path → replace.
    const result = mergeAssistantContentWithOffset(
      { content: "你好霖江路", streamOffset: 0 },
      { content: "你好霖江路最近几", streamOffset: 0 },
    );
    expect(result).toBe("你好霖江路最近几");
  });

  it("startsWith safety: middle-of-string match does not replace", () => {
    // existing="世界", incoming="你好世界" → incoming does NOT start with
    // existing → concatenate, not replace. This is the P2 semantic change
    // from includes (appendAssistantContent) to startsWith (mergeLiveBody).
    const result = mergeAssistantContentWithOffset(
      { content: "世界", streamOffset: undefined },
      { content: "你好世界", streamOffset: undefined },
    );
    expect(result).toBe("世界你好世界");
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

  it("collapses background-task notification envelopes into status summaries instead of user bubbles", () => {
    const result = mapHistoryEvents([{
      type: "TurnBegin",
      payload: {
        user_input: [{
          type: "text",
          text: '<notification id="task:bash-h:completed" category="task" type="task.completed" source_kind="background_task" source_id="bash-h">\nTitle: Background process completed\nSeverity: info\n全量 flutter test completed.\n<output-file path="C:/x.log" bytes="1">x</output-file>\n</notification>',
        }],
      },
    }]);

    expect(result).toMatchObject([{
      type: "status_update",
      message: "后台任务已完成：全量 flutter test",
      source: "runtime",
      tone: "success",
    }]);
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

  it("places compaction completion right after its begin event", () => {
    const result = mapHistoryEvents([
      { type: "compaction.started", payload: {}, time: 100 },
      { type: "assistant.delta", payload: { delta: "压缩后第一段" }, time: 110 },
      { type: "compaction.completed", payload: { compaction_summary: "摘要" }, time: 120 },
      { type: "assistant.delta", payload: { delta: "压缩后第二段" }, time: 130 },
      { type: "turn.ended", payload: {}, time: 200 },
    ]);

    const types = result.map((event) => event.type);
    const compactionBeginIndex = types.indexOf("compaction");
    const compactionEndIndex = types.findIndex((event, index) => event === "compaction" && index > compactionBeginIndex);
    const assistantIndex = types.indexOf("assistant_message");
    expect(compactionBeginIndex).toBeLessThan(assistantIndex);
    expect(compactionEndIndex).toBe(compactionBeginIndex + 1);
    expect((result[compactionEndIndex] as Extract<TimelineEvent, { type: "compaction" }>).phase).toBe("end");
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

  it("keeps official snapshot event identities stable across repeated loads", () => {
    const history = [
      {
        type: "TurnBegin",
        payload: {
          snapshotReplay: "history",
          snapshotMessageId: "msg-user-1",
          user_input: [{ type: "text", text: "用户历史问题" }],
        },
      },
      {
        type: "content.part",
        payload: {
          snapshotReplay: "history",
          snapshotMessageId: "msg-assistant-1",
          part: { type: "think", think: "先分析" },
        },
      },
      {
        type: "content.part",
        payload: {
          snapshotReplay: "history",
          snapshotMessageId: "msg-assistant-1",
          part: { type: "text", text: "官方历史回答" },
        },
      },
      {
        type: "turn.ended",
        payload: {
          snapshotReplay: "history",
          snapshotMessageId: "msg-assistant-1",
        },
      },
    ];

    const first = mapHistoryEvents(history);
    const second = mapHistoryEvents(history);
    expect(second.map((event) => event.id)).toEqual(first.map((event) => event.id));
    expect(first[0].id).toContain("msg-user-1");
    expect(first[1].id).toContain("msg-assistant-1");
    expect(first[1]).toMatchObject({
      type: "assistant_message",
      snapshotMessageId: "msg-assistant-1",
      content: "官方历史回答",
      isComplete: true,
    });
  });

  it("keeps unseen stable snapshot messages separate before any user boundary exists", () => {
    const first: TimelineEvent = {
      id: "snapshot-first",
      type: "assistant_message",
      timestamp: 100,
      snapshotMessageId: "msg-first",
      snapshotMessageIdStable: true,
      content: "第一条官方历史回复",
      isThinking: false,
      isComplete: false,
    };
    const second: TimelineEvent = {
      id: "snapshot-second",
      type: "assistant_message",
      timestamp: 200,
      snapshotMessageId: "msg-second",
      snapshotMessageIdStable: true,
      content: "第二条官方历史回复",
      isThinking: false,
      isComplete: false,
    };

    const result = mergeEvents(mergeEvents([], first), second);

    expect(result).toHaveLength(2);
    expect(result).toEqual([
      expect.objectContaining({ snapshotMessageId: "msg-first", content: "第一条官方历史回复" }),
      expect.objectContaining({ snapshotMessageId: "msg-second", content: "第二条官方历史回复" }),
    ]);
  });

  it("routes an older stable snapshot message by identity instead of merging it into the current turn", () => {
    const current: TimelineEvent[] = [{
      id: "user-old", type: "user_message", timestamp: 100, content: "旧问题",
    }, {
      id: "assistant-old", type: "assistant_message", timestamp: 200,
      snapshotMessageId: "msg-old", snapshotMessageIdStable: true,
      content: "旧回答前半", isThinking: false, isComplete: false,
    }, {
      id: "user-current", type: "user_message", timestamp: 1_000, content: "新问题",
    }, {
      id: "assistant-current", type: "assistant_message", timestamp: 1_100,
      snapshotMessageId: "msg-current", snapshotMessageIdStable: true,
      content: "当前回答", isThinking: false, isComplete: false,
    }];

    const withOldTail = mergeEvents(current, {
      id: "old-tail", type: "assistant_message", timestamp: 210,
      snapshotMessageId: "msg-old", snapshotMessageIdStable: true,
      content: "旧回答后半", isThinking: false, isComplete: false,
    });
    const settled = mergeEvents(withOldTail, {
      id: "old-end", type: "assistant_message", timestamp: 220,
      snapshotMessageId: "msg-old", snapshotMessageIdStable: true,
      content: "", isThinking: false, isComplete: true,
    });

    expect(settled).toHaveLength(4);
    expect(settled[1]).toMatchObject({
      snapshotMessageId: "msg-old",
      content: "旧回答前半旧回答后半",
      isComplete: true,
    });
    expect(settled[3]).toMatchObject({
      snapshotMessageId: "msg-current",
      content: "当前回答",
      isComplete: false,
    });
  });

  it("inserts an unseen historical assistant before the current user boundary", () => {
    const current: TimelineEvent[] = [{
      id: "user-old", type: "user_message", timestamp: 100, content: "旧问题",
    }, {
      id: "user-current", type: "user_message", timestamp: 1_000, content: "新问题",
    }, {
      id: "assistant-current", type: "assistant_message", timestamp: 1_100,
      content: "当前回答", isThinking: false, isComplete: false,
    }];

    const withHistory = mergeEvents(current, {
      id: "old-content", type: "assistant_message", timestamp: 200,
      snapshotMessageId: "msg-old", snapshotMessageIdStable: true,
      content: "迟到的旧回答", isThinking: false, isComplete: false,
    });
    const settled = mergeEvents(withHistory, {
      id: "old-end", type: "assistant_message", timestamp: 210,
      snapshotMessageId: "msg-old", snapshotMessageIdStable: true,
      content: "", isThinking: false, isComplete: true,
    });

    expect(settled.map((event) => event.id)).toEqual([
      "user-old", "old-content", "user-current", "assistant-current",
    ]);
    expect(settled[1]).toMatchObject({ content: "迟到的旧回答", isComplete: true });
    expect(settled[3]).toMatchObject({ content: "当前回答", isComplete: false });
  });

  it("inserts a late-replayed official message before an already-bound later official message", () => {
    // Repro: session_01ea935b — official message 000389 (early plan text)
    // replayed after 000397 (final answer) was already bound, and landed at
    // the tail so the plan sentence rendered after the final answer.
    const existing: TimelineEvent[] = [{
      id: "user-1", type: "user_message", timestamp: 1_000, content: "查一下全部剧情",
    }, {
      id: "assistant-final", type: "assistant_message", timestamp: 2_000,
      snapshotMessageId: "msg_session-x_000397", snapshotMessageIdStable: true,
      content: "最终回答（表格）", isThinking: false, isComplete: true,
    }];

    const result = mergeEvents(existing, {
      id: "assistant-plan", type: "assistant_message", timestamp: 2_001,
      snapshotMessageId: "msg_session-x_000389", snapshotMessageIdStable: true,
      completionBarrierReplay: true,
      content: "先改这两处", isThinking: false, isComplete: true,
    });

    expect(result.map((event) => event.id)).toEqual([
      "user-1", "assistant-plan", "assistant-final",
    ]);
  });

  it("appends a replayed official message at the tail when its sequence is the highest", () => {
    const existing: TimelineEvent[] = [{
      id: "assistant-plan", type: "assistant_message", timestamp: 2_000,
      snapshotMessageId: "msg_session-x_000389", snapshotMessageIdStable: true,
      content: "先改这两处", isThinking: false, isComplete: true,
    }];

    const result = mergeEvents(existing, {
      id: "assistant-final", type: "assistant_message", timestamp: 2_001,
      snapshotMessageId: "msg_session-x_000397", snapshotMessageIdStable: true,
      content: "最终回答", isThinking: false, isComplete: true,
    });

    expect(result.map((event) => event.id)).toEqual(["assistant-plan", "assistant-final"]);
  });

  it("appends a replayed official message at the tail when the id has no sequence suffix", () => {
    const existing: TimelineEvent[] = [{
      id: "assistant-final", type: "assistant_message", timestamp: 2_000,
      snapshotMessageId: "msg-late", snapshotMessageIdStable: true,
      content: "最终回答", isThinking: false, isComplete: true,
    }];

    const result = mergeEvents(existing, {
      id: "assistant-other", type: "assistant_message", timestamp: 2_001,
      snapshotMessageId: "msg-other", snapshotMessageIdStable: true,
      content: "另一条", isThinking: false, isComplete: true,
    });

    expect(result.map((event) => event.id)).toEqual(["assistant-final", "assistant-other"]);
  });

  it("does not let a stable terminal for an earlier completed step close the current step", () => {
    const current: TimelineEvent[] = [{
      id: "user", type: "user_message", timestamp: 1_000, content: "检查项目",
    }, {
      id: "step-one", type: "assistant_message", timestamp: 1_100,
      snapshotMessageId: "msg-step-one", snapshotMessageIdStable: true,
      content: "第一步完成", isThinking: false, isComplete: true,
    }, {
      id: "step-two", type: "assistant_message", timestamp: 1_200,
      snapshotMessageId: "msg-step-two", snapshotMessageIdStable: true,
      content: "继续检查", isThinking: false, isComplete: false,
    }];

    const result = mergeEvents(current, {
      id: "step-one-end", type: "assistant_message", timestamp: 1_150,
      snapshotMessageId: "msg-step-one", snapshotMessageIdStable: true,
      content: "", isThinking: false, isComplete: true,
    });

    expect(result).toBe(current);
    expect(result[2]).toMatchObject({ snapshotMessageId: "msg-step-two", isComplete: false });
  });
});

describe("preserveLocalUserMediaInCanonicalHistory", () => {
  it("keeps pasted image bytes when richer official history only retains the image name", () => {
    const local = [{
      id: "local-user",
      type: "user_message" as const,
      timestamp: 1_000,
      content: "请看图片",
      images: [{ id: "local-image", kind: "image" as const, name: "image.png", dataUrl: "data:image/png;base64,AA==" }],
    }];
    const canonical = [{
      id: "official-user",
      type: "user_message" as const,
      timestamp: 1_010,
      content: "请看图片",
      images: [{ name: "image.png" }],
    }, {
      id: "tool",
      type: "tool_call" as const,
      timestamp: 1_020,
      toolCallId: "tool-1",
      toolName: "read_file",
      status: "completed" as const,
      arguments: {},
    }];

    expect(preserveLocalUserMediaInCanonicalHistory(local, canonical)).toMatchObject([{
      id: "official-user",
      images: [{ id: "local-image", name: "image.png", dataUrl: "data:image/png;base64,AA==" }],
    }, { id: "tool" }]);
  });

  it("matches repeated prompts by nearest timestamp and preserves dragged file paths", () => {
    const local = [1_000, 2_000].map((timestamp, index) => ({
      id: `local-${index}`,
      type: "user_message" as const,
      timestamp,
      content: "同一段文字",
      images: [{ name: "file.txt", kind: "file" as const, filePath: `C:\\tmp\\${index}.txt` }],
    }));
    const canonical = [1_990, 1_010].map((timestamp, index) => ({
      id: `official-${index}`,
      type: "user_message" as const,
      timestamp,
      content: "同一段文字",
      images: [{ name: "file.txt" }],
    }));

    const result = preserveLocalUserMediaInCanonicalHistory(local, canonical);
    expect(result[0]).toMatchObject({ images: [{ filePath: "C:\\tmp\\1.txt" }] });
    expect(result[1]).toMatchObject({ images: [{ filePath: "C:\\tmp\\0.txt" }] });
  });
});

describe("mergeEvents subagent lifecycle instrumentation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("logs when a subagent completes while an inner assistant_message is still open", () => {
    const logEventSpy = vi.spyOn(reportError, "logEvent").mockImplementation(() => {});
    const openAssistant: TimelineEvent = {
      id: "assistant-1",
      type: "assistant_message",
      timestamp: 2,
      content: "streaming body",
      isThinking: false,
      isComplete: false,
    };
    const existing: TimelineEvent[] = [{
      id: "sub-1",
      type: "subagent",
      timestamp: 1,
      agentId: "agent-1",
      agentName: "coder",
      status: "running",
      events: [openAssistant],
    }];
    const incoming: TimelineEvent = {
      id: "sub-1",
      type: "subagent",
      timestamp: 3,
      agentId: "agent-1",
      agentName: "coder",
      status: "completed",
      events: [],
    };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(1);
    expect((result[0] as Extract<TimelineEvent, { type: "subagent" }>).status).toBe("completed");
    expect(logEventSpy).toHaveBeenCalledTimes(1);
    expect(logEventSpy).toHaveBeenCalledWith(
      "eventMapper.subagentCompletedWithOpenAssistant",
      expect.objectContaining({
        agentId: "agent-1",
        agentName: "coder",
        incomingStatus: "completed",
        openAssistantCount: 1,
      }),
    );
  });

  it("does not log when the subagent completes with no open assistant_message", () => {
    const logEventSpy = vi.spyOn(reportError, "logEvent").mockImplementation(() => {});
    const existing: TimelineEvent[] = [{
      id: "sub-1",
      type: "subagent",
      timestamp: 1,
      agentId: "agent-1",
      agentName: "coder",
      status: "running",
      events: [{
        id: "assistant-1",
        type: "assistant_message",
        timestamp: 2,
        content: "done",
        isThinking: false,
        isComplete: true,
      }],
    }];
    const incoming: TimelineEvent = {
      id: "sub-1",
      type: "subagent",
      timestamp: 3,
      agentId: "agent-1",
      agentName: "coder",
      status: "completed",
      events: [],
    };
    mergeEvents(existing, incoming);
    expect(logEventSpy).not.toHaveBeenCalled();
  });

  it("drops incoming subagent events whose id conflicts with a different existing event", () => {
    const logEventSpy = vi.spyOn(reportError, "logEvent").mockImplementation(() => {});
    const existing: TimelineEvent[] = [{
      id: "sub-1",
      type: "subagent",
      timestamp: 1,
      agentId: "agent-1",
      agentName: "coder",
      status: "running",
      events: [{
        id: "assistant-1",
        type: "assistant_message",
        timestamp: 2,
        content: "local body",
        isThinking: false,
        isComplete: true,
      }],
    }];
    const incoming: TimelineEvent = {
      id: "sub-1",
      type: "subagent",
      timestamp: 3,
      agentId: "agent-1",
      agentName: "coder",
      status: "completed",
      events: [{
        id: "assistant-1",
        type: "assistant_message",
        timestamp: 4,
        content: "different body from history replay",
        isThinking: false,
        isComplete: true,
      }],
    };
    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(1);
    const subagent = result[0] as Extract<TimelineEvent, { type: "subagent" }>;
    expect(subagent.events).toHaveLength(1);
    expect((subagent.events[0] as Extract<TimelineEvent, { type: "assistant_message" }>).content).toBe("local body");
    expect(logEventSpy).toHaveBeenCalledWith(
      "eventMapper.subagentEventIdConflict",
      expect.objectContaining({ eventId: "assistant-1", eventType: "assistant_message" }),
    );
  });

  it("still merges incoming subagent events when the same id carries equivalent content", () => {
    const existing: TimelineEvent[] = [{
      id: "sub-1",
      type: "subagent",
      timestamp: 1,
      agentId: "agent-1",
      agentName: "coder",
      status: "running",
      events: [{
        id: "assistant-1",
        type: "assistant_message",
        timestamp: 2,
        content: "same body",
        isThinking: false,
        isComplete: true,
      }],
    }];
    const incoming: TimelineEvent = {
      id: "sub-1",
      type: "subagent",
      timestamp: 3,
      agentId: "agent-1",
      agentName: "coder",
      status: "completed",
      events: [{
        id: "assistant-1",
        type: "assistant_message",
        timestamp: 4,
        content: "same body",
        isThinking: false,
        isComplete: true,
      }],
    };
    const result = mergeEvents(existing, incoming);
    const subagent = result[0] as Extract<TimelineEvent, { type: "subagent" }>;
    expect(subagent.events).toHaveLength(1);
    expect((subagent.events[0] as Extract<TimelineEvent, { type: "assistant_message" }>).content).toBe("same body");
  });

  it("accepts a same-id tool lifecycle update and applies its terminal status", () => {
    const existing: TimelineEvent[] = [{
      id: "sub-1",
      type: "subagent",
      timestamp: 1,
      agentId: "agent-1",
      agentName: "coder",
      status: "running",
      events: [{
        id: "tool-event-1",
        type: "tool_call",
        timestamp: 2,
        toolCallId: "tool-call-1",
        toolName: "Read",
        status: "running",
        arguments: { path: "a.ts" },
      }],
    }];
    const incoming: TimelineEvent = {
      id: "sub-1",
      type: "subagent",
      timestamp: 3,
      agentId: "agent-1",
      agentName: "coder",
      status: "completed",
      events: [{
        id: "tool-event-1",
        type: "tool_call",
        timestamp: 4,
        toolCallId: "tool-call-1",
        toolName: "Read",
        status: "success",
        arguments: { path: "a.ts" },
        result: "done",
      }],
    };

    const result = mergeEvents(existing, incoming);
    const subagent = result[0] as Extract<TimelineEvent, { type: "subagent" }>;
    expect(subagent.events).toHaveLength(1);
    expect(subagent.events[0]).toMatchObject({
      id: "tool-event-1",
      type: "tool_call",
      status: "success",
      result: "done",
    });
  });

  it("drops a same-id subagent event when its event type changes", () => {
    const logEventSpy = vi.spyOn(reportError, "logEvent").mockImplementation(() => {});
    const existing: TimelineEvent[] = [{
      id: "sub-1",
      type: "subagent",
      timestamp: 1,
      agentId: "agent-1",
      agentName: "coder",
      status: "running",
      events: [{
        id: "collision-1",
        type: "tool_call",
        timestamp: 2,
        toolCallId: "tool-call-1",
        toolName: "Read",
        status: "running",
        arguments: {},
      }],
    }];
    const incoming: TimelineEvent = {
      id: "sub-1",
      type: "subagent",
      timestamp: 3,
      agentId: "agent-1",
      agentName: "coder",
      status: "completed",
      events: [{
        id: "collision-1",
        type: "assistant_message",
        timestamp: 4,
        content: "wrongly reused id",
        isThinking: false,
        isComplete: true,
      }],
    };

    const result = mergeEvents(existing, incoming);
    const subagent = result[0] as Extract<TimelineEvent, { type: "subagent" }>;
    expect(subagent.events).toHaveLength(1);
    expect(subagent.events[0].type).toBe("tool_call");
    expect(logEventSpy).toHaveBeenCalledWith(
      "eventMapper.subagentEventIdConflict",
      expect.objectContaining({
        eventId: "collision-1",
        existingEventType: "tool_call",
        eventType: "assistant_message",
      }),
    );
  });
});

describe("mergeEvents user id dedup and timeline dedup cleanup", () => {
  it("skips a replayed user message with an identical stable id", () => {
    const existing: TimelineEvent[] = [{
      id: "snapshot:msg_u1:user:0", type: "user_message", timestamp: 100, content: "问题",
    }];
    const incoming: TimelineEvent = {
      id: "snapshot:msg_u1:user:0", type: "user_message", timestamp: 100, content: "问题",
    };
    expect(mergeEvents(existing, incoming)).toHaveLength(1);
  });

  it("deduplicateTimelineEvents removes replay duplicates and keeps the identity-rich user copy", () => {
    const damaged: TimelineEvent[] = [{
      id: "snapshot:msg_u1:user:0", type: "user_message", timestamp: 1000, content: "同一个问题",
    }, {
      id: "assistant-1", type: "assistant_message", timestamp: 1100, content: "回答一", isThinking: false, isComplete: true,
    }, {
      id: "local-u1", type: "user_message", timestamp: 1001, content: "同一个问题", roomMessageId: "local-u1", agentTurnId: "turn-1",
    }, {
      id: "snapshot:msg_u1:user:0", type: "user_message", timestamp: 1000, content: "同一个问题",
    }, {
      id: "assistant-2", type: "assistant_message", timestamp: 1200, content: "回答二", isThinking: false, isComplete: true,
    }];
    const result = deduplicateTimelineEvents(damaged);
    expect(result.filter((event) => event.type === "user_message")).toHaveLength(1);
    expect(result.filter((event) => event.type === "user_message")[0].id).toBe("local-u1");
    expect(result.filter((event) => event.type === "assistant_message")).toHaveLength(2);
  });

  it("deduplicateTimelineEvents preserves intentional repeated prompts with distinct delivery identities", () => {
    const events: TimelineEvent[] = [{
      id: "local-u1", type: "user_message", timestamp: 1000, content: "继续",
      roomMessageId: "room-message-1", agentTurnId: "turn-1", dispatchAttemptId: "attempt-1",
    }, {
      id: "local-u2", type: "user_message", timestamp: 2000, content: "继续",
      roomMessageId: "room-message-2", agentTurnId: "turn-2", dispatchAttemptId: "attempt-2",
    }];

    expect(deduplicateTimelineEvents(events).map((event) => event.id)).toEqual(["local-u1", "local-u2"]);
  });

  it("deduplicateTimelineEvents preserves repeated identity-less prompts with distinct ids", () => {
    const events: TimelineEvent[] = [{
      id: "legacy-u1", type: "user_message", timestamp: 1000, content: "继续",
    }, {
      id: "legacy-u2", type: "user_message", timestamp: 2000, content: "继续",
    }];

    expect(deduplicateTimelineEvents(events).map((event) => event.id)).toEqual(["legacy-u1", "legacy-u2"]);
  });

  it("deduplicateTimelineEvents pairs replay echoes one-to-one across repeated prompts", () => {
    const events: TimelineEvent[] = [{
      id: "local-u1", type: "user_message", timestamp: 1000, content: "继续",
      roomMessageId: "room-message-1", agentTurnId: "turn-1",
    }, {
      id: "local-u2", type: "user_message", timestamp: 5000, content: "继续",
      roomMessageId: "room-message-2", agentTurnId: "turn-2",
    }, {
      id: "snapshot:msg_u1:user:0", type: "user_message", timestamp: 1001, content: "继续",
    }, {
      id: "snapshot:msg_u2:user:0", type: "user_message", timestamp: 5001, content: "继续",
    }];

    const result = deduplicateTimelineEvents(events);
    expect(result.map((event) => event.id)).toEqual(["local-u1", "local-u2"]);
  });

  it("deduplicateTimelineEvents replaces an identical-id user copy with richer later metadata", () => {
    const events: TimelineEvent[] = [{
      id: "stable-user", type: "user_message", timestamp: 1000, content: "问题",
    }, {
      id: "stable-user", type: "user_message", timestamp: 1001, content: "问题",
      roomMessageId: "room-message-1", agentTurnId: "turn-1", dispatchAttemptId: "attempt-1",
    }];

    expect(deduplicateTimelineEvents(events)).toEqual([expect.objectContaining({
      id: "stable-user",
      roomMessageId: "room-message-1",
      agentTurnId: "turn-1",
      dispatchAttemptId: "attempt-1",
    })]);
  });

  it("deduplicateTimelineEvents indexes a long unique history by normalized content", () => {
    const events: TimelineEvent[] = Array.from({ length: 1_000 }, (_, index) => ({
      id: `legacy-${index}`,
      type: "user_message" as const,
      timestamp: index * 20_000,
      content: `问题 ${index}`,
    }));
    events.push({
      id: "rich-999",
      type: "user_message",
      timestamp: 999 * 20_000 + 1,
      content: "问题 999",
      roomMessageId: "room-message-999",
      agentTurnId: "turn-999",
    });

    const result = deduplicateTimelineEvents(events);
    expect(result).toHaveLength(1_000);
    expect(result.at(-1)).toMatchObject({
      id: "rich-999",
      roomMessageId: "room-message-999",
      agentTurnId: "turn-999",
    });
  });

  it("deduplicateTimelineEvents is idempotent and keeps distinct users", () => {
    const events: TimelineEvent[] = [{
      id: "u1", type: "user_message", timestamp: 1000, content: "问题一",
    }, {
      id: "u2", type: "user_message", timestamp: 5000, content: "问题二",
    }, {
      id: "a1", type: "assistant_message", timestamp: 6000, content: "回答", isThinking: false, isComplete: true,
    }];
    const once = deduplicateTimelineEvents(events);
    expect(once).toBe(events);
    expect(once).toHaveLength(3);
    expect(deduplicateTimelineEvents(once)).toBe(once);
  });

  it("deduplicateTimelineEvents repairs duplicate thinking parts inside one persisted assistant", () => {
    const text = "Let me check the IPC registration.";
    const events: TimelineEvent[] = [{
      id: "assistant-damaged",
      type: "assistant_message",
      timestamp: 1000,
      content: "",
      thinking: text,
      thinkingParts: [
        { id: "part-a", timestamp: 1000, text },
        { id: "part-b", timestamp: 1000, text },
      ],
      isThinking: false,
      isComplete: true,
    }];

    const result = deduplicateTimelineEvents(events);
    expect(result[0]).toMatchObject({
      type: "assistant_message",
      thinkingParts: [{ id: "part-a", timestamp: 1000, text }],
    });
  });

  it("deduplicateTimelineEvents removes replayed active-draft materializations from one turn", () => {
    const repeated = "先找版本文案，再看模型探测。";
    const events: TimelineEvent[] = [{
      id: "active-draft:session:turn:materialization-a",
      type: "assistant_message",
      timestamp: 1000,
      content: repeated,
      isThinking: false,
      isComplete: true,
      roomAgentId: "agent-1",
      roomMessageId: "message-1",
      agentTurnId: "turn-1",
    }, {
      id: "tool-1",
      type: "tool_call",
      timestamp: 1100,
      toolCallId: "call-1",
      toolName: "Read",
      status: "success",
      arguments: {},
    }, {
      id: "active-draft:session:turn:materialization-b",
      type: "assistant_message",
      timestamp: 1200,
      content: repeated,
      isThinking: false,
      isComplete: true,
      roomAgentId: "agent-1",
      roomMessageId: "message-1",
      agentTurnId: "turn-1",
    }];

    const result = deduplicateTimelineEvents(events);
    expect(result.filter((event) => event.type === "assistant_message")).toHaveLength(1);
    expect(result.map((event) => event.id)).toEqual([
      "active-draft:session:turn:materialization-a",
      "tool-1",
    ]);
  });

  it("deduplicateTimelineEvents preserves identical active-draft text across distinct turns", () => {
    const repeated = "先找版本文案，再看模型探测。";
    const makeDraft = (turnId: string, timestamp: number): TimelineEvent => ({
      id: `active-draft:session:${turnId}:materialization`,
      type: "assistant_message",
      timestamp,
      content: repeated,
      isThinking: false,
      isComplete: true,
      roomAgentId: "agent-1",
      roomMessageId: `message-${turnId}`,
      agentTurnId: turnId,
    });

    expect(deduplicateTimelineEvents([
      makeDraft("turn-1", 1000),
      makeDraft("turn-2", 2000),
    ])).toHaveLength(2);
  });

  it("deduplicateTimelineEvents preserves same-moment drafts from conflicting turn identities", () => {
    const makeDraft = (turnId: string): TimelineEvent => ({
      id: `active-draft:session:${turnId}:materialization`,
      type: "assistant_message",
      timestamp: 1000,
      content: "相同正文",
      thinking: "相同思考",
      isThinking: false,
      isComplete: true,
      roomAgentId: "agent-1",
      roomMessageId: "shared-message",
      agentTurnId: turnId,
    });

    expect(deduplicateTimelineEvents([
      makeDraft("turn-1"),
      makeDraft("turn-2"),
    ])).toHaveLength(2);
  });

  it("deduplicateTimelineEvents preserves anonymous active drafts without delivery identity", () => {
    const makeAnonymousDraft = (id: string, timestamp: number): TimelineEvent => ({
      id,
      type: "assistant_message",
      timestamp,
      content: "无法证明归属时不要按正文去重。",
      isThinking: false,
      isComplete: true,
    });

    expect(deduplicateTimelineEvents([
      makeAnonymousDraft("active-draft:anonymous:a", 1000),
      makeAnonymousDraft("active-draft:anonymous:b", 2000),
    ])).toHaveLength(2);
  });

  it("deduplicateTimelineEvents folds an identity-less canonical mirror into its live materialization", () => {
    const thinking = "先定位 IPC 注册，再检查响应类型。";
    const events: TimelineEvent[] = [{
      id: "active-draft:session:turn:materialization",
      type: "assistant_message",
      timestamp: 1000,
      content: "看 IPC 注册、响应类型和消息展示样式。",
      thinking,
      thinkingParts: [
        { id: "fragment-a", timestamp: 900, text: "先定位 IPC 注册，" },
        { id: "fragment-b", timestamp: 1000, text: "再检查响应类型。" },
      ],
      isThinking: false,
      isComplete: true,
      roomAgentId: "agent-1",
      roomMessageId: "message-1",
      agentTurnId: "turn-1",
    }, {
      id: "tool-1",
      type: "tool_call",
      timestamp: 1500,
      toolCallId: "call-1",
      toolName: "Read",
      status: "success",
      arguments: {},
    }, {
      id: "canonical-mirror",
      type: "assistant_message",
      timestamp: 2000,
      content: "看 IPC 注册、响应类型和消息展示样式。",
      thinking,
      thinkingParts: [{ id: "canonical-part", timestamp: 2000, text: thinking }],
      isThinking: false,
      isComplete: true,
      roomAgentId: "agent-1",
    }];

    const result = deduplicateTimelineEvents(events);
    expect(result.map((event) => event.id)).toEqual([
      "active-draft:session:turn:materialization",
      "tool-1",
    ]);
  });

  it("deduplicateTimelineEvents folds an identity-less canonical mirror into a regular delivery event", () => {
    const makeAssistant = (
      id: string,
      timestamp: number,
      identity?: { roomMessageId: string; agentTurnId: string },
    ): TimelineEvent => ({
      id,
      type: "assistant_message",
      timestamp,
      content: "先找更新记录，再检查代理。",
      thinking: "定位两个调用链。",
      isThinking: false,
      isComplete: true,
      roomAgentId: "agent-1",
      ...identity,
    });

    expect(deduplicateTimelineEvents([
      makeAssistant("live-step", 1000, { roomMessageId: "message-1", agentTurnId: "turn-1" }),
      makeAssistant("canonical-mirror", 100_000),
    ]).map((event) => event.id)).toEqual(["live-step"]);
  });

  it("deduplicateTimelineEvents removes replayed active-draft content but keeps its distinct thinking", () => {
    const events: TimelineEvent[] = [{
      id: "live-step",
      type: "assistant_message",
      timestamp: 1000,
      content: "先找版本文案，再看模型探测。",
      thinking: "第一段思考",
      thinkingParts: [{ id: "part-a", timestamp: 1000, text: "第一段思考" }],
      isThinking: false,
      isComplete: true,
      roomAgentId: "agent-1",
      roomMessageId: "message-1",
      agentTurnId: "turn-1",
    }, {
      id: "tool-1",
      type: "tool_call",
      timestamp: 1500,
      toolCallId: "call-1",
      toolName: "Read",
      status: "success",
      arguments: {},
    }, {
      id: "active-draft:session:turn:materialization-b",
      type: "assistant_message",
      timestamp: 2000,
      content: "先找版本文案，再看模型探测。",
      thinking: "第二段独立思考",
      thinkingParts: [{ id: "part-b", timestamp: 2000, text: "第二段独立思考" }],
      isThinking: false,
      isComplete: true,
      roomAgentId: "agent-1",
      roomMessageId: "message-1",
      agentTurnId: "turn-1",
    }];

    const result = deduplicateTimelineEvents(events);
    expect(result.filter((event) => event.type === "assistant_message")).toEqual([
      expect.objectContaining({ id: "live-step", content: "先找版本文案，再看模型探测。", thinking: "第一段思考" }),
      expect.objectContaining({ id: "active-draft:session:turn:materialization-b", content: "", thinking: "第二段独立思考" }),
    ]);
  });

  it("deduplicateTimelineEvents removes exact same-moment identity-less assistant copies", () => {
    const makeCopy = (id: string): TimelineEvent => ({
      id,
      type: "assistant_message",
      timestamp: 1000,
      content: "同一个实时步骤",
      thinking: "同一段思考",
      isThinking: false,
      isComplete: true,
      roomAgentId: "agent-1",
    });

    expect(deduplicateTimelineEvents([
      makeCopy("copy-a"),
      makeCopy("copy-b"),
    ]).map((event) => event.id)).toEqual(["copy-a"]);
  });

  it("deduplicateTimelineEvents preserves later identity-less assistants with intentional repeated text", () => {
    const makeCopy = (id: string, timestamp: number): TimelineEvent => ({
      id,
      type: "assistant_message",
      timestamp,
      content: "可以重复出现的正文",
      thinking: "可以重复出现的思考",
      isThinking: false,
      isComplete: true,
      roomAgentId: "agent-1",
    });

    expect(deduplicateTimelineEvents([
      makeCopy("step-a", 1000),
      makeCopy("step-b", 2000),
    ])).toHaveLength(2);
  });
});

describe("mergeEvents canonical user replay stamping", () => {
  it("stamps a canonical replay identity onto the matching optimistic echo instead of duplicating it", () => {
    const optimistic: TimelineEvent = {
      id: "local-echo-1",
      type: "user_message",
      timestamp: 1000,
      content: "了解当前项目",
    };
    const replay: TimelineEvent = {
      id: "user:msg_prompt_multi_step",
      type: "user_message",
      timestamp: Date.parse("2026-07-20T10:00:00.000Z"),
      content: "了解当前项目",
      snapshotMessageId: "msg_prompt_multi_step",
      snapshotMessageIdStable: true,
    };
    const result = mergeEvents([optimistic], replay);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: "user_message",
      id: "local-echo-1",
      content: "了解当前项目",
      snapshotMessageId: "msg_prompt_multi_step",
      snapshotMessageIdStable: true,
    });
  });

  it("appends a canonical replay with different content as a new user boundary", () => {
    const optimistic: TimelineEvent = {
      id: "local-echo-1",
      type: "user_message",
      timestamp: 1000,
      content: "第一条消息",
    };
    const webMessage: TimelineEvent = {
      id: "user:msg_web_0002",
      type: "user_message",
      timestamp: Date.parse("2026-07-20T10:00:00.000Z"),
      content: "web 端发起的新一轮",
      snapshotMessageId: "msg_web_0002",
      snapshotMessageIdStable: true,
    };
    const result = mergeEvents([optimistic], webMessage);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ type: "user_message", id: "user:msg_web_0002" });
  });

  it("inserts a late external user boundary before same-millisecond non-user frames", () => {
    // 同毫秒 tie：严格 > 的旧逻辑会退化成尾部追加，新轮回复被归到上一轮（review 中 7）。
    const boundary: TimelineEvent = { id: "user:msg_first", type: "user_message", timestamp: 1000, content: "第一轮" };
    const sameMsFrame: TimelineEvent = { id: "st-1", type: "status_update", timestamp: 1500, message: "处理中" };
    const lateUser: TimelineEvent = {
      id: "user:msg_late_1",
      type: "user_message",
      timestamp: 1500,
      content: "第二轮",
      snapshotMessageId: "msg_late_1",
      snapshotMessageIdStable: true,
    };
    const result = mergeEvents([boundary, sameMsFrame], lateUser);
    expect(result.map((event) => event.id)).toEqual(["user:msg_first", "user:msg_late_1", "st-1"]);
  });

  it("keeps two intentional identical prompts when the first echo was already stamped", () => {
    const stamped: TimelineEvent = {
      id: "local-echo-1",
      type: "user_message",
      timestamp: 1000,
      content: "继续",
      snapshotMessageId: "msg_first",
      snapshotMessageIdStable: true,
    };
    const secondEcho: TimelineEvent = {
      id: "local-echo-2",
      type: "user_message",
      timestamp: 2000,
      content: "继续",
    };
    const result = mergeEvents([stamped], secondEcho);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ type: "user_message", id: "local-echo-2" });
  });

  it("hard-dedupes a repeated canonical replay after stamping", () => {
    const optimistic: TimelineEvent = {
      id: "local-echo-1",
      type: "user_message",
      timestamp: 1000,
      content: "任务一",
    };
    const replay: TimelineEvent = {
      id: "user:msg_task_1",
      type: "user_message",
      timestamp: Date.parse("2026-07-20T10:00:00.000Z"),
      content: "任务一",
      snapshotMessageId: "msg_task_1",
      snapshotMessageIdStable: true,
    };
    const once = mergeEvents([optimistic], replay);
    expect(once).toHaveLength(1);
    const twice = mergeEvents(once, { ...replay });
    expect(twice).toHaveLength(1);
  });

  it("pairs multiple identical optimistic echoes with their own canonical replays one-to-one", () => {
    const echo1: TimelineEvent = { id: "echo-1", type: "user_message", timestamp: 1000, content: "继续" };
    const echo2: TimelineEvent = { id: "echo-2", type: "user_message", timestamp: 5000, content: "继续" };
    const replay1: TimelineEvent = {
      id: "user:msg_r1",
      type: "user_message",
      timestamp: Date.parse("2026-07-20T10:00:00.000Z"),
      content: "继续",
      snapshotMessageId: "msg_r1",
      snapshotMessageIdStable: true,
    };
    const after1 = mergeEvents([echo1, echo2], replay1);
    expect(after1.filter((event) => event.type === "user_message")).toHaveLength(2);
    expect(after1.find((event) => event.id === "echo-1")).toMatchObject({
      snapshotMessageId: "msg_r1",
      snapshotMessageIdStable: true,
    });
    const replay2: TimelineEvent = { ...replay1, id: "user:msg_r2", snapshotMessageId: "msg_r2" };
    const after2 = mergeEvents(after1, replay2);
    expect(after2.filter((event) => event.type === "user_message")).toHaveLength(2);
    expect(after2.find((event) => event.id === "echo-2")).toMatchObject({
      snapshotMessageId: "msg_r2",
      snapshotMessageIdStable: true,
    });
  });
});

describe("mergeAssistantThinkingText", () => {
  it("returns the fuller text when one side already contains the other", () => {
    expect(mergeAssistantThinkingText("思考全文", "思考")).toBe("思考全文");
    expect(mergeAssistantThinkingText("思考", "思考全文")).toBe("思考全文");
    expect(mergeAssistantThinkingText("思考全文", "思考全文")).toBe("思考全文");
  });

  it("does not duplicate near-identical text that only differs in whitespace", () => {
    const live = "第一步：读文件\n\n第二步：改代码";
    const replay = "第一步：读文件\n第二步：改代码";
    // Raw includes checks fail on both sides; normalized comparison must win.
    expect(mergeAssistantThinkingText(live, replay)).toBe(live);
    expect(mergeAssistantThinkingText(replay, live)).toBe(replay);
  });

  it("does not duplicate when a whitespace-drifted replay extends the live text", () => {
    const live = "分析需求\n\n动手实现";
    const replay = "分析需求\n动手实现\n\n补充测试";
    expect(mergeAssistantThinkingText(live, replay)).toBe(replay);
  });

  it("still concatenates genuinely different thoughts", () => {
    expect(mergeAssistantThinkingText("思考A", "思考B")).toBe("思考A思考B");
  });

  it("ignores empty incoming text", () => {
    expect(mergeAssistantThinkingText("已有", "")).toBe("已有");
    expect(mergeAssistantThinkingText("已有", "   ")).toBe("已有");
    expect(mergeAssistantThinkingText(undefined, "新增")).toBe("新增");
  });
});

describe("mergeAssistantThinkingParts", () => {
  const part = (id: string, text: string, timestamp = 1) => ({ id, timestamp, text });

  it("keeps 240 independently streamed thinking parts ordered before a full replay", () => {
    let merged: ReturnType<typeof mergeAssistantThinkingParts>;
    const startedAt = performance.now();
    for (let index = 0; index < 240; index += 1) {
      const token = index.toString().padStart(4, "0");
      merged = mergeAssistantThinkingParts(merged, [
        part(`part-${token}`, `独立推理片段 ${token} :: ${"x".repeat(80)}`, index),
      ]);
    }
    const sequentialMs = performance.now() - startedAt;

    expect(merged).toHaveLength(240);
    expect(merged?.map((item) => item.id)).toEqual(
      Array.from({ length: 240 }, (_, index) => `part-${index.toString().padStart(4, "0")}`),
    );

    const fullText = merged?.map((item) => item.text).join("") ?? "";
    const replayStartedAt = performance.now();
    const replayed = mergeAssistantThinkingParts(merged, [part("full-replay", fullText, 1_000)]);
    const replayMs = performance.now() - replayStartedAt;
    expect(replayed).toHaveLength(1);
    expect(replayed?.[0]).toMatchObject({ id: "full-replay", text: fullText, timestamp: 1_000 });
    // The former full-history rebuild took ~944 ms for this fixture on the
    // reference machine. Keep a wide CI margin while still catching that
    // algorithmic regression; the indexed path is normally below 10 ms.
    expect(sequentialMs).toBeLessThan(250);
    expect(replayMs).toBeLessThan(100);
  });

  it("deduplicates an incoming batch that already contains the same full replay twice", () => {
    const full = "The discovery tries /models and /v1/models.";
    const merged = mergeAssistantThinkingParts(undefined, [
      part("replay-1", full, 10),
      part("replay-2", full, 10),
    ]);
    expect(merged).toEqual([part("replay-1", full, 10)]);
  });

  it("a full replay removes every fragment it covers instead of only the first", () => {
    const fragments = [part("f1", "片段一"), part("f2", "片段二"), part("f3", "片段三")];
    const merged = mergeAssistantThinkingParts(fragments, [part("full", "片段一片段二片段三")]);
    expect(merged).toHaveLength(1);
    expect(merged?.[0].text).toBe("片段一片段二片段三");
  });

  it("merging full replay plus its own fragments ends up equal to the full replay", () => {
    const full = "第一步：读文件\n\n第二步：改代码";
    const fragments = [part("f1", "第一步：读文件"), part("f2", "第二步：改代码")];
    // Fragments first, then the whitespace-drifted full replay.
    const afterReplay = mergeAssistantThinkingParts(fragments, [part("full", "第一步：读文件\n第二步：改代码")]);
    expect(afterReplay).toHaveLength(1);
    expect(afterReplay?.[0].text).toBe("第一步：读文件\n第二步：改代码");
    // Late duplicate fragments must not reappear.
    const afterLateFragments = mergeAssistantThinkingParts(afterReplay, fragments);
    expect(afterLateFragments).toHaveLength(1);
    // Re-merging the same replay is idempotent.
    const again = mergeAssistantThinkingParts(afterReplay, [part("full-2", full)]);
    expect(again).toHaveLength(1);
  });

  it("skips fragments already covered by an existing part even with whitespace drift", () => {
    const existing = [part("full", "第一步：读文件\n\n第二步")];
    const merged = mergeAssistantThinkingParts(existing, [part("f1", "第一步：读文件 第二步")]);
    expect(merged).toHaveLength(1);
    expect(merged?.[0].text).toBe("第一步：读文件\n\n第二步");
  });

  it("out-of-order fragments followed by a full replay do not interleave", () => {
    // Fragments arrive out of order.
    const shuffled = [part("f2", "第二段"), part("f1", "第一段")];
    const withReplay = mergeAssistantThinkingParts(shuffled, [part("full", "第一段第二段")]);
    expect(withReplay).toHaveLength(1);
    expect(withReplay?.[0].text).toBe("第一段第二段");
  });

  it("keeps uncovered distinct parts and preserves their order", () => {
    const existing = [part("a", "思考A"), part("b", "思考B")];
    const merged = mergeAssistantThinkingParts(existing, [part("c", "思考C")]);
    expect(merged?.map((item) => item.text)).toEqual(["思考A", "思考B", "思考C"]);
  });

  it("restores no-offset thinking fragments to source timestamp order", () => {
    const merged = mergeAssistantThinkingParts(
      [part("later", " observations", 2)],
      [part("earlier", "Key", 1)],
    );
    expect(merged?.map((item) => item.text)).toEqual(["Key", " observations"]);
  });

  it("still upgrades a same-id part in place when the text grew", () => {
    const existing = [part("t1", "流式片段", 1), part("t2", "另一段", 2)];
    const merged = mergeAssistantThinkingParts(existing, [part("t1", "流式片段变长了", 3)]);
    expect(merged).toHaveLength(2);
    expect(merged?.[0]).toMatchObject({ id: "t1", text: "流式片段变长了" });
    expect(merged?.[1]).toMatchObject({ id: "t2", text: "另一段" });
  });

  it("keeps the existing version when a same-id part did not grow", () => {
    const existing = [part("t1", "完整文本")];
    const merged = mergeAssistantThinkingParts(existing, [part("t1", "完整")]);
    expect(merged?.[0].text).toBe("完整文本");
  });
});

describe("mergeEvents assistant thinking dedup", () => {
  it("does not double thinking when a snapshot replay overlaps live deltas", () => {
    const existing: TimelineEvent[] = [
      {
        id: "a-open",
        type: "assistant_message",
        timestamp: 2,
        content: "",
        thinking: "第一步：读文件\n\n第二步：改代码",
        isThinking: true,
        isComplete: false,
        agentTurnId: "turn-1",
      },
    ];
    const replay: TimelineEvent = {
      id: "a-replay",
      type: "assistant_message",
      timestamp: 3,
      content: "",
      thinking: "第一步：读文件\n第二步：改代码",
      isThinking: true,
      isComplete: false,
      agentTurnId: "turn-1",
    };
    const result = mergeEvents(existing, replay);
    const assistant = result.find((event) => event.type === "assistant_message");
    const thinking = assistant && assistant.type === "assistant_message" ? assistant.thinking ?? "" : "";
    expect(thinking.match(/第一步：读文件/g)).toHaveLength(1);
    expect(thinking.match(/第二步：改代码/g)).toHaveLength(1);
  });

  it("does not double thinkingParts when live fragments meet a full replay", () => {
    const existing: TimelineEvent[] = [
      {
        id: "a-open",
        type: "assistant_message",
        timestamp: 2,
        content: "",
        thinkingParts: [
          { id: "f1", timestamp: 2, text: "片段一" },
          { id: "f2", timestamp: 2, text: "片段二" },
        ],
        isThinking: true,
        isComplete: false,
        agentTurnId: "turn-1",
      },
    ];
    const replay: TimelineEvent = {
      id: "a-replay",
      type: "assistant_message",
      timestamp: 3,
      content: "",
      thinkingParts: [{ id: "full", timestamp: 3, text: "片段一片段二" }],
      isThinking: true,
      isComplete: false,
      agentTurnId: "turn-1",
    };
    const result = mergeEvents(existing, replay);
    const assistant = result.find((event) => event.type === "assistant_message");
    const parts = assistant && assistant.type === "assistant_message" ? assistant.thinkingParts ?? [] : [];
    expect(parts).toHaveLength(1);
    expect(parts[0].text).toBe("片段一片段二");
  });
});

describe("tool_result wire failure flag", () => {
  it("marks the linked tool_call as error when tool_result carries isError", () => {
    const existing: TimelineEvent[] = [
      { id: "1", type: "tool_call", timestamp: 1, toolCallId: "tc-err", toolName: "Grep", status: "running", arguments: {} },
    ];
    const incoming: TimelineEvent = {
      id: "2",
      type: "tool_result",
      timestamp: 2,
      toolCallId: "tc-err",
      toolName: "Grep",
      result: "Failed to grep: rg: no such file (os error 2)",
      isError: true,
    };
    const result = mergeEvents(existing, incoming);
    const toolCall = result[0] as Extract<TimelineEvent, { type: "tool_call" }>;
    expect(toolCall.status).toBe("error");
    expect(toolCall.result).toBe("Failed to grep: rg: no such file (os error 2)");
  });
});

describe("mergeEvents late stable user boundary", () => {
  it("inserts a late stable user boundary before newer events", () => {
    let events: TimelineEvent[] = [];
    events = mergeEvents(events, { id: "user:m1", type: "user_message", timestamp: 1_000, content: "第一轮" });
    events = mergeEvents(events, { id: "a1", type: "assistant_message", timestamp: 2_000, content: "第一轮回复", isThinking: false, isComplete: true });
    events = mergeEvents(events, { id: "a2", type: "assistant_message", timestamp: 4_000, content: "第二轮草稿", isThinking: false, isComplete: false });
    events = mergeEvents(events, { id: "user:m2", type: "user_message", timestamp: 3_000, content: "第二轮" });

    expect(events.map((event) => event.id)).toEqual(["user:m1", "a1", "user:m2", "a2"]);
  });

  it("does not remount a duplicate stable user boundary", () => {
    let events: TimelineEvent[] = [];
    events = mergeEvents(events, { id: "user:m1", type: "user_message", timestamp: 1_000, content: "第一轮" });
    events = mergeEvents(events, { id: "a1", type: "assistant_message", timestamp: 2_000, content: "第一轮回复", isThinking: false, isComplete: true });
    events = mergeEvents(events, { id: "a2", type: "assistant_message", timestamp: 4_000, content: "第二轮草稿", isThinking: false, isComplete: false });
    const withBoundary = mergeEvents(events, { id: "user:m2", type: "user_message", timestamp: 3_000, content: "第二轮" });
    const again = mergeEvents(withBoundary, { id: "user:m2", type: "user_message", timestamp: 3_000, content: "第二轮" });

    expect(again).toHaveLength(withBoundary.length);
    expect(again.map((event) => event.id)).toEqual(withBoundary.map((event) => event.id));
  });

  it("leaves local non-stable user messages on the original append path", () => {
    const existing: TimelineEvent[] = [
      { id: "user:m1", type: "user_message", timestamp: 1_000, content: "第一轮" },
      { id: "a1", type: "assistant_message", timestamp: 2_000, content: "第一轮回复", isThinking: false, isComplete: true },
    ];
    const incoming: TimelineEvent = { id: "kimi-code-event-x", type: "user_message", timestamp: 1_500, content: "本地消息" };

    const result = mergeEvents(existing, incoming);
    expect(result).toHaveLength(3);
    expect(result[result.length - 1].id).toBe("kimi-code-event-x");
  });
});

describe("status_update family-aware merge", () => {
  it("does not collapse a runtime notification into a following usage snapshot", () => {
    const existing: TimelineEvent[] = [
      { id: "n1", type: "status_update", timestamp: 1_000, message: "后台任务已完成：跑测试", source: "runtime", tone: "success" },
    ];
    const incoming: TimelineEvent = { id: "u1", type: "status_update", timestamp: 2_000, tokenCount: 10, inputTokenCount: 20 };

    const events = mergeEvents(existing, incoming);

    expect(events).toHaveLength(2);
    const [notification, usage] = events as Array<Extract<TimelineEvent, { type: "status_update" }>>;
    expect(notification.message).toBe("后台任务已完成：跑测试");
    expect(notification.tokenCount).toBeUndefined();
    expect(usage.message).toBeUndefined();
    expect(usage.tokenCount).toBe(10);
    expect(usage.inputTokenCount).toBe(20);
  });

  it("does not let a notification inherit prior usage metrics", () => {
    const existing: TimelineEvent[] = [
      { id: "u1", type: "status_update", timestamp: 1_000, message: "模型：x", tokenCount: 10, inputTokenCount: 20 },
    ];
    const incoming: TimelineEvent = { id: "n1", type: "status_update", timestamp: 2_000, message: "后台任务已完成：跑测试", source: "runtime", tone: "success" };

    const events = mergeEvents(existing, incoming);

    expect(events).toHaveLength(2);
    const [usage, notification] = events as Array<Extract<TimelineEvent, { type: "status_update" }>>;
    expect(usage.tokenCount).toBe(10);
    expect(notification.message).toBe("后台任务已完成：跑测试");
    expect(notification.tokenCount).toBeUndefined();
    expect(notification.inputTokenCount).toBeUndefined();
  });

  it("still collapses same-family metric rows and preserves the model message", () => {
    const existing: TimelineEvent[] = [
      { id: "u1", type: "status_update", timestamp: 1_000, message: "模型：x", tokenCount: 10 },
    ];
    const incoming: TimelineEvent = { id: "u2", type: "status_update", timestamp: 2_000, inputTokenCount: 20 };

    const events = mergeEvents(existing, incoming);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ message: "模型：x", tokenCount: 10, inputTokenCount: 20 });
  });
});
