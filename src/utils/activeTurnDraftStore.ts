import { useSyncExternalStore } from "react";
import type { TimelineEvent } from "@/types/ui";
import { mergeAssistantThinkingParts, mergeAssistantThinkingText, mergeEvents } from "@/utils/eventMapper";
import { isScrollYieldEnabled } from "@/utils/perfFlags";
import { isUserScrollActive } from "@/utils/userScrollActivity";
import { noteStreamAnchorDecision } from "@/utils/liveTurnDiag";

type AssistantMessage = Extract<TimelineEvent, { type: "assistant_message" }>;

export type ActiveTurnDraft = {
  /** Distinguishes each persisted segment when one Agent turn crosses formal boundaries. */
  materializationId: string;
  content: string;
  thinking?: string;
  thinkingParts?: AssistantMessage["thinkingParts"];
  revision: number;
  roomAgentId?: string;
  roomMessageId?: string;
  agentTurnId?: string;
  model?: string;
  agentRole?: AssistantMessage["agentRole"];
  timestamp: number;
  /** 0.29 Server volatile delta 的流锚点（内容/思考各自的累计长度），null 表示未锚定。 */
  streamContentAnchor?: number | null;
  streamThinkAnchor?: number | null;
};

type DraftListener = () => void;

const drafts = new Map<string, ActiveTurnDraft>();
type StreamAnchors = { content: StreamAnchor; think: StreamAnchor };
// Server offsets restart at 0 for EACH step and accumulate only within that
// step. Verified on 0.32 with 1240 unsampled `[live] anchor` rows: splitting
// at offset 0 yields per-step blocks that are each strictly monotonic
// (think 0..2339, then 0..259, then 0..3493 ...). The older note here claimed
// one cumulative cursor for the whole Agent turn; that was wrong and made
// `takeActiveTurnDraft` keep a stale anchor across step boundaries, which in
// turn made every new step's opening offset-0 delta look exactly like a
// reconnect replay. The anchor then froze and rejected the rest of the step
// (measured: 814/932 thinking and 146/308 body deltas dropped).
const streamAnchors = new Map<string, StreamAnchors>();
// Text of the segment most recently committed for a key. A reconnect/resync
// replay re-sends an already-committed prefix at offset 0, which is otherwise
// byte-identical to a new step opening; comparing against this text is the
// only way to tell them apart. Rejecting a suspected replay deliberately
// leaves the anchor null, so a genuine new step whose first delta happens to
// match the committed prefix (replies here often open with the same words)
// loses just that delta and resumes on the next one, instead of freezing.
const committedSegments = new Map<string, { content: string; think: string }>();
const listeners = new Map<string, Set<DraftListener>>();
const globalListeners = new Set<DraftListener>();

function createMaterializationId(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function notify(key: string) {
  const keyed = listeners.get(key);
  if (keyed) {
    for (const listener of keyed) listener();
  }
  for (const listener of globalListeners) listener();
}

/**
 * Stream deltas can arrive at token frequency; waking React per delta saturates
 * the main thread (whole-bubble re-render + full-content markdown work per
 * event). Notifications are coalesced to at most one per animation frame, and
 * to a slower timer while the user is actively scrolling (scroll-yield).
 * Commit paths (take/clear) flush synchronously so no update is ever lost.
 */
const SCROLLING_NOTIFY_MS = 250;
const pendingNotifyKeys = new Set<string>();
let notifyTimer: ReturnType<typeof setTimeout> | number | null = null;
let notifyTimerIsRaf = false;

function flushPendingNotifications() {
  if (notifyTimer !== null) {
    if (notifyTimerIsRaf && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(notifyTimer as number);
    else clearTimeout(notifyTimer as ReturnType<typeof setTimeout>);
    notifyTimer = null;
  }
  const keys = [...pendingNotifyKeys];
  pendingNotifyKeys.clear();
  for (const key of keys) notify(key);
}

function scheduleNotify(key: string) {
  pendingNotifyKeys.add(key);
  if (notifyTimer !== null) return;
  const useScrollThrottle = isScrollYieldEnabled() && isUserScrollActive();
  if (useScrollThrottle) {
    notifyTimerIsRaf = false;
    notifyTimer = setTimeout(flushPendingNotifications, SCROLLING_NOTIFY_MS);
    return;
  }
  // Match the official web client: publish every received content revision on
  // the next paint instead of holding it in a fixed 100 ms bucket. Coalescing
  // within one animation frame still prevents redundant same-frame renders.
  if (typeof requestAnimationFrame !== "undefined") {
    notifyTimerIsRaf = true;
    notifyTimer = requestAnimationFrame(flushPendingNotifications);
    return;
  }
  notifyTimerIsRaf = false;
  notifyTimer = setTimeout(flushPendingNotifications, 0);
}

export function makeActiveTurnDraftKey(
  sessionId: string,
  roomAgentId: string | undefined,
  agentTurnId: string,
): string {
  return `${sessionId}\u0000${roomAgentId ?? ""}\u0000${agentTurnId}`;
}

export function parseActiveTurnDraftKey(key: string): {
  sessionId: string;
  roomAgentId: string;
  agentTurnId: string;
} | null {
  const parts = key.split("\u0000");
  if (parts.length !== 3 || !parts[0] || !parts[2]) return null;
  return { sessionId: parts[0], roomAgentId: parts[1], agentTurnId: parts[2] };
}

export function getActiveTurnDraft(key: string): ActiveTurnDraft | null {
  return drafts.get(key) ?? null;
}

export function subscribeActiveTurnDraft(key: string, listener: DraftListener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) listeners.delete(key);
  };
}

