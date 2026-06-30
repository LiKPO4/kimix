import type { TimelineEvent } from "@/types/ui";

export const KIMI_HISTORY_CACHE_VERSION = 1;

const PROCESS_EVENT_TYPES = new Set<TimelineEvent["type"]>([
  "tool_call",
  "subagent",
  "approval_request",
  "question_request",
  "hook",
]);

export function kimiHistoryProcessEventCount(events: TimelineEvent[]) {
  return events.reduce((count, event) => count + (PROCESS_EVENT_TYPES.has(event.type) ? 1 : 0), 0);
}

export function hasRicherKimiProcessHistory(cached: TimelineEvent[], canonical: TimelineEvent[]) {
  return canonical.length > 0 && kimiHistoryProcessEventCount(canonical) > kimiHistoryProcessEventCount(cached);
}
