import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import { computeContextBarPopoverLeft, selectContextBarError, selectContextBarErrorAcrossTimelines } from "../ContextBar";

describe("computeContextBarPopoverLeft", () => {
  it("right-aligns to the frozen anchor right edge", () => {
    expect(computeContextBarPopoverLeft({
      align: "right",
      anchorLeft: 800,
      anchorRight: 960,
      panelWidth: 330,
      viewportWidth: 1400,
    })).toBe(630);
  });

  it("keeps the same left when only the anchor width changes", () => {
    const open = computeContextBarPopoverLeft({
      align: "right",
      anchorLeft: 820,
      anchorRight: 960,
      panelWidth: 330,
      viewportWidth: 1400,
    });
    const afterShorterLabel = computeContextBarPopoverLeft({
      align: "right",
      anchorLeft: 900,
      anchorRight: 960,
      panelWidth: 330,
      viewportWidth: 1400,
    });
    expect(afterShorterLabel).toBe(open);
  });

  it("clamps into the viewport", () => {
    expect(computeContextBarPopoverLeft({
      align: "right",
      anchorLeft: 0,
      anchorRight: 80,
      panelWidth: 330,
      viewportWidth: 400,
      margin: 12,
    })).toBe(12);
  });
});

describe("selectContextBarError", () => {
  const error = (id: string, timestamp: number): TimelineEvent => ({
    id,
    type: "error",
    timestamp,
    message: `错误 ${id}`,
  });

  it("keeps the latest error when the conversation has not advanced", () => {
    expect(selectContextBarError([
      { id: "user-1", type: "user_message", timestamp: 1, content: "开始" },
      error("error-1", 2),
      error("error-2", 3),
    ])?.id).toBe("error-2");
  });

  it("does not keep an error from a previous user turn", () => {
    expect(selectContextBarError([
      { id: "user-1", type: "user_message", timestamp: 1, content: "第一轮" },
      error("old-error", 2),
      { id: "user-2", type: "user_message", timestamp: 3, content: "继续" },
    ])).toBeUndefined();
  });

  it("clears a prior error after a later assistant reply and still surfaces a newer error", () => {
    expect(selectContextBarError([
      error("old-error", 1),
      { id: "assistant", type: "assistant_message", timestamp: 2, content: "已恢复", isThinking: false, isComplete: true },
      error("new-error", 3),
    ])?.id).toBe("new-error");
  });

  it("uses timestamps rather than flattened room-agent array order", () => {
    expect(selectContextBarError([
      { id: "user-2", type: "user_message", timestamp: 3, content: "下一轮" },
      error("old-error", 2),
    ])).toBeUndefined();
  });

  it("keeps room-agent timelines independent when selecting the latest actionable error", () => {
    expect(selectContextBarErrorAcrossTimelines([[
      error("agent-a-error", 2),
    ], [
      { id: "agent-b-reply", type: "assistant_message", timestamp: 3, content: "Agent B 完成", isThinking: false, isComplete: true },
    ]])?.id).toBe("agent-a-error");
  });
});
