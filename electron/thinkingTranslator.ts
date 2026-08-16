import { randomUUID } from "node:crypto";

export const DEFAULT_AZURE_TRANSLATOR_ENDPOINT = "https://api.cognitive.microsofttranslator.com";
export const THINKING_TRANSLATION_TARGET_LANGUAGE = "zh-Hans";
export const THINKING_TRANSLATION_TIMEOUT_MS = 8_000;
export const THINKING_TRANSLATION_MAX_CHARS = 50_000;

export type AzureTranslatorCredential = {
  key: string;
  region?: string;
  endpoint?: string;
};

export type ThinkingTranslationErrorCode =
  | "invalid_request"
  | "authentication_failed"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "provider_error"
  | "invalid_response";

export class ThinkingTranslationError extends Error {
  readonly code: ThinkingTranslationErrorCode;
  readonly retryAfterMs?: number;
  readonly status?: number;

  constructor(
    code: ThinkingTranslationErrorCode,
    message: string,
    options: { retryAfterMs?: number; status?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ThinkingTranslationError";
    this.code = code;
    this.retryAfterMs = options.retryAfterMs;
    this.status = options.status;
  }
}

type FetchLike = typeof fetch;

export function normalizeAzureTranslatorEndpoint(value?: string): string {
  const raw = value?.trim() || DEFAULT_AZURE_TRANSLATOR_ENDPOINT;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ThinkingTranslationError("invalid_request", "Azure Translator Endpoint 格式无效。");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new ThinkingTranslationError("invalid_request", "Azure Translator Endpoint 必须是不含凭据、查询参数和片段的 HTTPS 地址。");
  }
  const hostname = url.hostname.toLowerCase();
  const allowedHost = hostname === "api.cognitive.microsofttranslator.com"
    || hostname === "api.cognitive.microsofttranslator.com.cn"
    || hostname.endsWith(".cognitiveservices.azure.com")
    || hostname.endsWith(".cognitiveservices.azure.cn")
    || hostname.endsWith(".cognitiveservices.azure.us")
    || hostname.endsWith(".cognitiveservices.usgovcloudapi.net");
  if (!allowedHost || (url.pathname !== "/" && url.pathname !== "")) {
    throw new ThinkingTranslationError("invalid_request", "Azure Translator Endpoint 必须是 Microsoft 官方 Translator 或 Cognitive Services 根地址。");
  }
  return url.toString().replace(/\/$/, "");
}

function parseRetryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function providerMessage(status: number): string {
  if (status === 401 || status === 403) return "Azure Translator 拒绝了凭据，请检查订阅密钥与区域。";
  if (status === 429) return "Azure Translator 请求过于频繁，请稍后重试。";
  return `Azure Translator 请求失败（HTTP ${status}）。`;
}

export async function translateThinkingWithAzure(
  text: string,
  credential: AzureTranslatorCredential,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<{ translatedText: string; detectedLanguage?: string }> {
  if (!text.trim()) throw new ThinkingTranslationError("invalid_request", "待翻译文本不能为空。");
  if (text.length > THINKING_TRANSLATION_MAX_CHARS) {
    throw new ThinkingTranslationError("invalid_request", `单次翻译不能超过 ${THINKING_TRANSLATION_MAX_CHARS} 个字符。`);
  }
  const key = credential.key.trim();
  if (!key) throw new ThinkingTranslationError("invalid_request", "Azure Translator 订阅密钥不能为空。");

  const endpoint = normalizeAzureTranslatorEndpoint(credential.endpoint);
  const url = new URL(`${endpoint}/translate`);
  url.searchParams.set("api-version", "3.0");
  url.searchParams.set("to", THINKING_TRANSLATION_TARGET_LANGUAGE);

  const controller = new AbortController();
  const timeoutMs = Math.max(1, options.timeoutMs ?? THINKING_TRANSLATION_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=UTF-8",
      "Ocp-Apim-Subscription-Key": key,
      "X-ClientTraceId": randomUUID(),
    };
    const region = credential.region?.trim();
    if (region) headers["Ocp-Apim-Subscription-Region"] = region;
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers,
      body: JSON.stringify([{ Text: text }]),
      signal: controller.signal,
    });
    if (!response.ok) {
      const code: ThinkingTranslationErrorCode = response.status === 401 || response.status === 403
        ? "authentication_failed"
        : response.status === 429
          ? "rate_limited"
          : "provider_error";
      throw new ThinkingTranslationError(code, providerMessage(response.status), {
        status: response.status,
        retryAfterMs: response.status === 429 ? parseRetryAfterMs(response) : undefined,
      });
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new ThinkingTranslationError("invalid_response", "Azure Translator 返回了无法解析的数据。", { cause });
    }
    const first = Array.isArray(payload) ? payload[0] : undefined;
    const record = first && typeof first === "object" ? first as Record<string, unknown> : undefined;
    const translations = Array.isArray(record?.translations) ? record.translations : [];
    const translation = translations[0] && typeof translations[0] === "object"
      ? translations[0] as Record<string, unknown>
      : undefined;
    const translatedText = typeof translation?.text === "string" ? translation.text : "";
    if (!translatedText) {
      throw new ThinkingTranslationError("invalid_response", "Azure Translator 返回中缺少译文。");
    }
    const detected = record?.detectedLanguage && typeof record.detectedLanguage === "object"
      ? record.detectedLanguage as Record<string, unknown>
      : undefined;
    return {
      translatedText,
      detectedLanguage: typeof detected?.language === "string" ? detected.language : undefined,
    };
  } catch (error) {
    if (error instanceof ThinkingTranslationError) throw error;
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new ThinkingTranslationError("timeout", `Azure Translator 请求超过 ${timeoutMs} 毫秒。`, { cause: error });
    }
    throw new ThinkingTranslationError("network_error", "无法连接 Azure Translator。", { cause: error });
  } finally {
    clearTimeout(timer);
  }
}
