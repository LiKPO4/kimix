import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

describe("settings workspace scroll layout", () => {
  it("keeps a bounded page scroll container after moving navigation to the app sidebar", () => {
    expect(css).toMatch(
      /\.kimix-settings-panel\.is-workspace \.kimix-settings-body\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/s,
    );
    expect(css).toMatch(
      /\.kimix-settings-layout\.is-workspace\s*\{[^}]*display:\s*grid;[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
    );
    expect(css).toMatch(
      /\.kimix-settings-layout\.is-workspace \.kimix-settings-page\s*\{[^}]*display:\s*flex;[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*flex-direction:\s*column;[^}]*overflow-y:\s*auto;/s,
    );
  });

  it("pins the footer to the viewport bottom without detaching it from overflowing content", () => {
    expect(css).toMatch(
      /\.kimix-settings-columns\.is-workspace\s*\{[^}]*flex-shrink:\s*0;[^}]*padding-bottom:\s*18px;/s,
    );
    expect(css).toMatch(
      /\.kimix-settings-panel\.is-workspace \.kimix-settings-footer\s*\{[^}]*flex-shrink:\s*0;[^}]*margin-top:\s*auto;/s,
    );
  });
});
