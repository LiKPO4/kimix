import { describe, expect, it } from "vitest";
import { buildChatCompletionsUrls, probeThinkingEfforts, resolveCatalogThinkingEfforts } from "../providerEffortProbe";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("buildChatCompletionsUrls", () => {
  it("已带 /v1 的 base_url 直接补 /chat/completions", () => {
    expect(buildChatCompletionsUrls("https://api.deepseek.com/v1")).toEqual([
      "https://api.deepseek.com/v1/chat/completions",
    ]);
  });

  it("不带版本段的 base_url 同时给出 /v1 候选", () => {
    const urls = buildChatCompletionsUrls("https://example.com");
    expect(urls).toContain("https://example.com/chat/completions");
    expect(urls).toContain("https://example.com/v1/chat/completions");
  });

  it("已是 chat/completions 结尾不重复追加", () => {
    expect(buildChatCompletionsUrls("https://example.com/v1/chat/completions")).toEqual([
      "https://example.com/v1/chat/completions",
    ]);
  });

  it("拒绝非 http(s) 协议", () => {
    expect(() => buildChatCompletionsUrls("ftp://example.com")).toThrow();
  });
});

describe("probeThinkingEfforts", () => {
  it("基线成功后逐档探测，200 记支持、effort 相关 400 记不支持", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchMock = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push(body);
      const effort = body.reasoning_effort as string | undefined;
      if (effort === undefined) return jsonResponse(200, { id: "cmpl-1" });
      if (!(["minimal", "low", "medium", "high", "xhigh", "max"] as string[]).includes(effort)) {
        return jsonResponse(400, { error: { message: "unsupported reasoning_effort" } });
      }
      if (effort === "max") {
        return jsonResponse(400, { error: { message: "'reasoning_effort' must be one of: 'none', 'minimal', 'low', 'medium', 'high', 'xhigh'" } });
      }
      return jsonResponse(200, { id: "cmpl-2" });
    }) as typeof fetch;

    const result = await probeThinkingEfforts(
      { baseUrl: "https://api.deepseek.com/v1", apiKey: "k", model: "deepseek-chat" },
      fetchMock,
    );
    expect(result.supported).toEqual(["minimal", "low", "medium", "high", "xhigh"]);
    expect(result.supported).not.toContain("max");
    // 基线 1 次 + 无效值对照 1 次 + 6 个候选 = 8 次请求
    expect(calls).toHaveLength(8);
  });

  it("凭证被拒绝时整体失败", async () => {
    const fetchMock = (async () => jsonResponse(401, { error: { message: "bad key" } })) as typeof fetch;
    await expect(probeThinkingEfforts(
      { baseUrl: "https://api.deepseek.com/v1", apiKey: "bad", model: "m" },
      fetchMock,
    )).rejects.toThrow();
  });

  it("全部档位被拒时返回空列表", async () => {
    const fetchMock = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.reasoning_effort === undefined) return jsonResponse(200, { id: "ok" });
      return jsonResponse(400, { error: { message: "unsupported reasoning_effort" } });
    }) as typeof fetch;
    const result = await probeThinkingEfforts(
      { baseUrl: "https://api.deepseek.com/v1", apiKey: "k", model: "m" },
      fetchMock,
    );
    expect(result.supported).toEqual([]);
  });

  it("供应商静默忽略 reasoning_effort 时不误报全档位支持", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchMock = (async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse(200, { id: "ok" });
    }) as typeof fetch;

    await expect(probeThinkingEfforts(
      { baseUrl: "https://example.com/v1", apiKey: "k", model: "m" },
      fetchMock,
    )).rejects.toThrow("无效 reasoning_effort 也返回成功");
    expect(calls).toHaveLength(2);
  });

  it("兼容使用 422 拒绝无效档位的供应商", async () => {
    const fetchMock = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body.reasoning_effort === undefined) return jsonResponse(200, { id: "ok" });
      if (body.reasoning_effort === "high") return jsonResponse(200, { id: "ok" });
      return jsonResponse(422, { error: { message: "invalid reasoning_effort" } });
    }) as typeof fetch;
    const result = await probeThinkingEfforts(
      { baseUrl: "https://example.com/v1", apiKey: "k", model: "m" },
      fetchMock,
    );
    expect(result.supported).toEqual(["high"]);
  });
});

describe("resolveCatalogThinkingEfforts", () => {
  const providers = [
    {
      providerId: "opencode-go",
      baseUrl: "https://opencode.ai/zen/go/v1",
      models: [{ id: "hy3", supportEfforts: ["off", "low", "high"] }],
    },
    {
      providerId: "tencent-tokenhub",
      baseUrl: "https://tokenhub.example/v1",
      models: [{ id: "hy3", supportEfforts: ["low", "medium", "high"] }],
    },
  ];

  it("按 provider id 返回 opencode-go/hy3 的模型级声明", () => {
    expect(resolveCatalogThinkingEfforts({
      providerName: "opencode-go",
      baseUrl: "https://proxy.example/v1",
      modelId: "hy3",
      providers,
    })).toEqual({ status: "resolved", providerId: "opencode-go", supportEfforts: ["off", "low", "high"] });
  });

  it("自定义 provider 名按唯一 Base URL 匹配", () => {
    expect(resolveCatalogThinkingEfforts({
      providerName: "custom-opencode",
      baseUrl: "https://opencode.ai/zen/go/v1/",
      modelId: "hy3",
      providers,
    })).toEqual({ status: "resolved", providerId: "opencode-go", supportEfforts: ["off", "low", "high"] });
  });

  it("无法确定 provider 身份时不用全局同名模型猜测", () => {
    expect(resolveCatalogThinkingEfforts({
      providerName: "custom",
      baseUrl: "https://unknown.example/v1",
      modelId: "hy3",
      providers,
    })).toEqual({ status: "not-found" });
  });

  it("Base URL 同时命中多个 provider 时返回 ambiguous", () => {
    expect(resolveCatalogThinkingEfforts({
      providerName: "custom",
      baseUrl: "https://opencode.ai/zen/go/v1",
      modelId: "hy3",
      providers: [...providers, { ...providers[0], providerId: "duplicate" }],
    })).toEqual({ status: "ambiguous" });
  });

  it("目录模型未声明档位时返回 undeclared", () => {
    expect(resolveCatalogThinkingEfforts({
      providerName: "opencode-go",
      modelId: "hy3",
      providers: [{ ...providers[0], models: [{ id: "hy3" }] }],
    })).toEqual({ status: "undeclared" });
  });
});
