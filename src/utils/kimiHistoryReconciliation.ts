import type { TimelineEvent } from "@/types/ui";
import { hasMalformedAssistantMarkdown } from "@/utils/eventHelpers";
import { mergeEvents } from "@/utils/eventMapper";
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

function normalizedUserTurnContent(content: string): string {
  return content.trim().replace(/\s+/g, " ");
}

type KimiHistoryTurnBody = {
  type: "user_message" | "steer_message";
  user: string;
  assistant: string;
};

function kimiHistoryTurnBodies(events: TimelineEvent[]): KimiHistoryTurnBody[] {
  const turns: KimiHistoryTurnBody[] = [];
  for (const event of events) {
    if (event.type === "user_message" || event.type === "steer_message") {
      turns.push({
        type: event.type,
        user: normalizedUserTurnContent(event.content),
        assistant: "",
      });
      continue;
    }
    if (event.type !== "assistant_message" || turns.length === 0) continue;
    const body = event.content.trim();
    if (!body) continue;
    const current = turns[turns.length - 1];
    current.assistant = normalizedUserTurnContent(
      current.assistant ? `${current.assistant}\n\n${body}` : body,
    );
  }
  return turns;
}

/**
 * A successful official load can certify an old cache without replacing its
 * richer local tool/process frames when every visible user boundary and its
 * aggregate Assistant body are already identical.
 */
export function hasEquivalentKimiHistoryTurnBodies(
  cachedEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
): boolean {
  const cachedTurns = kimiHistoryTurnBodies(cachedEvents);
  const canonicalTurns = kimiHistoryTurnBodies(canonicalEvents);
  if (cachedTurns.length === 0 || cachedTurns.length !== canonicalTurns.length) return false;
  return cachedTurns.every((turn, index) => {
    const canonical = canonicalTurns[index];
    return turn.type === canonical.type &&
      turn.user === canonical.user &&
      turn.assistant === canonical.assistant;
  });
}

function stableSnapshotAssistantTurnOwners(events: TimelineEvent[]): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  let currentUserContent = "";
  for (const event of events) {
    if (event.type === "user_message") {
      currentUserContent = normalizedUserTurnContent(event.content);
      continue;
    }
    if (
      event.type !== "assistant_message" ||
      event.snapshotMessageIdStable !== true ||
      !event.snapshotMessageId ||
      !currentUserContent
    ) continue;
    const turnOwners = owners.get(event.snapshotMessageId) ?? new Set<string>();
    turnOwners.add(currentUserContent);
    owners.set(event.snapshotMessageId, turnOwners);
  }
  return owners;
}

function hasStableSnapshotTurnOwnershipMismatch(
  cachedEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
): boolean {
  const cachedOwners = stableSnapshotAssistantTurnOwners(cachedEvents);
  const canonicalOwners = stableSnapshotAssistantTurnOwners(canonicalEvents);
  for (const [messageId, localTurnOwners] of cachedOwners) {
    const officialTurnOwners = canonicalOwners.get(messageId);
    if (!officialTurnOwners) continue;
    if (Array.from(localTurnOwners).some((owner) => !officialTurnOwners.has(owner))) return true;
  }
  return false;
}

const MIN_CANONICAL_REPLY_MATCH_LENGTH = 24;
const MIN_CROSS_TURN_REPLY_COVERAGE = 0.8;

function stableSnapshotAssistantBodies(events: TimelineEvent[]): Map<string, string> {
  const bodies = new Map<string, string[]>();
  for (const event of events) {
    if (
      event.type !== "assistant_message" ||
      event.snapshotMessageIdStable !== true ||
      !event.snapshotMessageId
    ) continue;
    const body = normalizedUserTurnContent(event.content);
    if (!body) continue;
    const parts = bodies.get(event.snapshotMessageId) ?? [];
    parts.push(body);
    bodies.set(event.snapshotMessageId, parts);
  }
  return new Map(Array.from(bodies, ([messageId, parts]) => [messageId, parts.join(" ")]));
}

