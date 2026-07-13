import { describe, expect, it } from "vitest";
import type { Session, TimelineEvent } from "@/types/ui";
import {
  getPrimaryRoomAgent,
  updateRoomAgentEvents,
} from "../collaborationRooms";
import {
  bindProvisionedRoomAgent,
  prepareRoomAgentProvisioning,
} from "../roomAgentProvisioning";
import {
  createRoomMessageDispatch,
  getDispatchableRoomDeliveries,
  setRoomDeliveryStatus,
} from "../roomDelivery";
import { projectCollaborationTimeline } from "../collaborationTimeline";
import { resolveRoomPromptRoute } from "../roomRouting";

function ordinarySession(): Session {
  return {
    id: "acceptance-room",
    engine: "kimi-code",
    runtimeSessionId: "runtime-primary",
    officialSessionId: "official-primary",
    model: "kimi-code/k2.5",
    title: "跨模型交叉审查",
    projectPath: "D:/work/acceptance",
    createdAt: 1,
    updatedAt: 1,
    events: [],
    isLoading: false,
  };
}

describe("multi-Agent room acceptance matrix", () => {
  it("keeps four cross-provider Agents isolated when one fails and another is still running", () => {
    let room = ordinarySession();
    const drafts = [
      { id: "agent-reviewer", displayName: "Reviewer", mentionName: "reviewer", modelAlias: "openai/gpt-5", modelLabelSnapshot: "GPT-5", providerLabelSnapshot: "OpenAI" },
      { id: "agent-tester", displayName: "Tester", mentionName: "tester", modelAlias: "openai/gpt-5-mini", modelLabelSnapshot: "GPT-5 Mini", providerLabelSnapshot: "OpenAI" },
      { id: "agent-docs", displayName: "Documentation Specialist Long Name", mentionName: "docs", modelAlias: "anthropic/claude-sonnet-4", modelLabelSnapshot: "Claude Sonnet 4", providerLabelSnapshot: "Anthropic" },
    ] as const;
    for (const [index, draft] of drafts.entries()) {
      const prepared = prepareRoomAgentProvisioning(room, {
        ...draft,
        permissionMode: "manual",
      }, [], 10 + index, () => draft.id);
      room = bindProvisionedRoomAgent(prepared.session, draft.id, `runtime-${draft.id}`, draft.modelAlias, 20 + index);
    }

    expect(room.collaboration?.agents).toHaveLength(4);
    expect(room.collaboration?.agents.slice(1).map((agent) => [agent.providerLabelSnapshot, agent.modelAlias])).toEqual([
      ["OpenAI", "openai/gpt-5"],
      ["OpenAI", "openai/gpt-5-mini"],
      ["Anthropic", "anthropic/claude-sonnet-4"],
    ]);

    const routed = resolveRoomPromptRoute(room, "@reviewer @tester 请分别审查和测试", []);
    expect(routed.recipientAgentIds).toEqual(["agent-reviewer", "agent-tester"]);
    expect(routed.outboundContent).toBe("请分别审查和测试");

    const primaryId = getPrimaryRoomAgent(room).id;
    const recipientOrder = [primaryId, "agent-reviewer", "agent-tester", "agent-docs"];
    const created = createRoomMessageDispatch(room, {
      content: "并行完成实施、审查、测试和文档",
      outboundContent: "并行完成实施、审查、测试和文档",
      recipientAgentIds: recipientOrder,
      timestamp: 100,
      createId: (kind, roomAgentId) => `${kind}:${roomAgentId ?? "room"}`,
    });
    room = created.session;
    room = setRoomDeliveryStatus(room, created.message.id, primaryId, "sending", {}, 101);
    room = setRoomDeliveryStatus(room, created.message.id, primaryId, "accepted", {}, 102);
    room = setRoomDeliveryStatus(room, created.message.id, primaryId, "completed", {}, 103);
    room = setRoomDeliveryStatus(room, created.message.id, "agent-reviewer", "sending", {}, 101);
    room = setRoomDeliveryStatus(room, created.message.id, "agent-reviewer", "running", {}, 102);
    room = setRoomDeliveryStatus(room, created.message.id, "agent-tester", "failed", { error: "Provider unavailable" }, 102);

    const primaryAssistant: TimelineEvent = {
      id: "assistant-primary",
      type: "assistant_message",
      timestamp: 103,
      content: "实施完成",
      isThinking: false,
      isComplete: true,
      roomAgentId: primaryId,
      roomMessageId: created.message.id,
      agentTurnId: created.message.deliveries[primaryId].agentTurnId,
    };
    room = updateRoomAgentEvents(room, primaryId, () => [primaryAssistant]);

    expect(room.collaboration?.messages[0].deliveries).toMatchObject({
      [primaryId]: { status: "completed" },
      "agent-reviewer": { status: "running" },
      "agent-tester": { status: "failed", error: "Provider unavailable" },
      "agent-docs": { status: "queued" },
    });
    expect(getDispatchableRoomDeliveries(room)).toEqual([{
      roomMessageId: created.message.id,
      roomAgentId: "agent-docs",
    }]);

    const projected = projectCollaborationTimeline(room);
    expect(projected[0]).toMatchObject({ type: "user_message", recipientAgentIds: recipientOrder });
    expect(projected.slice(1).map((event) => event.roomAgentId)).toEqual(recipientOrder);
    expect(projected.find((event) => event.roomAgentId === "agent-tester")).toMatchObject({
      type: "error",
      message: "Provider unavailable",
    });
  });
});
