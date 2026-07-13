import type { TimelineEvent } from "@/types/ui";

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function snapshotText(rawEvent: Record<string, unknown>): string {
  return isString(rawEvent.snapshotMessageText) ? normalizeText(rawEvent.snapshotMessageText) : "";
}

function hasPendingLocalPromptPlaceholder(events: readonly TimelineEvent[]): boolean {
  const assistantIndex = events.findLastIndex((event) => event.type === "assistant_message" && !event.isComplete);
  if (assistantIndex === -1) return false;
  const assistant = events[assistantIndex];
  if (assistant.type !== "assistant_message" || assistant.content.trim() || assistant.thinking?.trim()) return false;
  const linkedStatus = events.slice(0, assistantIndex).findLast((event) => (
    event.type === "status_update" && event.source === "ipc" && Boolean(event.parentEventId)
  ));
  if (linkedStatus?.type !== "status_update" || !linkedStatus.parentEventId) return false;
  return events.slice(0, assistantIndex).some((event) => (
    event.type === "user_message" && event.id === linkedStatus.parentEventId
  ));
}

export function shouldSkipKimiCodeSnapshotReplay(
  rawEvent: Record<string, unknown> | null,
  events: readonly TimelineEvent[] = [],
): boolean {
  if (rawEvent?.snapshotReplay !== "history") return false;
  const rawType = isString(rawEvent.type) ? rawEvent.type : "";
  if (
    (rawType === "turn.ended" || rawType === "TurnEnd") &&
    hasPendingLocalPromptPlaceholder(events)
  ) {
    return true;
  }
  const text = snapshotText(rawEvent);
  if (!text) return false;

  if (rawEvent.snapshotRole === "tool") {
    const toolCallId = isString(rawEvent.toolCallId) ? rawEvent.toolCallId : "";
    return events.some((event) => {
      if (event.type !== "tool_result") return false;
      if (toolCallId && event.toolCallId !== toolCallId) return false;
      return normalizeText(String(event.result ?? "")).includes(text);
    });
  }

  return events.some((event) => {
    if (event.type !== "assistant_message") return false;
    const content = normalizeText([event.thinking, event.content].filter(isString).join("\n"));
    return content.includes(text);
  });
}

function sameUserPrompt(a: TimelineEvent, b: TimelineEvent): boolean {
  if (a.type !== "user_message" || b.type !== "user_message") return false;
  return normalizeText(a.content) === normalizeText(b.content);
}

/** Running history is a progress sample, so it must not erase the active local row. */
export function preservePendingTurnInRunningSnapshot(
  localEvents: readonly TimelineEvent[],
  snapshotEvents: TimelineEvent[],
): TimelineEvent[] {
  const assistantIndex = localEvents.findLastIndex((event) => (
    event.type === "assistant_message" && !event.isComplete
  ));
  if (assistantIndex < 0 || snapshotEvents.some((event) => (
    event.type === "assistant_message" && !event.isComplete
  ))) return snapshotEvents;

  const assistant = localEvents[assistantIndex];
  const status = localEvents.slice(0, assistantIndex).findLast((event) => (
    event.type === "status_update" && event.source === "ipc" && Boolean(event.parentEventId)
  ));
  if (status?.type !== "status_update" || !status.parentEventId) return snapshotEvents;
  const user = localEvents.find((event) => event.type === "user_message" && event.id === status.parentEventId);
  if (!user || user.type !== "user_message") return snapshotEvents;

  const result = [...snapshotEvents];
  if (!result.some((event) => sameUserPrompt(event, user))) result.push(user);
  result.push(status, assistant);
  return result;
}
