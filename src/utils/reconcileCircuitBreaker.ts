/**
 * Reconcile circuit breaker: persistent fingerprint-based suppression of
 * doomed kimi-history-reconciliation retries.
 *
 * When shouldReplaceWithCanonicalKimiHistory rejects a pair of (local,
 * canonical) event sets, registering that fingerprint here prevents the same
 * unmodified pair from being re-reconciled on the next attempt (seconds later
 * in the repair/startup/running-sample loop). When the canonical history grows
 * or changes the fingerprint shifts, the circuit closes again and allows one
 * retry. An accepted reconciliation clears the entry so the circuit stays
 * closed for that target.
 *
 * Backed by localStorage (key kimix_reconcile_circuit_v1) with an LRU eviction
 * policy at 500 entries (~few KB).
 */
import type { TimelineEvent } from "@/types/ui";
import { kimiHistoryProcessEventCount } from "@/utils/kimiHistoryCache";

const STORAGE_KEY = "kimix_reconcile_circuit_v1";
const LRU_MAX = 500;

type CircuitEntry = {
  fingerprint: string;
  rejectedAt: number;
};

type CircuitData = Record<string, CircuitEntry>;

/**
 * Inline duplicate of kimiHistoryReconciliation.flattenTimelineEvents to avoid
 * a circular import (kimiHistoryReconciliation already imports from here).
 */
function flattenTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  const result: TimelineEvent[] = [];
  for (const event of events) {
    result.push(event);
    if (event.type === "subagent") {
      result.push(...flattenTimelineEvents(event.events));
    }
  }
  return result;
}

function assistantBodySize(events: TimelineEvent[]): number {
  return flattenTimelineEvents(events)
    .filter((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => event.type === "assistant_message")
    .reduce((sum, event) => sum + event.content.trim().length, 0);
}

/**
 * Derive a lightweight change-detection fingerprint from local and canonical
 * event arrays. Uses content statistics plus the identity of the very last
 * event, so any substantive change (new turn, more process frames, different
 * assistant text) flips the fingerprint.
 */
function computeFingerprint(
  localEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
): string {
  const localBodySize = assistantBodySize(localEvents);
  const localProcessCount = kimiHistoryProcessEventCount(localEvents);
  const localLast = localEvents[localEvents.length - 1];
  const localLastTs = localLast ? localLast.timestamp : 0;

  const canonicalBodySize = assistantBodySize(canonicalEvents);
  const canonicalProcessCount = kimiHistoryProcessEventCount(canonicalEvents);
  const canonicalLast = canonicalEvents[canonicalEvents.length - 1];
  const canonicalLastTs = canonicalLast ? canonicalLast.timestamp : 0;

  return `l=${localBodySize},${localProcessCount},${localLastTs}|c=${canonicalBodySize},${canonicalProcessCount},${canonicalLastTs}`;
}

function loadCircuit(): CircuitData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveCircuit(data: CircuitData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage quota exceeded; silently drop
  }
}

/**
 * Check whether the circuit is open for the given (sessionId, roomAgentId)
 * pair with the current event fingerprints. Returns true when the exact same
 * fingerprint was previously rejected and the canonical data has not changed,
 * meaning a retry would fail identically.
 */
export function isCanonicalReconciliationCircuitOpen(
  sessionId: string,
  roomAgentId: string,
  localEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
): boolean {
  const key = `${sessionId}:${roomAgentId}`;
  const fingerprint = computeFingerprint(localEvents, canonicalEvents);
  const data = loadCircuit();
  const entry = data[key];
  if (!entry) return false;
  return entry.fingerprint === fingerprint;
}

/**
 * Register a rejection: store the fingerprint so future calls with the same
 * (local, canonical) pair will skip reconciliation entirely.
 */
export function markReconciliationRejected(
  sessionId: string,
  roomAgentId: string,
  localEvents: TimelineEvent[],
  canonicalEvents: TimelineEvent[],
): void {
  const key = `${sessionId}:${roomAgentId}`;
  const fingerprint = computeFingerprint(localEvents, canonicalEvents);
  const data = loadCircuit();

  // LRU eviction when at capacity and this key is not yet present.
  const keys = Object.keys(data);
  if (keys.length >= LRU_MAX && !data[key]) {
    let oldestKey = keys[0];
    let oldestTime = data[oldestKey].rejectedAt;
    for (const k of keys) {
      if (data[k].rejectedAt < oldestTime) {
        oldestTime = data[k].rejectedAt;
        oldestKey = k;
      }
    }
    delete data[oldestKey];
  }

  data[key] = { fingerprint, rejectedAt: Date.now() };
  saveCircuit(data);
}

/**
 * Clear a circuit entry after a successful acceptance, so future state changes
 * are not blocked.
 */
export function clearReconciliationCircuit(
  sessionId: string,
  roomAgentId: string,
): void {
  const key = `${sessionId}:${roomAgentId}`;
  const data = loadCircuit();
  if (data[key]) {
    delete data[key];
    saveCircuit(data);
  }
}

/**
 * Remove all circuit entries (for testing clean-up).
 */
export function resetAllReconciliationCircuits(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore cleanup failure.
  }
}
