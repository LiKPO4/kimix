import type { Session, TimelineEvent } from "@/types/ui";

export interface SessionRecommendationMetrics {
  turnCount: number;
  turnLimit: number;
  remainingTurns: number;
  turnPercent: number;
  latestInputTokens?: number;
  latestTokenCount?: number;
  latestContextSize?: number;
  latestContextLimit?: number;
}

export function countUserTurns(events: TimelineEvent[]): number {
  return events.filter((event) => event.type === "user_message").length;
}

export function getLatestStatus(events: TimelineEvent[]) {
  return events
    .filter((event): event is Extract<TimelineEvent, { type: "status_update" }> => event.type === "status_update")
    .at(-1);
}

export function isEmptyStatusUpdate(event: Extract<TimelineEvent, { type: "status_update" }>) {
  if (event.message?.trim()) return false;
  return (event.inputTokenCount ?? 0) === 0 &&
    (event.tokenCount ?? 0) === 0 &&
    (event.contextSize ?? 0) === 0;
}

export function hasMetricStatus(event: Extract<TimelineEvent, { type: "status_update" }>) {
  return event.inputTokenCount !== undefined ||
    event.tokenCount !== undefined ||
    event.contextSize !== undefined ||
    event.contextLimit !== undefined;
}

export function getLatestMeaningfulStatus(events: TimelineEvent[]) {
  const statuses = events.filter((event): event is Extract<TimelineEvent, { type: "status_update" }> => event.type === "status_update");
  for (let index = statuses.length - 1; index >= 0; index -= 1) {
    if (!isEmptyStatusUpdate(statuses[index])) return statuses[index];
  }
  return undefined;
}

export function getLatestMetricStatus(events: TimelineEvent[]) {
  const statuses = events.filter((event): event is Extract<TimelineEvent, { type: "status_update" }> => event.type === "status_update");
  for (let index = statuses.length - 1; index >= 0; index -= 1) {
    if (hasMetricStatus(statuses[index]) && !isEmptyStatusUpdate(statuses[index])) return statuses[index];
  }
  return undefined;
}

export function getSessionRecommendationMetrics(session: Session | undefined, turnLimit: number): SessionRecommendationMetrics {
  const safeLimit = Math.max(1, Math.round(turnLimit || 1));
  const events = session?.events ?? [];
  const turnCount = countUserTurns(events);
  const latestStatus = getLatestMetricStatus(events);
  return {
    turnCount,
    turnLimit: safeLimit,
    remainingTurns: Math.max(0, safeLimit - turnCount),
    turnPercent: Math.min(100, (turnCount / safeLimit) * 100),
    latestInputTokens: latestStatus?.inputTokenCount,
    latestTokenCount: latestStatus?.tokenCount,
    latestContextSize: latestStatus?.contextSize,
    latestContextLimit: latestStatus?.contextLimit,
  };
}

export function shouldRecommendNewSession(session: Session, enabled: boolean, turnLimit: number): boolean {
  if (!enabled) return false;
  return countUserTurns(session.events) >= Math.max(1, Math.round(turnLimit || 1));
}
