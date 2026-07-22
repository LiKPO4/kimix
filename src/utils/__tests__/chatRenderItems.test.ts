import { describe, expect, it } from "vitest";
import { buildRenderItems, filterStatusUpdates } from "@/components/chat/ChatThread";
import { assistantFooterFallbackLabel, timelineEventMemoKey } from "@/components/chat/MessageBubble";
import { createSubagentOnlyAssistantEvent, createToolOnlyAssistantEvent } from "../chatRenderItems";
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

describe("createSubagentOnlyAssistantEvent", () => {
  it("keeps the assistant header active while any subagent is active", () => {
    const subagents: Extract<TimelineEvent, { type: "subagent" }>[] = [
      {
        id: "agent-1",
        type: "subagent",
        timestamp: 3,
        agentName: "worker",
        status: "running",
        events: [],
      },
      {
        id: "agent-2",
        type: "subagent",
        timestamp: 4,
        agentName: "worker",
        status: "completed",
        events: [],
      },
    ];

    const event = createSubagentOnlyAssistantEvent(subagents);
    expect(event.type).toBe("assistant_message");
    expect(event.id).toBe("assistant-subagents-agent-1:agent-2");
    expect(event.content).toBe("");
    expect(event.isComplete).toBe(false);
  });

  it("creates a completed assistant header when all subagents are settled", () => {
    const event = createSubagentOnlyAssistantEvent([
      {
        id: "agent-1",
        type: "subagent",
        timestamp: 5,
        agentName: "worker",
        status: "completed",
        events: [],
      },
    ]);

    expect(event.isComplete).toBe(true);
  });

  it("surfaces assistant content from subagent events when the main timeline has none", () => {
    const subagents: Extract<TimelineEvent, { type: "subagent" }>[] = [
      {
        id: "agent-1",
        type: "subagent",
        timestamp: 1,
        agentId: "a1",
        agentName: "coder",
        status: "completed",
        events: [
          { id: "a1", type: "assistant_message", timestamp: 2, content: "剩余小债务", isThinking: false, isComplete: true },
        ],
      },
    ];
    const event = createSubagentOnlyAssistantEvent(subagents);
    expect(event.content).toBe("剩余小债务");
    expect(event.isComplete).toBe(true);
  });

  it("joins content from multiple subagent assistant messages", () => {
    const subagents: Extract<TimelineEvent, { type: "subagent" }>[] = [
      {
        id: "s1",
        type: "subagent",
        timestamp: 1,
        agentId: "a1",
        agentName: "coder",
        status: "completed",
        events: [
          { id: "a1", type: "assistant_message", timestamp: 2, content: "第一部分", isThinking: false, isComplete: true },
          { id: "a2", type: "assistant_message", timestamp: 3, content: "第二部分", isThinking: false, isComplete: true },
        ],
      },
    ];
    const event = createSubagentOnlyAssistantEvent(subagents);
    expect(event.content).toBe("第一部分\n\n第二部分");
  });

  it("collects thinking from subagent events", () => {
    const subagents: Extract<TimelineEvent, { type: "subagent" }>[] = [
      {
        id: "s1",
        type: "subagent",
        timestamp: 1,
        agentId: "a1",
        agentName: "coder",
        status: "completed",
        events: [
          { id: "a1", type: "assistant_message", timestamp: 2, content: "", thinking: "思考内容", isThinking: false, isComplete: true },
        ],
      },
    ];
    const event = createSubagentOnlyAssistantEvent(subagents);
    expect(event.thinking).toBe("思考内容");
  });

  it("collects content from nested subagent events", () => {
    const subagents: Extract<TimelineEvent, { type: "subagent" }>[] = [
      {
        id: "s1",
        type: "subagent",
        timestamp: 1,
        agentId: "a1",
        agentName: "coder",
        status: "completed",
        events: [
          {
            id: "s2",
            type: "subagent",
            timestamp: 2,
            agentId: "a2",
            agentName: "reviewer",
            status: "completed",
            events: [
              { id: "a2", type: "assistant_message", timestamp: 3, content: "嵌套子代理正文", isThinking: false, isComplete: true },
            ],
          },
        ],
      },
    ];
    const event = createSubagentOnlyAssistantEvent(subagents);
    expect(event.content).toBe("嵌套子代理正文");
  });

  it("collects thinking from thinkingParts when thinking field is empty", () => {
    const subagents: Extract<TimelineEvent, { type: "subagent" }>[] = [
      {
        id: "s1",
        type: "subagent",
        timestamp: 1,
        agentId: "a1",
        agentName: "coder",
        status: "completed",
        events: [
          {
            id: "a1",
            type: "assistant_message",
            timestamp: 2,
            content: "",
            thinking: "",
            thinkingParts: [{ id: "tp1", timestamp: 2, text: "分段思考", signature: "sig1" }],
            isThinking: false,
            isComplete: true,
          },
        ],
      },
    ];
    const event = createSubagentOnlyAssistantEvent(subagents);
    expect(event.thinking).toBe("分段思考");
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

  it("does not reopen a completed Assistant while the next runtime turn is starting", () => {
    const assistant = buildRenderItems(events, "kimi-code", undefined, true)
      .find((item) => item.type === "event" && item.event.type === "assistant_message");
    expect(assistant?.type).toBe("event");
    if (assistant?.type !== "event") return;
    expect(assistant.trailingStatuses?.map((status) => status.id)).toEqual(["usage-2"]);
    expect(assistant.event.type === "assistant_message" && assistant.event.isComplete).toBe(true);
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
    }]);
    expect(failedAssistant.changeSummary).toBeUndefined();
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

  it("shows only completed when a room Agent has neither metrics nor an official model", () => {
    expect(assistantFooterFallbackLabel({
      id: "assistant-room",
      type: "assistant_message",
      timestamp: 1,
      content: "完成",
      isThinking: false,
      isComplete: true,
      durationMs: 12_370_000,
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
