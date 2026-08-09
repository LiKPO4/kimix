import {
  parseUiStyleDocument,
  UI_STYLE_ROLE_IDS,
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
    { small: 6, medium: 12, large: 8, card: 12, panel: 16, shell: 20, pill: 999 },
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

export function canonicalizeCustomUiStyleDocument(value: unknown): UiStyleDocumentV1 | null {
  const parsed = parseUiStyleDocument(value);
  if (!parsed.success) return null;
  const base = BUILTIN_UI_STYLE_DOCUMENTS[parsed.data.basedOn];
  return {
    ...parsed.data,
    roles: { ...base.roles, ...parsed.data.roles },
  };
}

export function normalizeCustomUiStyleDocuments(value: unknown): UiStyleDocumentV1[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, UiStyleDocumentV1>();
  for (const item of value) {
    const document = canonicalizeCustomUiStyleDocument(item);
    if (document) byId.set(document.id, document);
  }
  return [...byId.values()];
}

export function buildUiStyleAiPrompt() {
  const template: UiStyleDocumentV1 = {
    ...BUILTIN_UI_STYLE_DOCUMENTS.default,
    $schema: "https://kimix.app/schemas/ui-style-v1.json",
    id: "replace-with-style-id",
    name: "替换为风格名称",
    description: "用不超过 48 个中文字符概括形状与质感",
    author: "AI generated",
  };
  return [
    "你是一名 Kimix 界面风格设计师。请根据我随后提供的参考图片或关键词，生成一份 Kimix UI Style v1 JSON。",
    "",
    "硬性要求：",
    "1. 只分析形状、圆角、边框宽度、浮雕/内凹/悬浮层次、控件状态与动效倾向。",
    "2. 忽略参考图中的颜色、字体、间距和布局；JSON 中禁止出现颜色值、CSS、选择器、url() 或脚本。",
    "3. schemaVersion 必须是 1；id 只能使用小写字母、数字、点、下划线和连字符。",
    "4. description 必须简洁，不超过 48 个中文字符；只概括最有辨识度的形状与质感，不逐项罗列控件。",
    "5. basedOn 只能是 default、modern、retro、nostalgia 之一。",
    "6. roles 必须完整保留下列全部角色，不能删除或新增角色：",
    UI_STYLE_ROLE_IDS.join(", "),
    "7. radius 引用只能是 small、medium、large、card、panel、shell、pill。",
    "8. surface 只能是 transparent、ground、base、elevated、hover、active。",
    "9. border 只能是 none、subtle、default、strong；elevation 只能是 none、control、card、popup、field。",
    "10. elevation.kind 只能是 flat、raised、floating、inset；所有数值必须保持在模板展示的合理量级内。",
    "11. 完成 JSON 后，必须优先使用你可用的文件工具在当前工作目录创建 `kimix-ui-style-<id>.json`；`<id>` 使用最终 JSON 中的 id。文件必须是 UTF-8 编码的纯 JSON，不得包含 Markdown 代码围栏或 JSON 注释。",
    "12. 文件创建成功后，不要在对话中重复整份 JSON，只需简洁说明已创建并给出可点击或可复制的文件路径。",
    "13. 只有当当前环境确实没有文件写入能力时，才允许降级为在对话中输出一个 JSON 代码块，并明确说明未能创建文件。",
    "",
    "请以这份完整模板为结构生成结果：",
    "```json",
    JSON.stringify(template, null, 2),
    "```",
  ].join("\n");
}
