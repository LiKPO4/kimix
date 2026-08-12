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

  it("自动获取只在主进程读取凭证，并使用可续期的专用登录分区", () => {
    expect(mainSource).toContain('ipcMain.handle("kimi-code:acquireMonthlyQuotaCredential"');
    expect(mainSource).toContain('authSession.cookies.get({ name: "kimi-auth" })');
    expect(mainSource).toContain('KIMI_MONTHLY_QUOTA_PARTITION = "persist:kimix-monthly-quota-auth"');
    expect(mainSource).toContain("quotaSession.clearStorageData()");
  });

  it("从会产生额度凭证的 Kimi Code 控制台发起登录并持续等待 Cookie", () => {
    const quotaSource = readFileSync(resolve(process.cwd(), "electron/kimiMonthlyQuota.ts"), "utf8");
    expect(quotaSource).toContain('KIMI_WEB_QUOTA_URL = "https://www.kimi.com/membership/subscription?tab=quota"');
    expect(mainSource).toContain("cookiePollTimer = setInterval(() => void findTokenCredential(), 750)");
    expect(mainSource).toContain("if (cookiePollTimer) clearInterval(cookiePollTimer)");
    expect(mainSource).toContain("authSession.webRequest.onBeforeSendHeaders");
    expect(mainSource).toContain('urls: ["https://www.kimi.com/apiv2/*"]');
  });

  it("Cookie 缺失时从 Kimi 页面 localStorage 捕获有效 JWT", () => {
    expect(mainSource).toContain("webContents.executeJavaScript");
    expect(mainSource).toContain("Object.entries(localStorage)");
    expect(mainSource).toContain("selectKimiWebTokenCandidate(storageCandidates)");
  });

  it("额度查询前用隐藏窗口刷新短期访问凭证", () => {
    expect(mainSource).toContain("timeoutMs: 12_000");
    expect(mainSource).toContain("if (quota.credentialRejected || !token)");
    expect(mainSource).toContain("if (!verified.credentialAccepted)");
    expect(mainSource).toContain("if (!interactive && !pageReady) return");
    expect(mainSource).toContain("if (interactive && !authWindow.isDestroyed()) authWindow.show()");
    expect(settingsSource).toContain("查询额度时 Kimix 会在后台自动刷新短期凭证");
    expect(settingsSource).toContain("清除 Token 会一并退出该专用会话");
  });
});
