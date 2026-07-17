import type { TimelineEvent } from "@/types/ui";
import { hasMalformedAssistantMarkdown } from "@/utils/eventHelpers";
import {
  hasCanonicalKimiThinkingHistory,
  hasKimiProcessHistoryRegression,
  hasLegacyKimiClarificationWrapper,
  hasRicherKimiProcessHistory,
  kimiHistoryProcessEventCount,
} from "@/utils/kimiHistoryCache";
import { logEvent } from "@/utils/reportError";

/**
 * Flatten a timeline so that events nested inside subagent.events are also
 * included in top-down order. This lets body/process/thinking statistics see
 * content that the SDK scoped to a subagent.
 */
export function flattenTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  const result: TimelineEvent[] = [];
  for (const event of events) {
    result.push(event);
    if (event.type === "subagent") {
      result.push(...flattenTimelineEvents(event.events));
    }
  }
  return result;
}

/**
 * Total length of assistant_message content, recursively including subagents.
 */
export function assistantBodySize(events: TimelineEvent[]): number {
  return flattenTimelineEvents(events)
    .filter((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => event.type === "assistant_message")
    .reduce((sum, event) => sum + event.content.trim().length, 0);
}

/**
 * Concatenated non-empty assistant_message content, recursively including subagents.
 */
export function assistantBodyText(events: TimelineEvent[]): string {
  return flattenTimelineEvents(events)
    .filter((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => event.type === "assistant_message")
    .map((event) => event.content)
    .filter((content) => content.trim().length > 0)
    .join("\n\n");
}

function thinkingHistorySize(events: TimelineEvent[]): number {
  return flattenTimelineEvents(events)
    .filter((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => event.type === "assistant_message")
    .reduce((sum, event) => {
      const text = event.thinkingParts?.map((part) => part.text).join("") || event.thinking || "";
      return sum + text.trim().length;
    }, 0);
}

function displayableUserImageCount(events: TimelineEvent[]): number {
  return events
    .filter((event): event is Extract<TimelineEvent, { type: "user_message" | "steer_message" }> => (
      event.type === "user_message" || event.type === "steer_message"
    ))
    .reduce((sum, event) => sum + (event.images ?? []).filter((image) => (
      typeof image.dataUrl === "string" && image.dataUrl.startsWith("data:image/")
    )).length, 0);
}

export function hasPossiblyLostUserImages(events: TimelineEvent[]): boolean {
  return events.some((event) => {
    if (event.type !== "user_message" && event.type !== "steer_message") return false;
    return (event.images ?? []).some((image) => (
      !image.filePath &&
      !(typeof image.dataUrl === "string" && image.dataUrl.startsWith("data:image/"))
    ));
  });
}

/**
 * Decide whether the canonical (server/history) timeline should replace the
 * cached/local one for a Kimi Code room agent.
 *
 * Conservative monotonicity: we only accept the canonical timeline when it is
 * provably richer in at least one dimension (more assistant text, more user
 * images, more process events, or better thinking). If the canonical snapshot
 * is shorter or has fewer process events than what we already have locally, we
 * keep the local timeline to avoid destructive regressions.
 */
export function shouldReplaceWithCanonicalKimiHistory(
  cachedEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
  context?: { sessionId?: string; roomAgentId?: string; reason?: string },
): boolean {
  if (canonicalEvents.length === 0) return false;

  // Server snapshots can contain the newest assistant text/thinking while
  // omitting tool-call lifecycle frames. Never let such a partial snapshot
  // destructively replace a richer live/local process timeline.
  if (hasKimiProcessHistoryRegression(cachedEvents, canonicalEvents)) {
    logEvent("kimiHistoryReconciliation.rejected", {
      ...context,
      reason: "process-history-regression",
      localProcessEvents: kimiHistoryProcessEventCount(cachedEvents),
      canonicalProcessEvents: kimiHistoryProcessEventCount(canonicalEvents),
    });
    return false;
  }

  const canonicalAssistantBody = assistantBodyText(canonicalEvents);
  const cachedAssistantBody = assistantBodyText(cachedEvents);
  const canonicalAssistantSize = assistantBodySize(canonicalEvents);
  const cachedAssistantSize = assistantBodySize(cachedEvents);
  const canonicalThinkingSize = thinkingHistorySize(canonicalEvents);
  const cachedThinkingSize = thinkingHistorySize(cachedEvents);
  const canonicalImageCount = displayableUserImageCount(canonicalEvents);
  const cachedImageCount = displayableUserImageCount(cachedEvents);

  const regression = canonicalAssistantSize < cachedAssistantSize
    ? {
        reason: "assistant-body-regression",
        localSize: cachedAssistantSize,
        canonicalSize: canonicalAssistantSize,
      }
    : canonicalThinkingSize < cachedThinkingSize
      ? {
          reason: "thinking-history-regression",
          localThinkingSize: cachedThinkingSize,
          canonicalThinkingSize,
        }
      : canonicalImageCount < cachedImageCount
        ? {
            reason: "user-image-regression",
            localImageCount: cachedImageCount,
            canonicalImageCount,
          }
        : null;
  if (regression) {
    logEvent("kimiHistoryReconciliation.rejected", {
      ...context,
      ...regression,
    });
    return false;
  }

  const shouldReplace = canonicalAssistantSize > cachedAssistantSize ||
    canonicalImageCount > cachedImageCount ||
    (hasMalformedAssistantMarkdown(cachedEvents) && !hasMalformedAssistantMarkdown(canonicalEvents)) ||
    (Boolean(canonicalAssistantBody) && canonicalAssistantBody !== cachedAssistantBody && canonicalAssistantSize >= cachedAssistantSize) ||
    (hasLegacyKimiClarificationWrapper(cachedEvents) && !hasLegacyKimiClarificationWrapper(canonicalEvents)) ||
    hasRicherKimiProcessHistory(cachedEvents, canonicalEvents) ||
    hasCanonicalKimiThinkingHistory(cachedEvents, canonicalEvents);

  if (shouldReplace) {
    logEvent("kimiHistoryReconciliation.accepted", {
      ...context,
      localSize: cachedAssistantSize,
      canonicalSize: canonicalAssistantSize,
    });
  }

  return shouldReplace;
}
