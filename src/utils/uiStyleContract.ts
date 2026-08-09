import { z } from "zod";

export const UI_STYLE_SCHEMA_VERSION = 1 as const;

export const UI_STYLE_ROLE_IDS = [
  "shell",
  "toolbar",
  "navigationItem",
  "navigationAction",
  "control",
  "primaryAction",
  "compoundControl",
  "toggle",
  "field",
  "card",
  "interactiveCard",
  "strongCard",
  "sectionCard",
  "insetSection",
  "eventCard",
  "popup",
  "menuTrigger",
  "menuItem",
  "modal",
  "composer",
  "userBubble",
  "statusSurface",
  "codeBlock",
  "table",
  "mediaThumb",
  "inspector",
  "toast",
  "dock",
  "roomChoice",
] as const;

export type UiStyleRoleId = typeof UI_STYLE_ROLE_IDS[number];

const radiusTokenSchema = z.enum(["small", "medium", "large", "card", "panel", "shell", "pill"]);
const surfaceTokenSchema = z.enum(["transparent", "ground", "base", "elevated", "hover", "active"]);
const borderTokenSchema = z.enum(["none", "subtle", "default", "strong"]);
const elevationTokenSchema = z.enum(["none", "control", "card", "popup", "field"]);
const elevationKindSchema = z.enum(["flat", "raised", "floating", "inset"]);
const easingSchema = z.enum(["linear", "standard", "enter", "bounce"]);

const treatmentSchema = z.object({
  surface: surfaceTokenSchema,
  border: borderTokenSchema,
  elevation: elevationTokenSchema,
}).strict();

const roleSchema = z.object({
  radius: radiusTokenSchema,
  resting: treatmentSchema,
  hover: treatmentSchema.optional(),
  active: treatmentSchema.optional(),
  selected: treatmentSchema.optional(),
  focus: treatmentSchema.optional(),
}).strict();

const elevationSchema = z.object({
  kind: elevationKindSchema,
  depth: z.number().min(0).max(12),
  highlightOpacity: z.number().min(0).max(0.8),
  shadowOpacity: z.number().min(0).max(0.5),
}).strict();

const partialRolesSchema = z.record(z.enum(UI_STYLE_ROLE_IDS), roleSchema).superRefine((roles, context) => {
  for (const key of Object.keys(roles)) {
    if (!UI_STYLE_ROLE_IDS.includes(key as UiStyleRoleId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `未知界面角色：${key}` });
    }
  }
});

export const uiStyleDocumentV1Schema = z.object({
  $schema: z.string().max(240).optional(),
  schemaVersion: z.literal(UI_STYLE_SCHEMA_VERSION),
  id: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]*$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).default(""),
  author: z.string().trim().max(80).optional(),
  basedOn: z.enum(["default", "modern", "retro", "nostalgia"]),
  primitives: z.object({
    radius: z.object({
      small: z.number().min(0).max(32),
      medium: z.number().min(0).max(32),
      large: z.number().min(0).max(40),
      card: z.number().min(0).max(40),
      panel: z.number().min(0).max(48),
      shell: z.number().min(0).max(48),
      pill: z.number().min(0).max(999),
    }).strict(),
    border: z.object({
      controlWidth: z.number().min(0).max(3),
      surfaceWidth: z.number().min(0).max(3),
      focusWidth: z.number().min(1).max(4),
      style: z.enum(["solid", "double"]),
    }).strict(),
    elevation: z.object({
      control: elevationSchema,
      card: elevationSchema,
      popup: elevationSchema,
      field: elevationSchema,
    }).strict(),
    motion: z.object({
      hoverDuration: z.number().int().min(0).max(500),
      panelDuration: z.number().int().min(0).max(1000),
      easing: easingSchema,
    }).strict(),
  }).strict(),
  roles: partialRolesSchema,
}).strict();

export type UiStyleDocumentV1 = z.infer<typeof uiStyleDocumentV1Schema>;
export type UiStyleRole = z.infer<typeof roleSchema>;
export type UiStyleTreatment = z.infer<typeof treatmentSchema>;
export type UiStyleCssVariables = Record<`--ui-${string}`, string>;

export type UiStyleParseResult =
  | { success: true; data: UiStyleDocumentV1 }
  | { success: false; errors: string[] };

const SURFACE_VARIABLES = {
  transparent: "transparent",
  ground: "var(--surface-ground)",
  base: "var(--surface-base)",
  elevated: "var(--surface-elevated)",
  hover: "var(--surface-hover)",
  active: "var(--surface-active)",
} as const;

const BORDER_COLOR_VARIABLES = {
  none: "transparent",
  subtle: "var(--border-subtle)",
  default: "var(--border-default)",
  strong: "var(--border-strong)",
} as const;

