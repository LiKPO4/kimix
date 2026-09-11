import type { Session, TimelineEvent } from "@/types/ui";
import { getPrimaryRoomAgent, getRoomAgentEvents, getRoomAgents } from "@/utils/collaborationRooms";
import {
  resolveModelContextLimit,
  type ModelContextLimitIndex,
} from "@/utils/sessionModelCatalog";

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

// 运行时通知信封映射成 status_update 的摘要前缀（与 eventHelpers 的摘要构造同源）。
// v2.20.182 前的遗留持久化行可能把通知文案混进度量行 message；度量行的展示/合并
// 路径按前缀剔除，避免轮末信息卡出现不该出现的内容。
const NOTIFICATION_SUMMARY_RE = /^(?:后台任务|子代理)(?:已完成|已丢失|已失败|已超时|已终止|通知)：|^定时任务触发：|^已调用 Skill：/;
export function isNotificationSummaryMessage(message: string | undefined | null): boolean {
  if (!message) return false;
  return NOTIFICATION_SUMMARY_RE.test(message);
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
  const message = event.message?.trim() ?? "";
  const hasNonZeroMetric =
    (event.inputTokenCount ?? 0) > 0 ||
    (event.tokenCount ?? 0) > 0 ||
    (event.contextSize ?? 0) > 0;
  if (message && event.step !== undefined && !hasNonZeroMetric && /^(?:步骤\s*\d+\s*)?(?:中断|重试|输出打断|正在重试)/.test(message)) return true;
  if (message && !(message.startsWith("模型：") && !hasNonZeroMetric)) return false;
  return (event.inputTokenCount ?? 0) === 0 &&
    (event.tokenCount ?? 0) === 0 &&
    (event.contextSize ?? 0) === 0;
}

export interface SessionContextUsage {
  agentId: string;
  agentName: string;
  modelLabel: string;
  isPrimary: boolean;
  hasContext: boolean;
  hasLimit: boolean;
  used: number;
  limit: number;
  percent: number;
}

export function shouldShowInlineStatusUpdate(event: Extract<TimelineEvent, { type: "status_update" }>) {
  const message = event.message?.trim() ?? "";
  if (message.startsWith("模型：")) return true;
  if (message && event.step !== undefined && /^(?:步骤\s*\d+\s*)?(?:中断|重试|输出打断|正在重试)/.test(message)) return false;
  return true;
}

export function shouldRenderStandaloneStatusUpdate(event: Extract<TimelineEvent, { type: "status_update" }>) {
  if (event.source === "ipc" && event.parentEventId) return false;
  return true;
}

export function hasMetricStatus(event: Extract<TimelineEvent, { type: "status_update" }>) {
  return event.inputTokenCount !== undefined ||
    event.tokenCount !== undefined ||
    event.contextSize !== undefined ||
    event.contextLimit !== undefined;
}

/** Prefer a positive finite metric over undefined/0 shells from interim status frames. */
export function preferPositiveMetric(
  incoming: number | undefined,
  previous: number | undefined,
): number | undefined {
  if (typeof incoming === "number" && Number.isFinite(incoming) && incoming > 0) return incoming;
  if (typeof previous === "number" && Number.isFinite(previous) && previous > 0) return previous;
  if (typeof incoming === "number" && Number.isFinite(incoming)) return incoming;
  if (typeof previous === "number" && Number.isFinite(previous)) return previous;
  return undefined;
}

