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
  secondaryModel: null,
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

function PersistentModelPage({ config }: { config: KimiModelConfigSummary }) {
  const [hidden, setHidden] = useState(false);
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", onClick: () => setHidden((value) => !value) }, "切换设置页"),
    createElement(
      "section",
      { hidden, "data-testid": "persistent-model-page" },
      createElement(ModelProviderManager, { config, onConfigChange: vi.fn() }),
    ),
  );
}

describe("ModelProviderManager", () => {
  it("keeps an unsaved provider draft when the settings page is hidden and restored", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(PersistentModelPage, { config: emptyProviderConfig })));

    await act(async () => buttonByText(container, "添加供应商")?.click());
    const nameInput = container.querySelector('input[placeholder="例如 openai"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(nameInput, "draft-provider");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => buttonByText(container, "切换设置页")?.click());
    expect((nameInput.closest('[data-testid="persistent-model-page"]') as HTMLElement).hidden).toBe(true);
    await act(async () => buttonByText(container, "切换设置页")?.click());

    expect((nameInput.closest('[data-testid="persistent-model-page"]') as HTMLElement).hidden).toBe(false);
    expect(nameInput.value).toBe("draft-provider");
    await act(async () => root.unmount());
  });

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
        supportEfforts: null,
        defaultEffort: null,
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

    // 初始不再默认显示编辑/添加模型卡片，探测卡片仍在；选择探测结果后卡片才展开
    const modelEditorTitle = Array.from(container.querySelectorAll("div"))
      .find((element) => element.textContent?.trim() === "添加模型");
    const discoveryTitle = Array.from(container.querySelectorAll("div"))
      .find((element) => element.textContent?.trim() === "从 Base URL 探测模型");
    expect(modelEditorTitle).toBeUndefined();
    expect(discoveryTitle).toBeDefined();
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
      // 目录未命中且无探测值时按推断规则兜底（model-b 未知 → 128k），不再保留默认 262144
      maxContextSize: 128000,
      supportEfforts: [],
      defaultEffort: null,
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
      supportEfforts: null,
      defaultEffort: null,
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

    await act(async () => buttonByText(container, "添加模型")?.click());
    const modelInput = container.querySelector('input[placeholder="例如 gpt-5.1"]') as HTMLInputElement;
    await act(async () => {
      modelInput.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(modelInput, "model-a-next");
      modelInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(modelInput.value).toBe("model-a-next");
    await act(async () => root.unmount());
  });

  it("saves declared thinking efforts and default effort for a custom model", async () => {
    const existingModel = {
      alias: "gateway/model-a",
      provider: "gateway",
      model: "model-a",
      displayName: "gateway/model-a",
      maxContextSize: 262144,
      adaptiveThinking: null,
      isDefault: false,
      supportEfforts: null,
      defaultEffort: null,
    };
    const initialConfig: KimiModelConfigSummary = { ...emptyProviderConfig, models: [existingModel] };
    const savedConfig: KimiModelConfigSummary = {
      ...initialConfig,
      models: [{ ...existingModel, supportEfforts: ["low", "high"], defaultEffort: "high" }],
    };
    const saveKimiProviderModel = vi.fn().mockResolvedValue({
      success: true,
      data: { ...savedConfig, message: "已保存 Provider 模型" },
    });
    const getKimiModelConfig = vi.fn().mockResolvedValue({ success: true, data: savedConfig });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { saveKimiProviderModel, getKimiModelConfig },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onConfigChange = vi.fn();
    await act(async () => root.render(createElement(StatefulManager, { initialConfig, onConfigChange })));

    // 初始不显示编辑卡片，点击模型行后才展开
    expect(Array.from(container.querySelectorAll("div"))
      .find((element) => element.textContent?.trim() === "编辑模型")).toBeUndefined();
    await act(async () => (container.querySelector(".kimix-model-row") as HTMLElement).click());
    const card = Array.from(container.querySelectorAll(".kimix-settings-card"))
      .find((element) => element.textContent?.includes("思考档位（可选）")) as HTMLElement;
    expect(card).toBeDefined();
    const chipByLabel = (label: string) => Array.from(card.querySelectorAll('button[aria-pressed]'))
      .find((button) => button.textContent?.trim() === label) as HTMLButtonElement;
    const defaultSelect = card.querySelector('select[aria-label="默认思考档位"]') as HTMLSelectElement;
    const setDefaultEffort = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(defaultSelect, value);
        defaultSelect.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    expect(defaultSelect.disabled).toBe(true);
    await act(async () => chipByLabel("低").click());
    await act(async () => chipByLabel("高").click());
    expect(defaultSelect.disabled).toBe(false);
    await setDefaultEffort("high");
    expect(defaultSelect.value).toBe("high");

    // 取消选中当前默认档时，默认档自动清空
    await act(async () => chipByLabel("高").click());
    expect(defaultSelect.value).toBe("");

    await act(async () => chipByLabel("高").click());
    await setDefaultEffort("high");
    await act(async () => buttonByText(container, "保存模型")?.click());

    expect(saveKimiProviderModel).toHaveBeenCalledWith({
      providerName: "gateway",
      modelAlias: "gateway/model-a",
      model: "model-a",
      maxContextSize: 262144,
      supportEfforts: ["low", "high"],
      defaultEffort: "high",
    });
    expect(onConfigChange).toHaveBeenCalledWith(savedConfig, "已保存 Provider 模型");
    await act(async () => root.unmount());
  });

  it("re-enables the panel when model discovery rejects at the IPC level", async () => {
    const discoverKimiProviderModels = vi.fn().mockRejectedValue(new Error("ipc broken"));
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { discoverKimiProviderModels },
    });
    const { container, root } = await renderManager(emptyProviderConfig);

    const discoverButton = buttonByText(container, "探测模型") as HTMLButtonElement;
    expect(discoverButton.disabled).toBe(false);
    await act(async () => discoverButton.click());

    expect(discoverKimiProviderModels).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("模型探测失败：ipc broken");
    expect((buttonByText(container, "探测模型") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => root.unmount());
  });

  it("closes the removal dialog and re-enables actions when removal rejects at the IPC level", async () => {
    const modelA = {
      alias: "gateway/model-a",
      provider: "gateway",
      model: "model-a",
      displayName: "gateway/model-a",
      maxContextSize: 262144,
      adaptiveThinking: null,
      isDefault: true,
      supportEfforts: null,
      defaultEffort: null,
    };
    const modelB = { ...modelA, alias: "gateway/model-b", model: "model-b", displayName: "gateway/model-b", isDefault: false };
    const beforeDelete: KimiModelConfigSummary = { ...emptyProviderConfig, defaultModel: modelA.alias, models: [modelA, modelB] };
    const removeKimiModelConfig = vi.fn().mockRejectedValue(new Error("ipc broken"));
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { removeKimiModelConfig },
    });
    const { container, root } = await renderManager(beforeDelete);

    const removeButton = container.querySelector('button[aria-label="删除 gateway/model-b"]') as HTMLButtonElement;
    await act(async () => removeButton.click());
    await act(async () => buttonByText(document.body, "确认删除")?.click());

    expect(removeKimiModelConfig).toHaveBeenCalledWith({ modelAlias: "gateway/model-b" });
    expect(container.textContent).toContain("删除失败：ipc broken");
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    expect((container.querySelector('button[aria-label="删除 gateway/model-b"]') as HTMLButtonElement).disabled).toBe(false);
    await act(async () => root.unmount());
  });

  it("automatically uses model ID as modelAlias when modelAlias is omitted", async () => {
    const saveKimiProviderModel = vi.fn().mockResolvedValue({
      success: true,
      data: { ...emptyProviderConfig, message: "已保存 Provider 模型" },
    });
    const getKimiModelConfig = vi.fn().mockResolvedValue({ success: true, data: emptyProviderConfig });
    Object.defineProperty(window, "api", {
      configurable: true,
      value: { saveKimiProviderModel, getKimiModelConfig },
    });
    const { container, root } = await renderManager(emptyProviderConfig);

    await act(async () => buttonByText(container, "添加模型")?.click());
    const modelInput = container.querySelector('input[placeholder="例如 gpt-5.1"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(modelInput, "my-custom-model");
      modelInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find((btn) => btn.textContent?.includes("保存模型"));
    await act(async () => saveButton?.click());

    expect(saveKimiProviderModel).toHaveBeenCalledWith(expect.objectContaining({
      providerName: "gateway",
      model: "my-custom-model",
      modelAlias: "my-custom-model",
    }));
    await act(async () => root.unmount());
  });

  it("hides the model form until a model is selected or the add action is used", async () => {
    const existingModel = {
      alias: "gateway/model-a",
      provider: "gateway",
      model: "model-a",
      displayName: "gateway/model-a",
      maxContextSize: 262144,
      adaptiveThinking: null,
      isDefault: true,
      supportEfforts: null,
      defaultEffort: null,
    };
    const { container, root } = await renderManager({ ...emptyProviderConfig, models: [existingModel] });

    const editorTitle = () => Array.from(container.querySelectorAll("div"))
      .find((element) => element.textContent?.trim() === "编辑模型" || element.textContent?.trim() === "添加模型");
    // 即使是默认模型也不自动选中、不显示编辑卡片
    expect(editorTitle()).toBeUndefined();
    expect(container.querySelector(".kimix-model-row.is-active")).toBeNull();

    // 点击模型行后显示编辑卡片并进入选中态
    await act(async () => (container.querySelector(".kimix-model-row") as HTMLElement).click());
    expect(editorTitle()?.textContent?.trim()).toBe("编辑模型");
    expect(container.querySelector(".kimix-model-row.is-active")).not.toBeNull();

    // 点击“添加模型”按钮切换为添加模式
    await act(async () => buttonByText(container, "添加模型")?.click());
    expect(editorTitle()?.textContent?.trim()).toBe("添加模型");
    expect(container.querySelector(".kimix-model-row.is-active")).toBeNull();
    await act(async () => root.unmount());
  });
});

