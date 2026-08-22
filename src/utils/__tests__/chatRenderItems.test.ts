import { describe, expect, it } from "vitest";
import { buildRenderItems, filterStatusUpdates } from "@/components/chat/ChatThread";
import { assistantFooterFallbackLabel, timelineEventMemoKey } from "@/components/chat/MessageBubble";
import { createToolOnlyAssistantEvent } from "../chatRenderItems";
import type { RoomAgentActivity, TimelineEvent, ToolCallEvent } from "@/types/ui";

function activeRoomTurn(
  roomAgentId: string,
  activeTurnId: string,
  roomMessageId = "room-message",
  status: RoomAgentActivity["status"] = "running",
): RoomAgentActivity {
  return {
    roomId: "room",
    roomAgentId,
    status,
    roomMessageId,
    activeTurnId,
    updatedAt: 10,
  };
}

describe("createToolOnlyAssistantEvent", () => {
  it("creates a completed assistant header for pure completed tool turns", () => {
    const tools: ToolCallEvent[] = [
      {
        id: "tool-1",
        type: "tool_call",
        timestamp: 2,
        toolCallId: "call-1",
        toolName: "UpdateGoal",
        status: "success",
        arguments: { status: "complete" },
        rawArguments: "{\"status\":\"complete\"}",
        result: "Goal marked complete.",
      },
    ];

    const event = createToolOnlyAssistantEvent(tools);
    expect(event.type).toBe("assistant_message");
    expect(event.id).toBe("assistant-tools-tool-1");
    expect(event.content).toBe("");
    expect(event.isComplete).toBe(true);
  });

  it("keeps the assistant header active while any tool is running", () => {
    const event = createToolOnlyAssistantEvent([
      {
        id: "tool-1",
        type: "tool_call",
        timestamp: 1,
        toolCallId: "call-1",
        toolName: "UpdateGoal",
        status: "running",
        arguments: {},
      },
    ]);

    expect(event.isComplete).toBe(false);
  });
});

describe("createToolOnlyAssistantEvent with subagents", () => {
  it("keeps the process container active while any subagent is active", () => {
    const event = createToolOnlyAssistantEvent([], false, [
      {
        id: "agent-1",
        type: "subagent",
        timestamp: 3,
        agentName: "worker",
        status: "running",
        events: [],
      },
    ]);
    expect(event.content).toBe("");
    expect(event.isComplete).toBe(false);
  });

  it("never fabricates body content from subagent events", () => {
    const event = createToolOnlyAssistantEvent([], false, [
      {
        id: "agent-1",
        type: "subagent",
        timestamp: 1,
        agentId: "a1",
        agentName: "coder",
        status: "completed",
        events: [
          { id: "a1", type: "assistant_message", timestamp: 2, content: "子代理内部正文", isThinking: false, isComplete: true },
        ],
      },
    ]);
    expect(event.content).toBe("");
    expect(event.thinking).toBeUndefined();
    expect(event.isComplete).toBe(true);
  });
});

describe("buildRenderItems compaction placement", () => {
  it("places a completed pre-turn compaction between the user and assistant even when it arrived after assistant output", () => {
    const events: TimelineEvent[] = [{
      id: "user",
      type: "user_message",
      timestamp: 1,
      content: "继续处理",
    }, {
      id: "assistant",
      type: "assistant_message",
      timestamp: 3,
      content: "开始回复",
      isThinking: false,
      isComplete: true,
    }, {
      id: "compaction",
      type: "compaction",
      timestamp: 2,
      phase: "end",
      summary: "保留用户目标。",
    }];

    const renderedTypes = buildRenderItems(events, "kimi-code").map((item) => (
      item.type === "event" ? item.event.type : item.type
    ));
    expect(renderedTypes).toEqual(["user_message", "compaction", "assistant_message"]);
  });
});

