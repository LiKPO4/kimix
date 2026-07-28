import { describe, expect, it, vi } from "vitest";
import {
  buildOpenAiModelListUrls,
  discoverOpenAiModels,
  ModelListEndpointUnsupportedError,
  parseOpenAiModelList,
} from "../../../electron/providerModelDiscovery";

describe("provider model discovery", () => {
  it("derives bounded OpenAI-compatible model endpoints from common Base URL forms", () => {
    expect(buildOpenAiModelListUrls("https://api.openai.com/v1")).toEqual([
      "https://api.openai.com/v1/models",
    ]);
    expect(buildOpenAiModelListUrls("https://api.deepseek.com")).toEqual([
      "https://api.deepseek.com/models",
      "https://api.deepseek.com/v1/models",
    ]);
    expect(buildOpenAiModelListUrls("https://gateway.example/openai/v1/chat/completions")).toEqual([
      "https://gateway.example/openai/v1/models",
    ]);
  });

  it("parses, deduplicates, and sorts OpenAI model objects without inventing metadata", () => {
    expect(parseOpenAiModelList({
      object: "list",
      data: [
        { id: "z-model", owned_by: "gateway" },
        { id: "a-model" },
        { id: "z-model", owned_by: "duplicate" },
        { name: "not-an-id" },
      ],
    })).toEqual([
      { id: "a-model", ownedBy: null },
      { id: "z-model", ownedBy: "gateway" },
    ]);
  });

  it("extracts context length from model list entries when present", () => {
    expect(parseOpenAiModelList({
      data: [
        { id: "openrouter/model", context_length: 200000 },
        { id: "oneapi/model", context_window: 128000 },
        { id: "ollama/model", details: { context_length: 32768 } },
      ],
    })).toEqual([
      { id: "ollama/model", ownedBy: null, contextLength: 32768 },
      { id: "oneapi/model", ownedBy: null, contextLength: 128000 },
      { id: "openrouter/model", ownedBy: null, contextLength: 200000 },
    ]);
  });

  it("uses Bearer authentication and falls back to /v1/models only after the direct path fails", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "not found" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "deepseek-chat" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));

    await expect(discoverOpenAiModels({
      baseUrl: "https://api.deepseek.com",
      apiKey: "secret-key",
    }, fetchMock)).resolves.toEqual({
      endpoint: "https://api.deepseek.com/v1/models",
      models: [{ id: "deepseek-chat", ownedBy: null }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer secret-key",
    });
  });
});

describe("model list endpoint unsupported", () => {
  it("throws ModelListEndpointUnsupportedError when every candidate answers 404", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: { message: "Models endpoint is not available" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })));

    const error = await discoverOpenAiModels({
      baseUrl: "http://127.0.0.1:15722",
      apiKey: "secret-key",
    }, fetchMock).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ModelListEndpointUnsupportedError);
    expect((error as ModelListEndpointUnsupportedError).failures).toHaveLength(2);
  });

  it("keeps the generic failure when only some candidates 404", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "not found" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response("gateway timeout", { status: 502 }));

    await expect(discoverOpenAiModels({
      baseUrl: "https://api.example.com",
      apiKey: "secret-key",
    }, fetchMock)).rejects.not.toBeInstanceOf(ModelListEndpointUnsupportedError);
  });
});
