const MAX_ASSISTANT_TURN_DURATION_MS = 12 * 60 * 60 * 1000;

export function reliableAssistantDurationMs(durationMs: unknown): number | undefined {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) return undefined;
  if (durationMs < 0 || durationMs > MAX_ASSISTANT_TURN_DURATION_MS) return undefined;
  return durationMs;
}

export function reliableAssistantDurationBetween(start: number, end: number): number | undefined {
  return reliableAssistantDurationMs(end - start);
}