/**
 * A stable snapshot message is an immutable official identity. If the local
 * body for that exact identity contains the complete canonical body plus a
 * substantial suffix/prefix, the row has absorbed content from other official
 * messages. This remains conclusive even when the canonical window no longer
 * contains the original user boundary for the old message.
 */
function hasStableSnapshotMessageBodyExpansion(
  cachedEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
): boolean {
  const cachedBodies = stableSnapshotAssistantBodies(cachedEvents);
  const canonicalBodies = stableSnapshotAssistantBodies(canonicalEvents);
  for (const [messageId, localBody] of cachedBodies) {
    const canonicalBody = canonicalBodies.get(messageId);
    if (!canonicalBody || canonicalBody.length < MIN_CANONICAL_REPLY_MATCH_LENGTH) continue;
    if (localBody.length - canonicalBody.length < MIN_CANONICAL_REPLY_MATCH_LENGTH) continue;
    if (localBody.includes(canonicalBody)) return true;
  }
  return false;
}

type CanonicalAssistantReply = {
  body: string;
  owner: string;
};

function canonicalAssistantReplies(
  events: TimelineEvent[],
  requireStableIdentity: boolean,
): CanonicalAssistantReply[] {
  const replies: CanonicalAssistantReply[] = [];
  let currentUserContent = "";
  for (const event of events) {
    if (event.type === "user_message" || event.type === "steer_message") {
      currentUserContent = normalizedUserTurnContent(event.content);
      continue;
    }
    if (
      event.type !== "assistant_message" ||
      (requireStableIdentity && (
        event.snapshotMessageIdStable !== true || !event.snapshotMessageId
      )) ||
      !currentUserContent
    ) continue;
    const body = normalizedUserTurnContent(event.content);
    if (body.length < MIN_CANONICAL_REPLY_MATCH_LENGTH) continue;
    replies.push({ body, owner: currentUserContent });
  }
  return replies;
}

function mergedIntervalCoverage(intervals: Array<{ start: number; end: number }>): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((left, right) => left.start - right.start || left.end - right.end);
  let total = 0;
  let currentStart = sorted[0].start;
  let currentEnd = sorted[0].end;
  for (const interval of sorted.slice(1)) {
    if (interval.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.end);
      continue;
    }
    total += currentEnd - currentStart;
    currentStart = interval.start;
    currentEnd = interval.end;
  }
  return total + currentEnd - currentStart;
}

function bodyHasCrossTurnCanonicalReplyComposition(
  localBody: string,
  currentUserContent: string,
  canonicalReplies: CanonicalAssistantReply[],
): boolean {
  if (localBody.length < MIN_CANONICAL_REPLY_MATCH_LENGTH * 2) return false;
  const matches = canonicalReplies.flatMap((reply) => {
    const intervals: Array<CanonicalAssistantReply & { start: number; end: number }> = [];
    let start = localBody.indexOf(reply.body);
    while (start >= 0) {
      intervals.push({ ...reply, start, end: start + reply.body.length });
      start = localBody.indexOf(reply.body, start + 1);
    }
    return intervals;
  });
  const sameTurnMatches = matches.filter((match) => match.owner === currentUserContent);
  const foreignTurnMatches = matches.filter((match) => match.owner !== currentUserContent);
  const hasDisjointCrossTurnPair = sameTurnMatches.some((sameTurn) => foreignTurnMatches.some((foreignTurn) => (
    sameTurn.end <= foreignTurn.start || foreignTurn.end <= sameTurn.start
  )));
  if (!hasDisjointCrossTurnPair) return false;

  const coveredLength = mergedIntervalCoverage(matches);
  return coveredLength / localBody.length >= MIN_CROSS_TURN_REPLY_COVERAGE;
}

/**
 * Older caches can contain no trustworthy snapshot id at all. Accept a
 * shorter canonical history only when one local user turn is almost entirely
 * composed of complete, identity-backed canonical replies owned by this turn
 * and by another turn. The local reply can be split across several Assistant
 * rows because the renderer merges every row between two user boundaries.
 * Requiring disjoint matches and high coverage avoids treating ordinary quoted
 * text as cross-turn pollution.
 */
