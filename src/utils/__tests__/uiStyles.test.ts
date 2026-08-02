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
    expect(css).toMatch(/:where\(\[data-ui-style="retro"\]\)\s+:where\([\s\S]*?\.kimix-sidebar-icon-action,[\s\S]*?\.kimix-settings-entry,[\s\S]*?button\.kimix-chat-collapse-row[\s\S]*?\):hover:not\(:disabled\)\s*\{[^}]*box-shadow:\s*0 0 0 1px var\(--kimix-retro-button-hover-border-color\), var\(--kimix-retro-button-hover-shadow\);/s);
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
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-state-button:not\(\[aria-pressed="true"\]\):hover:not\(:disabled\)\s*\{[^}]*border-color:\s*var\(--kimix-retro-button-hover-border-color\);[^}]*background:\s*var\(--kimix-retro-button-hover-background\);[^}]*box-shadow:\s*var\(--kimix-retro-button-hover-shadow\);/s);
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-state-button\[aria-pressed="true"\],[\s\S]*?\{[^}]*border-color:\s*var\(--accent-primary-soft\);[^}]*background:\s*var\(--accent-primary-light\);[^}]*color:\s*var\(--accent-primary-dark\);/s);
    expect(css).toMatch(/:where\(\.kimix-toolbar-button, \.kimix-split-control\)\.is-expanded,[\s\S]*?box-shadow:\s*var\(--ui-toggle-shadow\);/);
    expect(css).toMatch(/\.kimix-split-control\.is-expanded,[\s\S]*?\.kimix-split-control\.is-expanded:hover\s*\{[^}]*box-shadow:\s*var\(--ui-toggle-shadow\);/);
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
    const todoPanel = readFileSync(resolve(process.cwd(), "src/components/chat/TodoPanel.tsx"), "utf8");
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
    for (const source of [changeCard, fileCard, todoPanel]) {
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
      "kimix-skill-card",
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
    const gitPullButton = longTaskInspector.match(/onClick=\{\(\) => void pullGit\(\)\}[\s\S]{0,220}?className="([^"]+)"/);

    expect(longTaskInspector).toContain("kimix-inspector-drag-handle");
    expect(longTaskInspector).toContain("kimix-inspector-action");
    expect(longTaskInspector.match(/kimix-inspector-field/g)).toHaveLength(4);
    expect(css).toMatch(/\.kimix-longtask-inspector\s+\.kimix-section-card\s+\.kimix-inspector-action\s*\{[^}]*background-color:\s*var\(--surface-base\);/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-longtask-inspector\s+\.kimix-section-card\s+\.kimix-icon-text-button[\s\S]*?\{[^}]*border:\s*1px solid transparent;[^}]*border-radius:\s*var\(--kimix-modern-control-radius\);[^}]*box-shadow:\s*none;/s);
    expect(css).toMatch(/\[data-ui-style="modern"\]\s+\.kimix-longtask-inspector\s+\.kimix-section-card\s+\.kimix-inspector-action\s*\{[^}]*background-color:\s*var\(--surface-base\);/s);
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-longtask-inspector\s+\.kimix-section-card\s+\.kimix-icon-text-button:not\(\.bg-accent-primary\)[\s\S]*?\{[^}]*border:\s*1px solid transparent;[^}]*border-radius:\s*var\(--radius-sm\);[^}]*background-image:\s*none;[^}]*box-shadow:\s*none;/s);
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-longtask-inspector\s+\.kimix-section-card\s+\.kimix-icon-text-button\.kimix-inspector-action\s*\{[^}]*background-color:\s*var\(--surface-base\);/s);
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-longtask-inspector\s+\.kimix-section-card\s+\.kimix-icon-text-button\.kimix-inspector-action:hover:not\(:disabled\)[\s\S]*?\{[^}]*box-shadow:\s*var\(--ui-control-hover-shadow\);/s);
    expect(gitDetailsButton?.[1].split(/\s+/)).toEqual(expect.arrayContaining(["kimix-icon-text-button", "kimix-inspector-action", "text-accent-primary"]));
    expect(gitDetailsButton?.[1].split(/\s+/)).not.toContain("bg-accent-primary-light");
    expect(gitPullButton?.[1].split(/\s+/)).toEqual(expect.arrayContaining(["kimix-icon-text-button", "kimix-inspector-action", "text-text-muted"]));
    expect(gitPullButton?.[1].split(/\s+/)).not.toContain("bg-surface-base");
    expect(css).toMatch(/\[data-ui-style="retro"\]\s+\.kimix-longtask-inspector\s+\.kimix-inspector-field\s*\{[^}]*border:\s*var\(--ui-field-border\);[^}]*border-radius:\s*var\(--radius-sm\);[^}]*box-shadow:\s*var\(--ui-field-shadow\);/s);
    expect(css).not.toMatch(/\[data-ui-style="(?:modern|retro)"\]\s+\.kimix-icon-text-button\s*\{/);
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
