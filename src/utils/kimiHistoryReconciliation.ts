import type { TimelineEvent } from "@/types/ui";
import { extractModelFromStatusMessage } from "./modelDisplay";
import { hasMalformedAssistantMarkdown } from "@/utils/eventHelpers";
import { mergeAssistantThinkingParts, mergeEvents } from "@/utils/eventMapper";
import {
  hasCanonicalKimiThinkingHistory,
  hasKimiProcessHistoryRegression,
  hasLegacyKimiClarificationWrapper,
  hasRepairableDuplicateKimiToolHistory,
  hasRicherKimiProcessHistory,
  kimiHistoryProcessEventCount,
} from "@/utils/kimiHistoryCache";
import { logEvent } from "@/utils/reportError";
import {
  clearReconciliationCircuit,
  markReconciliationRejected,
} from "@/utils/reconcileCircuitBreaker";

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

/** Collapse an exact whole-text repetition ("XX" from a double-written replay). */
function collapseRepeatedThinkingText(text: string): string {
  let current = text;
  for (;;) {
    const normalized = current.replace(/\s+/g, " ").trim();
    if (normalized.length < 2 || normalized.length % 2 !== 0) return current;
    const half = normalized.length / 2;
    if (normalized.slice(0, half) !== normalized.slice(half)) return current;
    current = normalized.slice(0, half);
  }
}

/**
 * Live thinking deltas and snapshot replays can double-write the same thought
 * into the local timeline (blind fragment concat, replay full text appended
 * after the live aggregation). Regression gates must compare the local
 * timeline *after* removing those provable duplicates — otherwise a clean
 * canonical history looks "thinner" than the inflated local one and the
 * monotonicity guard rejects it, persisting the duplication forever.
 * Dedupe is conservative: drop events re-mounted under an identical
 * (type, id), fold thinkingParts through the idempotent inclusion merge
 * (covered fragments dropped, supersets kept), and collapse exact whole-text
 * repetitions. Genuinely distinct content is never touched.
 */
function dedupeLocalHistoryForComparison(events: TimelineEvent[]): TimelineEvent[] {
  const seenEventKeys = new Set<string>();
  const visit = (list: TimelineEvent[]): TimelineEvent[] => {
    let changed = false;
    const result: TimelineEvent[] = [];
    for (const event of list) {
      const key = `${event.type} ${event.id}`;
      if (seenEventKeys.has(key)) {
        changed = true;
        continue;
      }
      seenEventKeys.add(key);
      let next = event;
      if (event.type === "subagent") {
        const nested = visit(event.events);
        if (nested !== event.events) next = { ...event, events: nested };
      }
      if (next.type === "assistant_message") {
        if (next.thinkingParts?.length) {
          const parts = next.thinkingParts.reduce<NonNullable<typeof next.thinkingParts> | undefined>(
            (acc, part) => mergeAssistantThinkingParts(acc, [part]),
            undefined,
          );
          if (parts && parts.length !== next.thinkingParts.length) next = { ...next, thinkingParts: parts };
        }
        if (next.thinking) {
          const collapsed = collapseRepeatedThinkingText(next.thinking);
          if (collapsed !== next.thinking) next = { ...next, thinking: collapsed };
        }
      }
      if (next !== event) changed = true;
      result.push(next);
    }
    return changed ? result : list;
  };
  return visit(events);
}

/**
 * 持久化修复版去重：dedupeLocalHistoryForComparison 只作用于比较侧，本地
 * 时间线自身的重复仍会原样落盘。同轮内 `active-draft:` id 事件若（正文+
 * 思考）文本完全相同，是同一段官方内容的重复材料化（旧快照有实据：同一
 * 51 字进度被材料化为 16 个不同事件）；保留首个、清空其余。只认材料化 id
 * 前缀与非空长文本，formal 事件与合法短回复不受影响；思考总量回落后单调
 * 门禁不再把干净 canonical 判「更薄」。
 */
export function collapseDuplicateMaterializations(events: TimelineEvent[]): TimelineEvent[] {
  const seenSignatures = new Set<string>();
  let changed = false;
  const result = events.map((event) => {
    if (event.type === "user_message" || event.type === "steer_message") {
      seenSignatures.clear();
      return event;
    }
    if (event.type !== "assistant_message" || !event.id.startsWith("active-draft:")) return event;
    const body = event.content.trim();
    const thinking = (event.thinkingParts?.map((part) => part.text).join("") || event.thinking || "").trim();
    const signature = body + "\n" + thinking;
    if (signature.length < 16) return event;
    if (seenSignatures.has(signature)) {
      changed = true;
      return { ...event, content: "", thinking: undefined, thinkingParts: undefined, isThinking: false };
    }
    seenSignatures.add(signature);
    return event;
  });
  return changed ? result : events;
}

