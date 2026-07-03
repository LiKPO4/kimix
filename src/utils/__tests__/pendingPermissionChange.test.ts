import { describe, expect, it } from "vitest";
import { isPendingPermissionTurnEnded, type PendingPermissionChange } from "../pendingPermissionChange";

const pending: PendingPermissionChange = {
  sessionId: "ui-1",
  runtimeSessionId: "runtime-1",
  mode: "yolo",
};

describe("pendingPermissionChange", () => {
  it("applies only on the bound runtime turn end", () => {
    expect(isPendingPermissionTurnEnded(pending, {
      sessionId: "runtime-1",
      event: { type: "turn.ended" },
    })).toBe(true);
    expect(isPendingPermissionTurnEnded(pending, {
      sessionId: "runtime-2",
      event: { type: "turn.ended" },
    })).toBe(false);
  });

  it("does not treat tool completion, status reconciliation, or snapshot replay as the turn boundary", () => {
    expect(isPendingPermissionTurnEnded(pending, {
      sessionId: "runtime-1",
      event: { type: "tool.result" },
    })).toBe(false);
    expect(isPendingPermissionTurnEnded(pending, {
      sessionId: "runtime-1",
      event: { type: "turn.ended", snapshotReplay: "history" },
    })).toBe(false);
    expect(isPendingPermissionTurnEnded(pending, {
      sessionId: "runtime-1",
      event: { type: "turn.ended", snapshotReplay: "in_flight" },
    })).toBe(false);
  });
});
