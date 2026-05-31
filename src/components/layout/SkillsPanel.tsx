import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Cable, Check, ExternalLink, LayoutGrid, Plus, RefreshCw, Sparkles, Upload, X } from "lucide-react";
import { McpPanel } from "./McpPanel";
import { useAppStore } from "@/stores/appStore";
import { getRuntimeSessionId } from "@/utils/runtimeSession";
import type { TuiPluginSnapshot } from "@electron/types/ipc";

type SkillInfo = {
  name: string;
  description: string;
  path: string;
  source: string;
  sourceLabel?: string;
  trustLevel?: "kimi-official" | "curated" | "third-party" | "local";
  enabled: boolean;
};

type PluginPanelTab = "skills" | "mcp";
const OFFICIAL_PLUGIN_STORE_URL = "https://moonshotai.github.io/kimi-code/zh/customization/plugins.html#安装与管理-plugins";
const OFFICIAL_PLUGIN_DOCS_URL = "https://moonshotai.github.io/kimi-code/zh/customization/plugins.html#plugin-manifest";
const KIMI_DATASOURCE_PLUGIN_URL = "https://cdn.kimi.com/kimi-code-plugins/kimi-datasource.zip";

export function SkillsPanel({
  open,
  onBackToChat,
  activeTab = "skills",
  onActiveTabChange,
  onOpenOfficialMarketplace,
}: {
  open: boolean;
  onBackToChat?: () => void;
  activeTab?: PluginPanelTab;
  onActiveTabChange?: (tab: PluginPanelTab) => void;
  onOpenOfficialMarketplace?: () => Promise<boolean>;
}) {
  const currentSession = useAppStore((s) => s.currentSession);
  const [localActiveTab, setLocalActiveTab] = useState<PluginPanelTab>(activeTab);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [enabledNames, setEnabledNames] = useState<string[]>([]);
  const [enabledDir, setEnabledDir] = useState("");
  const [message, setMessage] = useState("正在扫描本地 Skills...");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pluginUrl, setPluginUrl] = useState("");
  const [installingPlugin, setInstallingPlugin] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [tuiPlugins, setTuiPlugins] = useState<TuiPluginSnapshot[]>([]);
  const [tuiPluginRefreshing, setTuiPluginRefreshing] = useState(false);
  const [tuiPluginNavigating, setTuiPluginNavigating] = useState<"installed" | "marketplace" | null>(null);
  const [tuiPluginClosing, setTuiPluginClosing] = useState(false);
  const [tuiPluginMoving, setTuiPluginMoving] = useState<"up" | "down" | null>(null);
  const selectedTab = onActiveTabChange ? activeTab : localActiveTab;
  const runtimeSessionId = currentSession?.engine === "tui" ? getRuntimeSessionId(currentSession) : null;
  const selectedTuiPlugin = tuiPlugins.find((plugin) => plugin.selected);

  useEffect(() => {
    setLocalActiveTab(activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (!open || !runtimeSessionId) {
      setTuiPlugins([]);
      return;
    }
    let cancelled = false;
    const syncPlugins = (plugins?: TuiPluginSnapshot[]) => {
      if (cancelled) return;
      setTuiPlugins(plugins?.length ? plugins : []);
    };
    void window.api.listTuiSessions().then((res) => {
      if (!res.success) return;
      syncPlugins(res.data.find((session) => session.sessionId === runtimeSessionId)?.screen?.plugins);
    }).catch(() => {});
    const unsubscribe = window.api.onTuiEvent((payload) => {
      if (payload.sessionId !== runtimeSessionId) return;
      syncPlugins(payload.session.screen?.plugins);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [open, runtimeSessionId]);

  const refreshTuiPluginMirror = async () => {
    if (!runtimeSessionId) return;
    setTuiPluginRefreshing(true);
    try {
      const res = await window.api.listTuiSessions();
      if (!res.success) {
        setMessage(`刷新 TUI 插件状态失败：${res.error}`);
        return;
      }
      const plugins = res.data.find((session) => session.sessionId === runtimeSessionId)?.screen?.plugins ?? [];
      setTuiPlugins(plugins);
      setMessage(plugins.length > 0 ? `已刷新官方 TUI 插件状态：${plugins.length} 项` : "当前 TUI 还没有插件状态，请先打开官方 /plugins");
    } finally {
      setTuiPluginRefreshing(false);
    }
  };

  const openTuiPluginScreen = async (target: "installed" | "marketplace") => {
    if (!runtimeSessionId) return;
    setTuiPluginNavigating(target);
    try {
      const escaped = await window.api.sendTuiKey({ sessionId: runtimeSessionId, key: "escape" });
      if (!escaped.success) {
        setMessage(`退出当前 TUI 菜单失败：${escaped.error}`);
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      const command = target === "marketplace" ? "/plugins marketplace" : "/plugins";
      const sent = await window.api.sendTuiInput({ sessionId: runtimeSessionId, text: command });
      if (!sent.success) {
        setMessage(`打开官方 ${target === "marketplace" ? "Marketplace" : "/plugins"} 失败：${sent.error}`);
        return;
      }
      setMessage(target === "marketplace" ? "已切到官方 Marketplace，等待 TUI 状态回传..." : "已切回官方 Installed，等待 TUI 状态回传...");
    } finally {
      setTuiPluginNavigating(null);
    }
  };

  const closeTuiPluginMenu = async () => {
    if (!runtimeSessionId) return;
    setTuiPluginClosing(true);
    try {
      const closed = await window.api.sendTuiKey({ sessionId: runtimeSessionId, key: "escape" });
      if (!closed.success) {
        setMessage(`退出官方插件菜单失败：${closed.error}`);
        return;
      }
      setMessage("已退出官方插件菜单。");
    } finally {
      window.setTimeout(() => setTuiPluginClosing(false), 180);
    }
  };

  const moveTuiPluginSelection = async (direction: "up" | "down") => {
    if (!runtimeSessionId) return;
    setTuiPluginMoving(direction);
    try {
      const moved = await window.api.sendTuiKey({
        sessionId: runtimeSessionId,
        key: direction === "up" ? "arrowUp" : "arrowDown",
      });
      if (!moved.success) {
        setMessage(`移动官方插件选中项失败：${moved.error}`);
        return;
      }
      setMessage(direction === "up" ? "已向上移动官方插件菜单选中项。" : "已向下移动官方插件菜单选中项。");
    } finally {
      window.setTimeout(() => setTuiPluginMoving(null), 180);
    }
  };

  const setSelectedTab = (tab: PluginPanelTab) => {
    setLocalActiveTab(tab);
    onActiveTabChange?.(tab);
  };

  const refreshSkills = async (nextMessage?: string) => {
    setMessage("正在扫描本地 Skills...");
    const res = await window.api.listSkills();
    if (!res.success) {
      setMessage(`扫描失败：${res.error}`);
      return;
    }
    setSkills(res.data.skills);
    setEnabledNames(res.data.enabledNames);
    setEnabledDir(res.data.enabledDir);
    setMessage(nextMessage ?? (res.data.skills.length > 0 ? `已发现 ${res.data.skills.length} 个本地 Skill` : "未发现本地 Skill"));
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMessage("正在扫描本地 Skills...");
    void window.api.listSkills().then((res) => {
      if (cancelled) return;
      if (!res.success) {
        setMessage(`扫描失败：${res.error}`);
        return;
      }
      setSkills(res.data.skills);
      setEnabledNames(res.data.enabledNames);
      setEnabledDir(res.data.enabledDir);
      setMessage(res.data.skills.length > 0 ? `已发现 ${res.data.skills.length} 个本地 Skill` : "未发现本地 Skill");
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const toggleSkill = async (name: string) => {
    const next = enabledNames.includes(name)
      ? enabledNames.filter((item) => item !== name)
      : [...enabledNames, name];
    setEnabledNames(next);
    setSaving(true);
    const res = await window.api.saveEnabledSkills({ names: next });
    setSaving(false);
    if (!res.success) {
      setMessage(`保存失败：${res.error}`);
      return;
    }
    setEnabledNames(res.data.enabledNames);
    setEnabledDir(res.data.enabledDir);
    setMessage(`已启用 ${res.data.enabledNames.length} 个 Skill。新会话将通过 --skills-dir 使用这些 Skill。`);
  };

  const importArchive = async (archivePath?: string) => {
    setImporting(true);
    setMessage("正在导入 Skill 压缩包...");
    const res = await window.api.importSkillArchive(archivePath ? { archivePath } : undefined);
    setImporting(false);
    setDragActive(false);
    if (!res.success) {
      setMessage(`导入失败：${res.error}`);
      return;
    }
    setSkills(res.data.skills);
    const importedNames = res.data.imported.map((skill) => skill.name);
    setMessage(importedNames.length > 0 ? `已导入 ${importedNames.join("、")}` : "已取消导入");
    void refreshSkills(importedNames.length > 0 ? `已导入 ${importedNames.join("、")}` : undefined);
  };

  const installKimiPlugin = async () => {
    const url = pluginUrl.trim();
    if (!url) {
      setMessage("请输入 GitHub Plugin URL");
      return;
    }
    setInstallingPlugin(true);
    setMessage("正在调用 Kimi Code 安装 Plugin...");
    const res = await window.api.installKimiPlugin({ url });
    setInstallingPlugin(false);
    if (!res.success) {
      setMessage(`Plugin 安装失败：${res.error}`);
      return;
    }
    setPluginUrl("");
    setSkills(res.data.skills);
    setEnabledNames(res.data.enabledNames);
    setEnabledDir(res.data.enabledDir);
    setMessage(res.data.output ? `${res.data.message}。CLI 输出：${res.data.output}` : res.data.message);
  };

  const installOfficialDatasourcePlugin = async () => {
    setPluginUrl(KIMI_DATASOURCE_PLUGIN_URL);
    setInstallingPlugin(true);
    setMessage("正在安装官方插件 kimi-datasource...");
    const res = await window.api.installKimiPlugin({ url: KIMI_DATASOURCE_PLUGIN_URL });
    setInstallingPlugin(false);
    if (!res.success) {
      setMessage(`官方插件安装失败：${res.error}`);
      return;
    }
    setPluginUrl("");
    setSkills(res.data.skills);
    setEnabledNames(res.data.enabledNames);
    setEnabledDir(res.data.enabledDir);
    setMessage(res.data.output ? `${res.data.message}。CLI 输出：${res.data.output}` : res.data.message);
  };

  const openOfficialPluginStore = async () => {
    if (await onOpenOfficialMarketplace?.()) return;
    const res = await window.api.openExternal(OFFICIAL_PLUGIN_STORE_URL);
    if (!res.success) setMessage(`打开官方插件页失败：${res.error}`);
  };

  const openPluginDocs = async () => {
    const res = await window.api.openExternal(OFFICIAL_PLUGIN_DOCS_URL);
    if (!res.success) setMessage(`打开插件文档失败：${res.error}`);
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    setDragActive(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files).find((item) => item.name.toLowerCase().endsWith(".zip"));
    const archivePath = file ? (file as unknown as { path?: string }).path : "";
    if (!archivePath) {
      setDragActive(false);
      setMessage("请拖入本地 .zip Skill 压缩包");
      return;
    }
    void importArchive(archivePath);
  };

  const shortDescription = (description: string) => {
    const firstSentence = description.split(/(?<=[.!?。！？])\s+/)[0]?.trim() || description.trim();
    return firstSentence.length > 96 ? `${firstSentence.slice(0, 96)}...` : firstSentence;
  };

  const trustMeta = (skill: SkillInfo) => {
    switch (skill.trustLevel) {
      case "kimi-official":
        return { label: "官方", className: "bg-accent-primary text-white" };
      case "curated":
        return { label: "精选", className: "bg-accent-success-light text-accent-success" };
      case "third-party":
        return { label: "第三方", className: "bg-accent-warning-light text-accent-warning" };
      default:
        return { label: "本地", className: "bg-[var(--kimix-panel-badge-bg)] text-[var(--kimix-panel-badge-text)]" };
    }
  };

  const tuiStatusLabel = (status: TuiPluginSnapshot["status"]) => {
    switch (status) {
      case "enabled":
        return "已启用";
      case "installed":
        return "已安装";
      case "disabled":
        return "已停用";
      case "available":
        return "可安装";
      default:
        return "未知";
    }
  };

  const tuiTrustLabel = (trustLevel: TuiPluginSnapshot["trustLevel"]) => {
    switch (trustLevel) {
      case "official":
        return "官方";
      case "curated":
        return "精选";
      case "third-party":
        return "第三方";
      default:
        return "未知来源";
    }
  };

  const tuiSourceLabel = (source: TuiPluginSnapshot["source"]) => {
    return source === "marketplace" ? "Marketplace" : "Installed";
  };

  if (!open) return null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--kimix-panel-bg)]">
      <div
        className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${dragActive ? "outline outline-2 outline-[var(--accent-blue)]" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {dragActive && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[color:var(--kimix-overlay-bg)]">
            <div className="kimix-floating-panel flex items-center rounded-xl text-[15px]" style={{ gap: 10, padding: "14px 18px" }}>
              <Upload size={17} />
              <span>松开导入 Skill 压缩包</span>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between border-b border-[var(--kimix-panel-divider)]" style={{ padding: "20px 28px" }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 text-[20px] font-semibold leading-7 text-[var(--kimix-panel-text)]">
              <LayoutGrid size={20} />
              <span>插件</span>
            </div>
            <div className="mt-1 text-[13.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">
              管理 Kimix 扩展能力：Skills 负责本地能力包，MCP 负责外部工具服务。
            </div>
          </div>
          <div className="flex items-center" style={{ gap: 8 }}>
            {selectedTab === "skills" && (
              <>
                <button
                  type="button"
                  onClick={() => void importArchive()}
                  disabled={importing}
                  className="kimix-icon-text-button kimix-muted-action is-compact disabled:cursor-wait disabled:opacity-50"
                  title="导入 Skill 压缩包"
                >
                  <Plus size={15} />
                  <span>{importing ? "导入中" : "添加"}</span>
                </button>
              </>
            )}
            {onBackToChat && (
              <button
                type="button"
                onClick={onBackToChat}
                className="kimix-icon-text-button kimix-muted-action is-compact"
                style={{ marginLeft: 4 }}
              >
                返回对话
              </button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "22px 28px 30px" }}>
          <div className="flex items-center" style={{ gap: 8, marginBottom: 18 }}>
            <button
              type="button"
              onClick={() => setSelectedTab("skills")}
              className={`kimix-icon-text-button is-compact ${selectedTab === "skills" ? "bg-accent-primary text-white hover:bg-accent-primary-dark" : "kimix-muted-action"}`}
            >
              <Sparkles size={14} />
              <span>Skills</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedTab("mcp")}
              className={`kimix-icon-text-button is-compact ${selectedTab === "mcp" ? "bg-accent-primary text-white hover:bg-accent-primary-dark" : "kimix-muted-action"}`}
            >
              <Cable size={14} />
              <span>MCP</span>
            </button>
          </div>
          {selectedTab === "mcp" ? (
            <McpPanel embedded />
          ) : (
          <div className="grid w-full items-start" style={{ gridTemplateColumns: "320px minmax(0, 1fr)", gap: 18 }}>
            <aside className="flex flex-col" style={{ gap: 14 }}>
              <div className="kimix-soft-card rounded-xl text-[13.5px] leading-6" style={{ padding: "14px 16px" }}>
                勾选后全局启用 Skill；新建/恢复会话时通过官方 `--skills-dir` 传给 CLI。
              </div>
              <div className="kimix-soft-card rounded-xl text-[13px] leading-6" style={{ padding: "14px 16px" }}>
                <div className="font-medium text-[var(--kimix-panel-text)]">官方插件商店</div>
                <div className="text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 6 }}>
                  官方插件现在由 Kimi Code Plugin 系统接管；Superpowers 请通过官方插件商店安装，不再使用 Kimix 旧接入。
                </div>
                <div className="flex flex-col" style={{ gap: 10, marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={() => void openOfficialPluginStore()}
                    className="kimix-icon-text-button kimix-muted-action is-compact justify-center"
                    style={{ width: "100%" }}
                  >
                    <ExternalLink size={14} />
                    <span>打开官方 Marketplace</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void openPluginDocs()}
                    className="kimix-icon-text-button kimix-muted-action is-compact justify-center"
                    style={{ width: "100%" }}
                  >
                    <ExternalLink size={14} />
                    <span>自定义插件文档</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void installOfficialDatasourcePlugin()}
                    disabled={installingPlugin}
                    className="kimix-icon-text-button kimix-muted-action is-compact justify-center disabled:cursor-wait disabled:opacity-50"
                    style={{ width: "100%" }}
                  >
                    <Plus size={14} />
                    <span>{installingPlugin ? "安装中" : "安装 kimi-datasource"}</span>
                  </button>
                </div>
              </div>
              {runtimeSessionId && (
                <div className="kimix-soft-card rounded-xl text-[13px] leading-6" style={{ padding: "14px 16px" }}>
                  <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                    <div className="min-w-0 font-medium text-[var(--kimix-panel-text)]">官方 TUI 插件状态</div>
                    <div className="shrink-0 rounded-full bg-[var(--kimix-panel-badge-bg)] text-[12px] leading-5 text-[var(--kimix-panel-badge-text)]" style={{ paddingLeft: 8, paddingRight: 8 }}>
                      {tuiPlugins[0]?.source === "marketplace" ? "Marketplace" : "Installed"}
                    </div>
                  </div>
                  {selectedTuiPlugin && (
                    <div
                      className="rounded-lg border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)] text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]"
                      style={{ marginTop: 10, padding: "10px 12px" }}
                    >
                      <div className="grid items-start" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-[var(--kimix-panel-text)]">{selectedTuiPlugin.name}</div>
                          <div className="truncate text-[12px]" style={{ marginTop: 2 }} title={selectedTuiPlugin.id}>
                            {selectedTuiPlugin.id}
                            {selectedTuiPlugin.version ? ` · v${selectedTuiPlugin.version}` : ""}
                          </div>
                        </div>
                        <span className="shrink-0 rounded-full bg-[var(--kimix-panel-badge-bg)] text-[12px] leading-5 text-[var(--kimix-panel-badge-text)]" style={{ paddingLeft: 8, paddingRight: 8 }}>
                          当前选中
                        </span>
                      </div>
                      <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
                        <div className="rounded-md bg-[var(--kimix-panel-bg)] text-center" style={{ padding: "6px 8px" }}>
                          <div className="text-[11px] leading-4 text-[var(--kimix-panel-text-muted)]">状态</div>
                          <div className="truncate font-medium text-[var(--kimix-panel-text)]">{tuiStatusLabel(selectedTuiPlugin.status)}</div>
                        </div>
                        <div className="rounded-md bg-[var(--kimix-panel-bg)] text-center" style={{ padding: "6px 8px" }}>
                          <div className="text-[11px] leading-4 text-[var(--kimix-panel-text-muted)]">来源</div>
                          <div className="truncate font-medium text-[var(--kimix-panel-text)]">{tuiSourceLabel(selectedTuiPlugin.source)}</div>
                        </div>
                        <div className="rounded-md bg-[var(--kimix-panel-bg)] text-center" style={{ padding: "6px 8px" }}>
                          <div className="text-[11px] leading-4 text-[var(--kimix-panel-text-muted)]">信任</div>
                          <div className="truncate font-medium text-[var(--kimix-panel-text)]">{tuiTrustLabel(selectedTuiPlugin.trustLevel)}</div>
                        </div>
                      </div>
                      <div className="text-[12px] leading-5" style={{ marginTop: 8 }}>
                        {selectedTuiPlugin.skillsCount !== null ? `${selectedTuiPlugin.skillsCount} skills` : "skills 未声明"}
                        {selectedTuiPlugin.mcpSummary ? ` · ${selectedTuiPlugin.mcpSummary}` : " · MCP 未声明"}
                      </div>
                    </div>
                  )}
                  <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                    <button
                      type="button"
                      onClick={() => void refreshTuiPluginMirror()}
                      disabled={tuiPluginRefreshing || Boolean(tuiPluginNavigating) || tuiPluginClosing || Boolean(tuiPluginMoving)}
                      className="kimix-icon-text-button kimix-muted-action is-compact justify-center disabled:cursor-wait disabled:opacity-50"
                      style={{ width: "100%" }}
                    >
                      <RefreshCw size={14} className={tuiPluginRefreshing ? "kimix-spin" : ""} />
                      <span>刷新镜像</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void openTuiPluginScreen("installed")}
                      disabled={tuiPluginRefreshing || Boolean(tuiPluginNavigating) || tuiPluginClosing || Boolean(tuiPluginMoving)}
                      className="kimix-icon-text-button kimix-muted-action is-compact justify-center disabled:cursor-wait disabled:opacity-50"
                      style={{ width: "100%" }}
                    >
                      <ExternalLink size={14} />
                      <span>{tuiPluginNavigating === "installed" ? "打开中" : "打开 /plugins"}</span>
                    </button>
                  </div>
                  <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      onClick={() => void openTuiPluginScreen("marketplace")}
                      disabled={tuiPluginRefreshing || Boolean(tuiPluginNavigating) || tuiPluginClosing || Boolean(tuiPluginMoving)}
                      className="kimix-icon-text-button kimix-muted-action is-compact justify-center disabled:cursor-wait disabled:opacity-50"
                      style={{ width: "100%" }}
                    >
                      <ExternalLink size={14} />
                      <span>{tuiPluginNavigating === "marketplace" ? "切换中" : "进入 Marketplace"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void openTuiPluginScreen("installed")}
                      disabled={tuiPluginRefreshing || Boolean(tuiPluginNavigating) || tuiPluginClosing || Boolean(tuiPluginMoving)}
                      className="kimix-icon-text-button kimix-muted-action is-compact justify-center disabled:cursor-wait disabled:opacity-50"
                      style={{ width: "100%" }}
                    >
                      <ExternalLink size={14} />
                      <span>{tuiPluginNavigating === "installed" ? "切换中" : "返回 Installed"}</span>
                    </button>
                  </div>
                  <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      onClick={() => void moveTuiPluginSelection("up")}
                      disabled={tuiPluginRefreshing || Boolean(tuiPluginNavigating) || tuiPluginClosing || Boolean(tuiPluginMoving)}
                      className="kimix-icon-text-button kimix-muted-action is-compact justify-center disabled:cursor-wait disabled:opacity-50"
                      style={{ width: "100%" }}
                    >
                      <ArrowUp size={14} />
                      <span>{tuiPluginMoving === "up" ? "移动中" : "上移选中"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void moveTuiPluginSelection("down")}
                      disabled={tuiPluginRefreshing || Boolean(tuiPluginNavigating) || tuiPluginClosing || Boolean(tuiPluginMoving)}
                      className="kimix-icon-text-button kimix-muted-action is-compact justify-center disabled:cursor-wait disabled:opacity-50"
                      style={{ width: "100%" }}
                    >
                      <ArrowDown size={14} />
                      <span>{tuiPluginMoving === "down" ? "移动中" : "下移选中"}</span>
                    </button>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      onClick={() => void closeTuiPluginMenu()}
                      disabled={tuiPluginRefreshing || Boolean(tuiPluginNavigating) || tuiPluginClosing || Boolean(tuiPluginMoving)}
                      className="kimix-icon-text-button kimix-muted-action is-compact justify-center disabled:cursor-wait disabled:opacity-50"
                      style={{ width: "100%" }}
                    >
                      <X size={14} />
                      <span>{tuiPluginClosing ? "退出中" : "退出插件菜单"}</span>
                    </button>
                  </div>
                  {tuiPlugins.length > 0 ? (
                    <div className="flex flex-col" style={{ gap: 8, marginTop: 12 }}>
                      {tuiPlugins.map((plugin) => (
                        <div
                          key={`${plugin.source}:${plugin.id}`}
                          className={`rounded-lg border ${plugin.selected ? "border-[var(--kimix-panel-border)] bg-[var(--kimix-panel-soft-bg)]" : "border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)]"}`}
                          style={{ padding: "10px 12px" }}
                        >
                          <div className="grid items-start" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-[var(--kimix-panel-text)]">{plugin.name}</div>
                              <div className="truncate text-[12px] text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 2 }} title={plugin.id}>
                                {plugin.id}
                                {plugin.version ? ` · v${plugin.version}` : ""}
                                {plugin.skillsCount !== null ? ` · ${plugin.skillsCount} skills` : ""}
                                {plugin.mcpSummary ? ` · ${plugin.mcpSummary}` : ""}
                              </div>
                            </div>
                            <div className="flex shrink-0 flex-col items-end" style={{ gap: 6 }}>
                              <span className="rounded-full bg-[var(--kimix-panel-badge-bg)] text-[12px] leading-5 text-[var(--kimix-panel-badge-text)]" style={{ paddingLeft: 8, paddingRight: 8 }}>
                                {tuiTrustLabel(plugin.trustLevel)}
                              </span>
                              {plugin.selected && (
                                <span className="rounded-full bg-[var(--kimix-panel-badge-bg)] text-[12px] leading-5 text-[var(--kimix-panel-badge-text)]" style={{ paddingLeft: 8, paddingRight: 8 }}>
                                  当前
                                </span>
                              )}
                              <span className="rounded-full bg-accent-primary text-[12px] leading-5 text-white" style={{ paddingLeft: 8, paddingRight: 8 }}>
                                {tuiStatusLabel(plugin.status)}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 10 }}>
                      打开官方 `/plugins` 或 Marketplace 后，这里会显示真实 TUI 状态。
                    </div>
                  )}
                </div>
              )}
              <div className="kimix-soft-card rounded-xl text-[13px] leading-6" style={{ padding: "14px 16px" }}>
                <div className="font-medium text-[var(--kimix-panel-text)]">安装 Kimi Plugin</div>
                <div className="text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 6 }}>
                  输入官方支持的 GitHub / ZIP plugin URL，安装后会自动刷新列表。
                </div>
                <div className="flex flex-col" style={{ gap: 10, marginTop: 12 }}>
                  <input
                    value={pluginUrl}
                    onChange={(event) => setPluginUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !installingPlugin) void installKimiPlugin();
                    }}
                    placeholder="https://github.com/owner/repo 或 https://.../plugin.zip"
                    className="h-9 w-full rounded-lg border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)] text-[13px] text-[var(--kimix-panel-text)] outline-none focus:border-[var(--accent-blue)]"
                    style={{ paddingLeft: 12, paddingRight: 12 }}
                  />
                  <button
                    type="button"
                    onClick={() => void installKimiPlugin()}
                    disabled={installingPlugin}
                    className="kimix-icon-text-button kimix-muted-action is-compact justify-center disabled:cursor-wait disabled:opacity-50"
                    style={{ width: "100%" }}
                  >
                    <Plus size={14} />
                    <span>{installingPlugin ? "安装中" : "安装 Plugin"}</span>
                  </button>
                </div>
              </div>
              <div className="kimix-soft-card rounded-xl text-[13px] leading-6" style={{ padding: "14px 16px" }}>
                <div>{message}{saving ? "，正在保存..." : ""}</div>
                {enabledDir && <div className="mt-1 break-all" title={enabledDir}>启用目录：{enabledDir}</div>}
              </div>
            </aside>
            <section className="grid min-w-0 items-start" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gridAutoRows: 174, gap: 12 }}>
              {skills.map((skill) => (
                (() => {
                  const trust = trustMeta(skill);
                  const officialPlugin = skill.trustLevel === "kimi-official" && skill.sourceLabel === "Kimi Plugin";
                  const enabled = officialPlugin || enabledNames.includes(skill.name);
                  return (
                <button
                  key={skill.path}
                  type="button"
                  onClick={() => {
                    if (!officialPlugin) void toggleSkill(skill.name);
                  }}
                  className={`h-full w-full overflow-hidden rounded-xl border text-left transition-colors hover:bg-[var(--kimix-panel-soft-bg)] ${enabled ? "border-[var(--accent-blue)]" : "border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)]"}`}
                  style={{
                    padding: "14px 18px",
                    cursor: officialPlugin ? "default" : undefined,
                    background: enabled
                      ? "color-mix(in srgb, var(--accent-blue) 8%, var(--kimix-panel-bg))"
                      : undefined,
                  }}
                >
                  <div className="grid h-full min-h-0" style={{ gridTemplateColumns: "22px minmax(0, 1fr) auto", gap: 12 }}>
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${enabled ? "border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white" : "border-[var(--kimix-selection-idle-border)] text-transparent"}`}>
                      <Check size={13} />
                    </span>
                    <span className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                      <span className="block truncate text-[15px] font-semibold text-[var(--kimix-panel-text)]" style={{ lineHeight: "22px" }}>{skill.name}</span>
                      <span className="mt-2 flex min-w-0 flex-wrap items-center" style={{ gap: 6 }}>
                        <span className={`h-6 shrink-0 rounded-full text-[12px] font-medium leading-6 ${trust.className}`} style={{ paddingLeft: 9, paddingRight: 9 }}>
                          {trust.label}
                        </span>
                        <span className="h-6 min-w-0 truncate rounded-full bg-[var(--kimix-panel-badge-bg)] text-[12px] leading-6 text-[var(--kimix-panel-badge-text)]" style={{ paddingLeft: 9, paddingRight: 9 }} title={skill.source}>
                          {skill.sourceLabel ?? "本地 Skill"}
                        </span>
                      </span>
                      <span
                        className="block text-[13px] text-[var(--kimix-panel-text-secondary)]"
                        title={skill.description}
                        style={{
                          display: "-webkit-box",
                          marginTop: 7,
                          lineHeight: "20px",
                          WebkitBoxOrient: "vertical",
                          WebkitLineClamp: 3,
                          maxHeight: 60,
                          overflow: "hidden",
                        }}
                      >
                        {shortDescription(skill.description)}
                      </span>
                      <span className="mt-auto block truncate text-[12px] text-[var(--kimix-panel-text-muted)]" style={{ paddingTop: 7 }} title={skill.path}>{skill.path}</span>
                    </span>
                    <span className={`h-6 shrink-0 rounded-full text-[12px] font-medium leading-6 ${enabled ? "bg-[var(--accent-blue)] text-white" : "bg-[var(--kimix-panel-badge-bg)] text-[var(--kimix-panel-badge-text)]"}`} style={{ paddingLeft: 9, paddingRight: 9 }}>
                      {officialPlugin ? "已安装" : enabled ? "已启用" : "未启用"}
                    </span>
                  </div>
                </button>
                  );
                })()
              ))}
            </section>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
