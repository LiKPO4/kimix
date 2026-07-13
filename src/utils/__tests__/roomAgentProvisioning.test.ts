import { beforeEach, describe, expect, it } from "vitest";
import type { Session } from "@/types/ui";
import {
  bindProvisionedRoomAgent,
  failRoomAgentProvisioning,
  getRoomPrimaryMetadataIdentity,
  isMultiAgentRoomUiEnabled,
  MULTI_AGENT_ROOM_UI_GATE_KEY,
  prepareRoomAgentProvisioning,
} from "../roomAgentProvisioning";

function session(): Session {
  return {
    id: "room-1",
    engine: "kimi-code",
    runtimeSessionId: "runtime-primary",
    officialSessionId: "official-primary",
    model: "kimi-code/k2.5",
    title: "Room",
    projectPath: "D:/work/demo",
    createdAt: 1,
    updatedAt: 2,
    events: [],
    isLoading: false,
  };
}

describe("roomAgentProvisioning", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the UI gate closed unless explicitly enabled", () => {
    expect(isMultiAgentRoomUiEnabled()).toBe(false);
    localStorage.setItem(MULTI_AGENT_ROOM_UI_GATE_KEY, "1");
    expect(isMultiAgentRoomUiEnabled()).toBe(true);
  });

  it("upgrades an ordinary session and persists a stable pending Agent before official creation", () => {
    const prepared = prepareRoomAgentProvisioning(session(), {
      displayName: "Reviewer",
      mentionName: "reviewer",
      modelAlias: "openai/gpt-5",
      modelLabelSnapshot: "GPT-5",
      providerLabelSnapshot: "OpenAI",
      permissionMode: "manual",
    }, [], 100, () => "agent-reviewer");

    expect(prepared.agent).toMatchObject({
      id: "agent-reviewer",
      displayName: "Reviewer",
      mentionName: "reviewer",
      modelAlias: "openai/gpt-5",
    });
    expect(prepared.session.collaboration?.agents).toHaveLength(2);
    expect(prepared.session.collaboration?.focusedAgentId).toBe("agent-reviewer");
    expect(prepared.session.collaboration?.agentEvents["agent-reviewer"]).toEqual([]);
    expect(getRoomPrimaryMetadataIdentity(prepared.session)).toBe("official-primary");
  });

  it("rejects duplicate names, duplicate mentions, active work, and the fifth Agent", () => {
    const first = prepareRoomAgentProvisioning(session(), {
      displayName: "Reviewer",
      mentionName: "reviewer",
      modelAlias: "openai/gpt-5",
      permissionMode: "manual",
    }, [], 100, () => "agent-2").session;
    expect(() => prepareRoomAgentProvisioning(first, {
      displayName: "reviewer",
      mentionName: "other",
      modelAlias: "openai/gpt-5",
      permissionMode: "manual",
    })).toThrow("Agent 名称已存在");
    expect(() => prepareRoomAgentProvisioning(first, {
      displayName: "Other",
      mentionName: "REVIEWER",
      modelAlias: "openai/gpt-5",
      permissionMode: "manual",
    })).toThrow("@名称已存在");
    expect(() => prepareRoomAgentProvisioning(first, {
      displayName: "Other",
      mentionName: "other",
      modelAlias: "openai/gpt-5",
      permissionMode: "manual",
    }, [{ roomId: first.id, roomAgentId: "agent-2", status: "running", updatedAt: 101 }])).toThrow("房间仍有 Agent 在运行");

    let full = first;
    for (const [index, name] of ["Third", "Fourth"].entries()) {
      full = prepareRoomAgentProvisioning(full, {
        displayName: name,
        mentionName: name.toLowerCase(),
        modelAlias: "openai/gpt-5",
        permissionMode: "manual",
      }, [], 110 + index, () => `agent-${index + 3}`).session;
    }
    expect(() => prepareRoomAgentProvisioning(full, {
      displayName: "Fifth",
      mentionName: "fifth",
      modelAlias: "openai/gpt-5",
      permissionMode: "manual",
    })).toThrow("最多 4 个 Agent");
  });

  it("records provisioning failure and binds the recovered official session without replacing history", () => {
    const prepared = prepareRoomAgentProvisioning(session(), {
      displayName: "Reviewer",
      mentionName: "reviewer",
      modelAlias: "openai/gpt-5",
      permissionMode: "manual",
    }, [], 100, () => "agent-2");
    const failed = failRoomAgentProvisioning(prepared.session, prepared.agent.id, "network unavailable", 110);
    const bound = bindProvisionedRoomAgent(failed, prepared.agent.id, "official-agent-2", "openai/gpt-5", 120);
    const agent = bound.collaboration?.agents.find((candidate) => candidate.id === prepared.agent.id);

    expect(agent).toMatchObject({
      runtimeSessionId: "official-agent-2",
      officialSessionId: "official-agent-2",
      modelAlias: "openai/gpt-5",
    });
    expect(agent?.provisioningError).toBeUndefined();
    expect(bound.collaboration?.agentEvents[prepared.agent.id]).toEqual([]);
  });
});
