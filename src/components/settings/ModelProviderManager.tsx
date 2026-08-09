import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Zap,
} from "lucide-react";
import type {
  DiscoveredKimiProviderModel,
  KimiModelAliasSummary,
  KimiModelConfigSummary,
  KimiProviderCatalogEntrySummary,
} from "@electron/types/ipc";
import {
  chooseInitialModelProvider,
  defaultModelAliasForProvider,
  groupModelsByProvider,
  matchCatalogModel,
  matchCatalogProvider,
  prefillFromCatalog,
} from "@/utils/modelProviderConfig";
import { useDialogFocus } from "@/hooks/useDialogFocus";

const NEW_PROVIDER_ID = "__new_provider__";
const DEFAULT_CONTEXT_SIZE = 262144;
const THINKING_EFFORT_CHOICES = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

type Props = {
  config: KimiModelConfigSummary;
  onConfigChange: (config: KimiModelConfigSummary, message: string) => void;
};

type ProviderDraft = {
  providerName: string;
  baseUrl: string;
  apiKey: string;
};

type ModelDraft = {
  modelAlias: string;
  model: string;
  maxContextSize: string;
  supportEfforts: string[];
  defaultEffort: string;
};

type RemovalTarget =
  | { type: "model"; model: KimiModelAliasSummary }
  | { type: "provider"; providerName: string; modelCount: number };

function createModelDraft(model?: KimiModelAliasSummary | null): ModelDraft {
  return {
    modelAlias: model?.alias ?? "",
    model: model?.model ?? "",
    maxContextSize: String(model?.maxContextSize ?? DEFAULT_CONTEXT_SIZE),
    supportEfforts: model?.supportEfforts ?? [],
    defaultEffort: model?.defaultEffort ?? "",
  };
}

function providerDisplayName(name: string) {
  if (name === "managed:kimi-code") return "Kimi Code";
  if (name === "__unbound__") return "未绑定模型";
  return name;
}

function modelConfigFingerprint(config: KimiModelConfigSummary) {
  return JSON.stringify({
    defaultModel: config.defaultModel,
    providers: [...config.providers].sort((left, right) => left.name.localeCompare(right.name)),
    models: [...config.models].sort((left, right) => left.alias.localeCompare(right.alias)),
  });
}