function hasCrossTurnCanonicalReplyComposition(
  cachedEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
): boolean {
  const unambiguous = (replies: CanonicalAssistantReply[]) => {
    const bodyOwners = new Map<string, Set<string>>();
    for (const reply of replies) {
      const owners = bodyOwners.get(reply.body) ?? new Set<string>();
      owners.add(reply.owner);
      bodyOwners.set(reply.body, owners);
    }
    return replies.filter((reply) => bodyOwners.get(reply.body)?.size === 1);
  };
  const stableReplies = unambiguous(canonicalAssistantReplies(canonicalEvents, true));
  const allReplies = unambiguous(canonicalAssistantReplies(canonicalEvents, false));

  let currentUserContent = "";
  let currentTurnBodies: string[] = [];
  let currentTurnHasStableAssistant = false;
  const flushCurrentTurn = () => {
    if (!currentUserContent || currentTurnBodies.length === 0) return false;
    const localBody = normalizedUserTurnContent(currentTurnBodies.join("\n\n"));
    if (bodyHasCrossTurnCanonicalReplyComposition(
      localBody,
      currentUserContent,
      stableReplies,
    )) return true;
    // Formal startup may temporarily fall back to SDK/wire history before the
    // Server snapshot is ready. That history retains exact bodies and user
    // boundaries but has no snapshot IDs. Only relax the canonical-ID
    // requirement when the polluted local turn itself contains multiple
    // Assistant rows and at least one immutable upstream identity.
    return currentTurnHasStableAssistant && currentTurnBodies.length >= 2 &&
      bodyHasCrossTurnCanonicalReplyComposition(
        localBody,
        currentUserContent,
        allReplies,
      );
  };
  for (const event of cachedEvents) {
    if (event.type === "user_message" || event.type === "steer_message") {
      if (flushCurrentTurn()) return true;
      currentUserContent = normalizedUserTurnContent(event.content);
      currentTurnBodies = [];
      currentTurnHasStableAssistant = false;
      continue;
    }
    if (event.type !== "assistant_message" || !currentUserContent) continue;
    const body = event.content.trim();
    if (body) {
      currentTurnBodies.push(body);
      currentTurnHasStableAssistant ||= event.snapshotMessageIdStable === true && Boolean(event.snapshotMessageId);
    }
  }
  return flushCurrentTurn();
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

function sameMatchedUserTurn(
  local: Extract<TimelineEvent, { type: "user_message" }>,
  canonical: Extract<TimelineEvent, { type: "user_message" }>,
): boolean {
  if (local.roomMessageId && canonical.roomMessageId) {
    return local.roomMessageId === canonical.roomMessageId;
  }
  if (local.agentTurnId && canonical.agentTurnId) {
    return local.agentTurnId === canonical.agentTurnId;
  }
  if (local.id === canonical.id) return true;
  return normalizedUserTurnContent(local.content) === normalizedUserTurnContent(canonical.content) &&
    Math.abs(local.timestamp - canonical.timestamp) <= 30_000;
}

function isVisibleTurnOutput(event: TimelineEvent): boolean {
  if (event.type === "assistant_message") {
    return Boolean(event.content.trim() || event.thinking?.trim() || event.thinkingParts?.some((part) => part.text.trim()));
  }
  return event.type === "tool_call" ||
    event.type === "tool_result" ||
    event.type === "subagent" ||
    event.type === "error" ||
    event.type === "file_artifact" ||
    event.type === "change_summary" ||
    event.type === "diff";
}

/**
 * When the complete canonical history is rejected by the monotonicity gate,
 * recover one otherwise invisible latest turn without touching older local
 * history. The latest user boundary must match by persisted identity or a
 * bounded content/time echo, while the Assistant itself must have an
 * immutable official message identity.
 */
export function mergeMissingLatestCanonicalAssistant(
  localEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
  context?: { sessionId?: string; roomAgentId?: string; reason?: string },
): TimelineEvent[] {
  const canonicalUserIndex = canonicalEvents.findLastIndex((event) => event.type === "user_message");
  const localUserIndex = localEvents.findLastIndex((event) => event.type === "user_message");
  if (canonicalUserIndex < 0 || localUserIndex < 0) return localEvents;

  const canonicalUser = canonicalEvents[canonicalUserIndex];
  const localUser = localEvents[localUserIndex];
  if (
    canonicalUser.type !== "user_message" ||
    localUser.type !== "user_message" ||
    !sameMatchedUserTurn(localUser, canonicalUser)
  ) return localEvents;

  const canonicalTurnEvents = canonicalEvents.slice(canonicalUserIndex + 1);
  const canonicalAssistant = canonicalTurnEvents.findLast((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => (
    event.type === "assistant_message" &&
    event.snapshotMessageIdStable === true &&
    Boolean(event.snapshotMessageId) &&
    isVisibleTurnOutput(event)
  ));
  if (!canonicalAssistant?.snapshotMessageId) return localEvents;

  const localTurnEvents = localEvents.slice(localUserIndex + 1);
  const mountedInLatestTurn = localTurnEvents.some((event) => (
    event.type === "assistant_message" &&
    event.snapshotMessageIdStable === true &&
    event.snapshotMessageId === canonicalAssistant.snapshotMessageId
  ));
  if (localTurnEvents.some(isVisibleTurnOutput) && !mountedInLatestTurn) return localEvents;

  const alreadyMounted = flattenTimelineEvents(localEvents).some((event) => (
    event.type === "assistant_message" &&
    event.snapshotMessageIdStable === true &&
    event.snapshotMessageId === canonicalAssistant.snapshotMessageId
  ));
  if (alreadyMounted && !mountedInLatestTurn) return localEvents;

  const interruptedStatus = canonicalTurnEvents.findLast((event): event is Extract<TimelineEvent, { type: "status_update" }> => (
    event.type === "status_update" && Boolean(event.message && /中断|打断|cancelled|canceled|interrupted/i.test(event.message))
  ));
  const withInterruptedStatus = interruptedStatus && !localEvents.slice(localUserIndex + 1).some((event) => (
    event.type === "status_update" && Boolean(event.message && /中断|打断|cancelled|canceled|interrupted/i.test(event.message))
  ))
    ? mergeEvents(localEvents, interruptedStatus)
    : localEvents;
  const patched = mountedInLatestTurn
    ? withInterruptedStatus
    : mergeEvents(withInterruptedStatus, canonicalAssistant);
  if (patched === localEvents) return localEvents;
  logEvent("kimiHistoryReconciliation.latestFailedTurnPatched", {
    ...context,
    snapshotMessageId: canonicalAssistant.snapshotMessageId,
  });
  return patched;
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
  const canonicalAssistantSize = assistantBodySize(canonicalEvents);
  const cachedAssistantSize = assistantBodySize(cachedEvents);

  if (hasStableSnapshotMessageBodyExpansion(cachedEvents, canonicalEvents)) {
    logEvent("kimiHistoryReconciliation.accepted", {
      ...context,
      reason: "stable-snapshot-message-body-expansion",
      localSize: cachedAssistantSize,
      canonicalSize: canonicalAssistantSize,
    });
    return true;
  }

  // A stable official Assistant id mounted under a different user prompt is
  // proof of historical replay pollution, not richer local history. In this
  // one identity-backed case the canonical snapshot may shrink the body and
  // process projection to repair an already persisted cross-turn merge.
  if (hasStableSnapshotTurnOwnershipMismatch(cachedEvents, canonicalEvents)) {
    logEvent("kimiHistoryReconciliation.accepted", {
      ...context,
      reason: "stable-snapshot-turn-ownership-mismatch",
      localSize: cachedAssistantSize,
      canonicalSize: canonicalAssistantSize,
    });
    return true;
  }

  if (
    canonicalAssistantSize < cachedAssistantSize &&
    hasCrossTurnCanonicalReplyComposition(cachedEvents, canonicalEvents)
  ) {
    logEvent("kimiHistoryReconciliation.accepted", {
      ...context,
      reason: "cross-turn-canonical-reply-composition",
      localSize: cachedAssistantSize,
      canonicalSize: canonicalAssistantSize,
    });
    return true;
  }

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