it("shows a friendly manual-add hint when the Base URL has no models endpoint", async () => {
  const discoverKimiProviderModels = vi.fn().mockResolvedValue({
    success: true,
    data: { endpoint: "", models: [], unsupported: true },
  });
  Object.defineProperty(window, "api", {
    configurable: true,
    value: { discoverKimiProviderModels },
  });
  const { container, root } = await renderManager(emptyProviderConfig);

  const discoverButton = buttonByText(container, "探测模型") as HTMLButtonElement;
  await act(async () => discoverButton.click());

  expect(container.textContent).toContain("该 Base URL 未实现模型列表接口");
  expect(container.textContent).toContain("可手动添加模型");
  expect(container.textContent).not.toContain("模型探测失败");
  expect((buttonByText(container, "探测模型") as HTMLButtonElement).disabled).toBe(false);
  await act(async () => root.unmount());
});

it("prefills Context and thinking efforts from the official catalog when a discovered model matches", async () => {
  let resolveCatalog!: (value: unknown) => void;
  const listKimiProviderCatalog = vi.fn(() => new Promise((resolve) => { resolveCatalog = resolve; }));
  const discoverKimiProviderModels = vi.fn().mockResolvedValue({
    success: true,
    data: {
      endpoint: "https://gateway.example/v1/models",
      models: [{ id: "model-b", ownedBy: "catalog" }],
    },
  });
  const saveKimiProviderModel = vi.fn().mockResolvedValue({
    success: true,
    data: { ...emptyProviderConfig, message: "已保存 Provider 模型" },
  });
  const getKimiModelConfig = vi.fn().mockResolvedValue({ success: true, data: emptyProviderConfig });
  Object.defineProperty(window, "api", {
    configurable: true,
    value: { discoverKimiProviderModels, listKimiProviderCatalog, saveKimiProviderModel, getKimiModelConfig },
  });
  const { container, root } = await renderManager(emptyProviderConfig);

  await act(async () => buttonByText(container, "探测模型")?.click());
  // 探测成功后惰性触发目录载入；手动 resolve 保证选中前目录已就绪
  await act(async () => {
    resolveCatalog({
      success: true,
      data: {
        providers: [{
          providerId: "catalog-prod",
          type: "openai",
          baseUrl: "https://catalog.example/v1",
          modelCount: 1,
          models: [{
            id: "model-b",
            name: "Model B",
            maxContextSize: 1_000_000,
            thinking: true,
            toolUse: true,
            supportEfforts: ["low", "high"],
          }],
        }],
      },
    });
  });

  const discoveredSelect = Array.from(container.querySelectorAll("select"))
    .find((select) => select.textContent?.includes("model-b"));
  expect(discoveredSelect).toBeDefined();
  await act(async () => {
    if (!discoveredSelect) return;
    discoveredSelect.value = "model-b";
    discoveredSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });

  expect((container.querySelector('input[placeholder="例如 gpt-5.1"]') as HTMLInputElement).value).toBe("model-b");
  const contextInput = Array.from(container.querySelectorAll("input"))
    .find((input) => (input as HTMLInputElement).type === "number") as HTMLInputElement;
  expect(contextInput.value).toBe("1000000");
  const card = Array.from(container.querySelectorAll(".kimix-settings-card"))
    .find((element) => element.textContent?.includes("思考档位（可选）")) as HTMLElement;
  const pressedEfforts = Array.from(card.querySelectorAll('button[aria-pressed="true"]'))
    .map((button) => button.textContent?.trim());
  expect(pressedEfforts).toEqual(["低", "高"]);

  await act(async () => buttonByText(container, "保存模型")?.click());
  expect(saveKimiProviderModel).toHaveBeenCalledWith({
    providerName: "gateway",
    modelAlias: "gateway/model-b",
    model: "model-b",
    maxContextSize: 1_000_000,
    supportEfforts: ["low", "high"],
    defaultEffort: null,
  });
  await act(async () => root.unmount());
});

