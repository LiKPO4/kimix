import { describe, expect, it } from "vitest";
import type { KimiThemePreset } from "@/types/ui";
import { reconcileKimiThemePresetsFromDirectory } from "../themePalettes";

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
