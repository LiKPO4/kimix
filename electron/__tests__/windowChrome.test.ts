import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Windows 主窗口外壳", () => {
  it("窗口四角随风格裁切，Windows 任务栏图标和分组身份都绑定 Kimix", () => {
    const source = readFileSync(resolve(process.cwd(), "electron/main.ts"), "utf8");

    expect(source).toContain("frame: false");
    expect(source).toContain("skipTaskbar: false");
    expect(source).toContain('const WINDOWS_APP_USER_MODEL_ID = "com.kimix.app";');
    expect(source).toContain('app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);');
    expect(source).toContain('const APP_ICON_FILE_NAME = process.platform === "win32" ? "icon.ico" : "icon.png";');
    expect(source).toContain("path.join(process.resourcesPath, APP_ICON_FILE_NAME)");
    expect(source).toContain('path.join(APP_ROOT, "..", "build", APP_ICON_FILE_NAME)');
    expect(source).toContain("const mainWindowIcon = nativeImage.createFromPath(APP_ICON_PATH);");
    expect(source).toContain("icon: mainWindowIcon");
    expect(source).toContain('app.isPackaged && !mainWindowIcon.isEmpty()');
    expect(source).toContain("mainWindow.setIcon(mainWindowIcon);");
    expect(source).toContain("mainWindow.setAppDetails({");
    expect(source).toContain("appId: WINDOWS_APP_USER_MODEL_ID,");
    expect(source).toContain("appIconPath: APP_ICON_PATH,");
    expect(source).toContain("appIconIndex: 0,");
    expect(source).toContain('transparent: process.platform === "win32" ? true : false');
    expect(source).toContain('backgroundColor: "#00000000"');
    expect(source).not.toContain("setShape");
  });

  it("渲染进程为 Windows 透明外壳标记 CSS 消费分支", () => {
    const renderer = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
    const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

    expect(renderer).toContain('setAttribute("data-transparent-shell", "1")');
    expect(css).toMatch(/:root\[data-transparent-shell="1"\]\s+body\s*\{[^}]*background-color:\s*transparent;/s);
  });

  it("安装包显式携带并嵌入 Windows 图标", () => {
    const config = readFileSync(resolve(process.cwd(), "electron-builder.yml"), "utf8");
    const icon = readFileSync(resolve(process.cwd(), "build/icon.ico"));

    expect(config).toMatch(/extraResources:[\s\S]*from: build\/icon\.ico[\s\S]*to: icon\.ico/);
    expect(config).toMatch(/win:[\s\S]*icon: build\/icon\.ico/);
    expect(icon.readUInt16LE(0)).toBe(0);
    expect(icon.readUInt16LE(2)).toBe(1);
    expect(icon.readUInt16LE(4)).toBeGreaterThan(0);
    expect([...Array(icon.readUInt16LE(4)).keys()].some((index) => (
      icon[6 + index * 16] === 0 && icon[7 + index * 16] === 0
    ))).toBe(true);
  });
});