const EASING_VARIABLES = {
  linear: "linear",
  standard: "cubic-bezier(0.4, 0, 0.2, 1)",
  enter: "cubic-bezier(0.16, 1, 0.3, 1)",
  bounce: "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;

function kebabCase(value: string) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function opacityPercent(value: number) {
  return `${Math.round(value * 10000) / 100}%`;
}

function elevationShadow(elevation: z.infer<typeof elevationSchema>) {
  if (elevation.kind === "flat" || elevation.depth === 0) return "none";
  const depth = elevation.depth;
  const highlight = `color-mix(in srgb, var(--surface-elevated) ${opacityPercent(elevation.highlightOpacity)}, transparent)`;
  const shadow = `color-mix(in srgb, var(--text-primary) ${opacityPercent(elevation.shadowOpacity)}, transparent)`;
  if (elevation.kind === "inset") {
    return `inset 0 ${Math.max(1, Math.round(depth / 2))}px ${Math.max(1, depth * 2)}px ${shadow}, 0 1px 0 ${highlight}`;
  }
  const y = elevation.kind === "floating" ? Math.max(4, depth * 2) : Math.max(1, depth);
  const blur = elevation.kind === "floating" ? Math.max(10, depth * 6) : Math.max(2, depth * 4);
  return `inset 0 1px 0 ${highlight}, 0 ${y}px ${blur}px ${shadow}`;
}

function treatmentVariables(
  variables: UiStyleCssVariables,
  roleId: UiStyleRoleId,
  state: "resting" | "hover" | "active" | "selected" | "focus",
  treatment: UiStyleTreatment,
  document: UiStyleDocumentV1,
) {
  const prefix = `--ui-role-${kebabCase(roleId)}-${state}` as const;
  const borderWidth = treatment.border === "none"
    ? 0
    : roleId === "field"
      ? document.primitives.border.controlWidth
      : document.primitives.border.surfaceWidth;
  const elevation = treatment.elevation === "none"
    ? "none"
    : elevationShadow(document.primitives.elevation[treatment.elevation]);
  variables[`${prefix}-background`] = SURFACE_VARIABLES[treatment.surface];
  variables[`${prefix}-border`] = `${borderWidth}px ${document.primitives.border.style} ${BORDER_COLOR_VARIABLES[treatment.border]}`;
  variables[`${prefix}-shadow`] = elevation;
}

export function parseUiStyleDocument(value: unknown): UiStyleParseResult {
  const parsed = uiStyleDocumentV1Schema.safeParse(value);
  if (parsed.success) return { success: true, data: parsed.data };
  return {
    success: false,
    errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
  };
}

export function compileUiStyleVariables(document: UiStyleDocumentV1): UiStyleCssVariables {
  const variables: UiStyleCssVariables = {};
  const { radius, border, elevation, motion } = document.primitives;
  for (const [key, value] of Object.entries(radius)) {
    variables[`--ui-radius-${kebabCase(key)}`] = `${value}px`;
  }
  // Tailwind 与既有 Kimix token 继续消费这组兼容别名；公开 JSON 使用更清晰的完整名称。
  variables["--ui-radius-sm"] = `${radius.small}px`;
  variables["--ui-radius-md"] = `${radius.medium}px`;
  variables["--ui-radius-lg"] = `${radius.large}px`;
  variables["--ui-radius-xl"] = `${radius.card}px`;
  variables["--ui-radius-2xl"] = `${radius.panel}px`;
  variables["--ui-radius-sm-token"] = `${radius.small}px`;
  variables["--ui-radius-md-token"] = `${radius.medium}px`;
  variables["--ui-radius-lg-token"] = `${radius.large}px`;
  variables["--ui-border-control-width"] = `${border.controlWidth}px`;
  variables["--ui-border-surface-width"] = `${border.surfaceWidth}px`;
  variables["--ui-border-focus-width"] = `${border.focusWidth}px`;
  variables["--ui-border-style"] = border.style;
  variables["--ui-elevation-control"] = elevationShadow(elevation.control);
  variables["--ui-elevation-card"] = elevationShadow(elevation.card);
  variables["--ui-elevation-popup"] = elevationShadow(elevation.popup);
  variables["--ui-elevation-field"] = elevationShadow(elevation.field);
  variables["--ui-motion-hover-duration"] = `${motion.hoverDuration}ms`;
  variables["--ui-motion-panel-duration"] = `${motion.panelDuration}ms`;
  variables["--ui-motion-easing"] = EASING_VARIABLES[motion.easing];

  for (const [roleKey, role] of Object.entries(document.roles) as [UiStyleRoleId, UiStyleRole][]) {
    const rolePrefix = `--ui-role-${kebabCase(roleKey)}` as const;
    variables[`${rolePrefix}-radius`] = `var(--ui-radius-${kebabCase(role.radius)})`;
    treatmentVariables(variables, roleKey, "resting", role.resting, document);
    for (const state of ["hover", "active", "selected", "focus"] as const) {
      treatmentVariables(variables, roleKey, state, role[state] ?? role.resting, document);
    }
  }
  return variables;
}
