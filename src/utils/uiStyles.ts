import type { UiStyleId } from "@/types/ui";

/** 根元素上标记当前界面风格的 data 属性；default 时移除以回退 :root 变量。 */
export const UI_STYLE_ATTRIBUTE = "data-ui-style";

export const DEFAULT_UI_STYLE_ID: UiStyleId = "default";

export interface UiStylePreset {
  id: UiStyleId;
  label: string;
  description: string;
}

/**
 * 界面风格预设：与主题（明暗）、色彩方案（配色）正交，只切换圆角/阴影/边框等形状质感。
 * 字体不纳入切换，保持 LXGW WenKai 不变。
 */
export const UI_STYLES: UiStylePreset[] = [
  { id: "default", label: "Kimix 默认", description: "当前视觉，柔和圆角与轻盈阴影。" },
  { id: "modern", label: "现代化", description: "静谧效率：hairline 细边框、几乎无阴影的安静干净质感。" },
  { id: "retro", label: "复古", description: "浮雕面板：经典桌面的明暗双边框凹凸面板与直角质感。" },
];

export function normalizeUiStyleId(value: unknown): UiStyleId {
  return value === "modern" || value === "retro" ? value : DEFAULT_UI_STYLE_ID;
}

/** 应用界面风格：default 移除属性回退 :root，其余设为对应 data-ui-style 值。 */
export function applyUiStyle(id: unknown) {
  if (typeof document === "undefined") return;
  const normalized = normalizeUiStyleId(id);
  if (normalized === DEFAULT_UI_STYLE_ID) {
    document.documentElement.removeAttribute(UI_STYLE_ATTRIBUTE);
    return;
  }
  document.documentElement.setAttribute(UI_STYLE_ATTRIBUTE, normalized);
}
