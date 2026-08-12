import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KIMI_MONTHLY_QUOTA_URL,
  KIMI_WEB_QUOTA_URL,
  KimiCredentialAuthTaskCoordinator,
  KimiCredentialCandidateQueue,
  fetchKimiMonthlyQuota,
  inspectKimiWebToken,
  isAllowedKimiWebAuthUrl,
  normalizeKimiWebToken,
  parseKimiMonthlyQuotaPayload,
  selectKimiWebTokenCandidate,
} from "../kimiMonthlyQuota";

function jwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encoded}.signature`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Kimi 月度额度", () => {
  it("旧候选验真期间保留新请求 Bearer，并在当前验真后优先处理", async () => {
    let releaseOld: (() => void) | undefined;
    const oldPending = new Promise<void>((resolve) => { releaseOld = resolve; });
    const verified: string[] = [];
    const queue = new KimiCredentialCandidateQueue(async (value) => {
      verified.push(value);
      if (value === "old-storage-token") await oldPending;
      return value === "fresh-request-token";
    });

    queue.enqueue("old-storage-token", "storage");
    await vi.waitFor(() => expect(verified).toEqual(["old-storage-token"]));
    queue.enqueue("fallback-cookie-token", "cookie");
    queue.enqueue("fresh-request-token", "request");
    releaseOld?.();

    await vi.waitFor(() => expect(verified).toEqual(["old-storage-token", "fresh-request-token"]));
  });

  it("只复用同账号同模式认证任务，并允许交互登录接管后台任务", async () => {
    const coordinator = new KimiCredentialAuthTaskCoordinator();
    let releaseBackground: (() => void) | undefined;
    const backgroundPending = new Promise<void>((resolve) => { releaseBackground = resolve; });
    const cancelBackground = vi.fn(() => releaseBackground?.());
    const startBackground = vi.fn(() => ({ promise: backgroundPending, cancel: cancelBackground }));
    const onReuse = vi.fn();
    const first = coordinator.run({ interactive: false, expectedUserId: "user-1" }, startBackground);
    const reused = coordinator.run({ interactive: false, expectedUserId: "user-1" }, startBackground, onReuse);
    expect(startBackground).toHaveBeenCalledTimes(1);
    expect(onReuse).toHaveBeenCalledTimes(1);

    await expect(coordinator.run(
      { interactive: false, expectedUserId: "user-2" },
      () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    )).rejects.toThrow("后台刷新已跳过");

    const startInteractive = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
    await coordinator.run({ interactive: true, expectedUserId: "user-1" }, startInteractive);
    await Promise.all([first, reused]);
    expect(cancelBackground).toHaveBeenCalledTimes(1);
    expect(startInteractive).toHaveBeenCalledTimes(1);
  });

  it("兼容 Bearer、Cookie 字符串和 URL 编码的 kimi-auth 值", () => {
    const token = jwt({ sub: "user-1", exp: 4_102_444_800 });
    expect(normalizeKimiWebToken(`Bearer ${token}`)).toBe(token);
    expect(normalizeKimiWebToken(`other=1; kimi-auth=${encodeURIComponent(token)}; theme=light`)).toBe(token);
    expect(inspectKimiWebToken(token)).toMatchObject({ valid: true, subject: "user-1", expired: false });
  });

  it("临时登录窗口只允许 Kimi HTTPS 页面", () => {
    expect(KIMI_WEB_QUOTA_URL).toBe("https://www.kimi.com/membership/subscription?tab=quota");
    expect(isAllowedKimiWebAuthUrl("https://www.kimi.com/")).toBe(true);
    expect(isAllowedKimiWebAuthUrl("https://auth.kimi.com/callback")).toBe(true);
    expect(isAllowedKimiWebAuthUrl("http://www.kimi.com/")).toBe(false);
    expect(isAllowedKimiWebAuthUrl("https://kimi.com.example.test/")).toBe(false);
  });

  it("从页面存储 JWT 中优先选择有效的 Kimi 用户凭证", () => {
    const expired = jwt({ app_id: "kimi", sub: "old-user", exp: 1 });
    const refresh = jwt({ app_id: "kimi", sub: "kimi-user", exp: 4_102_444_900 });
    const access = jwt({ app_id: "kimi", device_id: "device-1", ssid: "session-1", sub: "kimi-user", exp: 4_102_444_800 });
    expect(selectKimiWebTokenCandidate({ misc: "not-a-token", expired, refresh_token: refresh, access_token: access })).toBe(access);
    expect(selectKimiWebTokenCandidate([access])).toBeNull();
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

  it("只请求会员统计接口并携带完整 Kimi 网页请求上下文", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      subscriptionBalance: { amountUsedRatio: 0.42 },
      giftBalances: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const token = jwt({ device_id: "device-1", ssid: "session-1", sub: "user-1", exp: 4_102_444_800 });
    const result = await fetchKimiMonthlyQuota(token);
    expect(result).toMatchObject({ available: true, subscription: { percent: 42 } });
    expect(result).toMatchObject({ credentialAccepted: true });
    expect(result.credentialRejected).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(KIMI_MONTHLY_QUOTA_URL, expect.objectContaining({
      method: "POST",
      body: "{}",
      headers: expect.objectContaining({
        Authorization: `Bearer ${token}`,
        "connect-protocol-version": "1",
      }),
    }));
    const request = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1];
    expect(request.headers).toEqual({
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "connect-protocol-version": "1",
    });
  });

  it("有效期尚未到时把 401 识别为接口拒绝而不是已过期", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    const result = await fetchKimiMonthlyQuota(jwt({ app_id: "kimi", sub: "user-1", exp: 4_102_444_800 }));
    expect(result).toMatchObject({ credentialRejected: true });
    expect(result.message).toContain("接口拒绝");
    expect(result.message).not.toContain("已过期");
  });
});
