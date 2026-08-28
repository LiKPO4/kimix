import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
const settingsPanel = readFileSync(
  resolve(process.cwd(), "src/components/settings/SettingsPanel.tsx"),
  "utf8",
);
const settingsSidebar = readFileSync(
  resolve(process.cwd(), "src/components/settings/SettingsWorkspaceSidebar.tsx"),
  "utf8",
);

describe("settings workspace scroll layout", () => {
  it("keeps one outer workspace scroll container aligned with the chat viewport edge", () => {
    expect(css).toMatch(
      /\.kimix-settings-panel\.is-workspace \.kimix-settings-body\s*\{[^}]*height:\s*auto;[^}]*flex:\s*1;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s,
    );
    expect(css).toMatch(
      /\.kimix-settings-layout\.is-workspace\s*\{[^}]*display:\s*grid;[^}]*min-height:\s*100%;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
    );
    expect(css).toMatch(
      /\.kimix-settings-layout\.is-workspace \.kimix-settings-page\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*100%;[^}]*flex-direction:\s*column;/s,
    );
  });

  it("keeps workspace context in the sidebar without repeating the selected page heading", () => {
    expect(settingsPanel).toContain('<div className="kimix-workspace-header">');
    expect(settingsPanel).toContain("管理 Kimix 的外观、对话权限、账户连接与高级选项。");
    expect(settingsPanel).toContain("onClick={onBackToChat}");
    expect(settingsSidebar).toContain("kimix-settings-sidebar-header");
    expect(settingsSidebar).toContain("返回对话");
    expect(settingsPanel).not.toContain("kimix-settings-page-header");
    expect(settingsPanel).not.toContain("kimix-settings-page-heading");
    expect(settingsPanel).toContain("kimix-settings-page-toolbar");
  });

  it("pins the footer to the viewport bottom without detaching it from overflowing content", () => {
    expect(css).toMatch(
      /\.kimix-settings-columns\.is-workspace\s*\{[^}]*flex-shrink:\s*0;[^}]*padding-bottom:\s*18px;/s,
    );
    expect(css).toMatch(
      /\.kimix-settings-panel\.is-workspace \.kimix-settings-footer\s*\{[^}]*flex-shrink:\s*0;[^}]*margin-top:\s*auto;/s,
    );
  });

  it("lets the model provider page consume the space above the pinned footer", () => {
    expect(settingsPanel).toContain(
      'variant === "workspace" && (activeSettingsPageId === "models" || activeSettingsPageId === "subagents") ? "is-models-page" : ""',
    );
    expect(css).toMatch(
      /\.kimix-settings-columns\.is-workspace\.is-models-page\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1 0 auto;/s,
    );
    expect(css).toMatch(
      /\.kimix-settings-columns\.is-workspace\.is-models-page\s+\.kimix-settings-section\[data-settings-page-id="models"\]\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1;/s,
    );
    expect(css).toMatch(
      /\.kimix-settings-columns\.is-workspace\.is-models-page \.kimix-model-provider-manager\s*\{[^}]*flex:\s*1;/s,
    );
    // 子代理页（模型池）复用同一拉满链
    expect(css).toMatch(
      /\.kimix-settings-columns\.is-workspace\.is-models-page\s+\.kimix-settings-section\[data-settings-page-id="subagents"\]\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1;[^}]*flex-direction:\s*column;/s,
    );
  });

  it("reuses the native Kimix scrollbar instead of overriding it with a settings-only width", () => {
    expect(settingsPanel).toContain(
      'className={`kimix-settings-body ${variant === "workspace" ? "kimix-stable-scrollbar" : ""}`}',
    );
    expect(settingsSidebar).toContain(
      'className="kimix-settings-sidebar-scroll kimix-stable-scrollbar"',
    );
    expect(css).not.toMatch(
      /\.kimix-settings-(?:sidebar-scroll|layout\.is-workspace \.kimix-settings-page)\s*\{[^}]*scrollbar-width:/s,
    );
  });

  it("让设置侧栏控件随拖拽宽度对齐到同一右边界", () => {
    expect(settingsSidebar).toContain('style={{ width, minHeight: 0, padding: "0 0 12px 12px" }}');
    expect(css).toMatch(
      /\.kimix-settings-sidebar-scroll\s*\{[^}]*padding:\s*0 0 16px 8px;[^}]*scrollbar-gutter:\s*stable;/s,
    );
    expect(css).toMatch(
      /\.kimix-settings-search\.is-sidebar\s*\{[^}]*margin-left:\s*8px;[^}]*margin-right:\s*8px;/s,
    );
    expect(css).toMatch(
      /\.kimix-settings-navigation-item,\s*\.kimix-settings-search-result\s*\{[^}]*width:\s*100%;/s,
    );
  });

  it("keeps settings navigation and focus feedback aligned with the native sidebar style", () => {
    const activeNavigationRule = css.match(
      /\.kimix-settings-navigation-item\.is-active\s*\{([^}]*)\}/s,
    )?.[1] ?? "";
    const activePermissionRule = css.match(
      /\.kimix-settings-panel\.is-workspace \.kimix-settings-permission\.is-active\s*\{([^}]*)\}/s,
    )?.[1] ?? "";
    const searchFocusRule = css.match(
      /\.kimix-settings-search:focus-within\s*\{([^}]*)\}/s,
    )?.[1] ?? "";

    expect(activeNavigationRule).toContain("background: var(--ui-selection-background)");
    expect(activeNavigationRule).toContain("box-shadow: var(--ui-selection-shadow)");
    expect(activePermissionRule).not.toContain("box-shadow");
    expect(searchFocusRule).not.toContain("box-shadow");
  });

  it("pins experimental status badges to a fixed right-side action column", () => {
    expect(settingsPanel.match(/kimix-settings-permission-with-status/g)).toHaveLength(4);
    expect(settingsPanel.match(/kimix-settings-permission-status/g)).toHaveLength(4);
    expect(css).toMatch(
      /\.kimix-settings-permission-with-status\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto;/s,
    );
    expect(css).toMatch(
      /\.kimix-settings-permission-status\s*\{[^}]*justify-self:\s*end;/s,
    );
  });

  it("exposes the official Translator key guide and the complete 1–5 second cadence choices", () => {
    expect(settingsPanel).toContain(
      'https://learn.microsoft.com/en-us/azure/ai-services/translator/how-to/create-translator-resource',
    );
    expect(settingsPanel).toContain("<span>获取 Key</span>");
    expect(settingsPanel).toContain("[1000, 2000, 2500, 3000, 4000, 5000]");
  });

  it("将思考翻译拆成独立分区，并提供关闭、本地模型和云端服务三个互斥选项", () => {
    const processStart = settingsPanel.indexOf('settingsSectionProps("processDisplay", 7)');
    const translationStart = settingsPanel.indexOf('settingsSectionProps("thinkingTranslation", 8)');
    const filePreviewStart = settingsPanel.indexOf('settingsSectionProps("filePreview", 8)');
    expect(translationStart).toBeGreaterThan(processStart);
    expect(filePreviewStart).toBeGreaterThan(translationStart);
    expect(settingsPanel.slice(translationStart, filePreviewStart)).toContain("不启用翻译");
    expect(settingsPanel.slice(translationStart, filePreviewStart)).toContain("本地轻量翻译");
    expect(settingsPanel.slice(translationStart, filePreviewStart)).toContain("Microsoft 云端翻译");
    expect(settingsPanel.slice(translationStart, filePreviewStart)).toContain("下载并启用");
  });

  it("keeps UI style, display preferences, and palette in separate appearance sections", () => {
    const themeStart = settingsPanel.indexOf('settingsSectionProps("theme", 3)');
    const styleStart = settingsPanel.indexOf('settingsSectionProps("uiStyle", 4)');
    const displayStart = settingsPanel.indexOf('settingsSectionProps("display", 5)');
    const paletteStart = settingsPanel.indexOf('settingsSectionProps("palette", 6)');

    expect(themeStart).toBeGreaterThan(-1);
    expect(styleStart).toBeGreaterThan(themeStart);
    expect(displayStart).toBeGreaterThan(styleStart);
    expect(paletteStart).toBeGreaterThan(displayStart);
    expect(settingsPanel.slice(styleStart, displayStart)).toContain("界面风格");
    expect(settingsPanel.slice(styleStart, displayStart)).not.toContain("界面字号");
    expect(settingsPanel.slice(styleStart, displayStart)).not.toContain("对话刻度");
    expect(settingsPanel.slice(displayStart, paletteStart)).toContain("界面字号");
    expect(settingsPanel.slice(displayStart, paletteStart)).toContain("对话刻度");
  });

  it("只为当前自定义风格追加一张带来源标记的自带色彩卡", () => {
    expect(settingsPanel).toContain('const activeCustomUiStyle = uiStyle.startsWith("custom:")');
    expect(settingsPanel).toContain("...(activeCustomUiStyle ? [{");
    expect(settingsPanel).toContain("uiStyleThemePaletteId(activeCustomUiStyle.id)");
    expect(settingsPanel).toContain("风格化自带");
    expect(settingsPanel).not.toContain("...customUiStyles.map((document) => ({\n      value: uiStyleThemePaletteId");
  });
});
