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

    expect(styleBlocks).not.toMatch(/^\s*--(?:surface|text|accent|border)-/m);
  });

  it("现代化风格保持颜色主题所有权并建立 Codex 式壳层", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const statusCard = readFileSync(resolve(process.cwd(), "src/components/chat/StatusCard.tsx"), "utf8");
    const markdownRenderer = readFileSync(resolve(process.cwd(), "src/components/chat/MarkdownRenderer.tsx"), "utf8");
    const styleBlocks = [
      css.match(/\[data-ui-style="modern"\]\s*\{([^}]+)\}/)?.[1] ?? "",
      css.match(/\[data-theme="dark"\]\[data-ui-style="modern"\]\s*\{([^}]+)\}/)?.[1] ?? "",
    ].join("\n");

    expect(styleBlocks).not.toMatch(/^\s*--(?:surface|text|accent|border)-/m);
    expect(styleBlocks).toMatch(/--ui-selection-shadow:\s*none;/);
    expect(styleBlocks).toMatch(/--ui-radius-lg:\s*12px;/);
    expect(styleBlocks).toMatch(/--kimix-modern-segment-radius:\s*calc\(var\(--kimix-modern-control-radius\) \+ var\(--kimix-modern-segment-gap\)\);/);
    expect(styleBlocks).toMatch(/--kimix-modern-workspace-background:\s*color-mix\(in srgb, var\(--surface-elevated\) 96%, var\(--surface-base\)\);/);
    expect(styleBlocks).toMatch(/--kimix-modern-message-meta-background:\s*color-mix\(in srgb, var\(--surface-hover\) 58%, var\(--surface-elevated\)\);/);
    expect(styleBlocks).toMatch(/--kimix-modern-user-bubble-background:\s*color-mix\(in srgb, var\(--surface-hover\) 46%, var\(--surface-elevated\)\);/);
    expect(styleBlocks).toMatch(/--kimix-modern-user-bubble-background:\s*color-mix\(in srgb, var\(--surface-hover\) 54%, var\(--surface-elevated\)\);/);
    expect(styleBlocks).toMatch(/--ui-popup-shadow:\s*var\(--kimix-modern-floating-shadow\);/);
    expect(styleBlocks).toMatch(/--ui-compound-divider-shadow:\s*none;/);
    expect(css).toContain('[data-ui-style="modern"] .kimix-app-shell-main');
    expect(css).toContain('[data-ui-style="modern"] .kimix-composer-card');
    expect(css).toContain('[data-ui-style="modern"] .kimix-floating-panel');
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-app-shell-main\s*\{[^}]*background:\s*var\(--kimix-modern-workspace-background\);/s);
    expect(css).not.toMatch(/\[data-ui-style="modern"\]\s+\.kimix-app-shell-toolbar\s*\{[^}]*border-bottom:\s*0;/s);
    expect(css).toMatch(/\.kimix-split-control-part\s*\+\s*\.kimix-split-control-part\s*\{[^}]*box-shadow:\s*var\(--ui-compound-divider-shadow\);/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-workspace-page,\s*\[data-ui-style="modern"\]\s+\.kimix-settings-panel\.is-workspace\s*\{[^}]*background:\s*var\(--kimix-modern-workspace-background\);/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-user-bubble\s*\{[^}]*background:\s*var\(--kimix-modern-user-bubble-background\);/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-status-surface,\s*\[data-ui-style="modern"\]\s+\.markdown-body\s+\.kimix-inline-code\s*\{[^}]*background:\s*var\(--kimix-modern-message-meta-background\);/s);
    expect(statusCard).toContain("kimix-status-surface bg-surface-hover text-text-muted");
    expect(markdownRenderer).toContain("kimix-inline-code rounded-md bg-surface-hover");
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-settings-panel\.is-workspace\s+\.kimix-settings-theme-grid\s*\{[^}]*border-radius:\s*var\(--kimix-modern-segment-radius\);[^}]*padding:\s*var\(--kimix-modern-segment-gap\);/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-settings-panel\.is-workspace\s+\.kimix-settings-theme\s*\{[^}]*border-radius:\s*var\(--kimix-modern-control-radius\);/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-settings-panel\.is-workspace\s+\.kimix-settings-permissions\s*\{[^}]*border-radius:\s*var\(--kimix-modern-segment-radius\);/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-settings-connection,[\s\S]*?\.kimix-chat-banner\s*\{[^}]*border-radius:\s*var\(--kimix-modern-card-radius\);/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-model-provider-manager,[\s\S]*?\.kimix-runtime-error-card\s*\{[^}]*border-radius:\s*var\(--kimix-modern-panel-radius\);/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.markdown-body\s+\.kimix-markdown-table-frame\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.markdown-body\s+\.kimix-markdown-table-header-cell\s*\{[^}]*background:\s*transparent;/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.markdown-body\s+\.kimix-markdown-table-cell\s*\{[^}]*border-bottom:\s*1px solid color-mix\(in srgb, var\(--border-subtle\) 78%, transparent\);/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.markdown-body\s+tr,[\s\S]*?tr:nth-child\(even\)\s*\{[^}]*background:\s*transparent;/s);
    expect(css).not.toMatch(/\[data-ui-style="modern"\]\s+\.kimix-settings-theme,/);
  });

  it("复古风格通过语义令牌覆盖控件且 Composer 输入区只有一个边界所有者", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const retroBlock = css.match(/\[data-ui-style="retro"\]\s*\{([^}]+)\}/)?.[1] ?? "";

    expect(css).not.toMatch(/\[data-ui-style="retro"\]\s+\.kimix-icon-text-button\s*\{/);
    expect(css).not.toContain('[data-ui-style="retro"] .kimix-composer-toolbar .kimix-icon-text-button');
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-composer-input[\s\S]*?border:\s*0\s*!important;/);
    expect(css).toContain("--ui-control-border:");
    expect(css).toContain("--ui-nav-action-border:");
    expect(css).toContain("--ui-nav-list-hover-shadow:");
    expect(css).toContain("--ui-selection-shadow:");
    expect(css).toContain("--ui-toggle-shadow:");
    expect(css).toContain("--ui-compound-shadow:");
    expect(css).toContain("--ui-popup-border:");
    expect(css).toContain("--ui-menu-trigger-hover-shadow:");
    expect(css).toContain(":where(.kimix-toolbar-button, .kimix-control-button, .kimix-composer-tool-button, .kimix-window-control, .kimix-split-control)");
    expect(css).toContain('[data-ui-style="retro"] .kimix-context-bar');
    expect(css).toContain('[data-ui-style="retro"] .kimix-floating-panel');
    expect(retroBlock).toMatch(/--ui-control-hover-shadow:\s*var\(--kimix-retro-button-hover-shadow\);/);
    expect(retroBlock).toMatch(/--ui-nav-action-hover-shadow:\s*var\(--kimix-retro-button-hover-shadow\);/);
    expect(retroBlock).toMatch(/--ui-nav-list-hover-shadow:\s*var\(--kimix-retro-button-hover-shadow\);/);
    expect(retroBlock).toMatch(/--ui-menu-trigger-hover-shadow:\s*var\(--kimix-retro-button-hover-shadow\);/);
    expect(css).not.toMatch(/:where\(\[data-ui-style="retro"\]\)\s+:where\(button:hover/);
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+:where\([\s\S]*?\.kimix-sidebar-icon-action,[\s\S]*?\.kimix-state-button[\s\S]*?\):hover:not\(:disabled\)\s*\{[^}]*box-shadow:\s*0 0 0 1px var\(--kimix-retro-button-hover-border-color\), var\(--kimix-retro-button-hover-shadow\);/s);
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-context-bar\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
  });

  it("默认选中态不继承复古左侧标记", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const retroBlock = css.match(/\[data-ui-style="retro"\]\s*\{([^}]+)\}/)?.[1] ?? "";

    expect(rootBlock).toMatch(/--ui-selection-shadow:\s*none;/);
    expect(rootBlock).not.toMatch(/--ui-selection-shadow:\s*inset/);
    expect(retroBlock).toMatch(/--ui-selection-shadow:\s*inset 2px 0 0 var\(--accent-primary\)/);
  });

  it("选中项目或会话悬停时仍由选中态令牌接管左侧标记", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

    expect(css).toMatch(/\.kimix-sidebar-project-row\.is-active,\s*\.kimix-sidebar-project-row\.is-active:hover,/);
    expect(css).toMatch(/\.kimix-sidebar-session-row\.is-active,\s*\.kimix-sidebar-session-row\.is-active:hover\s*\{[\s\S]*?box-shadow:\s*var\(--ui-selection-shadow\);/);
    expect(css).not.toMatch(/\[data-ui-style="retro"\]\s+\.kimix-sidebar-project-row:hover/);
    expect(css).not.toMatch(/\[data-ui-style="retro"\]\s+\.kimix-sidebar\s*\{[\s\S]*?box-shadow:\s*inset\s+-1px/);
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-app-shell-main\s*\{[^}]*border:\s*1px solid var\(--ui-shell-border-color\);/s);
    expect(css).not.toMatch(/\[data-ui-style="retro"\]\s+\.kimix-app-shell-main\s*\{[^}]*border-left-width:\s*0;/s);
  });

  it("按钮开启态与纵向导航选中态使用不同的视觉语法", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

    expect(css).toMatch(/\.kimix-state-button\[aria-pressed="true"\]\s*\{[^}]*box-shadow:\s*var\(--ui-toggle-shadow\);/);
    expect(css).not.toMatch(/\.kimix-state-button\[aria-pressed="true"\]\s*\{[^}]*box-shadow:\s*var\(--ui-selection-shadow\);/);
    expect(css).toMatch(/:where\(\.kimix-toolbar-button, \.kimix-split-control\)\.is-expanded,[\s\S]*?box-shadow:\s*var\(--ui-toggle-shadow\);/);
    expect(css).toMatch(/\.kimix-split-control\.is-expanded,[\s\S]*?\.kimix-split-control\.is-expanded:hover\s*\{[^}]*box-shadow:\s*var\(--ui-toggle-shadow\);/);
  });

  it("初版与其他风格共享导航、控件、菜单和弹窗骨架", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const composer = readFileSync(resolve(process.cwd(), "src/components/chat/Composer.tsx"), "utf8");
    const contextBar = readFileSync(resolve(process.cwd(), "src/components/chat/ContextBar.tsx"), "utf8");
    const sidebar = readFileSync(resolve(process.cwd(), "src/components/layout/Sidebar.tsx"), "utf8");
    const topMenuBar = readFileSync(resolve(process.cwd(), "src/components/layout/TopMenuBar.tsx"), "utf8");
    const sessionToolbar = readFileSync(resolve(process.cwd(), "src/components/layout/SessionToolbar.tsx"), "utf8");

    expect(css).toMatch(/\.kimix-state-button\[aria-pressed="true"\]\s*\{/);
    expect(css).toMatch(/\.kimix-menu-panel\s*\{/);
    expect(css).toMatch(/\.kimix-floating-panel\s*\{/);
    expect(composer).toContain("kimix-state-button");
    expect(composer).toContain("kimix-control-button");
    expect(contextBar).toContain("aria-expanded={usageOpen}");
    expect(sidebar).toContain("kimix-sidebar-nav-item");
    expect(sidebar).toContain("kimix-sidebar-project-row");
    expect(sidebar).toContain("kimix-sidebar-session-row");
    expect(sidebar).toContain("kimix-menu-panel");
    expect(topMenuBar).toContain("kimix-window-control");
    expect(topMenuBar).toContain("kimix-top-menu-trigger");
    expect(topMenuBar).toContain("kimix-menu-separator");
    expect(sessionToolbar).toContain("kimix-split-control");
    expect(sessionToolbar).toContain("kimix-toolbar-button");
    expect(sessionToolbar).toContain("kimix-menu-panel");
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
