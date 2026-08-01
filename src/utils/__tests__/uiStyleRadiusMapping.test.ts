import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 界面风格机制防回退：rounded-* 必须保持 --ui-radius-* 变量映射，
 * 且 fallback 精确等于原固定值（默认风格视觉不变的根基）。
 * 防止有人把 lg/xl/2xl 改回固定值导致风格切换失效。
 */
const configPath = resolve(process.cwd(), "tailwind.config.ts");
const source = readFileSync(configPath, "utf8");

describe("tailwind borderRadius 变量映射", () => {
  it("rounded-lg/xl/2xl 映射 --ui-radius-* 且 fallback 为原固定值 8/12/16", () => {
    expect(source).toContain("'lg': 'var(--ui-radius-lg, 8px)'");
    expect(source).toContain("'xl': 'var(--ui-radius-xl, 12px)'");
    expect(source).toContain("'2xl': 'var(--ui-radius-2xl, 16px)'");
  });

  it("rounded-sm/md 映射 --ui-radius-sm/md 且 fallback 为 6/12", () => {
    expect(source).toContain("'sm': 'var(--ui-radius-sm, 6px)'");
    expect(source).toContain("'md': 'var(--ui-radius-md, 12px)'");
  });

  it("token 圆角保留 --ui-radius-*-token -> --radius-* 回退链", () => {
    expect(source).toContain("'sm-token': 'var(--ui-radius-sm-token, var(--radius-sm))'");
    expect(source).toContain("'md-token': 'var(--ui-radius-md-token, var(--radius-md))'");
    expect(source).toContain("'lg-token': 'var(--ui-radius-lg-token, var(--radius-lg))'");
  });
});
