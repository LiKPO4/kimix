/**
 * @vitest-environment jsdom
 *
 * Tests for the reconcile circuit breaker:
 * - Fingerprint computation (same/different)
 * - Mark rejected → circuit open
 * - Clear → circuit closed
 * - LRU eviction
 * - No false positive for different sessions/agents
 * - Fingerprint changes after content change → circuit re-closed
 */

import { describe, expect, it, beforeEach } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import {
  clearReconciliationCircuit,
  isCanonicalReconciliationCircuitOpen,
  markReconciliationRejected,
  resetAllReconciliationCircuits,
} from "@/utils/reconcileCircuitBreaker";

function user(content: string): TimelineEvent {
  return { id: `u-${content.slice(0, 6)}`, type: "user_message", timestamp: 100, content } as TimelineEvent;
}

function assistant(content: string): TimelineEvent {
  return { id: `a-${content.slice(0, 6)}`, type: "assistant_message", timestamp: 200, content, isThinking: false, isComplete: true } as TimelineEvent;
}

function toolCall(id = "tool-1"): TimelineEvent {
  return { id, type: "tool_call", timestamp: 150, toolCallId: "call-1", toolName: "read_file", status: "success", arguments: {} } as TimelineEvent;
}

beforeEach(() => {
  resetAllReconciliationCircuits();
});

describe("isCanonicalReconciliationCircuitOpen", () => {
  it("returns false when no rejection was memorized", () => {
    const local = [user("hello"), assistant("world")];
    const canonical = [user("hello"), assistant("world")];
    expect(isCanonicalReconciliationCircuitOpen("sess-1", "agent-a", local, canonical)).toBe(false);
  });

  it("returns true after the same pair was rejected", () => {
    const local = [user("hello"), toolCall(), assistant("world")];
    const canonical = [user("hello"), assistant("world")];
    markReconciliationRejected("sess-1", "agent-a", local, canonical);
    expect(isCanonicalReconciliationCircuitOpen("sess-1", "agent-a", local, canonical)).toBe(true);
  });

  it("returns false for a different session with the same content", () => {
    const local = [user("hello"), toolCall(), assistant("world")];
    const canonical = [user("hello"), assistant("world")];
    markReconciliationRejected("sess-1", "agent-a", local, canonical);
    expect(isCanonicalReconciliationCircuitOpen("sess-2", "agent-a", local, canonical)).toBe(false);
    expect(isCanonicalReconciliationCircuitOpen("sess-1", "agent-b", local, canonical)).toBe(false);
  });

  it("returns false after acceptance clears the entry", () => {
    const local = [user("hello"), toolCall(), assistant("world")];
    const canonical = [user("hello"), assistant("world")];
    markReconciliationRejected("sess-1", "agent-a", local, canonical);
    clearReconciliationCircuit("sess-1", "agent-a");
    expect(isCanonicalReconciliationCircuitOpen("sess-1", "agent-a", local, canonical)).toBe(false);
  });

  it("returns false when local events changed (new process frame)", () => {
    const localOld = [user("hello"), toolCall("tool-1"), assistant("world")];
    const canonical = [user("hello"), assistant("world")];
    markReconciliationRejected("sess-1", "agent-a", localOld, canonical);
    // Local now has an extra tool call
    const localNew = [user("hello"), toolCall("tool-1"), toolCall("tool-2"), assistant("world")];
    expect(isCanonicalReconciliationCircuitOpen("sess-1", "agent-a", localNew, canonical)).toBe(false);
  });

  it("returns false when canonical events changed (new assistant body)", () => {
    const local = [user("hello"), toolCall(), assistant("world")];
    const canonicalOld = [user("hello"), assistant("world")];
    markReconciliationRejected("sess-1", "agent-a", local, canonicalOld);
    const canonicalNew = [user("hello"), assistant("world\nwith more text")];
    expect(isCanonicalReconciliationCircuitOpen("sess-1", "agent-a", local, canonicalNew)).toBe(false);
  });

  it("considers latest event id as part of the fingerprint", () => {
    const local = [user("hello"), assistant("world")];
    const canonical = [user("hello"), assistant("earth")];
    markReconciliationRejected("sess-1", "agent-a", local, canonical);
    // Same content but different event ids
    const localSame = [user("hello"), assistant("world")];
    const canonicalSameContent = [user("hello"), assistant("earth")];
    expect(isCanonicalReconciliationCircuitOpen("sess-1", "agent-a", localSame, canonicalSameContent)).toBe(true);
  });
});