describe("buildRenderItems usage footer", () => {
  const events: TimelineEvent[] = [{
    id: "user", type: "user_message", timestamp: 1, content: "继续处理",
  }, {
    id: "assistant", type: "assistant_message", timestamp: 2, content: "阶段性回复", isThinking: false, isComplete: true,
  }, {
    id: "usage-1", type: "status_update", timestamp: 3, inputTokenCount: 100, tokenCount: 20,
  }, {
    id: "usage-2", type: "status_update", timestamp: 4, inputTokenCount: 120, tokenCount: 30,
  }];

  it("does not reopen a completed Assistant once the next user boundary is present", () => {
    // Send path writes the next user_message before flipping isSessionRunning, so
    // the previous turn is superseded by hasLaterUserBoundary and keeps its footer.
    // (A bare isSessionRunning=true without the next user would incorrectly reopen
    // the latest complete step; that race is closed by send-path ordering, same as
    // the room path — not by treating mid-turn complete steps as turnSettled.)
    const nextUser: TimelineEvent = {
      id: "user-next",
      type: "user_message",
      timestamp: 5,
      content: "继续检查",
    };
    const items = buildRenderItems([...events, nextUser], "kimi-code", undefined, true);
    const previous = items.find((item) => (
      item.type === "event" && item.event.type === "assistant_message" && item.event.id === "assistant"
    ));
    expect(previous?.type).toBe("event");
    if (previous?.type !== "event") return;
    expect(previous.trailingStatuses?.map((status) => status.id)).toEqual(["usage-2"]);
    expect(previous.event.type === "assistant_message" && previous.event.isComplete).toBe(true);
    expect(previous.isAssistantActive).toBe(false);
  });

  it("keeps usage status in the same turn when its inherited turn id differs from the assistant official turn id", () => {
    // 根因场景（v2.20.75 回落“已完成”）：usage.record 无官方 turnId，status 继承本地乐观
    // turn 身份，assistant 事件带官方 turnId。若 status 参与 turn 切分，会把 user 边界+usage
    // 与 assistant 切成两个 turn，footer 丢用量回落成裸“已完成”、usage 独立飘出。
    const conflictEvents: TimelineEvent[] = [{
      id: "user-t13", type: "user_message", timestamp: 1, content: "继续处理",
    }, {
      id: "usage-inherited", type: "status_update", timestamp: 2,
      agentTurnId: "local-uuid-t13", inputTokenCount: 99640, tokenCount: 2260, message: "模型：kimi-k3",
    }, {
      id: "assistant-t13", type: "assistant_message", timestamp: 3,
      agentTurnId: "official-13", content: "最终答案", isThinking: false, isComplete: true, durationMs: 57000,
    }];
    const items = buildRenderItems(conflictEvents, "kimi-code", undefined, false);
    const assistants = items.filter((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistants).toHaveLength(1);
    const assistant = assistants[0];
    if (assistant?.type !== "event") return;
    // usage 状态未被切走，assistant footer 仍能拿到用量（不裸“已完成”）
    expect(assistant.trailingStatuses?.map((status) => status.id)).toEqual(["usage-inherited"]);
  });

  it("derives the active Assistant header when the latest user turn has lost its placeholder", () => {
    const nextUser: TimelineEvent = {
      id: "user-next",
      type: "user_message",
      timestamp: 5,
      content: "继续检查",
    };
    const items = buildRenderItems([...events, nextUser], "kimi-code", undefined, true);
    const nextUserIndex = items.findIndex((item) => item.type === "event" && item.event.id === nextUser.id);
    const activeAssistant = items.slice(nextUserIndex + 1).find((item) => (
      item.type === "event" && item.event.type === "assistant_message"
    ));

    expect(nextUserIndex).toBeGreaterThanOrEqual(0);
    expect(activeAssistant?.type).toBe("event");
    if (activeAssistant?.type !== "event" || activeAssistant.event.type !== "assistant_message") return;
    expect(activeAssistant.event.id).toBe("assistant-pending-user-next");
    expect(activeAssistant.event.content).toBe("");
    expect(activeAssistant.event.isComplete).toBe(false);
  });

  it("keeps the pending placeholder id stable when the real assistant event arrives (no bubble remount)", () => {
    const primaryAgentId = "room-agent:primary";
    const userTurn: TimelineEvent = {
      id: "user-active",
      type: "user_message",
      timestamp: 10,
      content: "继续检查",
      roomAgentId: primaryAgentId,
      roomMessageId: "room-message-active",
      agentTurnId: "turn-active",
    };

    const pending = buildRenderItems([userTurn], "kimi-code", undefined, true, [
      activeRoomTurn(primaryAgentId, "turn-active", "room-message-active", "running"),
    ], undefined, primaryAgentId)
      .find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(pending?.type).toBe("event");
    if (pending?.type !== "event") return;

    const withAssistant = buildRenderItems([userTurn, {
      id: "assistant-live",
      type: "assistant_message",
      timestamp: 11,
      content: "",
      isThinking: false,
      isComplete: false,
      roomAgentId: primaryAgentId,
      roomMessageId: "room-message-active",
      agentTurnId: "turn-active",
    }], "kimi-code", undefined, true, [
      activeRoomTurn(primaryAgentId, "turn-active", "room-message-active", "running"),
    ], undefined, primaryAgentId)
      .find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(withAssistant?.type).toBe("event");
    if (withAssistant?.type !== "event") return;

    expect(pending.event.id).toBe("assistant:turn-active");
    expect(withAssistant.event.id).toBe(pending.event.id);
  });

  it("projects a failed provider turn into a stable Assistant header instead of leaving only the user message", () => {
    const items = buildRenderItems([{
      id: "user-provider-failure",
      type: "user_message",
      timestamp: 1,
      content: "继续检查铸剑事件",
      roomAgentId: "room-agent:flash",
      roomMessageId: "room-message-provider-failure",
      agentTurnId: "turn-provider-failure",
    }, {
      id: "status-provider-failure",
      type: "status_update",
      timestamp: 2,
      message: "输出打断",
      roomAgentId: "room-agent:flash",
      roomMessageId: "room-message-provider-failure",
      agentTurnId: "turn-provider-failure",
    }, {
      id: "error-provider-failure",
      type: "error",
      timestamp: 3,
      message: "401 Insufficient balance. Manage your billing here: https://opencode.ai/billing",
      source: "sdk",
      canDismiss: true,
      roomAgentId: "room-agent:flash",
      roomMessageId: "room-message-provider-failure",
      agentTurnId: "turn-provider-failure",
    }], "kimi-code");

    const assistant = items.find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistant?.type).toBe("event");
    if (assistant?.type !== "event" || assistant.event.type !== "assistant_message") return;
    expect(assistant.event.id).toBe("assistant-failed-user-provider-failure");
    expect(assistant.event.content).toContain("第三方模型账户余额不足");
    expect(assistant.event.isComplete).toBe(true);
    expect(assistant.trailingStatuses?.map((status) => status.id)).toEqual(["status-provider-failure"]);
    expect(items.some((item) => item.type === "event" && item.event.type === "error")).toBe(false);
  });

  it("keeps a late-replayed historical change summary out of a newer failed turn", () => {
    const items = buildRenderItems([{
      id: "user-old-change",
      type: "user_message",
      timestamp: 1,
      content: "修改文件",
      agentTurnId: "turn-old-change",
    }, {
      id: "assistant-old-change",
      type: "assistant_message",
      timestamp: 4,
      content: "修改完成",
      isThinking: false,
      isComplete: true,
      agentTurnId: "turn-old-change",
    }, {
      id: "user-new-failure",
      type: "user_message",
      timestamp: 10,
      content: "继续检查",
      agentTurnId: "turn-new-failure",
    }, {
      id: "error-new-failure",
      type: "error",
      timestamp: 11,
      message: "503 auth_unavailable",
      source: "sdk",
      agentTurnId: "turn-new-failure",
    }, {
      // Legacy snapshot replay used to append this old derived event at the
      // physical tail without turn identity, despite its historical timestamp.
      id: "legacy-random-change-summary",
      type: "change_summary",
      timestamp: 3,
      files: [{ path: "TASK_STATE.md", additions: 23, deletions: 0 }],
      additions: 23,
      deletions: 0,
    }], "kimi-code");

    const oldAssistant = items.find((item) => (
      item.type === "event" && item.event.type === "assistant_message" && item.event.content === "修改完成"
    ));
    const failedAssistant = items.find((item) => (
      item.type === "event" && item.event.id === "assistant-failed-user-new-failure"
    ));

    expect(oldAssistant?.type).toBe("event");
    expect(failedAssistant?.type).toBe("event");
    if (oldAssistant?.type !== "event" || failedAssistant?.type !== "event") return;
    expect(oldAssistant.changeSummary?.files).toEqual([{
      path: "TASK_STATE.md",
      additions: 23,
      deletions: 0,
      sourceEventIds: ["legacy-random-change-summary"],
    }]);
    expect(failedAssistant.changeSummary).toBeUndefined();
  });

  it("moves the sibling diff of a late historical change summary back to its source turn", () => {
    const items = buildRenderItems([{
      id: "user-old-change",
      type: "user_message",
      timestamp: 1,
      content: "修改文件",
      agentTurnId: "turn-old-change",
    }, {
      id: "assistant-old-change",
      type: "assistant_message",
      timestamp: 4,
      content: "修改完成",
      isThinking: false,
      isComplete: true,
      agentTurnId: "turn-old-change",
    }, {
      id: "user-new-turn",
      type: "user_message",
      timestamp: 10,
      content: "继续检查",
      agentTurnId: "turn-new-turn",
    }, {
      id: "assistant-new-turn",
      type: "assistant_message",
      timestamp: 12,
      content: "第二轮回复",
      isThinking: false,
      isComplete: true,
      agentTurnId: "turn-new-turn",
    }, {
      // Misplaced persistence: the summary and its sibling diff/todo belong to
      // the first turn but landed after the second user boundary.
      id: "result-1:change-summary",
      type: "change_summary",
      timestamp: 3,
      files: [{ path: "src/a.ts", additions: 1, deletions: 1, diffEventId: "result-1:diff" }],
      additions: 1,
      deletions: 1,
    }, {
      id: "result-1:diff",
      type: "diff",
      timestamp: 3,
      filePath: "src/a.ts",
      oldText: "before",
      newText: "after",
    }, {
      id: "result-1:todo",
      type: "todo",
      timestamp: 3,
      items: [{ id: "todo-1", content: "跟进修改", status: "pending" }],
    }], "kimi-code");

    const oldAssistant = items.find((item) => (
      item.type === "event" && item.event.type === "assistant_message" && item.event.content === "修改完成"
    ));
    const newAssistant = items.find((item) => (
      item.type === "event" && item.event.type === "assistant_message" && item.event.content === "第二轮回复"
    ));
    expect(oldAssistant?.type).toBe("event");
    expect(newAssistant?.type).toBe("event");
    if (oldAssistant?.type !== "event" || newAssistant?.type !== "event") return;
    expect(oldAssistant.changeSummary?.files.map((file) => file.path)).toEqual(["src/a.ts"]);
    expect(newAssistant.changeSummary).toBeUndefined();
    // The sibling diff must not stay behind as a standalone card of the newer turn.
    expect(items.some((item) => item.type === "change_group")).toBe(false);
  });

  it("keeps a current tool-derived change summary in the current turn when its timestamp is stale", () => {
    const items = buildRenderItems([{
      id: "user-old-turn",
      type: "user_message",
      timestamp: 1,
      content: "上一轮任务",
    }, {
      id: "assistant-old-turn",
      type: "assistant_message",
      timestamp: 4,
      content: "上一轮已完成",
      isThinking: false,
      isComplete: true,
    }, {
      id: "user-current-turn",
      type: "user_message",
      timestamp: 10,
      content: "生成主题 JSON",
    }, {
      id: "assistant-current-turn",
      type: "assistant_message",
      timestamp: 11,
      content: "我直接生成并写入文件。",
      isThinking: false,
      isComplete: false,
    }, {
      id: "tool-current-write",
      type: "tool_call",
      timestamp: 12,
      toolCallId: "call-current-write",
      toolName: "Write",
      status: "success",
      arguments: { path: "kimix-ui-style-winxp-bevel.json" },
    }, {
      // Server/snapshot replay can append a current result with an older source
      // timestamp. Physical tool ownership must win over timestamp repair.
      id: "call-current-write:change-summary",
      type: "change_summary",
      timestamp: 3,
      files: [{
        path: "kimix-ui-style-winxp-bevel.json",
        additions: 311,
        deletions: 0,
        diffEventId: "call-current-write:diff",
      }],
      additions: 311,
      deletions: 0,
    }, {
      id: "call-current-write:diff",
      type: "diff",
      timestamp: 3,
      filePath: "kimix-ui-style-winxp-bevel.json",
      oldText: "",
      newText: "{}",
    }], "kimi-code", undefined, true);

    const oldAssistant = items.find((item) => (
      item.type === "event" && item.event.type === "assistant_message" && item.event.content === "上一轮已完成"
    ));
    const currentAssistant = items.find((item) => (
      item.type === "event" && item.event.type === "assistant_message" && item.event.content === "我直接生成并写入文件。"
    ));
    expect(oldAssistant?.type).toBe("event");
    expect(currentAssistant?.type).toBe("event");
    if (oldAssistant?.type !== "event" || currentAssistant?.type !== "event") return;
    expect(oldAssistant.changeSummary).toBeUndefined();
    expect(currentAssistant.changeSummary?.files.map((file) => file.path)).toEqual([
      "kimix-ui-style-winxp-bevel.json",
    ]);
  });

  it("matches the sibling diff by timestamp and path when the summary lacks a diffEventId", () => {
    const items = buildRenderItems([{
      id: "user-old-change",
      type: "user_message",
      timestamp: 1,
      content: "修改文件",
      agentTurnId: "turn-old-change",
    }, {
      id: "assistant-old-change",
      type: "assistant_message",
      timestamp: 4,
      content: "修改完成",
      isThinking: false,
      isComplete: true,
      agentTurnId: "turn-old-change",
    }, {
      id: "user-new-turn",
      type: "user_message",
      timestamp: 10,
      content: "继续检查",
      agentTurnId: "turn-new-turn",
    }, {
      id: "assistant-new-turn",
      type: "assistant_message",
      timestamp: 12,
      content: "第二轮回复",
      isThinking: false,
      isComplete: true,
      agentTurnId: "turn-new-turn",
    }, {
      id: "legacy-summary",
      type: "change_summary",
      timestamp: 3,
      files: [{ path: "src/a.ts", additions: 5, deletions: 2 }],
      additions: 5,
      deletions: 2,
    }, {
      id: "legacy-diff",
      type: "diff",
      timestamp: 3,
      filePath: "src/a.ts",
      oldText: "before",
      newText: "after",
    }, {
      // A genuinely newer diff must stay as a standalone card of the second turn.
      id: "other-turn-diff",
      type: "diff",
      timestamp: 11,
      filePath: "src/b.ts",
      oldText: "x",
      newText: "y",
    }], "kimi-code");

    const oldAssistant = items.find((item) => (
      item.type === "event" && item.event.type === "assistant_message" && item.event.content === "修改完成"
    ));
    expect(oldAssistant?.type).toBe("event");
    if (oldAssistant?.type !== "event") return;
    expect(oldAssistant.changeSummary?.files.map((file) => file.path)).toEqual(["src/a.ts"]);
    const changeGroupIds = items.filter((item) => item.type === "change_group")
      .map((item) => (item.type === "change_group" ? item.id : ""));
    expect(changeGroupIds).toEqual(["diff-group-other-turn-diff"]);
  });

  it("keeps the Assistant header during the primary room send-to-first-model-event gap", () => {
    const primaryAgentId = "room-agent:primary";
    const items = buildRenderItems([{
      id: "user-room-gap",
      type: "user_message",
      timestamp: 1,
      content: "整理完整列表",
      roomAgentId: primaryAgentId,
      roomMessageId: "room-message-gap",
      recipientAgentIds: [primaryAgentId],
    }, {
      id: "status-room-gap",
      type: "status_update",
      timestamp: 2,
      message: "消息已发送",
      source: "ipc",
      roomAgentId: primaryAgentId,
      roomMessageId: "room-message-gap",
      agentTurnId: "turn-room-gap",
    }], "kimi-code", undefined, true, [
      activeRoomTurn(primaryAgentId, "turn-room-gap", "room-message-gap", "sending"),
    ], undefined, primaryAgentId);
    const header = items.find((item) => (
      item.type === "event" && item.event.type === "assistant_message"
    ));

    expect(header?.type).toBe("event");
    if (header?.type !== "event" || header.event.type !== "assistant_message") return;
    expect(header.event.id).toBe("assistant:turn-room-gap");
    expect(header.event.isComplete).toBe(false);
    expect(header.isAssistantActive).toBe(true);
  });

  it("does not mark a primary room tool-use step complete while its prompt is still running", () => {
    const primaryAgentId = "room-agent:primary";
    const items = buildRenderItems([{
      id: "user-room-running",
      type: "user_message",
      timestamp: 1,
      content: "整理所有奇遇",
      roomAgentId: primaryAgentId,
      roomMessageId: "room-message-running",
      recipientAgentIds: [primaryAgentId],
    }, {
      id: "assistant-room-step-one",
      type: "assistant_message",
      timestamp: 2,
      content: "我先查看奇遇事件的定义结构，再整理完整列表。",
      isThinking: false,
      isComplete: true,
      roomAgentId: primaryAgentId,
      roomMessageId: "room-message-running",
      agentTurnId: "turn-room-running",
    }, {
      id: "tool-room-step-one",
      type: "tool_call",
      timestamp: 3,
      toolCallId: "tool-room-step-one",
      toolName: "Read",
      status: "success",
      arguments: {},
      roomAgentId: primaryAgentId,
      roomMessageId: "room-message-running",
      agentTurnId: "turn-room-running",
    }], "kimi-code", undefined, true, [
      activeRoomTurn(primaryAgentId, "turn-room-running", "room-message-running"),
    ], undefined, primaryAgentId);
    const header = items.find((item) => (
      item.type === "event" && item.event.type === "assistant_message"
    ));

    expect(header?.type).toBe("event");
    if (header?.type !== "event" || header.event.type !== "assistant_message") return;
    expect(header.event.isComplete).toBe(false);
    expect(header.isAssistantActive).toBe(true);
  });

  it("keeps a primary room turn running after a completed step when no activity matches it", () => {
    // agent-core-v2 commits a content-bearing, isComplete:true assistant step
    // mid-turn while the runtime keeps working. The room activity turn id can
    // momentarily fail to match the rendered turn (activeTurnId lost across a
    // status transition), so activeRoomAgentTurn is undefined here. The session
    // is still running, so the turn must NOT settle: the process header must not
    // say "输出完成" while the footer still says "运行中".
    const primaryAgentId = "room-agent:primary";
    const items = buildRenderItems([{
      id: "user-room-midturn",
      type: "user_message",
      timestamp: 1,
      content: "整理所有奇遇",
      roomAgentId: primaryAgentId,
      roomMessageId: "room-message-midturn",
      agentTurnId: "turn-room-midturn",
      recipientAgentIds: [primaryAgentId],
    }, {
      id: "assistant-room-committed-step",
      type: "assistant_message",
      timestamp: 2,
      content: "我先读剧情文本规范和现有机制清单，确保设计方案贴合项目写法与可实现的效果类型。",
      isThinking: false,
      isComplete: true,
      roomAgentId: primaryAgentId,
      roomMessageId: "room-message-midturn",
      agentTurnId: "turn-room-midturn",
    }], "kimi-code", undefined, true, [], undefined, primaryAgentId);
    const header = items.find((item) => (
      item.type === "event" && item.event.type === "assistant_message"
    ));

    expect(header?.type).toBe("event");
    if (header?.type !== "event" || header.event.type !== "assistant_message") return;
    expect(header.event.isComplete).toBe(false);
    expect(header.isAssistantActive).toBe(true);
  });

  it("keeps the primary room Assistant header during the send-to-thinking gap after a completed step closes the placeholder", () => {
    // The optimistic placeholder can close (isComplete flips / gets replaced)
    // before the first thinking delta of the next step arrives. With a
    // content-bearing completed step already present but no matching activity,
    // the old completed-output gate removed the header entirely during this
    // window ("消息头消失"). The latest running room turn must always keep a
    // visible active header.
    const primaryAgentId = "room-agent:primary";
    const items = buildRenderItems([{
      id: "user-room-gap2",
      type: "user_message",
      timestamp: 1,
      content: "继续",
      roomAgentId: primaryAgentId,
      roomMessageId: "room-message-gap2",
      agentTurnId: "turn-room-gap2",
      recipientAgentIds: [primaryAgentId],
    }, {
      id: "assistant-room-gap2-step",
      type: "assistant_message",
      timestamp: 2,
      content: "第一步已完成。",
      isThinking: false,
      isComplete: true,
      roomAgentId: primaryAgentId,
      roomMessageId: "room-message-gap2",
      agentTurnId: "turn-room-gap2",
    }, {
      id: "tool-room-gap2",
      type: "tool_call",
      timestamp: 3,
      toolCallId: "tool-room-gap2",
      toolName: "Read",
      status: "success",
      arguments: {},
      roomAgentId: primaryAgentId,
      roomMessageId: "room-message-gap2",
      agentTurnId: "turn-room-gap2",
    }], "kimi-code", undefined, true, [], undefined, primaryAgentId);
    const activeHeader = items.find((item) => (
      item.type === "event" && item.event.type === "assistant_message" && item.isAssistantActive
    ));

    expect(activeHeader?.type).toBe("event");
    if (activeHeader?.type !== "event" || activeHeader.event.type !== "assistant_message") return;
    expect(activeHeader.event.isComplete).toBe(false);
  });

  it("does not reopen an older primary room turn when the next turn becomes active", () => {
    const primaryAgentId = "room-agent:primary";
    const items = buildRenderItems([{
      id: "user-room-previous",
      type: "user_message",
      timestamp: 1,
      content: "上一轮",
      roomAgentId: primaryAgentId,
      roomMessageId: "room-message-previous",
      agentTurnId: "turn-room-previous",
    }, {
      id: "assistant-room-previous",
      type: "assistant_message",
      timestamp: 2,
      content: "上一轮已经完成",
      isThinking: false,
      isComplete: true,
      roomAgentId: primaryAgentId,
      roomMessageId: "room-message-previous",
      agentTurnId: "turn-room-previous",
    }, {
      id: "user-room-current",
      type: "user_message",
      timestamp: 3,
      content: "当前轮",
      roomAgentId: primaryAgentId,
      roomMessageId: "room-message-current",
      agentTurnId: "turn-room-current",
    }], "kimi-code", undefined, true, [
      activeRoomTurn(primaryAgentId, "turn-room-current", "room-message-current", "accepted"),
    ], undefined, primaryAgentId);
    const previous = items.find((item) => (
      item.type === "event" && item.event.id === "assistant:turn-room-previous"
    ));
    const current = items.find((item) => (
      item.type === "event" && item.event.id === "assistant:turn-room-current"
    ));

    expect(previous?.type).toBe("event");
    if (previous?.type !== "event" || previous.event.type !== "assistant_message") return;
    expect(previous.event.isComplete).toBe(true);
    expect(previous.isAssistantActive).toBe(false);
    expect(current?.type === "event" ? current.isAssistantActive : undefined).toBe(true);
  });

  it("keeps a superseded turn's final usage settled when its Assistant completion flag is stale", () => {
    const items = buildRenderItems([{
      id: "user-previous",
      type: "user_message",
      timestamp: 1,
      content: "上一轮",
    }, {
      id: "assistant-stale-open",
      type: "assistant_message",
      timestamp: 2,
      content: "上一轮已经输出完成",
      isThinking: false,
      isComplete: false,
    }, {
      id: "usage-previous",
      type: "status_update",
      timestamp: 3,
      inputTokenCount: 320_550,
      tokenCount: 3_160,
      contextSize: 0.0574,
    }, {
      id: "user-current",
      type: "user_message",
      timestamp: 4,
      content: "新一轮",
    }, {
      id: "assistant-current",
      type: "assistant_message",
      timestamp: 5,
      content: "",
      isThinking: true,
      isComplete: false,
    }], "kimi-code", undefined, true);
    const previousAssistant = items.find((item) => (
      item.type === "event" && item.event.id === "assistant-stale-open"
    ));

    expect(previousAssistant?.type).toBe("event");
    if (previousAssistant?.type !== "event" || previousAssistant.event.type !== "assistant_message") return;
    expect(previousAssistant.event.isComplete).toBe(true);
    expect(previousAssistant.isAssistantActive).toBe(false);
    expect(previousAssistant.trailingStatuses?.map((status) => status.id)).toEqual(["usage-previous"]);
    const currentAssistant = items.find((item) => (
      item.type === "event" && item.event.id === "assistant-current"
    ));
    expect(currentAssistant?.type === "event" ? currentAssistant.isAssistantActive : undefined).toBe(true);
  });

  it("keeps a successful tool-only latest turn active while the runtime is still running", () => {
    const items = buildRenderItems([{
      id: "user-tool-only",
      type: "user_message",
      timestamp: 1,
      content: "检查代码",
    }, {
      id: "tool-only",
      type: "tool_call",
      timestamp: 2,
      toolCallId: "tool-only",
      toolName: "Read",
      status: "success",
      arguments: {},
    }], "kimi-code", undefined, true);
    const assistant = items.find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistant?.type).toBe("event");
    if (assistant?.type !== "event" || assistant.event.type !== "assistant_message") return;
    expect(assistant.event.isComplete).toBe(false);
  });

  it("does not settle a mid-turn complete assistant while the session is still running (body-flash guard)", () => {
    // agent-core-v2 may mark a content-bearing step isComplete mid-turn. If we
    // treat that as turnSettled, the body flashes in the answer slot then folds
    // when the next tool/think phase reopens the turn.
    const items = buildRenderItems([{
      id: "user-mid",
      type: "user_message",
      timestamp: 1,
      content: "上一轮内容做完了吗",
    }, {
      id: "assistant-mid-step",
      type: "assistant_message",
      timestamp: 2,
      content: "你好霖江路。汇报一下：上一轮的设计实现代码部分已全部完成，正在跑最终验收。",
      isThinking: false,
      isComplete: true,
      durationMs: 136_054,
    }], "kimi-code", undefined, true);
    const assistant = items.find((item) => (
      item.type === "event" && item.event.type === "assistant_message" && item.event.id === "assistant-mid-step"
    ));
    expect(assistant?.type).toBe("event");
    if (assistant?.type !== "event" || assistant.event.type !== "assistant_message") return;
    expect(assistant.isAssistantActive).toBe(true);
    expect(assistant.event.isComplete).toBe(false);
  });

  it("does not project an incomplete visible tail as completed when runtime ownership disappears", () => {
    const items = buildRenderItems([{
      id: "user-tail",
      type: "user_message",
      timestamp: 1_000,
      content: "你好呀",
    }, {
      id: "assistant-tail",
      type: "assistant_message",
      timestamp: 4_000,
      content: "聊聊技术都行。",
      isThinking: false,
      isComplete: false,
    }], "kimi-code", undefined, false);
    const assistant = items.find((item) => item.type === "event" && item.event.id === "assistant-tail");
    expect(assistant?.type).toBe("event");
    if (assistant?.type !== "event" || assistant.event.type !== "assistant_message") return;
    expect(assistant.isAssistantActive).toBe(true);
    expect(assistant.event.isComplete).toBe(false);
  });

  it("shows only the final usage after the runtime turn settles", () => {
    const assistant = buildRenderItems(events, "kimi-code", undefined, false)
      .find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistant?.type).toBe("event");
    if (assistant?.type !== "event") return;
    expect(assistant.trailingStatuses?.map((status) => status.id)).toEqual(["usage-2"]);
  });

  it("keeps final usage when a generic completed status arrives afterwards", () => {
    const items = buildRenderItems([...events, {
      id: "completed-late",
      type: "status_update",
      timestamp: 5,
      message: "已完成",
    }], "kimi-code", undefined, false);
    const assistant = items.find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistant?.type).toBe("event");
    if (assistant?.type !== "event") return;
    expect(assistant.trailingStatuses?.map((status) => status.id)).toEqual(["usage-2"]);
  });

  it("synthesizes a context card with the turn model when only Server live context frames exist", () => {
    // 实机根因：Server 链路 live 状态帧只携带 context（无 usage.currentTurn/token 计数），
    // settle 后 finalUsageStatus 曾恒为 undefined，footer 回落到只剩「模型：k3」；
    // 切会话走 canonical（含 usage.record）才补齐。现在用本轮 context 帧合成信息卡并补模型文案。
    const items = buildRenderItems([{
      id: "user-server", type: "user_message", timestamp: 1, content: "继续处理",
    }, {
      id: "assistant-server", type: "assistant_message", timestamp: 2, content: "阶段性回复",
      isThinking: false, isComplete: true, model: "k3",
    }, {
      id: "context-live", type: "status_update", timestamp: 3,
      contextSize: 101_116, contextLimit: 262_144, source: "status_refresh",
    }], "kimi-code", undefined, false);
    const assistant = items.find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistant?.type).toBe("event");
    if (assistant?.type !== "event") return;
    expect(assistant.trailingStatuses).toHaveLength(1);
    expect(assistant.trailingStatuses?.[0]).toMatchObject({
      id: "context-live",
      message: "模型：k3",
      contextSize: 101_116,
      contextLimit: 262_144,
    });
  });
});

