const MAX_ASSISTANT_TURN_DURATION_MS = 12 * 60 * 60 * 1000;
const MIN_ASSISTANT_TURN_DURATION_MS = 2 * 1000;

export function reliableAssistantDurationMs(durationMs: unknown): number | undefined {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) return undefined;
  if (durationMs < MIN_ASSISTANT_TURN_DURATION_MS || durationMs > MAX_ASSISTANT_TURN_DURATION_MS) return undefined;
  return durationMs;
}

export function reliableAssistantDurationBetween(start: number, end: number): number | undefined {
  return reliableAssistantDurationMs(end - start);
}

export function formatAssistantTurnDuration(ms: number): string {
  const seconds = ms > 0 ? Math.max(1, Math.round(ms / 1000)) : 0;
  if (seconds < 60) return `${seconds}秒`;
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}
