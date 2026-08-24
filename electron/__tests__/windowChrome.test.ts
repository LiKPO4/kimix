import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Windows 主窗口外壳", () => {
  it("保留系统 DWM 窗口与任务栏身份，不再应用实验性 shape", () => {
    const source = readFileSync(resolve(process.cwd(), "electron/main.ts"), "utf8");

    expect(source).toContain("frame: false");
    expect(source).toContain("skipTaskbar: false");
    expect(source).toContain('icon: path.join(APP_ROOT, "..", "Kimix.png")');
    expect(source).not.toContain(".setShape(");
    expect(source).not.toContain("roundedCorners:");
    expect(source).not.toContain('from "./windowShape"');
  });
});
