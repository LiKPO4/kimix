import type { ExtraUsageInfo, KimiUsageResponse, UsagePeriod } from "./types/ipc";

type KimiUsageData = Extract<KimiUsageResponse, { success: true }>["data"];
const BOOSTER_FIXED_POINT_CENTS = 1_000_000;

export function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nonNegativeNumber(value: unknown): number {
  const parsed = toNumber(value);
  return parsed === undefined ? 0 : Math.max(0, Math.round(parsed));
}

function parseNormalizedExtraUsage(raw: unknown): ExtraUsageInfo | undefined {
  const record = getRecord(raw);
  if (!record) return undefined;
  const totalCents = nonNegativeNumber(record.totalCents);
  if (totalCents <= 0) return undefined;
  return {
    balanceCents: nonNegativeNumber(record.balanceCents),
    totalCents,
    monthlyChargeLimitEnabled: record.monthlyChargeLimitEnabled === true,
    monthlyChargeLimitCents: nonNegativeNumber(record.monthlyChargeLimitCents),
    monthlyUsedCents: nonNegativeNumber(record.monthlyUsedCents),
    currency: typeof record.currency === "string" && record.currency.trim() ? record.currency.trim().toUpperCase() : "USD",
  };
}

function parseMoney(raw: unknown): { cents: number; currency: string } | undefined {
  const record = getRecord(raw);
  const cents = toNumber(record?.priceInCents);
  if (cents === undefined) return undefined;
  return {
    cents: Math.max(0, Math.round(cents)),
    currency: typeof record?.currency === "string" ? record.currency.trim().toUpperCase() : "",
  };
}

function parseBoosterWallet(raw: unknown): ExtraUsageInfo | undefined {
  const wallet = getRecord(raw);
  const balance = getRecord(wallet?.balance);
  if (!wallet || !balance || balance.type !== "BOOSTER") return undefined;
  const totalRaw = toNumber(balance.amount);
  if (totalRaw === undefined || totalRaw <= 0) return undefined;
  const monthlyLimit = parseMoney(wallet.monthlyChargeLimit);
  const monthlyUsed = parseMoney(wallet.monthlyUsed);
  const amountLeftRaw = toNumber(balance.amountLeft);
  return {
    balanceCents: amountLeftRaw === undefined ? 0 : Math.max(0, Math.round(amountLeftRaw / BOOSTER_FIXED_POINT_CENTS)),
    totalCents: Math.max(1, Math.round(totalRaw / BOOSTER_FIXED_POINT_CENTS)),
    monthlyChargeLimitEnabled: wallet.monthlyChargeLimitEnabled === true,
    monthlyChargeLimitCents: monthlyLimit?.cents ?? 0,
    monthlyUsedCents: monthlyUsed?.cents ?? 0,
    currency: monthlyLimit?.currency || monthlyUsed?.currency || "USD",
  };
}

function extraUsageFromPayload(payload: Record<string, unknown>): ExtraUsageInfo | undefined {
  return parseNormalizedExtraUsage(payload.extraUsage) ?? parseBoosterWallet(payload.boosterWallet);
}

function toTimestamp(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") {
    const normalized = value > 0 && value < 10_000_000_000 ? value * 1000 : value;
    return Number.isFinite(normalized) ? normalized : undefined;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return toTimestamp(numeric);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toSeconds(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
  }
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric);
    return parseDurationToSeconds(value);
  }
  return undefined;
}

function parseDurationToSeconds(value: string): number | undefined {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
  let total = 0;
  let hasMatch = false;
  const regex = /(\d+(?:\.\d+)?)([dhms])/g;
  let match;
  while ((match = regex.exec(normalized)) !== null) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const unit = match[2];
    const multiplier = unit === "d" ? 86400 : unit === "h" ? 3600 : unit === "m" ? 60 : 1;
    total += amount * multiplier;
    hasMatch = true;
  }
  return hasMatch ? Math.floor(total) : undefined;
}

function refreshTimestampFromSeconds(detail: Record<string, unknown> | null, now: number): number | undefined {
  const keys = ["reset_in", "resetIn", "ttl", "window"];
  for (const source of [detail, getRecord(detail?.window)]) {
    if (!source) continue;
    for (const key of keys) {
      const seconds = toSeconds(source[key]);
      if (seconds !== undefined) return now + seconds * 1000;
    }
  }
  return undefined;
}

