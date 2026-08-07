import type { OfficialGoalSnapshot, TimelineEvent } from "@/types/ui";

function normalizeStatus(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isTerminalGoalStatus(status: unknown) {
  return ["complete", "completed", "cancelled", "canceled"].includes(normalizeStatus(status));
}

export function reconcileOfficialGoalSnapshot(
  incoming: OfficialGoalSnapshot | null,
  current: OfficialGoalSnapshot | null | undefined,
) {
  if (!current || !isTerminalGoalStatus(current.status)) return incoming;
  if (!incoming) return current;
  if (isTerminalGoalStatus(incoming.status)) return incoming;
  if (incoming.objective.trim() !== current.objective.trim()) return incoming;
  return current;
}

/** 已有 goal 的会话：事件后刷新调度延迟。 */
export const OFFICIAL_GOAL_REFRESH_DELAY_MS = 1200;
/** 外部（CLI/web）创建的 goal 本地无事件面，首次发现轮询限流间隔。 */
export const OFFICIAL_GOAL_FIRST_DISCOVERY_INTERVAL_MS = 60_000;

/**
 * 把 goal.updated 事件的 snapshot 归一为可写入 store 的结构；
 * 非对象或缺少 objective 时返回 null（视为无 goal）。
 */
export function toOfficialGoalSnapshot(raw: unknown): OfficialGoalSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const objective = typeof source.objective === "string" ? source.objective.trim() : "";
  if (!objective) return null;
  const pickString = (key: string) => {
    const value = source[key];
    return typeof value === "string" && value.trim() ? value : undefined;
  };
  const pickNumber = (key: string) => {
    const value = source[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  return {
    goalId: pickString("goalId"),
    objective,
    completionCriterion: pickString("completionCriterion"),
    status: typeof source.status === "string" ? source.status.trim().toLowerCase() : "",
    turnsUsed: pickNumber("turnsUsed"),
    tokensUsed: pickNumber("tokensUsed"),
    wallClockMs: pickNumber("wallClockMs"),
    terminalReason: pickString("terminalReason"),
  };
}

/**
 * goal.updated 事件语义：snapshot 为 null 或不可归一 → 清除（返回 null 隐藏 pill）；
 * 否则按 reconcile 语义写入（本地已终态的同目标记录不被旧状态事件覆盖回去，
 * 终态 snapshot 保留最后状态供 UI 展示，pill 由非终态条件隐藏）。
 */
export function applyOfficialGoalUpdatedSnapshot(
  rawSnapshot: unknown,
  current: OfficialGoalSnapshot | null | undefined,
): OfficialGoalSnapshot | null {
  if (rawSnapshot == null) return null;
  const incoming = toOfficialGoalSnapshot(rawSnapshot);
  if (!incoming) return null;
  return reconcileOfficialGoalSnapshot(incoming, current);
}

/** 计算官方 goal 刷新调度延迟：已有 goal 保持 1200ms 事件后刷新，未知/空 goal 限流 60s 防空轮询风暴。 */
export function getOfficialGoalRefreshDelay(
  hasGoal: boolean,
  lastRefreshAt: number | undefined,
  now: number,
) {
  const targetDelay = hasGoal
    ? OFFICIAL_GOAL_REFRESH_DELAY_MS
    : OFFICIAL_GOAL_FIRST_DISCOVERY_INTERVAL_MS;
  return Math.max(0, targetDelay - (now - (lastRefreshAt ?? 0)));
}

/** 版本竞态：REST 拉取期间收到更新的 goal.updated 事件（版本号变化）时丢弃旧结果。 */
export function isStaleGoalFetch(versionAtFetch: number, currentVersion: number | undefined) {
  return currentVersion !== undefined && currentVersion !== versionAtFetch;
}

export function inferTerminalGoalFromEvent(
  event: TimelineEvent,
  current: OfficialGoalSnapshot | null | undefined,
): OfficialGoalSnapshot | null {
  if (event.type !== "tool_call" && event.type !== "tool_result") return null;
  if (!/updategoal/i.test(event.toolName)) return null;
  if (event.type === "tool_call" && event.status !== "success") return null;
  const evidence = [
    event.type === "tool_call" ? event.rawArguments : "",
    event.type === "tool_call" ? JSON.stringify(event.arguments) : "",
    String(event.result ?? ""),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  if (!/"status"\s*:\s*"complete"|goal marked complete|marked complete/.test(evidence)) return null;
  if (!current) return null;
  return {
    ...current,
    status: "complete",
    terminalReason: typeof event.result === "string" && event.result.trim() ? event.result.trim() : current.terminalReason,
  };
}
