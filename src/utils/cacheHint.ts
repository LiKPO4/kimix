import { z } from "zod";
import type { ComposerDraftAttachment } from "@/utils/composerDraft";

/**
 * 上下文缓存过期提醒（上游 kimi-code 0.34.0 #2646 的 Kimix 版）。
 *
 * 服务端 client_configs 下发各模型的缓存时长（cache_duration）与提示阈值
 * （min_tokens_to_hint）。本模块只负责纯函数判定与渲染层的小型状态（实时
 * 活动时间、不再询问、配置预热），网络请求与缓存全在主进程。
 */

// ---------- 配置解析 ----------

export const CacheHintRuleSchema = z.object({
  cache_duration: z.number().int().positive(),
  min_tokens_to_hint: z.number().int().nonnegative(),
});
export type CacheHintRule = z.infer<typeof CacheHintRuleSchema>;

export const CacheHintConfigSchema = z.object({
  config: z.object({
    version: z.number().optional(),
    config: z.record(z.string(), CacheHintRuleSchema),
  }).passthrough(),
}).passthrough();

export interface CacheHintConfig {
  version?: number;
  config: Record<string, CacheHintRule>;
}

/** 宽容解析 client_configs 响应；结构不符返回 null（调用方按无配置静默降级）。 */
export function parseCacheHintConfig(value: unknown): CacheHintConfig | null {
  const parsed = CacheHintConfigSchema.safeParse(value);
  if (!parsed.success) return null;
  return {
    version: parsed.data.config.version,
    config: parsed.data.config.config,
  };
}

// ---------- 模型规则查找 ----------

/** 模型名查找候选：完整 id 优先，其次去掉 provider 前缀后的短名（如 kimi-code/k3 → k3）。 */
export function modelLookupCandidates(modelId: string): string[] {
  const trimmed = modelId.trim();
  const candidates = [trimmed];
  const slashIndex = trimmed.lastIndexOf("/");
  if (slashIndex >= 0 && slashIndex < trimmed.length - 1) {
    candidates.push(trimmed.slice(slashIndex + 1));
  }
  return [...new Set(candidates)];
}

export function lookupCacheHintRule(
  config: Record<string, CacheHintRule>,
  modelId: string,
): CacheHintRule | undefined {
  for (const candidate of modelLookupCandidates(modelId)) {
    const rule = config[candidate];
    if (rule) return rule;
  }
  return undefined;
}

// ---------- 触发判定（纯函数） ----------

export type CacheHintSkipReason =
  | "no-config"
  | "no-model"
  | "no-activity"
  | "no-tokens"
  | "no-rule"
  | "not-idle"
  | "below-threshold";

export type CacheHintVerdict =
  | { shouldHint: true; modelId: string; rule: CacheHintRule; idleSeconds: number; totalTokens: number }
  | { shouldHint: false; reason: CacheHintSkipReason };

export interface CacheHintInput {
  /** 服务端下发的模型规则表；null/undefined 表示未拿到配置。 */
  config: Record<string, CacheHintRule> | null | undefined;
  /** 会话当前模型 id（如 kimi-code/k3、k3-256k、kimi-for-coding）。 */
  modelId: string | undefined;
  /** 最后 LLM 轮次完成时间（ms 时间戳）。 */
  lastActiveAt: number | undefined;
  /** 当前上下文 token 数（context_tokens）。 */
  totalTokens: number | undefined;
  /** 判定时钟（测试注入）。 */
  now?: number;
}

/**
 * 缓存过期提示判定。任一输入缺失、模型无规则、闲置未超缓存时长或
 * 上下文未达提示阈值都跳过；全部满足才提示。
 */
