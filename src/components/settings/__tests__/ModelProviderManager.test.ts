import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KimiModelConfigSummary } from "@electron/types/ipc";
import { ModelProviderManager } from "../ModelProviderManager";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const emptyProviderConfig: KimiModelConfigSummary = {
  configPath: "C:/Users/test/.kimi-code/config.toml",
  exists: true,
  defaultModel: "kimi-code/kimi-for-coding",
  providers: [{
    name: "gateway",
    type: "openai",
    baseUrl: "https://gateway.example/v1",
    hasApiKey: true,
    hasEnv: false,
    hasOauth: false,
  }],
  models: [],
};

afterEach(() => {
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "api");
  vi.restoreAllMocks();
});

async function renderManager(config: KimiModelConfigSummary, onConfigChange = vi.fn()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(ModelProviderManager, { config, onConfigChange })));
  return { container, root, onConfigChange };
}

function buttonByText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === text);
}

describe("ModelProviderManager", () => {
  it("lets the user select a model discovered from the configured Base URL", async () => {
    const discoveredConfig: KimiModelConfigSummary = {
      ...emptyProviderConfig,
      models: [{
        alias: "gateway/model-b",
        provider: "gateway",
        model: "model-b",
        displayName: "gateway/model-b",
        maxContextSize: 262144,
        adaptiveThinking: null,
        isDefault: false,
      }],
    };
    const discoverKimiProviderModels = vi.fn().mockResolvedValue({
      success: true,
      data: {
        endpoint: "https://gateway.example/v1/models",
        models: [{ id: "model-a", ownedBy: null }, { id: "model-b", ownedBy: "gateway" }],
      },
    });
    const saveKimiProviderModel = vi.fn().mockResolvedValue({
      success: true,
      data: { ...discoveredConfig, message: "已保存 Provider 模型" },
    });
    const getKimiModelConfig = vi.fn().mockResolvedValue({ success: true, data: discoveredConfig });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { discoverKimiProviderModels, saveKimiProviderModel, getKimiModelConfig },
    });
    const { container, root, onConfigChange } = await renderManager(emptyProviderConfig);

    await act(async () => buttonByText(container, "探测模型")?.click());
    const discoveredSelect = Array.from(container.querySelectorAll("select"))
      .find((select) => select.textContent?.includes("model-b"));
    expect(discoveredSelect).toBeDefined();
    await act(async () => {
      if (!discoveredSelect) return;
      discoveredSelect.value = "model-b";
      discoveredSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect((container.querySelector('input[placeholder="例如 gpt-5.1"]') as HTMLInputElement).value).toBe("model-b");

    await act(async () => buttonByText(container, "保存模型")?.click());
    expect(saveKimiProviderModel).toHaveBeenCalledWith({
      providerName: "gateway",
      modelAlias: "gateway/model-b",
      model: "model-b",
      maxContextSize: 262144,
    });
    expect(getKimiModelConfig).toHaveBeenCalledTimes(1);
    expect(onConfigChange).toHaveBeenCalledWith(discoveredConfig, "已保存 Provider 模型");
    await act(async () => root.unmount());
  });

  it("re-reads model configuration immediately after a provider is created", async () => {
    const createdConfig: KimiModelConfigSummary = {
      ...emptyProviderConfig,
      providers: [...emptyProviderConfig.providers, {
        name: "new-gateway",
        type: "openai",
        baseUrl: "https://new.example/v1",
        hasApiKey: true,
        hasEnv: false,
        hasOauth: false,
      }],
    };
    const saveKimiProvider = vi.fn().mockResolvedValue({
      success: true,
      data: { ...createdConfig, message: "已保存 Provider 连接配置" },
    });
    const getKimiModelConfig = vi.fn().mockResolvedValue({ success: true, data: createdConfig });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { saveKimiProvider, getKimiModelConfig },
    });
    const { container, root, onConfigChange } = await renderManager(emptyProviderConfig);

    await act(async () => buttonByText(container, "添加供应商")?.click());
    const setInput = async (placeholder: string, value: string) => {
      const input = container.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await setInput("例如 openai", "new-gateway");
    await setInput("https://api.example.com/v1", "https://new.example/v1");
    await setInput("输入供应商 API Key", "secret-key");
    await act(async () => buttonByText(container, "保存供应商")?.click());

    expect(saveKimiProvider).toHaveBeenCalledWith({
      providerName: "new-gateway",
      baseUrl: "https://new.example/v1",
      apiKey: "secret-key",
    });
    expect(getKimiModelConfig).toHaveBeenCalledTimes(1);
    expect(onConfigChange).toHaveBeenCalledWith(createdConfig, "已保存 Provider 连接配置");
    await act(async () => root.unmount());
  });
});
