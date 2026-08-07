import { describe, expect, it } from "vitest";
import {
  deriveSessionLastActiveAt,
  evaluateCacheHint,
  formatIdleDuration,
  lookupCacheHintRule,
  modelLookupCandidates,
  parseCacheHintConfig,
  recordSessionLastActiveAt,
  getSessionLastActiveAt,
  type CacheHintRule,
} from "../cacheHint";

const K3_RULE: CacheHintRule = { cache_duration: 600, min_tokens_to_hint: 200_000 };
const CODING_RULE: CacheHintRule = { cache_duration: 3_600, min_tokens_to_hint: 200_000 };

const CONFIG: Record<string, CacheHintRule> = {
  "k3": K3_RULE,
  "k3-256k": K3_RULE,
  "kimi-for-coding": CODING_RULE,
  "kimi-for-coding-highspeed": CODING_RULE,
};

const NOW = 1_800_000_000_000;

function hitInput(overrides: Record<string, unknown> = {}) {
  return {
    config: CONFIG,
    modelId: "kimi-code/k3",
    lastActiveAt: NOW - 700 * 1000, // 闲置 700s > 600s
    totalTokens: 210_000,
    now: NOW,
    ...overrides,
  };
}

describe("parseCacheHintConfig", () => {
  it("解析合法响应", () => {
    const parsed = parseCacheHintConfig({
      name: "estimated_cache_duration",
      config: { version: 1, config: { k3: { cache_duration: 600, min_tokens_to_hint: 200_000 } } },
    });
    expect(parsed).toEqual({
      version: 1,
      config: { k3: { cache_duration: 600, min_tokens_to_hint: 200_000 } },
    });
  });

  it("解析失败返回 null（结构不符）", () => {
    expect(parseCacheHintConfig(null)).toBeNull();
    expect(parseCacheHintConfig("junk")).toBeNull();
    expect(parseCacheHintConfig({ config: {} })).toBeNull();
    expect(parseCacheHintConfig({ config: { config: { k3: { cache_duration: "x" } } } })).toBeNull();
  });

  it("宽容未知字段与缺失 version", () => {
    const parsed = parseCacheHintConfig({
      name: "estimated_cache_duration",
      extra: { future: true },
      config: { version: 1, config: { k3: { cache_duration: 600, min_tokens_to_hint: 200_000 } }, extraField: 1 },
    });
    expect(parsed?.config.k3).toEqual(K3_RULE);
    expect(parsed?.version).toBe(1);
  });

  it("空规则表合法（无模型可命中）", () => {
    const parsed = parseCacheHintConfig({ name: "estimated_cache_duration", config: { version: 1, config: {} } });
    expect(parsed?.config).toEqual({});
  });
});

describe("modelLookupCandidates / lookupCacheHintRule", () => {
  it("完整 id 与去前缀短名均可命中", () => {
    expect(modelLookupCandidates("kimi-code/k3")).toEqual(["kimi-code/k3", "k3"]);
    expect(lookupCacheHintRule(CONFIG, "kimi-code/k3")).toBe(K3_RULE);
    expect(lookupCacheHintRule(CONFIG, "k3-256k")).toBe(K3_RULE);
    expect(lookupCacheHintRule(CONFIG, "kimi-code/kimi-for-coding-highspeed")).toBe(CODING_RULE);
  });

  it("无规则的模型返回 undefined", () => {
    expect(lookupCacheHintRule(CONFIG, "deepseek-v4")).toBeUndefined();
    expect(lookupCacheHintRule(CONFIG, "")).toBeUndefined();
  });
});

