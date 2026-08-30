import {
  parseUiStyleDocument,
  UI_STYLE_ROLE_GUIDE,
  UI_STYLE_ROLE_IDS,
  UI_STYLE_ROLE_RADIUS_MAX_PX,
  UI_STYLE_DESCRIPTION_MAX_LENGTH,
  DEFAULT_UI_STYLE_PALETTE,
  type UiStyleDocumentV1,
  type UiStyleRole,
  type UiStyleRoleId,
  type UiStyleTreatment,
} from "./uiStyleContract";
import type { UiStyleId } from "../types/ui";

export type BuiltinUiStyleId = Exclude<UiStyleId, `custom:${string}`>;

const flat: UiStyleTreatment = { surface: "transparent", border: "none", elevation: "none" };
const quietHover: UiStyleTreatment = { surface: "hover", border: "subtle", elevation: "none" };
const raisedHover: UiStyleTreatment = { surface: "hover", border: "default", elevation: "control" };
const pressed: UiStyleTreatment = { surface: "active", border: "default", elevation: "field" };
const selected: UiStyleTreatment = { surface: "active", border: "subtle", elevation: "field" };
const elevated: UiStyleTreatment = { surface: "elevated", border: "subtle", elevation: "card" };
const strongElevated: UiStyleTreatment = { surface: "elevated", border: "default", elevation: "card" };
const floating: UiStyleTreatment = { surface: "elevated", border: "default", elevation: "popup" };
const inset: UiStyleTreatment = { surface: "base", border: "default", elevation: "field" };

function role(radius: UiStyleRole["radius"], resting: UiStyleTreatment, overrides: Partial<UiStyleRole> = {}): UiStyleRole {
  return { radius, resting, ...overrides };
}

function buildRoles(variant: BuiltinUiStyleId): Record<UiStyleRoleId, UiStyleRole> {
  const modern = variant === "modern";
  const classic = variant === "retro" || variant === "nostalgia";
  const controlHover = classic ? raisedHover : quietHover;
  const baseCard: UiStyleTreatment = { surface: "base", border: "subtle", elevation: "none" };
  const sectionCard: UiStyleTreatment = classic
    ? { surface: "elevated", border: "default", elevation: "card" }
    : { surface: "elevated", border: "subtle", elevation: "none" };
  const roles = Object.fromEntries(UI_STYLE_ROLE_IDS.map((id) => [id, role("medium", flat)])) as Record<UiStyleRoleId, UiStyleRole>;

  roles.shell = role("shell", {
    surface: modern ? "elevated" : "base",
    border: classic ? "default" : "subtle",
    elevation: classic ? "card" : "none",
  });
  roles.toolbar = role("medium", { surface: "base", border: "none", elevation: "none" }, { hover: controlHover, active: pressed });
  roles.navigationItem = role("medium", flat, { hover: controlHover, active: pressed, selected });
  roles.navigationAction = role("medium", flat, { hover: controlHover, active: pressed });
  roles.control = role("medium", flat, { hover: controlHover, active: pressed, focus: selected });
  roles.primaryAction = role("pill", flat, { hover: controlHover, active: pressed });
  roles.compoundControl = role("medium", modern ? elevated : classic ? strongElevated : flat, { hover: controlHover, active: pressed });
  roles.toggle = role("pill", flat, { hover: controlHover, active: pressed, selected });
  roles.field = role("medium", inset, { hover: inset, active: inset, focus: { ...inset, border: "strong" } });
  roles.card = role("card", classic ? { ...baseCard, border: "default", elevation: "card" } : baseCard);
  roles.interactiveCard = role("card", sectionCard, { hover: controlHover, active: pressed });
  roles.strongCard = role("card", strongElevated);
  roles.sectionCard = role("card", sectionCard);
  roles.eventCard = role("card", sectionCard);
  roles.insetSection = role("card", { surface: "base", border: "none", elevation: "none" });
  roles.popup = role("panel", floating);
  roles.menuTrigger = role("medium", flat, { hover: controlHover, active: pressed, selected });
  roles.menuItem = role("medium", flat, { hover: controlHover, active: pressed, selected });
  roles.modal = role("panel", floating);
  roles.composer = role("panel", strongElevated, { focus: { ...strongElevated, border: "strong" } });
  roles.userBubble = role("card", { surface: modern ? "hover" : "elevated", border: modern ? "none" : "subtle", elevation: "none" });
  roles.statusSurface = role("small", { surface: "base", border: classic ? "default" : "subtle", elevation: classic ? "field" : "none" });
  roles.codeBlock = role("small", { surface: "base", border: classic ? "default" : "subtle", elevation: classic ? "field" : "none" });
  roles.table = role("card", modern ? { surface: "elevated", border: "none", elevation: "card" } : inset);
  roles.mediaThumb = role("card", { surface: "base", border: "subtle", elevation: "none" }, { hover: controlHover });
  roles.inspector = role("panel", strongElevated);
  roles.toast = role("panel", floating);
  roles.dock = role("panel", floating);
  roles.roomChoice = role("medium", flat, { hover: controlHover, active: pressed, selected });
  return roles;
}