export function mergeMetricStatusUpdates(
  statuses: Extract<TimelineEvent, { type: "status_update" }>[],
) {
  const hasTurnUsage = statuses.some((status) => (
    status.inputTokenCount !== undefined ||
    status.tokenCount !== undefined ||
    Boolean(status.message?.trim().startsWith("模型："))
  ));
  if (!hasTurnUsage) return undefined;
  const merged = statuses.filter(hasMetricStatus).reduce<Extract<TimelineEvent, { type: "status_update" }> | undefined>(
    (acc, incoming) => acc
      ? {
          ...acc,
          ...incoming,
          message: incoming.message?.trim() && !isNotificationSummaryMessage(incoming.message)
            ? incoming.message
            : isNotificationSummaryMessage(acc.message) ? undefined : acc.message,
          inputTokenCount: preferPositiveMetric(incoming.inputTokenCount, acc.inputTokenCount),
          tokenCount: preferPositiveMetric(incoming.tokenCount, acc.tokenCount),
          // Interim agent.status frames often carry contextSize:0 + a limit only;
          // a later usage.record must not permanently zero out a real context.
          contextSize: preferPositiveMetric(incoming.contextSize, acc.contextSize),
          contextLimit: preferPositiveMetric(incoming.contextLimit, acc.contextLimit),
        }
      // 首元素与后续元素走同一规则：通知文案（如「后台任务已完成：…」）
      // 不得原样进入合并结果泄漏到轮末信息卡（review C2）。
      : isNotificationSummaryMessage(incoming.message)
        ? { ...incoming, message: undefined }
        : incoming,
    undefined,
  );
  if (!merged) return undefined;
  // usage.record has tokens but no contextTokens. When the turn only ever saw
  // contextLimit shells (size 0), fall back to input tokens as "used" so the
  // footer can still show Context: used/limit.
  const contextSize = preferPositiveMetric(merged.contextSize, merged.inputTokenCount);
  return contextSize === merged.contextSize
    ? merged
    : { ...merged, contextSize };
}

/**
 * Server 链路 live 状态帧只携带 context（无 usage.currentTurn/token 计数）：
 * 轮末没有 token 级用量时，把本轮的 context 帧合成一张信息卡，避免 footer
 * 回落到只剩模型名（实机：pill 只剩「模型：k3」，切会话走 canonical 才补齐）。
 * 只认 host 主动状态读取发射的 status_refresh 帧：快照恢复/回放产生的无标
 * context 帧不得自成轮次信息卡（既有守卫：context-only recovery snapshot 不渲染
 * 为 footer；mergeMetricStatusUpdates 严格口径同样不变）。
 */
export function mergeContextOnlyStatusUpdates(
  statuses: Extract<TimelineEvent, { type: "status_update" }>[],
) {
  const withContext = statuses.filter((status) => (
    status.source === "status_refresh" && hasMetricStatus(status) &&
    typeof status.contextSize === "number" && status.contextSize > 0
  ));
  if (withContext.length === 0) return undefined;
  return withContext.slice(1).reduce<Extract<TimelineEvent, { type: "status_update" }>>((acc, incoming) => ({
    ...acc,
    ...incoming,
    message: incoming.message?.trim() ? incoming.message : acc.message,
    contextSize: preferPositiveMetric(incoming.contextSize, acc.contextSize),
    contextLimit: preferPositiveMetric(incoming.contextLimit, acc.contextLimit),
  }), withContext[0]!);
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


/** Statuses after the latest user message or compaction end — approximates "current window". */
export function statusesAfterLatestContextBoundary(
  events: TimelineEvent[],
): { statuses: Extract<TimelineEvent, { type: "status_update" }>[]; foundBoundary: boolean } {
  let boundaryIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "user_message") {
      boundaryIndex = index;
      break;
    }
    if (event.type === "compaction" && event.phase === "end" && event.outcome !== "cancelled") {
      boundaryIndex = index;
      break;
    }
  }
  return {
    statuses: events
      .slice(boundaryIndex + 1)
      .filter((event): event is Extract<TimelineEvent, { type: "status_update" }> => event.type === "status_update"),
    foundBoundary: boundaryIndex >= 0,
  };
}

