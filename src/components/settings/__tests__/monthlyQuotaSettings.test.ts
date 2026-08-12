import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("月度额度设置自动获取入口", () => {
  const settingsSource = readFileSync(resolve(process.cwd(), "src/components/settings/SettingsPanel.tsx"), "utf8");
  const mainSource = readFileSync(resolve(process.cwd(), "electron/main.ts"), "utf8");

  it("把内置登录自动获取作为主操作，并保留手动配置备用", () => {
    expect(settingsSource).toContain("打开 Kimi 并自动获取");
    expect(settingsSource).toContain("acquireKimiMonthlyQuotaCredential");
    expect(settingsSource).toContain("手动配置（备用）");
  });

  it("自动获取只在主进程读取 Cookie，并使用非持久登录分区", () => {
    expect(mainSource).toContain('ipcMain.handle("kimi-code:acquireMonthlyQuotaCredential"');
    expect(mainSource).toContain('authSession.cookies.get({ name: "kimi-auth" })');
    expect(mainSource).toContain("kimix-monthly-quota-auth-${randomUUID()}");
    expect(mainSource).not.toContain('partition: "persist:kimix-monthly-quota-auth"');
  });

  it("从会产生额度凭证的 Kimi Code 控制台发起登录并持续等待 Cookie", () => {
    const quotaSource = readFileSync(resolve(process.cwd(), "electron/kimiMonthlyQuota.ts"), "utf8");
    expect(quotaSource).toContain('KIMI_WEB_AUTH_URL = "https://www.kimi.com/code/console"');
    expect(mainSource).toContain("cookiePollTimer = setInterval(() => void findTokenCookie(), 750)");
    expect(mainSource).toContain("if (cookiePollTimer) clearInterval(cookiePollTimer)");
  });
});