function createDocument(
  id: BuiltinUiStyleId,
  name: string,
  description: string,
  radius: UiStyleDocumentV1["primitives"]["radius"],
  elevation: UiStyleDocumentV1["primitives"]["elevation"],
  motion: UiStyleDocumentV1["primitives"]["motion"],
): UiStyleDocumentV1 {
  return {
    schemaVersion: 1,
    id,
    name,
    description,
    basedOn: id,
    palette: { ...DEFAULT_UI_STYLE_PALETTE },
    primitives: {
      radius,
      border: {
        controlWidth: id === "modern" ? 1 : 1,
        surfaceWidth: 1,
        focusWidth: 2,
        style: id === "nostalgia" ? "double" : "solid",
      },
      elevation,
      motion,
    },
    roles: buildRoles(id),
  };
}

const quietElevation: UiStyleDocumentV1["primitives"]["elevation"] = {
  control: { kind: "raised", depth: 1, highlightOpacity: 0.18, shadowOpacity: 0.05 },
  card: { kind: "raised", depth: 1, highlightOpacity: 0.14, shadowOpacity: 0.06 },
  popup: { kind: "floating", depth: 4, highlightOpacity: 0.12, shadowOpacity: 0.14 },
  field: { kind: "flat", depth: 0, highlightOpacity: 0, shadowOpacity: 0 },
};

const platinumElevation: UiStyleDocumentV1["primitives"]["elevation"] = {
  control: { kind: "raised", depth: 1, highlightOpacity: 0.7, shadowOpacity: 0.1 },
  card: { kind: "raised", depth: 2, highlightOpacity: 0.6, shadowOpacity: 0.1 },
  popup: { kind: "floating", depth: 4, highlightOpacity: 0.72, shadowOpacity: 0.18 },
  field: { kind: "inset", depth: 1, highlightOpacity: 0.55, shadowOpacity: 0.14 },
};

const bevelElevation: UiStyleDocumentV1["primitives"]["elevation"] = {
  control: { kind: "raised", depth: 2, highlightOpacity: 0.8, shadowOpacity: 0.22 },
  card: { kind: "raised", depth: 2, highlightOpacity: 0.8, shadowOpacity: 0.2 },
  popup: { kind: "floating", depth: 5, highlightOpacity: 0.8, shadowOpacity: 0.26 },
  field: { kind: "inset", depth: 2, highlightOpacity: 0.65, shadowOpacity: 0.24 },
};

export const BUILTIN_UI_STYLE_DOCUMENTS: Record<BuiltinUiStyleId, UiStyleDocumentV1> = {
  default: createDocument(
    "default",
    "Kimix 默认",
    "温和圆角、轻阴影，延续现有熟悉界面。",
    { small: 6, medium: 12, large: 8, card: 12, panel: 16, shell: 16, pill: 999 },
    quietElevation,
    { hoverDuration: 150, panelDuration: 250, easing: "standard" },
  ),
  modern: createDocument(
    "modern",
    "现代化",
    "安静侧栏、大圆角内容区与轻薄悬浮层次。",
    { small: 8, medium: 10, large: 12, card: 14, panel: 18, shell: 20, pill: 999 },
    quietElevation,
    { hoverDuration: 140, panelDuration: 220, easing: "enter" },
  ),
  retro: createDocument(
    "retro",
    "复古",
    "小圆角、清晰描边与克制高光的经典桌面感。",
    { small: 3, medium: 4, large: 5, card: 6, panel: 6, shell: 6, pill: 999 },
    platinumElevation,
    { hoverDuration: 120, panelDuration: 180, easing: "standard" },
  ),
  nostalgia: createDocument(
    "nostalgia",
    "怀旧",
    "直角硬边、立体浮雕与按下内凹的经典桌面。",
    { small: 0, medium: 0, large: 0, card: 0, panel: 0, shell: 0, pill: 0 },
    bevelElevation,
    { hoverDuration: 80, panelDuration: 120, easing: "linear" },
  ),
};

