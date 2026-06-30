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
      primary: "#1982FF",
      surface: "#EDE9E0",
      accent: "#B85C38",
    },
  },
  {
    id: "neutral-gray",
    label: "灰白",
    description: "更纯净、低饱和的工作台",
    colors: {
      primary: "#2563EB",
      surface: "#E5E7EB",
      accent: "#64748B",
    },
  },
  {
    id: "soft-green",
    label: "淡绿",
    description: "轻柔的绿色背景和自然强调",
    colors: {
      primary: "#168A5B",
      surface: "#E3EFE4",
      accent: "#7DA56B",
    },
  },
  {
    id: "warm-orange",
    label: "暖橙",
    description: "更明亮、有活力的暖色调",
    colors: {
      primary: "#E8752A",
      surface: "#F1E4D5",
      accent: "#B56A36",
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
  const surfaceSeed = dark ? "#17191D" : "#F1F3F5";
  const elevatedSeed = dark ? "#202329" : "#FFFFFF";
  const textPrimary = colors.textStrong || colors.text;
  const primaryLight = dark ? mix(colors.primary, "#050505", 0.72) : mix(colors.primary, "#FFFFFF", 0.88);
  const warningBg = dark ? mix(colors.warning, "#050505", 0.76) : mix(colors.warning, "#FFFFFF", 0.9);
  const successBg = dark ? mix(colors.success, "#050505", 0.76) : mix(colors.success, "#FFFFFF", 0.9);
  const dangerBg = dark ? mix(colors.error, "#050505", 0.76) : mix(colors.error, "#FFFFFF", 0.9);

  return commonTokens({
    surfaceGround: dark ? mix(colors.text, "#050505", 0.86) : mix(colors.text, "#FFFFFF", 0.95),
    surfaceBase: dark ? surfaceSeed : mix(colors.border, "#FFFFFF", 0.82),
    surfaceElevated: elevatedSeed,
    surfaceHover: dark ? mix(colors.border, "#050505", 0.64) : mix(colors.border, "#FFFFFF", 0.78),
    surfaceActive: dark ? mix(colors.border, "#050505", 0.54) : mix(colors.border, "#FFFFFF", 0.68),
    textPrimary,
    textSecondary: colors.textDim,
    textMuted: colors.textMuted,
    textInverse: dark ? "#101214" : "#FFFFFF",
    textPlaceholder: mix(colors.textMuted, dark ? "#050505" : "#FFFFFF", 0.38),
    borderSubtle: mix(colors.border, dark ? "#050505" : "#FFFFFF", 0.46),
    borderDefault: colors.border,
    borderStrong: colors.borderFocus,
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
  const surface = normalizeHexColor(colors.surface, DEFAULT_CUSTOM_THEME_PALETTE.surface);
  const accent = normalizeHexColor(colors.accent, DEFAULT_CUSTOM_THEME_PALETTE.accent);
  const textBase = mix(surface, "#090909", 0.9);
  const textSecondary = mix(surface, "#171717", 0.58);
  const textMuted = mix(surface, "#171717", 0.38);
  const border = mix(surface, "#5D5D5D", 0.22);
  const borderStrong = mix(surface, "#404040", 0.32);

  return commonTokens({
    surfaceGround: surface,
    surfaceBase: mix(surface, "#FFFFFF", preserveWarmPaperDepth ? 0.68 : 0.48),
    surfaceElevated: "#FFFFFF",
    surfaceHover: mix(surface, "#FFFFFF", preserveWarmPaperDepth ? 0.42 : 0.24),
    surfaceActive: mix(surface, "#D8D8D8", preserveWarmPaperDepth ? 0.2 : 0.18),
    textPrimary: textBase,
    textSecondary,
    textMuted,
    textInverse: "#FFFFFF",
    textPlaceholder: mix(surface, "#171717", 0.24),
    borderSubtle: mix(surface, "#FFFFFF", preserveWarmPaperDepth ? 0.36 : 0.18),
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

function buildDarkTokens(colors: ThemePaletteColors): ThemeTokenMap {
  const primarySeed = normalizeHexColor(colors.primary, DEFAULT_CUSTOM_THEME_PALETTE.primary);
  const primary = mix(primarySeed, "#FFFFFF", 0.2);
  const surfaceSeed = normalizeHexColor(colors.surface, DEFAULT_CUSTOM_THEME_PALETTE.surface);
  const accent = mix(normalizeHexColor(colors.accent, DEFAULT_CUSTOM_THEME_PALETTE.accent), "#FFFFFF", 0.12);
  const ground = mix(surfaceSeed, "#050505", 0.95);
  const base = mix(surfaceSeed, "#050505", 0.89);
  const elevated = mix(surfaceSeed, "#050505", 0.84);
  const hover = mix(surfaceSeed, "#050505", 0.78);
  const active = mix(surfaceSeed, "#050505", 0.73);
  const primaryLight = mix(elevated, primarySeed, 0.2);
  const primarySoft = mix(elevated, primarySeed, 0.36);

  return commonTokens({
    surfaceGround: ground,
    surfaceBase: base,
    surfaceElevated: elevated,
    surfaceHover: hover,
    surfaceActive: active,
    textPrimary: mix(surfaceSeed, "#FFFFFF", 0.9),
    textSecondary: mix(surfaceSeed, "#FFFFFF", 0.62),
    textMuted: mix(surfaceSeed, "#FFFFFF", 0.4),
    textInverse: "#12100E",
    textPlaceholder: mix(surfaceSeed, "#FFFFFF", 0.25),
    borderSubtle: mix(surfaceSeed, "#050505", 0.48),
    borderDefault: mix(surfaceSeed, "#FFFFFF", 0.22),
    borderStrong: mix(surfaceSeed, "#FFFFFF", 0.3),
    primary,
    primaryLight,
    primarySoft,
    primaryDark: mix(primary, "#FFFFFF", 0.16),
    primaryHover: mix(primary, "#FFFFFF", 0.08),
    secondary: accent,
    secondaryLight: mix(accent, "#050505", 0.74),
    success: "#4ADE80",
    warning: "#FACC15",
    danger: "#F87171",
    dangerLight: "#3A1A1A",
    overlayBg: "rgba(5, 7, 10, 0.78)",
    infoBgSoft: mix(primary, "#050505", 0.78),
    infoBorder: mix(primary, "#050505", 0.55),
    infoText: mix(primary, "#FFFFFF", 0.58),
    infoTextSecondary: mix(primary, "#FFFFFF", 0.36),
    warningBg: mix(accent, "#050505", 0.78),
    warningBorder: mix(accent, "#050505", 0.55),
    warningText: mix(accent, "#FFFFFF", 0.58),
    warningTextSecondary: mix(accent, "#FFFFFF", 0.36),
    successBg: "#1A2C22",
    successBorder: "#2A4A38",
    successText: "#98D8A8",
    progressTrack: mix(surfaceSeed, "#050505", 0.58),
    mediaThumbBg: base,
    strongButtonBg: mix(surfaceSeed, "#FFFFFF", 0.88),
    strongButtonText: "#18202A",
    composerShadow: "0 1px 2px rgba(5, 8, 11, 0.28)",
    floatShadow: "0 16px 42px rgba(3, 5, 8, 0.3)",
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