describe("buildRenderItems completed turn cache", () => {
  it("reuses a completed Assistant render item while rebuilding the active turn", () => {
    const completedUser: TimelineEvent = { id: "user-1", type: "user_message", timestamp: 1, content: "第一轮" };
    const completedAssistant: TimelineEvent = { id: "assistant-1", type: "assistant_message", timestamp: 2, content: "稳定正文", isThinking: false, isComplete: true };
    const activeUser: TimelineEvent = { id: "user-2", type: "user_message", timestamp: 3, content: "第二轮" };
    const activeAssistant: TimelineEvent = { id: "assistant-2", type: "assistant_message", timestamp: 4, content: "流式", isThinking: false, isComplete: false };
    const cache = new Map();
    const first = buildRenderItems([completedUser, completedAssistant, activeUser, activeAssistant], "kimi-code", undefined, true, undefined, cache);
    const updatedActiveAssistant: TimelineEvent = { ...activeAssistant, content: "流式增长" };
    const second = buildRenderItems([completedUser, completedAssistant, activeUser, updatedActiveAssistant], "kimi-code", undefined, true, undefined, cache);
    const firstCompleted = first.find((item) => item.type === "event" && item.event.id === completedAssistant.id);
    const secondCompleted = second.find((item) => item.type === "event" && item.event.id === completedAssistant.id);
    const firstActive = first.find((item) => item.type === "event" && item.event.id === activeAssistant.id);
    const secondActive = second.find((item) => item.type === "event" && item.event.id === activeAssistant.id);

    expect(secondCompleted).toBe(firstCompleted);
    expect(secondActive).not.toBe(firstActive);
  });
});