export function getBuiltinUiStyleDocument(id: BuiltinUiStyleId) {
  return BUILTIN_UI_STYLE_DOCUMENTS[id];
}

function harmonizeCompoundControlElevation(
  roles: Record<UiStyleRoleId, UiStyleRole>,
): Record<UiStyleRoleId, UiStyleRole> {
  const control = roles.control;
  const compoundControl: UiStyleRole = { ...roles.compoundControl };
  for (const state of ["resting", "hover", "active"] as const) {
    const compoundTreatment = state === "resting"
      ? compoundControl.resting
      : compoundControl[state] ?? compoundControl.resting;
    const controlTreatment = state === "resting"
      ? control.resting
      : control[state] ?? control.resting;
    const hasCompletePlate = compoundTreatment.surface !== "transparent" && compoundTreatment.border !== "none";
    if (!hasCompletePlate || compoundTreatment.elevation !== "none" || controlTreatment.elevation === "none") continue;
    const nextTreatment = { ...compoundTreatment, elevation: controlTreatment.elevation };
    if (state === "resting") compoundControl.resting = nextTreatment;
    else if (compoundControl[state]) compoundControl[state] = nextTreatment;
  }
  return { ...roles, compoundControl };
}

const QUIET_RESTING_ROLE_IDS = [
  "navigationItem",
  "navigationAction",
  "control",
  "compoundControl",
  "toggle",
  "menuTrigger",
  "menuItem",
  "roomChoice",
] as const satisfies readonly UiStyleRoleId[];

function harmonizeQuietActionResting(
  roles: Record<UiStyleRoleId, UiStyleRole>,
  baseRoles: Record<UiStyleRoleId, UiStyleRole>,
): Record<UiStyleRoleId, UiStyleRole> {
  const normalized = { ...roles };
  for (const roleId of QUIET_RESTING_ROLE_IDS) {
    const baseResting = roleId === "compoundControl"
      ? baseRoles.control.resting
      : baseRoles[roleId].resting;
    normalized[roleId] = {
      ...roles[roleId],
      resting: { ...baseResting },
    };
  }
  return normalized;
}

const EMPHASIZED_SELECTED_ROLE_IDS = [
  "toggle",
  "menuTrigger",
  "menuItem",
  "roomChoice",
] as const satisfies readonly UiStyleRoleId[];

function harmonizeSelectedActionElevation(
  roles: Record<UiStyleRoleId, UiStyleRole>,
  baseRoles: Record<UiStyleRoleId, UiStyleRole>,
): Record<UiStyleRoleId, UiStyleRole> {
  const normalized = { ...roles };
  for (const roleId of EMPHASIZED_SELECTED_ROLE_IDS) {
    const role = roles[roleId];
    const baseSelected = baseRoles[roleId].selected ?? baseRoles[roleId].active ?? baseRoles[roleId].resting;
    if (!role.selected) {
      normalized[roleId] = { ...role, selected: { ...baseSelected } };
      continue;
    }
    const selectedTreatment = role.selected;
    if (selectedTreatment.surface === "transparent" || selectedTreatment.elevation !== "none") continue;
    normalized[roleId] = {
      ...role,
      selected: { ...selectedTreatment, elevation: baseSelected.elevation },
    };
  }
  return normalized;
}

