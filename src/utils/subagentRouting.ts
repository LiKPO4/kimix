import type { PermissionMode, Session } from "@/types/ui";
import { updateRoomMutationOwner } from "@/utils/roomMutationOwner";

export type SubagentRoutingSelection = {
  modelAlias: string | null;
  thinkingEffort: string | null;
};

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
