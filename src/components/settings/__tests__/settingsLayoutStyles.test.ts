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
      /\.kimix-settings-panel\.is-workspace \.kimix-settings-body\s*\{[^}]*height:\s*100%;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s,
    );
    expect(css).toMatch(
      /\.kimix-settings-layout\.is-workspace\s*\{[^}]*display:\s*grid;[^}]*min-height:\s*100%;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
    );
    expect(css).toMatch(
      /\.kimix-settings-layout\.is-workspace \.kimix-settings-page\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*100%;[^}]*flex-direction:\s*column;/s,
    );
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
      'variant === "workspace" && activeSettingsPageId === "models" ? "is-models-page" : ""',
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

    expect(activeNavigationRule).toContain("background: var(--surface-hover)");
    expect(activeNavigationRule).not.toContain("box-shadow");
    expect(activePermissionRule).not.toContain("box-shadow");
    expect(searchFocusRule).not.toContain("box-shadow");
  });

  it("pins experimental status badges to a fixed right-side action column", () => {
    expect(settingsPanel.match(/kimix-settings-permission-with-status/g)).toHaveLength(2);
    expect(settingsPanel.match(/kimix-settings-permission-status/g)).toHaveLength(2);
    expect(css).toMatch(
      /\.kimix-settings-permission-with-status\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto;/s,
    );
    expect(css).toMatch(
      /\.kimix-settings-permission-status\s*\{[^}]*justify-self:\s*end;/s,
    );
  });
});