export function canonicalizeCustomUiStyleDocument(value: unknown): UiStyleDocumentV1 | null {
  const parsed = parseUiStyleDocument(value);
  if (!parsed.success) return null;
  const base = BUILTIN_UI_STYLE_DOCUMENTS[parsed.data.basedOn];
  const baseRoles = base.roles as Record<UiStyleRoleId, UiStyleRole>;
  const mergedRoles = { ...baseRoles, ...parsed.data.roles } as Record<UiStyleRoleId, UiStyleRole>;
  const harmonizedRoles = harmonizeCompoundControlElevation(mergedRoles);
  const quietRoles = harmonizeQuietActionResting(harmonizedRoles, baseRoles);
  return {
    ...parsed.data,
    roles: harmonizeSelectedActionElevation(quietRoles, baseRoles),
  };
}

export function normalizeCustomUiStyleDocuments(value: unknown): UiStyleDocumentV1[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, UiStyleDocumentV1>();
  for (const item of value) {
    const migratedItem = item && typeof item === "object" && !Array.isArray(item) && typeof (item as { description?: unknown }).description === "string"
      ? {
          ...item,
          description: (item as { description: string }).description.trim().slice(0, UI_STYLE_DESCRIPTION_MAX_LENGTH),
        }
      : item;
    const document = canonicalizeCustomUiStyleDocument(migratedItem);
    if (document) byId.set(document.id, document);
  }
  return [...byId.values()];
}

/**
 * 解析实际应用窗口使用的 shell 半径。主进程和 renderer 共用同一纯函数，
 * 避免原生窗口裁切与 CSS 外壳在切换风格后出现两套几何。
 */
export function resolveUiStyleShellRadius(
  value: unknown,
  customDocuments: UiStyleDocumentV1[] = [],
): number {
  const builtinId = value === "modern" || value === "retro" || value === "nostalgia"
    ? value
    : "default";
  let document = BUILTIN_UI_STYLE_DOCUMENTS[builtinId];
  if (typeof value === "string" && value.startsWith("custom:")) {
    const candidate = customDocuments.find((item) => `custom:${item.id}` === value);
    const canonical = candidate ? canonicalizeCustomUiStyleDocument(candidate) : null;
    if (canonical) document = canonical;
  }
  const role = document.roles.shell
    ?? BUILTIN_UI_STYLE_DOCUMENTS[document.basedOn].roles.shell
    ?? BUILTIN_UI_STYLE_DOCUMENTS.default.roles.shell!;
  const rawRadius = document.primitives.radius[role.radius];
  return Math.max(0, Math.min(UI_STYLE_ROLE_RADIUS_MAX_PX.shell, Math.round(rawRadius)));
}

