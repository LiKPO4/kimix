import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

describe("Kimix scrollbar styles", () => {
  it("keeps one shared scrollbar width and thumb inset", () => {
    expect(css).toMatch(/--kimix-scrollbar-size:\s*8px;/);
    expect(css).toMatch(/--kimix-scrollbar-thumb-inset:\s*2px;/);
    expect(css).toMatch(
      /(?<![\w-])::-webkit-scrollbar\s*\{[^}]*width:\s*var\(--kimix-scrollbar-size\);[^}]*height:\s*var\(--kimix-scrollbar-size\);/s,
    );
  });

  it("lets live thinking and subagent details inherit the shared track width", () => {
    expect(css).not.toMatch(
      /\.kimix-(?:live-thinking|subagent-detail)-scroll::-webkit-scrollbar\s*\{/,
    );

    const thumbRule = css.match(
      /\.kimix-live-thinking-scroll::-webkit-scrollbar-thumb,\s*\.kimix-subagent-detail-scroll::-webkit-scrollbar-thumb\s*\{([^}]*)\}/s,
    )?.[1] ?? "";
    expect(thumbRule).toContain("border: var(--kimix-scrollbar-thumb-inset) solid transparent");
    expect(thumbRule).toContain("background-clip: content-box");
    expect(thumbRule).toContain("var(--kimix-panel-text-muted)");
    expect(thumbRule).not.toContain("var(--kimix-primary-scrollbar-thumb)");
  });

  it("uses the same visible width for the composer overlay thumb", () => {
    const trackRule = css.match(/\.kimix-composer-input-scrollbar\s*\{([^}]*)\}/s)?.[1] ?? "";
    const thumbRule = css.match(/\.kimix-composer-input-scrollbar-thumb\s*\{([^}]*)\}/s)?.[1] ?? "";

    expect(trackRule).toContain("width: var(--kimix-scrollbar-size)");
    expect(thumbRule).toContain(
      "width: calc(var(--kimix-scrollbar-size) - 2 * var(--kimix-scrollbar-thumb-inset))",
    );
  });

  it("uses the primary thumb treatment for peer chat and composer scrollers", () => {
    expect(css).toMatch(
      /--kimix-primary-scrollbar-thumb:\s*var\(--accent-primary\);/,
    );
    expect(css).toMatch(
      /--kimix-primary-scrollbar-thumb-hover:\s*var\(--accent-primary-dark\);/,
    );

    const chatThumbRule = css.match(
      /\.kimix-chat-scroll-area::-webkit-scrollbar-thumb\s*\{([^}]*)\}/s,
    )?.[1] ?? "";
    const composerThumbRule = css.match(
      /\.kimix-composer-input-scrollbar-thumb\s*\{([^}]*)\}/s,
    )?.[1] ?? "";

    expect(chatThumbRule).toContain("background: var(--kimix-primary-scrollbar-thumb)");
    expect(composerThumbRule).toContain("background: var(--kimix-primary-scrollbar-thumb)");
  });
});