describe("evaluateCacheHint", () => {
  it("全部满足时提示", () => {
    const verdict = evaluateCacheHint(hitInput());
    expect(verdict.shouldHint).toBe(true);
    if (verdict.shouldHint) {
      expect(verdict.modelId).toBe("kimi-code/k3");
      expect(verdict.rule).toBe(K3_RULE);
      expect(verdict.idleSeconds).toBe(700);
      expect(verdict.totalTokens).toBe(210_000);
    }
  });

  it("config 缺失 → skip", () => {
    expect(evaluateCacheHint(hitInput({ config: undefined }))).toEqual({ shouldHint: false, reason: "no-config" });
    expect(evaluateCacheHint(hitInput({ config: null }))).toEqual({ shouldHint: false, reason: "no-config" });
  });

  it("modelId 缺失 → skip", () => {
    expect(evaluateCacheHint(hitInput({ modelId: undefined }))).toEqual({ shouldHint: false, reason: "no-model" });
    expect(evaluateCacheHint(hitInput({ modelId: "  " }))).toEqual({ shouldHint: false, reason: "no-model" });
  });

  it("lastActiveAt 缺失/非法 → skip", () => {
    expect(evaluateCacheHint(hitInput({ lastActiveAt: undefined }))).toEqual({ shouldHint: false, reason: "no-activity" });
    expect(evaluateCacheHint(hitInput({ lastActiveAt: 0 }))).toEqual({ shouldHint: false, reason: "no-activity" });
    expect(evaluateCacheHint(hitInput({ lastActiveAt: Number.NaN }))).toEqual({ shouldHint: false, reason: "no-activity" });
  });

  it("totalTokens 缺失/非法 → skip", () => {
    expect(evaluateCacheHint(hitInput({ totalTokens: undefined }))).toEqual({ shouldHint: false, reason: "no-tokens" });
    expect(evaluateCacheHint(hitInput({ totalTokens: Number.NaN }))).toEqual({ shouldHint: false, reason: "no-tokens" });
    expect(evaluateCacheHint(hitInput({ totalTokens: -1 }))).toEqual({ shouldHint: false, reason: "no-tokens" });
  });

  it("模型无规则 → skip（天然过滤非 OAuth 模型）", () => {
    expect(evaluateCacheHint(hitInput({ modelId: "openai/gpt-5" }))).toEqual({ shouldHint: false, reason: "no-rule" });
  });

  it("闲置未超缓存时长 → skip", () => {
    expect(evaluateCacheHint(hitInput({ lastActiveAt: NOW - 599 * 1000 }))).toEqual({ shouldHint: false, reason: "not-idle" });
    // 恰好等于缓存时长 → 触发
    expect(evaluateCacheHint(hitInput({ lastActiveAt: NOW - 600 * 1000 })).shouldHint).toBe(true);
  });

  it("上下文未达提示阈值 → skip", () => {
    expect(evaluateCacheHint(hitInput({ totalTokens: 199_999 }))).toEqual({ shouldHint: false, reason: "below-threshold" });
    expect(evaluateCacheHint(hitInput({ totalTokens: 200_000 })).shouldHint).toBe(true);
  });

  it("时钟早于活动时间时闲置按 0 处理（不误报）", () => {
    expect(evaluateCacheHint(hitInput({ now: NOW - 800 * 1000 }))).toEqual({ shouldHint: false, reason: "not-idle" });
  });
});

describe("formatIdleDuration", () => {
  it("秒/分钟/小时格式", () => {
    expect(formatIdleDuration(30)).toBe("30 秒");
    expect(formatIdleDuration(90)).toBe("1 分钟");
    expect(formatIdleDuration(600)).toBe("10 分钟");
    expect(formatIdleDuration(3600)).toBe("1 小时");
    expect(formatIdleDuration(3900)).toBe("1 小时 5 分钟");
    expect(formatIdleDuration(-5)).toBe("0 秒");
  });
});

describe("deriveSessionLastActiveAt", () => {
  it("取 user/assistant/status 事件的最大时间戳", () => {
    const events = [
      { type: "user_message", timestamp: 100 },
      { type: "assistant_message", timestamp: 200, isComplete: true },
      { type: "status_update", timestamp: 300 },
      { type: "tool_call", timestamp: 999 }, // 不算活动信号
    ];
    expect(deriveSessionLastActiveAt(events)).toBe(300);
  });

  it("空时间线或无活动事件返回 undefined", () => {
    expect(deriveSessionLastActiveAt([])).toBeUndefined();
    expect(deriveSessionLastActiveAt([{ type: "tool_call", timestamp: 5 }])).toBeUndefined();
  });

  it("忽略非法时间戳", () => {
    expect(deriveSessionLastActiveAt([{ type: "user_message", timestamp: "x" }, { type: "user_message", timestamp: 7 }])).toBe(7);
  });
});

describe("recordSessionLastActiveAt / getSessionLastActiveAt", () => {
  it("记录并按最大值收敛", () => {
    recordSessionLastActiveAt("session-1", 100);
    expect(getSessionLastActiveAt("session-1")).toBe(100);
    recordSessionLastActiveAt("session-1", 50);
    expect(getSessionLastActiveAt("session-1")).toBe(100);
    recordSessionLastActiveAt("session-1", 150);
    expect(getSessionLastActiveAt("session-1")).toBe(150);
  });

  it("非法时间戳被忽略；不同会话互不影响", () => {
    recordSessionLastActiveAt("session-bad", Number.NaN);
    expect(getSessionLastActiveAt("session-bad")).toBeUndefined();
    expect(getSessionLastActiveAt("session-other")).toBeUndefined();
  });
});
