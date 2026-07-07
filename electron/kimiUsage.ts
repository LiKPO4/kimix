import type { KimiUsageResponse, UsagePeriod } from "./types/ipc";

type KimiUsageData = Extract<KimiUsageResponse, { success: true }>["data"];

export function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
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

function findRefreshTimestamp(detail: Record<string, unknown> | null, fallback: number): number {
  const keys = [
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
    for (const key of keys) {
      const timestamp = toTimestamp(source[key]);
      if (timestamp !== undefined) return timestamp;
    }
  }
  return fallback;
}

function usagePeriodFromDetail(label: string, detail: Record<string, unknown> | null, fallbackRefreshAt: number): UsagePeriod {
  if (!detail) return { label, available: false, percent: 0, refreshAt: fallbackRefreshAt, message: "暂无官方数据" };
  const limit = toNumber(detail.limit);
  const remaining = toNumber(detail.remaining);
  let used = toNumber(detail.used);
  if (used === undefined && limit !== undefined && remaining !== undefined) {
    used = Math.max(0, limit - remaining);
  }
  const refreshAt = findRefreshTimestamp(detail, fallbackRefreshAt);
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
      return { ...detail, window };
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
  const fiveHour = usagePeriodFromDetail("5小时", findWindowLimit(payload, 300, "MINUTE"), now + 5 * 60 * 60 * 1000);
  const weekly = usagePeriodFromDetail("本周", getRecord(payload.usage), nextWeekRefreshAt(now));
  const totalQuota = toNumber(payload.totalQuota);
  return {
    available: [fiveHour, weekly].some((period) => period.available),
    updatedAt: now,
    source: "Kimi Code 官方用量接口",
    ...(totalQuota !== undefined ? { totalQuota } : {}),
    periods: [fiveHour, weekly],
  };
}

function usagePeriodFromManagedRow(label: string, row: Record<string, unknown> | null, fallbackRefreshAt: number): UsagePeriod {
  if (!row) return { label, available: false, percent: 0, refreshAt: fallbackRefreshAt, message: "暂无官方数据" };
  const limit = toNumber(row.limit);
  const used = toNumber(row.used);
  const refreshAt = findRefreshTimestamp(row, fallbackRefreshAt);
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
  const fiveHour = usagePeriodFromManagedRow("5小时", fiveHourRow, now + 5 * 60 * 60 * 1000);
  const weekly = usagePeriodFromManagedRow("本周", weeklyRow, nextWeekRefreshAt(now));
  return {
    available: [fiveHour, weekly].some((period) => period.available),
    updatedAt: now,
    source: "Kimi Code 官方用量接口",
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
