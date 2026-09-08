import type { TimelineEvent } from "@/types/ui";

// 19：思考虚高缓存曾被 body-only 等价认证冻结（实机实据见
// hasInflatedLocalKimiThinkingHistory 注释）；升版强制重跑 repair，
// canonical 更富的会话将被整体替换洗净。
// 20→21（v2.21.182）：被打断轮合成 TurnEnd 收口（跨轮正文合并修复）+ 耗时终点
// 改打上轮最后 loop 事件时间；旧缓存里 baked 的跨轮合并正文与含离开间隔的
// durationMs 需一次性重跑 repair 用 canonical 重解析洗净。
// 21→22（v2.21.187）：轮内后台任务/ cron 通知不再产出 TurnBegin（canonical 改发
// NotificationMessage，映射 boundary=false 不切轮）；旧缓存里按旧启发式 baked 的
// 通知切轮（一轮拆成两张「输出完成」卡）需一次性重跑 repair 用 canonical 重解析洗净。
// 22→23（v2.21.188）：187 的升版只让 repair 重跑，没让结果被采纳——旧缓存正文虚胖
// 触发 assistant-body-regression veto，干净 canonical 被挡在门外（实机 diag 实证）。
// 本版对版本陈旧且 canonical 来自本地 wire 的会话强制采纳（forceCanonical，跳过尺寸
// 类 veto、保留过程历史回退门），并在 mergeEvents 按通知身份全局去重，拦住 WS 快照
// 重放副本在正文下方叠出第二张通知卡。
export const KIMI_HISTORY_CACHE_VERSION = 23;

const LEGACY_CLARIFICATION_PREFIX = /^【Kimix 需求澄清(?:工具)?[:：]/;

const PROCESS_EVENT_TYPES = new Set<TimelineEvent["type"]>([
  "tool_call",
  "subagent",
  "approval_request",
  "question_request",
  "hook",
]);

function flattenTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  const result: TimelineEvent[] = [];
  for (const event of events) {
    result.push(event);
    if (event.type === "subagent") {
      result.push(...flattenTimelineEvents(event.events));
    }
  }
  return result;
}

export function kimiHistoryProcessEventCount(events: TimelineEvent[]) {
  return flattenTimelineEvents(events).reduce((count, event) => count + (PROCESS_EVENT_TYPES.has(event.type) ? 1 : 0), 0);
}

export function hasRicherKimiProcessHistory(cached: TimelineEvent[], canonical: TimelineEvent[]) {
  return canonical.length > 0 && kimiHistoryProcessEventCount(canonical) > kimiHistoryProcessEventCount(cached);
}

export function hasKimiProcessHistoryRegression(cached: TimelineEvent[], canonical: TimelineEvent[]) {
  return kimiHistoryProcessEventCount(canonical) < kimiHistoryProcessEventCount(cached);
}

// 仅顶层过程事件计数（不展开子代理嵌套帧）。force 升版采纳时使用：canonical 的
// 子代理子事件由子代理 wire 重新派生，而本地嵌套帧来自 live 重放材料化——旧版
// 每次重放给同一批官方调用生成全新 toolCallId（实据 session_d4035d92：51 个真实
// 调用在本地被放大成 316 个嵌套帧），按扁平计数会让幽灵帧否决干净的 canonical。
// 顶层帧不受该 bug 影响（本地顶层帧与官方 id 一一对应），保留顶层回退门仍可挡住
// 真正的部分快照。
export function kimiHistoryProcessEventCountTopLevel(events: TimelineEvent[]) {
  return events.reduce((count, event) => count + (PROCESS_EVENT_TYPES.has(event.type) ? 1 : 0), 0);
}

export function hasKimiProcessHistoryRegressionTopLevel(cached: TimelineEvent[], canonical: TimelineEvent[]) {
  return kimiHistoryProcessEventCountTopLevel(canonical) < kimiHistoryProcessEventCountTopLevel(cached);
}

function toolCallIdentities(events: TimelineEvent[]) {
  return flattenTimelineEvents(events)
    .filter((event): event is Extract<TimelineEvent, { type: "tool_call" }> => (
      event.type === "tool_call" && Boolean(event.toolCallId)
    ))
    .map((event) => event.toolCallId);
}

export function hasRepairableDuplicateKimiToolHistory(
  cached: TimelineEvent[],
  canonical: TimelineEvent[],
) {
  const cachedIds = toolCallIdentities(cached);
  const uniqueCachedIds = new Set(cachedIds);
  if (uniqueCachedIds.size === cachedIds.length || uniqueCachedIds.size === 0) return false;
  const canonicalIds = new Set(toolCallIdentities(canonical));
  return [...uniqueCachedIds].every((id) => canonicalIds.has(id));
}

function thinkingHistoryText(events: TimelineEvent[]) {
  return flattenTimelineEvents(events)
    .filter((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => event.type === "assistant_message")
    .map((event) => {
      const parts = event.thinkingParts?.map((part) => part.text).join("") ?? "";
      return parts || event.thinking || "";
    })
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
}

export function hasCanonicalKimiThinkingHistory(cached: TimelineEvent[], canonical: TimelineEvent[]) {
  const canonicalThinking = thinkingHistoryText(canonical);
  return canonicalThinking.trim().length > 0 && canonicalThinking !== thinkingHistoryText(cached);
}

export function hasLegacyKimiClarificationWrapper(events: TimelineEvent[]) {
  return events.some((event) => (
    event.type === "user_message" && LEGACY_CLARIFICATION_PREFIX.test(event.content)
  ));
}
