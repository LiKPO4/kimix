import type { UiStyleId } from "@/types/ui";
import { BUILTIN_UI_STYLE_DOCUMENTS } from "@/utils/builtinUiStyleDocuments";
import { compileUiStyleVariables, type UiStyleDocumentV1 } from "@/utils/uiStyleContract";

/** 根元素上标记当前界面风格的 data 属性；default 时移除以回退 :root 变量。 */
export const UI_STYLE_ATTRIBUTE = "data-ui-style";
/** 仅自定义 JSON 风格启用 V1 角色消费层；内置风格继续使用已验收的专属 CSS。 */
export const UI_STYLE_CONTRACT_ATTRIBUTE = "data-ui-style-contract";

export const DEFAULT_UI_STYLE_ID: UiStyleId = "default";

export interface UiStylePreset {
  id: UiStyleId;
  label: string;
  description: string;
}

/**
 * 界面风格预设：与主题（明暗）、色彩方案（配色）正交，只切换圆角/阴影/边框、布局壳层等形状质感。
 * 字体不纳入切换，保持 LXGW WenKai 不变。
 */
export const UI_STYLES: UiStylePreset[] = [
  ...Object.values(BUILTIN_UI_STYLE_DOCUMENTS).map((document) => ({
    id: document.id as UiStyleId,
    label: document.name,
    description: document.description,
  })),
];

export function normalizeUiStyleId(value: unknown): UiStyleId {
  if (value === "modern" || value === "retro" || value === "nostalgia") return value;
  if (typeof value === "string" && /^custom:[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) return value as UiStyleId;
  return DEFAULT_UI_STYLE_ID;
}

const appliedVariables = new Set<string>();

function clearAppliedUiStyleVariables(root: HTMLElement) {
  for (const variable of appliedVariables) root.style.removeProperty(variable);
  appliedVariables.clear();
}

function applyCompiledVariables(root: HTMLElement, variables: Record<string, string>) {
  for (const [name, value] of Object.entries(variables)) {
    root.style.setProperty(name, value);
    appliedVariables.add(name);
  }
}

/** 应用界面风格：default 移除属性回退 :root，其余设为对应 data-ui-style 值。 */
export function applyUiStyle(id: unknown, customDocuments: UiStyleDocumentV1[] = []) {
  if (typeof document === "undefined") return;
  const normalized = normalizeUiStyleId(id);
  const root = document.documentElement;
  clearAppliedUiStyleVariables(root);
  root.removeAttribute(UI_STYLE_CONTRACT_ATTRIBUTE);

  if (normalized === DEFAULT_UI_STYLE_ID) {
    root.removeAttribute(UI_STYLE_ATTRIBUTE);
    return;
  }

  if (!normalized.startsWith("custom:")) {
    root.setAttribute(UI_STYLE_ATTRIBUTE, normalized);
    return;
  }

  const styleDocument = customDocuments.find((document) => `custom:${document.id}` === normalized);
  if (!styleDocument) {
    root.removeAttribute(UI_STYLE_ATTRIBUTE);
    return;
  }

  applyCompiledVariables(root, compileUiStyleVariables(styleDocument));
  root.setAttribute(UI_STYLE_ATTRIBUTE, normalized);
  root.setAttribute(UI_STYLE_CONTRACT_ATTRIBUTE, "v1");
}
