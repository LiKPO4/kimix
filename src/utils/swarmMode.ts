import type { Session } from "@/types/ui";

type SwarmSessionState = Pick<Session, "swarmMode" | "swarmModeLockedAt" | "swarmModeDesired">;

export function reportedSwarmMode(session?: SwarmSessionState | null) {
  return Boolean(session?.swarmMode || (session?.swarmModeLockedAt && session.swarmMode !== false));
}

export function displayedSwarmMode(session?: SwarmSessionState | null) {
  return session?.swarmModeDesired ?? reportedSwarmMode(session);
}

export function hasPendingSwarmMode(session?: SwarmSessionState | null) {
  return session?.swarmModeDesired !== undefined && session.swarmModeDesired !== reportedSwarmMode(session);
}

export function pendingSwarmModeValue(session: SwarmSessionState, enabled: boolean) {
  return enabled === reportedSwarmMode(session) ? undefined : enabled;
}
