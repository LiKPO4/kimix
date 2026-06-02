import type { TimelineEvent } from "@/types/ui";

export function isLegacyKimiWorkDirError(message: string) {
  return /unknown option\s+['"]?--work-dir['"]?/i.test(message);
}

export function sanitizePersistedEvents(events: TimelineEvent[]): TimelineEvent[] {
  return events.filter((event) => (
    event.type !== "error" || !isLegacyKimiWorkDirError(event.message)
  ));
}

export function latestAssistantContent(events: TimelineEvent[]) {
  return [...events].reverse().find((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => (
    event.type === "assistant_message" && event.content.trim().length > 0
  ))?.content.trim() ?? "";
}

export function latestAssistantVisibleOrThinkingContent(events: TimelineEvent[]) {
  const content = latestAssistantContent(events);
  if (content) return content;
  const assistant = [...settleInactiveEvents(events)].reverse().find((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => (
    event.type === "assistant_message" &&
    (Boolean(event.thinking?.trim()) || Boolean(event.thinkingParts?.some((part) => part.text.trim().length > 0)))
  ));
  if (!assistant) return "";
  const parts = assistant.thinkingParts?.map((part) => part.text).join("").trim();
  return parts || assistant.thinking?.trim() || "";
}

export function settleInactiveEvents(events: TimelineEvent[]): TimelineEvent[] {
  const settledAt = Date.now();
  const settled = events.flatMap((event) => {
    if (event.type === "subagent") {
      return event.status === "running" ? [{ ...event, status: "completed" as const }] : [event];
    }
    if (event.type !== "assistant_message" || event.isComplete) return [event];
    const hasContent = event.content.trim().length > 0;
    const hasThinking = Boolean(
      event.thinking?.trim() ||
      event.thinkingParts?.some((part) => part.text.trim().length > 0)
    );
    if (!hasContent && !hasThinking) return [];
    return [{ ...event, isComplete: true, isThinking: false, durationMs: event.durationMs ?? Math.max(0, settledAt - event.timestamp) }];
  });
  return closeOpenCompaction(settled);
}

export function closeOpenCompaction(events: TimelineEvent[]): TimelineEvent[] {
  const lastCompaction = [...events].reverse().find((event) => event.type === "compaction");
  if (!lastCompaction || lastCompaction.type !== "compaction" || lastCompaction.phase !== "begin") {
    return events;
  }
  return [
    ...events,
    {
      id: Math.random().toString(36).substring(2, 11),
      type: "compaction",
      timestamp: Date.now(),
      phase: "end",
    },
  ];
}
