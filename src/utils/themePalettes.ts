import type { KimiThemePalette, KimiThemePreset, ThemePaletteColors, ThemePaletteId } from "@/types/ui";

export type ResolvedThemeMode = "light" | "dark";

type ThemePaletteDefinition = {
  id: Exclude<ThemePaletteId, "custom" | `kimi:${string}`>;
  label: string;
  description: string;
  colors: ThemePaletteColors;
};

type ThemeTokenMap = Record<string, string>;

export const DEFAULT_THEME_PALETTE_ID: ThemePaletteId = "warm-paper";

export const DEFAULT_CUSTOM_THEME_PALETTE: ThemePaletteColors = {
  primary: "#4A7C6F",
  surface: "#D4D0C4",
  accent: "#A67B5B",
};

export const DEFAULT_KIMI_THEME_PALETTE: KimiThemePalette = {
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

export const DEFAULT_KIMI_THEME_PRESETS: KimiThemePreset[] = [];

export const THEME_PALETTES: ThemePaletteDefinition[] = [
  {
    id: "warm-paper",
    label: "暖纸",
    description: "当前默认色，温和纸面感",
    colors: {
      primary: "#1677F0",
      surface: "#E6E0D4",
      accent: "#A8522E",
    },
  },
  {
    id: "neutral-gray",
    label: "灰白",
    description: "更纯净、低饱和的工作台",
    colors: {
      primary: "#1D4ED8",
      surface: "#D8DCE3",
      accent: "#475569",
    },
  },
  {
    id: "soft-green",
    label: "淡绿",
    description: "轻柔的绿色背景和自然强调",
    colors: {
      primary: "#0F7A4D",
      surface: "#D5E6D8",
      accent: "#5F8F52",
    },
  },
  {
    id: "warm-orange",
    label: "暖橙",
    description: "更明亮、有活力的暖色调",
    colors: {
      primary: "#D9651C",
      surface: "#E8D5C0",
      accent: "#9A5A2C",
    },
  },
];

export function normalizeThemePaletteId(value: unknown): ThemePaletteId {
  return value === "custom" || THEME_PALETTES.some((palette) => palette.id === value)
    || (typeof value === "string" && value.startsWith("kimi:") && value.length > "kimi:".length)
    ? value as ThemePaletteId
    : DEFAULT_THEME_PALETTE_ID;
}

export function normalizeThemePaletteColors(value: unknown): ThemePaletteColors {
  const raw = value && typeof value === "object" ? value as Partial<ThemePaletteColors> : {};
  return {
    primary: normalizeHexColor(raw.primary, DEFAULT_CUSTOM_THEME_PALETTE.primary),
    surface: normalizeHexColor(raw.surface, DEFAULT_CUSTOM_THEME_PALETTE.surface),
    accent: normalizeHexColor(raw.accent, DEFAULT_CUSTOM_THEME_PALETTE.accent),
  };
}

export function normalizeKimiThemePalette(value: unknown): KimiThemePalette {
  const raw = value && typeof value === "object" ? value as Partial<KimiThemePalette> : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_KIMI_THEME_PALETTE).map(([key, fallback]) => [
      key,
      normalizeHexColor(raw[key as keyof KimiThemePalette], fallback),
    ]),
  ) as unknown as KimiThemePalette;
}

export function kimiThemePaletteId(id: string) {
  return `kimi:${id}` as const;
}

