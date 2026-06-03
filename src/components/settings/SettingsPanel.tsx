import { useEffect, useMemo, useRef, useState } from "react";
import { X, Sun, Moon, Monitor, Shield, Zap, GitBranch, Terminal, AlertCircle, RefreshCw, MessageSquare, Bell, Mic, Keyboard, Archive, RotateCcw, Trash2, Check, Settings, LogIn, LogOut, ShieldCheck, ShieldX, ChevronDown, ChevronUp } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Theme, PermissionMode, NotificationMode } from "@/types/ui";

type FreezeReport = {
  at: string;
  lagMs: number;
  sessionId: string | null;
  runningSessionId: string | null;
};

type ArchivedSessionSummary = {
  id: string;
  title: string;
  projectPath: string;
  archivedAt: number;
};

const FREEZE_REPORTS_KEY = "kimix_freeze_reports";
const MAX_FREEZE_REPORTS_RAW_LENGTH = 64 * 1024;
const KIMI_AUTH_CHANGED_EVENT = "kimix:kimi-auth-changed";
const KIMI_MODEL_CONFIG_CHANGED_EVENT = "kimix:kimi-model-config-changed";

type KimiAuthStatus = {
  available: boolean;
  path?: string;
  loggedIn: boolean;
  configPath: string;
  mcpConfigPath: string;
  defaultModel: string | null;
  defaultThinking: boolean;
  message: string;
};

type KimiModelConfigSummary = {
  configPath: string;
  exists: boolean;
  defaultModel: string | null;
  providers: {
    name: string;
    type: string | null;
    baseUrl: string | null;
    hasApiKey: boolean;
    hasOauth: boolean;
  }[];
  models: {
    alias: string;
    provider: string | null;
    model: string | null;
    displayName: string | null;
    maxContextSize: number | null;
    adaptiveThinking: boolean | null;
    isDefault: boolean;
  }[];
};

type KimiProviderCatalogEntry = {
  providerId: string;
  type: string;
  baseUrl: string | null;
  modelCount: number;
  models: {
    id: string;
    name: string | null;
    maxContextSize: number | null;
    thinking: boolean;
    toolUse: boolean;
  }[];
};

function parseFreezeReports() {
  const raw = localStorage.getItem(FREEZE_REPORTS_KEY);
  if (!raw) return [];
  if (raw.length > MAX_FREEZE_REPORTS_RAW_LENGTH) {
    localStorage.removeItem(FREEZE_REPORTS_KEY);
    return [];
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is FreezeReport => (
    item &&
    typeof item === "object" &&
    typeof item.at === "string" &&
    typeof item.lagMs === "number" &&
    ("sessionId" in item) &&
    ("runningSessionId" in item)
  ));
}

function formatFreezeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function SelectionIndicator({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`kimix-selection-indicator flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors ${selected ? "is-selected" : ""} ${
        selected
          ? "border-accent-primary bg-accent-primary text-text-inverse"
          : "text-transparent"
      }`}
    >
      {selected ? <Check size={11} strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-transparent" />}
    </span>
  );
}