export function subscribeAllActiveTurnDrafts(listener: DraftListener): () => void {
  globalListeners.add(listener);
  return () => {
    globalListeners.delete(listener);
  };
}

function toAssistantShell(draft: ActiveTurnDraft, key: string): AssistantMessage {
  const parsed = parseActiveTurnDraftKey(key);
  return {
    id: `active-draft:${key}:${draft.materializationId}`,
    type: "assistant_message",
    timestamp: draft.timestamp,
    content: draft.content,
    thinking: draft.thinking,
    thinkingParts: draft.thinkingParts,
    // 正文与思考混合时以正文为准：draft 同时累积 thinking.delta 与
    // assistant.delta 时（模型先思考后输出正文的同一段流），有 content 就
    // 是正式回复，不能再标 thinking——否则消费 isThinking 的路径（如
    // 复制/导出/统计/状态标签）会把完整正文当思考内容处理。
    isThinking: !draft.content?.trim() && Boolean(draft.thinking?.trim() || draft.thinkingParts?.some((part) => part.text.trim())),
    isComplete: false,
    roomAgentId: draft.roomAgentId ?? parsed?.roomAgentId,
    roomMessageId: draft.roomMessageId,
    agentTurnId: draft.agentTurnId ?? parsed?.agentTurnId,
    model: draft.model,
    agentRole: draft.agentRole,
  };
}

/**
 * Merge streaming text fragments without doubling cumulative frames.
 * Only treats clear prefix/suffix relationships as non-delta; pure token
 * fragments (e.g. "Hel" + "lo") must stay simple concatenation — fuzzy
 * character overlap would corrupt them ("Helo").
 */
export function appendStreamingText(existing: string, incoming: string): string {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (incoming === existing) return existing;
  // Cumulative content.part / restated frames: incoming already contains prior text.
  if (incoming.startsWith(existing)) return incoming;
  if (existing.startsWith(incoming)) return existing;
  // Exact repeated suffix (re-sent same tail).
  if (existing.endsWith(incoming)) return existing;
  return existing + incoming;
}

type StreamAnchor = number | null;

/**
 * 0.29+ Server volatile delta carries a character `offset` that restarts at 0
 * for each step and accumulates within that step (see the streamAnchors note).
 * offset === 0 therefore opens a new stream for the current visual segment and
 * replaces whatever that segment holds; offset === anchor appends in order;
 * offset < anchor skips an already-seen tail; offset > anchor means a gap, and a
 * fragment cannot be spliced safely, so it waits for an authoritative snapshot
 * or the next offset 0. With no anchor and an empty segment we may resume from a
 * non-zero offset, because a snapshot may already carry the prefix.
 *
 * The retired `!acc && anchor !== null -> reject` rule tried to spot a
 * reconnect/resync replay of an already-committed prefix. It cannot: after a
 * boundary commit the state is byte-identical to a new step opening, so it
 * rejected real output instead. Anchors are now dropped at commit, so a
 * committed segment leaves no anchor for offset 0 to trip over.
 */
