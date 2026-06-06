import { describe, expect, it } from "vitest";
import { inferTerminalGoalFromEvent, reconcileOfficialGoalSnapshot } from "../officialGoalState";
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
});