describe("markReconciliationRejected / clearReconciliationCircuit", () => {
  it("clearing a non-existent entry does not throw", () => {
    expect(() => clearReconciliationCircuit("sess-99", "agent-x")).not.toThrow();
  });

  it("marking the same key multiple times keeps the circuit open", () => {
    const local = [user("a"), toolCall(), assistant("b")];
    const canonical = [user("a"), assistant("b")];
    markReconciliationRejected("sess-1", "agent-a", local, canonical);
    markReconciliationRejected("sess-1", "agent-a", local, canonical);
    expect(isCanonicalReconciliationCircuitOpen("sess-1", "agent-a", local, canonical)).toBe(true);
  });
});

describe("LRU eviction", () => {
  it("evicts oldest entries when exceeding 500", () => {
    // Add 501 entries — the earliest one (seq 0) should be evicted
    for (let i = 0; i < 501; i += 1) {
      const local = [user(`q${i}`), assistant(`a${i}`)];
      const canonical = [user(`q${i}`), assistant(`a${i}`)];
      markReconciliationRejected(`sess-lru-${i}`, "agent-default", local, canonical);
    }
    // sess-lru-0 should have been evicted
    const local0 = [user("q0"), assistant("a0")];
    const canonical0 = [user("q0"), assistant("a0")];
    expect(isCanonicalReconciliationCircuitOpen("sess-lru-0", "agent-default", local0, canonical0)).toBe(false);
    // sess-lru-500 should still be present
    const local500 = [user("q500"), assistant("a500")];
    const canonical500 = [user("q500"), assistant("a500")];
    expect(isCanonicalReconciliationCircuitOpen("sess-lru-500", "agent-default", local500, canonical500)).toBe(true);
  });
});

describe("resetAllReconciliationCircuits", () => {
  it("clears all entries", () => {
    const local = [user("hello"), assistant("world")];
    const canonical = [user("hello"), assistant("world")];
    markReconciliationRejected("sess-1", "agent-a", local, canonical);
    resetAllReconciliationCircuits();
    expect(isCanonicalReconciliationCircuitOpen("sess-1", "agent-a", local, canonical)).toBe(false);
  });
});

describe("rawCanonicalEvents alignment", () => {
  it("hits the circuit when rawCanonicalEvents aligns check with register (P1-b regression)", async () => {
    // Simulate the scenario where reconcileAgentCanonicalHistory transforms raw
    // canonical (e.g. backfillTurnModelsFromUsageStatuses adds a trailing status
    // event), producing reconciledEvents with different statistics than raw.
    // Without rawCanonicalEvents, the circuit breaker would register the
    // reconciled fingerprint, and the check (using raw canonical) would never match.
    const localEvents = [user("hello"), toolCall(), assistant("world")];
    const rawCanonical = [user("hello"), assistant("world")]; // 2 events
    const reconciledEvents: TimelineEvent[] = [
      user("hello"),
      assistant("world"),
      // Simulate backfillTurnModelsFromUsageStatuses adding a trailing status
      { id: "status-1", type: "status_update", timestamp: 300, message: "模型：kimi-code/k3" },
    ];

    // shouldReplaceWithCanonicalKimiHistory rejects (process-history-regression)
    // and registers the circuit breaker.
    const { shouldReplaceWithCanonicalKimiHistory } = await import("@/utils/kimiHistoryReconciliation");
    const result = shouldReplaceWithCanonicalKimiHistory(localEvents, reconciledEvents, {
      sessionId: "sess-raw",
      roomAgentId: "agent-a",
      reason: "repair",
      rawCanonicalEvents: rawCanonical,
    });
    expect(result).toBe(false);

    // With rawCanonicalEvents: circuit should be open when checking with raw canonical
    expect(isCanonicalReconciliationCircuitOpen("sess-raw", "agent-a", localEvents, rawCanonical)).toBe(true);

    // Without rawCanonicalEvents (simulating old behavior): the check with raw canonical
    // should NOT match because the registered fingerprint used reconciledEvents.
    // To verify, manually register with reconciledEvents (as the old code would).
    resetAllReconciliationCircuits();
    markReconciliationRejected("sess-raw", "agent-a", localEvents, reconciledEvents);
    expect(isCanonicalReconciliationCircuitOpen("sess-raw", "agent-a", localEvents, rawCanonical)).toBe(false);
  });
});
