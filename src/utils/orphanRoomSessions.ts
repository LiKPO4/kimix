import type { Session } from "@/types/ui";
import type { KimiCodeSessionSummary } from "@electron/types/ipc";
import {
  createCollaborationStateFromSession,
  MAX_ROOM_AGENTS,
  resolveRoomRuntimeOwner,
  synchronizeCollaborationPrimaryMirror,
} from "./collaborationRooms";
import { isSamePath } from "./pathCase";
import { KIMIX_ROOM_METADATA_SOURCE, parseOfficialRoomMetadata } from "./roomSessionMetadata";

export type OrphanRoomSessionInfo = {
  reason: "unbound" | "invalid_metadata";
  roomId?: string;
  roomAgentId?: string;
};

export function getOrphanRoomSessionInfo(
  session: Pick<KimiCodeSessionSummary, "id" | "metadata">,
  localSessions: Session[],
): OrphanRoomSessionInfo | null {
  if (session.metadata?.source !== KIMIX_ROOM_METADATA_SOURCE) return null;
  const owner = resolveRoomRuntimeOwner(localSessions, session.id);
  if (owner?.session.collaboration) return null;
  const metadata = parseOfficialRoomMetadata(session.metadata);
  if (!metadata) return { reason: "invalid_metadata" };
  return {
    reason: "unbound",
    roomId: metadata.roomId,
    roomAgentId: metadata.roomAgentId,
  };
}

export type OrphanRoomRecoveryResult = {
  sessions: Session[];
  recoveredRoomIds: string[];
};

/**
 * Rebuild the local room skeleton only when official metadata gives one
 * unambiguous primary and one unique session for every secondary Agent.
 * Agent histories remain authoritative in their official sessions and are
 * loaded by the existing startup recovery path after this grouping is restored.
 */
export function recoverOrphanRoomsFromOfficialCatalog(
  sessions: Session[],
  officialSessions: KimiCodeSessionSummary[],
  projectPath: string,
  now = Date.now(),
): OrphanRoomRecoveryResult {
  const groups = new Map<string, Array<{
    official: KimiCodeSessionSummary;
    metadata: NonNullable<ReturnType<typeof parseOfficialRoomMetadata>>;
  }>>();
  for (const official of officialSessions) {
    if (official.archived || !isSamePath(official.workDir || projectPath, projectPath)) continue;
    const metadata = parseOfficialRoomMetadata(official.metadata);
    if (!metadata) continue;
    const entries = groups.get(metadata.roomId) ?? [];
    entries.push({ official, metadata });
    groups.set(metadata.roomId, entries);
  }

  let next = sessions;
  const recoveredRoomIds: string[] = [];
  for (const [roomId, entries] of groups) {
    const primaryIds = new Set(entries.map((entry) => entry.metadata.primarySessionId));
    const agentIds = new Set(entries.map((entry) => entry.metadata.roomAgentId));
    if (
      entries.length === 0 ||
      entries.length > MAX_ROOM_AGENTS - 1 ||
      primaryIds.size !== 1 ||
      agentIds.size !== entries.length
    ) continue;

    const primarySessionId = entries[0].metadata.primarySessionId;
    const primaryIndex = next.findIndex((session) => (
      !session.archivedAt &&
      !session.collaboration &&
      !session.unsupportedCollaboration &&
      isSamePath(session.projectPath, projectPath) &&
      session.id === roomId &&
      (
        session.id === primarySessionId ||
        session.runtimeSessionId === primarySessionId ||
        session.officialSessionId === primarySessionId
      )
    ));
    if (primaryIndex < 0) continue;

    const primarySession = next[primaryIndex];
    const collaboration = createCollaborationStateFromSession(primarySession, primarySession.permissionMode ?? "manual");
    const primaryAgent = collaboration.agents[0];
    const orderedEntries = [...entries].sort((left, right) => (
      left.official.createdAt - right.official.createdAt || left.official.id.localeCompare(right.official.id)
    ));
    const recoveredAgents = orderedEntries.map(({ official, metadata }, index) => ({
      id: metadata.roomAgentId,
      displayName: `Agent ${index + 2}`,
      mentionName: `agent-${index + 2}`,
      modelAlias: null,
      permissionMode: primarySession.permissionMode ?? "manual" as const,
      runtimeSessionId: official.id,
      officialSessionId: official.id,
      officialCatalogConfirmedAt: now,
      contextBridgeId: `room-context:${metadata.roomAgentId}`,
      createdAt: official.createdAt || now,
    }));
    const restored = synchronizeCollaborationPrimaryMirror({
      ...primarySession,
      updatedAt: Math.max(primarySession.updatedAt, ...orderedEntries.map((entry) => entry.official.updatedAt || 0)),
      collaboration: {
        ...collaboration,
        primaryAgentId: primaryAgent.id,
        defaultRecipientIds: [primaryAgent.id],
        focusedAgentId: primaryAgent.id,
        agents: [primaryAgent, ...recoveredAgents],
        agentEvents: {
          ...collaboration.agentEvents,
          ...Object.fromEntries(recoveredAgents.map((agent) => [agent.id, []])),
        },
      },
    });
    if (next === sessions) next = [...sessions];
    next[primaryIndex] = restored;
    recoveredRoomIds.push(restored.id);
  }

  return { sessions: next, recoveredRoomIds };
}
