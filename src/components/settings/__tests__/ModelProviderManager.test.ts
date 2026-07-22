import { act, createElement, useState } from "react";
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

function StatefulManager({ initialConfig, onConfigChange }: {
  initialConfig: KimiModelConfigSummary;
  onConfigChange: (config: KimiModelConfigSummary, message: string) => void;
}) {
  const [config, setConfig] = useState(initialConfig);
  return createElement(ModelProviderManager, {
    config,
    onConfigChange: (next, message) => {
      setConfig(next);
      onConfigChange(next, message);
    },
  });
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
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onConfigChange = vi.fn();
    await act(async () => root.render(createElement(StatefulManager, { initialConfig: emptyProviderConfig, onConfigChange })));

    const modelEditorTitle = Array.from(container.querySelectorAll("div"))
      .find((element) => element.textContent?.trim() === "添加模型");
    const discoveryTitle = Array.from(container.querySelectorAll("div"))
      .find((element) => element.textContent?.trim() === "从 Base URL 探测模型");
    expect(modelEditorTitle?.closest(".kimix-settings-card")).not.toBeNull();
    expect(discoveryTitle).toBeDefined();
    expect(discoveryTitle && modelEditorTitle
      ? Boolean(discoveryTitle.compareDocumentPosition(modelEditorTitle) & Node.DOCUMENT_POSITION_FOLLOWING)
      : false).toBe(true);
    expect(buttonByText(container, "从官方目录选择模型")).toBeUndefined();

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
    expect(container.textContent).toContain("1 个模型共享当前供应商连接");
    expect(container.textContent).toContain("gateway/model-b");
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

  it("keeps a successful model deletion visible when the immediate SDK reload is stale", async () => {
    const modelA = {
      alias: "gateway/model-a",
      provider: "gateway",
      model: "model-a",
      displayName: "gateway/model-a",
      maxContextSize: 262144,
      adaptiveThinking: null,
      isDefault: true,
    };
    const modelB = { ...modelA, alias: "gateway/model-b", model: "model-b", displayName: "gateway/model-b", isDefault: false };
    const beforeDelete: KimiModelConfigSummary = { ...emptyProviderConfig, defaultModel: modelA.alias, models: [modelA, modelB] };
    const afterDelete: KimiModelConfigSummary = { ...beforeDelete, models: [modelA] };
    const removeKimiModelConfig = vi.fn().mockResolvedValue({
      success: true,
      data: { ...afterDelete, message: "已删除模型配置" },
    });
    const getKimiModelConfig = vi.fn().mockResolvedValue({ success: true, data: beforeDelete });
    const nativeConfirm = vi.spyOn(window, "confirm");
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { removeKimiModelConfig, getKimiModelConfig },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onConfigChange = vi.fn();
    await act(async () => root.render(createElement(StatefulManager, { initialConfig: beforeDelete, onConfigChange })));

    const removeButton = container.querySelector('button[aria-label="删除 gateway/model-b"]') as HTMLButtonElement;
    await act(async () => removeButton.click());
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(removeKimiModelConfig).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-modal="true"]')?.textContent).toContain("删除模型");
    const confirmButton = buttonByText(document.body, "确认删除");
    await act(async () => confirmButton?.click());

    expect(removeKimiModelConfig).toHaveBeenCalledWith({ modelAlias: "gateway/model-b" });
    expect(getKimiModelConfig).toHaveBeenCalledTimes(1);
    expect(onConfigChange).toHaveBeenCalledTimes(1);
    expect(onConfigChange).toHaveBeenCalledWith(expect.objectContaining({ models: [modelA] }), "已删除模型配置");
    expect(container.textContent).not.toContain("gateway/model-b");
    expect(container.textContent).toContain("后台配置仍在同步");
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();

    const modelInput = container.querySelector('input[placeholder="例如 gpt-5.1"]') as HTMLInputElement;
    await act(async () => {
      modelInput.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(modelInput, "model-a-next");
      modelInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(modelInput.value).toBe("model-a-next");
    await act(async () => root.unmount());
  });
});
