import type { KimiMonthlyQuotaInfo, UsagePeriod } from "./types/ipc";

export const KIMI_MONTHLY_QUOTA_URL =
  "https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats";
export const KIMI_WEB_QUOTA_URL = "https://www.kimi.com/membership/subscription?tab=quota";

type JwtPayload = {
  app_id?: unknown;
  device_id?: unknown;
  exp?: unknown;
  ssid?: unknown;
  sub?: unknown;
};

type FetchMonthlyQuotaOptions = {
  expectedUserId?: string;
  timeoutMs?: number;
};

export type KimiCredentialCandidateSource = "storage" | "cookie" | "request";

type KimiCredentialCandidate = {
  source: KimiCredentialCandidateSource;
  value: string;
};

const KIMI_CREDENTIAL_SOURCE_PRIORITY: Record<KimiCredentialCandidateSource, number> = {
  storage: 0,
  cookie: 1,
  request: 2,
};

export class KimiCredentialCandidateQueue {
  private activeValue: string | null = null;
  private pending: KimiCredentialCandidate[] = [];
  private processing = false;
  private stopped = false;

  constructor(private readonly verify: (value: string) => Promise<boolean>) {}

  enqueue(value: string, source: KimiCredentialCandidateSource): void {
    if (this.stopped || !value.trim()) return;
    const normalized = normalizeKimiWebToken(value);
    if (!normalized || normalized === this.activeValue) return;
    const existing = this.pending.find((candidate) => normalizeKimiWebToken(candidate.value) === normalized);
    if (existing) {
      if (KIMI_CREDENTIAL_SOURCE_PRIORITY[source] > KIMI_CREDENTIAL_SOURCE_PRIORITY[existing.source]) {
        existing.source = source;
        existing.value = value;
        this.sortPending();
      }
      return;
    }
    this.pending.push({ source, value });
    this.sortPending();
    void this.drain();
  }

  stop(): void {
    this.stopped = true;
    this.pending = [];
  }

  private sortPending(): void {
    this.pending.sort((left, right) => (
      KIMI_CREDENTIAL_SOURCE_PRIORITY[right.source] - KIMI_CREDENTIAL_SOURCE_PRIORITY[left.source]
    ));
  }

  private async drain(): Promise<void> {
    if (this.processing || this.stopped) return;
    this.processing = true;
    try {
      while (!this.stopped) {
        const candidate = this.pending.shift();
        if (!candidate) return;
        this.activeValue = normalizeKimiWebToken(candidate.value);
        if (await this.verify(candidate.value)) {
          this.stop();
          return;
        }
        this.activeValue = null;
      }
    } finally {
      this.activeValue = null;
      this.processing = false;
      if (!this.stopped && this.pending.length > 0) void this.drain();
    }
  }
}

export type KimiCredentialAuthTaskOptions = {
  interactive?: boolean;
  expectedUserId?: string;
};

type KimiCredentialAuthTask = {
  cancel: () => void;
  promise: Promise<void>;
};

export class KimiCredentialAuthTaskCoordinator {
  private active: (KimiCredentialAuthTask & { key: string }) | null = null;

  async run(
    options: KimiCredentialAuthTaskOptions,
    start: () => KimiCredentialAuthTask,
    onReuse?: () => void,
  ): Promise<void> {
    const interactive = options.interactive !== false;
    const expectedUserId = options.expectedUserId?.trim() || "";
    const key = `${interactive ? "interactive" : "background"}:${expectedUserId}`;
    const current = this.active;
    if (current) {
      if (current.key === key) {
        onReuse?.();
        return current.promise;
      }
      if (!interactive) throw new Error("已有其他 Kimi 网页认证任务正在进行，后台刷新已跳过。");
      current.cancel();
      try {
        await current.promise;
      } catch {
        // 交互登录明确接管时，旧后台任务的取消错误只返回给旧调用方。
      }
      return this.run(options, start);
    }

    const task = start();
    const active = { ...task, key };
    this.active = active;
    try {
      await task.promise;
    } finally {
      if (this.active === active) this.active = null;
    }
  }
}

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
  deviceId?: string;
  sessionId?: string;
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
    deviceId: typeof payload?.device_id === "string" ? payload.device_id : undefined,
    sessionId: typeof payload?.ssid === "string" ? payload.ssid : undefined,
    subject: typeof payload?.sub === "string" ? payload.sub : undefined,
    expiresAt,
    expired: expiresAt !== undefined && expiresAt <= Date.now(),
  };
}

export function selectKimiWebTokenCandidate(values: unknown): string | null {
  if (!values || typeof values !== "object" || Array.isArray(values)) return null;
  let best: { token: string; score: number; expiresAt: number } | null = null;
  for (const [key, value] of Object.entries(values).slice(0, 32)) {
    if (typeof value !== "string" || value.length > 16_384) continue;
    const token = normalizeKimiWebToken(value);
    const tokenInfo = inspectKimiWebToken(token);
    if (!tokenInfo.valid || tokenInfo.expired || tokenInfo.expiresAt === undefined) continue;
    const score = (key === "access_token" ? 8 : 0)
      + (tokenInfo.appId === "kimi" ? 4 : 0)
      + (tokenInfo.deviceId ? 2 : 0)
      + (tokenInfo.sessionId ? 2 : 0)
      + (tokenInfo.subject ? 1 : 0);
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
    return { ...base, available: false, credentialRejected: true, message: "网页登录 Token 已过期，请重新配置。" };
  }
  if (options.expectedUserId && tokenInfo.subject && tokenInfo.subject !== options.expectedUserId) {
    return { ...base, available: false, accountMismatch: true, message: "网页 Token 与当前 Kimi Code 登录账号不一致。" };
  }

  try {
    const response = await fetch(KIMI_MONTHLY_QUOTA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "connect-protocol-version": "1",
      },
      body: "{}",
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
    if (!response.ok) {
      const message = response.status === 401
        ? "Kimi 会员接口拒绝了当前网页登录凭证（HTTP 401），请重新自动获取。"
        : `月度额度查询失败（HTTP ${response.status}）。`;
      return { ...base, available: false, credentialRejected: response.status === 401, message };
    }
    const parsed = parseKimiMonthlyQuotaPayload(await response.json());
    const available = Boolean(parsed.subscription?.available || parsed.gifts.some((gift) => gift.available));
    return {
      ...base,
      ...parsed,
      credentialAccepted: true,
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
