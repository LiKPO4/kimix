import type { PermissionMode, RoomAgent, Session } from "@/types/ui";
import { updateRoomMutationOwner } from "@/utils/roomMutationOwner";

export type SubagentRoutingSelection = {
  modelAlias: string | null;
  thinkingEffort: string | null;
};

export function resolveSubagentRoutingToApply(
  agent: Pick<RoomAgent, "subagentRoutingDesired" | "subagentModelAlias" | "subagentThinkingEffort">,
): SubagentRoutingSelection | null {
  if (agent.subagentRoutingDesired) return agent.subagentRoutingDesired;
  if (agent.subagentModelAlias || agent.subagentThinkingEffort) {
    return {
      modelAlias: agent.subagentModelAlias ?? null,
      thinkingEffort: agent.subagentThinkingEffort ?? null,
    };
  }
  return null;
}

export function queueSubagentRouting(
  session: Session,
  roomAgentId: string,
  selection: SubagentRoutingSelection,
  fallbackPermissionMode: PermissionMode,
): Session {
  return updateRoomMutationOwner(session, roomAgentId, (agent) => ({
    ...agent,
    subagentModelAlias: selection.modelAlias ?? undefined,
    subagentThinkingEffort: selection.thinkingEffort ?? undefined,
    subagentRoutingDesired: selection,
  }), fallbackPermissionMode);
}

export function recordAppliedSubagentRouting(
  session: Session,
  roomAgentId: string,
  applied: { subagentModel?: string; subagentThinkingEffort?: string },
  fallbackPermissionMode: PermissionMode,
): Session {
  return updateRoomMutationOwner(session, roomAgentId, (agent) => ({
    ...agent,
    subagentModelAlias: applied.subagentModel,
    subagentThinkingEffort: applied.subagentThinkingEffort,
    subagentRoutingDesired: undefined,
  }), fallbackPermissionMode);
}
