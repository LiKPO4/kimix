import type { TimelineEvent } from "@/types/ui";

export const KIMI_HISTORY_CACHE_VERSION = 4;

const LEGACY_CLARIFICATION_PREFIX = /^【Kimix 需求澄清(?:工具)?[:：]/;

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

function thinkingHistoryText(events: TimelineEvent[]) {
  return events
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
