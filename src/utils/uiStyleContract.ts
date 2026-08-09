import { z } from "zod";

export const UI_STYLE_SCHEMA_VERSION = 1 as const;
export const UI_STYLE_DESCRIPTION_MAX_LENGTH = 48 as const;

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

/**
 * 内容承载角色的圆角必须有可读性上限；紧凑、固定高度的控件才允许真正的 pill。
 * 这是编译期防线，历史已导入文档也会自动收敛，无需迁移或修改原 JSON。
 */
export const UI_STYLE_ROLE_RADIUS_MAX_PX: Record<UiStyleRoleId, number> = {
  shell: 32,
  toolbar: 24,
  navigationItem: 999,
  navigationAction: 999,
  control: 999,
  primaryAction: 999,
  compoundControl: 999,
  toggle: 999,
  field: 24,
  card: 24,
  interactiveCard: 24,
  strongCard: 28,
  sectionCard: 24,
  insetSection: 24,
  eventCard: 24,
  popup: 28,
  menuTrigger: 999,
  menuItem: 20,
  modal: 28,
  composer: 28,
  userBubble: 28,
  statusSurface: 999,
  codeBlock: 20,
  table: 24,
  mediaThumb: 24,
  inspector: 28,
  toast: 28,
  dock: 28,
  roomChoice: 24,
};

/** AI 提示与文档共用的角色触点目录；描述业务归属，不允许 JSON 携带选择器。 */
export const UI_STYLE_ROLE_GUIDE: Record<UiStyleRoleId, string> = {
  shell: "应用主内容外壳",
  toolbar: "顶部与底部工具栏表面",
  navigationItem: "侧栏项目、会话和设置导航项",
  navigationAction: "侧栏新增、刷新等图标操作；随行显形的成组操作静止透明，仅在单按钮悬停、聚焦或按下时显示材质",
  control: "普通工具按钮、窗口按钮和次要操作；Agent 过程消息头与游离的可展开思考摘要仅在悬停、聚焦或按下时显示此材质",
  primaryAction: "发送、保存等主要操作",
  compoundControl: "顶部启动与打开文件的分段复合按钮",
  toggle: "Composer 中的 Swarm、Plan 等模式开关",
  field: "设置输入框与独立表单字段；不包括 Composer 内层 textarea",
  card: "普通内容卡片",
  interactiveCard: "可点击或可选择卡片",
  strongCard: "需要更强层次的主卡片",
  sectionCard: "侧栏检查器与内容分区卡",
  insetSection: "卡片内部的内嵌内容区",
  eventCard: "审批、问题、错误等事件卡",
  popup: "弹出面板与下拉面板",
  menuTrigger: "菜单标题和菜单触发按钮",
  menuItem: "菜单中的可操作条目",
  modal: "模态框与引导卡外壳",
  composer: "Composer 整体输入外壳；它是输入区唯一边界所有者",
  userBubble: "用户消息气泡",
  statusSurface: "状态胶囊与行内状态面",
  codeBlock: "Markdown 代码块",
  table: "Markdown 表格外框",
  mediaThumb: "图片与媒体缩略图",
  inspector: "检查器、Diff 和模型侧栏",
  toast: "通知和对话导航预览",
  dock: "底部停靠面板与胶囊",
  roomChoice: "多 Agent 房间中的模型、权限和范围选项",
};

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
  description: z.string().trim().max(
    UI_STYLE_DESCRIPTION_MAX_LENGTH,
    `description 不能超过 ${UI_STYLE_DESCRIPTION_MAX_LENGTH} 个字符`,
  ).default(""),
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
    const radiusReference = `var(--ui-radius-${kebabCase(role.radius)})`;
    const radiusMax = UI_STYLE_ROLE_RADIUS_MAX_PX[roleKey];
    variables[`${rolePrefix}-radius`] = radiusMax >= 999
      ? radiusReference
      : `min(${radiusReference}, ${radiusMax}px)`;
    treatmentVariables(variables, roleKey, "resting", role.resting, document);
    for (const state of ["hover", "active", "selected", "focus"] as const) {
      treatmentVariables(variables, roleKey, state, role[state] ?? role.resting, document);
    }
  }
  return variables;
}
