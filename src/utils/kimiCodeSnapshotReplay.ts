import type { TimelineEvent } from "@/types/ui";
import { mergeEvents, preserveLocalUserMediaInCanonicalHistory } from "./eventMapper";

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

/**
 * Running history is an additive progress sample. Merge it into the live
 * timeline so mounted rows keep their local identities and interaction state.
 */
export function reconcileRunningKimiSnapshot(
  localEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
): TimelineEvent[] {
  const snapshotEvents = preserveLocalUserMediaInCanonicalHistory(localEvents, canonicalEvents);
  return snapshotEvents.reduce((events, event) => {
    const alreadyMounted = events.some((local) => {
      if (local.type !== event.type) return false;
      if (local.type === "assistant_message" && event.type === "assistant_message") {
        return local.isComplete === event.isComplete &&
          local.content === event.content &&
          (local.thinking ?? "") === (event.thinking ?? "");
      }
      if (local.type === "tool_call" && event.type === "tool_call") {
        return Boolean(local.toolCallId) && local.toolCallId === event.toolCallId && local.status === event.status;
      }
      return false;
    });
    return alreadyMounted ? events : mergeEvents(events, event);
  }, [...localEvents]);
}