function anchorStreamText(
  acc: string,
  delta: string,
  offset: number,
  anchor: StreamAnchor,
  committedText?: string,
): { text: string; anchor: StreamAnchor; accepted: boolean } {
  if (offset === 0) {
    // Offsets are per-step: 0 opens this step's stream, so the delta becomes
    // the segment's new text. A boundary commit drops the anchor
    // (takeActiveTurnDraft), and a rejected delta can also leave an anchor
    // behind with no draft; in both states an empty accumulator plus a live
    // anchor is a genuine step opening, not a replay, so it must be accepted.
    // The previous `!acc && anchor !== null -> reject` rule aimed at a
    // reconnect replay of an already-committed prefix but could not tell the
    // two apart, and rejected real output instead: the anchor then froze and
    // the whole step was dropped (measured 814/932 thinking, 146/308 body).
    if (!acc && delta && committedText && committedText.startsWith(delta)) {
      // Replay of the prefix we already committed. Keep the anchor null so a
      // false positive costs one delta and self-heals on the next frame.
      return { text: acc, anchor: null, accepted: false };
    }
    return { text: delta, anchor: delta.length, accepted: true };
  }
  if (anchor === null) {
    return acc
      ? { text: acc, anchor: null, accepted: false }
      : { text: delta, anchor: offset + delta.length, accepted: true };
  }
  if (offset === anchor) return { text: acc + delta, anchor: anchor + delta.length, accepted: true };
  if (offset < anchor) return { text: acc, anchor, accepted: false };
  return { text: acc, anchor, accepted: false };
}

function applyStreamOffsetDelta(
  base: AssistantMessage,
  event: AssistantMessage,
  anchors: { content: StreamAnchor; think: StreamAnchor },
  committed?: { content: string; think: string },
): { event: AssistantMessage; contentAnchor: StreamAnchor; thinkAnchor: StreamAnchor; accepted: boolean } {
  const offset = event.streamOffset as number;
  if (event.thinking && !event.content) {
    const merged = anchorStreamText(
      base.thinking ?? "",
      event.thinking,
      offset,
      anchors.think,
      committed?.think,
    );
    const anchored = merged.anchor !== null;
    const basePart = base.thinkingParts?.[0];
    const deltaPart = event.thinkingParts?.[0];
    return {
      event: {
        ...base,
        thinking: merged.text || undefined,
        thinkingParts: merged.text
          ? anchored
            ? [{
                id: basePart?.id ?? deltaPart?.id ?? event.id,
                timestamp: basePart?.timestamp ?? event.timestamp,
                text: merged.text,
                signature: deltaPart?.signature ?? basePart?.signature,
              }]
            : mergeAssistantThinkingParts(base.thinkingParts, event.thinkingParts)
          : base.thinkingParts,
        model: event.model ?? base.model,
        agentRole: event.agentRole ?? base.agentRole,
      },
      contentAnchor: anchors.content,
      thinkAnchor: merged.anchor,
      accepted: merged.accepted,
    };
  }
  const merged = anchorStreamText(base.content, event.content ?? "", offset, anchors.content, committed?.content);
  return {
    event: {
      ...base,
      content: merged.text,
      thinking: merged.anchor !== null ? base.thinking : mergeAssistantThinkingText(base.thinking, event.thinking),
      thinkingParts: merged.anchor !== null ? base.thinkingParts : mergeAssistantThinkingParts(base.thinkingParts, event.thinkingParts),
      model: event.model ?? base.model,
      agentRole: event.agentRole ?? base.agentRole,
    },
    contentAnchor: merged.anchor,
    thinkAnchor: anchors.think,
    accepted: merged.accepted,
  };
}

