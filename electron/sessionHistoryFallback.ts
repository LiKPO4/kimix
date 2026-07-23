export type SessionHistoryResult = {
  events: Array<{ type: string; payload: unknown; time?: unknown }>;
  source: "server" | "local";
  /** 官方快照为分页窗口（messages.has_more），只含最近若干条，不是完整历史。 */
  truncated?: boolean;
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
    // 0.29 Server 快照只回最近 100 条（has_more）：窗口不能当完整权威历史，
    // 否则短 canonical 会被 no-shrink 门禁拒绝（丢新轮次）或被接受（丢窗口前老历史）。
    if (serverHistory.events.length > 0 && !serverHistory.truncated) return serverHistory;
  } catch {
    // Fall through to the SDK/local wire mirror.
  }

  const localEvents = await loadLocal();
  if (localEvents.length > 0) return { events: localEvents, source: "local" };
  // 本地镜像也为空时，截断的 server 窗口仍优于空历史。
  return serverHistory ?? { events: [], source: "local" };
}

/**
 * Merge wire-mirror usage status events (turn-scoped `usage.record` → StatusUpdate)
 * into an authoritative Server history. Snapshot messages carry no usage/model
 * fields (0.29 实测全 null), so turn footers hydrate from the wire mirror.
 * Insertion is timestamp-ordered and skips statuses already present.
 */
export function mergeHistoryStatusEventsByTime(
  events: SessionHistoryResult["events"],
  statusEvents: SessionHistoryResult["events"],
): SessionHistoryResult["events"] {
  if (statusEvents.length === 0) return events;
  const toMs = (time: unknown): number => {
    if (typeof time === "number" && Number.isFinite(time)) return time;
    if (typeof time === "string") {
      const ms = Date.parse(time);
      if (Number.isFinite(ms)) return ms;
    }
    return Number.POSITIVE_INFINITY;
  };
  const identityOf = (event: SessionHistoryResult["events"][number]): string => {
    const payload = event.payload && typeof event.payload === "object"
      ? event.payload as Record<string, unknown>
      : {};
    return `${event.type}:${JSON.stringify(payload.token_usage ?? null)}:${typeof payload.model === "string" ? payload.model : ""}`;
  };
  const known = new Set(events.map(identityOf));
  const merged = [...events];
  for (const status of statusEvents) {
    const identity = identityOf(status);
    if (known.has(identity)) continue;
    known.add(identity);
    const ms = toMs(status.time);
    let index = merged.length;
    while (index > 0 && toMs(merged[index - 1].time) > ms) index -= 1;
    merged.splice(index, 0, status);
  }
  return merged;
}