describe("buildRenderItems assistant identity", () => {
  it("uses roomMessageId when agentTurnId is an empty string", () => {
    const items = buildRenderItems([{
      id: "assistant-source",
      type: "assistant_message",
      timestamp: 1,
      content: "正文",
      isThinking: false,
      isComplete: true,
      agentTurnId: "",
      roomMessageId: "room-message-1",
    }], "kimi-code");
    const assistant = items.find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistant?.type === "event" ? assistant.event.id : undefined).toBe("assistant:room-message-1");
  });

  it("keeps the merged Assistant render id stable when another stream segment is appended", () => {
    const user: TimelineEvent = {
      id: "user-live",
      type: "user_message",
      timestamp: 1,
      content: "继续检查",
    };
    const firstSegment: TimelineEvent = {
      id: "assistant-first",
      type: "assistant_message",
      timestamp: 2,
      content: "已经完成第一步。",
      isThinking: false,
      isComplete: true,
    };
    const nextSegment: TimelineEvent = {
      id: "assistant-next",
      type: "assistant_message",
      timestamp: 3,
      content: "继续执行第二步。",
      isThinking: false,
      isComplete: false,
    };

    const before = buildRenderItems([user, firstSegment], "kimi-code", undefined, true)
      .find((item) => item.type === "event" && item.event.type === "assistant_message");
    const after = buildRenderItems([user, firstSegment, nextSegment], "kimi-code", undefined, true)
      .find((item) => item.type === "event" && item.event.type === "assistant_message");

    expect(before?.type).toBe("event");
    expect(after?.type).toBe("event");
    if (before?.type !== "event" || after?.type !== "event") return;
    expect(before.event.id).toBe("assistant-first");
    expect(after.event.id).toBe(before.event.id);
    expect(after.event.type === "assistant_message" ? after.event.content : "").toContain("继续执行第二步");
  });
});

