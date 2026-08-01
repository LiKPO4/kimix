import type { KimiThemePreset, Theme, ThemePaletteColors, ThemePaletteId, UiStyleId } from "@/types/ui";
import { applyUiStyle, DEFAULT_UI_STYLE_ID, normalizeUiStyleId } from "@/utils/uiStyles";
import {
  applyThemePalette,
  DEFAULT_CUSTOM_THEME_PALETTE,
  DEFAULT_KIMI_THEME_PRESETS,
  DEFAULT_THEME_PALETTE_ID,
  normalizeKimiThemePresets,
  normalizeThemePaletteColors,
  normalizeThemePaletteId,
} from "@/utils/themePalettes";

const THEME_SNAPSHOT_KEY = "kimix_theme_snapshot";

export type ThemeSnapshot = {
  theme: Theme;
  themePalette: ThemePaletteId;
  customThemePalette: ThemePaletteColors;
  kimiThemePalettes: KimiThemePreset[];
  uiStyle: UiStyleId;
};

export const DEFAULT_THEME_SNAPSHOT: ThemeSnapshot = {
  theme: "light",
  themePalette: DEFAULT_THEME_PALETTE_ID,
  customThemePalette: DEFAULT_CUSTOM_THEME_PALETTE,
  kimiThemePalettes: DEFAULT_KIMI_THEME_PRESETS,
  uiStyle: DEFAULT_UI_STYLE_ID,
};

function normalizeTheme(value: unknown): Theme {
  return value === "dark" || value === "system" ? value : "light";
}

export function readCachedThemeSnapshot(): ThemeSnapshot {
  if (typeof window === "undefined") return DEFAULT_THEME_SNAPSHOT;
  try {
    const raw = window.localStorage.getItem(THEME_SNAPSHOT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const snapshot = parsed && typeof parsed === "object" ? parsed as Partial<ThemeSnapshot> : {};
    return {
      theme: normalizeTheme(snapshot.theme),
      themePalette: normalizeThemePaletteId(snapshot.themePalette),
      customThemePalette: normalizeThemePaletteColors(snapshot.customThemePalette),
      kimiThemePalettes: normalizeKimiThemePresets(snapshot.kimiThemePalettes),
      uiStyle: normalizeUiStyleId(snapshot.uiStyle),
    };
  } catch {
    return DEFAULT_THEME_SNAPSHOT;
  }
}

export function writeCachedThemeSnapshot(snapshot: ThemeSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_SNAPSHOT_KEY, JSON.stringify({
      theme: normalizeTheme(snapshot.theme),
      themePalette: normalizeThemePaletteId(snapshot.themePalette),
      customThemePalette: normalizeThemePaletteColors(snapshot.customThemePalette),
      kimiThemePalettes: normalizeKimiThemePresets(snapshot.kimiThemePalettes),
      uiStyle: normalizeUiStyleId(snapshot.uiStyle),
    }));
  } catch {
    // Cache misses only affect first-paint polish; persisted settings remain authoritative.
  }
}

export function resolveThemeMode(theme: Theme): "light" | "dark" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyThemeSnapshot(snapshot: ThemeSnapshot) {
  if (typeof document === "undefined") return;
  const mode = resolveThemeMode(snapshot.theme);
  document.documentElement.setAttribute("data-theme", mode);
  applyThemePalette(snapshot.themePalette, snapshot.customThemePalette, mode, snapshot.kimiThemePalettes);
  applyUiStyle(snapshot.uiStyle);
}

export function applyCachedThemeSnapshot() {
  applyThemeSnapshot(readCachedThemeSnapshot());
}