it("prefills Context and efforts from the catalog when typing a model id into an empty Context field", async () => {
  let resolveCatalog!: (value: unknown) => void;
  const listKimiProviderCatalog = vi.fn(() => new Promise((resolve) => { resolveCatalog = resolve; }));
  Object.defineProperty(window, "api", {
    configurable: true,
    value: { listKimiProviderCatalog },
  });
  const { container, root } = await renderManager(emptyProviderConfig);

  // 打开添加模型表单会惰性触发目录载入
  await act(async () => buttonByText(container, "添加模型")?.click());
  await act(async () => {
    resolveCatalog({
      success: true,
      data: {
        providers: [{
          providerId: "catalog-prod",
          type: "openai",
          baseUrl: null,
          modelCount: 1,
          models: [{
            id: "catalog-only-model",
            name: null,
            maxContextSize: 777_000,
            thinking: true,
            toolUse: true,
            supportEfforts: ["medium"],
          }],
        }],
      },
    });
  });

  // 沿用「为空才填」纪律：先清空 Context，再输入模型 ID
  const contextInput = Array.from(container.querySelectorAll("input"))
    .find((input) => (input as HTMLInputElement).type === "number") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(contextInput, "");
    contextInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const modelInput = container.querySelector('input[placeholder="例如 gpt-5.1"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(modelInput, "catalog-only-model");
    modelInput.dispatchEvent(new Event("input", { bubbles: true }));
  });

  expect(contextInput.value).toBe("777000");
  const card = Array.from(container.querySelectorAll(".kimix-settings-card"))
    .find((element) => element.textContent?.includes("思考档位（可选）")) as HTMLElement;
  const pressedEfforts = Array.from(card.querySelectorAll('button[aria-pressed="true"]'))
    .map((button) => button.textContent?.trim());
  expect(pressedEfforts).toEqual(["中"]);
  await act(async () => root.unmount());
});

