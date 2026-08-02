import { describe, expect, it } from "vitest";
import type { KimiThemePreset } from "@/types/ui";
import { reconcileKimiThemePresetsFromDirectory, resolveThemePaletteTokens } from "../themePalettes";

const palette = {
  primary: "#1565C0",
  accent: "#00838F",
  text: "#1A1A1A",
  textStrong: "#1A1A1A",
  textDim: "#454545",
  textMuted: "#5F5F5F",
  border: "#737373",
  borderFocus: "#92660A",
  success: "#0E7A38",
  warning: "#92660A",
  error: "#B91C1C",
  diffAdded: "#0E7A38",
  diffRemoved: "#B91C1C",
  diffAddedStrong: "#0E7A38",
  diffRemovedStrong: "#B91C1C",
  diffGutter: "#737373",
  diffMeta: "#5F5F5F",
  roleUser: "#9A4A00",
};

function preset(id: string, path?: string): KimiThemePreset {
  return {
    id,
    name: id,
    displayName: `KIMI-${id}`,
    path,
    palette,
    colors: { primary: palette.primary, surface: palette.textMuted, accent: palette.accent },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("reconcileKimiThemePresetsFromDirectory", () => {
  it("removes stale presets from the scanned directory", () => {
    const current = [
      preset("kept", "C:\\Users\\Admin\\.kimi-code\\themes\\kept.json"),
      preset("deleted", "C:\\Users\\Admin\\.kimi-code\\themes\\deleted.json"),
    ];
    const incoming = [preset("kept", "C:\\Users\\Admin\\.kimi-code\\themes\\kept.json")];

    const result = reconcileKimiThemePresetsFromDirectory(
      current,
      incoming,
      "C:\\Users\\Admin\\.kimi-code\\themes",
    );

    expect(result.presets.map((item) => item.id)).toEqual(["kept"]);
    expect(result.removed).toBe(1);
  });

  it("preserves presets owned by another directory or without a source path", () => {
    const external = preset("external", "D:\\themes\\external.json");
    const manual = preset("manual");

    const result = reconcileKimiThemePresetsFromDirectory(
      [external, manual],
      [],
      "C:\\Users\\Admin\\.kimi-code\\themes\\",
    );

    expect(result.presets.map((item) => item.id)).toEqual(["external", "manual"]);
    expect(result.removed).toBe(0);
  });
});


function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function relativeLuminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string) {
  const L1 = relativeLuminance(a);
  const L2 = relativeLuminance(b);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

describe("dark mode surface ladder", () => {
  it("keeps elevated steps, borders, and muted text legible on warm-paper dark", () => {
    const tokens = resolveThemePaletteTokens("warm-paper", { primary: "#1982FF", surface: "#EDE9E0", accent: "#B85C38" }, "dark");
    const ground = tokens["--surface-ground"];
    const base = tokens["--surface-base"];
    const elevated = tokens["--surface-elevated"];
    const hover = tokens["--surface-hover"];
    const textPrimary = tokens["--text-primary"];
    const textSecondary = tokens["--text-secondary"];
    const textMuted = tokens["--text-muted"];
    const borderSubtle = tokens["--border-subtle"];
    const borderDefault = tokens["--border-default"];

    expect(contrastRatio(textPrimary, elevated)).toBeGreaterThanOrEqual(9);
    expect(contrastRatio(textSecondary, elevated)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(textMuted, elevated)).toBeGreaterThanOrEqual(4.4);
    expect(contrastRatio(borderDefault, elevated)).toBeGreaterThanOrEqual(1.45);
    expect(contrastRatio(borderSubtle, elevated)).toBeGreaterThanOrEqual(1.2);
    // Surface steps must not collapse (ΔL via contrast between layers).
    expect(contrastRatio(base, ground)).toBeGreaterThanOrEqual(1.12);
    expect(contrastRatio(elevated, base)).toBeGreaterThanOrEqual(1.12);
    expect(contrastRatio(hover, elevated)).toBeGreaterThanOrEqual(1.12);
    // Borders are lighter than elevated (higher luminance), not darker mud.
    expect(relativeLuminance(borderDefault)).toBeGreaterThan(relativeLuminance(elevated));
  });
});