export function applyActiveTurnDraftDelta(
  key: string,
  event: AssistantMessage,
): ActiveTurnDraft | null {
  let previous = drafts.get(key);
  let migratedFromKey: string | null = null;
  if (!previous && event.roomMessageId) {
    const target = parseActiveTurnDraftKey(key);
    const compatible = target
      ? [...drafts.entries()].find(([candidateKey, draft]) => {
          const candidate = parseActiveTurnDraftKey(candidateKey);
          return candidate?.sessionId === target.sessionId &&
            candidate.roomAgentId === target.roomAgentId &&
            draft.roomMessageId === event.roomMessageId;
        })
      : undefined;
    if (compatible) {
      const [previousKey, previousDraft] = compatible;
      previous = previousDraft;
      drafts.delete(previousKey);
      const previousAnchors = streamAnchors.get(previousKey);
      if (previousAnchors) {
        streamAnchors.delete(previousKey);
        streamAnchors.set(key, previousAnchors);
      }
      pendingNotifyKeys.delete(previousKey);
      // A local optimistic turn id can be replaced by the official id after
      // the first token. Move the same room-message draft instead of leaving
      // two buffers that later commit in a different order.
      migratedFromKey = previousKey;
    }
  }
  const base: AssistantMessage = previous
    ? toAssistantShell(previous, key)
    : {
        id: event.id || `active-draft:${key}`,
        type: "assistant_message",
        timestamp: event.timestamp,
        content: "",
        thinking: undefined,
        thinkingParts: undefined,
        isThinking: false,
        isComplete: false,
        roomAgentId: event.roomAgentId,
        roomMessageId: event.roomMessageId,
        agentTurnId: event.agentTurnId,
        model: event.model,
        agentRole: event.agentRole,
        dispatchAttemptId: event.dispatchAttemptId,
        agentId: event.agentId,
      };

  // Deltas routed here are live text/thinking fragments (snapshot and barrier
  // frames stay on the formal path upstream). Prefer O(fragment) accumulation
  // with overlap-safe merge; snapshot-bearing events fall back to mergeEvents.
  // 0.29 Server volatile delta 带累计 offset 时按官方 turnLen 模型锚定装配，
  // 否则沿用原有顺序拼接与幂等合并（快照回放替换、思考超集取代）。
  const isAppendOnlyDelta = !event.snapshotMessageId && !event.snapshotMessageIdStable;
  const persistedAnchors = streamAnchors.get(key);
  let contentAnchor: StreamAnchor = persistedAnchors?.content ?? previous?.streamContentAnchor ?? null;
  let thinkAnchor: StreamAnchor = persistedAnchors?.think ?? previous?.streamThinkAnchor ?? null;
  let merged: TimelineEvent[];
  if (isAppendOnlyDelta && typeof event.streamOffset === "number") {
    const isThinkDelta = Boolean(event.thinking) && !event.content;
    const anchorBefore = isThinkDelta ? thinkAnchor : contentAnchor;
    const accBefore = (isThinkDelta ? base.thinking ?? "" : base.content).length;
    const applied = applyStreamOffsetDelta(base, event, { content: contentAnchor, think: thinkAnchor }, committedSegments.get(key));
    contentAnchor = applied.contentAnchor;
    thinkAnchor = applied.thinkAnchor;
    noteStreamAnchorDecision({
      key,
      kind: isThinkDelta ? "think" : "body",
      offset: event.streamOffset,
      deltaLen: (isThinkDelta ? event.thinking ?? "" : event.content ?? "").length,
      accLen: accBefore,
      anchorBefore,
      anchorAfter: isThinkDelta ? thinkAnchor : contentAnchor,
      accepted: applied.accepted,
    });
    streamAnchors.set(key, { content: contentAnchor, think: thinkAnchor });
    if (!applied.accepted) {
      if (previous) {
        drafts.set(key, previous);
        if (migratedFromKey) notify(migratedFromKey);
        scheduleNotify(key);
      }
      return previous ?? null;
    }
    merged = [applied.event];
  } else {
    merged = isAppendOnlyDelta
      ? [{
          ...base,
          content: appendStreamingText(base.content, event.content ?? ""),
          thinking: mergeAssistantThinkingText(base.thinking, event.thinking),
          thinkingParts: mergeAssistantThinkingParts(base.thinkingParts, event.thinkingParts),
          model: event.model ?? base.model,
          agentRole: event.agentRole ?? base.agentRole,
        }]
      : mergeEvents([base], {
          ...event,
          isComplete: false,
        });
  }
  const nextEvent = merged.find((item): item is AssistantMessage => item.type === "assistant_message") ?? base;
  const next: ActiveTurnDraft = {
    materializationId: previous?.materializationId ?? createMaterializationId(),
    content: nextEvent.content,
    thinking: nextEvent.thinking,
    thinkingParts: nextEvent.thinkingParts,
    revision: (previous?.revision ?? 0) + 1,
    roomAgentId: event.roomAgentId ?? previous?.roomAgentId,
    roomMessageId: event.roomMessageId ?? previous?.roomMessageId,
    agentTurnId: event.agentTurnId ?? previous?.agentTurnId,
    model: event.model ?? previous?.model,
    agentRole: event.agentRole ?? previous?.agentRole,
    timestamp: previous?.timestamp ?? event.timestamp,
    streamContentAnchor: contentAnchor,
    streamThinkAnchor: thinkAnchor,
  };
  drafts.set(key, next);
  streamAnchors.set(key, { content: contentAnchor, think: thinkAnchor });
  if (migratedFromKey) notify(migratedFromKey);
  scheduleNotify(key);
  return next;
}

export function takeActiveTurnDraft(key: string): ActiveTurnDraft | null {
  const draft = drafts.get(key) ?? null;
  if (!draft) return null;
  // Committing the draft into formal events: deliver any pending batched
  // notification synchronously so subscribers never read a stale draft.
  pendingNotifyKeys.delete(key);
  flushPendingNotifications();
  drafts.delete(key);
  // A committed visual segment ends this anchoring scope: the next step's
  // first delta arrives at offset 0 (offsets are per-step, not turn-global).
  // Keeping the anchor here made that opening delta indistinguishable from a
  // reconnect replay, so it was rejected and the anchor never advanced again.
  streamAnchors.delete(key);
  committedSegments.set(key, { content: draft.content, think: draft.thinking ?? "" });
  notify(key);
  return draft;
}