it("shows a model save error inside the model form instead of the panel top message", async () => {
  const saveKimiProviderModel = vi.fn().mockResolvedValue({
    success: false,
    error: "modelAlias: Invalid",
  });
  Object.defineProperty(window, "api", {
    configurable: true,
    value: { saveKimiProviderModel },
  });
  const { container, root } = await renderManager(emptyProviderConfig);

  await act(async () => buttonByText(container, "添加模型")?.click());
  const modelInput = container.querySelector('input[placeholder="例如 gpt-5.1"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(modelInput, "qwen3.8-max");
    modelInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => buttonByText(container, "保存模型")?.click());

  expect(saveKimiProviderModel).toHaveBeenCalledWith(expect.objectContaining({
    providerName: "gateway",
    modelAlias: "qwen3.8-max",
    model: "qwen3.8-max",
  }));
  // 失败消息渲染在添加模型卡片内（保存模型按钮附近），而非面板顶部的供应商操作区
  const formCard = Array.from(container.querySelectorAll(".kimix-settings-card"))
    .find((element) => element.textContent?.includes("添加模型")) as HTMLElement;
  expect(formCard).toBeDefined();
  expect(formCard.textContent).toContain("模型保存失败：modelAlias: Invalid");
  const topMessage = container.querySelector(".kimix-model-provider-actions .text-text-muted");
  expect(topMessage?.textContent ?? "").not.toContain("模型保存失败");
  await act(async () => root.unmount());
});
