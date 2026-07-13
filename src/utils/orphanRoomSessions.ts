import type { Session } from "@/types/ui";
import type { KimiCodeSessionSummary } from "@electron/types/ipc";
import { resolveRoomRuntimeOwner } from "./collaborationRooms";
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
