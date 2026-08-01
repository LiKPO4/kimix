import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyUiStyle, DEFAULT_UI_STYLE_ID, normalizeUiStyleId, UI_STYLE_ATTRIBUTE, UI_STYLES } from "../uiStyles";

describe("normalizeUiStyleId", () => {
  it("保留合法风格 id", () => {
    expect(normalizeUiStyleId("default")).toBe("default");
    expect(normalizeUiStyleId("modern")).toBe("modern");
    expect(normalizeUiStyleId("retro")).toBe("retro");
  });

  it("非法或缺失值回退为 default", () => {
    expect(normalizeUiStyleId(undefined)).toBe("default");
    expect(normalizeUiStyleId(null)).toBe("default");
    expect(normalizeUiStyleId("")).toBe("default");
    expect(normalizeUiStyleId("flat")).toBe("default");
    expect(normalizeUiStyleId(42)).toBe("default");
  });
});

describe("UI_STYLES", () => {
  it("包含 default/modern/retro 三套预设且默认在首位", () => {
    expect(UI_STYLES.map((item) => item.id)).toEqual(["default", "modern", "retro"]);
    expect(UI_STYLES[0].id).toBe(DEFAULT_UI_STYLE_ID);
    for (const item of UI_STYLES) {
      expect(item.label).toBeTruthy();
      expect(item.description).toBeTruthy();
    }
  });

  it("复古风格只改变形状质感，不覆盖颜色主题 token", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const styleBlocks = [
      css.match(/\[data-ui-style="retro"\]\s*\{([^}]+)\}/)?.[1] ?? "",
      css.match(/\[data-theme="dark"\]\[data-ui-style="retro"\]\s*\{([^}]+)\}/)?.[1] ?? "",
    ].join("\n");

    expect(styleBlocks).not.toMatch(/--(?:surface|text|accent|border)-/);
  });

  it("复古控件按组件角色接入且 Composer 输入区只有一个边界所有者", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

    expect(css).not.toMatch(/\[data-ui-style="retro"\]\s+\.kimix-icon-text-button\s*\{/);
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-composer-input[\s\S]*?border:\s*0\s*!important;/);
    expect(css).toContain('[data-ui-style="retro"] .kimix-composer-toolbar .kimix-icon-text-button');
    expect(css).toContain('[data-ui-style="retro"] .kimix-context-bar');
    expect(css).toContain('[data-ui-style="retro"] .kimix-sidebar-project-row.is-active');
  });
});

describe("applyUiStyle", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(UI_STYLE_ATTRIBUTE);
  });

  it("modern/retro 设置 data-ui-style 属性", () => {
    applyUiStyle("modern");
    expect(document.documentElement.getAttribute(UI_STYLE_ATTRIBUTE)).toBe("modern");
    applyUiStyle("retro");
    expect(document.documentElement.getAttribute(UI_STYLE_ATTRIBUTE)).toBe("retro");
  });

  it("default 移除属性回退 :root", () => {
    applyUiStyle("retro");
    applyUiStyle("default");
    expect(document.documentElement.hasAttribute(UI_STYLE_ATTRIBUTE)).toBe(false);
  });

  it("非法值按 default 处理并移除属性", () => {
    applyUiStyle("modern");
    applyUiStyle("unknown");
    expect(document.documentElement.hasAttribute(UI_STYLE_ATTRIBUTE)).toBe(false);
  });
});
