import { describe, expect, it } from "vitest";
import { fitFontSizeToWidth } from "../fitText";

describe("fitFontSizeToWidth", () => {
  it("keeps the base size when the label already fits", () => {
    expect(fitFontSizeToWidth({
      availableWidth: 90,
      requiredWidthAtBase: 72,
      baseFontSize: 13,
      minFontSize: 10,
    })).toBe(13);
  });

  it("shrinks in half-pixel steps before truncation", () => {
    expect(fitFontSizeToWidth({
      availableWidth: 72,
      requiredWidthAtBase: 90,
      baseFontSize: 13,
      minFontSize: 10,
    })).toBe(10);
  });

  it("never shrinks below the readable minimum", () => {
    expect(fitFontSizeToWidth({
      availableWidth: 30,
      requiredWidthAtBase: 100,
      baseFontSize: 13,
      minFontSize: 10,
    })).toBe(10);
  });

  it("falls back to the base size for unavailable measurements", () => {
    expect(fitFontSizeToWidth({
      availableWidth: 0,
      requiredWidthAtBase: 0,
      baseFontSize: 13,
      minFontSize: 10,
    })).toBe(13);
  });
});
