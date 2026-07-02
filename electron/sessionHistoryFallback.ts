export type SessionHistoryResult = {
  events: Array<{ type: string; payload: unknown; time?: unknown }>;
  source: "server" | "local";
};

export async function loadSessionHistoryWithFallback(
  loadServer: () => Promise<SessionHistoryResult>,
  loadLocal: () => Promise<SessionHistoryResult["events"]>,
  timeoutMs = 8_000,
): Promise<SessionHistoryResult> {
  let serverHistory: SessionHistoryResult | null = null;
  try {
    serverHistory = await Promise.race([
      loadServer(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Kimi Server history snapshot timed out")), timeoutMs);
      }),
    ]);
    if (serverHistory.events.length > 0) return serverHistory;
  } catch {
    // Fall through to the SDK/local wire mirror.
  }

  const localEvents = await loadLocal();
  if (localEvents.length > 0) return { events: localEvents, source: "local" };
  return serverHistory ?? { events: [], source: "local" };
}
