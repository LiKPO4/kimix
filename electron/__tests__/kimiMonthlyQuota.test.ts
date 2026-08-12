import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KIMI_MONTHLY_QUOTA_URL,
  fetchKimiMonthlyQuota,
  inspectKimiWebToken,
  isAllowedKimiWebAuthUrl,
  normalizeKimiWebToken,
  parseKimiMonthlyQuotaPayload,
} from "../kimiMonthlyQuota";

function jwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encoded}.signature`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Kimi 月度额度", () => {
  it("兼容 Bearer、Cookie 字符串和 URL 编码的 kimi-auth 值", () => {
    const token = jwt({ sub: "user-1", exp: 4_102_444_800 });
    expect(normalizeKimiWebToken(`Bearer ${token}`)).toBe(token);
    expect(normalizeKimiWebToken(`other=1; kimi-auth=${encodeURIComponent(token)}; theme=light`)).toBe(token);
    expect(inspectKimiWebToken(token)).toMatchObject({ valid: true, subject: "user-1", expired: false });
  });

  it("临时登录窗口只允许 Kimi HTTPS 页面", () => {
    expect(isAllowedKimiWebAuthUrl("https://www.kimi.com/")).toBe(true);
    expect(isAllowedKimiWebAuthUrl("https://auth.kimi.com/callback")).toBe(true);
    expect(isAllowedKimiWebAuthUrl("http://www.kimi.com/")).toBe(false);
    expect(isAllowedKimiWebAuthUrl("https://kimi.com.example.test/")).toBe(false);
  });

  it("把月度与赠送额度占比归一为套餐小窗使用的周期", () => {
    expect(parseKimiMonthlyQuotaPayload({
      subscriptionBalance: { amountUsedRatio: 0.257, expireTime: "2030-01-01T00:00:00Z" },
      giftBalances: [
        { amountUsedRatio: 0.5, expireTime: 1_893_456_000 },
        { amountUsedRatio: 1.2 },
      ],
    })).toEqual({
      subscription: expect.objectContaining({ label: "月度总额度", available: true, percent: 25.7, refreshAt: 1_893_456_000_000 }),
      gifts: [
        expect.objectContaining({ label: "赠送额度 1", available: true, percent: 50, refreshAt: 1_893_456_000_000 }),
        expect.objectContaining({ label: "赠送额度 2", available: true, percent: 100 }),
      ],
    });
  });

  it("账号不一致时在本地拒绝请求，避免展示另一账号额度", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchKimiMonthlyQuota(jwt({ sub: "web-user", exp: 4_102_444_800 }), {
      expectedUserId: "coding-user",
    });
    expect(result).toMatchObject({ available: false, accountMismatch: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("只请求会员统计接口并携带 Connect 协议头", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      subscriptionBalance: { amountUsedRatio: 0.42 },
      giftBalances: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const token = jwt({ sub: "user-1", exp: 4_102_444_800 });
    const result = await fetchKimiMonthlyQuota(token);
    expect(result).toMatchObject({ available: true, subscription: { percent: 42 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(KIMI_MONTHLY_QUOTA_URL, expect.objectContaining({
      method: "POST",
      body: "{}",
      headers: expect.objectContaining({
        Authorization: `Bearer ${token}`,
        "connect-protocol-version": "1",
      }),
    }));
  });
});