function refreshTimestampFromResetHint(resetHint: unknown, now: number): number | undefined {
  if (typeof resetHint !== "string" || !resetHint) return undefined;
  const normalized = resetHint.toLowerCase();
  const inMatch = normalized.match(/resets?\s+in\s+(.+)/);
  if (inMatch?.[1]) {
    const seconds = parseDurationToSeconds(inMatch[1]);
    if (seconds !== undefined) return now + seconds * 1000;
  }
  const atMatch = normalized.match(/resets?\s+(?:at\s+)?(.+)/);
  if (atMatch?.[1]) {
    const timestamp = toTimestamp(atMatch[1].trim());
    if (timestamp !== undefined) return timestamp;
  }
  return undefined;
}

function findRefreshTimestamp(detail: Record<string, unknown> | null, fallback: number, now = Date.now()): number {
  const timestampKeys = [
    "refreshAt",
    "resetTime",
    "refreshTime",
    "resetAt",
    "resetsAt",
    "nextRefreshAt",
    "nextResetAt",
    "nextRefreshTime",
    "nextResetTime",
    "next_refresh_time",
    "next_reset_time",
    "reset_time",
    "expireAt",
    "expiresAt",
  ];
  for (const source of [detail, getRecord(detail?.window)]) {
    if (!source) continue;
    for (const key of timestampKeys) {
      const timestamp = toTimestamp(source[key]);
      if (timestamp !== undefined) return timestamp;
    }
  }
  const fromSeconds = refreshTimestampFromSeconds(detail, now);
  if (fromSeconds !== undefined) return fromSeconds;
  return fallback;
}

function windowMsFromWindow(window: Record<string, unknown> | null): number | undefined {
  if (!window) return undefined;
  const duration = toNumber(window.duration);
  const unit = String(window.timeUnit ?? "").toUpperCase();
  if (duration === undefined || duration <= 0) return undefined;
  if (unit.includes("MINUTE")) return duration * 60 * 1000;
  if (unit.includes("HOUR")) return duration * 60 * 60 * 1000;
  if (unit.includes("DAY")) return duration * 24 * 60 * 60 * 1000;
  if (unit.includes("SECOND")) return duration * 1000;
  return undefined;
}

function usagePeriodFromDetail(
  label: string,
  detail: Record<string, unknown> | null,
  fallbackRefreshAt: number,
  now = Date.now(),
  windowMs?: number,
): UsagePeriod {
  if (!detail) return { label, available: false, percent: 0, refreshAt: fallbackRefreshAt, message: "暂无官方数据" };
  const limit = toNumber(detail.limit);
  const remaining = toNumber(detail.remaining);
  let used = toNumber(detail.used);
  if (used === undefined && limit !== undefined && remaining !== undefined) {
    used = Math.max(0, limit - remaining);
  }
  const refreshAt = findRefreshTimestamp(detail, fallbackRefreshAt, now);
  if (limit === undefined || used === undefined || limit <= 0) {
    return { label, available: false, percent: 0, refreshAt, message: "暂无官方数据", windowMs };
  }
  return {
    label,
    used,
    limit,
    percent: Math.max(0, Math.min(100, (used / limit) * 100)),
    available: true,
    refreshAt,
    windowMs,
  };
}

function findWindowLimit(payload: Record<string, unknown>, duration: number, timeUnit: string) {
  const limits = Array.isArray(payload.limits) ? payload.limits : [];
  for (const item of limits) {
    const itemRecord = getRecord(item);
    if (!itemRecord) continue;
    const window = getRecord(itemRecord.window);
    const detail = getRecord(itemRecord.detail) ?? itemRecord;
    const itemDuration = toNumber(window?.duration ?? itemRecord.duration ?? detail.duration);
    const itemUnit = String(window?.timeUnit ?? itemRecord.timeUnit ?? detail.timeUnit ?? "");
    if (itemDuration === duration && itemUnit.includes(timeUnit)) {
      return { detail: { ...detail, window }, windowMs: windowMsFromWindow(window) };
    }
  }
  return null;
}

