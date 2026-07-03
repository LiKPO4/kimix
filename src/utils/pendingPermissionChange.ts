import type { PermissionMode } from "@/types/ui";

export type PendingPermissionChange = {
  sessionId: string;
  runtimeSessionId: string;
  mode: PermissionMode;
};

export function isPendingPermissionTurnEnded(
  pending: PendingPermissionChange | null,
  payload: { sessionId: string; event: unknown },
): pending is PendingPermissionChange {
  if (!pending || payload.sessionId !== pending.runtimeSessionId) return false;
  if (!payload.event || typeof payload.event !== "object" || Array.isArray(payload.event)) return false;
  const event = payload.event as Record<string, unknown>;
  return event.type === "turn.ended" && event.snapshotReplay === undefined;
}
