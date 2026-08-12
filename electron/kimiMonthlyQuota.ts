import type { KimiMonthlyQuotaInfo, UsagePeriod } from "./types/ipc";

export const KIMI_MONTHLY_QUOTA_URL =
  "https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats";
export const KIMI_WEB_AUTH_URL = "https://www.kimi.com/code/console";

type JwtPayload = {
  app_id?: unknown;
  exp?: unknown;
  sub?: unknown;
};

type FetchMonthlyQuotaOptions = {
  expectedUserId?: string;
  timeoutMs?: number;
};

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return parseTimestamp(numeric);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function ratioToPercent(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value * 1000) / 10));
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as JwtPayload;
  } catch {
    return null;
  }
}

export function normalizeKimiWebToken(value: string): string {
  const trimmed = value.trim().replace(/^Bearer\s+/i, "");
  const cookieMatch = trimmed.match(/(?:^|;\s*)kimi-auth=([^;]+)/i);
  if (!cookieMatch) return trimmed;
  try {
    return decodeURIComponent(cookieMatch[1]).trim();
  } catch {
    return cookieMatch[1].trim();
  }
}

export function isAllowedKimiWebAuthUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && (hostname === "kimi.com" || hostname.endsWith(".kimi.com"));
  } catch {
    return false;
  }
}

export function inspectKimiWebToken(value: string): {
  valid: boolean;
  appId?: string;
  subject?: string;
  expiresAt?: number;
  expired: boolean;
} {
  const token = normalizeKimiWebToken(value);
  const payload = decodeJwtPayload(token);
  const expiresAt = typeof payload?.exp === "number" ? payload.exp * 1000 : undefined;
  return {
    valid: token.split(".").length === 3 && Boolean(payload),
    appId: typeof payload?.app_id === "string" ? payload.app_id : undefined,
    subject: typeof payload?.sub === "string" ? payload.sub : undefined,
    expiresAt,
    expired: expiresAt !== undefined && expiresAt <= Date.now(),
  };
}

export function selectKimiWebTokenCandidate(values: unknown): string | null {
  if (!Array.isArray(values)) return null;
  let best: { token: string; score: number; expiresAt: number } | null = null;
  for (const value of values.slice(0, 32)) {
    if (typeof value !== "string" || value.length > 16_384) continue;
    const token = normalizeKimiWebToken(value);
    const tokenInfo = inspectKimiWebToken(token);
    if (!tokenInfo.valid || tokenInfo.expired || tokenInfo.expiresAt === undefined) continue;
    const score = (tokenInfo.appId === "kimi" ? 2 : 0) + (tokenInfo.subject ? 1 : 0);
    if (!best || score > best.score || (score === best.score && tokenInfo.expiresAt > best.expiresAt)) {
      best = { token, score, expiresAt: tokenInfo.expiresAt };
    }
  }
  return best?.token ?? null;
}

function quotaPeriod(raw: unknown, label: string): UsagePeriod | undefined {
  const record = recordOf(raw);
  if (!record) return undefined;
  const percent = ratioToPercent(record.amountUsedRatio);
  return {
    label,
    available: percent !== undefined,
    percent: percent ?? 0,
    refreshAt: parseTimestamp(record.expireTime),
    message: percent === undefined ? "上游未返回额度占比" : undefined,
  };
}

export function parseKimiMonthlyQuotaPayload(payload: unknown): Pick<KimiMonthlyQuotaInfo, "subscription" | "gifts"> {
  const record = recordOf(payload);
  const subscription = quotaPeriod(record?.subscriptionBalance, "月度总额度");
  const gifts = Array.isArray(record?.giftBalances)
    ? record.giftBalances
      .map((gift, index) => quotaPeriod(gift, `赠送额度 ${index + 1}`))
      .filter((period): period is UsagePeriod => Boolean(period))
    : [];
  return { subscription, gifts };
}

export async function fetchKimiMonthlyQuota(
  rawToken: string,
  options: FetchMonthlyQuotaOptions = {},
): Promise<KimiMonthlyQuotaInfo> {
  const token = normalizeKimiWebToken(rawToken);
  const tokenInfo = inspectKimiWebToken(token);
  const base = {
    enabled: true as const,
    configured: Boolean(token),
    tokenExpiresAt: tokenInfo.expiresAt,
    gifts: [] as UsagePeriod[],
  };
  if (!token) {
    return { ...base, available: false, message: "尚未配置 Kimi 网页登录 Token。" };
  }
  if (!tokenInfo.valid) {
    return { ...base, available: false, message: "网页登录 Token 格式无效，请重新配置。" };
  }
  if (tokenInfo.expired) {
    return { ...base, available: false, message: "网页登录 Token 已过期，请重新配置。" };
  }
  if (options.expectedUserId && tokenInfo.subject && tokenInfo.subject !== options.expectedUserId) {
    return { ...base, available: false, accountMismatch: true, message: "网页 Token 与当前 Kimi Code 登录账号不一致。" };
  }

  try {
    const response = await fetch(KIMI_MONTHLY_QUOTA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: `kimi-auth=${token}`,
        "Content-Type": "application/json",
        Origin: "https://www.kimi.com",
        Referer: KIMI_WEB_AUTH_URL,
        Accept: "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        "connect-protocol-version": "1",
        "x-language": "zh-CN",
        "x-msh-platform": "web",
        "r-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
      },
      body: "{}",
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
    if (!response.ok) {
      const message = response.status === 401
        ? "Kimi 会员接口拒绝了当前网页登录凭证（HTTP 401），请重新自动获取。"
        : `月度额度查询失败（HTTP ${response.status}）。`;
      return { ...base, available: false, message };
    }
    const parsed = parseKimiMonthlyQuotaPayload(await response.json());
    const available = Boolean(parsed.subscription?.available || parsed.gifts.some((gift) => gift.available));
    return {
      ...base,
      ...parsed,
      available,
      message: available ? undefined : "会员统计接口未返回可展示的月度额度。",
    };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      ...base,
      available: false,
      message: timedOut ? "月度额度查询超时，基础套餐用量不受影响。" : `月度额度查询失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