function nextWeekRefreshAt(now: number) {
  const date = new Date(now);
  const day = date.getDay();
  const daysUntilMonday = day === 0 ? 1 : 8 - day;
  date.setDate(date.getDate() + daysUntilMonday);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function parseKimiUsagePayload(payload: Record<string, unknown>, now = Date.now()): KimiUsageData {
  const fiveHourLimit = findWindowLimit(payload, 300, "MINUTE");
  const fiveHour = usagePeriodFromDetail(
    "5小时",
    fiveHourLimit?.detail ?? null,
    now + 5 * 60 * 60 * 1000,
    now,
    fiveHourLimit?.windowMs,
  );
  const weeklyUsage = getRecord(payload.usage);
  const weeklyWindow = getRecord(weeklyUsage?.window);
  const weekly = usagePeriodFromDetail(
    "本周",
    weeklyUsage,
    nextWeekRefreshAt(now),
    now,
    windowMsFromWindow(weeklyWindow),
  );
  const totalQuota = toNumber(payload.totalQuota);
  const extraUsage = extraUsageFromPayload(payload);
  return {
    available: [fiveHour, weekly].some((period) => period.available) || Boolean(extraUsage),
    updatedAt: now,
    source: "Kimi Code 官方用量接口",
    ...(totalQuota !== undefined ? { totalQuota } : {}),
    ...(extraUsage ? { extraUsage } : {}),
    periods: [fiveHour, weekly],
  };
}

function usagePeriodFromManagedRow(
  label: string,
  row: Record<string, unknown> | null,
  fallbackRefreshAt: number,
  now = Date.now(),
): UsagePeriod {
  if (!row) return { label, available: false, percent: 0, refreshAt: fallbackRefreshAt, message: "暂无官方数据" };
  const limit = toNumber(row.limit);
  const used = toNumber(row.used);
  const fromResetHint = refreshTimestampFromResetHint(row.resetHint, now);
  const refreshAt = fromResetHint ?? findRefreshTimestamp(row, fallbackRefreshAt, now);
  if (limit === undefined || used === undefined || limit <= 0) {
    return { label, available: false, percent: 0, refreshAt, message: "暂无官方数据" };
  }
  return {
    label,
    used,
    limit,
    percent: Math.max(0, Math.min(100, (used / limit) * 100)),
    available: true,
    refreshAt,
    // Managed usage rows don't carry explicit duration+timeUnit. The UI falls
    // back to label-based heuristics (5h / weekly) in getPeriodWindowMs(),
    // which are reliable for the current managed plan types.
  };
}

function findManagedUsageLimit(limits: unknown[], pattern: RegExp) {
  for (const item of limits) {
    const row = getRecord(item);
    if (!row) continue;
    const label = typeof row.label === "string" ? row.label : "";
    if (pattern.test(label)) return row;
  }
  return null;
}

export function parseManagedUsagePayload(payload: unknown, now = Date.now()): KimiUsageData {
  const record = getRecord(payload);
  if (!record) throw new Error("Kimi 用量接口返回格式异常");
  if (record.kind === "error") {
    const message = typeof record.message === "string" ? record.message : "Kimi 用量服务暂时不可用";
    throw new Error(formatKimiUsageError(message));
  }
  if (record.kind !== "ok") throw new Error("Kimi 用量接口返回格式异常");
  const limits = Array.isArray(record.limits) ? record.limits : [];
  const fiveHourRow = findManagedUsageLimit(limits, /(^|\b)(5h|300m|5\s*小时)/i);
  const weeklyRow = getRecord(record.summary) ?? findManagedUsageLimit(limits, /week|weekly|本周|每周|一周/i);
  const fiveHour = usagePeriodFromManagedRow("5小时", fiveHourRow, now + 5 * 60 * 60 * 1000, now);
  const weekly = usagePeriodFromManagedRow("本周", weeklyRow, nextWeekRefreshAt(now), now);
  const extraUsage = extraUsageFromPayload(record);
  return {
    available: [fiveHour, weekly].some((period) => period.available) || Boolean(extraUsage),
    updatedAt: now,
    source: "Kimi Code 官方用量接口",
    ...(extraUsage ? { extraUsage } : {}),
    periods: [fiveHour, weekly],
  };
}

export function stripHtmlForError(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatKimiUsageError(message: string) {
  const cleaned = stripHtmlForError(message);
  if (/HTTP\s+(502|503|504)\b|gateway|time-?out|timed?\s*out/i.test(cleaned)) {
    return "Kimi 官方用量服务暂时不可用，请稍后再试。";
  }
  if (/401|unauthorized|授权|login|token/i.test(cleaned)) {
    return "Kimi 授权失败，请重新登录 Kimi Code。";
  }
  return cleaned || "Kimi 用量服务暂时不可用，请稍后再试。";
}