export function clearActiveTurnDraft(key: string): void {
  // An authoritative snapshot/body becomes the new formal baseline. Its
  // per-message body cannot reconstruct the Server's whole-turn offset, so let
  // the next live frame seed a fresh cursor (including a non-zero resume).
  streamAnchors.delete(key);
  committedSegments.delete(key);
  if (!drafts.has(key)) return;
  pendingNotifyKeys.delete(key);
  flushPendingNotifications();
  drafts.delete(key);
  notify(key);
}

export function clearActiveTurnDraftsForSession(sessionId: string): void {
  flushPendingNotifications();
  const prefix = `${sessionId}\u0000`;
  let changed = false;
  for (const key of [...drafts.keys()]) {
    if (!key.startsWith(prefix)) continue;
    drafts.delete(key);
    changed = true;
    notify(key);
  }
  for (const key of [...streamAnchors.keys()]) {
    if (key.startsWith(prefix)) streamAnchors.delete(key);
  }
  for (const key of [...committedSegments.keys()]) {
    if (key.startsWith(prefix)) committedSegments.delete(key);
  }
  if (changed) {
    for (const listener of globalListeners) listener();
  }
}

export function listActiveTurnDraftKeys(): string[] {
  return [...drafts.keys()];
}

export function draftToAssistantEvent(
  key: string,
  draft: ActiveTurnDraft,
): AssistantMessage {
  return toAssistantShell(draft, key);
}

export function pickDraftText(draftText: string | undefined, eventText: string | undefined): string {
  const draft = draftText ?? "";
  const event = eventText ?? "";
  if (!draft) return event;
  if (!event) return draft;
  // Prefer the longer snapshot when one is a prefix of the other (cumulative).
  if (event.startsWith(draft)) return event;
  if (draft.startsWith(event)) return draft;
  return draft.length >= event.length ? draft : event;
}

/**
 * 与 pickDraftText 对应的 thinkingParts 选择规则：draft 段数不少于正式事件时
 * 以 draft 为准（draft 累积了全部流式分片），否则回落到正式值。
 */
export function pickDraftThinkingParts(
  draftParts: AssistantMessage["thinkingParts"],
  eventParts: AssistantMessage["thinkingParts"],
): AssistantMessage["thinkingParts"] {
  if (draftParts && (draftParts.length ?? 0) >= (eventParts?.length ?? 0)) return draftParts;
  return eventParts;
}

/**
 * 流式思考叶子的纯文本来源：优先整段 thinking，缺失时由分片拼接。
 * 与 buildThinkingBlocks（段落切分 + 逐段 summarize）不同——live 渲染只需要
 * 原始全文，任何 summarize/切块都会在每帧引入 O(n) 附加计算并改变视觉。
 */
export function draftThinkingText(draft: Pick<ActiveTurnDraft, "thinking" | "thinkingParts">): string {
  const thinking = draft.thinking?.trim() ?? "";
  if (thinking) return thinking;
  return (draft.thinkingParts ?? [])
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Formal frames that already carry the authoritative body. Committing draft
 * text before these would append into the open assistant and then get a full
 * body again → duplicated greetings / doubled early paragraphs.
 */
export function isAuthoritativeAssistantBodyEvent(event: TimelineEvent): boolean {
  if (event.type !== "assistant_message") return false;
  if (!event.content?.trim()) return false;
  return Boolean(
    event.completionBarrierReplay ||
    event.snapshotMessageIdStable ||
    event.isComplete
  );
}

export function useActiveTurnDraft(key: string | null): ActiveTurnDraft | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!key) return () => {};
      return subscribeActiveTurnDraft(key, onStoreChange);
    },
    () => (key ? getActiveTurnDraft(key) : null),
    () => null,
  );
}

/** test helper */
export function resetActiveTurnDraftStoreForTests(): void {
  drafts.clear();
  streamAnchors.clear();
  committedSegments.clear();
  listeners.clear();
  globalListeners.clear();
  pendingNotifyKeys.clear();
  if (notifyTimer !== null) {
    if (notifyTimerIsRaf && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(notifyTimer as number);
    else clearTimeout(notifyTimer as ReturnType<typeof setTimeout>);
    notifyTimer = null;
  }
}
