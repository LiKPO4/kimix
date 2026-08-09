import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

describe("layout resizer styles", () => {
  it("保留拖拽热区但不在相邻面板之间占据宽度", () => {
    const rule = css.match(/\.kimix-layout-resizer\s*\{([^}]*)\}/s)?.[1] ?? "";

    expect(rule).toContain("width: 12px");
    expect(rule).toContain("flex: 0 0 12px");
    expect(rule).toContain("margin-right: -12px");
    expect(rule).toContain("z-index: 2");

    const indicatorRule = css.match(/\.kimix-layout-resizer::after\s*\{([^}]*)\}/s)?.[1] ?? "";
    expect(indicatorRule).toContain("left: -1px");
  });
});