export function buildUiStyleAiPrompt(inboxDir?: string) {
  const template: UiStyleDocumentV1 = {
    ...BUILTIN_UI_STYLE_DOCUMENTS.default,
    $schema: "https://kimix.app/schemas/ui-style-v1.json",
    id: "replace-with-style-id",
    name: "替换为风格名称",
    description: "用不超过 48 个中文字符概括形状与质感",
    author: "AI generated",
  };
  return [
    "你是一名 Kimix 界面风格与色彩设计师。请根据我随后提供的参考图片或关键词，生成一份 Kimix UI Style v1 JSON。",
    "",
    "硬性要求：",
    "1. 分析形状、圆角、边框宽度、浮雕/内凹/悬浮层次、控件状态、动效倾向，以及与该风格匹配的色彩气质。",
    "2. palette 必须提供 primary、surface、accent 三个 #RRGGBB 色值：primary 用于主操作与焦点，surface 用作界面底色种子，accent 用于少量强调。三色要与风格目标协调，并同时考虑 Kimix 自动生成的明暗模式。",
    "3. 忽略参考图中的字体、间距和布局；除 palette 三个字段外，JSON 中禁止出现其他颜色值、CSS、选择器、url() 或脚本。",
    "4. schemaVersion 必须是 1；id 只能使用小写字母、数字、点、下划线和连字符。",
    `5. description 必须简洁，硬性上限为 ${UI_STYLE_DESCRIPTION_MAX_LENGTH} 个字符（包含标点与空格），超出后 Kimix 会拒绝导入；只概括最有辨识度的形状与质感，不逐项罗列控件。`,
    "6. basedOn 只能是 default、modern、retro、nostalgia 之一。",
    "7. roles 只写你有意改变的角色；未写角色由 basedOn 自动继承。禁止新增下列目录之外的角色，也不要为了看起来完整而机械重写全部角色。",
    "8. 角色触点目录：",
    ...UI_STYLE_ROLE_IDS.map((roleId) => `- ${roleId}: ${UI_STYLE_ROLE_GUIDE[roleId]}`),
    "9. Composer 内层 textarea 永远无边框、无背景、无阴影；输入区质感只能配置 composer 外壳，禁止试图通过 field 制造第二层边界。",
    "10. 顶部 compoundControl 的 resting 与普通次级按钮一样保持克制；hover/active 若使用 raised/floating 材质，应与普通 control 的交互层次一致。",
    "11. 普通交互角色（navigationItem/navigationAction/control/compoundControl/toggle/menuTrigger/menuItem/roomChoice）的 resting 由 basedOn 保持克制，导入时会自动忽略这些角色自定义的高强调 resting；toggle/menuTrigger/menuItem/roomChoice 的非透明 selected 必须保持立体 elevation，缺失时继承 basedOn 对应角色的 selected/active 深度（复古与怀旧通常为按下内凹）。请重点设计 hover、active、selected，确保顶部启动/打开、Swarm/Plan 等按钮只在悬停、展开或选中时醒目。",
    "12. radius 引用只能是 small、medium、large、card、panel、shell、pill。pill 只用于 navigationItem、navigationAction、control、primaryAction、compoundControl、toggle、menuTrigger、statusSurface 等紧凑单行控件；正文气泡、模态框、Composer、卡片、弹层和侧栏禁止使用 pill。Kimix 还会把内容承载角色按语义硬限制在 20–32px，避免文字侵入圆角。",
    "13. surface 只能是 transparent、ground、base、elevated、hover、active。",
    "14. border 只能是 none、subtle、default、strong；elevation 只能是 none、control、card、popup、field。",
    "15. elevation.kind 只能是 flat、raised、floating、inset；所有数值必须保持在模板展示的合理量级内。",
    "16. 对比度是硬指标：palette.surface 与正文文字、primary 之间必须有足够明度差，明暗两种自动生成模式下文字都必须清晰可读；相邻容器层级（页面底色→分区卡→浮层/弹窗）必须通过 surface 明度阶梯、边框或阴影形成肉眼可分辨的分隔，禁止所有容器共用同一 surface 且 border 全 none。",
    "17. 状态反馈必须可感知：hover/active/selected 与 resting 之间要有明显的明度、边框或浮雕差异，selected 必须一眼能认出当前选中项；subtle 边框可以淡，但在所选底色上必须仍然可见，禁止淡到近乎消失。",
    ...(inboxDir
      ? [
        `18. 完成 JSON 后，必须优先使用你可用的文件工具，把最终 JSON 写入 Kimix 界面风格收件箱目录 \`${inboxDir}\` 下的 \`kimix-ui-style-<id>.json\` 文件（\`<id>\` 使用最终 JSON 中的 id；目录通常已存在，若不存在就先创建）。这是 Kimix 的自动导入通道：文件写入后 Kimix 会自动校验、导入并立即启用该风格，无需用户手动操作。文件必须是 UTF-8 编码的纯 JSON，不得包含 Markdown 代码围栏或 JSON 注释。`,
        "19. 文件创建成功后，不要在对话中重复整份 JSON，只需简洁说明已创建、给出文件路径，并告知用户 Kimix 会自动导入并启用该风格。",
      ]
      : [
        "18. 完成 JSON 后，必须优先使用你可用的文件工具在当前工作目录创建 `kimix-ui-style-<id>.json`；`<id>` 使用最终 JSON 中的 id。文件必须是 UTF-8 编码的纯 JSON，不得包含 Markdown 代码围栏或 JSON 注释。",
        "19. 文件创建成功后，不要在对话中重复整份 JSON，只需简洁说明已创建并给出可点击或可复制的文件路径。",
      ]),
    "20. 只有当当前环境确实没有文件写入能力时，才允许降级为在对话中输出一个 JSON 代码块，并明确说明未能创建文件。",
    "",
    "请以这份完整模板为结构生成结果：",
    "```json",
    JSON.stringify(template, null, 2),
    "```",
  ].join("\n");
}
