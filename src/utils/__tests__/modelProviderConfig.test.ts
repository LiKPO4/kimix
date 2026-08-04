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
    })).toEqual({ maxContextSize: 1_000_000, supportEfforts: null });
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

  it("passes through catalog efforts unchanged; empty effort lists count as no value", () => {
    expect(prefillFromCatalog({
      mode: "select",
      modelId: "gpt-5.1",
      currentContextSize: "262144",
      currentSupportEfforts: [],
      catalogModel: catalog[1],
      probeContextLength: null,
    })).toEqual({ maxContextSize: 400_000, supportEfforts: null });
  });

  it("ignores out-of-range catalog limits and probe values", () => {
    expect(prefillFromCatalog({
      mode: "select",
      modelId: "qwen3.8-max",
      currentContextSize: "262144",
      currentSupportEfforts: [],
      catalogModel: { id: "qwen3.8-max", maxContextSize: 999, supportEfforts: undefined },
      probeContextLength: 12,
    })).toEqual({ maxContextSize: 1_000_000, supportEfforts: null });
  });
});