export function SettingsPanel({ variant = "modal", onBackToChat }: { variant?: "modal" | "workspace"; onBackToChat?: () => void }) {
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const detailedContext = useAppStore((s) => s.detailedContext);
  const setDetailedContext = useAppStore((s) => s.setDetailedContext);
  const statusUpdateDisplay = useAppStore((s) => s.statusUpdateDisplay);
  const setStatusUpdateDisplay = useAppStore((s) => s.setStatusUpdateDisplay);
  const sessionRecommendationEnabled = useAppStore((s) => s.sessionRecommendationEnabled);
  const setSessionRecommendationEnabled = useAppStore((s) => s.setSessionRecommendationEnabled);
  const sessionRecommendationTurnLimit = useAppStore((s) => s.sessionRecommendationTurnLimit);
  const setSessionRecommendationTurnLimit = useAppStore((s) => s.setSessionRecommendationTurnLimit);
  const voiceShortcut = useAppStore((s) => s.voiceShortcut);
  const setVoiceShortcut = useAppStore((s) => s.setVoiceShortcut);
  const notificationMode = useAppStore((s) => s.notificationMode);
  const setNotificationMode = useAppStore((s) => s.setNotificationMode);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const archivedSessionsDigest = useSessionStore((s) => s.sessions
    .filter((session) => session.archivedAt)
    .map((session) => JSON.stringify({
      id: session.id,
      title: session.title,
      projectPath: session.projectPath,
      archivedAt: session.archivedAt ?? 0,
    }))
    .join("\n")
  );
  const archivedSessionSummaries = useMemo(() => {
    if (!archivedSessionsDigest) return [];
    return archivedSessionsDigest
      .split("\n")
      .filter(Boolean)
      .map((line): ArchivedSessionSummary | null => {
        try {
          const parsed = JSON.parse(line) as ArchivedSessionSummary;
          return parsed && typeof parsed.id === "string" ? parsed : null;
        } catch {
          return null;
        }
      })
      .filter((session): session is ArchivedSessionSummary => Boolean(session));
  }, [archivedSessionsDigest]);
  const restoreSession = useSessionStore((s) => s.restoreSession);
  const [freezeReports, setFreezeReports] = useState<FreezeReport[]>([]);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [freezeExpanded, setFreezeExpanded] = useState(false);
  const [auth, setAuth] = useState<KimiAuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authBusyAction, setAuthBusyAction] = useState<"login" | "logout" | null>(null);
  const [modelConfig, setModelConfig] = useState<KimiModelConfigSummary | null>(null);
  const [modelConfigLoading, setModelConfigLoading] = useState(true);
  const [modelConfigMessage, setModelConfigMessage] = useState("");
  const [providerDraft, setProviderDraft] = useState({
    providerName: "deepseek",
    modelAlias: "deepseek/deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com",
    apiKey: "",
    model: "deepseek-v4-flash",
    maxContextSize: "1000000",
  });
  const [providerBusyAction, setProviderBusyAction] = useState<"test" | "save" | "default" | null>(null);
  const [adaptiveThinkingBusyAlias, setAdaptiveThinkingBusyAlias] = useState<string | null>(null);
  const [providerMessage, setProviderMessage] = useState("");
  const [providerCatalog, setProviderCatalog] = useState<KimiProviderCatalogEntry[]>([]);
  const [providerCatalogLoading, setProviderCatalogLoading] = useState(false);
  const [selectedCatalogProviderId, setSelectedCatalogProviderId] = useState("");
  const [selectedCatalogModelId, setSelectedCatalogModelId] = useState("");
  const [selectedModelAlias, setSelectedModelAlias] = useState("");
  const modelSettingsRef = useRef<HTMLDivElement>(null);
  const [connection, setConnection] = useState<{
    loading: boolean;
    available: boolean | null;
    verified: boolean;
    message: string;
    path?: string;
    output?: string;
  }>({ loading: true, available: null, verified: false, message: "正在查找 Kimi Code" });

  const checkConnection = async (verify = false) => {
    setConnection((current) => ({
      ...current,
      loading: true,
      message: verify ? "正在检查 Kimi Code 响应" : "正在查找 Kimi Code",
    }));
    const res = await window.api.checkKimiCli({ verify });
    if (res.success) {
      setConnection({
        loading: false,
        available: res.data.available,
        verified: res.data.verified,
        message: res.data.message,
        path: res.data.path,
        output: res.data.output,
      });
      return;
    }
    setConnection({ loading: false, available: false, verified: false, message: res.error });
  };

  const refreshAuth = async () => {
    setAuthLoading(true);
    const res = await window.api.getKimiAuthStatus();
    setAuthLoading(false);
    if (res.success) {
      setAuth(res.data);
      return;
    }
    setAuth({
      available: false,
      loggedIn: false,
      configPath: "",
      mcpConfigPath: "",
      defaultModel: null,
      defaultThinking: false,
      message: `读取登录状态失败：${res.error}`,
    });
  };

  const refreshModelConfig = async () => {
    setModelConfigLoading(true);
    const res = await window.api.getKimiModelConfig();
    setModelConfigLoading(false);
    if (res.success) {
      setModelConfig(res.data);
      setModelConfigMessage(res.data.exists ? "" : "尚未找到 Kimi Code config.toml。");
      return;
    }
    setModelConfig(null);
    setModelConfigMessage(`读取模型配置失败：${res.error}`);
  };

  const buildProviderPayload = () => {
    const contextText = providerDraft.maxContextSize.trim();
    const contextSize = Number(contextText);
    if (!contextText || !Number.isInteger(contextSize) || contextSize < 1 || contextSize > 1048576) {
      return null;
    }
    return {
      providerName: providerDraft.providerName.trim(),
      modelAlias: providerDraft.modelAlias.trim(),
      baseUrl: providerDraft.baseUrl.trim(),
      apiKey: providerDraft.apiKey.trim() || undefined,
      model: providerDraft.model.trim(),
      maxContextSize: contextSize,
    };
  };

  const handleSelectModel = (model: KimiModelConfigSummary["models"][number]) => {
    setSelectedModelAlias(model.alias);
    const provider = modelConfig?.providers.find((item) => item.name === model.provider);
    setProviderDraft((current) => ({
      ...current,
      providerName: provider?.name ?? model.provider ?? current.providerName,
      modelAlias: model.alias,
      baseUrl: provider?.baseUrl ?? current.baseUrl,
      model: model.model ?? model.alias,
      maxContextSize: String(model.maxContextSize ?? current.maxContextSize),
    }));
    setProviderMessage(model.isDefault ? "当前已是默认模型，可新建会话测试。" : "已选中模型；点击设为默认后，新会话会使用它。");
  };

  const fillProviderDraftFromCatalog = (provider: KimiProviderCatalogEntry, model: KimiProviderCatalogEntry["models"][number]) => {
    setProviderDraft((current) => ({
      ...current,
      providerName: provider.providerId,
      modelAlias: `${provider.providerId}/${model.id}`,
      baseUrl: provider.baseUrl ?? current.baseUrl,
      model: model.id,
      maxContextSize: String(model.maxContextSize ?? 262144),
    }));
    setProviderMessage(`已从官方 catalog 填入 ${provider.providerId}/${model.id}，请补 API Key 后测试或保存。`);
  };

  const handleLoadProviderCatalog = async () => {
    if (typeof window.api.listKimiProviderCatalog !== "function") {
      setProviderMessage("Provider catalog 接口尚未载入，请完全关闭 Kimix dev 窗口后重新启动。");
      return;
    }
    setProviderCatalogLoading(true);
    setProviderMessage("正在读取官方 Provider catalog...");
    const res = await window.api.listKimiProviderCatalog();
    setProviderCatalogLoading(false);
    if (!res.success) {
      setProviderMessage(`读取 Provider catalog 失败：${res.error}`);
      return;
    }
    setProviderCatalog(res.data.providers);
    const firstProvider = res.data.providers[0];
    const firstModel = firstProvider?.models[0];
    if (firstProvider && firstModel) {
      setSelectedCatalogProviderId(firstProvider.providerId);
      setSelectedCatalogModelId(firstModel.id);
      fillProviderDraftFromCatalog(firstProvider, firstModel);
      return;
    }
    setSelectedCatalogProviderId("");
    setSelectedCatalogModelId("");
    setProviderMessage("官方 catalog 暂无可直接填入的 OpenAI-compatible Provider。");
  };

  const handleSelectCatalogProvider = (providerId: string) => {
    const provider = providerCatalog.find((item) => item.providerId === providerId);
    setSelectedCatalogProviderId(providerId);
    const model = provider?.models[0];
    setSelectedCatalogModelId(model?.id ?? "");
    if (provider && model) fillProviderDraftFromCatalog(provider, model);
  };

  const handleSelectCatalogModel = (modelId: string) => {
    const provider = providerCatalog.find((item) => item.providerId === selectedCatalogProviderId);
    const model = provider?.models.find((item) => item.id === modelId);
    setSelectedCatalogModelId(modelId);
    if (provider && model) fillProviderDraftFromCatalog(provider, model);
  };

  const handleSetDefaultModel = async (modelAlias = selectedModelAlias || providerDraft.modelAlias.trim()) => {
    const alias = modelAlias.trim();
    if (!alias) {
      setProviderMessage("请先选中一个模型。");
      return;
    }
    if (typeof window.api.setKimiDefaultModel !== "function") {
      setProviderMessage("默认模型接口尚未载入，请完全关闭 Kimix dev 窗口后重新启动。");
      return;
    }
    setProviderBusyAction("default");
    setProviderMessage("正在设为默认模型...");
    const res = await window.api.setKimiDefaultModel({ modelAlias: alias });
    setProviderBusyAction(null);
    if (res.success) {
      setModelConfig(res.data);
      setSelectedModelAlias(alias);
      setProviderDraft((current) => ({ ...current, modelAlias: alias }));
      setProviderMessage(res.data.message);
      window.dispatchEvent(new CustomEvent(KIMI_MODEL_CONFIG_CHANGED_EVENT));
      return;
    }
    setProviderMessage(`设为默认失败：${res.error}`);
  };

  const handleToggleAdaptiveThinking = async (model: KimiModelConfigSummary["models"][number]) => {
    if (typeof window.api.setKimiModelAdaptiveThinking !== "function") {
      setProviderMessage("自适应思考接口尚未载入，请完全关闭 Kimix dev 窗口后重新启动。");
      return;
    }
    const next = !Boolean(model.adaptiveThinking);
    setAdaptiveThinkingBusyAlias(model.alias);
    setProviderMessage(`正在${next ? "开启" : "关闭"}自适应思考...`);
    const res = await window.api.setKimiModelAdaptiveThinking({
      modelAlias: model.alias,
      adaptiveThinking: next,
    });
    setAdaptiveThinkingBusyAlias(null);
    if (res.success) {
      setModelConfig(res.data);
      setSelectedModelAlias(model.alias);
      setProviderMessage(`${res.data.message}：${model.alias} ${next ? "开启" : "关闭"}`);
      window.dispatchEvent(new CustomEvent(KIMI_MODEL_CONFIG_CHANGED_EVENT));
      return;
    }
    setProviderMessage(`更新自适应思考失败：${res.error}`);
  };

  const handleTestProvider = async () => {
    const payload = buildProviderPayload();
    if (!payload) {
      setProviderMessage("上下文大小填写错误，无法测试。");
      return;
    }
    setProviderBusyAction("test");
    setProviderMessage("正在测试连接...");
    const res = await window.api.testKimiOpenAiProvider(payload);
    setProviderBusyAction(null);
    setProviderMessage(res.success ? `测试通过：${res.data.output || res.data.message}` : `测试失败：${res.error}`);
  };

  const handleSaveProvider = async () => {
    const payload = buildProviderPayload();
    if (!payload) {
      setProviderMessage("上下文大小填写错误，无法保存。");
      return;
    }
    setProviderBusyAction("save");
    setProviderMessage("正在保存配置...");
    const res = await window.api.saveKimiOpenAiProvider(payload);
    setProviderBusyAction(null);
    if (res.success) {
      setModelConfig(res.data);
      setModelConfigMessage("");
      setProviderMessage(res.data.message);
      window.dispatchEvent(new CustomEvent(KIMI_MODEL_CONFIG_CHANGED_EVENT));
      return;
    }
    setProviderMessage(`保存失败：${res.error}`);
  };

  const handleLogin = async () => {
    setAuthBusyAction("login");
    try {
      const res = await window.api.loginKimi();
      if (res.success) {
        setAuth(res.data);
        window.dispatchEvent(new CustomEvent(KIMI_AUTH_CHANGED_EVENT));
        return;
      }
      setAuth((current) => ({
        available: current?.available ?? false,
        loggedIn: current?.loggedIn ?? false,
        path: current?.path,
        configPath: current?.configPath ?? "",
        mcpConfigPath: current?.mcpConfigPath ?? "",
        defaultModel: current?.defaultModel ?? null,
        defaultThinking: current?.defaultThinking ?? false,
        message: `登录失败：${res.error}`,
      }));
    } catch (err) {
      setAuth((current) => ({
        available: current?.available ?? false,
        loggedIn: current?.loggedIn ?? false,
        path: current?.path,
        configPath: current?.configPath ?? "",
        mcpConfigPath: current?.mcpConfigPath ?? "",
        defaultModel: current?.defaultModel ?? null,
        defaultThinking: current?.defaultThinking ?? false,
        message: `登录失败：${err instanceof Error ? err.message : String(err)}`,
      }));
    } finally {
      setAuthBusyAction(null);
    }
  };

  const handleLogout = async () => {
    setAuthBusyAction("logout");
    const res = await window.api.logoutKimi();
    setAuthBusyAction(null);
    if (res.success) {
      setAuth(res.data);
      window.dispatchEvent(new CustomEvent(KIMI_AUTH_CHANGED_EVENT));
      return;
    }
    setAuth((current) => ({
      available: current?.available ?? false,
      loggedIn: current?.loggedIn ?? false,
      path: current?.path,
      configPath: current?.configPath ?? "",
      mcpConfigPath: current?.mcpConfigPath ?? "",
      defaultModel: current?.defaultModel ?? null,
      defaultThinking: current?.defaultThinking ?? false,
      message: `退出失败：${res.error}`,
    }));
  };

  const loadFreezeReports = () => {
    try {
      const reports = parseFreezeReports();
      setFreezeReports(reports.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 20));
    } catch {
      localStorage.removeItem(FREEZE_REPORTS_KEY);
      setFreezeReports([]);
    }
  };

  const clearFreezeReports = () => {
    localStorage.removeItem(FREEZE_REPORTS_KEY);
    setFreezeReports([]);
  };

  useEffect(() => {
    if (settingsOpen || variant === "workspace") {
      void checkConnection(false);
      void refreshAuth();
      void refreshModelConfig();
      loadFreezeReports();
    }
  }, [settingsOpen, variant]);

  useEffect(() => {
    const handleAuthChanged = () => {
      if (settingsOpen || variant === "workspace") {
        void refreshAuth();
        void refreshModelConfig();
      }
    };
    window.addEventListener(KIMI_AUTH_CHANGED_EVENT, handleAuthChanged);
    return () => window.removeEventListener(KIMI_AUTH_CHANGED_EVENT, handleAuthChanged);
  }, [settingsOpen, variant]);

  useEffect(() => {
    const handleFocusModelSettings = () => {
      window.setTimeout(() => {
        modelSettingsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    };
    window.addEventListener("kimix:focus-model-settings", handleFocusModelSettings);
    return () => window.removeEventListener("kimix:focus-model-settings", handleFocusModelSettings);
  }, []);

  if (!settingsOpen && variant === "modal") return null;

  const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "浅色", icon: Sun },
    { value: "dark", label: "深色", icon: Moon },
    { value: "system", label: "跟随系统", icon: Monitor },
  ];

  const permissions: { value: PermissionMode; label: string; desc: string; icon: typeof Shield; tooltip: string }[] = [
    { value: "manual", label: "手动审批", desc: "每次工具调用都需要确认", icon: Shield, tooltip: "手动审批：每次工具调用都会停下来等你确认，适合高风险修改。" },
    { value: "auto", label: "自动权限", desc: "自动处理审批，不再向用户提问", icon: Zap, tooltip: "自动权限：使用官方 auto 权限模式，自动处理工具审批，且 Agent 不再向用户提问。" },
    { value: "yolo", label: "完全访问", desc: "自动批准所有工具请求（谨慎使用）", icon: GitBranch, tooltip: "完全访问：自动批准所有工具请求，适合可信任务，请谨慎开启。" },
  ];
  const notificationModes: { value: NotificationMode; label: string; desc: string }[] = [
    { value: "never", label: "永不弹出", desc: "不显示系统通知，也不显示任务栏红点" },
    { value: "unfocused", label: "无焦点时", desc: "仅 Kimix 窗口没有焦点时提醒" },
    { value: "always", label: "任何时候", desc: "每轮完成都弹出系统通知；红点仍只在无焦点时显示" },
  ];
  const archivedSessions = [...archivedSessionSummaries]
    .sort((a, b) => b.archivedAt - a.archivedAt);
  const visibleArchivedSessions = archivedExpanded ? archivedSessions : archivedSessions.slice(0, 8);
  const hiddenArchivedCount = Math.max(0, archivedSessions.length - 8);
  const visibleFreezeReports = freezeExpanded ? freezeReports : freezeReports.slice(0, 8);
  const hiddenFreezeCount = Math.max(0, freezeReports.length - 8);

  const handleRestoreSession = (sessionId: string) => {
    restoreSession(sessionId);
    const restored = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
    if (restored) setCurrentSession({ ...restored, archivedAt: undefined });
  };

  const content = (
      <div className={variant === "workspace" ? "kimix-settings-panel is-workspace" : "kimix-settings-panel"} onClick={(e) => e.stopPropagation()}>
        <div className="kimix-settings-header">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2.5 text-[20px] font-semibold leading-7 text-[var(--kimix-panel-text)]">
              {variant === "workspace" && <Settings size={20} className="shrink-0" />}
              <h2 id="settings-title" className="kimix-settings-title">设置</h2>
            </div>
          </div>
          <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
            {onBackToChat && variant === "workspace" && (
              <button
                type="button"
                onClick={onBackToChat}
                className="kimix-icon-text-button kimix-muted-action is-compact"
                style={{ marginLeft: 4 }}
              >
                返回对话
              </button>
            )}
            {variant === "modal" && (
              <button onClick={() => setSettingsOpen(false)} className="kimix-settings-icon-button" aria-label="关闭设置">
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        <div className="kimix-settings-body">
          <div className={`kimix-settings-columns ${variant === 'workspace' ? 'is-workspace' : ''}`}>
            <div className="kimix-settings-col">
              <div className="kimix-settings-section">
                <div className="kimix-settings-section-title">
                  <Sun size={16} className="text-text-muted" />
                  <span>主题</span>
                </div>
                <div className="kimix-settings-theme-grid">
                  {themes.map((t) => (
                    <button key={t.value} onClick={() => setTheme(t.value)} className={`kimix-settings-theme ${theme === t.value ? "is-active" : ""}`}>
                      <t.icon size={18} />
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="kimix-settings-section">
                <div className="kimix-settings-section-title">
                  <Shield size={16} className="text-text-muted" />
                  <span>权限模式</span>
                </div>
                <div className="kimix-settings-permissions">
                  {permissions.map((p) => (
                    <button key={p.value} title={p.tooltip} onClick={() => setPermissionMode(p.value)} className={`kimix-settings-permission ${permissionMode === p.value ? "is-active" : ""}`}>
                      <SelectionIndicator selected={permissionMode === p.value} />
                      <p.icon size={18} className={`mt-0.5 shrink-0 ${permissionMode === p.value ? "text-accent-primary" : "text-text-muted"}`} />
                      <div className="kimix-settings-permission-copy">
                        <div className="kimix-settings-permission-label">{p.label}</div>
                        <div className="kimix-settings-permission-desc">{p.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="kimix-settings-section">
                <div className="kimix-settings-section-title">
                  <MessageSquare size={16} className="text-text-muted" />
                  <span>消息信息</span>
                </div>
                <div className="kimix-settings-permissions">
                  <button onClick={() => setStatusUpdateDisplay("turn_end")} className={`kimix-settings-permission ${statusUpdateDisplay === "turn_end" ? "is-active" : ""}`}>
                    <SelectionIndicator selected={statusUpdateDisplay === "turn_end"} />
                    <div className="kimix-settings-permission-copy">
                      <div className="kimix-settings-permission-label">每轮末尾显示一次</div>
                      <div className="kimix-settings-permission-desc">默认选项，只保留本轮最后一条 Tokens 和 Context 信息</div>
                    </div>
                  </button>
                  <button onClick={() => setStatusUpdateDisplay("each")} className={`kimix-settings-permission ${statusUpdateDisplay === "each" ? "is-active" : ""}`}>
                    <SelectionIndicator selected={statusUpdateDisplay === "each"} />
                    <div className="kimix-settings-permission-copy">
                      <div className="kimix-settings-permission-label">实时显示每条消息信息</div>
                      <div className="kimix-settings-permission-desc">适合调试上下文增长，会在对话中多次显示状态胶囊</div>
                    </div>
                  </button>
                  <button onClick={() => setStatusUpdateDisplay("never")} className={`kimix-settings-permission ${statusUpdateDisplay === "never" ? "is-active" : ""}`}>
                    <SelectionIndicator selected={statusUpdateDisplay === "never"} />
                    <div className="kimix-settings-permission-copy">
                      <div className="kimix-settings-permission-label">永不显示</div>
                      <div className="kimix-settings-permission-desc">对话中完全隐藏 Tokens 和 Context 信息</div>
                    </div>
                  </button>
                </div>
              </div>

              <div className="kimix-settings-section">
                <div className="kimix-settings-section-title">
                  <MessageSquare size={16} className="text-text-muted" />
                  <span>新对话建议</span>
                </div>
                <div className={`kimix-settings-card ${sessionRecommendationEnabled ? "is-active" : ""}`} style={{ padding: "18px 16px" }}>
                  <button
                    type="button"
                    onClick={() => setSessionRecommendationEnabled(!sessionRecommendationEnabled)}
                    className="flex w-full items-center text-left"
                    style={{ gap: 12 }}
                  >
                    <SelectionIndicator selected={sessionRecommendationEnabled} />
                    <div className="min-w-0 flex-1">
                      <div className="kimix-settings-permission-label">达到推荐轮数后提示开启新对话</div>
                      <div className="kimix-settings-permission-desc">默认用于减少长会话里旧上下文和无用信息的干扰。</div>
                    </div>
                  </button>
                  <div className="grid min-w-0 items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) 96px", gap: 14, marginTop: 18, minHeight: 42 }}>
                    <label htmlFor="session-turn-limit" className="min-w-0 text-[14px] leading-5 text-[var(--kimix-panel-text-secondary)]">推荐轮数上限</label>
                    <input
                      id="session-turn-limit"
                      type="number"
                      min={1}
                      max={200}
                      value={sessionRecommendationTurnLimit}
                      disabled={!sessionRecommendationEnabled}
                      onChange={(event) => setSessionRecommendationTurnLimit(Number(event.target.value || 1))}
                      className="kimix-settings-input kimix-number-input h-9 w-full rounded-lg text-center text-[14px] outline-none transition-colors"
                    />
                  </div>
                </div>
              </div>

              <div className="kimix-settings-section">
                <div className="kimix-settings-row-title">
                  <div className="kimix-settings-section-title">
                    <Archive size={16} className="text-text-muted" />
                    <span>归档对话</span>
                  </div>
                  <span className="kimix-settings-badge text-[12.5px] leading-5" style={{ paddingLeft: 10, paddingRight: 10 }}>
                    {archivedSessions.length}
                  </span>
                </div>
                <div className="kimix-settings-card" style={{ padding: "18px 16px" }}>
                  {archivedSessions.length > 0 ? (
                    <div className="flex flex-col" style={{ gap: 10 }}>
                      {visibleArchivedSessions.map((session) => (
                        <div key={session.id} className="kimix-settings-list-item flex min-w-0 items-center" style={{ gap: 10, padding: "11px 11px" }}>
                          <MessageSquare size={15} className="shrink-0 text-text-muted" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[14px] font-medium leading-5 text-[var(--kimix-panel-text)]">{session.title}</div>
                            <div className="mt-0.5 truncate text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]">{session.projectPath}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRestoreSession(session.id)}
                            className="kimix-icon-text-button is-compact shrink-0 text-text-secondary hover:bg-surface-hover"
                          >
                            <RotateCcw size={13} />
                            恢复
                          </button>
                        </div>
                      ))}
                      {hiddenArchivedCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setArchivedExpanded((current) => !current)}
                          className="kimix-icon-text-button kimix-muted-action is-compact self-start"
                          style={{ marginTop: 2 }}
                        >
                          {archivedExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          <span>{archivedExpanded ? `折叠剩余 ${hiddenArchivedCount} 个归档对话` : `展开剩余 ${hiddenArchivedCount} 个归档对话`}</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-[13.5px] leading-6 text-[var(--kimix-panel-text-secondary)]">暂无归档对话。</div>
                  )}
                </div>
              </div>
            </div>

            <div className="kimix-settings-col">
              <div className="kimix-settings-section">
                <div className="kimix-settings-row-title">
                  <div className="kimix-settings-section-title">
                    <Terminal size={16} className="text-text-muted" />
                    <span>连接情况</span>
                  </div>
                  <button onClick={() => void checkConnection(Boolean(connection.path))} disabled={connection.loading} className="kimix-settings-check-button" title={connection.path ? "检查 Kimi Code 响应" : "查找 Kimi Code"}>
                    <RefreshCw size={15} className={connection.loading ? "kimix-spin" : ""} />
                    <span>检查</span>
                  </button>
                </div>
                <div className={`kimix-settings-connection ${connection.verified ? "is-verified" : connection.available ? "is-found" : "is-missing"}`}>
                  <div className="kimix-settings-connection-inner">
                    {connection.loading ? (
                      <RefreshCw size={18} className="kimix-spin mt-0.5 shrink-0 text-text-muted" />
                    ) : connection.verified ? (
                      <SelectionIndicator selected />
                    ) : connection.available ? (
                      <SelectionIndicator selected />
                    ) : (
                      <AlertCircle size={18} className="mt-0.5 shrink-0 text-accent-warning" />
                    )}
                    <div className="kimix-settings-connection-copy">
                      <div className="kimix-settings-connection-label">
                        {connection.loading ? "检测中" : connection.verified ? "Kimi Code 连接正常" : connection.available ? "已找到 Kimi Code" : "Kimi Code 未连接"}
                      </div>
                      <div className="kimix-settings-connection-detail">{connection.output ?? connection.path ?? connection.message}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="kimix-settings-section">
                <div className="kimix-settings-row-title">
                  <div className="kimix-settings-section-title">
                    {auth?.loggedIn ? <ShieldCheck size={16} className="text-accent-success" /> : <ShieldX size={16} className="text-text-muted" />}
                    <span>Kimi 登录</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshAuth()}
                    disabled={authLoading || Boolean(authBusyAction)}
                    className="kimix-settings-check-button"
                  >
                    <RefreshCw size={15} className={authLoading ? "kimix-spin" : ""} />
                    <span>刷新</span>
                  </button>
                </div>
                <div className="kimix-settings-card" style={{ padding: "18px 16px" }}>
                  <div className="flex items-start" style={{ gap: 12 }}>
                    {authLoading ? (
                      <RefreshCw size={18} className="kimix-spin mt-0.5 shrink-0 text-text-muted" />
                    ) : auth?.loggedIn ? (
                      <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent-success" />
                    ) : (
                      <ShieldX size={18} className="mt-0.5 shrink-0 text-accent-danger" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-[14.5px] font-medium text-[var(--kimix-panel-text)]">
                        {authLoading ? "正在读取登录状态" : auth?.loggedIn ? "Kimi Code 已登录" : "Kimi Code 未登录"}
                      </div>
                      <div className="mt-1 text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                        {auth?.message ?? "登录状态会影响对话、MCP OAuth 授权和 Kimi Code 调用。"}
                      </div>
                      {auth?.path && (
                        <div className="mt-2 break-all text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">{auth.path}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap" style={{ gap: 8, marginTop: 14 }}>
                    {auth?.loggedIn ? (
                      <button
                        type="button"
                        onClick={() => void handleLogout()}
                        disabled={Boolean(authBusyAction) || authLoading || !auth?.available}
                        className="kimix-icon-text-button is-compact border border-[var(--kimix-panel-border-soft)] text-accent-danger hover:bg-accent-danger-light disabled:cursor-wait disabled:opacity-55"
                      >
                        <LogOut size={14} />
                        <span>{authBusyAction === "logout" ? "退出中" : "退出登录"}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleLogin()}
                        disabled={Boolean(authBusyAction) || authLoading || !auth?.available}
                        className="kimix-icon-text-button is-compact bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-wait disabled:opacity-55"
                      >
                        <LogIn size={14} />
                        <span>{authBusyAction === "login" ? "登录中" : "登录"}</span>
                      </button>
                    )}
                  </div>

                </div>
              </div>

              <div ref={modelSettingsRef} className="kimix-settings-section">
                <div className="kimix-settings-row-title">
                  <div className="kimix-settings-section-title">
                    <Terminal size={16} className="text-text-muted" />
                    <span>模型配置</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshModelConfig()}
                    disabled={modelConfigLoading}
                    className="kimix-settings-check-button"
                  >
                    <RefreshCw size={15} className={modelConfigLoading ? "kimix-spin" : ""} />
                    <span>刷新</span>
                  </button>
                </div>
                <div className="kimix-settings-card" style={{ padding: "18px 16px" }}>
                  <div className="flex items-start" style={{ gap: 12 }}>
                    <Terminal size={18} className="mt-0.5 shrink-0 text-text-muted" />
                    <div className="kimix-settings-permission-copy">
                      <div className="kimix-settings-permission-label">Kimi Code 模型配置</div>
                      <div className="kimix-settings-permission-desc">
                        {modelConfig?.configPath ?? "正在读取 Kimi Code config.toml"}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col" style={{ gap: 10, marginTop: 14 }}>
                    {modelConfigLoading ? (
                      <div className="kimix-settings-permission-desc">正在读取模型配置...</div>
                    ) : modelConfig && modelConfig.exists ? (
                      <>
                        <div className="grid min-w-0" style={{ gridTemplateColumns: "92px minmax(0, 1fr)", gap: 10 }}>
                          <div className="kimix-settings-permission-desc" style={{ marginTop: 0 }}>默认模型</div>
                          <div className="kimix-settings-permission-label break-all text-[13px]">{modelConfig.defaultModel ?? "未设置"}</div>
                        </div>
                        <div className="grid min-w-0" style={{ gridTemplateColumns: "92px minmax(0, 1fr)", gap: 10 }}>
                          <div className="kimix-settings-permission-desc" style={{ marginTop: 0 }}>Provider</div>
                          <div className="kimix-settings-permission-label text-[13px]">
                            {modelConfig.providers.length} 个，{modelConfig.providers.filter((provider) => provider.hasApiKey || provider.hasOauth).length} 个已配置凭据
                          </div>
                        </div>
                        <div className="flex flex-col" style={{ gap: 8, marginTop: 2 }}>
                          {modelConfig.models.slice(0, 3).map((model) => {
                            const selected = selectedModelAlias === model.alias || (!selectedModelAlias && model.isDefault);
                            return (
                              <div
                                key={model.alias}
                                onClick={() => handleSelectModel(model)}
                                className={`kimix-settings-permission ${selected ? "is-active" : ""}`}
                                style={{
                                  padding: "12px 14px",
                                  display: "grid",
                                  gridTemplateColumns: "auto minmax(0, 1fr) auto",
                                  gap: 12,
                                  alignItems: "center",
                                }}
                              >
                                <SelectionIndicator selected={selected} />
                                <div className="kimix-settings-permission-copy">
                                  <div className="kimix-settings-permission-label truncate">{model.displayName || model.alias}</div>
                                  <div className="kimix-settings-permission-desc">
                                    {model.provider ?? "未绑定 provider"} · {model.model ?? model.alias} · 自适应思考{model.adaptiveThinking ? "开" : "关"}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleToggleAdaptiveThinking(model);
                                    }}
                                    disabled={adaptiveThinkingBusyAlias === model.alias}
                                    className="kimix-icon-text-button is-compact shrink-0 text-text-secondary hover:bg-surface-hover"
                                  >
                                    <Zap size={13} className={adaptiveThinkingBusyAlias === model.alias ? "kimix-spin" : ""} />
                                    {model.adaptiveThinking ? "思考开" : "思考关"}
                                  </button>
                                  {model.isDefault ? (
                                    <span className="shrink-0 rounded-full bg-accent-primary text-[12px] leading-5 text-white" style={{ paddingLeft: 9, paddingRight: 9 }}>
                                      默认
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleSetDefaultModel(model.alias);
                                      }}
                                      disabled={providerBusyAction === "default"}
                                      className="kimix-icon-text-button is-compact shrink-0 text-text-secondary hover:bg-surface-hover"
                                    >
                                      <Check size={13} />
                                      设为默认
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {modelConfig.models.length > 3 && (
                          <div className="kimix-settings-permission-desc">另有 {modelConfig.models.length - 3} 个模型别名，后续 P0 写入入口会一并管理。</div>
                        )}
                      </>
                    ) : (
                      <div className="kimix-settings-permission-desc">{modelConfigMessage || "未读取到模型配置。"}</div>
                    )}
                  </div>

                  <div className="border-t border-[var(--kimix-panel-divider)]" style={{ marginTop: 16, paddingTop: 16 }}>
                    <div className="kimix-settings-permission-label">OpenAI-compatible Provider</div>
                    <div className="kimix-settings-permission" style={{ padding: "14px 16px", marginTop: 12 }}>
                      <div className="flex min-w-0 items-start justify-between" style={{ gap: 14 }}>
                        <div className="kimix-settings-permission-copy min-w-0">
                          <div className="kimix-settings-permission-label">官方 catalog</div>
                          <div className="kimix-settings-permission-desc">
                            {providerCatalog.length > 0 ? `${providerCatalog.length} 个 OpenAI-compatible Provider 可填入` : "从 models.dev 拉取可用 Provider 和模型名"}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleLoadProviderCatalog()}
                          disabled={providerCatalogLoading}
                          className="kimix-icon-text-button is-compact shrink-0 text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55"
                        >
                          <RefreshCw size={13} className={providerCatalogLoading ? "kimix-spin" : ""} />
                          {providerCatalog.length > 0 ? "刷新" : "载入"}
                        </button>
                      </div>
                      {providerCatalog.length > 0 && (
                        <div className="flex min-w-0 flex-col" style={{ gap: 12, marginTop: 14 }}>
                          <label className="min-w-0">
                            <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>Provider</span>
                            <select
                              value={selectedCatalogProviderId}
                              onChange={(event) => handleSelectCatalogProvider(event.target.value)}
                              className="kimix-settings-input h-9 w-full rounded-lg text-[13px] outline-none transition-colors"
                              style={{ marginTop: 5, paddingLeft: 11, paddingRight: 11 }}
                            >
                              {providerCatalog.map((provider) => (
                                <option key={provider.providerId} value={provider.providerId}>
                                  {provider.providerId} ({provider.modelCount})
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="min-w-0">
                            <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>模型</span>
                            <select
                              value={selectedCatalogModelId}
                              onChange={(event) => handleSelectCatalogModel(event.target.value)}
                              className="kimix-settings-input h-9 w-full rounded-lg text-[13px] outline-none transition-colors"
                              style={{ marginTop: 5, paddingLeft: 11, paddingRight: 11 }}
                            >
                              {(providerCatalog.find((provider) => provider.providerId === selectedCatalogProviderId)?.models ?? []).map((model) => (
                                <option key={model.id} value={model.id}>
                                  {model.name ?? model.id}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      )}
                    </div>
                    <div className="grid min-w-0" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10, marginTop: 12 }}>
                      <label className="min-w-0">
                        <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>Provider 名称</span>
                        <input
                          value={providerDraft.providerName}
                          onChange={(event) => setProviderDraft((current) => ({ ...current, providerName: event.target.value }))}
                          className="kimix-settings-input h-9 w-full rounded-lg text-[13px] outline-none transition-colors"
                          style={{ marginTop: 5, paddingLeft: 11, paddingRight: 11 }}
                        />
                      </label>
                      <label className="min-w-0">
                        <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>模型别名</span>
                        <input
                          value={providerDraft.modelAlias}
                          onChange={(event) => setProviderDraft((current) => ({ ...current, modelAlias: event.target.value }))}
                          className="kimix-settings-input h-9 w-full rounded-lg text-[13px] outline-none transition-colors"
                          style={{ marginTop: 5, paddingLeft: 11, paddingRight: 11 }}
                        />
                      </label>
                    </div>
                    <label className="block min-w-0" style={{ marginTop: 10 }}>
                      <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>Base URL</span>
                      <input
                        value={providerDraft.baseUrl}
                        onChange={(event) => setProviderDraft((current) => ({ ...current, baseUrl: event.target.value }))}
                        className="kimix-settings-input h-9 w-full rounded-lg text-[13px] outline-none transition-colors"
                        style={{ marginTop: 5, paddingLeft: 11, paddingRight: 11 }}
                      />
                    </label>
                    <div className="grid min-w-0" style={{ gridTemplateColumns: "minmax(0, 1fr) 128px", gap: 10, marginTop: 10 }}>
                      <label className="min-w-0">
                        <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>模型名</span>
                        <input
                          value={providerDraft.model}
                          onChange={(event) => setProviderDraft((current) => ({ ...current, model: event.target.value }))}
                          className="kimix-settings-input h-9 w-full rounded-lg text-[13px] outline-none transition-colors"
                          style={{ marginTop: 5, paddingLeft: 11, paddingRight: 11 }}
                        />
                      </label>
                      <label className="min-w-0">
                        <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>Context</span>
                        <input
                          type="number"
                          min={1}
                          max={1048576}
                          value={providerDraft.maxContextSize}
                          onChange={(event) => setProviderDraft((current) => ({ ...current, maxContextSize: event.target.value }))}
                          className="kimix-settings-input kimix-number-input h-9 w-full rounded-lg text-center text-[13px] outline-none transition-colors"
                          style={{ marginTop: 5, paddingLeft: 11, paddingRight: 11 }}
                        />
                      </label>
                    </div>
                    <label className="block min-w-0" style={{ marginTop: 10 }}>
                      <span className="kimix-settings-permission-desc block" style={{ marginTop: 0 }}>API Key</span>
                      <input
                        type="password"
                        value={providerDraft.apiKey}
                        onChange={(event) => setProviderDraft((current) => ({ ...current, apiKey: event.target.value }))}
                        className="kimix-settings-input h-9 w-full rounded-lg text-[13px] outline-none transition-colors"
                        style={{ marginTop: 5, paddingLeft: 11, paddingRight: 11 }}
                      />
                    </label>
                    <div className="flex min-w-0 justify-end" style={{ gap: 8, marginTop: 14 }}>
                        <button
                          type="button"
                          onClick={() => void handleSetDefaultModel()}
                          disabled={Boolean(providerBusyAction) || !providerDraft.modelAlias.trim()}
                          className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55"
                        >
                          <Check size={13} />
                          设为默认
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleTestProvider()}
                          disabled={Boolean(providerBusyAction)}
                          className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55"
                        >
                          <RefreshCw size={13} className={providerBusyAction === "test" ? "kimix-spin" : ""} />
                          测试
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSaveProvider()}
                          disabled={Boolean(providerBusyAction)}
                          className="kimix-icon-text-button is-compact bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-wait disabled:opacity-55"
                        >
                          <Check size={13} />
                          保存
                        </button>
                    </div>
                    {providerMessage && (
                      <div className="break-all text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 10 }}>
                        {providerMessage}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="kimix-settings-section">
                <div className="kimix-settings-section-title">
                  <Terminal size={16} className="text-text-muted" />
                  <span>上下文显示</span>
                </div>
                <div className="kimix-settings-permissions">
                  <button onClick={() => setDetailedContext(false)} className={`kimix-settings-permission ${!detailedContext ? "is-active" : ""}`}>
                    <SelectionIndicator selected={!detailedContext} />
                    <Terminal size={18} className={`mt-0.5 shrink-0 ${!detailedContext ? "text-accent-primary" : "text-text-muted"}`} />
                    <div className="kimix-settings-permission-copy">
                      <div className="kimix-settings-permission-label">上下文百分比显示</div>
                      <div className="kimix-settings-permission-desc">默认选项，显示当前 Context 百分比</div>
                    </div>
                  </button>
                  <button onClick={() => setDetailedContext(true)} className={`kimix-settings-permission ${detailedContext ? "is-active" : ""}`}>
                    <SelectionIndicator selected={detailedContext} />
                    <Terminal size={18} className={`mt-0.5 shrink-0 ${detailedContext ? "text-accent-primary" : "text-text-muted"}`} />
                    <div className="kimix-settings-permission-copy">
                      <div className="kimix-settings-permission-label">上下文详细显示</div>
                      <div className="kimix-settings-permission-desc">显示 12.34/256k 这类详细用量</div>
                    </div>
                  </button>
                </div>
              </div>

              <div className="kimix-settings-section">
                <div className="kimix-settings-section-title">
                  <Bell size={16} className="text-text-muted" />
                  <span>完成通知</span>
                </div>
                <div className="kimix-settings-permissions">
                  {notificationModes.map((mode) => (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() => setNotificationMode(mode.value)}
                      className={`kimix-settings-permission ${notificationMode === mode.value ? "is-active" : ""}`}
                    >
                      <SelectionIndicator selected={notificationMode === mode.value} />
                      <div className="kimix-settings-permission-copy">
                        <div className="kimix-settings-permission-label">{mode.label}</div>
                        <div className="kimix-settings-permission-desc">{mode.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="kimix-settings-section">
                <div className="kimix-settings-section-title">
                  <Mic size={16} className="text-text-muted" />
                  <span>语音输入</span>
                </div>
                <div className="kimix-settings-card" style={{ padding: "18px 16px" }}>
                  <div className="flex items-start" style={{ gap: 12 }}>
                    <Keyboard size={18} className="mt-0.5 shrink-0 text-text-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[14.5px] font-medium text-[var(--kimix-panel-text)]">语音按钮触发快捷键</div>
                      <div className="mt-1 text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]">点击输入区麦克风后，会触发该系统快捷键，用于调用你自己的语音输入工具。</div>
                    </div>
                  </div>
                  <div className="min-w-0" style={{ marginTop: 18 }}>
                    <div className="grid min-w-0 items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) 174px", gap: 14, minHeight: 36 }}>
                      <label htmlFor="voice-shortcut" className="min-w-0 text-[14px] leading-5 text-[var(--kimix-panel-text-secondary)]">快捷键</label>
                      <input
                        id="voice-shortcut"
                        type="text"
                        value={voiceShortcut}
                        onChange={(event) => setVoiceShortcut(event.target.value)}
                        placeholder="Win+H"
                        className="kimix-settings-input h-9 w-full rounded-lg text-center text-[14px] outline-none transition-colors"
                      />
                    </div>
                    <div className="grid min-w-0" style={{ gridTemplateColumns: "minmax(0, 1fr) 174px", gap: 14, marginTop: 6 }}>
                      <div aria-hidden="true" />
                      <div className="kimix-settings-hint text-right text-[12.5px] leading-5">示例：Win+H、Ctrl+Alt+V</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="kimix-settings-section">
                <div className="kimix-settings-row-title">
                  <div className="kimix-settings-section-title">
                    <AlertCircle size={16} className="text-text-muted" />
                    <span>卡死诊断</span>
                  </div>
                  <div className="flex items-center" style={{ gap: 8 }}>
                    <span className="kimix-settings-badge text-[12.5px] leading-5" style={{ paddingLeft: 10, paddingRight: 10 }}>
                      {freezeReports.length}
                    </span>
                    <button type="button" onClick={loadFreezeReports} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover">
                      <RefreshCw size={13} />
                      刷新
                    </button>
                    <button type="button" onClick={clearFreezeReports} className="kimix-icon-text-button is-compact text-accent-danger hover:bg-accent-danger-light">
                      <Trash2 size={13} />
                      清空
                    </button>
                  </div>
                </div>
                <div className="kimix-settings-card" style={{ padding: "18px 16px" }}>
                  {freezeReports.length > 0 ? (
                    <div className="flex flex-col" style={{ gap: 10 }}>
                      {visibleFreezeReports.map((report, index) => (
                        <div key={`${report.at}-${index}`} className="kimix-settings-list-item" style={{ padding: "12px 12px" }}>
                          <div className="flex min-w-0 items-center justify-between" style={{ gap: 10 }}>
                            <div className="truncate text-[14px] font-medium leading-5 text-[var(--kimix-panel-text)]">{formatFreezeTime(report.at)}</div>
                            <span className="shrink-0 rounded-full bg-accent-danger-light text-[12.5px] leading-5 text-accent-danger" style={{ paddingLeft: 9, paddingRight: 9 }}>
                              {report.lagMs} ms
                            </span>
                          </div>
                          <div className="mt-2 text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                            <div className="truncate">当前会话：{report.sessionId ?? "无"}</div>
                            <div className="mt-1 truncate">运行会话：{report.runningSessionId ?? "无"}</div>
                          </div>
                        </div>
                      ))}
                      {hiddenFreezeCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setFreezeExpanded((current) => !current)}
                          className="kimix-icon-text-button kimix-muted-action is-compact self-start"
                          style={{ marginTop: 2 }}
                        >
                          {freezeExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          <span>{freezeExpanded ? `折叠剩余 ${hiddenFreezeCount} 条诊断记录` : `展开剩余 ${hiddenFreezeCount} 条诊断记录`}</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-[13.5px] leading-6 text-[var(--kimix-panel-text-secondary)]">暂无卡死诊断记录。</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="kimix-settings-footer">Kimix v2.8.265 · 设置将自动保存到本地</div>
        </div>
      </div>
  );

  if (variant === "workspace") return content;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={() => setSettingsOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      {content}
    </div>
  );
}
