import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildRoundedWindowShape } from "../windowShape";

describe("buildRoundedWindowShape", () => {
  it("直角或无效尺寸恢复系统矩形", () => {
    expect(buildRoundedWindowShape(1280, 800, 0)).toEqual([]);
    expect(buildRoundedWindowShape(0, 800, 20)).toEqual([]);
    expect(buildRoundedWindowShape(1280, -1, 20)).toEqual([]);
  });

  it("生成上下对称、覆盖完整高度的圆角窗口区域", () => {
    const shape = buildRoundedWindowShape(100, 60, 12);

    expect(shape.length).toBeGreaterThan(3);
    expect(shape[0].x).toBeGreaterThan(0);
    expect(shape[0].width).toBeLessThan(100);
    expect(shape.some((rect) => rect.x === 0 && rect.width === 100)).toBe(true);
    expect(shape.reduce((height, rect) => height + rect.height, 0)).toBe(60);
    expect(shape.at(-1)).toMatchObject({ x: shape[0].x, width: shape[0].width });
  });

  it("把过大或小数半径收敛为安全整数", () => {
    const shape = buildRoundedWindowShape(20, 12, 99.8);

    expect(shape.reduce((height, rect) => height + rect.height, 0)).toBe(12);
    expect(shape.every((rect) => Number.isInteger(rect.x) && Number.isInteger(rect.width))).toBe(true);
    expect(shape.every((rect) => rect.x >= 0 && rect.width > 0 && rect.x + rect.width <= 20)).toBe(true);
  });

  it("主窗口在风格、尺寸和窗口状态变化时同步原生区域", () => {
    const source = readFileSync(resolve(process.cwd(), "electron/main.ts"), "utf8");

    expect(source).toContain('roundedCorners: process.platform === "win32" ? false : true');
    expect(source).toContain("win.setShape(buildRoundedWindowShape(width, height, mainWindowCornerRadius))");
    expect(source).toContain('mainWindow.on("resize", () => scheduleMainWindowShape(mainWindow))');
    expect(source).toMatch(/function emitWindowStateFor[\s\S]*?scheduleMainWindowShape\(win\);/);
    expect(source).toMatch(/settingsService\.saveSettings[\s\S]*?syncMainWindowCornerRadius\(settingsService\.loadSettings\(\)\);/);
  });
});
