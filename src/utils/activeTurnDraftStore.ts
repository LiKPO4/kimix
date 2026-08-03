import { useSyncExternalStore } from "react";
import type { TimelineEvent } from "@/types/ui";
import { mergeAssistantThinkingParts, mergeAssistantThinkingText, mergeEvents } from "@/utils/eventMapper";
import { isScrollYieldEnabled } from "@/utils/perfFlags";
import { isUserScrollActive } from "@/utils/userScrollActivity";

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
// Server offsets are cumulative for the whole Agent turn, while `drafts`
// contains only the currently visible segment and is committed at tool/status
// boundaries. Keep the protocol cursor independent from that transient draft
// so replayed tails after a boundary are still recognized as duplicates.
const streamAnchors = new Map<string, StreamAnchors>();
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
 * 0.29 Server 的 volatile delta 携带累计 offset（协议：offset < 本地长度=重复，
 * 跳过；offset > 本地长度=中间缺帧）。对齐官方 web 的 turnLen 锚定模型：
 * offset===0 在当前视觉段仍挂载时视为流（重）起点，以新流替换；
 * 视觉段已提交但 turn anchor 仍存在时则是旧前缀回放，必须跳过；
 * offset===锚点 顺序追加；offset<锚点 跳过重复尾部；
 * offset>锚点 说明缺帧；残片不能安全拼接，等待权威快照/offset 0 自愈。
 * 无锚点且本地段为空时允许从非零 offset 接续：权威快照可能已经承载前文。
 */
function anchorStreamText(
  acc: string,
  delta: string,
  offset: number,
  anchor: StreamAnchor,
): { text: string; anchor: StreamAnchor; accepted: boolean } {
  if (offset === 0) {
    // While a visual segment is mounted, offset 0 means the Server restarted
    // that live stream and the replacement must win. After the segment has
    // already been committed, however, the turn-global anchor remains while
    // `acc` is empty: offset 0 is then a reconnect/resync replay of the old
    // turn prefix. Accepting it would create a fresh materialization at every
    // tool boundary (the same status/thought rendered many times).
    return !acc && anchor !== null
      ? { text: acc, anchor, accepted: false }
      : { text: delta, anchor: delta.length, accepted: true };
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
): { event: AssistantMessage; contentAnchor: StreamAnchor; thinkAnchor: StreamAnchor; accepted: boolean } {
  const offset = event.streamOffset as number;
  if (event.thinking && !event.content) {
    const merged = anchorStreamText(
      base.thinking ?? "",
      event.thinking,
      offset,
      anchors.think,
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
  const merged = anchorStreamText(base.content, event.content ?? "", offset, anchors.content);
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
    const applied = applyStreamOffsetDelta(base, event, { content: contentAnchor, think: thinkAnchor });
    contentAnchor = applied.contentAnchor;
    thinkAnchor = applied.thinkAnchor;
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
  // Do not clear streamAnchors: `take` commits only the current visual segment.
  // The Server offset remains turn-global across later tool/model steps.
  notify(key);
  return draft;
}

export function clearActiveTurnDraft(key: string): void {
  // An authoritative snapshot/body becomes the new formal baseline. Its
  // per-message body cannot reconstruct the Server's whole-turn offset, so let
  // the next live frame seed a fresh cursor (including a non-zero resume).
  streamAnchors.delete(key);
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
  listeners.clear();
  globalListeners.clear();
  pendingNotifyKeys.clear();
  if (notifyTimer !== null) {
    if (notifyTimerIsRaf && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(notifyTimer as number);
    else clearTimeout(notifyTimer as ReturnType<typeof setTimeout>);
    notifyTimer = null;
  }
}