describe("filterStatusUpdates room isolation", () => {
  it("keeps the final status for every Agent turn in turn-end mode", () => {
    const statuses: TimelineEvent[] = [{
      id: "reviewer-usage",
      type: "status_update",
      timestamp: 1,
      tokenCount: 22,
      inputTokenCount: 22036,
      roomAgentId: "reviewer",
      agentTurnId: "reviewer-turn",
    }, {
      id: "primary-usage",
      type: "status_update",
      timestamp: 2,
      tokenCount: 40,
      inputTokenCount: 23741,
      roomAgentId: "primary",
      agentTurnId: "primary-turn",
    }];

    expect(filterStatusUpdates(statuses, "turn_end").map((event) => event.id)).toEqual([
      "reviewer-usage",
      "primary-usage",
    ]);
  });

  it("still keeps only the latest status inside one Agent turn", () => {
    const statuses: TimelineEvent[] = [{
      id: "reviewer-interim",
      type: "status_update",
      timestamp: 1,
      tokenCount: 12,
      roomAgentId: "reviewer",
      agentTurnId: "reviewer-turn",
    }, {
      id: "reviewer-final",
      type: "status_update",
      timestamp: 2,
      tokenCount: 22,
      roomAgentId: "reviewer",
      agentTurnId: "reviewer-turn",
    }];

    expect(filterStatusUpdates(statuses, "turn_end").map((event) => event.id)).toEqual(["reviewer-final"]);
  });

  it("keeps the final metric status when a generic status arrives later in the same Agent turn", () => {
    const statuses: TimelineEvent[] = [{
      id: "reviewer-usage",
      type: "status_update",
      timestamp: 1,
      inputTokenCount: 22036,
      tokenCount: 22,
      contextSize: 0.42,
      roomAgentId: "reviewer",
      agentTurnId: "reviewer-turn",
    }, {
      id: "reviewer-permission",
      type: "status_update",
      timestamp: 2,
      message: "权限：完全访问",
      roomAgentId: "reviewer",
      agentTurnId: "reviewer-turn",
    }];

    expect(filterStatusUpdates(statuses, "turn_end").map((event) => event.id)).toEqual(["reviewer-usage"]);
  });

  it("keeps an interrupted terminal status together with the final metric status", () => {
    const statuses: TimelineEvent[] = [{
      id: "usage",
      type: "status_update",
      timestamp: 1,
      inputTokenCount: 22036,
      tokenCount: 22,
      contextSize: 0.42,
    }, {
      id: "interrupted",
      type: "status_update",
      timestamp: 2,
      message: "输出打断",
    }];

    expect(filterStatusUpdates(statuses, "turn_end").map((event) => event.id)).toEqual(["usage", "interrupted"]);
  });

  it("attaches interrupted state to a failed Assistant even when usage metrics exist", () => {
    const items = buildRenderItems([{
      id: "user-failed",
      type: "user_message",
      timestamp: 1,
      content: "？？？",
    }, {
      id: "usage-failed",
      type: "status_update",
      timestamp: 2,
      inputTokenCount: 138592,
      contextSize: 0.138592,
    }, {
      id: "assistant-failed",
      type: "assistant_message",
      timestamp: 3,
      content: "模型请求失败：本轮已结束，但模型未返回可显示内容。",
      snapshotMessageId: "msg-failed",
      snapshotMessageIdStable: true,
      isThinking: false,
      isComplete: true,
    }, {
      id: "interrupted-failed",
      type: "status_update",
      timestamp: 4,
      message: "输出打断",
    }], "kimi-code");
    const assistant = items.find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistant?.type).toBe("event");
    if (assistant?.type !== "event") return;
    expect(assistant.trailingStatuses?.map((status) => status.id)).toEqual(["interrupted-failed", "usage-failed"]);
  });

  it("keeps the latest generic status when an Agent turn has no metrics", () => {
    const statuses: TimelineEvent[] = [{
      id: "reviewer-plan",
      type: "status_update",
      timestamp: 1,
      message: "Plan 开",
      roomAgentId: "reviewer",
      agentTurnId: "reviewer-turn",
    }, {
      id: "reviewer-completed",
      type: "status_update",
      timestamp: 2,
      message: "已完成",
      roomAgentId: "reviewer",
      agentTurnId: "reviewer-turn",
    }];

    expect(filterStatusUpdates(statuses, "turn_end").map((event) => event.id)).toEqual(["reviewer-completed"]);
  });
});

