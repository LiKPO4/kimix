import { useEffect, useMemo, useState } from "react";
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
} from "@/utils/modelProviderConfig";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { thinkingEffortLabel } from "@/utils/thinkingEffort";

const NEW_PROVIDER_ID = "__new_provider__";
const DEFAULT_CONTEXT_SIZE = 262144;
const THINKING_EFFORT_CHOICES = ["off", "minimal", "low", "medium", "high", "max"];

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
        className="kimix-modal-card w-full max-w-[430px] rounded-[18px]"
        style={{ padding: "20px 22px" }}
      >
        <div id="model-provider-removal-title" className="text-[16px] font-semibold leading-6 text-text-primary">{title}</div>
        <div className="text-[13.5px] leading-6 text-text-secondary" style={{ marginTop: 12 }}>
          确认删除「{name}」？
        </div>
        <div className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-base text-[12.5px] leading-5 text-text-muted" style={{ marginTop: 14, padding: "10px 12px" }}>
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
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>({ providerName: "", baseUrl: "", apiKey: "" });
  const [modelDraft, setModelDraft] = useState<ModelDraft>(() => createModelDraft());
  const [catalog, setCatalog] = useState<KimiProviderCatalogEntrySummary[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredKimiProviderModel[]>([]);
  const [discoveredEndpoint, setDiscoveredEndpoint] = useState("");
  const [busyAction, setBusyAction] = useState<"provider" | "model" | "discover" | "test" | "default" | "remove-model" | "remove-provider" | "thinking" | null>(null);
  const [message, setMessage] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [removalTarget, setRemovalTarget] = useState<RemovalTarget | null>(null);

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
    setSelectedModelAlias((currentAlias) => {
      const nextModel = selectedGroup.models.find((model) => model.alias === currentAlias)
        ?? selectedGroup.models.find((model) => model.isDefault)
        ?? selectedGroup.models[0]
        ?? null;
      setModelDraft((currentDraft) => nextModel ? createModelDraft(nextModel) : (currentDraft.model ? currentDraft : createModelDraft()));
      return nextModel?.alias ?? "";
    });
  }, [isCreatingProvider, selectedGroup]);

  const applyConfigResult = async (next: KimiModelConfigSummary & { message?: string }, fallbackMessage: string) => {
    const savedMessage = next.message || fallbackMessage;
    const { message: _message, ...writtenConfig } = next;
    // 写入响应来自刚完成的持久化操作，必须先显示；SDK/Server 的 reload 可能短暂返回旧缓存。
    onConfigChange(writtenConfig, savedMessage);
    setMessage(savedMessage);
    const refreshed = await window.api.getKimiModelConfig().catch((error) => ({
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
    }));
    const refreshMatchesWrite = refreshed.success
      && modelConfigFingerprint(refreshed.data) === modelConfigFingerprint(next);
    const nextMessage = refreshed.success
      ? (refreshMatchesWrite ? savedMessage : `${savedMessage}；后台配置仍在同步`)
      : `${savedMessage}；即时刷新失败：${refreshed.error}`;
    setMessage(nextMessage);
    window.dispatchEvent(new CustomEvent("kimix:kimi-model-config-changed"));
  };

  const handleSelectProvider = (providerName: string) => {
    setSelectedProviderName(providerName);
    setSelectedModelAlias("");
    setModelDraft(createModelDraft());
    setDiscoveredModels([]);
    setDiscoveredEndpoint("");
    setMessage("");
  };

  const handleCreateProvider = () => {
    setSelectedProviderName(NEW_PROVIDER_ID);
    setSelectedModelAlias("");
    setProviderDraft({ providerName: "", baseUrl: "", apiKey: "" });
    setModelDraft(createModelDraft());
    setDiscoveredModels([]);
    setDiscoveredEndpoint("");
    setMessage("先保存供应商连接配置，再在下方添加一个或多个模型。");
  };

  const handleLoadCatalog = async () => {
    setCatalogLoading(true);
    setMessage("正在载入官方 Provider 目录...");
    try {
      const res = await window.api.listKimiProviderCatalog();
      if (!res.success) {
        setMessage(`目录载入失败：${res.error}`);
        return;
      }
      setCatalog(res.data.providers);
      setMessage(`已载入 ${res.data.providers.length} 个 OpenAI-compatible Provider。`);
    } catch (error) {
      setMessage(`目录载入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCatalogLoading(false);
    }
  };

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
    setModelDraft(createModelDraft());
  };

  const readContextSize = () => {
    const value = Number(modelDraft.maxContextSize.trim());
    return Number.isInteger(value) && value >= 1 && value <= 1048576 ? value : null;
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
      setDiscoveredModels(res.data.models);
      setDiscoveredEndpoint(res.data.endpoint);
      setMessage(`已从接口发现 ${res.data.models.length} 个模型，请直接选择。`);
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
    setSelectedModelAlias("");
    setModelDraft((current) => ({
      modelAlias: defaultModelAliasForProvider(providerDraft.providerName, modelId),
      model: modelId,
      maxContextSize: current.maxContextSize || String(DEFAULT_CONTEXT_SIZE),
      supportEfforts: current.supportEfforts,
      defaultEffort: current.defaultEffort,
    }));
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
    setModelDraft((current) => {
      const next = current.supportEfforts.includes(effort)
        ? current.supportEfforts.filter((item) => item !== effort)
        : [...current.supportEfforts, effort];
      const supportEfforts = THINKING_EFFORT_CHOICES.filter((item) => next.includes(item));
      const defaultEffort = supportEfforts.includes(current.defaultEffort) ? current.defaultEffort : "";
      return { ...current, supportEfforts, defaultEffort };
    });
  };

  const handleSaveModel = async () => {
    const contextSize = readContextSize();
    if (!selectedGroup || selectedProviderManaged) {
      setMessage("请先选择一个第三方 Provider。");
      return;
    }
    if (!modelDraft.modelAlias.trim() || !modelDraft.model.trim() || contextSize === null) {
      setMessage("请填写有效的模型别名、模型 ID 和 Context。");
      return;
    }
    setBusyAction("model");
    setMessage("正在保存模型...");
    try {
      const res = await window.api.saveKimiProviderModel({
        providerName: selectedGroup.provider.name,
        modelAlias: modelDraft.modelAlias.trim(),
        model: modelDraft.model.trim(),
        maxContextSize: contextSize,
        supportEfforts: modelDraft.supportEfforts,
        defaultEffort: modelDraft.supportEfforts.includes(modelDraft.defaultEffort) ? modelDraft.defaultEffort : null,
      });
      if (!res.success) {
        setMessage(`模型保存失败：${res.error}`);
        return;
      }
      setSelectedModelAlias(modelDraft.modelAlias.trim());
      await applyConfigResult(res.data, "已保存 Provider 模型");
    } catch (error) {
      setMessage(`模型保存失败：${error instanceof Error ? error.message : String(error)}`);
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
        setSelectedModelAlias("");
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
    setModelDraft(createModelDraft(model));
  };

  const handleAddModel = () => {
    setSelectedModelAlias("");
    setModelDraft(createModelDraft());
    setMessage("填写模型 ID、别名和 Context 后保存；Provider 的连接信息会自动复用。");
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
                  className="absolute right-1 top-1 flex h-7 w-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover"
                  aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                >
                  {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </label>

            {isCreatingProvider && (
              <div className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-base" style={{ marginTop: 14, padding: "12px 14px" }}>
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
                    {model.isDefault ? (
                      <span className="rounded-full bg-accent-primary text-[11px] leading-5 text-white" style={{ paddingLeft: 9, paddingRight: 9 }}>使用中</span>
                    ) : (
                      <button type="button" onClick={(event) => { event.stopPropagation(); void handleSetDefault(model.alias); }} disabled={Boolean(busyAction)} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover">
                        <Check size={13} />
                        使用
                      </button>
                    )}
                    {!selectedProviderManaged && (
                      <button type="button" onClick={(event) => { event.stopPropagation(); void handleRemoveModel(model); }} disabled={Boolean(busyAction)} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-accent-danger-light hover:text-accent-danger" aria-label={`删除 ${model.displayName || model.alias}`}>
                        <Trash2 size={13} />
                      </button>
                    )}
                    <ChevronRight size={14} className="text-text-muted" />
                  </div>
                </div>
              ))}
              {selectedGroup.models.length === 0 && (
                <div className="rounded-xl border border-dashed border-[var(--kimix-panel-border-soft)] text-[12px] leading-5 text-text-muted" style={{ padding: "16px 18px" }}>
                  此供应商还没有模型。连接配置只需保存一次，之后可以连续添加多个模型。
                </div>
              )}
            </div>

            {selectedProviderManaged && message && (
              <div className="text-[12px] leading-5 text-text-muted" style={{ marginTop: 12, paddingLeft: 2, paddingRight: 2 }}>{message}</div>
            )}

            {!selectedProviderManaged && (
              <div style={{ marginTop: 14 }}>
                <div className="rounded-sm-token border border-[var(--kimix-panel-border-soft)] bg-surface-base" style={{ padding: "12px 14px" }}>
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

                <div className="kimix-settings-card" style={{ marginTop: 14, padding: "14px 16px", background: "var(--surface-base)" }}>
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
                      <input value={modelDraft.model} onChange={(event) => setModelDraft((current) => ({ ...current, model: event.target.value }))} className="kimix-settings-input h-9 w-full text-[13px] outline-none" style={{ marginTop: 6, paddingLeft: 12, paddingRight: 12 }} placeholder="例如 gpt-5.1" />
                    </label>
                    <label className="min-w-0">
                      <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>模型别名</span>
                      <input value={modelDraft.modelAlias} disabled={Boolean(selectedModelAlias)} onChange={(event) => setModelDraft((current) => ({ ...current, modelAlias: event.target.value }))} className="kimix-settings-input h-9 w-full text-[13px] outline-none" style={{ marginTop: 6, paddingLeft: 12, paddingRight: 12 }} placeholder={`${selectedGroup.provider.name}/model-id`} />
                    </label>
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>思考档位（可选）</span>
                    <div className="text-[11.5px] leading-5 text-text-muted" style={{ marginTop: 4 }}>
                      声明后输入区可按档位切换；不声明则仅 关闭/开启。档位会原样传给供应商，需与上游实际能力一致。
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
                            className={`flex items-center justify-center rounded-lg border border-[var(--kimix-panel-border-soft)] text-[12px] leading-none ${selected ? "bg-surface-hover text-accent-primary" : "text-text-muted hover:bg-surface-hover"}`}
                            style={{ height: 28, paddingLeft: 11, paddingRight: 11 }}
                          >
                            {thinkingEffortLabel(effort)}
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
                          <option key={effort} value={effort}>{thinkingEffortLabel(effort)}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="kimix-model-editor-footer" style={{ gap: 12, marginTop: 12 }}>
                    <label className="min-w-0">
                      <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>Context</span>
                      <input type="number" min={1} max={1048576} value={modelDraft.maxContextSize} onChange={(event) => setModelDraft((current) => ({ ...current, maxContextSize: event.target.value }))} className="kimix-settings-input kimix-number-input h-9 w-full text-center text-[13px] outline-none" style={{ marginTop: 6, paddingLeft: 12, paddingRight: 12 }} />
                    </label>
                    <div className="text-[11.5px] leading-5 text-text-muted">同一供应商可添加任意数量模型；更新 Base URL 或 Key 后会统一生效。</div>
                    <button type="button" onClick={() => void handleSaveModel()} disabled={Boolean(busyAction)} className="kimix-icon-text-button is-compact bg-accent-primary text-white hover:bg-accent-primary-dark disabled:opacity-55">
                      <Check size={13} />
                      保存模型
                    </button>
                  </div>
                </div>
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
