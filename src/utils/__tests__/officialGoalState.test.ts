import { describe, expect, it } from "vitest";
import {
  applyOfficialGoalUpdatedSnapshot,
  getOfficialGoalRefreshDelay,
  inferTerminalGoalFromEvent,
  isStaleGoalFetch,
  OFFICIAL_GOAL_FIRST_DISCOVERY_INTERVAL_MS,
  OFFICIAL_GOAL_REFRESH_DELAY_MS,
  reconcileOfficialGoalSnapshot,
  toOfficialGoalSnapshot,
} from "../officialGoalState";
import type { OfficialGoalSnapshot, TimelineEvent } from "@/types/ui";

describe("officialGoalState", () => {
  it("keeps local complete evidence when SDK refresh returns the same blocked goal", () => {
    const current: OfficialGoalSnapshot = { objective: "等待用户确认", status: "complete", terminalReason: "Goal marked complete." };
    const incoming: OfficialGoalSnapshot = { objective: "等待用户确认", status: "blocked", turnsUsed: 1 };

    expect(reconcileOfficialGoalSnapshot(incoming, current)).toEqual(current);
  });

  it("infers completed goal from UpdateGoal tool result", () => {
    const event: TimelineEvent = {
      id: "tool-result-1",
      type: "tool_result",
      timestamp: 2,
      toolCallId: "call-1",
      toolName: "UpdateGoal",
      result: "Goal marked complete.",
    };

    expect(inferTerminalGoalFromEvent(event, { objective: "等待用户确认", status: "blocked" })).toMatchObject({
      objective: "等待用户确认",
      status: "complete",
      terminalReason: "Goal marked complete.",
    });
  });

  describe("toOfficialGoalSnapshot", () => {
    it("normalizes a goal.updated snapshot payload", () => {
      expect(toOfficialGoalSnapshot({
        goalId: "goal-1",
        objective: "修复登录",
        completionCriterion: "全部用例通过",
        status: "active",
        turnsUsed: 3,
        tokensUsed: 100,
        wallClockMs: 5000,
        terminalReason: undefined,
      })).toEqual({
        goalId: "goal-1",
        objective: "修复登录",
        completionCriterion: "全部用例通过",
        status: "active",
        turnsUsed: 3,
        tokensUsed: 100,
        wallClockMs: 5000,
        terminalReason: undefined,
      });
    });

    it("returns null for non-object or empty payloads", () => {
      expect(toOfficialGoalSnapshot(null)).toBeNull();
      expect(toOfficialGoalSnapshot(undefined)).toBeNull();
      expect(toOfficialGoalSnapshot("goal")).toBeNull();
      expect(toOfficialGoalSnapshot({ status: "active" })).toBeNull();
    });
  });

  describe("applyOfficialGoalUpdatedSnapshot", () => {
    it("writes a non-terminal snapshot from goal.updated", () => {
      const result = applyOfficialGoalUpdatedSnapshot(
        { objective: "修复登录", status: "active", turnsUsed: 1 },
        null,
      );
      expect(result).toEqual({ objective: "修复登录", status: "active", turnsUsed: 1 });
    });

    it("clears on null snapshot (goal removed)", () => {
      expect(applyOfficialGoalUpdatedSnapshot(null, { objective: "修复登录", status: "active" })).toBeNull();
      expect(applyOfficialGoalUpdatedSnapshot(undefined, { objective: "修复登录", status: "active" })).toBeNull();
    });

    it("keeps the terminal snapshot on complete (pill hidden by non-terminal check)", () => {
      const result = applyOfficialGoalUpdatedSnapshot(
        { objective: "修复登录", status: "complete", terminalReason: "Goal marked complete." },
        { objective: "修复登录", status: "active" },
      );
      expect(result).toMatchObject({ objective: "修复登录", status: "complete", terminalReason: "Goal marked complete." });
    });

    it("does not let an older active event overwrite a local complete record", () => {
      const result = applyOfficialGoalUpdatedSnapshot(
        { objective: "修复登录", status: "blocked", turnsUsed: 1 },
        { objective: "修复登录", status: "complete", terminalReason: "Goal marked complete." },
      );
      expect(result).toMatchObject({ status: "complete", terminalReason: "Goal marked complete." });
    });

    it("returns null for un-normalizable snapshot", () => {
      expect(applyOfficialGoalUpdatedSnapshot({ status: "active" }, null)).toBeNull();
    });
  });

  describe("getOfficialGoalRefreshDelay", () => {
    const now = 100_000;

    it("allows an immediate first discovery poll when goal is unknown", () => {
      expect(getOfficialGoalRefreshDelay(false, undefined, now)).toBe(0);
    });

    it("throttles unknown-goal polling to 60s since last refresh", () => {
      const delay = getOfficialGoalRefreshDelay(false, now - 5_000, now);
      expect(delay).toBe(OFFICIAL_GOAL_FIRST_DISCOVERY_INTERVAL_MS - 5_000);
      expect(delay).toBeGreaterThan(0);
    });

    it("keeps the 1200ms event-driven refresh when goal exists", () => {
      // 从未刷新 → 立即拉；刚刷新过 → 补足 1200ms 间隔；很久前刷新 → 立即。
      expect(getOfficialGoalRefreshDelay(true, undefined, now)).toBe(0);
      expect(getOfficialGoalRefreshDelay(true, now - 100, now)).toBe(OFFICIAL_GOAL_REFRESH_DELAY_MS - 100);
      expect(getOfficialGoalRefreshDelay(true, now - 50_000, now)).toBe(0);
    });
  });

  describe("isStaleGoalFetch", () => {
    it("accepts the fetch when no goal.updated event arrived meanwhile", () => {
      expect(isStaleGoalFetch(1, undefined)).toBe(false);
      expect(isStaleGoalFetch(1, 1)).toBe(false);
    });

    it("discards the fetch when a newer goal.updated bumped the version", () => {
      expect(isStaleGoalFetch(1, 2)).toBe(true);
    });
  });
});