describe("buildRenderItems room Agent turns", () => {
  const events: TimelineEvent[] = [{
    id: "room-message",
    type: "user_message",
    timestamp: 1,
    content: "分别检查",
    recipientAgentIds: ["agent-a", "agent-b"],
  }, {
    id: "assistant-a-part",
    type: "assistant_message",
    timestamp: 2,
    content: "A result",
    isThinking: false,
    isComplete: true,
    roomAgentId: "agent-a",
    roomMessageId: "room-message",
    agentTurnId: "turn-a",
  }, {
    id: "usage-a",
    type: "status_update",
    timestamp: 3,
    inputTokenCount: 10,
    tokenCount: 5,
    roomAgentId: "agent-a",
    roomMessageId: "room-message",
    agentTurnId: "turn-a",
  }, {
    id: "assistant-b-part",
    type: "assistant_message",
    timestamp: 4,
    content: "B result",
    isThinking: false,
    isComplete: true,
    roomAgentId: "agent-b",
    roomMessageId: "room-message",
    agentTurnId: "turn-b",
  }, {
    id: "usage-b",
    type: "status_update",
    timestamp: 5,
    inputTokenCount: 12,
    tokenCount: 6,
    roomAgentId: "agent-b",
    roomMessageId: "room-message",
    agentTurnId: "turn-b",
  }];

  it("keeps two Agent responses as separate stable render blocks", () => {
    const rendered = buildRenderItems(events, "kimi-code");
    const assistants = rendered.filter((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistants).toHaveLength(2);
    expect(assistants.map((item) => item.type === "event" ? item.event.id : "")).toEqual([
      "assistant:turn-a",
      "assistant:turn-b",
    ]);
    expect(assistants.map((item) => item.type === "event" && item.event.type === "assistant_message" ? item.event.content : "")).toEqual([
      "A result",
      "B result",
    ]);
  });

  it("uses the Agent activity set instead of treating only the last response as running", () => {
    const rendered = buildRenderItems(events, "kimi-code", undefined, false, [
      activeRoomTurn("agent-a", "turn-a"),
    ]);
    const assistantA = rendered.find((item) => item.type === "event" && item.event.id === "assistant:turn-a");
    expect(assistantA?.type).toBe("event");
    if (assistantA?.type !== "event") return;
    expect(assistantA.trailingStatuses).toEqual([]);
  });

  it("settles one Agent footer while another Agent in the room is still running", () => {
    const rendered = buildRenderItems(events, "kimi-code", undefined, true, [
      activeRoomTurn("agent-a", "turn-a"),
    ]);
    const assistantB = rendered.find((item) => item.type === "event" && item.event.id === "assistant:turn-b");
    expect(assistantB?.type).toBe("event");
    if (assistantB?.type !== "event") return;
    expect(assistantB.trailingStatuses?.map((status) => status.id)).toEqual(["usage-b"]);
  });

  it("keeps Agent A usage attached after Agent B starts and emits a generic status", () => {
    const visibleEvents = filterStatusUpdates([...events, {
      id: "agent-b-running",
      type: "status_update",
      timestamp: 6,
      message: "正在处理",
      roomAgentId: "agent-b",
      roomMessageId: "room-message",
      agentTurnId: "turn-b",
    }], "turn_end");
    const rendered = buildRenderItems(visibleEvents, "kimi-code", undefined, true, [
      activeRoomTurn("agent-b", "turn-b"),
    ]);
    const assistantA = rendered.find((item) => item.type === "event" && item.event.id === "assistant:turn-a");
    expect(assistantA?.type).toBe("event");
    if (assistantA?.type !== "event") return;
    expect(assistantA.trailingStatuses?.map((status) => status.id)).toEqual(["usage-a"]);
  });
});

describe("assistant footer fallback", () => {
  it("keeps the full room-turn duration instead of the first Assistant segment duration", () => {
    const rendered = buildRenderItems([{
      id: "user",
      type: "user_message",
      timestamp: 1_000,
      content: "处理完整轮次",
    }, {
      id: "assistant-progress",
      type: "assistant_message",
      timestamp: 66_232,
      content: "先处理第一阶段。",
      isThinking: false,
      isComplete: true,
      durationMs: 269_463,
    }, {
      id: "tool",
      type: "tool_call",
      timestamp: 300_000,
      toolCallId: "call-1",
      toolName: "Bash",
      status: "success",
      arguments: {},
    }, {
      id: "assistant-final",
      type: "assistant_message",
      timestamp: 478_709,
      content: "完整最终正文",
      isThinking: false,
      isComplete: true,
      durationMs: 477_709,
    }], "kimi-code");
    const assistantItem = rendered.find(
      (item) => item.type === "event" && item.event.type === "assistant_message",
    );
    expect(assistantItem?.type).toBe("event");
    if (assistantItem?.type !== "event" || assistantItem.event.type !== "assistant_message") return;
    expect(assistantItem.event.durationMs).toBe(477_709);
  });

  it("does not extend a completed turn with late passive status snapshots", () => {
    const rendered = buildRenderItems([{
      id: "user",
      type: "user_message",
      timestamp: 1_000,
      content: "处理问题",
    }, {
      id: "assistant",
      type: "assistant_message",
      timestamp: 31_000,
      content: "完整最终正文",
      isThinking: false,
      isComplete: true,
    }, {
      id: "late-status",
      type: "status_update",
      timestamp: 101_000,
      message: "已连接",
    }], "kimi-code");
    const assistantItem = rendered.find(
      (item) => item.type === "event" && item.event.type === "assistant_message",
    );
    expect(assistantItem?.type).toBe("event");
    if (assistantItem?.type !== "event" || assistantItem.event.type !== "assistant_message") return;
    expect(assistantItem.event.durationMs).toBe(30_000);
  });

  it("preserves original event ids when a Kimi turn is merged for rendering", () => {
    const rendered = buildRenderItems([{
      id: "user",
      type: "user_message",
      timestamp: 1,
      content: "处理问题",
    }, {
      id: "assistant-thinking",
      type: "assistant_message",
      timestamp: 2,
      content: "",
      thinking: "先检查",
      isThinking: true,
      isComplete: true,
    }, {
      id: "tool",
      type: "tool_call",
      timestamp: 3,
      toolCallId: "call-1",
      toolName: "Read",
      arguments: { path: "README.md" },
      status: "success",
    }, {
      id: "assistant-final",
      type: "assistant_message",
      timestamp: 4,
      content: "检查完成",
      isThinking: false,
      isComplete: true,
    }], "kimi-code");
    const assistantItem = rendered.find(
      (item) => item.type === "event" && item.event.type === "assistant_message",
    );

    expect(assistantItem?.type).toBe("event");
    if (assistantItem?.type !== "event") return;
    expect(assistantItem.sourceEventIds).toEqual([
      "assistant-thinking",
      "tool",
      "assistant-final",
    ]);
  });

  it("uses the official turn model instead of an unreliable long duration for room Agents", () => {
    expect(assistantFooterFallbackLabel({
      id: "assistant-room",
      type: "assistant_message",
      timestamp: 1,
      content: "完成",
      model: "openai/gpt-5",
      isThinking: false,
      isComplete: true,
      durationMs: 12_370_000,
      roomAgentId: "agent-a",
      agentTurnId: "turn-a",
    }, false)).toBe("模型：gpt-5");
  });

  it("shows reliable duration for a room Agent when no official model is present", () => {
    // roomAgentId 不再提前回落裸“已完成”：有可靠 durationMs 时同样展示用时
    expect(assistantFooterFallbackLabel({
      id: "assistant-room",
      type: "assistant_message",
      timestamp: 1,
      content: "完成",
      isThinking: false,
      isComplete: true,
      durationMs: 65_000,
      roomAgentId: "agent-a",
      agentTurnId: "turn-a",
    }, false)).toBe("已完成 · 用时 1分5秒");
  });

  it("shows only completed when a room Agent has neither an official model nor a reliable duration", () => {
    expect(assistantFooterFallbackLabel({
      id: "assistant-room",
      type: "assistant_message",
      timestamp: 1,
      content: "完成",
      isThinking: false,
      isComplete: true,
      durationMs: undefined,
      roomAgentId: "agent-a",
      agentTurnId: "turn-a",
    }, false)).toBe("已完成");
  });

  it("keeps the existing reliable duration fallback for ordinary single-Agent sessions", () => {
    expect(assistantFooterFallbackLabel({
      id: "assistant-single",
      type: "assistant_message",
      timestamp: 1,
      content: "完成",
      isThinking: false,
      isComplete: true,
      durationMs: 65_000,
    }, false)).toBe("已完成 · 用时 1分5秒");
  });

  it("shows 后台 Bash 运行中 when the active turn is complete and a background Bash task is still running", () => {
    expect(assistantFooterFallbackLabel({
      id: "assistant-active",
      type: "assistant_message",
      timestamp: 1,
      content: "正文",
      isThinking: false,
      isComplete: true,
      durationMs: 65_000,
    }, true, true)).toBe("后台 Bash 运行中");
  });

  it("shows 模型与后台 Bash 运行中并列 for a settled turn with a known model", () => {
    // 后台运行中只盖状态不吞模型：当轮模型仍可读（review 中 9）。
    expect(assistantFooterFallbackLabel({
      id: "assistant-settled",
      type: "assistant_message",
      timestamp: 1,
      content: "正文",
      model: "openai/gpt-5",
      isThinking: false,
      isComplete: true,
      durationMs: 65_000,
    }, false, true)).toBe("模型：gpt-5 · 后台 Bash 运行中");
  });

  it("shows bare 后台 Bash 运行中 for a settled turn without a model", () => {
    expect(assistantFooterFallbackLabel({
      id: "assistant-settled-nomodel",
      type: "assistant_message",
      timestamp: 1,
      content: "正文",
      isThinking: false,
      isComplete: true,
      durationMs: 65_000,
    }, false, true)).toBe("后台 Bash 运行中");
  });

  it("keeps 消息处理中 while the assistant turn is still active even with a running background Bash task", () => {
    expect(assistantFooterFallbackLabel({
      id: "assistant-active",
      type: "assistant_message",
      timestamp: 1,
      content: "",
      isThinking: true,
      isComplete: false,
    }, true, true)).toBe("消息处理中");
  });

  it("behaves identically when the third argument is omitted or false", () => {
    const event = {
      id: "assistant-single",
      type: "assistant_message" as const,
      timestamp: 1,
      content: "完成",
      isThinking: false,
      isComplete: true,
      durationMs: 65_000,
    };
    expect(assistantFooterFallbackLabel(event, false)).toBe(assistantFooterFallbackLabel(event, false, false));
    expect(assistantFooterFallbackLabel(event, false, false)).toBe("已完成 · 用时 1分5秒");
    expect(assistantFooterFallbackLabel(event, true, false)).toBe("消息处理中");
  });
});

describe("message footer memoization", () => {
  it("detects metric changes even when a status keeps the same event identity", () => {
    const before: TimelineEvent = {
      id: "usage",
      type: "status_update",
      timestamp: 1,
      inputTokenCount: 100,
      tokenCount: 20,
    };
    const after: TimelineEvent = {
      ...before,
      inputTokenCount: 120,
      tokenCount: 30,
      contextSize: 0.5,
    };

    expect(timelineEventMemoKey(before)).not.toBe(timelineEventMemoKey(after));
  });
});

describe("buildRenderItems steer boundary", () => {
  it("keeps a running turn together across a steer (no phantom new turn)", () => {
    // 官方 steer 只注入当前运行中的 turn（turnId 不变，steer 后同一轮继续输出，
    // thinking.delta 按 step 从 offset=0 重启）。真实时序里 steer 事件插入时
    // step1 尚未 commit（draft 流），assistant 事件在 steer 之后落数组。
    // 旧实现把 steer_message 当 turn 边界 flushTurn：steer 后的思考流进入
    // 「无 user 消息的伪新轮」，渲染出独立轮次头部 + 新思考块，与已 settle 的
    // 上一段思考并存（实机：steer 后同一段思考出现两个块）。
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "确认一下" },
      { id: "steer-1", type: "steer_message", timestamp: 2, content: "顺便把版本迭代到162行吗", status: "accepted" },
      {
        id: "assistant-1", type: "assistant_message", timestamp: 3,
        content: "可以，升到 v1.6.2。", thinking: "重新分析。", isThinking: false,
        isComplete: true, agentTurnId: "turn-8",
      },
    ];
    const items = buildRenderItems(events, "kimi-code", undefined, true);
    // 同一 turn 内：只有一个 assistant 渲染单元（不出现「新一轮」独立头部）
    const assistants = items.filter((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistants).toHaveLength(1);
    // steer 按事件位置渲染为独立单元，且位于 assistant 内容之前（官方注入点
    // 语义：steer 气泡在注入处、其后的回复段排在后面。旧实现 attached 到过程卡
    // 之后渲染，实机截图出现「回复在引导气泡之前」的倒挂）
    const steerIndex = items.findIndex((item) => item.type === "event" && item.event.type === "steer_message");
    const assistantIndex = items.findIndex((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(steerIndex).toBeGreaterThanOrEqual(0);
    expect(assistantIndex).toBeGreaterThan(steerIndex);
    const steer = items[steerIndex];
    if (steer?.type !== "event") return;
    expect(steer.event.id).toEqual("steer-1");
  });

  it("renders a steer with no enclosing turn as a standalone bubble", () => {
    const events: TimelineEvent[] = [
      { id: "steer-1", type: "steer_message", timestamp: 3, content: "先处理缓存", status: "accepted" },
    ];
    const items = buildRenderItems(events, "kimi-code", undefined, false);
    const steer = items.find((item) => item.type === "event" && item.event.type === "steer_message");
    expect(steer?.type).toBe("event");
    if (steer?.type !== "event") return;
    expect(steer.event.id).toEqual("steer-1");
  });

  it("splits the turn at a steer when a committed body precedes it (official two-work-turn shape)", () => {
    // 实机 532ff5cb 08:53：steer 在 step 1 正文（已 commit）之后注入，官方
    // kimi-web 显示「user → 工作轮 1 → steer → 工作轮 2」两个独立工作轮。
    // 旧实现（242 无条件不切分）把两轮内容粘连成一个折叠轮（总耗时错误累加、
    // 轮 1 正文与轮 2 总结被折叠吞掉）。条件切分：steer 前（同 user 轮内）
    // 已有带正文的 assistant 事件 → steer 作为轮间边界切分。
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "你找到上次我发的那个文件了吗" },
      {
        id: "assistant-1", type: "assistant_message", timestamp: 2,
        content: "你好霖江路。`dist/` 里的构建产物还在，我直接再复制一份到桌面：`RemoveBlack-v1.6.1-ai-test.exe`",
        thinking: "Done.", isThinking: false, isComplete: true, agentTurnId: "turn-8",
      },
      { id: "steer-1", type: "steer_message", timestamp: 3, content: "顺便把版本迭代到162行吗", status: "sent" },
      {
        id: "assistant-2", type: "assistant_message", timestamp: 4,
        content: "## 版本总结", thinking: "Six spots.", isThinking: false,
        isComplete: true, agentTurnId: "turn-8",
      },
    ];
    const items = buildRenderItems(events, "kimi-code", undefined, false);
    // 两个 assistant 渲染单元（轮 1 与轮 2 分开，不再粘连成一个折叠轮）
    const assistants = items.filter((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistants).toHaveLength(2);
    expect(new Set(assistants.map((item) => item.type === "event" ? item.event.id : "")).size).toBe(2);
    expect(assistants.map((item) => item.type === "event" ? item.event.id : "")).toEqual([
      "assistant:turn-8",
      "assistant:turn-8:segment-1",
    ]);
    // steer 独立渲染在两轮之间
    const steerIndex = items.findIndex((item) => item.type === "event" && item.event.type === "steer_message");
    const firstAssistantIndex = items.findIndex((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(steerIndex).toBeGreaterThan(firstAssistantIndex);
    const steer = items[steerIndex];
    if (steer?.type !== "event") return;
    expect(steer.event.id).toEqual("steer-1");
  });

  it("settles the pre-steer turn while the official turn keeps running after the split", () => {
    // 实机 v2.20.247 live 窗口（session_532ff5cb 同款时序）：steer 切分后官方
    // turn 仍在运行，roomAgentActivities 仍按同一 agentTurnId 匹配到前段轮
    // （roomAgentActivityMatchesTurn 不看 isLatestTurn）→ 前段轮被判 active：
    // 旧思考保持 live 滚动窗不折叠、footer 停在「消息处理中」，与 steer 后
    // 最新轮的 live 窗并存（同一份 draft 两处渲染 → 同文上下重复出现 +
    // 两个带滑块的滚动区）。期望：steer 轮间边界之后前段轮按 settle 渲染
    // （思考折叠为总结、isAssistantActive=false），live 只留在 steer 后的最新轮。
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "继续上次的工作" },
      {
        id: "assistant-1", type: "assistant_message", timestamp: 2,
        content: "你好霖江路。我先看代码确认橡皮的实际语义。",
        thinking: "Understanding the app: left panel has 画笔/橡皮 tools.",
        isThinking: false, isComplete: true, agentTurnId: "turn-8", roomAgentId: "primary",
      },
      { id: "steer-1", type: "steer_message", timestamp: 3, content: "另外先把163构建出来放桌面上吧", status: "sent" },
    ];
    const items = buildRenderItems(events, "kimi-code", undefined, true, [activeRoomTurn("primary", "turn-8")]);
    const assistants = items.filter((item) => item.type === "event" && item.event.type === "assistant_message");
    // 前段轮（steer 前的已提交正文）+ steer 后最新轮的 pending 渲染占位
    expect(assistants).toHaveLength(2);
    const preSteer = assistants[0];
    if (preSteer?.type !== "event" || preSteer.event.type !== "assistant_message") return;
    // 前段轮 settle：不再 active，按完成态渲染（思考折叠 teaser、footer 不再「消息处理中」）
    expect(preSteer.isAssistantActive).toBe(false);
    expect(preSteer.event.isComplete).toBe(true);
    expect(preSteer.event.isThinking).toBe(false);
    // live 状态只留在 steer 后的最新轮
    const postSteer = assistants[1];
    if (postSteer?.type !== "event") return;
    expect(postSteer.isAssistantActive).toBe(true);
    const actives = assistants.filter((item) => item.type === "event" && item.isAssistantActive);
    expect(actives).toHaveLength(1);
  });

  it("keeps only the latest same-Agent segment live after a canonical user boundary", () => {
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "开始", roomAgentId: "primary", roomMessageId: "room-1", agentTurnId: "turn-8" },
      { id: "assistant-1", type: "assistant_message", timestamp: 2, content: "第一段", thinking: "已完成", isThinking: false, isComplete: true, roomAgentId: "primary", roomMessageId: "room-1", agentTurnId: "turn-8" },
      { id: "steer-1", type: "steer_message", timestamp: 3, content: "引导", status: "sent", roomAgentId: "primary", roomMessageId: "room-1", agentTurnId: "turn-8" },
      { id: "assistant-2", type: "assistant_message", timestamp: 4, content: "第二段", thinking: "继续", isThinking: true, isComplete: false, roomAgentId: "primary", roomMessageId: "room-1", agentTurnId: "turn-8" },
      { id: "user-2", type: "user_message", timestamp: 5, content: "确认", roomAgentId: "primary", roomMessageId: "room-2", agentTurnId: "turn-8" },
      { id: "assistant-3", type: "assistant_message", timestamp: 6, content: "", isThinking: false, isComplete: false, roomAgentId: "primary", roomMessageId: "room-2", agentTurnId: "turn-8" },
    ];
    const items = buildRenderItems(events, "kimi-code", undefined, true, [activeRoomTurn("primary", "turn-8", "room-2")]);
    const assistants = items.filter((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistants.filter((item) => item.type === "event" && item.isAssistantActive)).toHaveLength(1);
    const stale = assistants.find((item) => item.type === "event" && item.event.id === "assistant:turn-8:segment-1");
    expect(stale?.type === "event" ? stale.isAssistantActive : undefined).toBe(false);
  });

  it("does not settle an active Agent when a different Agent receives the later user boundary", () => {
    const events: TimelineEvent[] = [
      { id: "user-a", type: "user_message", timestamp: 1, content: "交给 A", roomAgentId: "agent-a", roomMessageId: "room-a", agentTurnId: "turn-a" },
      { id: "assistant-a", type: "assistant_message", timestamp: 2, content: "A 正在处理", isThinking: true, isComplete: false, roomAgentId: "agent-a", roomMessageId: "room-a", agentTurnId: "turn-a" },
      { id: "user-b", type: "user_message", timestamp: 3, content: "同时交给 B", roomAgentId: "agent-b", roomMessageId: "room-b", agentTurnId: "turn-b" },
    ];
    const items = buildRenderItems(events, "kimi-code", undefined, true, [activeRoomTurn("agent-a", "turn-a", "room-a")]);
    const assistantA = items.find((item) => item.type === "event" && item.event.id === "assistant:turn-a");
    expect(assistantA?.type === "event" ? assistantA.isAssistantActive : undefined).toBe(true);
  });

  it("settles a completed turn even when a background subagent is still running", () => {
    // 实机：主 Agent 输出完成、会话已停，但轮内带着 run_in_background 启动的
    // 子代理仍是 running（可能跑几十分钟）。前台执行必然伴随会话运行中，会话
    // 已停时 running 条目只可能是后台任务或残留标志，不该挡住 settle——否则
    // hasFinalContent 永不翻真，思考工具链始终不自动折叠。
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "后台跑个子代理" },
      {
        id: "assistant-1", type: "assistant_message", timestamp: 2,
        content: "你好霖江路。子代理已在后台运行，完成后会通知你。",
        isThinking: false, isComplete: true, agentTurnId: "turn-bg",
      },
      {
        id: "subagent-1", type: "subagent", timestamp: 3,
        agentName: "后台调研", status: "running", events: [],
      },
    ];
    const items = buildRenderItems(events, "kimi-code", undefined, false);
    const header = items.find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(header?.type).toBe("event");
    if (header?.type !== "event" || header.event.type !== "assistant_message") return;
    expect(header.isAssistantActive).toBe(false);
    expect(header.event.isComplete).toBe(true);
  });

  it("settles a completed turn even when a tool result never arrived", () => {
    // 同类残留：轮已结束但工具事件没收到 result，status 永久卡在 running。
    const events: TimelineEvent[] = [
      { id: "user-1", type: "user_message", timestamp: 1, content: "跑个工具" },
      {
        id: "assistant-1", type: "assistant_message", timestamp: 2,
        content: "你好霖江路。工具结果缺失，但输出已结束。",
        isThinking: false, isComplete: true, agentTurnId: "turn-orphan",
      },
      {
        id: "tool-1", type: "tool_call", timestamp: 3,
        toolCallId: "tool-1", toolName: "Bash", status: "running", arguments: {},
      },
    ];
    const items = buildRenderItems(events, "kimi-code", undefined, false);
    const header = items.find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(header?.type).toBe("event");
    if (header?.type !== "event" || header.event.type !== "assistant_message") return;
    expect(header.isAssistantActive).toBe(false);
    expect(header.event.isComplete).toBe(true);
  });
});
