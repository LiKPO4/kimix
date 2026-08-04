import { describe, expect, it } from "vitest";
import { matchCatalogModel, prefillFromCatalog } from "../modelProviderConfig";

const catalog = [
  { id: "qwen3.8-max", maxContextSize: 1_000_000, supportEfforts: ["low", "high"] },
  { id: "gpt-5.1", maxContextSize: 400_000, supportEfforts: [] },
  { id: "Unknown-Case-Model", maxContextSize: 128_000 },
];

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
