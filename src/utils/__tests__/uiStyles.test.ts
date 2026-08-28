import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import * as ts from "typescript";
import {
  applyUiStyle,
  DEFAULT_UI_STYLE_ID,
  normalizeUiStyleId,
  UI_STYLE_ATTRIBUTE,
  UI_STYLE_CONTRACT_ATTRIBUTE,
  UI_STYLES,
} from "../uiStyles";
import { BUILTIN_UI_STYLE_DOCUMENTS } from "../builtinUiStyleDocuments";

describe("normalizeUiStyleId", () => {
  it("保留合法风格 id", () => {
    expect(normalizeUiStyleId("default")).toBe("default");
    expect(normalizeUiStyleId("modern")).toBe("modern");
    expect(normalizeUiStyleId("retro")).toBe("retro");
    expect(normalizeUiStyleId("nostalgia")).toBe("nostalgia");
    expect(normalizeUiStyleId("custom:platinum-soft")).toBe("custom:platinum-soft");
  });

  it("非法或缺失值回退为 default", () => {
    expect(normalizeUiStyleId(undefined)).toBe("default");
    expect(normalizeUiStyleId(null)).toBe("default");
    expect(normalizeUiStyleId("")).toBe("default");
    expect(normalizeUiStyleId("flat")).toBe("default");
    expect(normalizeUiStyleId("custom:../../escape")).toBe("default");
    expect(normalizeUiStyleId(42)).toBe("default");
  });
});

