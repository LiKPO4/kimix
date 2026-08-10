import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
const appShell = readFileSync(resolve(process.cwd(), "src/components/layout/AppShell.tsx"), "utf8");
const diffPanel = readFileSync(resolve(process.cwd(), "src/components/layout/DiffPanel.tsx"), "utf8");
const longTaskInspector = readFileSync(resolve(process.cwd(), "src/components/layout/LongTaskInspectorPanel.tsx"), "utf8");

describe("layout resizer styles", () => {
  it("左侧拖拽柄保持无缝，右侧拖拽柄保留 4px 面板间隙", () => {
    const rule = css.match(/\.kimix-layout-resizer\s*\{([^}]*)\}/s)?.[1] ?? "";

    expect(rule).toContain("width: 12px");
    expect(rule).toContain("flex: 0 0 12px");
    expect(rule).toContain("margin-right: -12px");
    expect(rule).toContain("z-index: 2");

    const panelGapRule = css.match(/\.kimix-layout-resizer\.has-panel-gap\s*\{([^}]*)\}/s)?.[1] ?? "";
    expect(panelGapRule).toContain("margin-right: -8px");
    expect(appShell).toContain('<ResizeHandle ariaLabel="调整右侧栏宽度" onPointerDown={startRightPanelResize} withPanelGap />');

    const indicatorRule = css.match(/\.kimix-layout-resizer::after\s*\{([^}]*)\}/s)?.[1] ?? "";
    expect(indicatorRule).toContain("left: -1px");
    const panelGapIndicatorRule = css.match(/\.kimix-layout-resizer\.has-panel-gap::after\s*\{([^}]*)\}/s)?.[1] ?? "";
    expect(panelGapIndicatorRule).toContain("left: 1px");
  });

  it("会话侧栏与文件预览使用一致的标题和内容外边距", () => {
    const headerSpacing = "paddingLeft: 18, paddingRight: 14";
    const bodySpacing = "paddingLeft: 18, paddingRight: 18, paddingTop: 14, paddingBottom: 20";

    expect(diffPanel).toContain(headerSpacing);
    expect(longTaskInspector).toContain(headerSpacing);
    expect(diffPanel).toContain(bodySpacing);
    expect(longTaskInspector).toContain(bodySpacing);
  });

  it("关闭文件预览侧栏不会清空中间文件预览", () => {
    expect(appShell).toContain('onClose={() => setDiffPanelOpen(false)}');
    expect(appShell).not.toContain('if (!diffPanelOpen) {\n      setPreviewFile(null);');
  });

  it("右侧面板标题栏的图标按钮共享同一悬停材质", () => {
    const headerActionClass = "kimix-inline-icon-action is-roomy text-text-muted hover:bg-surface-hover hover:text-text-primary";

    expect(diffPanel.split(headerActionClass).length - 1).toBe(2);
    expect(longTaskInspector).toContain(headerActionClass);
    expect(diffPanel).not.toContain('className="kimix-muted-action flex h-8 w-8 items-center justify-center rounded-lg"');

    expect(css).toContain('[data-ui-style="modern"] :where(.kimix-longtask-inspector, .kimix-diff-panel) .kimix-inline-icon-action.is-roomy');
    expect(css).toContain('[data-ui-style="retro"] :where(.kimix-longtask-inspector, .kimix-diff-panel) .kimix-inline-icon-action.is-roomy:hover:not(:disabled)');
    expect(css).toContain('[data-ui-style="nostalgia"] :where(.kimix-longtask-inspector, .kimix-diff-panel) .kimix-inline-icon-action.is-roomy:hover:not(:disabled)');
    expect(css).toContain('.kimix-diff-panel .kimix-inline-icon-action.is-roomy:hover:not(:disabled)');
  });
});
