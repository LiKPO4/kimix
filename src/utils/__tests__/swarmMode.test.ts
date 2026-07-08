import { describe, expect, it } from "vitest";
import { displayedSwarmMode, hasPendingSwarmMode, pendingSwarmModeValue, reportedSwarmMode } from "../swarmMode";

describe("swarmMode", () => {
  it("treats a legacy SDK route lock as enabled until an explicit official false state arrives", () => {
    expect(reportedSwarmMode({ swarmModeLockedAt: 1 })).toBe(true);
    expect(reportedSwarmMode({ swarmModeLockedAt: 1, swarmMode: false })).toBe(false);
  });

  it("shows a running-turn desired state and marks it pending", () => {
    const session = { swarmMode: true, swarmModeLockedAt: 1, swarmModeDesired: false };
    expect(displayedSwarmMode(session)).toBe(false);
    expect(hasPendingSwarmMode(session)).toBe(true);
  });

  it("clears a pending toggle when the user switches back to the reported state", () => {
    expect(pendingSwarmModeValue({ swarmMode: true, swarmModeDesired: false }, true)).toBeUndefined();
    expect(pendingSwarmModeValue({ swarmMode: false }, true)).toBe(true);
  });
});