describe("UI_STYLES", () => {
  it("包含 default/modern/retro/nostalgia 四套预设且默认在首位", () => {
    expect(UI_STYLES.map((item) => item.id)).toEqual(["default", "modern", "retro", "nostalgia"]);
    expect(UI_STYLES[0].id).toBe(DEFAULT_UI_STYLE_ID);
    for (const item of UI_STYLES) {
      expect(item.label).toBeTruthy();
      expect(item.description).toBeTruthy();
    }
  });

  it("最外应用壳消费窗口圆角并在最大化时归零", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

    expect(css).toMatch(/:root\s*\{[^}]*--kimix-window-corner-radius:\s*16px;/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s*\{[^}]*--kimix-window-corner-radius:\s*20px;/s);
    expect(css).toMatch(/:root\[data-transparent-shell="1"\]\s+body\s*\{[^}]*border-radius:\s*var\(--kimix-window-corner-radius\);[^}]*clip-path:\s*inset\(0 round var\(--kimix-window-corner-radius\)\);/s);
    expect(css).toMatch(/:root\[data-transparent-shell="1"\]\[data-window-maximized="true"\]\s+body\s*\{[^}]*border-radius:\s*0;[^}]*clip-path:\s*none;/s);
    expect(css).toMatch(/\.kimix-app-shell\s*\{[^}]*border-radius:\s*var\(--kimix-window-corner-radius\);/s);
    expect(css).toMatch(/:root\[data-transparent-shell="1"\]\s+\.kimix-app-shell::after\s*\{[^}]*inset:\s*0;[^}]*border-radius:\s*inherit;[^}]*box-shadow:\s*inset 0 0 0 1px var\(--kimix-window-outline\);[^}]*pointer-events:\s*none;/s);
    expect(css).toMatch(/\.kimix-app-shell-main\s*\{[^}]*border-radius:\s*var\(--kimix-window-corner-radius\);/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-app-shell-main\s*\{[^}]*border-radius:\s*var\(--kimix-window-corner-radius\);/s);
    expect(css).toMatch(/\[data-ui-style="retro"\]\s*\{[^}]*--kimix-window-corner-radius:\s*6px;/s);
    expect(css).toMatch(/\[data-ui-style="nostalgia"\]\s*\{[^}]*--kimix-window-corner-radius:\s*0px;/s);
    expect(css).toMatch(/:root\[data-ui-style-contract="v1"\]\s*\{[^}]*--kimix-window-corner-radius:\s*var\(--ui-role-shell-radius\);/s);
    expect(css).toMatch(/:root\[data-window-maximized="true"\]\s+\.kimix-app-shell\s*\{[^}]*border-radius:\s*0;/s);
    expect(css).toMatch(/:root\[data-window-maximized="true"\]\s+\.kimix-app-shell::after\s*\{[^}]*display:\s*none;/s);
  });

  it("复古风格只改变形状质感，不覆盖颜色主题 token", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const styleBlocks = [
      css.match(/\[data-ui-style="retro"\]\s*\{([^}]+)\}/)?.[1] ?? "",
      css.match(/\[data-theme="dark"\]\[data-ui-style="retro"\]\s*\{([^}]+)\}/)?.[1] ?? "",
    ].join("\n");

    expect(styleBlocks).not.toMatch(/^\s*--(?:surface|text|accent|border)-/m);
  });


  it("怀旧风格使用 Win98 式硬浮雕且不覆盖颜色主题 token", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const styleBlocks = [
      css.match(/\[data-ui-style="nostalgia"\]\s*\{([^}]+)\}/)?.[1] ?? "",
      css.match(/\[data-theme="dark"\]\[data-ui-style="nostalgia"\]\s*\{([^}]+)\}/)?.[1] ?? "",
    ].join("\n");

    expect(styleBlocks).not.toMatch(/^\s*--(?:surface|text|accent|border)-/m);
    expect(styleBlocks).toMatch(/--ui-radius-sm:\s*0px;/);
    expect(styleBlocks).toMatch(/--radius-sm:\s*0px;/);
    expect(styleBlocks).toMatch(/--kimix-nostalgia-raised-shadow:/);
    expect(styleBlocks).toMatch(/--kimix-nostalgia-sunken-shadow:/);
    // Raised at rest — signature vs Retro flat controls.
    expect(styleBlocks).toMatch(/--ui-control-shadow:\s*var\(--kimix-nostalgia-raised-shadow\);/);
    expect(styleBlocks).toMatch(/--ui-control-active-shadow:\s*var\(--kimix-nostalgia-sunken-shadow\);/);
    // Selection is solid face, not Retro leading edge.
    expect(styleBlocks).toMatch(/--ui-selection-shadow:\s*none;/);
    expect(css).toContain('[data-ui-style="nostalgia"] .kimix-app-shell-main');
    expect(css).toContain('[data-ui-style="nostalgia"] .kimix-composer-card');
    expect(css).toMatch(/\[data-ui-style="nostalgia"\]\s+\.kimix-section-card[\s\S]*?border-radius:\s*0;/);
    expect(css).toMatch(/\[data-ui-style="nostalgia"\]\s+\.kimix-settings-input[\s\S]*?box-shadow:\s*var\(--kimix-nostalgia-sunken-shadow\);/);
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
    expect(styleBlocks).toMatch(/--kimix-modern-process-background:\s*color-mix\(in srgb, var\(--surface-elevated\) 86%, var\(--surface-hover\)\);/);
    expect(styleBlocks).toMatch(/--kimix-modern-user-bubble-background:\s*color-mix\(in srgb, var\(--surface-hover\) 54%, var\(--surface-elevated\)\);/);
    expect(styleBlocks).toMatch(/--ui-popup-shadow:\s*var\(--kimix-modern-floating-shadow\);/);
    expect(styleBlocks).toMatch(/--ui-compound-divider-shadow:\s*none;/);
    expect(css).toContain('[data-ui-style="modern"] .kimix-app-shell-main');
    expect(css).toContain('[data-ui-style="modern"] .kimix-composer-card');
    expect(css).toContain('[data-ui-style="modern"] .kimix-floating-panel');
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-app-shell-main\s*\{[^}]*background:\s*var\(--kimix-modern-workspace-background\);/s);
    expect(css).not.toMatch(/\[data-ui-style="modern"\]\s+\.kimix-app-shell-toolbar\s*\{[^}]*border-bottom:\s*0;/s);
    expect(css).toMatch(/\.kimix-split-control-part\s*\+\s*\.kimix-split-control-part\s*\{[^}]*position:\s*relative;[^}]*box-shadow:\s*none;/s);
    expect(css).toMatch(/\.kimix-split-control-part\s*\+\s*\.kimix-split-control-part::before\s*\{[^}]*top:\s*50%;[^}]*left:\s*0;[^}]*width:\s*1px;[^}]*height:\s*16px;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*var\(--ui-compound-divider-shadow\);[^}]*transform:\s*translateY\(-50%\);/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-workspace-page,\s*\[data-ui-style="modern"\]\s+\.kimix-settings-panel\.is-workspace\s*\{[^}]*background:\s*var\(--kimix-modern-workspace-background\);/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-user-bubble\s*\{[^}]*background:\s*var\(--kimix-modern-user-bubble-background\);/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-soft-card\s*\{[^}]*background:\s*var\(--kimix-modern-process-background\);/s);
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
    expect(css).toMatch(/:where\(\[data-ui-style="retro"\]\)\s+:where\([\s\S]*?\.kimix-sidebar-icon-action,[\s\S]*?\.kimix-settings-entry,[\s\S]*?button\.kimix-chat-collapse-row[\s\S]*?\):hover:not\(:disabled\):not\(\.bg-accent-primary\)\s*\{[^}]*border-color:\s*var\(--kimix-retro-button-hover-border-color\);[^}]*background:\s*var\(--kimix-retro-button-hover-background\);[^}]*box-shadow:\s*0 0 0 1px var\(--kimix-retro-button-hover-border-color\), var\(--kimix-retro-button-hover-shadow\);/s);
    expect(css).not.toMatch(/:where\(\[data-ui-style="retro"\]\)\s+:where\([^)]*\.kimix-state-button/s);
    expect(css).not.toMatch(/\n\[data-ui-style="retro"\]\s+:where\(\s*\.kimix-icon-text-button,/);
    expect(css).toMatch(/\.kimix-chat-collapse-row\s*\{[^}]*transition:[^}]*box-shadow var\(--duration-base\) var\(--ease-hover\)/s);
    expect(css).toMatch(/\.kimix-muted-action\s*\{[^}]*transition:[^}]*box-shadow var\(--duration-base\) var\(--ease-hover\)/s);
    expect(css).toMatch(/\.kimix-inline-icon-action\s*\{[^}]*transition:[^}]*box-shadow var\(--duration-base\) var\(--ease-hover\)/s);
    expect(css).toMatch(/\.kimix-sidebar-icon-action\s*\{[^}]*transition:[^}]*box-shadow var\(--duration-base\) var\(--ease-hover\)/s);
    expect(css).toMatch(/\.kimix-modal-close-button\s*\{[^}]*transition:[^}]*box-shadow var\(--duration-base\) var\(--ease-hover\)/s);
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

  it("选中项目或会话悬停时复用普通列表悬停描边", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const rootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const retroBlock = css.match(/\[data-ui-style="retro"\]\s*\{([^}]+)\}/)?.[1] ?? "";

    expect(rootBlock).toMatch(/--ui-nav-list-hover-border-color:\s*var\(--border-subtle\);/);
    expect(rootBlock).toMatch(/--ui-selection-hover-border-color:\s*var\(--ui-nav-list-hover-border-color\);/);
    expect(rootBlock).toMatch(/--ui-selection-hover-background:\s*var\(--ui-nav-list-hover-background\);/);
    expect(retroBlock).toMatch(/--ui-selection-hover-border-color:\s*var\(--ui-nav-list-hover-border-color\);/);
    expect(retroBlock).toMatch(/--ui-selection-hover-background:\s*var\(--ui-nav-list-hover-background\);/);
    expect(retroBlock).toMatch(/--ui-selection-hover-shadow:\s*inset 2px 0 0 var\(--accent-primary\), var\(--ui-nav-list-hover-shadow\);/);
    expect(css).toMatch(/\.kimix-sidebar-project-row\.is-active,\s*\.kimix-sidebar-session-row\.is-active\s*\{[\s\S]*?box-shadow:\s*var\(--ui-selection-shadow\);/);
    expect(css).toMatch(/\.kimix-sidebar-project-row\.is-active:hover,\s*\.kimix-sidebar-session-row\.is-active:hover\s*\{[\s\S]*?border-color:\s*var\(--ui-selection-hover-border-color\);[\s\S]*?background-color:\s*var\(--ui-selection-hover-background\);[\s\S]*?box-shadow:\s*var\(--ui-selection-hover-shadow\);/);
    expect(css).not.toMatch(/\.kimix-sidebar-project-row\.is-active,\s*\.kimix-sidebar-project-row\.is-active:hover,/);
    expect(css).not.toMatch(/\[data-ui-style="retro"\]\s+\.kimix-sidebar-project-row:hover/);
    expect(css).not.toMatch(/\[data-ui-style="retro"\]\s+\.kimix-sidebar\s*\{[\s\S]*?box-shadow:\s*inset\s+-1px/);
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-app-shell-main\s*\{[^}]*border:\s*1px solid var\(--ui-shell-border-color\);/s);
    expect(css).not.toMatch(/\[data-ui-style="retro"\]\s+\.kimix-app-shell-main\s*\{[^}]*border-left-width:\s*0;/s);
  });

  it("按钮开启态与纵向导航选中态使用不同的视觉语法", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

    expect(css).toMatch(/\.kimix-state-button\[aria-pressed="true"\]\s*\{[^}]*box-shadow:\s*var\(--ui-toggle-shadow\);/);
    expect(css).not.toMatch(/\.kimix-state-button\[aria-pressed="true"\]\s*\{[^}]*box-shadow:\s*var\(--ui-selection-shadow\);/);
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-state-button:not\(\[aria-pressed="true"\]\):hover:not\(:disabled\)\s*\{[^}]*border-color:\s*var\(--kimix-retro-button-hover-border-color\);[^}]*background:\s*var\(--kimix-retro-button-hover-background\);[^}]*box-shadow:\s*var\(--kimix-retro-button-hover-shadow\);/s);
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-state-button\[aria-pressed="true"\],[\s\S]*?\{[^}]*border-color:\s*var\(--accent-primary-soft\);[^}]*background:\s*var\(--accent-primary-light\);[^}]*color:\s*var\(--accent-primary-dark\);/s);
    expect(css).toMatch(/:where\(\.kimix-toolbar-button\)\.is-expanded,[\s\S]*?box-shadow:\s*var\(--ui-toggle-shadow\);/);
    expect(css).not.toMatch(/:where\([^)]*\.kimix-split-control[^)]*\)\.is-expanded[\s\S]{0,120}--ui-toggle-background/);
    expect(css).toMatch(/\.kimix-split-control\.is-expanded,[\s\S]*?\.kimix-split-control\.is-expanded:hover\s*\{[^}]*background-color:\s*var\(--ui-control-hover-background\);/);
    expect(css).toMatch(/\.kimix-split-control\.is-expanded \.kimix-split-control-part:hover:not\(:disabled\)\s*\{[^}]*--surface-active/);
    // Resting split controls must not paint a permanent compound plate (looks selected-at-rest).
    expect(css).toMatch(/\.kimix-split-control\s*\{[^}]*overflow:\s*hidden;[^}]*\}/s);
    expect(css).not.toMatch(/\.kimix-split-control\s*\{[^}]*(?:--ui-compound-border|--ui-compound-background|--ui-compound-shadow)/s);
    expect(css).toMatch(/\.kimix-split-control-part\s*\+\s*\.kimix-split-control-part\s*\{[^}]*box-shadow:\s*none;/s);
    expect(css).toMatch(/\.kimix-split-control-part\s*\+\s*\.kimix-split-control-part::before\s*\{[^}]*height:\s*16px;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*var\(--ui-compound-divider-shadow\);/s);
  });

  it("Kimix 默认顶栏保留原有工具键边界且底栏 hover 可辨识", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

    expect(css).toMatch(/:root:not\(\[data-ui-style\]\)\s+\.kimix-app-shell-toolbar\s+:where\(\.kimix-toolbar-button:not\(\.kimix-long-task-button\),\s*\.kimix-split-control\)\s*\{[^}]*border:\s*1px solid var\(--kimix-panel-border-soft\);[^}]*border-radius:\s*12px;/s);
    expect(css).toMatch(/:root:not\(\[data-ui-style\]\)\s+\.kimix-app-shell-toolbar\s+:where\(\.kimix-toolbar-button:not\(\.kimix-long-task-button\),\s*\.kimix-split-control\):hover:not\(:disabled\)\s*\{[^}]*transform:\s*translateY\(-1px\);/s);
    expect(css).toMatch(/:root:not\(\[data-ui-style\]\)\s+\.kimix-contextbar-action:hover,[\s\S]*?box-shadow:\s*0 0 0 1px var\(--border-subtle\), var\(--shadow-hover\);[^}]*transform:\s*translateY\(-1px\);/s);
  });

  it("多 Agent 房间按钮全部加入可跨风格覆盖的语义角色", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const addDialog = readFileSync(resolve(process.cwd(), "src/components/chat/AddRoomAgentDialog.tsx"), "utf8");
    const editDialog = readFileSync(resolve(process.cwd(), "src/components/chat/EditRoomAgentDialog.tsx"), "utf8");
    const agentPicker = readFileSync(resolve(process.cwd(), "src/components/chat/RoomAgentPicker.tsx"), "utf8");
    const contextPicker = readFileSync(resolve(process.cwd(), "src/components/chat/RoomContextPicker.tsx"), "utf8");

    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-room-trigger\s*\{[^}]*border-radius:\s*var\(--radius-sm\);[^}]*\}/s);
    expect(css).not.toMatch(/\[data-ui-style="retro"\]\s+\.kimix-room-trigger\s*\{[^}]*(?:--ui-compound-border|--ui-compound-background|--ui-compound-shadow)/s);
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-room-secondary-action\s*\{[^}]*border:\s*var\(--ui-compound-border\);[^}]*box-shadow:\s*var\(--ui-compound-shadow\);/s);
    expect(css).toContain('[data-ui-style="retro"] .kimix-room-choice[aria-pressed="true"]');
    expect(css).toContain('[data-ui-style="retro"] .kimix-room-choice[data-selected="true"]');
    expect(css).toContain('[data-ui-style="retro"] .kimix-room-primary-action');
    expect(css).toContain('[data-ui-style="modern"] .kimix-room-trigger');
    expect(addDialog).toContain("kimix-room-secondary-action");
    expect(addDialog).toContain("kimix-room-primary-action");
    expect(addDialog).toContain("kimix-room-choice");
    expect(editDialog).toContain("kimix-room-secondary-action");
    expect(editDialog).toContain("kimix-room-primary-action");
    expect(agentPicker).toContain("kimix-room-trigger");
    expect(agentPicker).toContain("kimix-room-choice");
    expect(agentPicker).toMatch(/h-7 w-7 self-center items-center justify-center[\s\S]*?<Bot size=\{14\}/);
    expect(contextPicker).toContain("kimix-room-trigger");
    expect(contextPicker).toContain("kimix-room-choice");
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

  it("独立内容分区与游离表面全部接入风格语义角色", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const longTaskInspector = readFileSync(resolve(process.cwd(), "src/components/layout/LongTaskInspectorPanel.tsx"), "utf8");
    const hooksPanel = readFileSync(resolve(process.cwd(), "src/components/layout/HooksPanel.tsx"), "utf8");
    const changeCard = readFileSync(resolve(process.cwd(), "src/components/chat/ChangeCard.tsx"), "utf8");
    const fileCard = readFileSync(resolve(process.cwd(), "src/components/chat/FileCard.tsx"), "utf8");
    const questionCard = readFileSync(resolve(process.cwd(), "src/components/chat/QuestionCard.tsx"), "utf8");
    const eventCardSources = [
      readFileSync(resolve(process.cwd(), "src/components/chat/ApprovalCard.tsx"), "utf8"),
      readFileSync(resolve(process.cwd(), "src/components/chat/ErrorCard.tsx"), "utf8"),
      questionCard,
      readFileSync(resolve(process.cwd(), "src/components/chat/SessionRecommendationCard.tsx"), "utf8"),
      readFileSync(resolve(process.cwd(), "src/components/chat/ChatThread.tsx"), "utf8"),
    ];
    const semanticSurfaceSources = [
      readFileSync(resolve(process.cwd(), "src/components/layout/AppShell.tsx"), "utf8"),
      readFileSync(resolve(process.cwd(), "src/components/layout/DialogSystem.tsx"), "utf8"),
      readFileSync(resolve(process.cwd(), "src/components/layout/SessionToolbar.tsx"), "utf8"),
      readFileSync(resolve(process.cwd(), "src/components/settings/ModelProviderManager.tsx"), "utf8"),
      readFileSync(resolve(process.cwd(), "src/components/settings/RoomDeliveryIdentityInspector.tsx"), "utf8"),
      readFileSync(resolve(process.cwd(), "src/components/chat/Composer.tsx"), "utf8"),
      readFileSync(resolve(process.cwd(), "src/components/chat/DrawingBoard.tsx"), "utf8"),
      readFileSync(resolve(process.cwd(), "src/components/chat/MessageBubble.tsx"), "utf8"),
    ].join("\n");

    expect(css).toMatch(/\.kimix-section-card\s*\{[^}]*border:\s*1px solid var\(--border-subtle\);[^}]*background:\s*var\(--surface-elevated\);/s);
    expect(css).toMatch(/\[data-ui-style="modern"\][\s\S]*?\.kimix-section-card\s*\{[^}]*border-radius:\s*var\(--kimix-modern-card-radius\);/s);
    expect(css).toMatch(/\[data-ui-style="retro"\][\s\S]*?\.kimix-section-card\s*\{[^}]*border-radius:\s*var\(--radius-md\);[^}]*box-shadow:\s*var\(--kimix-retro-panel-shadow\);/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-event-card\s*\{[^}]*border-radius:\s*var\(--kimix-modern-card-radius\);[^}]*box-shadow:\s*none;[^}]*\}/s);
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-event-card\s*\{[^}]*border-radius:\s*var\(--radius-md\);[^}]*box-shadow:\s*var\(--kimix-retro-panel-shadow\);[^}]*\}/s);
    expect(css).not.toMatch(/\[data-ui-style="(?:modern|retro)"\]\s+\.kimix-event-card\s*\{[^}]*border(?:-color)?:/s);
    expect(longTaskInspector.match(/className="kimix-section-card"/g)).toHaveLength(18);
    expect(hooksPanel.match(/className="kimix-section-card(?:\s[^\"]*)?"/g)).toHaveLength(6);
    for (const source of [changeCard, fileCard]) {
      expect(source).toContain("kimix-section-card");
    }
    expect(questionCard).toContain("kimix-inset-section");
    expect(css).toMatch(/\.kimix-inset-section\s*\{[^}]*border:\s*0;[^}]*background:\s*var\(--surface-elevated\);/s);
    expect(css).not.toMatch(/\[data-ui-style="(?:modern|retro)"\]\s+\.kimix-inset-section\s*\{[^}]*border(?:-color)?:/s);
    for (const source of eventCardSources) {
      expect(source).toContain("kimix-event-card");
    }
    expect(fileCard).toContain("kimix-split-control");
    expect(fileCard).toContain("kimix-split-control-part");
    expect(css).toMatch(/:root:not\(\[data-ui-style\]\)\s+\.kimix-file-open-control\s*\{[^}]*border:\s*1px solid var\(--border-subtle\);[^}]*border-radius:\s*12px;/s);

    for (const role of [
      "kimix-longtask-inspector",
      "kimix-diff-panel",
      "kimix-toast",
      "kimix-chat-navigation-preview",
      "kimix-model-provider-sidebar",
    ]) {
      expect(css).toContain(`[data-ui-style="modern"] .${role}`);
      expect(css).toContain(`[data-ui-style="retro"] .${role}`);
    }

    expect(semanticSurfaceSources).not.toMatch(/kimix-(?:modal-card|onboarding-card|floating-panel|app-shell-main|media-thumb)[^\n\"`]*(?:rounded-\[[^\]]+\]|shadow-\[[^\]]+\])/);
  });

  it("会话侧栏内部操作与字段完整接入风格角色", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const longTaskInspector = readFileSync(resolve(process.cwd(), "src/components/layout/LongTaskInspectorPanel.tsx"), "utf8");
    const gitDetailsButton = longTaskInspector.match(/onClick=\{openGitDetails\}[\s\S]{0,220}?className="([^"]+)"/);
    const planRefresh = longTaskInspector.match(/onRefreshSessionPlan\(\)[\s\S]{0,220}?className="([^"]+)"/);
    const serverCreate = longTaskInspector.match(/createServerTreeChild\(\)[\s\S]{0,280}?className="([^"]+)"/);
    const diffItem = longTaskInspector.match(/openFile\(diff\.filePath\)[\s\S]{0,220}?className="([^"]+)"/);

    expect(longTaskInspector).toContain("kimix-inspector-drag-handle");
    expect(longTaskInspector).toContain("kimix-inspector-action");
    expect(longTaskInspector).toContain("kimix-inspector-list-item");
    expect(longTaskInspector.match(/kimix-inspector-field/g)).toHaveLength(5);
    expect(css).toMatch(/\.kimix-longtask-inspector\s+\.kimix-section-card\s+\.kimix-inspector-action\s*\{[^}]*background-color:\s*var\(--surface-base\);/s);
    expect(css).toMatch(/\.kimix-longtask-inspector\s+\.kimix-section-card\s+\.kimix-inspector-list-item[\s\S]*?\{[^}]*background-color:\s*var\(--surface-base\);/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-longtask-inspector\s+\.kimix-section-card\s+\.kimix-icon-text-button[\s\S]*?\{[^}]*border:\s*1px solid transparent;[^}]*border-radius:\s*var\(--kimix-modern-control-radius\);[^}]*box-shadow:\s*none;/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-longtask-inspector\s+\.kimix-section-card\s+\.kimix-inspector-list-item[\s\S]*?\{[^}]*border-radius:\s*var\(--kimix-modern-control-radius\);/s);
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-longtask-inspector\s+\.kimix-section-card\s+\.kimix-icon-text-button:not\(\.bg-accent-primary\)[\s\S]*?\{[^}]*border:\s*1px solid transparent;[^}]*border-radius:\s*var\(--radius-sm\);[^}]*background-image:\s*none;[^}]*box-shadow:\s*none;/s);
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-longtask-inspector\s+\.kimix-section-card\s+\.kimix-icon-text-button\.kimix-inspector-action\s*\{[^}]*background-color:\s*var\(--surface-base\);/s);
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-longtask-inspector\s+\.kimix-section-card\s+\.kimix-inspector-list-item[\s\S]*?\{[^}]*border-radius:\s*var\(--radius-sm\);/s);
    expect(gitDetailsButton?.[1].split(/\s+/)).toEqual(expect.arrayContaining(["kimix-icon-text-button", "kimix-inspector-action"]));
    // 卡头刷新按钮为纯图标模式（v2.20.267 起，缓解标题行挤压）
    expect(planRefresh?.[1].split(/\s+/)).toEqual(expect.arrayContaining(["kimix-inline-icon-action", "is-roomy"]));
    expect(planRefresh?.[1].split(/\s+/)).not.toContain("bg-accent-primary-light");
    expect(serverCreate?.[1].split(/\s+/)).toEqual(expect.arrayContaining(["kimix-inline-icon-action", "is-roomy"]));
    expect(diffItem?.[1].split(/\s+/)).toContain("kimix-inspector-list-item");
    expect(longTaskInspector).not.toMatch(/flex h-8 w-8[^\n]*rounded-lg text-text-muted/);
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-longtask-inspector\s+\.kimix-inspector-field\s*\{[^}]*border:\s*var\(--ui-field-border\);[^}]*border-radius:\s*var\(--radius-sm\);[^}]*box-shadow:\s*var\(--ui-field-shadow\);/s);
    expect(css).not.toMatch(/\[data-ui-style="(?:modern|retro)"\]\s+\.kimix-icon-text-button\s*\{/);
  });
  it("Agent 单条复制与用户复制同为 28px 方形，复制全部保持同高并共享控件材质", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const messageBubble = readFileSync(resolve(process.cwd(), "src/components/chat/MessageBubble.tsx"), "utf8");

    expect(messageBubble).toContain('kimix-message-copy-action kimix-inline-icon-action kimix-control-button');
    expect(messageBubble).not.toContain('kimix-inline-icon-action is-roomy text-text-muted hover:bg-bg-hover hover:text-text-primary"\n              title="复制"');
    expect(messageBubble).toContain('kimix-message-copy-action kimix-control-button kimix-muted-action');
    expect(messageBubble).toContain('style={{ height: 28, minHeight: 28, gap: 5, paddingLeft: 8, paddingRight: 8');
    expect(css).toMatch(/\.kimix-message-copy-action\s*\{[^}]*height:\s*28px;[^}]*min-height:\s*28px;/s);
  });
  it("Composer 加号与画板比例按钮消费自定义控件的完整交互状态", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const composer = readFileSync(resolve(process.cwd(), "src/components/chat/Composer.tsx"), "utf8");

    expect(composer).toContain('kimix-icon-text-button kimix-control-button is-compact justify-center text-[13px] text-text-secondary');
    expect(css).toMatch(/:root\[data-ui-style-contract="v1"\]\s+:where\([^)]*\.kimix-composer-tool-button[^)]*\)(?::not\([^)]*\))*:not\(\.bg-accent-primary\)(?::not\([^)]*\))*\s*\{/s);
    expect(css).toMatch(/:root\[data-ui-style-contract="v1"\]\s+:where\([^)]*\.kimix-composer-tool-button[^)]*\)(?::not\([^)]*\))*:not\(\.bg-accent-primary\)(?::not\([^)]*\))*:hover:not\(:disabled\)\s*\{/s);
    expect(css).toMatch(/:root\[data-ui-style-contract="v1"\]\s+:where\([^)]*\.kimix-composer-tool-button[^)]*\)(?::not\([^)]*\))*:not\(\.bg-accent-primary\)(?::not\([^)]*\))*:active:not\(:disabled\)\s*\{/s);
  });
  it("Agent 过程头与游离折叠思考摘要静止安静，仅交互态消费 control", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const messageBubble = readFileSync(resolve(process.cwd(), "src/components/chat/MessageBubble.tsx"), "utf8");

    expect(messageBubble.match(/kimix-chat-standalone-disclosure/g)).toHaveLength(3);
    expect(messageBubble).toMatch(/kimix-kimi-web-foldable-summary kimix-chat-standalone-disclosure[\s\S]{0,300}?aria-expanded=\{expanded\}/s);
    expect(css).toMatch(/button\.kimix-chat-standalone-disclosure\s*\{[^}]*border:\s*var\(--ui-role-control-hover-border\);[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
    expect(css).not.toMatch(/\.kimix-chat-standalone-disclosure\s*\{[^}]*--ui-role-control-resting-background/s);
    expect(css).toMatch(/button\.kimix-chat-standalone-disclosure:is\(:hover,\s*:focus-visible\):not\(:disabled\)\s*\{[^}]*border:\s*var\(--ui-role-control-hover-border\);[^}]*border-radius:\s*var\(--ui-role-control-radius\);[^}]*background:\s*var\(--ui-role-control-hover-background\);[^}]*box-shadow:\s*var\(--ui-role-control-hover-shadow\);/s);
    expect(css).toMatch(/button\.kimix-chat-standalone-disclosure:active:not\(:disabled\)\s*\{[^}]*border:\s*var\(--ui-role-control-active-border\);[^}]*border-radius:\s*var\(--ui-role-control-radius\);[^}]*background:\s*var\(--ui-role-control-active-background\);[^}]*box-shadow:\s*var\(--ui-role-control-active-shadow\);/s);
  });
  it("主壳内部工具栏与底栏由父壳裁切外角，相接边保持直线", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

    expect(css).toMatch(/:root\[data-ui-style-contract="v1"\]\s+:where\(\.kimix-app-shell-toolbar,\s*\.kimix-app-shell-footer\)\s*\{[^}]*border-radius:\s*0;[^}]*background:\s*var\(--ui-role-toolbar-resting-background\);/s);
    expect(css).not.toMatch(/:root\[data-ui-style-contract="v1"\]\s+:where\(\.kimix-app-shell-toolbar,\s*\.kimix-app-shell-footer\)\s*\{[^}]*border-radius:\s*var\(--ui-role-toolbar-radius\);/s);
  });
  it("Composer 权限与思考强度按钮均与同排紧凑按钮保持 32px 高", () => {
    const composer = readFileSync(resolve(process.cwd(), "src/components/chat/Composer.tsx"), "utf8");

    expect(composer).toMatch(/ref=\{permissionBtnRef\}[\s\S]*?height:\s*32,[\s\S]*?minHeight:\s*32,/s);
    expect(composer).not.toMatch(/ref=\{permissionBtnRef\}[\s\S]*?height:\s*34,[\s\S]*?minHeight:\s*34,/s);
    expect(composer).toMatch(/ref=\{thinkingBtnRef\}[\s\S]*?height:\s*32,[\s\S]*?minHeight:\s*32,/s);
    expect(composer).not.toMatch(/ref=\{thinkingBtnRef\}[\s\S]*?height:\s*34,[\s\S]*?minHeight:\s*34,/s);
  });
  it("侧栏随行显形操作静止透明，仅单按钮交互时消费自定义材质", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const sidebar = readFileSync(resolve(process.cwd(), "src/components/layout/Sidebar.tsx"), "utf8");

    expect(sidebar.match(/kimix-sidebar-reveal-action/g)).toHaveLength(6);
    expect(css).toMatch(/:root\[data-ui-style-contract="v1"\]\s+\.kimix-sidebar-reveal-action:not\(:hover\):not\(:focus-visible\):not\(:active\)\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
    expect(css).toMatch(/\.kimix-sidebar-icon-action:hover:not\(:disabled\)\s*\{[^}]*box-shadow:\s*var\(--ui-role-navigation-action-hover-shadow\);/s);
    expect(css).toMatch(/:root\[data-ui-style-contract="v1"\]\s+:where\([^)]*\.kimix-inline-icon-action[^)]*\)[^{}]*:hover:not\(:disabled\)\s*\{[^}]*box-shadow:\s*var\(--ui-role-control-hover-shadow\);/s);
  });
  it("仅排除真正的静态 accent 背景，不误伤 hover:accent 次要操作", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const sidebar = readFileSync(resolve(process.cwd(), "src/components/layout/Sidebar.tsx"), "utf8");

    expect(css).not.toContain(':not([class*="bg-accent-"])');
    expect(css.match(/:not\(\[class\^="bg-accent-"\]\):not\(\[class\*=" bg-accent-"\]\)/g)).toHaveLength(5);
    expect(sidebar).toContain('kimix-sidebar-reveal-action kimix-inline-icon-action text-text-muted hover:bg-accent-danger/10 hover:text-accent-danger');
  });
  it("工作区分段外壳按结构消费材质并保持同心圆角", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

    expect(css).toMatch(/\.kimix-settings-panel\.is-workspace\s+\.kimix-settings-theme-grid\s*\{[^}]*--kimix-settings-theme-segment-inset:\s*6px;[^}]*padding:\s*var\(--kimix-settings-theme-segment-inset\);[^}]*gap:\s*var\(--kimix-settings-theme-segment-inset\);/s);
    expect(css).toMatch(/:root\[data-ui-style-contract="v1"\]\s+\.kimix-settings-panel\.is-workspace\s+:where\(\s*\.kimix-settings-theme-grid,\s*\.kimix-settings-permissions\s*\)\s*\{[^}]*border:\s*var\(--ui-role-inset-section-resting-border\);[^}]*background:\s*var\(--ui-role-inset-section-resting-background\);[^}]*box-shadow:\s*var\(--ui-role-inset-section-resting-shadow\);/s);
    expect(css).toMatch(/:root\[data-ui-style-contract="v1"\]\s+\.kimix-settings-panel\.is-workspace\s+\.kimix-settings-theme-grid\s*\{[^}]*border-radius:\s*calc\(var\(--ui-role-interactive-card-radius\)\s*\+\s*var\(--kimix-settings-theme-segment-inset\)\);/s);
    expect(css).toMatch(/:root\[data-ui-style-contract="v1"\]\s+\.kimix-settings-panel\.is-workspace\s+\.kimix-settings-permissions\s*\{[^}]*border-radius:\s*var\(--ui-role-inset-section-radius\);/s);
  });
  it("内置风格触点与导入契约只允许已说明的结构差集", () => {
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const contractStart = css.indexOf("/* ── 可导入界面风格契约 ──");
    const contractEnd = css.indexOf(".kimix-settings-uistyle-wrap", contractStart);
    expect(contractStart).toBeGreaterThan(0);
    expect(contractEnd).toBeGreaterThan(contractStart);

    const classesFromRules = (source: string, requireBuiltinScope: boolean) => {
      const classes = new Set<string>();
      for (const match of source.matchAll(/([^{}]+)\{/gs)) {
        const selector = match[1];
        if (requireBuiltinScope && !selector.includes("data-ui-style")) continue;
        for (const classMatch of selector.matchAll(/\.(kimix-[A-Za-z0-9_-]+)/g)) classes.add(classMatch[1]);
      }
      return classes;
    };
    const builtinClasses = classesFromRules(css.slice(0, contractStart), true);
    const customClasses = classesFromRules(css.slice(contractStart, contractEnd), false);
    const structuralOrDelegated = [
      "kimix-composer-input",
      "kimix-context-bar",
      "kimix-file-open-control",
      "kimix-long-task-button",
      "kimix-settings-section-title",
      "kimix-tabular-nums",
      "kimix-workspace-header",
      "kimix-workspace-page",
    ];
    const missing = [...builtinClasses].filter((className) => !customClasses.has(className)).sort();
    expect(missing).toEqual(structuralOrDelegated.sort());
  });
  it("新增 button 必须声明界面风格角色或显式豁免", () => {
    const componentRoot = resolve(process.cwd(), "src/components");
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
    const contractStart = css.indexOf("/* ── 可导入界面风格契约 ──");
    const contractEnd = css.indexOf(".kimix-settings-uistyle-wrap", contractStart);
    const styleMarkers = new Set(
      [...css.slice(contractStart, contractEnd).matchAll(/\.(kimix-[A-Za-z0-9_-]+)/g)].map((match) => match[1]),
    );
    styleMarkers.add("kimix-style-exempt");
    const hasStyleMarker = (value: string) => [...value.matchAll(/\bkimix-[A-Za-z0-9_-]+\b/g)]
      .some((match) => styleMarkers.has(match[0]));
    const collectTsx = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) return collectTsx(fullPath);
      return entry.isFile() && entry.name.endsWith(".tsx") ? [fullPath] : [];
    });
    const uncovered: string[] = [];

    for (const filePath of collectTsx(componentRoot)) {
      const sourceText = readFileSync(filePath, "utf8");
      const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const classConstants = new Map<string, string>();
      const collectConstants = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))) {
          classConstants.set(node.name.text, node.initializer.text);
        }
        ts.forEachChild(node, collectConstants);
      };
      collectConstants(sourceFile);

      const visit = (node: ts.Node) => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sourceFile) === "button") {
          const classAttribute = node.attributes.properties.find((attribute): attribute is ts.JsxAttribute => (
            ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "className"
          ));
          const classSource = classAttribute?.getText(sourceFile) ?? "";
          const referencedConstantProvidesRole = [...classSource.matchAll(/\b[A-Za-z_$][\w$]*\b/g)]
            .some((match) => hasStyleMarker(classConstants.get(match[0]) ?? ""));
          if (!hasStyleMarker(classSource) && !referencedConstantProvidesRole) {
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
            uncovered.push(`${relative(process.cwd(), filePath)}:${line}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }

    expect(uncovered).toEqual([]);
  });
});

describe("Composer 新会话配置能力", () => {
  it("未建立 runtime 时仍允许配置下一轮，Swarm 只保存本地意图", () => {
    const composer = readFileSync(resolve(process.cwd(), "src/components/chat/Composer.tsx"), "utf8");

    expect(composer).toContain("const canConfigureNextTurn = canUseComposer && (!activeSession || hasUniqueMutationOwner);");
    expect(composer).toContain("{(activeSession || currentProject) && (");
    expect(composer.match(/disabled=\{!canConfigureNextTurn\}/g)?.length).toBeGreaterThanOrEqual(2);
    expect(
      composer.match(/disabled=\{!canConfigureNextTurn \|\| \(towerModeEnabled && !swarmModeEnabled\)\}/g)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(composer).toContain("Swarm 模式将在首次发消息时");
    expect(composer).toContain("<span>Tower 模式</span>");
    expect(composer).toContain("多 Agent 工作树编排");
    expect(composer).toContain("已取消 Tower 待开启状态。");
    expect(composer).toContain('{towerModeDesired ? "取消" : towerModeEnabled ? "关闭" : "开启"}');
    expect(composer).toContain("权限模式将在首次发消息时生效。");
    expect(composer).toContain("将在首次发消息时生效。");
  });
});

describe("applyUiStyle", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute(UI_STYLE_ATTRIBUTE);
    document.documentElement.removeAttribute(UI_STYLE_CONTRACT_ATTRIBUTE);
  });

  it("modern/retro 设置 data-ui-style 属性", () => {
    applyUiStyle("modern");
    expect(document.documentElement.getAttribute(UI_STYLE_ATTRIBUTE)).toBe("modern");
    expect(document.documentElement.hasAttribute(UI_STYLE_CONTRACT_ATTRIBUTE)).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--ui-radius-card")).toBe("");
    applyUiStyle("retro");
    expect(document.documentElement.getAttribute(UI_STYLE_ATTRIBUTE)).toBe("retro");
    applyUiStyle("nostalgia");
    expect(document.documentElement.getAttribute(UI_STYLE_ATTRIBUTE)).toBe("nostalgia");
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

  it("自定义风格使用规范化文档注入变量，缺失文档则安全回退默认", () => {
    const custom = {
      ...BUILTIN_UI_STYLE_DOCUMENTS.retro,
      id: "platinum-soft",
      name: "白金小圆角",
    };
    applyUiStyle("custom:platinum-soft", [custom]);
    expect(document.documentElement.getAttribute(UI_STYLE_ATTRIBUTE)).toBe("custom:platinum-soft");
    expect(document.documentElement.getAttribute(UI_STYLE_CONTRACT_ATTRIBUTE)).toBe("v1");
    expect(document.documentElement.style.getPropertyValue("--ui-radius-card")).toBe("6px");
    expect(document.documentElement.style.getPropertyValue("--ui-role-section-card-resting-border"))
      .toBe("1px solid var(--border-default)");

    applyUiStyle("custom:missing", []);
    expect(document.documentElement.hasAttribute(UI_STYLE_ATTRIBUTE)).toBe(false);
    expect(document.documentElement.hasAttribute(UI_STYLE_CONTRACT_ATTRIBUTE)).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--ui-radius-card")).toBe("");
  });
});
