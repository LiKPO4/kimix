export type KimiCodeTerminalStatus = "completed" | "error" | "interrupted";

type StatusEmitter = (sessionId: string, status: "running" | KimiCodeTerminalStatus) => void;

function eventRecord(event: unknown): Record<string, unknown> | null {
  return event && typeof event === "object" && !Array.isArray(event)
    ? event as Record<string, unknown>
    : null;
}

function loopEventRecord(event: Record<string, unknown> | null): Record<string, unknown> | null {
  const payload = event?.event;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
}

/**
 * Kimi Code SDK emits a successful `step.end` before the matching final
 * `usage.record`. Defer completed until usage has been forwarded, while
 * retaining a short fallback for providers that omit usage.
 */
export class KimiCodeStatusSequencer {
  private readonly pendingCompleted = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly emit: StatusEmitter,
    private readonly completedFallbackMs = 120,
  ) {}

  handle(sessionId: string, event: unknown): void {
    const record = eventRecord(event);
    const type = record?.type;

    if (type === "turn.started") {
      this.clear(sessionId);
      this.emit(sessionId, "running");
      return;
    }

    if (type === "usage.record" && record?.usageScope === "turn") {
      if (!this.pendingCompleted.has(sessionId)) return;
      this.clear(sessionId);
      this.emit(sessionId, "completed");
      return;
    }

    if (type === "turn.ended") {
      const reason = record?.reason;
      if (reason === "cancelled") {
        this.clear(sessionId);
        this.emit(sessionId, "interrupted");
      } else if (reason === "failed" || reason === "error") {
        this.clear(sessionId);
        this.emit(sessionId, "error");
      } else {
        this.scheduleCompleted(sessionId);
      }
      return;
    }

    const loopEvent = loopEventRecord(record);
    if (loopEvent?.type === "step.end" && loopEvent.finishReason === "end_turn") {
      this.scheduleCompleted(sessionId);
      return;
    }

    if (type === "error") {
      this.clear(sessionId);
      this.emit(sessionId, "error");
    }
  }

  clear(sessionId: string): void {
    const timer = this.pendingCompleted.get(sessionId);
    if (timer) clearTimeout(timer);
    this.pendingCompleted.delete(sessionId);
  }

  clearAll(): void {
    for (const sessionId of this.pendingCompleted.keys()) this.clear(sessionId);
  }

  private scheduleCompleted(sessionId: string): void {
    this.clear(sessionId);
    const timer = setTimeout(() => {
      this.pendingCompleted.delete(sessionId);
      this.emit(sessionId, "completed");
    }, this.completedFallbackMs);
    this.pendingCompleted.set(sessionId, timer);
  }
}
