import { describe, expect, it } from "vitest";
import { buildModelMetadataAiQuestion, matchCatalogModel, matchCatalogProvider, prefillFromCatalog } from "../modelProviderConfig";

const catalog = [
  { id: "qwen3.8-max", maxContextSize: 1_000_000, supportEfforts: ["low", "high"] },
  { id: "gpt-5.1", maxContextSize: 400_000, supportEfforts: [] },
  { id: "Unknown-Case-Model", maxContextSize: 128_000 },
];

describe("buildModelMetadataAiQuestion", () => {
  it("includes the provider, Base URL and model identity without inviting guesses", () => {
    const question = buildModelMetadataAiQuestion({
      providerName: "opencode-go",
      baseUrl: "https://opencode.ai/zen/go/v1?api_key=secret#private",
      modelId: "mimo-v2.5",
      modelAlias: "opencode-go/mimo-v2.5",
      missingFields: ["efforts"],
      matchResult: "models.dev 已返回 Context 1000000，但未声明档位",
      currentContextSize: "262144",
      currentSupportEfforts: ["high"],
      currentDefaultEffort: "high",
    });
    expect(question).toContain("供应商：opencode-go");
    expect(question).toContain("Base URL：https://opencode.ai/zen/go/v1");
    expect(question).not.toContain("secret");
    expect(question).not.toContain("private");
    expect(question).toContain("模型名称/ID：mimo-v2.5");
    expect(question).toContain("Kimix 模型别名：opencode-go/mimo-v2.5");
    expect(question).toContain("reasoning_effort");
    expect(question).toContain("Kimix 目录匹配结果：models.dev 已返回 Context 1000000，但未声明档位");
    expect(question).toContain("当前 Context：262144");
    expect(question).toContain("当前思考档位：high");
    expect(question).not.toContain("最大上下文窗口是多少");
    expect(question).toContain("无法可靠确认的字段请明确写“未知”");
  });
});

