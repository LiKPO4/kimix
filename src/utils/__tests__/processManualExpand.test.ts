import { describe, expect, it } from "vitest";
import {
  getProcessManualExpand,
  noteProcessManualExpand,
  processManualExpandTurnKey,
  resetProcessManualExpandForTests,
} from "../processManualExpand";

describe("processManualExpand", () => {
  it("restores the last manual choice per turn and distinguishes turns", () => {
    resetProcessManualExpandForTests();
    const keyA = processManualExpandTurnKey({ sessionId: "s1", agentTurnId: "turn-a", eventId: "e1" });
    const keyB = processManualExpandTurnKey({ sessionId: "s1", agentTurnId: "turn-b", eventId: "e2" });
    expect(getProcessManualExpand(keyA)).toBeUndefined();

    noteProcessManualExpand(keyA, true);
    noteProcessManualExpand(keyB, false);
    expect(getProcessManualExpand(keyA)).toBe(true);
    expect(getProcessManualExpand(keyB)).toBe(false);

    noteProcessManualExpand(keyA, false);
    expect(getProcessManualExpand(keyA)).toBe(false);
  });

  it("falls back to roomMessageId then eventId when agentTurnId is missing", () => {
    expect(processManualExpandTurnKey({ sessionId: "s1", roomMessageId: "m1", eventId: "e1" }))
      .toBe(processManualExpandTurnKey({ sessionId: "s1", roomMessageId: "m1", eventId: "e2" }));
    expect(processManualExpandTurnKey({ sessionId: "s1", eventId: "e1" }))
      .not.toBe(processManualExpandTurnKey({ sessionId: "s1", eventId: "e2" }));
  });

  it("evicts the oldest entry beyond the limit", () => {
    resetProcessManualExpandForTests();
    for (let index = 0; index < 210; index += 1) {
      noteProcessManualExpand(`turn-${index}`, true);
    }
    expect(getProcessManualExpand("turn-0")).toBeUndefined();
    expect(getProcessManualExpand("turn-209")).toBe(true);
    resetProcessManualExpandForTests();
  });
});
