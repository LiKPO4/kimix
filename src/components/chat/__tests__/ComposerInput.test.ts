import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { calculateComposerScrollbarMetrics } from "../ComposerInput";

describe("ComposerInput overlay scrollbar", () => {
  it("stays hidden while the textarea content fits", () => {
    expect(calculateComposerScrollbarMetrics({
      clientHeight: 100,
      scrollHeight: 100,
      scrollTop: 0,
    })).toEqual({ visible: false, thumbHeight: 0, thumbTop: 0 });
  });

  it("maps textarea scrolling onto an overlay thumb without changing textarea width", () => {
    const start = calculateComposerScrollbarMetrics({
      clientHeight: 132,
      scrollHeight: 396,
      scrollTop: 0,
    });
    const end = calculateComposerScrollbarMetrics({
      clientHeight: 132,
      scrollHeight: 396,
      scrollTop: 264,
    });

    expect(start.visible).toBe(true);
    expect(start.thumbHeight).toBe(41);
    expect(start.thumbTop).toBe(0);
    expect(end.thumbTop).toBe(82);

    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    expect(css).toMatch(
      /\.kimix-composer-input::-webkit-scrollbar\s*\{[^}]*width:\s*0;[^}]*height:\s*0;/s,
    );
  });
});
