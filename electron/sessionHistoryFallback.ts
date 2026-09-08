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
  sessionLabel?: string,
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
  } catch (error) {
    // 回退前留痕，否则用户看到陈旧历史无从排查；只打会话标识与错误，不打消息正文
    console.warn(`[kimi-code] Server history snapshot unavailable for ${sessionLabel ?? "unknown session"}; falling back to local wire mirror:`, error);
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

/**
 * 抽取信封消息（notification / cron-fire）的稳定 id，用于跨来源匹配同一通知。
 * user_input 可能是字符串或 content part 数组（wire append_message 为数组）。
 */
function notificationEnvelopeId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const input = (payload as Record<string, unknown>).user_input;
  const text = typeof input === "string"
    ? input
    : Array.isArray(input)
      ? input.map((part) => (part && typeof part === "object" ? String((part as Record<string, unknown>).text ?? "") : "")).join("")
      : "";
  return (
    text.match(/<notification\b[^>]*\bid="([^"]+)"/i)?.[1] ??
    text.match(/<cron-fire\b[^>]*\bjobId="([^"]+)"/i)?.[1]
  );
}

/**
 * Server 快照是扁平消息流，无法区分「同轮内注入的通知」（wire append_message）
 * 与「自开一轮的通知」（wire turn.prompt）；本地 wire 镜像是唯一结构权威。
 * 用镜像里 append_message 通知的信封 id 给 server 历史里的对应 TurnBegin 盖章
 * notificationTurnBoundary=false，渲染层据此把通知折回所属轮而不是切出新卡。
 */
export function stampMidTurnNotificationBoundaries(
  events: SessionHistoryResult["events"],
  localEvents: SessionHistoryResult["events"],
): SessionHistoryResult["events"] {
  const midTurnIds = new Set<string>();
  for (const event of localEvents) {
    if (event.type !== "NotificationMessage") continue;
    const id = notificationEnvelopeId(event.payload);
    if (id) midTurnIds.add(id);
  }
  if (midTurnIds.size === 0) return events;
  return events.map((event) => {
    if (event.type !== "TurnBegin") return event;
    const id = notificationEnvelopeId(event.payload);
    if (!id || !midTurnIds.has(id)) return event;
    const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? event.payload as Record<string, unknown>
      : {};
    return { ...event, payload: { ...payload, notificationTurnBoundary: false } };
  });
}