describe("matchCatalogProvider", () => {
  const providers = [
    { providerId: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", models: [{ id: "hy3", supportEfforts: ["off", "low", "high"] }] },
    { providerId: "tencent-tokenhub", baseUrl: "https://api.example.com/v1/", models: [{ id: "hy3", supportEfforts: ["low", "medium", "high"] }] },
  ];

  it("优先按 provider id 隔离同名模型", () => {
    expect(matchCatalogProvider(providers, "opencode-go")?.models[0].supportEfforts).toEqual(["off", "low", "high"]);
  });

  it("自定义 provider 名可按唯一 Base URL 匹配并忽略尾斜杠", () => {
    expect(matchCatalogProvider(providers, "custom-alias", "https://opencode.ai/zen/go/v1/")?.providerId).toBe("opencode-go");
  });

  it("Base URL 不唯一或不匹配时不猜测", () => {
    const duplicate = [...providers, { ...providers[0], providerId: "duplicate" }];
    expect(matchCatalogProvider(duplicate, "custom", "https://opencode.ai/zen/go/v1")).toBeUndefined();
    expect(matchCatalogProvider(providers, "custom", "https://unknown.example/v1")).toBeUndefined();
  });
});

describe("matchCatalogModel", () => {
  it("matches exactly with case-insensitive ids", () => {
    expect(matchCatalogModel(catalog, "qwen3.8-max")?.id).toBe("qwen3.8-max");
    expect(matchCatalogModel(catalog, "QWEN3.8-MAX")?.id).toBe("qwen3.8-max");
    expect(matchCatalogModel(catalog, " unknown-case-model ")).toBeDefined();
  });

  it("returns undefined when nothing matches (no fuzzy matching)", () => {
    expect(matchCatalogModel(catalog, "qwen3.8-max-v2")).toBeUndefined();
    expect(matchCatalogModel(catalog, "qwen3")).toBeUndefined();
    expect(matchCatalogModel(catalog, "max")).toBeUndefined();
  });

  it("returns undefined for empty or blank model ids", () => {
    expect(matchCatalogModel(catalog, "")).toBeUndefined();
    expect(matchCatalogModel(catalog, "   ")).toBeUndefined();
  });

  it("falls back to bare-id match after stripping the provider prefix", () => {
    const prefixed = [
      { id: "openai/gpt-5.1", maxContextSize: 400_000, supportEfforts: ["high"] },
      { id: "anthropic/claude-sonnet-4-6", maxContextSize: 200_000, supportEfforts: ["max"] },
    ];
    expect(matchCatalogModel(prefixed, "gpt-5.1")?.id).toBe("openai/gpt-5.1");
    expect(matchCatalogModel(prefixed, "claude-sonnet-4-6")?.id).toBe("anthropic/claude-sonnet-4-6");
  });

  it("does not fall back when multiple providers share the same bare id", () => {
    const prefixed = [
      { id: "openai/gpt-5.1", maxContextSize: 400_000 },
      { id: "fireworks/gpt-5.1", maxContextSize: 128_000 },
    ];
    expect(matchCatalogModel(prefixed, "gpt-5.1")).toBeUndefined();
  });

  it("exact match still wins over prefix fallback", () => {
    const catalogWithBoth = [
      { id: "gpt-5.1", maxContextSize: 100_000 },
      { id: "openai/gpt-5.1", maxContextSize: 400_000 },
    ];
    expect(matchCatalogModel(catalogWithBoth, "gpt-5.1")?.id).toBe("gpt-5.1");
  });
});

describe("prefillFromCatalog", () => {
  it("select mode: probe contextLength wins over catalog limit and inference", () => {
    expect(prefillFromCatalog({
      mode: "select",
      modelId: "qwen3.8-max",
      currentContextSize: "262144",
      currentSupportEfforts: [],
      catalogModel: catalog[0],
      probeContextLength: 500_000,
    })).toEqual({ maxContextSize: 500_000, supportEfforts: ["low", "high"] });
  });

  it("select mode: catalog limit wins over inference", () => {
    expect(prefillFromCatalog({
      mode: "select",
      modelId: "qwen3.8-max",
      currentContextSize: "262144",
      currentSupportEfforts: [],
      catalogModel: catalog[0],
      probeContextLength: null,
    })).toEqual({ maxContextSize: 1_000_000, supportEfforts: ["low", "high"] });
  });

  it("select mode: inference wins over keeping the current value (qwen3.8-max → 1M even without catalog)", () => {
    expect(prefillFromCatalog({
      mode: "select",
      modelId: "qwen3.8-max",
      currentContextSize: "262144",
      currentSupportEfforts: [],
      catalogModel: null,
      probeContextLength: null,
    })).toEqual({ maxContextSize: 1_000_000, supportEfforts: [] });
  });

  it("select mode: keeps current context when model id is blank", () => {
    expect(prefillFromCatalog({
      mode: "select",
      modelId: "  ",
      currentContextSize: "262144",
      currentSupportEfforts: [],
      catalogModel: catalog[0],
      probeContextLength: null,
    })).toEqual({ maxContextSize: null, supportEfforts: ["low", "high"] });
  });

  it("type mode: fills only empty Context, never overrides a hand-edited value", () => {
    expect(prefillFromCatalog({
      mode: "type",
      modelId: "qwen3.8-max",
      currentContextSize: "",
      currentSupportEfforts: [],
      catalogModel: catalog[0],
      probeContextLength: null,
    })).toEqual({ maxContextSize: 1_000_000, supportEfforts: ["low", "high"] });
    expect(prefillFromCatalog({
      mode: "type",
      modelId: "qwen3.8-max",
      currentContextSize: "262144",
      currentSupportEfforts: [],
      catalogModel: catalog[0],
      probeContextLength: 500_000,
    })).toEqual({ maxContextSize: null, supportEfforts: ["low", "high"] });
  });

  it("type mode: never overrides hand-toggled efforts, even when catalog has values", () => {
    expect(prefillFromCatalog({
      mode: "type",
      modelId: "qwen3.8-max",
      currentContextSize: "",
      currentSupportEfforts: ["off"],
      catalogModel: catalog[0],
      probeContextLength: null,
    })).toEqual({ maxContextSize: 1_000_000, supportEfforts: null });
  });

  it("falls back to inference when catalog misses", () => {
    expect(prefillFromCatalog({
      mode: "type",
      modelId: "qwen3.8-max",
      currentContextSize: "",
      currentSupportEfforts: [],
      catalogModel: null,
      probeContextLength: null,
    })).toEqual({ maxContextSize: 1_000_000, supportEfforts: null });
  });

  it("select mode: empty catalog efforts clear the field (no stale efforts kept)", () => {
    expect(prefillFromCatalog({
      mode: "select",
      modelId: "gpt-5.1",
      currentContextSize: "262144",
      currentSupportEfforts: ["low"],
      catalogModel: catalog[1],
      probeContextLength: null,
    })).toEqual({ maxContextSize: 400_000, supportEfforts: [] });
  });

  it("ignores out-of-range catalog limits and probe values", () => {
    expect(prefillFromCatalog({
      mode: "select",
      modelId: "qwen3.8-max",
      currentContextSize: "262144",
      currentSupportEfforts: [],
      catalogModel: { id: "qwen3.8-max", maxContextSize: 999, supportEfforts: undefined },
      probeContextLength: 12,
    })).toEqual({ maxContextSize: 1_000_000, supportEfforts: [] });
  });

  it("select mode: catalog efforts follow the new model even when current efforts are non-empty", () => {
    const prefill = prefillFromCatalog({
      mode: "select",
      modelId: "other-model",
      currentContextSize: "1000000",
      currentSupportEfforts: ["low", "high"],
      catalogModel: { id: "other-model", supportEfforts: ["medium"] },
      probeContextLength: null,
    });
    expect(prefill.supportEfforts).toEqual(["medium"]);
  });

  it("select mode: clears efforts when the new catalog model declares none (no stale old-model efforts)", () => {
    const prefill = prefillFromCatalog({
      mode: "select",
      modelId: "gpt-5.1",
      currentContextSize: "400000",
      currentSupportEfforts: ["low"],
      catalogModel: catalog[1],
      probeContextLength: null,
    });
    expect(prefill.supportEfforts).toEqual([]);
  });
});
