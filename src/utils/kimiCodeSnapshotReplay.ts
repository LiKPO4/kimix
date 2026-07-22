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

type AssistantEvent = Extract<TimelineEvent, { type: "assistant_message" }>;

function snapshotTimestamp(rawEvent: Record<string, unknown>): number | undefined {
  const value = rawEvent.created_at ?? rawEvent.createdAt ?? rawEvent.timestamp ?? rawEvent.time;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!isString(value) || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function userTurnAnchor(events: readonly TimelineEvent[], timestamp: number): number | undefined {
  let anchor: number | undefined;
  for (const event of events) {
    if (event.type !== "user_message" || event.timestamp > timestamp) continue;
    if (anchor === undefined || event.timestamp > anchor) anchor = event.timestamp;
  }
  return anchor;
}

function sharesUserTurn(
  events: readonly TimelineEvent[],
  leftTimestamp: number,
  rightTimestamp: number,
): boolean {
  const leftAnchor = userTurnAnchor(events, leftTimestamp);
  const rightAnchor = userTurnAnchor(events, rightTimestamp);
  return leftAnchor !== undefined && leftAnchor === rightAnchor;
}

function snapshotMessageIdFromEvent(event: AssistantEvent): string | undefined {
  if (event.snapshotMessageId) return event.snapshotMessageId;
  const match = /^snapshot:(.+):assistant:\d+$/.exec(event.id);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

function assistantContainsSnapshotText(event: AssistantEvent, text: string): boolean {
  const content = normalizeText([event.thinking, event.content].filter(isString).join("\n"));
  return content.includes(text);
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
  runtimeActive = false,
): boolean {
  if (rawEvent?.snapshotReplay !== "history") return false;
  const rawType = isString(rawEvent.type) ? rawEvent.type : "";
  const localPromptPending = runtimeActive || hasPendingLocalPromptPlaceholder(events);
  if (localPromptPending) {
    const latestUserTimestamp = events.reduce<number | undefined>((latest, event) => (
      event.type === "user_message" && (latest === undefined || event.timestamp > latest)
        ? event.timestamp
        : latest
    ), undefined);
    const replayTimestamp = snapshotTimestamp(rawEvent);
    // recoverSnapshot emits the complete official history before the live
    // in-flight frames. During retry/reconnect, those older frames arrive in a
    // burst after the new optimistic user row. Appending them by arrival order
    // assigns historical tools/body chunks to the active turn. Historical
    // hydration is handled by canonical reconciliation; the live path may only
    // consume history at/after the current user boundary. A history frame with
    // no timestamp cannot prove that ownership and is therefore also rejected.
    if (
      latestUserTimestamp !== undefined &&
      (replayTimestamp === undefined || replayTimestamp < latestUserTimestamp)
    ) {
      return true;
    }
  }
  if (
    (rawType === "turn.ended" || rawType === "TurnEnd") &&
    localPromptPending
  ) {
    const messageId = isString(rawEvent.snapshotMessageId) && rawEvent.snapshotMessageId
      ? rawEvent.snapshotMessageId
      : undefined;
    const messageIdStable = rawEvent.snapshotMessageIdStable === true;
    const latestOpenAssistantIndex = events.findLastIndex((event) => (
      event.type === "assistant_message" && !event.isComplete
    ));
    const matchingAssistantIndex = messageId && messageIdStable
      ? events.findLastIndex((event) => (
        event.type === "assistant_message" &&
        event.snapshotMessageIdStable === true &&
        snapshotMessageIdFromEvent(event) === messageId
      ))
      : -1;
    // A replayed terminal for an older identified message is authoritative for
    // that message and must not be mistaken for the live turn's terminal.
    if (matchingAssistantIndex !== -1 && matchingAssistantIndex !== latestOpenAssistantIndex) {
      return false;
    }
    const timestamp = snapshotTimestamp(rawEvent);
    const latestUserTimestamp = events.reduce<number | undefined>((latest, event) => (
      event.type === "user_message" && (latest === undefined || event.timestamp > latest)
        ? event.timestamp
        : latest
    ), undefined);
    if (timestamp !== undefined && latestUserTimestamp !== undefined && timestamp < latestUserTimestamp) {
      return false;
    }
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

  const assistants = events.filter((event): event is AssistantEvent => event.type === "assistant_message");
  const messageId = isString(rawEvent.snapshotMessageId) && rawEvent.snapshotMessageId
    ? rawEvent.snapshotMessageId
    : undefined;
  const messageIdStable = rawEvent.snapshotMessageIdStable === true;
  const timestamp = snapshotTimestamp(rawEvent);
  const identityMatches = messageId && messageIdStable
    ? assistants.filter((event) => (
      event.snapshotMessageIdStable === true && snapshotMessageIdFromEvent(event) === messageId
    ))
    : [];
  if (identityMatches.some((event) => (
    (timestamp === undefined ||
      userTurnAnchor(events, timestamp) === undefined ||
      sharesUserTurn(events, event.timestamp, timestamp)) &&
    assistantContainsSnapshotText(event, text)
  ))) return true;

  // Old persisted rows do not carry snapshotMessageId. Their fallback is
  // intentionally limited to the user-bounded turn selected by the official
  // message timestamp; global substring matching can delete a later real turn.
  if (timestamp === undefined || userTurnAnchor(events, timestamp) === undefined) return false;
  return assistants.some((event) => (
    sharesUserTurn(events, event.timestamp, timestamp) &&
    assistantContainsSnapshotText(event, text)
  ));
}

function interleaveReplayEventsWithoutReorderingLocal(
  localEvents: readonly TimelineEvent[],
  mergedEvents: readonly TimelineEvent[],
): TimelineEvent[] {
  const remainingLocalIds = new Map<string, number>();
  for (const event of localEvents) {
    remainingLocalIds.set(event.id, (remainingLocalIds.get(event.id) ?? 0) + 1);
  }
  const result: TimelineEvent[] = [];
  const replayEvents: TimelineEvent[] = [];
  for (const event of mergedEvents) {
    const remaining = remainingLocalIds.get(event.id) ?? 0;
    if (remaining > 0) {
      result.push(event);
      remainingLocalIds.set(event.id, remaining - 1);
    } else {
      replayEvents.push(event);
    }
  }
  if (localEvents.length === 0) return [...mergedEvents];
  if (replayEvents.length === 0) return result;

  for (const event of replayEvents) {
    if (!Number.isFinite(event.timestamp)) {
      result.push(event);
      continue;
    }
    if (event.type === "user_message") {
      const nextUserIndex = result.findIndex((candidate) => (
        candidate.type === "user_message" &&
        Number.isFinite(candidate.timestamp) &&
        candidate.timestamp > event.timestamp
      ));
      result.splice(nextUserIndex >= 0 ? nextUserIndex : result.length, 0, event);
      continue;
    }

    let userAnchorIndex = -1;
    let userAnchorTimestamp = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < result.length; index += 1) {
      const candidate = result[index];
      if (
        candidate.type === "user_message" &&
        Number.isFinite(candidate.timestamp) &&
        candidate.timestamp <= event.timestamp &&
        candidate.timestamp >= userAnchorTimestamp
      ) {
        userAnchorIndex = index;
        userAnchorTimestamp = candidate.timestamp;
      }
    }
    const nextUserIndex = result.findIndex((candidate, index) => (
      index > userAnchorIndex && candidate.type === "user_message"
    ));
    const groupEnd = nextUserIndex >= 0 ? nextUserIndex : result.length;
    let insertAt = userAnchorIndex + 1;
    for (let index = insertAt; index < groupEnd; index += 1) {
      const timestamp = result[index]?.timestamp;
      if (Number.isFinite(timestamp) && timestamp <= event.timestamp) insertAt = index + 1;
    }
    result.splice(insertAt, 0, event);
  }
  return result;
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
  // Kimi Code 0.24+（agent-core-v2）会把进行中轮次已提交的内容作为 isComplete: true 的
  // 助手带回快照。只要本地还有未完成助手，当前轮次（最后一条用户消息之后）的 canonical
  // 助手一律按未完成合并：完成态只能由真实 turn 结束事件授予，否则活助手会被反复提前
  // 关闭（“输出完成”假象、过程折叠、后续工具期彻底没有消息头）。
  const lastLocalUserTs = localEvents.reduce<number | undefined>((latest, event) => {
    if (event.type !== "user_message") return latest;
    return latest === undefined ? event.timestamp : Math.max(latest, event.timestamp);
  }, undefined);
  const hasOpenLocalAssistant = localEvents.some((event) => event.type === "assistant_message" && !event.isComplete);
  const merged = snapshotEvents.reduce((events, rawEvent) => {
    const event = lastLocalUserTs !== undefined && hasOpenLocalAssistant &&
      rawEvent.type === "assistant_message" && rawEvent.isComplete && rawEvent.timestamp >= lastLocalUserTs
      ? { ...rawEvent, isComplete: false as const }
      : rawEvent;
    const alreadyMounted = events.some((local) => {
      if (local.type !== event.type) return false;
      if (local.type === "user_message" && event.type === "user_message") {
        // Snapshot user ids are deterministic (snapshot:<messageId>:user:<n>),
        // so an identical id is a hard duplicate. A local optimistic send and
        // its official snapshot echo share content within seconds. Without
        // this branch every replay re-appended the full user history — after a
        // few restarts the duplicated users flooded the render window and
        // pushed every assistant reply out of view.
        if (local.id === event.id) return true;
        const localText = normalizeText(local.content ?? "");
        const eventText = normalizeText(event.content ?? "");
        return eventText.length > 0 && localText === eventText &&
          Math.abs(local.timestamp - event.timestamp) <= 10_000;
      }
      if (local.type === "assistant_message" && event.type === "assistant_message") {
        const localSnapshotId = snapshotMessageIdFromEvent(local);
        const eventSnapshotId = snapshotMessageIdFromEvent(event);
        const sameSnapshotMessage = Boolean(
          localSnapshotId &&
          eventSnapshotId &&
          local.snapshotMessageIdStable === true &&
          event.snapshotMessageIdStable === true &&
          localSnapshotId === eventSnapshotId &&
          (
            userTurnAnchor(events, local.timestamp) === undefined ||
            userTurnAnchor(events, event.timestamp) === undefined ||
            sharesUserTurn(events, local.timestamp, event.timestamp)
          )
        );
        const sameTurn = sharesUserTurn(events, local.timestamp, event.timestamp);
        const exactLegacyTimestamp = local.timestamp === event.timestamp;
        if (!sameSnapshotMessage && !sameTurn && !exactLegacyTimestamp) return false;
        if (local.isComplete === event.isComplete &&
          local.content === event.content &&
          (local.thinking ?? "") === (event.thinking ?? "")) return true;
        // A locally complete assistant that already contains the canonical body
        // (e.g. a streamed opening followed by the same summary) must not let
        // the replay re-append the clean copy elsewhere.
        if (local.isComplete && event.isComplete && event.content.trim().length > 0 &&
          local.content.includes(event.content)) return true;
        // 内容已被本地覆盖的 canonical 助手（同文不同完成态）同样视为已挂载，跳过合并。
        if (!local.isComplete) {
          const localText = normalizeText([local.thinking ?? "", local.content].filter(Boolean).join("\n"));
          const eventText = normalizeText([event.thinking ?? "", event.content].filter(Boolean).join("\n"));
          if (eventText.length > 0 && localText.includes(eventText)) return true;
        }
        return false;
      }
      if (local.type === "tool_call" && event.type === "tool_call") {
        return Boolean(local.toolCallId) && local.toolCallId === event.toolCallId && local.status === event.status;
      }
      return false;
    });
    // Older-turn assistants must never go through mergeEvents: its streaming
    // merge would append them into the current turn's open placeholder,
    // polluting it with unrelated older content. They are appended as
    // independent history entries instead.
    if (!alreadyMounted && lastLocalUserTs !== undefined && event.type === "assistant_message" && event.timestamp < lastLocalUserTs) {
      return [...events, event];
    }
    return alreadyMounted ? events : mergeEvents(events, event);
  }, [...localEvents]);
  // Replay and runtime-sample merges append older history at the tail. Insert
  // only those newly mounted replay rows by time; never sort already-mounted
  // local rows, whose array order is the live causal order even when clocks or
  // recovered timestamps regress.
  return interleaveReplayEventsWithoutReorderingLocal(localEvents, merged);
}
