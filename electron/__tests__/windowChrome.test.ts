import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Windows 主窗口外壳", () => {
  it("窗口四角随风格裁切，任务栏图标沿用窗口 Kimix 图标", () => {
    const source = readFileSync(resolve(process.cwd(), "electron/main.ts"), "utf8");

    expect(source).toContain("frame: false");
    expect(source).toContain("skipTaskbar: false");
    expect(source).toContain('const WINDOWS_APP_USER_MODEL_ID = "com.kimix.app";');
    expect(source).toContain('app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);');
    expect(source).toContain('const APP_ICON_FILE_NAME = process.platform === "win32" ? "icon.ico" : "icon.png";');
    expect(source).toContain("path.join(process.resourcesPath, APP_ICON_FILE_NAME)");
    expect(source).toContain('path.join(APP_ROOT, "..", "build", APP_ICON_FILE_NAME)');
    expect(source).toContain("icon: APP_ICON_PATH");
    expect(source).toContain("win.setShape(buildRoundedWindowShape(width, height, mainWindowCornerRadius))");
    expect(source).not.toContain("mainWindow.setIcon(");
    expect(source).not.toContain("mainWindow.setAppDetails(");
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