function RemovalConfirmDialog({ target, busy, onCancel, onConfirm }: {
  target: RemovalTarget;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(true);
  const title = target.type === "model" ? "删除模型" : "删除供应商";
  const name = target.type === "model" ? (target.model.displayName || target.model.alias) : target.providerName;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-[color:var(--kimix-modal-overlay-bg)]"
      style={{ padding: 20 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-provider-removal-title"
        className="kimix-modal-card w-full max-w-[430px]"
        style={{ padding: "20px 22px" }}
      >
        <div id="model-provider-removal-title" className="text-[16px] font-semibold leading-6 text-text-primary">{title}</div>
        <div className="text-[13.5px] leading-6 text-text-secondary" style={{ marginTop: 12 }}>
          确认删除「{name}」？
        </div>
        <div className="rounded-xl bg-surface-base text-[12.5px] leading-5 text-text-muted" style={{ marginTop: 14, padding: "10px 12px" }}>
          {target.type === "model"
            ? "供应商连接配置会保留。"
            : `将同时删除其下 ${target.modelCount} 个模型，config.toml 会先自动备份。`}
        </div>
        <div className="flex items-center justify-end" style={{ gap: 10, marginTop: 18 }}>
          <button type="button" onClick={onCancel} disabled={busy} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover disabled:opacity-45">
            取消
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className="kimix-icon-text-button is-compact bg-accent-danger text-white hover:opacity-90 disabled:opacity-45" style={{ minWidth: 86, justifyContent: "center" }}>
            {busy ? "删除中" : "确认删除"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ModelProviderManager({ config, onConfigChange }: Props) {
  const groups = useMemo(() => groupModelsByProvider(config), [config]);
  const [selectedProviderName, setSelectedProviderName] = useState(() => chooseInitialModelProvider(config));
  const [selectedModelAlias, setSelectedModelAlias] = useState("");
  // 模型表单改为显式展开：只有选中模型、点击“添加模型”或选择探测结果后才显示，进入页面不再默认展示编辑卡片
  const [addingModel, setAddingModel] = useState(false);
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>({ providerName: "", baseUrl: "", apiKey: "" });
  const [modelDraft, setModelDraft] = useState<ModelDraft>(() => createModelDraft());
  const [catalog, setCatalog] = useState<KimiProviderCatalogEntrySummary[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredKimiProviderModel[]>([]);
  const [discoveredEndpoint, setDiscoveredEndpoint] = useState("");
  const [busyAction, setBusyAction] = useState<"provider" | "model" | "discover" | "test" | "default" | "remove-model" | "remove-provider" | "thinking" | "probe-effort" | null>(null);
  const [message, setMessage] = useState("");
  const [modelFormMessage, setModelFormMessage] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [removalTarget, setRemovalTarget] = useState<RemovalTarget | null>(null);
  const catalogProvider = useMemo(
    () => matchCatalogProvider(catalog, selectedProviderName, providerDraft.baseUrl),
    [catalog, providerDraft.baseUrl, selectedProviderName],
  );
  const catalogModels = useMemo(() => catalogProvider?.models ?? [], [catalogProvider]);
  const catalogLoadTriggeredRef = useRef(false);
  // 「用户已手动编辑」跟踪：type 模式预填只填未触碰字段——用户清空 Context/档位后
  // 不得被下一次按键的预填重新填回（review 中 8）；目录迟到补预填同样只碰未触碰字段。
  const modelContextTouchedRef = useRef(false);
  const modelEffortsTouchedRef = useRef(false);
  const resetModelDraftTracking = () => {
    modelContextTouchedRef.current = false;
    modelEffortsTouchedRef.current = false;
  };

  const selectedGroup = groups.find((group) => group.provider.name === selectedProviderName) ?? null;
  const isCreatingProvider = selectedProviderName === NEW_PROVIDER_ID || !selectedGroup;
  const selectedProviderManaged = selectedGroup?.managed ?? false;
  const selectedProviderHasCredential = Boolean(
    selectedGroup?.provider.hasApiKey || selectedGroup?.provider.hasEnv || selectedGroup?.provider.hasOauth,
  );

  useEffect(() => {
    if (selectedProviderName === NEW_PROVIDER_ID) return;
    if (!groups.some((group) => group.provider.name === selectedProviderName)) {
      setSelectedProviderName(chooseInitialModelProvider(config));
    }
  }, [config, groups, selectedProviderName]);

  useEffect(() => {
    if (isCreatingProvider) return;
    if (!selectedGroup) return;
    setProviderDraft({
      providerName: selectedGroup.provider.name,
      baseUrl: selectedGroup.provider.baseUrl ?? "",
      apiKey: "",
    });
    // 不自动选中默认/首个模型：仅保留仍存在的当前选中，否则清空，等用户显式选择；无选中时保留正在输入的草稿
    setSelectedModelAlias((currentAlias) => {
      const nextModel = currentAlias ? selectedGroup.models.find((model) => model.alias === currentAlias) ?? null : null;
      setModelDraft((currentDraft) => nextModel ? createModelDraft(nextModel) : (currentDraft.model ? currentDraft : createModelDraft()));
      return nextModel?.alias ?? "";
    });
  }, [isCreatingProvider, selectedGroup]);

  const applyConfigResult = async (
    next: KimiModelConfigSummary & { message?: string },
    fallbackMessage: string,
    messageTarget: "top" | "modelForm" = "top",
  ) => {
    const savedMessage = next.message || fallbackMessage;
    const { message: _message, ...writtenConfig } = next;
    // 写入响应来自刚完成的持久化操作，必须先显示；SDK/Server 的 reload 可能短暂返回旧缓存。
    onConfigChange(writtenConfig, savedMessage);
    if (messageTarget === "modelForm") {
      setModelFormMessage(savedMessage);
    } else {
      setMessage(savedMessage);
    }
    const refreshed = await window.api.getKimiModelConfig().catch((error) => ({
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
    }));
    const refreshMatchesWrite = refreshed.success
      && modelConfigFingerprint(refreshed.data) === modelConfigFingerprint(next);
    const nextMessage = refreshed.success
      ? (refreshMatchesWrite ? savedMessage : `${savedMessage}；后台配置仍在同步`)
      : `${savedMessage}；即时刷新失败：${refreshed.error}`;
    if (messageTarget === "modelForm") {
      setModelFormMessage(nextMessage);
    } else {
      setMessage(nextMessage);
    }
    window.dispatchEvent(new CustomEvent("kimix:kimi-model-config-changed"));
  };

  const handleSelectProvider = (providerName: string) => {
    setSelectedProviderName(providerName);
    setSelectedModelAlias("");
    setAddingModel(false);
    resetModelDraftTracking();
    setModelDraft(createModelDraft());
    setDiscoveredModels([]);
    setDiscoveredEndpoint("");
    setModelFormMessage("");
    setMessage("");
  };

  const handleCreateProvider = () => {
    setSelectedProviderName(NEW_PROVIDER_ID);
    setSelectedModelAlias("");
    setAddingModel(false);
    setProviderDraft({ providerName: "", baseUrl: "", apiKey: "" });
    resetModelDraftTracking();
    setModelDraft(createModelDraft());
    setDiscoveredModels([]);
    setDiscoveredEndpoint("");
    setModelFormMessage("");
    setMessage("先保存供应商连接配置，再在下方添加一个或多个模型。");
  };

  const handleLoadCatalog = async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    setCatalogLoading(true);
    if (!silent) setMessage("正在载入官方 Provider 目录...");
    try {
      const res = await window.api.listKimiProviderCatalog();
      if (!res.success) {
        if (!silent) setMessage(`目录载入失败：${res.error}`);
        catalogLoadTriggeredRef.current = false;
        return;
      }
      setCatalog(res.data.providers);
      if (!silent) setMessage(`已载入 ${res.data.providers.length} 个 OpenAI-compatible Provider。`);
    } catch (error) {
      if (!silent) setMessage(`目录载入失败：${error instanceof Error ? error.message : String(error)}`);
      catalogLoadTriggeredRef.current = false;
    } finally {
      setCatalogLoading(false);
    }
  };

  // 惰性目录载入：打开添加模型表单或探测成功时，若目录尚未载入则静默触发一次（失败允许下次重试），
  // 仅用于目录匹配预填，不阻塞表单、不覆盖提示文案
  const ensureCatalogLoaded = () => {
    if (catalog.length > 0 || catalogLoading || catalogLoadTriggeredRef.current) return;
    catalogLoadTriggeredRef.current = true;
    void handleLoadCatalog({ silent: true });
  };

  // 目录惰性加载与预填的竞态（review 中 8）：目录返回前用户已选中/手输模型时，
  // 首次预填只能看到空目录；目录到达后对「未手动编辑」的字段补跑一次预填。
  useEffect(() => {
    if (catalogModels.length === 0) return;
    setModelDraft((current) => {
      if (!current.model.trim()) return current;
      if (modelContextTouchedRef.current && modelEffortsTouchedRef.current) return current;
      const item = discoveredModels.find((m) => m.id === current.model.trim());
      const prefill = prefillFromCatalog({
        mode: "type",
        modelId: current.model,
        currentContextSize: "",
        currentSupportEfforts: [],
        catalogModel: matchCatalogModel(catalogModels, current.model),
        probeContextLength: item?.contextLength,
      });
      const nextContext = modelContextTouchedRef.current
        ? current.maxContextSize
        : (prefill.maxContextSize != null ? String(prefill.maxContextSize) : current.maxContextSize);
      const nextEfforts = modelEffortsTouchedRef.current
        ? current.supportEfforts
        : (prefill.supportEfforts ?? current.supportEfforts);
      if (nextContext === current.maxContextSize && nextEfforts === current.supportEfforts) return current;
      return { ...current, maxContextSize: nextContext, supportEfforts: nextEfforts };
    });
  }, [catalogModels, discoveredModels]);

  const handleCatalogProvider = (providerId: string) => {
    const provider = catalog.find((item) => item.providerId === providerId);
    if (!provider) return;
    setProviderDraft((current) => ({
      ...current,
      providerName: provider.providerId,
      baseUrl: provider.baseUrl ?? current.baseUrl,
    }));
    setDiscoveredModels([]);
    setDiscoveredEndpoint("");
    resetModelDraftTracking();
    setModelDraft(createModelDraft());
  };

  const readContextSize = () => {
    const value = Number(modelDraft.maxContextSize.trim());
    return Number.isInteger(value) && value >= 1 && value <= 10_000_000 ? value : null;
  };

  const handleDiscoverModels = async () => {
    if (!providerDraft.providerName.trim() || !providerDraft.baseUrl.trim()) {
      setMessage("请先填写供应商名称和 Base URL。");
      return;
    }
    setBusyAction("discover");
    setMessage("正在从 Base URL 探测可用模型...");
    try {
      const res = await window.api.discoverKimiProviderModels({
        providerName: providerDraft.providerName.trim(),
        baseUrl: providerDraft.baseUrl.trim(),
        apiKey: providerDraft.apiKey.trim() || undefined,
      });
      if (!res.success) {
        setDiscoveredModels([]);
        setDiscoveredEndpoint("");
        setMessage(`模型探测失败：${res.error}`);
        return;
      }
      if (res.data.unsupported) {
        setDiscoveredModels([]);
        setDiscoveredEndpoint("");
        setMessage("该 Base URL 未实现模型列表接口（部分代理转发不提供 /models），连接本身不受影响，可手动添加模型。");
        return;
      }
      setDiscoveredModels(res.data.models);
      setDiscoveredEndpoint(res.data.endpoint);
      setMessage(`已从接口发现 ${res.data.models.length} 个模型，选择后将自动解析填入 Context 与思考档位。`);
      ensureCatalogLoaded();
    } catch (error) {
      setDiscoveredModels([]);
      setDiscoveredEndpoint("");
      setMessage(`模型探测失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleDiscoveredModel = (modelId: string) => {
    if (!modelId) return;
    const item = discoveredModels.find((m) => m.id === modelId);
    setSelectedModelAlias("");
    setModelFormMessage("");
    resetModelDraftTracking();
    setAddingModel(true);
    setModelDraft((current) => {
      const prefill = prefillFromCatalog({
        mode: "select",
        modelId,
        currentContextSize: current.maxContextSize,
        currentSupportEfforts: current.supportEfforts,
        catalogModel: matchCatalogModel(catalogModels, modelId),
        probeContextLength: item?.contextLength,
      });
      return {
        modelAlias: defaultModelAliasForProvider(providerDraft.providerName, modelId),
        model: modelId,
        maxContextSize: prefill.maxContextSize != null ? String(prefill.maxContextSize) : current.maxContextSize,
        supportEfforts: prefill.supportEfforts ?? current.supportEfforts,
        defaultEffort: current.defaultEffort,
      };
    });
  };

  const handleSaveProvider = async () => {
    if (!providerDraft.providerName.trim() || !providerDraft.baseUrl.trim()) {
      setMessage("请填写供应商名称和 Base URL。");
      return;
    }
    setBusyAction("provider");
    setMessage("正在保存供应商连接配置...");
    try {
      const res = await window.api.saveKimiProvider({
        providerName: providerDraft.providerName.trim(),
        baseUrl: providerDraft.baseUrl.trim(),
        apiKey: providerDraft.apiKey.trim() || undefined,
      });
      if (!res.success) {
        setMessage(`保存失败：${res.error}`);
        return;
      }
      const providerName = providerDraft.providerName.trim();
      setSelectedProviderName(providerName);
      await applyConfigResult(res.data, "已保存 Provider 连接配置");
    } catch (error) {
      setMessage(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleEffort = (effort: string) => {
    modelEffortsTouchedRef.current = true;
    setModelDraft((current) => {
      const next = current.supportEfforts.includes(effort)
        ? current.supportEfforts.filter((item) => item !== effort)
        : [...current.supportEfforts, effort];
      const supportEfforts = THINKING_EFFORT_CHOICES.filter((item) => next.includes(item));
      const defaultEffort = supportEfforts.includes(current.defaultEffort) ? current.defaultEffort : "";
      return { ...current, supportEfforts, defaultEffort };
    });
  };

  const handleProbeEfforts = async () => {
    if (!selectedModelAlias) {
      setModelFormMessage("请先保存模型，再匹配目录中的模型信息。");
      return;
    }
    setBusyAction("probe-effort");
    setModelFormMessage("正在从 models.dev 匹配模型信息...");
    try {
      const res = await window.api.probeKimiCodeThinkingEfforts({ modelAlias: selectedModelAlias });
      if (!res.success) {
        setModelFormMessage(`探测失败：${res.error}`);
        return;
      }
      if (res.data.maxContextSize) modelContextTouchedRef.current = true;
      if (res.data.supportEfforts) modelEffortsTouchedRef.current = true;
      setModelDraft((current) => ({
        ...current,
        maxContextSize: res.data.maxContextSize ? String(res.data.maxContextSize) : current.maxContextSize,
        supportEfforts: res.data.supportEfforts ?? current.supportEfforts,
        defaultEffort: res.data.supportEfforts
          ? (res.data.defaultEffort && res.data.supportEfforts.includes(res.data.defaultEffort) ? res.data.defaultEffort : "")
          : current.defaultEffort,
      }));
      const matched = [
        res.data.maxContextSize ? `Context ${res.data.maxContextSize}` : "",
        res.data.supportEfforts ? `${res.data.supportEfforts.length} 个思考档位` : "",
      ].filter(Boolean).join(" 和 ");
      const undeclared = res.data.supportEfforts ? "" : "；目录未声明可选思考档位，现有选择保持不变";
      setModelFormMessage(`已从 models.dev 回填${matched}${undeclared}，保存模型后生效。`);
    } catch (error) {
      setModelFormMessage(`探测失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveModel = async () => {
    const contextSize = readContextSize();
    if (!selectedGroup || selectedProviderManaged) {
      setModelFormMessage("请先选择一个第三方 Provider。");
      return;
    }
    const trimmedModel = modelDraft.model.trim();
    const trimmedAlias = modelDraft.modelAlias.trim();
    const effectiveAlias = trimmedAlias || trimmedModel;

    if (!trimmedModel || contextSize === null) {
      setModelFormMessage("请填写有效的模型 ID 和 Context。");
      return;
    }
    setBusyAction("model");
    setModelFormMessage("正在保存模型...");
    try {
      const res = await window.api.saveKimiProviderModel({
        providerName: selectedGroup.provider.name,
        modelAlias: effectiveAlias,
        model: trimmedModel,
        maxContextSize: contextSize,
        supportEfforts: modelDraft.supportEfforts,
        defaultEffort: modelDraft.supportEfforts.includes(modelDraft.defaultEffort) ? modelDraft.defaultEffort : null,
      });
      if (!res.success) {
        setModelFormMessage(`模型保存失败：${res.error}`);
        return;
      }
      // 保存成功后收起表单（编辑态与添加态一致），成功提示放到面板顶部可见位置
      setSelectedModelAlias("");
      setAddingModel(false);
      await applyConfigResult(res.data, "已保存 Provider 模型");
    } catch (error) {
      setModelFormMessage(`模型保存失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleTestProvider = async () => {
    const contextSize = readContextSize();
    const fallbackModel = selectedGroup?.models[0];
    const model = modelDraft.model.trim() || fallbackModel?.model || "";
    const modelAlias = modelDraft.modelAlias.trim() || fallbackModel?.alias || defaultModelAliasForProvider(providerDraft.providerName, model);
    if (!providerDraft.providerName.trim() || !providerDraft.baseUrl.trim() || !model || contextSize === null) {
      setMessage("测试连接至少需要供应商、Base URL 和一个有效模型。");
      return;
    }
    setBusyAction("test");
    setMessage("正在用当前模型测试连接...");
    try {
      const res = await window.api.testKimiOpenAiProvider({
        providerName: providerDraft.providerName.trim(),
        baseUrl: providerDraft.baseUrl.trim(),
        apiKey: providerDraft.apiKey.trim() || undefined,
        modelAlias,
        model,
        maxContextSize: contextSize,
      });
      setMessage(res.success ? `测试通过：${res.data.output || res.data.message}` : `测试失败：${res.error}`);
    } catch (error) {
      setMessage(`测试失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleSetDefault = async (modelAlias: string) => {
    setBusyAction("default");
    try {
      const res = await window.api.setKimiDefaultModel({ modelAlias });
      if (!res.success) {
        setMessage(`切换失败：${res.error}`);
        return;
      }
      await applyConfigResult(res.data, "已切换使用模型");
    } catch (error) {
      setMessage(`切换失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleThinking = async (model: KimiModelAliasSummary) => {
    setBusyAction("thinking");
    try {
      const res = await window.api.setKimiModelAdaptiveThinking({
        modelAlias: model.alias,
        adaptiveThinking: !Boolean(model.adaptiveThinking),
      });
      if (!res.success) {
        setMessage(`更新思考设置失败：${res.error}`);
        return;
      }
      await applyConfigResult(res.data, "已更新自适应思考");
    } catch (error) {
      setMessage(`更新思考设置失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleRemoveModel = (model: KimiModelAliasSummary) => {
    setRemovalTarget({ type: "model", model });
  };

  const handleRemoveProvider = () => {
    if (!selectedGroup || selectedProviderManaged) return;
    setRemovalTarget({ type: "provider", providerName: selectedGroup.provider.name, modelCount: selectedGroup.models.length });
  };

  const handleConfirmRemoval = async () => {
    const target = removalTarget;
    if (!target) return;
    if (target.type === "model") {
      setBusyAction("remove-model");
      try {
        const res = await window.api.removeKimiModelConfig({ modelAlias: target.model.alias });
        if (!res.success) {
          setRemovalTarget(null);
          setMessage(`删除失败：${res.error}`);
          return;
        }
        setRemovalTarget(null);
        setModelFormMessage("");
        setSelectedModelAlias("");
        setAddingModel(false);
        await applyConfigResult(res.data, "已删除模型，Provider 连接配置已保留");
      } catch (error) {
        setRemovalTarget(null);
        setMessage(`删除失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setBusyAction(null);
      }
      return;
    }
    setBusyAction("remove-provider");
    try {
      const res = await window.api.removeKimiProviderConfig({ providerName: target.providerName });
      if (!res.success) {
        setRemovalTarget(null);
        setMessage(`删除供应商失败：${res.error}`);
        return;
      }
      setRemovalTarget(null);
      setSelectedProviderName(chooseInitialModelProvider(res.data));
      await applyConfigResult(res.data, "已删除 Provider 及其模型");
    } catch (error) {
      setRemovalTarget(null);
      setMessage(`删除供应商失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleSelectModel = (model: KimiModelAliasSummary) => {
    setSelectedModelAlias(model.alias);
    setAddingModel(false);
    setModelFormMessage("");
    resetModelDraftTracking();
    setModelDraft(createModelDraft(model));
  };

  const handleAddModel = () => {
    setSelectedModelAlias("");
    setAddingModel(true);
    resetModelDraftTracking();
    setModelDraft(createModelDraft());
    setModelFormMessage("");
    setMessage("填写模型 ID、别名和 Context 后保存；Provider 的连接信息会自动复用。");
    ensureCatalogLoaded();
  };

  const managedGroups = groups.filter((group) => group.managed);
  const externalGroups = groups.filter((group) => !group.managed);

  return (
    <div className="kimix-model-provider-manager">
      <aside className="kimix-model-provider-sidebar" style={{ padding: 14 }}>
        <div className="kimix-settings-permission-desc" style={{ marginTop: 0, paddingLeft: 8, paddingRight: 8 }}>内置供应商</div>
        <div className="flex flex-col" style={{ gap: 8, marginTop: 8 }}>
          {managedGroups.map((group) => (
            <button
              key={group.provider.name}
              type="button"
              aria-pressed={selectedProviderName === group.provider.name}
              onClick={() => handleSelectProvider(group.provider.name)}
              className={`kimix-model-provider-item ${selectedProviderName === group.provider.name ? "is-active" : ""}`}
              style={{ padding: "10px 12px" }}
            >
              <Server size={15} />
              <span className="min-w-0 flex-1 truncate">{providerDisplayName(group.provider.name)}</span>
              <span className="text-[11px] text-text-muted">{group.models.length}</span>
            </button>
          ))}
        </div>

        <div className="kimix-settings-permission-desc" style={{ marginTop: 18, paddingLeft: 8, paddingRight: 8 }}>第三方供应商</div>
        <div className="flex flex-col" style={{ gap: 8, marginTop: 8 }}>
          {externalGroups.map((group) => (
            <button
              key={group.provider.name}
              type="button"
              aria-pressed={selectedProviderName === group.provider.name}
              onClick={() => handleSelectProvider(group.provider.name)}
              className={`kimix-model-provider-item ${selectedProviderName === group.provider.name ? "is-active" : ""}`}
              style={{ padding: "10px 12px" }}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${group.provider.hasApiKey || group.provider.hasEnv ? "bg-accent-success" : "bg-accent-warning"}`} />
              <span className="min-w-0 flex-1 truncate">{providerDisplayName(group.provider.name)}</span>
              <span className="text-[11px] text-text-muted">{group.models.length}</span>
            </button>
          ))}
          {externalGroups.length === 0 && (
            <div className="text-[12px] leading-5 text-text-muted" style={{ paddingLeft: 8, paddingRight: 8 }}>尚未配置第三方供应商</div>
          )}
        </div>
        <button
          type="button"
          onClick={handleCreateProvider}
          className={`kimix-icon-text-button w-full justify-start text-text-secondary hover:bg-surface-hover ${isCreatingProvider ? "bg-surface-hover" : ""}`}
          style={{ marginTop: 14 }}
        >
          <Plus size={14} />
          添加供应商
        </button>
      </aside>

      <section className="min-w-0" style={{ padding: 18 }}>
        <div className="grid min-w-0 items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 14 }}>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-text-primary">
              {isCreatingProvider ? "添加第三方供应商" : providerDisplayName(selectedGroup?.provider.name ?? "选择供应商")}
            </div>
            <div className="kimix-settings-permission-desc">
              {selectedProviderManaged ? "内置配置由 Kimi Code 管理" : "连接配置由供应商共享，下方模型无需重复填写 API"}
            </div>
          </div>
          {!isCreatingProvider && selectedGroup && (
            <span className={`rounded-full text-[11.5px] leading-5 ${selectedProviderHasCredential ? "bg-accent-success-light text-accent-success" : "bg-accent-warning-light text-accent-warning"}`} style={{ minWidth: 68, height: 26, paddingLeft: 10, paddingRight: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {selectedProviderHasCredential ? "凭据就绪" : "未配置"}
            </span>
          )}
        </div>

        {!selectedProviderManaged && (
          <>
            <div className="kimix-model-provider-form" style={{ marginTop: 16 }}>
              <label className="min-w-0">
                <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>供应商名称</span>
                <input
                  value={providerDraft.providerName}
                  disabled={!isCreatingProvider}
                  onChange={(event) => {
                    setProviderDraft((current) => ({ ...current, providerName: event.target.value }));
                    setDiscoveredModels([]);
                    setDiscoveredEndpoint("");
                  }}
                  className="kimix-settings-input h-9 w-full text-[13px] outline-none"
                  style={{ marginTop: 6, paddingLeft: 12, paddingRight: 12 }}
                  placeholder="例如 openai"
                />
              </label>
              <label className="min-w-0">
                <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>API 格式</span>
                <input
                  value="OpenAI Chat Completions"
                  disabled
                  className="kimix-settings-input h-9 w-full text-[13px] outline-none"
                  style={{ marginTop: 6, paddingLeft: 12, paddingRight: 12 }}
                />
              </label>
            </div>
            <label className="block min-w-0" style={{ marginTop: 12 }}>
              <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>Base URL</span>
              <input
                value={providerDraft.baseUrl}
                onChange={(event) => {
                  setProviderDraft((current) => ({ ...current, baseUrl: event.target.value }));
                  setDiscoveredModels([]);
                  setDiscoveredEndpoint("");
                }}
                className="kimix-settings-input h-9 w-full text-[13px] outline-none"
                style={{ marginTop: 6, paddingLeft: 12, paddingRight: 12 }}
                placeholder="https://api.example.com/v1"
              />
            </label>
            <label className="block min-w-0" style={{ marginTop: 12 }}>
              <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>API Key</span>
              <div className="relative" style={{ marginTop: 6 }}>
                <input
                  type={showApiKey ? "text" : "password"}
                  value={providerDraft.apiKey}
                  onChange={(event) => setProviderDraft((current) => ({ ...current, apiKey: event.target.value }))}
                  className="kimix-settings-input h-9 w-full text-[13px] outline-none"
                  style={{ paddingLeft: 12, paddingRight: 42 }}
                  placeholder={selectedGroup?.provider.hasApiKey || selectedGroup?.provider.hasEnv ? "留空则保留已保存的 Key" : "输入供应商 API Key"}
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((value) => !value)}
                  className="kimix-inline-icon-action absolute right-1 top-1 text-text-muted hover:bg-surface-hover"
                  style={{ width: 32, height: 28 }}
                  aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                >
                  {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>

            {isCreatingProvider && (
              <div className="rounded-xl bg-surface-base" style={{ marginTop: 14, padding: "12px 14px" }}>
                <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}>
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium text-text-primary">官方 Provider 目录</div>
                    <div className="kimix-settings-permission-desc">可自动填充供应商名称和 Base URL</div>
                  </div>
                  <button type="button" onClick={() => void handleLoadCatalog()} disabled={catalogLoading} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover">
                    <RefreshCw size={13} className={catalogLoading ? "kimix-spin" : ""} />
                    {catalog.length ? "刷新" : "载入"}
                  </button>
                </div>
                {catalog.length > 0 && (
                  <select
                    value={catalog.some((item) => item.providerId === providerDraft.providerName) ? providerDraft.providerName : ""}
                    onChange={(event) => handleCatalogProvider(event.target.value)}
                    className="kimix-settings-input h-9 w-full text-[13px] outline-none"
                    style={{ marginTop: 10, paddingLeft: 12, paddingRight: 12 }}
                  >
                    <option value="">选择一个 Provider</option>
                    {catalog.map((provider) => <option key={provider.providerId} value={provider.providerId}>{provider.providerId} · {provider.modelCount} 个模型</option>)}
                  </select>
                )}
              </div>
            )}

            <div className="kimix-model-provider-actions" style={{ gap: 14, marginTop: 14 }}>
              <div className="min-w-0 text-[12px] leading-5 text-text-muted">{message}</div>
              <div className="kimix-model-provider-action-buttons" style={{ gap: 8 }}>
                {!isCreatingProvider && (
                  <button type="button" onClick={() => void handleTestProvider()} disabled={Boolean(busyAction)} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover disabled:opacity-55">
                    <RefreshCw size={13} className={busyAction === "test" ? "kimix-spin" : ""} />
                    测试
                  </button>
                )}
                <button type="button" onClick={() => void handleSaveProvider()} disabled={Boolean(busyAction)} className="kimix-icon-text-button is-compact bg-accent-primary text-white hover:bg-accent-primary-dark disabled:opacity-55">
                  <Check size={13} />
                  保存供应商
                </button>
                {!isCreatingProvider && (
                  <button type="button" onClick={() => void handleRemoveProvider()} disabled={Boolean(busyAction)} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-accent-danger-light hover:text-accent-danger disabled:opacity-55" title="删除供应商及其模型">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {!isCreatingProvider && selectedGroup && (
          <div className="border-t border-[var(--kimix-panel-divider)]" style={{ marginTop: 18, paddingTop: 16 }}>
            <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 14 }}>
              <div>
                <div className="text-[13px] font-semibold text-text-primary">模型列表</div>
                <div className="kimix-settings-permission-desc">{selectedGroup.models.length} 个模型共享当前供应商连接</div>
              </div>
              {!selectedProviderManaged && (
                <button type="button" onClick={handleAddModel} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover">
                  <Plus size={13} />
                  添加模型
                </button>
              )}
            </div>

            <div className="flex flex-col" style={{ gap: 8, marginTop: 12 }}>
              {selectedGroup.models.map((model) => (
                <div
                  key={model.alias}
                  onClick={() => handleSelectModel(model)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                    event.preventDefault();
                    handleSelectModel(model);
                  }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedModelAlias === model.alias}
                  className={`kimix-model-row ${selectedModelAlias === model.alias ? "is-active" : ""}`}
                  style={{ padding: "10px 12px" }}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-medium text-text-primary">{model.displayName || model.alias}</div>
                    <div className="truncate text-[11.5px] leading-5 text-text-muted">{model.model || model.alias}</div>
                  </div>
                  <span className="kimix-settings-badge shrink-0 text-[11px] tabular-nums" style={{ minWidth: 66, padding: "3px 8px", textAlign: "center" }}>
                    {model.maxContextSize ? `${Math.round(model.maxContextSize / 1000)}k` : "Context"}
                  </span>
                  <div className="flex shrink-0 items-center" style={{ gap: 6 }}>
                    {selectedProviderManaged && (
                      <button type="button" onClick={(event) => { event.stopPropagation(); void handleToggleThinking(model); }} disabled={Boolean(busyAction)} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover">
                        <Zap size={13} />
                        {model.adaptiveThinking ? "思考开" : "思考关"}
                      </button>
                    )}
                    {/* 与输入区 Swarm 模式同款：同一按钮组件，active 浅底色+勾 / 普通透明底，选中前后形式一致 */}
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); if (!model.isDefault) void handleSetDefault(model.alias); }}
                      disabled={Boolean(busyAction)}
                      aria-pressed={model.isDefault}
                      title={model.isDefault ? "当前默认模型" : "设为默认模型"}
                      className="kimix-icon-text-button is-compact border text-text-secondary hover:bg-surface-hover disabled:opacity-55"
                      style={{
                        // 固定宽度容纳“勾+默认”，打勾后仍保持同宽，右侧删除/箭头排列不齐
                        width: 72,
                        minWidth: 72,
                        justifyContent: "center",
                        gap: 6,
                        paddingLeft: 12,
                        paddingRight: 12,
                        borderColor: model.isDefault ? "var(--accent-primary-soft)" : "transparent",
                        backgroundColor: model.isDefault ? "var(--accent-primary-light)" : "transparent",
                        color: model.isDefault ? "var(--accent-primary-dark)" : undefined,
                      }}
                    >
                      {model.isDefault ? <Check size={13} /> : null}
                      默认
                    </button>
                    {!selectedProviderManaged && (
                      <button type="button" onClick={(event) => { event.stopPropagation(); void handleRemoveModel(model); }} disabled={Boolean(busyAction)} className="kimix-inline-icon-action text-text-muted hover:bg-accent-danger-light hover:text-accent-danger" style={{ width: 32, height: 32, flexBasis: 32 }} aria-label={`删除 ${model.displayName || model.alias}`}>
                        <Trash2 size={13} />
                      </button>
                    )}
                    <ChevronRight size={14} className="text-text-muted" />
                  </div>
                </div>
              ))}
              {selectedGroup.models.length === 0 && (
                <div className="rounded-xl bg-surface-base text-[12px] leading-5 text-text-muted" style={{ padding: "16px 18px" }}>
                  此供应商还没有模型。连接配置只需保存一次，之后可以连续添加多个模型。
                </div>
              )}
            </div>

            {selectedProviderManaged && message && (
              <div className="text-[12px] leading-5 text-text-muted" style={{ marginTop: 12, paddingLeft: 2, paddingRight: 2 }}>{message}</div>
            )}

            {!selectedProviderManaged && (
              <div style={{ marginTop: 14 }}>
                <div className="rounded-sm-token bg-surface-base" style={{ padding: "12px 14px" }}>
                  <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}>
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium text-text-primary">从 Base URL 探测模型</div>
                      <div className="kimix-settings-permission-desc">调用 OpenAI-compatible models 接口，返回当前 Key 实际可用的模型</div>
                    </div>
                    <button type="button" onClick={() => void handleDiscoverModels()} disabled={Boolean(busyAction)} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover disabled:opacity-55">
                      <RefreshCw size={13} className={busyAction === "discover" ? "kimix-spin" : ""} />
                      {discoveredModels.length ? "重新探测" : "探测模型"}
                    </button>
                  </div>
                  {discoveredModels.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <select
                        value={discoveredModels.some((item) => item.id === modelDraft.model) ? modelDraft.model : ""}
                        onChange={(event) => handleDiscoveredModel(event.target.value)}
                        className="kimix-settings-input h-9 w-full text-[13px] outline-none"
                        style={{ paddingLeft: 12, paddingRight: 12 }}
                      >
                        <option value="">选择探测到的模型（{discoveredModels.length}）</option>
                        {discoveredModels.map((model) => (
                          <option key={model.id} value={model.id}>{model.id}{model.ownedBy ? ` · ${model.ownedBy}` : ""}</option>
                        ))}
                      </select>
                      <div className="truncate text-[11px] leading-5 text-text-muted" style={{ marginTop: 6, paddingLeft: 2, paddingRight: 2 }} title={discoveredEndpoint}>
                        来源：{discoveredEndpoint}
                      </div>
                    </div>
                  )}
                </div>

                {(selectedModelAlias || addingModel) && (
                <div className="kimix-settings-card" style={{ marginTop: 14, padding: "14px 16px", background: "var(--surface-base)", border: "none" }}>
                  <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}>
                    <div>
                      <div className="text-[12.5px] font-semibold text-text-primary">{selectedModelAlias ? "编辑模型" : "添加模型"}</div>
                      <div className="kimix-settings-permission-desc">只保存模型自身信息，自动复用 {selectedGroup.provider.name} 的 API</div>
                    </div>
                    <KeyRound size={15} className="text-text-muted" />
                  </div>
                  <div className="kimix-model-provider-form" style={{ marginTop: 12 }}>
                    <label className="min-w-0">
                      <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>模型 ID</span>
                      <input
                        value={modelDraft.model}
                        onChange={(event) => {
                          const val = event.target.value;
                          setModelDraft((current) => {
                            const item = discoveredModels.find((m) => m.id === val.trim());
                            const prefill = prefillFromCatalog({
                              mode: "type",
                              modelId: val,
                              currentContextSize: "",
                              currentSupportEfforts: [],
                              catalogModel: matchCatalogModel(catalogModels, val),
                              probeContextLength: item?.contextLength,
                            });
                            // 手动编辑过的字段不参与自动预填——「用户清空」同样是明确意图，
                            // 不得被下一次按键重新填回。
                            return {
                              ...current,
                              model: val,
                              maxContextSize: modelContextTouchedRef.current
                                ? current.maxContextSize
                                : (prefill.maxContextSize != null ? String(prefill.maxContextSize) : current.maxContextSize),
                              supportEfforts: modelEffortsTouchedRef.current
                                ? current.supportEfforts
                                : (prefill.supportEfforts ?? current.supportEfforts),
                            };
                          });
                        }}
                        className="kimix-settings-input h-9 w-full text-[13px] outline-none"
                        style={{ marginTop: 6, paddingLeft: 12, paddingRight: 12 }}
                        placeholder="例如 gpt-5.1"
                      />
                    </label>
                    <label className="min-w-0">
                      <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>模型别名（可选）</span>
                      <input value={modelDraft.modelAlias} disabled={Boolean(selectedModelAlias)} onChange={(event) => setModelDraft((current) => ({ ...current, modelAlias: event.target.value }))} className="kimix-settings-input h-9 w-full text-[13px] outline-none" style={{ marginTop: 6, paddingLeft: 12, paddingRight: 12 }} placeholder={modelDraft.model.trim() ? `不填则自动为 ${modelDraft.model.trim()}` : `${selectedGroup.provider.name}/model-id`} />
                    </label>
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <div className="flex items-center justify-between" style={{ gap: 8 }}>
                      <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>思考档位（可选）</span>
                      <button
                        type="button"
                        onClick={() => void handleProbeEfforts()}
                        disabled={Boolean(busyAction)}
                        className="kimix-icon-text-button is-compact kimix-muted-action shrink-0 disabled:opacity-55"
                        title="从 models.dev 匹配该模型的最大上下文与思考档位声明"
                      >
                        <RefreshCw size={13} className={busyAction === "probe-effort" ? "kimix-spin" : ""} />
                        匹配模型信息
                      </button>
                    </div>
                    <div className="text-[11.5px] leading-5 text-text-muted" style={{ marginTop: 4 }}>
                      Context 与思考档位分别按 models.dev 声明回填；目录未声明的项目保持现值。不能仅凭供应商返回成功判断模型支持。
                    </div>
                    <div className="flex flex-wrap items-center" style={{ gap: 8, marginTop: 8 }}>
                      {THINKING_EFFORT_CHOICES.map((effort) => {
                        const selected = modelDraft.supportEfforts.includes(effort);
                        return (
                          <button
                            key={effort}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => handleToggleEffort(effort)}
                            className="kimix-state-button flex items-center justify-center rounded-lg text-[12px] leading-none"
                            style={{ height: 28, paddingLeft: 11, paddingRight: 11 }}
                          >
                            {effort}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center" style={{ gap: 8, marginTop: 10 }}>
                      <span className="text-[11.5px] text-text-muted">默认档</span>
                      <select
                        value={modelDraft.supportEfforts.includes(modelDraft.defaultEffort) ? modelDraft.defaultEffort : ""}
                        disabled={modelDraft.supportEfforts.length === 0}
                        onChange={(event) => setModelDraft((current) => ({ ...current, defaultEffort: event.target.value }))}
                        className="kimix-settings-input h-8 text-[12px] outline-none disabled:opacity-55"
                        style={{ paddingLeft: 10, paddingRight: 10 }}
                        aria-label="默认思考档位"
                      >
                        <option value="">不设置</option>
                        {modelDraft.supportEfforts.map((effort) => (
                          <option key={effort} value={effort}>{effort}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="kimix-model-editor-footer" style={{ gap: 12, marginTop: 12 }}>
                    <label className="min-w-0">
                      <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>Context</span>
                      <input type="number" min={1} max={10000000} value={modelDraft.maxContextSize} onChange={(event) => {
                        modelContextTouchedRef.current = true;
                        setModelDraft((current) => ({ ...current, maxContextSize: event.target.value }));
                      }} className="kimix-settings-input kimix-number-input h-9 w-full text-center text-[13px] outline-none" style={{ marginTop: 6, paddingLeft: 12, paddingRight: 12 }} />
                    </label>
                    <div className="text-[11.5px] leading-5 text-text-muted">同一供应商可添加任意数量模型；更新 Base URL 或 Key 后会统一生效。</div>
                    <button type="button" onClick={() => void handleSaveModel()} disabled={Boolean(busyAction)} className="kimix-icon-text-button is-compact bg-accent-primary text-white hover:bg-accent-primary-dark disabled:opacity-55">
                      <Check size={13} />
                      保存模型
                    </button>
                  </div>
                  {modelFormMessage && (
                    <div className="min-w-0 text-[12px] leading-5 text-text-muted" style={{ marginTop: 10, paddingLeft: 2, paddingRight: 2 }}>{modelFormMessage}</div>
                  )}
                </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
      {removalTarget && (
        <RemovalConfirmDialog
          target={removalTarget}
          busy={busyAction === "remove-model" || busyAction === "remove-provider"}
          onCancel={() => setRemovalTarget(null)}
          onConfirm={() => void handleConfirmRemoval()}
        />
      )}
    </div>
  );
}