export function getSessionContextUsages(
  session: Session | undefined,
  modelContextLimits: ModelContextLimitIndex = new Map(),
): SessionContextUsage[] {
  if (!session) return [];
  const primaryAgentId = getPrimaryRoomAgent(session).id;
  return getRoomAgents(session)
    .filter((agent) => !agent.removedAt)
    .map((agent) => {
      const agentEvents = getRoomAgentEvents(session, agent.id);
      // Prefer metrics after the latest user turn / compaction so a pre-compact
      // context window does not stick on the composer ring forever.
      const { statuses: statusEvents, foundBoundary } = statusesAfterLatestContextBoundary(agentEvents);
      // A boundary with no statuses after it yet (post-compaction / new-turn gap)
      // means the old window is gone — never fall back to pre-boundary metrics.
      const merged = mergeMetricStatusUpdates(statusEvents)
        ?? getLatestMetricStatus(statusEvents.length > 0 || foundBoundary ? statusEvents : agentEvents);
      const contextSize = preferPositiveMetric(merged?.contextSize, merged?.inputTokenCount);
      const hasContext = typeof contextSize === "number" && Number.isFinite(contextSize) && contextSize > 0;
      const modelFromStatus = merged?.message?.trim().match(/^模型[：:]\s*(.+)$/)?.[1]?.trim();
      const modelLabel = agent.modelLabelSnapshot || agent.modelAlias || modelFromStatus || session.model || "模型未知";
      const configuredLimit = resolveModelContextLimit(modelContextLimits, [
        agent.modelAlias,
        modelFromStatus,
        session.model,
        agent.modelLabelSnapshot,
      ]);
      const reportedLimit = preferPositiveMetric(merged?.contextLimit, undefined);
      const limit = configuredLimit
        ?? (typeof reportedLimit === "number" && Number.isFinite(reportedLimit) && reportedLimit > 0
          ? reportedLimit
          : 0);
      const used = hasContext
        ? Math.max(0, contextSize <= 1 ? contextSize * limit : contextSize)
        : 0;
      const hasLimit = limit > 0;
      const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
      return {
        agentId: agent.id,
        agentName: agent.displayName,
        modelLabel,
        isPrimary: agent.id === primaryAgentId,
        hasContext,
        hasLimit,
        used,
        limit,
        percent,
      };
    });
}