export function evaluateCacheHint(input: CacheHintInput): CacheHintVerdict {
  const now = input.now ?? Date.now();
  if (!input.config) return { shouldHint: false, reason: "no-config" };
  if (!input.modelId || !input.modelId.trim()) return { shouldHint: false, reason: "no-model" };
  if (!input.lastActiveAt || !Number.isFinite(input.lastActiveAt) || input.lastActiveAt <= 0) {
    return { shouldHint: false, reason: "no-activity" };
  }
  if (input.totalTokens === undefined || !Number.isFinite(input.totalTokens) || input.totalTokens < 0) {
    return { shouldHint: false, reason: "no-tokens" };
  }
  const rule = lookupCacheHintRule(input.config, input.modelId);
  if (!rule) return { shouldHint: false, reason: "no-rule" };
  const idleSeconds = Math.max(0, Math.floor((now - input.lastActiveAt) / 1000));
  if (idleSeconds < rule.cache_duration) return { shouldHint: false, reason: "not-idle" };
  if (input.totalTokens < rule.min_tokens_to_hint) return { shouldHint: false, reason: "below-threshold" };
  return {
    shouldHint: true,
    modelId: input.modelId,
    rule,
    idleSeconds,
    totalTokens: input.totalTokens,
  };
}

// ---------- 展示格式化 ----------

export function formatIdleDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes > 0 ? `${hours} 小时 ${restMinutes} 分钟` : `${hours} 小时`;
}

// ---------- 会话活动时间（渲染层状态） ----------

/** 从会话时间线推导「最后 LLM 轮次」近似时间（应用重启后主进程无实时记录的兜底）。 */
export function deriveSessionLastActiveAt(
  events: readonly { type: string; timestamp?: unknown }[],
): number | undefined {
  let latest: number | undefined;
  for (const event of events) {
    if (event.type !== "user_message" && event.type !== "assistant_message" && event.type !== "status_update") {
      continue;
    }
    if (typeof event.timestamp !== "number" || !Number.isFinite(event.timestamp)) continue;
    if (latest === undefined || event.timestamp > latest) latest = event.timestamp;
  }
  return latest;
}

const lastActiveAtBySession = new Map<string, number>();

/** 主进程 kimix.turn.activity 事件 → 按会话记录（取最大值防乱序）。 */
export function recordSessionLastActiveAt(uiSessionId: string, at: number): void {
  if (!Number.isFinite(at) || at <= 0) return;
  const previous = lastActiveAtBySession.get(uiSessionId);
  if (previous === undefined || at > previous) lastActiveAtBySession.set(uiSessionId, at);
}

export function getSessionLastActiveAt(uiSessionId: string): number | undefined {
  return lastActiveAtBySession.get(uiSessionId);
}

export function resetSessionLastActiveAt(uiSessionId: string): void {
  lastActiveAtBySession.delete(uiSessionId);
}

// ---------- 「不再询问」与配置预热（渲染层小状态，持久化走设置管线） ----------

let cacheHintDismissed: boolean | null = null;

export async function isCacheHintDismissed(): Promise<boolean> {
  if (cacheHintDismissed === null) {
    try {
      const res = await window.api.getSettings();
      cacheHintDismissed = res.success ? res.data.cacheHintDismissed === true : false;
    } catch {
      cacheHintDismissed = false;
    }
  }
  return cacheHintDismissed;
}

export async function setCacheHintDismissed(value: boolean): Promise<void> {
  cacheHintDismissed = value;
  try {
    await window.api.saveSettings({ cacheHintDismissed: value });
  } catch {
    // 持久化失败不阻塞发送：本轮会话内仍记住选择
  }
}

let cacheHintWarmPromise: Promise<void> | null = null;

/** 应用启动时后台预热配置，命中主进程缓存后发送前检查几乎无延迟。 */
export function warmCacheHintConfig(): void {
  if (!cacheHintWarmPromise) {
    cacheHintWarmPromise = window.api.getKimiCodeCacheHintConfig()
      .then(() => undefined)
      .catch(() => undefined);
  }
}

// ---------- 对话框数据 ----------

export type CacheHintDialogAction = "compact" | "new-session" | "continue" | "dismiss";

export interface CacheHintDialogData {
  /** 待发送的原文（压缩/新会话成功后重发用）。 */
  content: string;
  images: ComposerDraftAttachment[];
  /** UI 会话 id（当前会话）。 */
  sessionId: string;
  /** 运行时会话 id（压缩调用用）。 */
  runtimeSessionId: string;
  modelId: string;
  idleSeconds: number;
  cacheDurationSeconds: number;
  totalTokens: number;
  minTokensToHint: number;
}
