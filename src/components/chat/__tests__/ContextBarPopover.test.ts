import { describe, expect, it } from "vitest";
import { computeContextBarPopoverLeft } from "../ContextBar";

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