export function getSessionRecommendationMetrics(session: Session | null | undefined, turnLimit: number): SessionRecommendationMetrics {
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

export interface SessionOutputStats {
  /** 平均缓存命中率（0-100）：ΣinputCacheRead / Σ输入，仅统计 turn 级 usage.record。 */
  avgCacheHitRate?: number;
  /** 平均输出速度（tokens/s）：Σ输出 / Σ生成窗口，跨全部轮次。 */
  avgSpeed?: number;
  /** 本轮输出速度（tokens/s）：最近一条 user_message 之后的同口径均值。 */
  currentTurnSpeed?: number;
}

// 生成窗口过短会被 Date.now() 量化噪声主导（对齐官方 MIN_STREAM_MS_FOR_TPS=50）；
// 过长说明边界事件缺失（如历史从轮中间开始重放），窗口不可信，跳过该步。
const MIN_STEP_WINDOW_MS = 50;
const MAX_STEP_WINDOW_MS = 30 * 60 * 1000;

/**
 * 背景信息窗口的输出统计。口径：
 * - 只统计主 Agent 的 turn 级 usage 帧（usageScope==="turn" 且无 agentId），
 *   session 级（压缩快照）与 agent.status.updated 的累计帧不参与，避免重复计数。
 * - 每步生成窗口 ≈ 该 usage 帧时间 − 前一个主 Agent 边界（user_message /
 *   tool_result）时间；usage.record 在 LLM 响应完成时落盘、工具执行之前，
 *   因此该窗口近似本步纯生成耗时。子代理边界不计（其活动发生在主生成流内）。
 * - 无缓存分解字段的旧持久化数据不参与命中率（避免把“无数据”显示成 0%）。
 */
export function getSessionOutputStats(session: Session | null | undefined): SessionOutputStats {
  const events = session?.events ?? [];
  let cacheRead = 0;
  let cacheInput = 0;
  let totalOutput = 0;
  let totalWindowMs = 0;
  let turnOutput = 0;
  let turnWindowMs = 0;
  let lastBoundaryTs: number | undefined;
  for (const event of events) {
    if (event.type === "user_message" || event.type === "tool_result") {
      if (event.type === "user_message") {
        turnOutput = 0;
        turnWindowMs = 0;
        lastBoundaryTs = event.timestamp;
      } else if (!event.agentId) {
        lastBoundaryTs = event.timestamp;
      }
      continue;
    }
    if (event.type !== "status_update") continue;
    if (event.usageScope !== "turn" || event.agentId) continue;
    if (typeof event.inputCacheRead === "number") {
      cacheRead += event.inputCacheRead;
      cacheInput += event.inputTokenCount ?? event.inputCacheRead + (event.inputCacheCreation ?? 0);
    }
    const output = event.tokenCount ?? 0;
    if (output <= 0 || lastBoundaryTs === undefined) continue;
    const windowMs = event.timestamp - lastBoundaryTs;
    if (windowMs < MIN_STEP_WINDOW_MS || windowMs > MAX_STEP_WINDOW_MS) continue;
    totalOutput += output;
    totalWindowMs += windowMs;
    turnOutput += output;
    turnWindowMs += windowMs;
  }
  return {
    avgCacheHitRate: cacheInput > 0 ? (cacheRead / cacheInput) * 100 : undefined,
    avgSpeed: totalWindowMs > 0 ? totalOutput / (totalWindowMs / 1000) : undefined,
    currentTurnSpeed: turnWindowMs > 0 ? turnOutput / (turnWindowMs / 1000) : undefined,
  };
}

/**
 * 逐帧计算回合结束气泡可显示的输出速率（tokens/s）。
 * 口径与 getSessionOutputStats.currentTurnSpeed 相同：本轮累计输出 tokens ÷ 累计生成
 * 窗口（每个 turn 级主 Agent usage 帧相对前一边界 user_message/tool_result 的时间差，
 * 带 50ms~30min 守卫），并与气泡上的累计输出 tokens 保持同一语义。
 * 累计速率同时回填给同轮后续主 Agent 状态帧（轮末气泡展示的是最后的
 * agent.status.updated 汇总帧，本身没有 usageScope）。
 * 返回 eventId → tokens/s；没有任何可用速率的帧不出现（调用方隐藏速率项）。
 */
export function computeTurnUsageSpeeds(events: readonly TimelineEvent[]): Map<string, number> {
  const speeds = new Map<string, number>();
  let lastBoundaryTs: number | undefined;
  let turnOutput = 0;
  let turnWindowMs = 0;
  // 速率口径是「本轮累计输出 ÷ 累计生成窗口」（与 getSessionOutputStats.currentTurnSpeed
  // 一致），而不是单步速率：气泡上展示的输出 tokens 是本轮累计值，单步速率与它并排
  // 会被读成「累计输出 ÷ 速率」（实机 v2.21.199：输出 556 配单步 0.6 t/s）。
  // 同时 SDK 发射顺序是 usage.record（turn 级）→ agent.status.updated（带 currentTurn
  // 汇总但没有 usageScope），轮末气泡展示的恰是最后一帧；把累计速率回填给同轮后续
  // 主 Agent 状态帧，保证被展示的帧也能查到速率。
  for (const event of events) {
    if (event.type === "user_message" || (event.type === "tool_result" && !event.agentId)) {
      if (event.type === "user_message") {
        turnOutput = 0;
        turnWindowMs = 0;
      }
      lastBoundaryTs = event.timestamp;
      continue;
    }
    if (event.type !== "status_update" || event.agentId) continue;
    if (event.usageScope === "turn") {
      const output = event.tokenCount ?? 0;
      const windowMs = lastBoundaryTs === undefined ? 0 : event.timestamp - lastBoundaryTs;
      if (output > 0 && windowMs >= MIN_STEP_WINDOW_MS && windowMs <= MAX_STEP_WINDOW_MS) {
        turnOutput += output;
        turnWindowMs += windowMs;
      }
    }
    if (turnWindowMs > 0) speeds.set(event.id, turnOutput / (turnWindowMs / 1000));
  }
  return speeds;
}
