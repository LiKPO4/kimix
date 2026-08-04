import type { Session, TimelineEvent } from "@/types/ui";
import { getRuntimeSessionId } from "./runtimeSession";
import { STALE_TIMELINE_WORK_MS } from "./sessionActivity";

function hasOpenRuntimeWork(session: Session | undefined): boolean {
  return Boolean(session?.events.some((event) => {
    if (event.type === "assistant_message") return !event.isComplete;
    if (event.type === "tool_call") return event.status === "running";
    if (event.type === "subagent") return event.status === "queued" || event.status === "running" || event.status === "suspended";
    return false;
  }));
}

export function shouldAppendRuntimeStatusToTimeline(input: {
  rawType?: string;
  mappedEvent: TimelineEvent;
  session?: Session;
  runtimeSessionId: string;
  runningSessionId: string | null;
  runtimeActive?: boolean;
}): boolean {
  if (input.mappedEvent.type !== "status_update") return true;
  if (input.rawType !== "agent.status.updated") return true;
  if (!input.session) return true;
  const sessionRuntimeId = getRuntimeSessionId(input.session);
  const isActiveRuntime = input.runtimeActive ?? Boolean(input.runningSessionId && (
      input.runningSessionId === input.session.id ||
      input.runningSessionId === input.runtimeSessionId ||
      Boolean(sessionRuntimeId && input.runningSessionId === sessionRuntimeId)
    ));
  const runtimeWorkLive = isActiveRuntime || hasOpenRuntimeWork(input.session);
  // 快照类 agent.status.updated（refreshServerSessionStatus emitEvent=true 发射：
  // resume/Sidebar 选中、权限变更、compaction 回读）携带 contextTokens，闲置或
  // 切换会话时放行会反复污染时间线并重写 footer，维持原闸门语义。
  if (input.mappedEvent.source === "status_refresh") return runtimeWorkLive;
  if (runtimeWorkLive) return true;
  // 实时帧（server WS / SDK onEvent）轮末迟到兜底：settle 后到达的最终
  // agent.status.updated 携带本轮指标，但仅当会话最近事件仍在新鲜窗口内才放行，
  // 避免历史/闲置会话被迟到旧帧改写 footer。
  const status = input.mappedEvent;
  const hasMetricData =
    status.tokenCount !== undefined ||
    status.inputTokenCount !== undefined ||
    status.contextSize !== undefined ||
    status.contextLimit !== undefined;
  if (!hasMetricData) return false;
  let latestEventAt = 0;
  for (const event of input.session.events) {
    if (Number.isFinite(event.timestamp) && event.timestamp > latestEventAt) latestEventAt = event.timestamp;
  }
  return Date.now() - latestEventAt <= STALE_TIMELINE_WORK_MS;
}
