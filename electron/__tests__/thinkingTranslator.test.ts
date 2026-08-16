import { describe, expect, it, vi } from "vitest";
import { translateThinkingWithAzure } from "../thinkingTranslator";

describe("Azure 思考翻译", () => {
  it("使用自动源语言和简体中文目标语言，并解析检测语言", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => new Response(JSON.stringify([{
      detectedLanguage: { language: "en", score: 1 },
      translations: [{ text: "你好", to: "zh-Hans" }],
    }]), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(translateThinkingWithAzure("Hello", {
      key: "secret-key",
      region: "eastasia",
    }, { fetchImpl })).resolves.toEqual({ translatedText: "你好", detectedLanguage: "en" });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain("api-version=3.0");
    expect(String(url)).toContain("to=zh-Hans");
    expect(String(url)).not.toContain("from=");
    expect(init?.headers).toMatchObject({
      "Ocp-Apim-Subscription-Key": "secret-key",
      "Ocp-Apim-Subscription-Region": "eastasia",
    });
    expect(init?.body).toBe(JSON.stringify([{ Text: "Hello" }]));
  });

  it("把凭据错误映射为结构化错误，且不泄露密钥", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => new Response("denied", { status: 401 }));
    const promise = translateThinkingWithAzure("Hello", { key: "never-show-this" }, { fetchImpl });
    await expect(promise).rejects.toMatchObject({
      code: "authentication_failed",
      status: 401,
    });
    await expect(promise).rejects.not.toThrow(/never-show-this/);
  });

  it("保留限流等待时间", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => new Response("busy", {
      status: 429,
      headers: { "retry-after": "3" },
    }));
    await expect(translateThinkingWithAzure("Hello", { key: "key" }, { fetchImpl }))
      .rejects.toMatchObject({ code: "rate_limited", retryAfterMs: 3_000 });
  });

  it("拒绝非 HTTPS Endpoint 和超长文本", async () => {
    await expect(translateThinkingWithAzure("Hello", { key: "key", endpoint: "http://localhost" }))
      .rejects.toMatchObject({ code: "invalid_request" });
    await expect(translateThinkingWithAzure("Hello", { key: "key", endpoint: "https://example.com" }))
      .rejects.toMatchObject({ code: "invalid_request" });
    await expect(translateThinkingWithAzure("x".repeat(50_001), { key: "key" }))
      .rejects.toMatchObject({ code: "invalid_request" });
  });

  it("超时后返回 timeout", async () => {
    const fetchImpl = vi.fn((_url: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    await expect(translateThinkingWithAzure("Hello", { key: "key" }, { fetchImpl, timeoutMs: 5 }))
      .rejects.toMatchObject({ code: "timeout" });
  });
});