export function normalizeKimiThemePreset(value: unknown): KimiThemePreset | null {
  const raw = value && typeof value === "object" ? value as Partial<KimiThemePreset> & { kimiColors?: unknown } : null;
  if (!raw) return null;
  const sourceId = typeof raw.id === "string" ? raw.id.replace(/^kimi:/, "").trim() : "";
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : sourceId || "theme";
  const id = sourceId || slugThemeName(name);
  const palette = normalizeKimiThemePalette(raw.palette ?? raw.kimiColors);
  return {
    id,
    name,
    displayName: typeof raw.displayName === "string" && raw.displayName.trim() ? raw.displayName.trim() : `KIMI-${name}`,
    path: typeof raw.path === "string" ? raw.path : undefined,
    base: raw.base === "light" || raw.base === "dark" ? raw.base : undefined,
    palette,
    colors: normalizeThemePaletteColors(raw.colors ?? {
      primary: palette.primary,
      surface: palette.textMuted,
      accent: palette.accent,
    }),
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
}

export function normalizeKimiThemePresets(value: unknown, legacyPalette?: unknown): KimiThemePreset[] {
  const rawItems = Array.isArray(value) ? value : [];
  const normalized = rawItems.map(normalizeKimiThemePreset).filter((item): item is KimiThemePreset => Boolean(item));
  const unique = upsertKimiThemePresets([], normalized);
  if (unique.length > 0) return unique;
  if (legacyPalette && typeof legacyPalette === "object") {
    const legacy = normalizeKimiThemePreset({
      id: "default",
      name: "Default",
      displayName: "KIMI-Default",
      palette: legacyPalette,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return legacy ? [legacy] : DEFAULT_KIMI_THEME_PRESETS;
  }
  return DEFAULT_KIMI_THEME_PRESETS;
}

export function upsertKimiThemePresets(current: KimiThemePreset[], incoming: KimiThemePreset | KimiThemePreset[]) {
  const list = [...current];
  const items = Array.isArray(incoming) ? incoming : [incoming];
  for (const item of items) {
    const normalized = normalizeKimiThemePreset(item);
    if (!normalized) continue;
    const existingIndex = list.findIndex((candidate) =>
      candidate.id === normalized.id ||
      (candidate.path && normalized.path && candidate.path === normalized.path) ||
      candidate.name.toLowerCase() === normalized.name.toLowerCase()
    );
    if (existingIndex >= 0) {
      list[existingIndex] = {
        ...list[existingIndex],
        ...normalized,
        createdAt: list[existingIndex].createdAt ?? normalized.createdAt,
        updatedAt: Date.now(),
      };
    } else {
      list.push({ ...normalized, createdAt: normalized.createdAt ?? Date.now(), updatedAt: Date.now() });
    }
  }
  return list;
}

function normalizeThemeSourcePath(value: string) {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function themeSourceDirectory(filePath: string) {
  const normalized = normalizeThemeSourcePath(filePath);
  const separatorIndex = normalized.lastIndexOf("/");
  return separatorIndex >= 0 ? normalized.slice(0, separatorIndex) : "";
}

export function reconcileKimiThemePresetsFromDirectory(
  current: KimiThemePreset[],
  incoming: KimiThemePreset[],
  themesDir: string,
) {
  const normalizedDir = normalizeThemeSourcePath(themesDir);
  const normalizedIncoming = incoming
    .map(normalizeKimiThemePreset)
    .filter((item): item is KimiThemePreset => Boolean(item));
  const incomingPaths = new Set(
    normalizedIncoming
      .map((item) => item.path ? normalizeThemeSourcePath(item.path) : "")
      .filter(Boolean),
  );
  const managedCurrent = current.filter((item) => (
    item.path && themeSourceDirectory(item.path) === normalizedDir
  ));
  const retained = current.filter((item) => (
    !item.path || themeSourceDirectory(item.path) !== normalizedDir
  ));
  const removed = managedCurrent.filter((item) => (
    item.path && !incomingPaths.has(normalizeThemeSourcePath(item.path))
  )).length;

  return {
    presets: upsertKimiThemePresets(retained, normalizedIncoming),
    removed,
  };
}

export function getThemePaletteColors(id: ThemePaletteId, custom: ThemePaletteColors): ThemePaletteColors {
  if (id === "custom") return normalizeThemePaletteColors(custom);
  if (isKimiThemePaletteId(id)) return DEFAULT_CUSTOM_THEME_PALETTE;
  return THEME_PALETTES.find((palette) => palette.id === id)?.colors ?? THEME_PALETTES[0].colors;
}

export function resolveThemePaletteTokens(id: ThemePaletteId, custom: ThemePaletteColors, mode: ResolvedThemeMode, kimiPresets: KimiThemePreset[] = DEFAULT_KIMI_THEME_PRESETS): ThemeTokenMap {
  if (isKimiThemePaletteId(id)) {
    const preset = kimiPresets.find((item) => kimiThemePaletteId(item.id) === id);
    return buildKimiTokens(preset?.palette ?? DEFAULT_KIMI_THEME_PALETTE, mode);
  }
  const colors = getThemePaletteColors(id, custom);
  return mode === "dark" ? buildDarkTokens(colors) : buildLightTokens(colors, id === "warm-paper");
}

export function applyThemePalette(id: ThemePaletteId, custom: ThemePaletteColors, mode: ResolvedThemeMode, kimiPresets: KimiThemePreset[] = DEFAULT_KIMI_THEME_PRESETS) {
  const root = document.documentElement;
  root.setAttribute("data-theme-palette", id);
  const tokens = resolveThemePaletteTokens(id, custom, mode, kimiPresets);
  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(name, value);
  }
}

export function isKimiThemePaletteId(id: ThemePaletteId): id is `kimi:${string}` {
  return id.startsWith("kimi:");
}

function slugThemeName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "theme";
}

function buildKimiTokens(input: KimiThemePalette, mode: ResolvedThemeMode): ThemeTokenMap {
  const colors = normalizeKimiThemePalette(input);
  const dark = mode === "dark";
  // Dark ladder matches buildDarkTokens: elevated steps + light borders, not crushed near-black.
  const surfaceSeed = dark ? "#1C212B" : "#F1F3F5";
  const elevatedSeed = dark ? "#272E3A" : "#FFFFFF";
  const textPrimary = dark
    ? mix(colors.textStrong || colors.text, "#FFFFFF", 0.82)
    : (colors.textStrong || colors.text);
  const textSecondary = dark ? mix(colors.textDim || colors.text, "#FFFFFF", 0.55) : colors.textDim;
  const textMuted = dark ? mix(colors.textMuted || colors.text, "#FFFFFF", 0.42) : colors.textMuted;
  const primaryLight = dark ? mix(colors.primary, "#0A0C10", 0.72) : mix(colors.primary, "#FFFFFF", 0.88);
  const warningBg = dark ? mix(colors.warning, "#0A0C10", 0.76) : mix(colors.warning, "#FFFFFF", 0.9);
  const successBg = dark ? mix(colors.success, "#0A0C10", 0.76) : mix(colors.success, "#FFFFFF", 0.9);
  const dangerBg = dark ? mix(colors.error, "#0A0C10", 0.76) : mix(colors.error, "#FFFFFF", 0.9);

  return commonTokens({
    surfaceGround: dark ? "#12141A" : mix(colors.text, "#FFFFFF", 0.95),
    surfaceBase: dark ? surfaceSeed : mix(colors.border, "#FFFFFF", 0.82),
    surfaceElevated: elevatedSeed,
    surfaceHover: dark ? "#343C4B" : mix(colors.border, "#FFFFFF", 0.78),
    surfaceActive: dark ? "#404959" : mix(colors.border, "#FFFFFF", 0.68),
    textPrimary,
    textSecondary,
    textMuted,
    textInverse: dark ? "#0E1116" : "#FFFFFF",
    textPlaceholder: dark ? mix(textMuted, "#0A0C10", 0.28) : mix(colors.textMuted, "#FFFFFF", 0.38),
    borderSubtle: dark ? mix(elevatedSeed, "#FFFFFF", 0.12) : mix(colors.border, "#FFFFFF", 0.46),
    borderDefault: dark ? mix(elevatedSeed, "#FFFFFF", 0.2) : colors.border,
    borderStrong: dark ? mix(elevatedSeed, "#FFFFFF", 0.3) : colors.borderFocus,
    primary: colors.primary,
    primaryLight,
    primarySoft: dark ? mix(colors.primary, "#050505", 0.55) : mix(colors.primary, "#FFFFFF", 0.62),
    primaryDark: dark ? mix(colors.primary, "#FFFFFF", 0.18) : mix(colors.primary, "#000000", 0.2),
    primaryHover: dark ? mix(colors.primary, "#FFFFFF", 0.08) : mix(colors.primary, "#000000", 0.12),
    secondary: colors.accent,
    secondaryLight: dark ? mix(colors.accent, "#050505", 0.7) : mix(colors.accent, "#FFFFFF", 0.86),
    success: colors.success,
    warning: colors.warning,
    danger: colors.error,
    dangerLight: dangerBg,
    overlayBg: dark ? "rgba(5, 7, 10, 0.78)" : "rgba(250, 250, 250, 0.74)",
    infoBgSoft: dark ? mix(colors.primary, "#050505", 0.78) : mix(colors.primary, "#FFFFFF", 0.95),
    infoBorder: dark ? mix(colors.primary, "#050505", 0.48) : mix(colors.primary, "#FFFFFF", 0.68),
    infoText: dark ? mix(colors.primary, "#FFFFFF", 0.58) : mix(colors.primary, "#111111", 0.48),
    infoTextSecondary: dark ? mix(colors.primary, "#FFFFFF", 0.36) : mix(colors.primary, "#111111", 0.32),
    warningBg,
    warningBorder: dark ? mix(colors.warning, "#050505", 0.48) : mix(colors.warning, "#FFFFFF", 0.62),
    warningText: dark ? mix(colors.warning, "#FFFFFF", 0.58) : mix(colors.warning, "#111111", 0.48),
    warningTextSecondary: dark ? mix(colors.warning, "#FFFFFF", 0.36) : mix(colors.warning, "#111111", 0.34),
    successBg,
    successBorder: dark ? mix(colors.success, "#050505", 0.48) : mix(colors.success, "#FFFFFF", 0.68),
    successText: dark ? mix(colors.success, "#FFFFFF", 0.58) : mix(colors.success, "#111111", 0.48),
    progressTrack: dark ? mix(colors.border, "#050505", 0.58) : mix(colors.border, "#FFFFFF", 0.72),
    mediaThumbBg: dark ? surfaceSeed : mix(colors.border, "#FFFFFF", 0.86),
    strongButtonBg: dark ? mix(colors.text, "#FFFFFF", 0.88) : mix(colors.text, "#000000", 0.9),
    strongButtonText: dark ? "#101214" : "#FFFFFF",
    composerShadow: dark ? "0 1px 2px rgba(5, 8, 11, 0.28)" : `0 1px 2px rgba(${hexToRgb(colors.text).join(", ")}, 0.06)`,
    floatShadow: dark ? "0 16px 42px rgba(3, 5, 8, 0.3)" : `0 16px 42px rgba(${hexToRgb(colors.text).join(", ")}, 0.12)`,
  });
}

function buildLightTokens(colors: ThemePaletteColors, preserveWarmPaperDepth = false): ThemeTokenMap {
  const primary = normalizeHexColor(colors.primary, DEFAULT_CUSTOM_THEME_PALETTE.primary);
  // Slightly deepen the canvas seed so ground/base/elevated stay separable on pale palettes.
  const surfaceSeed = normalizeHexColor(colors.surface, DEFAULT_CUSTOM_THEME_PALETTE.surface);
  const surface = mix(surfaceSeed, "#1C1917", 0.04);
  const accent = normalizeHexColor(colors.accent, DEFAULT_CUSTOM_THEME_PALETTE.accent);
  const textBase = mix(surface, "#090909", 0.92);
  // Secondary/muted target roughly WCAG AA on white elevated cards.
  const textSecondary = mix(surface, "#171717", 0.7);
  const textMuted = mix(surface, "#171717", 0.54);
  // Borders must darken toward ink, never wash toward white on light UI.
  const border = mix(surface, "#3F3A34", 0.28);
  const borderStrong = mix(surface, "#2A2622", 0.38);
  const borderSubtle = mix(surface, "#3F3A34", 0.16);

  return commonTokens({
    surfaceGround: surface,
    surfaceBase: mix(surface, "#FFFFFF", preserveWarmPaperDepth ? 0.58 : 0.42),
    surfaceElevated: "#FFFFFF",
    surfaceHover: mix(surface, "#FFFFFF", preserveWarmPaperDepth ? 0.34 : 0.2),
    surfaceActive: mix(surface, "#D0CBC3", preserveWarmPaperDepth ? 0.22 : 0.2),
    textPrimary: textBase,
    textSecondary,
    textMuted,
    textInverse: "#FFFFFF",
    textPlaceholder: mix(surface, "#171717", 0.4),
    borderSubtle,
    borderDefault: border,
    borderStrong,
    primary,
    primaryLight: mix(primary, "#FFFFFF", 0.9),
    primarySoft: mix(primary, "#FFFFFF", 0.54),
    primaryDark: mix(primary, "#000000", 0.2),
    primaryHover: mix(primary, "#000000", 0.12),
    secondary: accent,
    secondaryLight: mix(accent, "#FFFFFF", 0.88),
    success: "#15803D",
    warning: "#CA8A04",
    danger: "#DC2626",
    dangerLight: "#FEF2F2",
    overlayBg: `rgba(${hexToRgb(mix(surface, "#FFFFFF", 0.28)).join(", ")}, 0.74)`,
    infoBgSoft: mix(primary, "#FFFFFF", 0.95),
    infoBorder: mix(primary, "#FFFFFF", 0.68),
    infoText: mix(primary, "#111111", 0.48),
    infoTextSecondary: mix(primary, "#111111", 0.32),
    warningBg: mix(accent, "#FFFFFF", 0.9),
    warningBorder: mix(accent, "#FFFFFF", 0.62),
    warningText: mix(accent, "#111111", 0.48),
    warningTextSecondary: mix(accent, "#111111", 0.34),
    successBg: mix("#15803D", "#FFFFFF", 0.9),
    successBorder: mix("#15803D", "#FFFFFF", 0.68),
    successText: "#1A5C33",
    progressTrack: mix(surface, "#D9D9D9", 0.3),
    mediaThumbBg: mix(surface, "#FFFFFF", 0.5),
    strongButtonBg: mix(surface, "#000000", 0.9),
    strongButtonText: "#FFFFFF",
    composerShadow: `0 1px 2px rgba(${hexToRgb(textBase).join(", ")}, 0.06)`,
    floatShadow: `0 16px 42px rgba(${hexToRgb(textBase).join(", ")}, 0.12)`,
  });
}

/**
 * Dark surfaces follow an elevated ladder (MD3 / VS Code Dark+ / GitHub Dark):
 * - never collapse ground→base→elevated into near-identical browns
 * - borders are *lighter* than the fill (hairline separation), not darker mud
 * - body text stays near white; muted text targets ~4.5:1 on elevated
 * Palette identity comes from a light tint of the seed surface, not from crushing the seed into #050505.
 */
function buildDarkTokens(colors: ThemePaletteColors): ThemeTokenMap {
  const primarySeed = normalizeHexColor(colors.primary, DEFAULT_CUSTOM_THEME_PALETTE.primary);
  const primary = mix(primarySeed, "#FFFFFF", 0.22);
  const surfaceSeed = normalizeHexColor(colors.surface, DEFAULT_CUSTOM_THEME_PALETTE.surface);
  const accent = mix(normalizeHexColor(colors.accent, DEFAULT_CUSTOM_THEME_PALETTE.accent), "#FFFFFF", 0.14);

  // Cool-neutral dark ladder (readable steps), then a gentle seed tint for palette flavor.
  const ground = mix("#12141A", surfaceSeed, 0.07);
  const base = mix("#1C212B", surfaceSeed, 0.08);
  const elevated = mix("#272E3A", surfaceSeed, 0.09);
  const hover = mix("#343C4B", surfaceSeed, 0.08);
  const active = mix("#404959", surfaceSeed, 0.07);

  const textPrimary = mix("#F0F2F5", surfaceSeed, 0.03);
  const textSecondary = mix("#C0C6D0", surfaceSeed, 0.04);
  const textMuted = mix("#A4ACB8", surfaceSeed, 0.03);
  const textPlaceholder = mix("#7B8494", surfaceSeed, 0.03);

  // Borders: lift toward white so cards/sections stay scannable on dark fills.
  const borderSubtle = mix(elevated, "#FFFFFF", 0.14);
  const borderDefault = mix(elevated, "#FFFFFF", 0.22);
  const borderStrong = mix(elevated, "#FFFFFF", 0.34);

  const primaryLight = mix(elevated, primarySeed, 0.28);
  const primarySoft = mix(elevated, primarySeed, 0.42);

  return commonTokens({
    surfaceGround: ground,
    surfaceBase: base,
    surfaceElevated: elevated,
    surfaceHover: hover,
    surfaceActive: active,
    textPrimary,
    textSecondary,
    textMuted,
    textInverse: "#0E1116",
    textPlaceholder,
    borderSubtle,
    borderDefault,
    borderStrong,
    primary,
    primaryLight,
    primarySoft,
    primaryDark: mix(primary, "#FFFFFF", 0.18),
    primaryHover: mix(primary, "#FFFFFF", 0.1),
    secondary: accent,
    secondaryLight: mix(accent, "#0A0C10", 0.7),
    success: "#4ADE80",
    warning: "#FACC15",
    danger: "#F87171",
    dangerLight: "#3F1D1D",
    overlayBg: "rgba(8, 10, 14, 0.72)",
    infoBgSoft: mix(primary, "#0A0C10", 0.78),
    infoBorder: mix(primary, "#0A0C10", 0.48),
    infoText: mix(primary, "#FFFFFF", 0.62),
    infoTextSecondary: mix(primary, "#FFFFFF", 0.42),
    warningBg: mix(accent, "#0A0C10", 0.76),
    warningBorder: mix(accent, "#0A0C10", 0.48),
    warningText: mix(accent, "#FFFFFF", 0.62),
    warningTextSecondary: mix(accent, "#FFFFFF", 0.42),
    successBg: "#1A2E24",
    successBorder: "#2F5640",
    successText: "#A6E3B5",
    progressTrack: mix(base, "#FFFFFF", 0.08),
    mediaThumbBg: base,
    strongButtonBg: mix("#F2F4F7", surfaceSeed, 0.06),
    strongButtonText: "#12161E",
    composerShadow: "0 1px 0 rgba(255, 255, 255, 0.04), 0 8px 24px rgba(0, 0, 0, 0.35)",
    floatShadow: "0 0 0 1px rgba(255, 255, 255, 0.06), 0 18px 48px rgba(0, 0, 0, 0.45)",
  });
}

function commonTokens(input: {
  surfaceGround: string;
  surfaceBase: string;
  surfaceElevated: string;
  surfaceHover: string;
  surfaceActive: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  textPlaceholder: string;
  borderSubtle: string;
  borderDefault: string;
  borderStrong: string;
  primary: string;
  primaryLight: string;
  primarySoft: string;
  primaryDark: string;
  primaryHover: string;
  secondary: string;
  secondaryLight: string;
  success: string;
  warning: string;
  danger: string;
  dangerLight: string;
  overlayBg: string;
  infoBgSoft: string;
  infoBorder: string;
  infoText: string;
  infoTextSecondary: string;
  warningBg: string;
  warningBorder: string;
  warningText: string;
  warningTextSecondary: string;
  successBg: string;
  successBorder: string;
  successText: string;
  progressTrack: string;
  mediaThumbBg: string;
  strongButtonBg: string;
  strongButtonText: string;
  composerShadow: string;
  floatShadow: string;
}): ThemeTokenMap {
  return {
    "--surface-ground": input.surfaceGround,
    "--surface-base": input.surfaceBase,
    "--surface-elevated": input.surfaceElevated,
    "--surface-hover": input.surfaceHover,
    "--surface-active": input.surfaceActive,
    "--text-primary": input.textPrimary,
    "--text-secondary": input.textSecondary,
    "--text-muted": input.textMuted,
    "--text-inverse": input.textInverse,
    "--text-placeholder": input.textPlaceholder,
    "--border-subtle": input.borderSubtle,
    "--border-default": input.borderDefault,
    "--border-strong": input.borderStrong,
    "--accent-primary": input.primary,
    "--accent-primary-light": input.primaryLight,
    "--accent-primary-soft": input.primarySoft,
    "--accent-primary-dark": input.primaryDark,
    "--kimix-primary-button-hover": input.primaryHover,
    "--accent-secondary": input.secondary,
    "--accent-secondary-light": input.secondaryLight,
    "--accent-success": input.success,
    "--accent-success-light": input.successBg,
    "--accent-warning": input.warning,
    "--accent-warning-light": input.warningBg,
    "--accent-danger": input.danger,
    "--accent-danger-light": input.dangerLight,
    "--kimix-overlay-bg": input.overlayBg,
    "--kimix-info-bg": input.primaryLight,
    "--kimix-info-bg-soft": input.infoBgSoft,
    "--kimix-info-border": input.infoBorder,
    "--kimix-info-text": input.infoText,
    "--kimix-info-text-secondary": input.infoTextSecondary,
    "--kimix-warning-bg": input.warningBg,
    "--kimix-warning-border": input.warningBorder,
    "--kimix-warning-text": input.warningText,
    "--kimix-warning-text-secondary": input.warningTextSecondary,
    "--kimix-success-bg": input.successBg,
    "--kimix-success-border": input.successBorder,
    "--kimix-success-text": input.successText,
    "--kimix-progress-track": input.progressTrack,
    "--kimix-progress-fill": input.textMuted,
    "--kimix-media-thumb-bg": input.mediaThumbBg,
    "--kimix-strong-button-bg": input.strongButtonBg,
    "--kimix-strong-button-text": input.strongButtonText,
    "--kimix-composer-shadow": input.composerShadow,
    "--kimix-float-shadow": input.floatShadow,
  };
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = normalizeHexColor(hex, "#000000");
  return [
    parseInt(normalized.slice(1, 3), 16),
    parseInt(normalized.slice(3, 5), 16),
    parseInt(normalized.slice(5, 7), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function mix(from: string, to: string, amount: number) {
  const left = hexToRgb(from);
  const right = hexToRgb(to);
  return rgbToHex(
    left[0] + (right[0] - left[0]) * amount,
    left[1] + (right[1] - left[1]) * amount,
    left[2] + (right[2] - left[2]) * amount,
  );
}
