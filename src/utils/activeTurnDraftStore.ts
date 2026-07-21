import { useSyncExternalStore } from "react";
import type { TimelineEvent } from "@/types/ui";
import { mergeEvents } from "@/utils/eventMapper";
import { isScrollYieldEnabled } from "@/utils/perfFlags";
import { isUserScrollActive } from "@/utils/userScrollActivity";

type AssistantMessage = Extract<TimelineEvent, { type: "assistant_message" }>;

export type ActiveTurnDraft = {
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
};

type DraftListener = () => void;

const drafts = new Map<string, ActiveTurnDraft>();
const listeners = new Map<string, Set<DraftListener>>();
const globalListeners = new Set<DraftListener>();

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
// Cap the streaming text cadence at 10fps even when idle: every notification
// re-renders the growing bubble and re-shapes its text; 60fps typewriter
// updates cost far more layout time than they are worth.
const STREAMING_NOTIFY_MS = 100;
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
  notifyTimerIsRaf = false;
  const useScrollThrottle = isScrollYieldEnabled() && isUserScrollActive();
  notifyTimer = setTimeout(flushPendingNotifications, useScrollThrottle ? SCROLLING_NOTIFY_MS : STREAMING_NOTIFY_MS);
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
    id: `active-draft:${key}`,
    type: "assistant_message",
    timestamp: draft.timestamp,
    content: draft.content,
    thinking: draft.thinking,
    thinkingParts: draft.thinkingParts,
    isThinking: Boolean(draft.thinking?.trim() || draft.thinkingParts?.some((part) => part.text.trim())),
    isComplete: false,
    roomAgentId: draft.roomAgentId ?? parsed?.roomAgentId,
    roomMessageId: draft.roomMessageId,
    agentTurnId: draft.agentTurnId ?? parsed?.agentTurnId,
    model: draft.model,
    agentRole: draft.agentRole,
  };
}

export function applyActiveTurnDraftDelta(
  key: string,
  event: AssistantMessage,
): ActiveTurnDraft {
  const previous = drafts.get(key);
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

  // Deltas routed here are append-only text/thinking fragments (snapshot and
  // barrier frames stay on the formal path upstream), so accumulate directly
  // instead of running the full merge machinery per token. Snapshot-bearing
  // events fall back to mergeEvents for safety.
  const isAppendOnlyDelta = !event.snapshotMessageId && !event.snapshotMessageIdStable;
  const merged = isAppendOnlyDelta
    ? [{
        ...base,
        content: base.content + (event.content ?? ""),
        thinking: event.thinking ? (base.thinking ?? "") + event.thinking : base.thinking,
        thinkingParts: event.thinkingParts
          ? [...(base.thinkingParts ?? []), ...event.thinkingParts]
          : base.thinkingParts,
        model: event.model ?? base.model,
        agentRole: event.agentRole ?? base.agentRole,
      }]
    : mergeEvents([base], {
        ...event,
        isComplete: false,
      });
  const nextEvent = merged.find((item): item is AssistantMessage => item.type === "assistant_message") ?? base;
  const next: ActiveTurnDraft = {
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
  };
  drafts.set(key, next);
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
  notify(key);
  return draft;
}

export function clearActiveTurnDraft(key: string): void {
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
  return draft.length >= event.length ? draft : event;
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
  listeners.clear();
  globalListeners.clear();
  pendingNotifyKeys.clear();
  if (notifyTimer !== null) {
    if (notifyTimerIsRaf && typeof cancelAnimationFrame !== "undefined") cancelAnimationFrame(notifyTimer as number);
    else clearTimeout(notifyTimer as ReturnType<typeof setTimeout>);
    notifyTimer = null;
  }
}