/**
 * 认证防线：hasEquivalentKimiHistoryTurnBodies 只比对用户边界与正文，思考虚高
 * （盲拼残片、正式事件精确重复）的缓存会被误判「等价」并打上 cache-current，
 * 此后不再是 repair 候选，损伤永久固化（实机实据：某会话尾部 9 段盲拼 +
 * 一段 7548 字正式事件重复被认证后冻结）。认证前必须确认本地思考总量
 * （先做比较侧去重）不超过 canonical。
 */
export function hasInflatedLocalKimiThinkingHistory(
  cachedEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
): boolean {
  return thinkingHistorySize(dedupeLocalHistoryForComparison(cachedEvents)) > thinkingHistorySize(canonicalEvents);
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

function stableSnapshotSequence(snapshotMessageId?: string): { prefix: string; value: number } | null {
  if (!snapshotMessageId) return null;
  const match = /^(.*)_(\d+)$/.exec(snapshotMessageId);
  return match ? { prefix: match[1], value: Number(match[2]) } : null;
}

function isVisibleTurnOutput(event: TimelineEvent): boolean {
  if (event.type === "assistant_message") {
    return Boolean(event.content.trim() || event.thinking?.trim() || event.thinkingParts?.some((part) => part.text.trim()));
  }
  // A transient `error` event is a status signal, not Assistant body output;
  // keeping it out of this predicate lets mergeMissingLatestCanonicalAssistant
  // patch a canonical failed Assistant into a turn whose only local evidence
  // is the transient error frame.
  return event.type === "tool_call" ||
    event.type === "tool_result" ||
    event.type === "subagent" ||
    event.type === "file_artifact" ||
    event.type === "change_summary" ||
    event.type === "diff";
}

function visibleProcessEventCount(events: TimelineEvent[]): number {
  return flattenTimelineEvents(events).filter(isVisibleTurnOutput).length;
}

function removeRecoveredTurnCandidates(
  events: TimelineEvent[],
  afterUserIndex: number,
  canonicalUserTimestamp: number,
  beforeIndex = events.length,
): TimelineEvent[] {
  return events.filter((event, index) => (
    index <= afterUserIndex ||
    index >= beforeIndex ||
    event.timestamp < canonicalUserTimestamp
  ));
}

export function removeIdentityCoveredDuplicateToolCalls(
  localEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
): TimelineEvent[] {
  const canonicalToolIds = new Set(flattenTimelineEvents(canonicalEvents)
    .filter((event): event is Extract<TimelineEvent, { type: "tool_call" }> => (
      event.type === "tool_call" && Boolean(event.toolCallId)
    ))
    .map((event) => event.toolCallId));
  for (const event of flattenTimelineEvents(localEvents)) {
    if (
      event.type === "tool_call" &&
      event.toolCallId &&
      event.id.startsWith("snapshot:")
    ) {
      canonicalToolIds.add(event.toolCallId);
    }
  }
  if (canonicalToolIds.size === 0) return localEvents;

  const seenCoveredToolIds = new Set<string>();
  const visit = (events: TimelineEvent[]): TimelineEvent[] => {
    let changed = false;
    const result: TimelineEvent[] = [];
    for (const event of events) {
      if (event.type === "tool_call" && canonicalToolIds.has(event.toolCallId)) {
        if (seenCoveredToolIds.has(event.toolCallId)) {
          changed = true;
          continue;
        }
        seenCoveredToolIds.add(event.toolCallId);
      }
      if (event.type === "subagent") {
        const nested = visit(event.events);
        if (nested !== event.events) {
          result.push({ ...event, events: nested });
          changed = true;
          continue;
        }
      }
      result.push(event);
    }
    return changed ? result : events;
  };
  return visit(localEvents);
}

/**
 * When the complete canonical history is rejected by the monotonicity gate,
 * recover one otherwise invisible latest turn without touching older local
 * history. Prefer a matching persisted user boundary; when the local timeline
 * missed that boundary entirely, only a strictly newer canonical user with a
 * visible final body may be restored. That recovery is turn-atomic: thinking,
 * tools and the final body move together whenever the canonical tail is at
 * least as rich as locally misplaced output. Prefer immutable official
 * Assistant identity; local wire mirrors without message ids may use a
 * strictly newer Assistant timestamp within a matched turn.
 */
export function mergeMissingLatestCanonicalAssistant(
  localEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
  context?: { sessionId?: string; roomAgentId?: string; reason?: string },
): TimelineEvent[] {
  localEvents = removeIdentityCoveredDuplicateToolCalls(localEvents, canonicalEvents);
  const canonicalUserIndex = canonicalEvents.findLastIndex((event) => event.type === "user_message");
  const localUserIndex = localEvents.findLastIndex((event) => event.type === "user_message");
  if (canonicalUserIndex < 0 || localUserIndex < 0) return localEvents;

  const canonicalUser = canonicalEvents[canonicalUserIndex];
  const localUser = localEvents[localUserIndex];
  if (
    canonicalUser.type !== "user_message" ||
    localUser.type !== "user_message"
  ) return localEvents;

  const canonicalTurnEvents = canonicalEvents.slice(canonicalUserIndex + 1);
  const canonicalAssistant = canonicalTurnEvents.findLast((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => (
    event.type === "assistant_message" &&
    isVisibleTurnOutput(event)
  ));
  if (!canonicalAssistant) return localEvents;

  if (!sameMatchedUserTurn(localUser, canonicalUser)) {
    const canonicalUserAlreadyMounted = localEvents.some((event) => (
      event.type === "user_message" && sameMatchedUserTurn(event, canonicalUser)
    ));
    const isStrictlyNewerCompleteTurn = !canonicalUserAlreadyMounted &&
      canonicalUser.timestamp > localUser.timestamp &&
      canonicalAssistant.timestamp >= canonicalUser.timestamp &&
      canonicalAssistant.content.trim().length > 0;
    if (!isStrictlyNewerCompleteTurn) return localEvents;

    const localCandidateEvents = localEvents.slice(localUserIndex + 1)
      .filter((event) => event.timestamp >= canonicalUser.timestamp);
    const canonicalTailCanReplaceLocalRemnants = visibleProcessEventCount(localCandidateEvents) === 0;
    const baseEvents = removeRecoveredTurnCandidates(
      localEvents,
      localUserIndex,
      canonicalUser.timestamp,
    );
    // A missing user boundary is a missing turn, not merely a missing body.
    // Restore the canonical tail atomically when local post-boundary remnants
    // contain no visible output, so expandable thinking/tools cannot remain
    // stranded in the previous turn. If local remnants are richer, preserve
    // and re-anchor them behind the recovered boundary, then use the narrower
    // final-body fallback.
    const patched = canonicalTailCanReplaceLocalRemnants
      ? [...baseEvents, canonicalUser, ...canonicalTurnEvents]
      : mergeEvents([...baseEvents, canonicalUser, ...localCandidateEvents], canonicalAssistant);
    logEvent("kimiHistoryReconciliation.latestCanonicalTurnPatched", {
      ...context,
      callerReason: context?.reason,
      canonicalUserTimestamp: canonicalUser.timestamp,
      canonicalAssistantTimestamp: canonicalAssistant.timestamp,
      canonicalTailRestored: canonicalTailCanReplaceLocalRemnants,
    });
    return patched;
  }

  const localTurnEvents = localEvents.slice(localUserIndex + 1);
  const canonicalHasExpandableProcess = canonicalTurnEvents.some((event) => (
    event.type === "tool_call" ||
    event.type === "subagent" ||
    (event.type === "assistant_message" && Boolean(
      event.thinking?.trim() ||
      event.thinkingParts?.some((part) => part.text.trim())
    ))
  ));
  const localHasExpandableProcess = localTurnEvents.some((event) => (
    event.type === "tool_call" ||
    event.type === "subagent" ||
    (event.type === "assistant_message" && Boolean(
      event.thinking?.trim() ||
      event.thinkingParts?.some((part) => part.text.trim())
    ))
  ));
  const localHasCanonicalFinalBody = localTurnEvents.some((event) => (
    event.type === "assistant_message" &&
    event.content.trim().length > 0 &&
    event.content.trim() === canonicalAssistant.content.trim()
  ));
  if (canonicalHasExpandableProcess && !localHasExpandableProcess && localHasCanonicalFinalBody) {
    const previousLocalUserIndex = localEvents
      .slice(0, localUserIndex)
      .findLastIndex((event) => event.type === "user_message");
    const preservedPrefix = removeRecoveredTurnCandidates(
      localEvents.slice(0, localUserIndex),
      previousLocalUserIndex,
      canonicalUser.timestamp,
    );
    const patched = [...preservedPrefix, localUser, ...canonicalTurnEvents];
    logEvent("kimiHistoryReconciliation.latestCanonicalTurnProcessPatched", {
      ...context,
      callerReason: context?.reason,
      canonicalUserTimestamp: canonicalUser.timestamp,
      canonicalProcessEvents: visibleProcessEventCount(canonicalTurnEvents),
    });
    return patched;
  }

  const hasStableCanonicalIdentity = canonicalAssistant.snapshotMessageIdStable === true &&
    Boolean(canonicalAssistant.snapshotMessageId);
  const mountedInLatestTurn = hasStableCanonicalIdentity && localTurnEvents.some((event) => (
    event.type === "assistant_message" &&
    event.snapshotMessageIdStable === true &&
    event.snapshotMessageId === canonicalAssistant.snapshotMessageId
  ));
  const hasVisibleLocalOutput = localTurnEvents.some(isVisibleTurnOutput);
  if (hasVisibleLocalOutput && !mountedInLatestTurn) {
    // A rejected whole-history replacement may still carry a later immutable
    // Assistant segment that the local timeline lost during persistence. Only
    // append the canonical tail when the latest local turn already shares the
    // same official snapshot sequence and the candidate is strictly newer.
    // This preserves richer local thinking/tools without guessing across turns
    // or turning a tool-only local turn into an unrelated Assistant response.
    const canonicalSeq = stableSnapshotSequence(canonicalAssistant.snapshotMessageId);
    const localStableSeqs = localTurnEvents.flatMap((event) => {
      if (
        event.type !== "assistant_message" ||
        event.snapshotMessageIdStable !== true
      ) return [];
      const seq = stableSnapshotSequence(event.snapshotMessageId);
      return seq && canonicalSeq && seq.prefix === canonicalSeq.prefix ? [seq.value] : [];
    });
    const alreadyHasBody = localTurnEvents.some((event) => (
      event.type === "assistant_message" &&
      event.content.trim() === canonicalAssistant.content.trim() &&
      canonicalAssistant.content.trim().length > 0
    ));
    const latestLocalAssistantTimestamp = localTurnEvents.reduce((latest, event) => (
      event.type === "assistant_message" && isVisibleTurnOutput(event)
        ? Math.max(latest, event.timestamp)
        : latest
    ), Number.NEGATIVE_INFINITY);
    const stableTailIsNewer = Boolean(
      canonicalSeq &&
      localStableSeqs.length > 0 &&
      canonicalSeq.value > Math.max(...localStableSeqs)
    );
    const wireTailIsNewer = !hasStableCanonicalIdentity &&
      canonicalAssistant.timestamp > latestLocalAssistantTimestamp;
    if ((!stableTailIsNewer && !wireTailIsNewer) || alreadyHasBody) return localEvents;
  } else if (!hasVisibleLocalOutput && !hasStableCanonicalIdentity) {
    return localEvents;
  }

  const alreadyMounted = hasStableCanonicalIdentity && flattenTimelineEvents(localEvents).some((event) => (
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
  logEvent("kimiHistoryReconciliation.latestCanonicalAssistantPatched", {
    ...context,
    callerReason: context?.reason,
    snapshotMessageId: canonicalAssistant.snapshotMessageId,
    canonicalTimestamp: canonicalAssistant.timestamp,
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
type FragmentTurnMeta = { sessionId?: string; roomAgentId?: string; reason: string };

/**
 * 按轮补丁「正文残片」：live 流式合并偶尔把最终正文缩成尾部残片（offset
 * 锚定跳过大部分 delta），整轮替换又被 process-history-regression 门挡住
 * （local 进程帧比 canonical 丰富），旧补丁只补最新一轮。这里按 user 边界
 * 对齐轮次，仅当 local 展示正文是 canonical 最终正文的真后缀（或空）时，把
 * 该轮最后一个带正文 assistant 事件替换为 canonical 全量，并清空同轮里作为
 * 其前缀的早到分段（它们是同一条官方消息的流式残段，canonical 视角不存在
 * 独立中间正文）。多消息轮的中间正文不是最终正文前缀，不受影响；进程/工具
 * 帧一律不动。
 */
export function mergeCanonicalFragmentTurnBodies(
  localEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
  meta: FragmentTurnMeta,
): TimelineEvent[] {
  type TurnSlice = {
    user: Extract<TimelineEvent, { type: "user_message" | "steer_message" }>;
    assistants: Array<Extract<TimelineEvent, { type: "assistant_message" }>>;
  };
  const sliceTurns = (events: TimelineEvent[]): TurnSlice[] => {
    const turns: TurnSlice[] = [];
    for (const event of events) {
      if (event.type === "user_message" || event.type === "steer_message") {
        turns.push({ user: event, assistants: [] });
        continue;
      }
      if (event.type !== "assistant_message" || turns.length === 0) continue;
      turns[turns.length - 1].assistants.push(event);
    }
    return turns;
  };
  // canonical 的 user 正文常被客户端注入的 <system-reminder> 等包装裹住，
  // 与本地裸文本纯比较必失配；优先轮次身份，退化为包含关系+时间窗。
  const turnUsersMatch = (
    local: TurnSlice["user"],
    canonical: TurnSlice["user"],
  ): boolean => {
    if (local.agentTurnId && canonical.agentTurnId && local.agentTurnId === canonical.agentTurnId) return true;
    if (local.roomMessageId && canonical.roomMessageId && local.roomMessageId === canonical.roomMessageId) return true;
    if (local.id === canonical.id) return true;
    const localText = normalizedUserTurnContent(local.content);
    const canonicalText = normalizedUserTurnContent(canonical.content);
    if (!localText || !canonicalText) return false;
    return (canonicalText.includes(localText) || localText.includes(canonicalText)) &&
      Math.abs(local.timestamp - canonical.timestamp) <= 30_000;
  };
  const localTurns = sliceTurns(localEvents);
  const canonicalTurns = sliceTurns(canonicalEvents);
  const replacements = new Map<string, string>();
  const clearedSegmentIds = new Set<string>();
  let patchedTurns = 0;
  let alignedTurns = 0;
  let mismatchedTurns = 0;
  let crossTurnRemnants = 0;
  // 两侧轮数天然可以不等：本地可能缺官方边界（跨轮错位/相邻轮合并），官方
  // 也可能多出「被打断后原文重发」的重复轮。因此对齐用单调游标向前搜索，
  // 匹配不到的本地轮跳过。旧实现按下标配对且首个不匹配就 break，任意一处
  // 边界错位都会让后面所有残片轮永远修不到（实测零命中的根因）。
  let cursor = 0;
  for (const local of localTurns) {
    let matchIndex = -1;
    for (let probe = cursor; probe < canonicalTurns.length; probe += 1) {
      if (turnUsersMatch(local.user, canonicalTurns[probe].user)) {
        matchIndex = probe;
        break;
      }
    }
    if (matchIndex < 0) continue;
    cursor = matchIndex + 1;
    alignedTurns += 1;
    const canonical = canonicalTurns[matchIndex];
    const canonicalWithBody = canonical.assistants.filter((event) => event.content.trim());
    const localWithBody = local.assistants.filter((event) => event.content.trim());
    if (canonicalWithBody.length === 0 || localWithBody.length === 0) continue;
    const canonicalFinalEvent = canonicalWithBody[canonicalWithBody.length - 1];
    const canonicalFinal = canonicalFinalEvent.content.trim();
    const localFinal = localWithBody[localWithBody.length - 1];
    const localFinalBody = localFinal.content.trim();
    if (localFinalBody === canonicalFinal) continue;
    mismatchedTurns += 1;
    // 官方一轮有多段正文（每个 step 一段）。残片是 offset 锚定从某一段截出
    // 的尾/中间子串，不一定属于最后一段——实测残片属于首段时，只比最后一段
    // 的旧判定恒为否。逐段判定；命中后仍把展示正文补成官方终段（折叠轮显示
    // 的就是终段）。本地已持有终段时不动，避免重复。
    if (localWithBody.some((event) => event.content.trim() === canonicalFinal)) continue;
    // 残片既可能是尾后缀，也可能是 offset 重置点截出的中间子串
    // （如「backoff。」）；用「子串且显著更短」兜底，长度门槛防误伤正常短回复。
    const isFragmentOf = (canonicalBody: string): boolean => (
      canonicalBody.endsWith(localFinalBody) ||
      (canonicalBody.includes(localFinalBody) && localFinalBody.length <= 32) ||
      (canonicalBody.includes(localFinalBody) && localFinalBody.length * 2 <= canonicalBody.length)
    );
    const isOwnTurnFragment = localFinalBody.length === 0 ||
      canonicalWithBody.some((event) => isFragmentOf(event.content.trim()));
    // 跨轮错位：live 流式下，下一轮的首段残片可能落在上一轮的
    // user 边界下（官方边界帧比首段正文晚到）。此时展示正文不属于
    // 本轮任何官方段，旧判定恒为否；但它是【下一轮】某段的残片，这就是
    // 错位的证据。下一轮自己也已对齐到本地轮（否则不进此分支），所以把
    // 本轮展示正文换回本轮官方终段不会丢它的内容。必须先排除本轮命中：
    // 短残片（如【。】）会同时命中多轮，本轮优先才不会误改正常短回复。
    const nextCanonical = canonicalTurns[matchIndex + 1];
    const isCrossTurnRemnant = !isOwnTurnFragment &&
      localFinalBody.length > 0 &&
      nextCanonical !== undefined &&
      nextCanonical.assistants.some((event) => {
        const body = event.content.trim();
        return body.length >= MIN_CANONICAL_REPLY_MATCH_LENGTH && isFragmentOf(body);
      });
    if (isCrossTurnRemnant) crossTurnRemnants += 1;
    const isFragment = isOwnTurnFragment || isCrossTurnRemnant;
    if (!isFragment || canonicalFinal.length < MIN_CANONICAL_REPLY_MATCH_LENGTH) continue;
    replacements.set(localFinal.id, canonicalFinalEvent.content);
    for (const segment of localWithBody.slice(0, -1)) {
      const body = segment.content.trim();
      if (body && canonicalFinal.startsWith(body)) clearedSegmentIds.add(segment.id);
    }
    patchedTurns += 1;
  }
  if (patchedTurns === 0) {
    // 对齐上了却一条没补时留痕：没有这条日志，「触发了但零命中」只能靠猜。
    // 只在确有正文不一致的轮次时打，避免稳态刷屏；不打正文，只打计数。
    if (mismatchedTurns > 0) {
      logEvent("kimiHistoryReconciliation.fragmentTurnBodiesSkipped", {
        sessionId: meta.sessionId,
        roomAgentId: meta.roomAgentId,
        reason: meta.reason,
        localTurns: localTurns.length,
        canonicalTurns: canonicalTurns.length,
        alignedTurns,
        mismatchedTurns,
        crossTurnRemnants,
      });
    }
    return localEvents;
  }
  logEvent("kimiHistoryReconciliation.fragmentTurnBodiesPatched", {
    sessionId: meta.sessionId,
    roomAgentId: meta.roomAgentId,
    reason: meta.reason,
    patchedTurns,
    localTurns: localTurns.length,
    canonicalTurns: canonicalTurns.length,
    alignedTurns,
    mismatchedTurns,
    crossTurnRemnants,
  });
  return localEvents.map((event) => {
    if (event.type !== "assistant_message") return event;
    const replacement = replacements.get(event.id);
    if (replacement !== undefined) return { ...event, content: replacement };
    if (clearedSegmentIds.has(event.id)) return { ...event, content: "" };
    return event;
  });
}

export function shouldReplaceWithCanonicalKimiHistory(
  cachedEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
  context?: { sessionId?: string; roomAgentId?: string; reason?: string; rawCanonicalEvents?: TimelineEvent[] },
): boolean {
  if (canonicalEvents.length === 0) return false;
  // Log-safe context: strip rawCanonicalEvents (a full event array) to avoid
  // serializing MB-scale arrays into every rejected/accepted diagnostic entry.
  const logCtx: Record<string, unknown> = context ? { ...context } : {};
  delete logCtx.rawCanonicalEvents;
  const canonicalAssistantSize = assistantBodySize(canonicalEvents);
  const cachedAssistantSize = assistantBodySize(cachedEvents);
  // Regression gates below compare against the local timeline stripped of
  // provable double-write duplicates, so an inflated local history cannot
  // veto a clean canonical one.
  const comparisonCached = dedupeLocalHistoryForComparison(cachedEvents);

  if (hasStableSnapshotMessageBodyExpansion(cachedEvents, canonicalEvents)) {
    if (context?.sessionId && context?.roomAgentId) {
      clearReconciliationCircuit(context.sessionId, context.roomAgentId);
    }
    logEvent("kimiHistoryReconciliation.accepted", {
      ...logCtx,
      callerReason: context?.reason,
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
    if (context?.sessionId && context?.roomAgentId) {
      clearReconciliationCircuit(context.sessionId, context.roomAgentId);
    }
    logEvent("kimiHistoryReconciliation.accepted", {
      ...logCtx,
      callerReason: context?.reason,
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
    if (context?.sessionId && context?.roomAgentId) {
      clearReconciliationCircuit(context.sessionId, context.roomAgentId);
    }
    logEvent("kimiHistoryReconciliation.accepted", {
      ...logCtx,
      callerReason: context?.reason,
      reason: "cross-turn-canonical-reply-composition",
      localSize: cachedAssistantSize,
      canonicalSize: canonicalAssistantSize,
    });
    return true;
  }

  // Server snapshots can contain the newest assistant text/thinking while
  // omitting tool-call lifecycle frames. Never let such a partial snapshot
  // destructively replace a richer live/local process timeline.
  const repairsDuplicateToolHistory = hasRepairableDuplicateKimiToolHistory(cachedEvents, canonicalEvents);
  if (hasKimiProcessHistoryRegression(comparisonCached, canonicalEvents) && !repairsDuplicateToolHistory) {
    if (context?.sessionId && context?.roomAgentId) {
      markReconciliationRejected(context.sessionId, context.roomAgentId, cachedEvents, context.rawCanonicalEvents ?? canonicalEvents);
    }
    logEvent("kimiHistoryReconciliation.rejected", {
      ...logCtx,
      callerReason: context?.reason,
      reason: "process-history-regression",
      localProcessEvents: kimiHistoryProcessEventCount(comparisonCached),
      canonicalProcessEvents: kimiHistoryProcessEventCount(canonicalEvents),
    });
    return false;
  }

  const canonicalAssistantBody = assistantBodyText(canonicalEvents);
  const cachedAssistantBody = assistantBodyText(cachedEvents);
  const canonicalThinkingSize = thinkingHistorySize(canonicalEvents);
  const cachedThinkingSize = thinkingHistorySize(comparisonCached);
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
    if (context?.sessionId && context?.roomAgentId) {
      markReconciliationRejected(context.sessionId, context.roomAgentId, cachedEvents, context.rawCanonicalEvents ?? canonicalEvents);
    }
    logEvent("kimiHistoryReconciliation.rejected", {
      ...logCtx,
      callerReason: context?.reason,
      ...regression,
    });
    return false;
  }

  const shouldReplace = canonicalAssistantSize > cachedAssistantSize ||
    canonicalImageCount > cachedImageCount ||
    (hasMalformedAssistantMarkdown(cachedEvents) && !hasMalformedAssistantMarkdown(canonicalEvents)) ||
    (Boolean(canonicalAssistantBody) && canonicalAssistantBody !== cachedAssistantBody && canonicalAssistantSize >= cachedAssistantSize) ||
    (hasLegacyKimiClarificationWrapper(cachedEvents) && !hasLegacyKimiClarificationWrapper(canonicalEvents)) ||
    repairsDuplicateToolHistory ||
    hasRicherKimiProcessHistory(cachedEvents, canonicalEvents) ||
    hasCanonicalKimiThinkingHistory(cachedEvents, canonicalEvents);

  if (shouldReplace) {
    if (context?.sessionId && context?.roomAgentId) {
      clearReconciliationCircuit(context.sessionId, context.roomAgentId);
    }
    logEvent("kimiHistoryReconciliation.accepted", {
      ...logCtx,
      callerReason: context?.reason,
      localSize: cachedAssistantSize,
      canonicalSize: canonicalAssistantSize,
    });
  }

  return shouldReplace;
}

/**
 * Usage/model footer statuses are additive metadata, not shrinkable content.
 * When the canonical candidate is rejected to protect richer local history,
 * hydrate turn-level usage statuses the local timeline never received
 * (transient live-frame loss) from the wire-backed canonical candidate.
 * Identity dedup keeps an already-present live status for the same turn.
 */
export function mergeMissingUsageStatusEvents(
  baseEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
): TimelineEvent[] {
  const isUsageStatus = (event: TimelineEvent): event is Extract<TimelineEvent, { type: "status_update" }> => {
    if (event.type !== "status_update") return false;
    if (typeof event.tokenCount === "number" && event.tokenCount > 0) return true;
    if (typeof event.inputTokenCount === "number" && event.inputTokenCount > 0) return true;
    return typeof event.message === "string" && event.message.startsWith("模型：");
  };
  const identityOf = (event: Extract<TimelineEvent, { type: "status_update" }>) => (
    `${event.message ?? ""}:${event.tokenCount ?? -1}:${event.inputTokenCount ?? -1}`
  );
  const candidates = canonicalEvents.filter(isUsageStatus);
  if (candidates.length === 0) return backfillTurnModelsFromUsageStatuses(baseEvents);
  const known = new Set(baseEvents.filter(isUsageStatus).map(identityOf));
  const missing = candidates.filter((event) => !known.has(identityOf(event)));
  if (missing.length === 0) return backfillTurnModelsFromUsageStatuses(baseEvents);
  const merged = [...baseEvents];
  for (const status of missing) {
    known.add(identityOf(status));
    if (status.usageScope === "session") {
      const compactionEndIndex = merged.findLastIndex((event) => (
        event.type === "compaction" &&
        event.phase === "end" &&
        event.outcome !== "cancelled" &&
        event.timestamp >= status.timestamp
      ));
      if (compactionEndIndex >= 0) {
        merged.splice(compactionEndIndex + 1, 0, status);
        continue;
      }
    }
    let index = merged.length;
    while (index > 0 && merged[index - 1].timestamp > status.timestamp) index -= 1;
    merged.splice(index, 0, status);
  }
  return backfillTurnModelsFromUsageStatuses(merged);
}

/**
 * Stamp each turn's official turn-scoped model (usage.record.model, carried by
 * usage status messages) onto assistant events that lack one. Historical
 * headers and footers then agree on the model that actually produced the turn.
 */
export function backfillTurnModelsFromUsageStatuses(events: TimelineEvent[]): TimelineEvent[] {
  type AssistantEvent = Extract<TimelineEvent, { type: "assistant_message" }>;
  const result = [...events];
  let dirty = false;
  let pendingAssistants: number[] = [];
  let turnModel: string | null = null;
  const flushTurn = () => {
    if (turnModel && pendingAssistants.length > 0) {
      for (const index of pendingAssistants) {
        const event = result[index] as AssistantEvent;
        result[index] = { ...event, model: turnModel };
        dirty = true;
      }
    }
    pendingAssistants = [];
    turnModel = null;
  };
  for (let index = 0; index < result.length; index += 1) {
    const event = result[index];
    if (event.type === "user_message") {
      flushTurn();
      continue;
    }
    if (event.type === "assistant_message") {
      if (!(typeof event.model === "string" && event.model.trim())) pendingAssistants.push(index);
      continue;
    }
    if (event.type === "status_update") {
      const model = extractModelFromStatusMessage(event.message);
      if (model) turnModel = model;
    }
  }
  flushTurn();
  return dirty ? result : events;
}
/**
 * Live 路径的 backfillTurnModelsFromUsageStatuses 孪生：host 的权威当轮模型信号
 *（kimix.turn.model：dispatch 时为本地注入的本轮模型，settle 时为 server 实际模型）
 * 盖到最后一条用户边界之后、尚无模型的 assistant 上，让消息头徽标与底部信息
 * 立即显示模型，不必等切会话触发的历史对账。只填空，不覆盖官方 per-turn 模型。
 */
export function stampCurrentTurnModel(events: TimelineEvent[], model: string | undefined, options?: { requireTurnContent?: boolean }): TimelineEvent[] {
  const trimmed = typeof model === "string" ? model.trim() : "";
  if (!trimmed) return events;
  if (options?.requireTurnContent) {
    // settle 信号迟到且用户已发下一轮时，扫描目标是新一轮的占位 assistant（无正文、
    // 未完成）——把旧轮模型盖上去是错误的，且 fill-empty 会挡住新一轮自己的 dispatch
    // 盖章。settle 路径要求目标轮已有正文或完成态证据；dispatch 路径不需要。
    let hasTurnEvidence = false;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.type === "user_message") break;
      if (event.type === "assistant_message" && (event.isComplete || event.content.trim())) {
        hasTurnEvidence = true;
        break;
      }
    }
    if (!hasTurnEvidence) return events;
  }
  const result = [...events];
  let dirty = false;
  for (let index = result.length - 1; index >= 0; index -= 1) {
    const event = result[index];
    if (event.type === "user_message") break;
    if (event.type === "assistant_message" && !(typeof event.model === "string" && event.model.trim())) {
      result[index] = { ...event, model: trimmed };
      dirty = true;
    }
  }
  return dirty ? result : events;
}


