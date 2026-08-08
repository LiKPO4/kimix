import { useEffect, useRef, useState } from "react";
import { Activity, Cable, Check, ExternalLink, LayoutGrid, Plus, RefreshCw, Sparkles, Store, Upload } from "lucide-react";
import { McpPanel } from "./McpPanel";
import { useAppStore } from "@/stores/appStore";
import type { KimiCodeCapabilityStatus, KimiCodeConfigDiagnostics, KimiCodePluginSummary, KimiCodeMarketplacePlugin, KimiCodeSkillSummary } from "@electron/types/ipc";

type SkillInfo = {
  id: string;
  name: string;
  description: string;
  path: string;
  source: string;
  sourceLabel?: string;
  trustLevel?: "kimi-official" | "curated" | "third-party" | "local";
  enabled: boolean;
};

type PluginPanelTab = "skills" | "mcp";
type SkillsSubTab = "local" | "store" | "runtime";
const OFFICIAL_PLUGIN_STORE_URL = "https://www.kimi.com/code/docs/kimi-code-cli/customization/plugins.html#安装与管理-plugins";
const OFFICIAL_PLUGIN_DOCS_URL = "https://www.kimi.com/code/docs/kimi-code-cli/customization/plugins.html#plugin-manifest";

function asArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

export function SkillsPanel({
  open: _open,
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
  const [skillsSubTab, setSkillsSubTab] = useState<SkillsSubTab>("local");
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [mergedDuplicates, setMergedDuplicates] = useState<{ name: string; keptPath: string; droppedPath: string }[]>([]);
  const [enabledIds, setEnabledIds] = useState<string[]>([]);
  const [enabledDir, setEnabledDir] = useState("");
  const [scanErrors, setScanErrors] = useState<{ path: string; reason: string }[]>([]);
  const [message, setMessage] = useState("正在扫描本地 Skills...");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pluginUrl, setPluginUrl] = useState("");
  const [installingPlugin, setInstallingPlugin] = useState(false);
  const [sdkPlugins, setSdkPlugins] = useState<KimiCodePluginSummary[]>([]);
  const [sdkSkills, setSdkSkills] = useState<KimiCodeSkillSummary[]>([]);
  const [configDiagnostics, setConfigDiagnostics] = useState<KimiCodeConfigDiagnostics>({ warnings: [] });
  const [sdkPluginRefreshing, setSdkPluginRefreshing] = useState(false);
  const [sdkPluginToggling, setSdkPluginToggling] = useState<string | null>(null);
  const [marketplace, setMarketplace] = useState<KimiCodeMarketplacePlugin[]>([]);
  const [installingMarketId, setInstallingMarketId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<KimiCodeCapabilityStatus[]>([]);
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);
  const [installingCapabilityId, setInstallingCapabilityId] = useState<string | null>(null);
  const installPollRef = useRef<number | null>(null);
  const installCapabilityLockRef = useRef(false);
  const installMarketplacePluginLockRef = useRef(false);
  // 安装轮询必须随卸载清理：切走插件页后 interval 不得继续每 2s 轮询 IPC。
  useEffect(() => () => {
    if (installPollRef.current !== null) window.clearInterval(installPollRef.current);
  }, []);
  const [dragActive, setDragActive] = useState(false);
  const selectedTab = onActiveTabChange ? activeTab : localActiveTab;
  const sdkRuntimeSessionId = currentSession?.engine === "kimi-code"
    ? currentSession.runtimeSessionId ?? currentSession.officialSessionId ?? undefined
    : undefined;

  useEffect(() => {
    setLocalActiveTab(activeTab);
  }, [activeTab]);

  const refreshSdkPlugins = async (nextMessage?: string, isCancelled?: () => boolean) => {
    setSdkPluginRefreshing(true);
    const [pluginRes, skillRes, diagnosticsRes] = await Promise.all([
      window.api.listKimiCodePlugins(sdkRuntimeSessionId ? { sessionId: sdkRuntimeSessionId } : {}),
      window.api.listKimiCodeSkills(sdkRuntimeSessionId ? { sessionId: sdkRuntimeSessionId } : {}),
      window.api.getKimiCodeConfigDiagnostics(),
    ]);
    if (isCancelled?.()) return;
    setSdkPluginRefreshing(false);
    if (!pluginRes.success) {
      setMessage(`刷新官方插件状态失败：${pluginRes.error}`);
      return;
    }
    if (!skillRes.success) {
      setMessage(`刷新官方 Skills 状态失败：${skillRes.error}`);
      return;
    }
    const nextPlugins = asArray(pluginRes.data);
    const nextSkills = asArray(skillRes.data);
    setSdkPlugins(nextPlugins);
    setSdkSkills(nextSkills);
    if (diagnosticsRes.success) {
      setConfigDiagnostics(diagnosticsRes.data);
    } else {
      setConfigDiagnostics({ warnings: [`读取配置诊断失败：${diagnosticsRes.error}`] });
    }
    const subSkillCount = nextSkills.filter((skill) => skill.isSubSkill).length;
    setMessage(nextMessage ?? `已从官方运行时读取 ${nextPlugins.length} 个 Plugin、${nextSkills.length} 个 Skill${subSkillCount > 0 ? `（含 ${subSkillCount} 个 Sub-skill）` : ""}`);
  };

  useEffect(() => {
    let cancelled = false;
    void refreshSdkPlugins(undefined, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [sdkRuntimeSessionId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await window.api.listKimiCodeMarketplace();
      if (cancelled) return;
      if (res.success) setMarketplace(asArray(res.data));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshCapabilities = async (isCancelled?: () => boolean) => {
    const res = await window.api.listKimiCodeCapabilities();
    if (isCancelled?.()) return [] as KimiCodeCapabilityStatus[];
    setCapabilitiesLoaded(true);
    if (res.success) {
      const next = asArray(res.data);
      setCapabilities(next);
      return next;
    }
    setMessage(`读取官方内置能力失败：${res.error}`);
    return [] as KimiCodeCapabilityStatus[];
  };

  useEffect(() => {
    if (selectedTab !== "skills" || skillsSubTab !== "store") return;
    let cancelled = false;
    void refreshCapabilities(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [selectedTab, skillsSubTab]);

  const installCapability = async (capability: KimiCodeCapabilityStatus) => {
    if (installCapabilityLockRef.current) return;
    installCapabilityLockRef.current = true;
    try {
      if (installingCapabilityId) return;
      if (installPollRef.current !== null) window.clearInterval(installPollRef.current);
      setInstallingCapabilityId(capability.id);
      setMessage(`正在安装 ${capability.displayName}...`);
      // 安装可能下载托管运行时，期间轮询进度（install.step/percent）。
      // interval 存 ref 并随卸载统一清理，避免切走插件页后继续轮询。
      installPollRef.current = window.setInterval(() => {
        void refreshCapabilities();
      }, 2000);
      const res = await window.api.installKimiCodeCapability({ id: capability.id });
      if (installPollRef.current !== null) {
        window.clearInterval(installPollRef.current);
        installPollRef.current = null;
      }
      setInstallingCapabilityId(null);
      if (!res.success) {
        setMessage(`${capability.displayName} 安装失败：${res.error}`);
        await refreshCapabilities();
        return;
      }
      setMessage(`${capability.displayName} 安装完成`);
      await refreshCapabilities();
      // 安装会接线官方插件，运行时状态一并刷新。
      void refreshSdkPlugins();
    } finally {
      installCapabilityLockRef.current = false;
    }
  };

  const installMarketplacePlugin = async (plugin: KimiCodeMarketplacePlugin) => {
    if (installMarketplacePluginLockRef.current) return;
    installMarketplacePluginLockRef.current = true;
    try {
      if (installingMarketId) return;
      setInstallingMarketId(plugin.id);
      setMessage(`正在安装官方插件 ${plugin.displayName}...`);
      const res = await window.api.installKimiCodePlugin({ source: plugin.source, ...(sdkRuntimeSessionId ? { sessionId: sdkRuntimeSessionId } : {}) });
      setInstallingMarketId(null);
      if (!res.success) {
        setMessage(`${plugin.displayName} 安装失败：${res.error}`);
        return;
      }
      await refreshSdkPlugins(`${plugin.displayName} 安装完成`);
    } finally {
      installMarketplacePluginLockRef.current = false;
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
    const nextSkills = asArray(res.data.skills);
    const nextErrors = asArray(res.data.scanErrors);
    setSkills(nextSkills);
    setMergedDuplicates(asArray(res.data.mergedDuplicates));
    setEnabledIds(asArray(res.data.enabledIds));
    setEnabledDir(res.data.enabledDir);
    setScanErrors(nextErrors);
    const errorHint = nextErrors.length > 0 ? `（${nextErrors.length} 个文件扫描异常）` : "";
    setMessage((nextMessage ?? (nextSkills.length > 0 ? `已发现 ${nextSkills.length} 个本地 Skill` : "未发现本地 Skill")) + errorHint);
  };

  useEffect(() => {
    let cancelled = false;
    setMessage("正在扫描本地 Skills...");
    void window.api.listSkills().then((res) => {
      if (cancelled) return;
      if (!res.success) {
        setMessage(`扫描失败：${res.error}`);
        return;
      }
      const nextSkills = asArray(res.data.skills);
      const nextErrors = asArray(res.data.scanErrors);
      setSkills(nextSkills);
      setMergedDuplicates(asArray(res.data.mergedDuplicates));
      setEnabledIds(asArray(res.data.enabledIds));
      setEnabledDir(res.data.enabledDir);
      setScanErrors(nextErrors);
      const errorHint = nextErrors.length > 0 ? `（${nextErrors.length} 个文件扫描异常）` : "";
      setMessage((nextSkills.length > 0 ? `已发现 ${nextSkills.length} 个本地 Skill` : "未发现本地 Skill") + errorHint);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleSkill = async (id: string) => {
    const next = enabledIds.includes(id)
      ? enabledIds.filter((item) => item !== id)
      : [...enabledIds, id];
    setEnabledIds(next);
    setSaving(true);
    const res = await window.api.saveEnabledSkills({ ids: next });
    setSaving(false);
    if (!res.success) {
      setEnabledIds(enabledIds); // 失败回滚乐观更新，避免 UI 与持久化不一致
      setMessage(`保存失败：${res.error}`);
      return;
    }
    setEnabledIds(res.data.enabledIds);
    setEnabledDir(res.data.enabledDir);
    setMessage(`已启用 ${res.data.enabledIds.length} 个 Skill。新会话将通过 --skills-dir 使用这些 Skill。`);
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
    setSkills(asArray(res.data.skills));
    const importedNames = asArray(res.data.imported).map((skill) => skill.name);
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
    setMessage("正在通过官方运行时安装 Plugin...");
    const res = await window.api.installKimiCodePlugin({ source: url, ...(sdkRuntimeSessionId ? { sessionId: sdkRuntimeSessionId } : {}) });
    setInstallingPlugin(false);
    if (!res.success) {
      setMessage(`Plugin 安装失败：${res.error}`);
      return;
    }
    setPluginUrl("");
    await refreshSdkPlugins(`Plugin 安装完成：${res.data.displayName}`);
  };

  const toggleSdkPlugin = async (plugin: KimiCodePluginSummary) => {
    if (sdkPluginToggling) return;
    const nextEnabled = !plugin.enabled;
    setSdkPluginToggling(plugin.id);
    setSdkPlugins((items) => items.map((item) => item.id === plugin.id ? { ...item, enabled: nextEnabled } : item));
    const res = await window.api.setKimiCodePluginEnabled({
      id: plugin.id,
      enabled: nextEnabled,
      ...(sdkRuntimeSessionId ? { sessionId: sdkRuntimeSessionId } : {}),
    });
    setSdkPluginToggling(null);
    if (!res.success) {
      setSdkPlugins((items) => items.map((item) => item.id === plugin.id ? { ...item, enabled: plugin.enabled } : item));
      setMessage(`切换官方插件失败：${res.error}`);
      return;
    }
    void refreshSdkPlugins(`${plugin.displayName} 已${nextEnabled ? "启用" : "停用"}`);
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

  // 单个来源胶囊：文案用 sourceLabel，配色用 trustLevel，取代旧的双胶囊堆叠。
  const sourceCapsuleMeta = (skill: SkillInfo) => {
    const label = skill.sourceLabel ?? "本地 Skill";
    switch (skill.trustLevel) {
      case "kimi-official":
        return { label, className: "bg-accent-primary text-white" };
      case "curated":
        return { label, className: "bg-accent-success-light text-accent-success" };
      case "third-party":
        return { label, className: "bg-accent-warning-light text-accent-warning" };
      default:
        return { label, className: "bg-[var(--kimix-panel-badge-bg)] text-[var(--kimix-panel-badge-text)]" };
    }
  };

  const capabilityStateMeta = (capability: KimiCodeCapabilityStatus) => {
    if (!capability.supported || capability.state === "unsupported") {
      return { label: "不支持", className: "bg-[var(--kimix-panel-badge-bg)] text-[var(--kimix-panel-badge-text)]" };
    }
    switch (capability.state) {
      case "ready":
        return { label: "就绪", className: "bg-accent-success-light text-accent-success" };
      case "partial":
        return { label: "部分就绪", className: "bg-accent-warning-light text-accent-warning" };
      default:
        return { label: "未安装", className: "bg-[var(--kimix-panel-badge-bg)] text-[var(--kimix-panel-badge-text)]" };
    }
  };

  const sdkPluginSourceLabel = (source: KimiCodePluginSummary["source"]) => {
    if (source === "github") return "GitHub";
    if (source === "zip-url") return "ZIP";
    return "本地";
  };

  const sdkPluginStateLabel = (plugin: KimiCodePluginSummary) => {
    if (plugin.hasErrors || plugin.state === "error") return "异常";
    return plugin.enabled ? "已启用" : "已停用";
  };

  const configWarnings = asArray(configDiagnostics.warnings).filter((warning) => warning.trim().length > 0);
  const subSkillCount = sdkSkills.filter((skill) => skill.isSubSkill).length;

  const subTabs: { id: SkillsSubTab; label: string; icon: React.ReactNode }[] = [
    { id: "local", label: "本地 Skills", icon: <Sparkles size={14} /> },
    { id: "store", label: "插件商店", icon: <Store size={14} /> },
    { id: "runtime", label: "运行时状态", icon: <Activity size={14} /> },
  ];

  return (
    <div className="kimix-workspace-page flex h-full min-h-0 flex-col">
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
        <div className="kimix-workspace-header">
          <div className="kimix-workspace-header-copy">
            <div className="kimix-workspace-header-title">
              <LayoutGrid size={20} />
              <span>插件</span>
              <div className="kimix-workspace-header-subtitle">
                管理 Kimix 扩展能力：Skills 负责本地能力包，MCP 负责外部工具服务。
              </div>
            </div>
          </div>
          <div className="kimix-workspace-header-actions">
            {selectedTab === "skills" && skillsSubTab === "local" && (
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
        <div className="kimix-workspace-body">
          <div className="kimix-workspace-content">
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
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center" style={{ gap: 8, marginBottom: 14 }}>
              {subTabs.map((tab) => {
                const active = skillsSubTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSkillsSubTab(tab.id)}
                    className={`kimix-icon-text-button is-compact ${active ? "" : "kimix-muted-action"}`}
                    style={active ? {
                      background: "var(--kimix-panel-soft-bg)",
                      color: "var(--kimix-panel-text)",
                      boxShadow: "inset 0 0 0 1px var(--kimix-panel-border-soft)",
                    } : undefined}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
            {message && (
              <div
                className="rounded-lg bg-[var(--kimix-panel-soft-bg)] text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]"
                style={{ padding: "8px 14px", marginBottom: 14 }}
              >
                {message}{saving ? "，正在保存..." : ""}
              </div>
            )}

            {skillsSubTab === "local" && (
              <div className="flex min-w-0 flex-col">
                <div className="text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ marginBottom: 14 }}>
                  勾选后全局启用 Skill；新建/恢复会话时通过官方 <code>--skills-dir</code> 传给 Kimi Code。
                  {enabledDir && (
                    <span className="text-[var(--kimix-panel-text-muted)]" title={enabledDir}>（启用目录：{enabledDir}）</span>
                  )}
                </div>
                {mergedDuplicates.length > 0 && (
                  <div
                    className="rounded-lg bg-[var(--kimix-panel-soft-bg)] text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]"
                    style={{ padding: "8px 14px", marginBottom: 14 }}
                    title={mergedDuplicates.map((item) => `${item.name}：保留 ${item.keptPath}，合并 ${item.droppedPath}`).join("\n")}
                  >
                    {mergedDuplicates.length} 个同名 Skill 已按来源合并展示（悬停查看明细）
                  </div>
                )}
                {skills.length === 0 ? (
                  <div className="kimix-soft-card rounded-xl text-[13.5px] leading-6 text-[var(--kimix-panel-text-secondary)]" style={{ padding: "24px 22px" }}>
                    未发现本地 Skill。可点击右上角「添加」导入 Skill 压缩包，或直接把 .zip 拖进本页面。
                  </div>
                ) : (
                  <section className="grid min-w-0 items-start" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                    {skills.map((skill) => (
                      (() => {
                        const source = sourceCapsuleMeta(skill);
                        const officialPlugin = skill.trustLevel === "kimi-official" && skill.sourceLabel === "Kimi Plugin";
                        const enabled = officialPlugin || enabledIds.includes(skill.id);
                        return (
                      <button
                        key={skill.id}
                        type="button"
                        onClick={() => {
                          if (!officialPlugin) void toggleSkill(skill.id);
                        }}
                        className={`kimix-skill-card w-full overflow-hidden rounded-xl border text-left hover:bg-[var(--kimix-panel-soft-bg)] ${enabled ? "border-[var(--accent-blue)]" : "border-[var(--kimix-panel-border-soft)] bg-surface-elevated"}`}
                        style={{
                          padding: "14px 18px",
                          cursor: officialPlugin ? "default" : undefined,
                          background: enabled
                            ? "color-mix(in srgb, var(--accent-blue) 8%, var(--kimix-panel-bg))"
                            : undefined,
                        }}
                      >
                        <div className="grid min-h-0" style={{ gridTemplateColumns: "22px minmax(0, 1fr) auto", gap: 12 }}>
                          <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${enabled ? "border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white" : "border-[var(--kimix-selection-idle-border)] text-transparent"}`}>
                            <Check size={13} />
                          </span>
                          <span className="flex min-h-0 min-w-0 flex-col">
                            <span
                              className="block min-w-0 text-[15px] font-semibold text-[var(--kimix-panel-text)]"
                              style={{ lineHeight: "24px", minHeight: 24, overflowWrap: "anywhere" }}
                              title={skill.name}
                            >
                              {skill.name}
                            </span>
                            <span className="mt-2 flex min-w-0 flex-wrap items-center" style={{ gap: 6 }}>
                              <span className={`h-6 shrink-0 rounded-full text-[12px] font-medium leading-6 ${source.className}`} style={{ paddingLeft: 9, paddingRight: 9 }} title={skill.source}>
                                {source.label}
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
                )}
                {scanErrors.length > 0 && (
                  <div className="rounded-xl bg-accent-warning-light/40 text-[13px] leading-6" style={{ padding: "14px 16px", marginTop: 14 }}>
                    <div className="font-medium text-accent-warning">{scanErrors.length} 个文件扫描异常</div>
                    <div className="flex flex-col" style={{ gap: 8, marginTop: 10 }}>
                      {scanErrors.slice(0, 5).map((error, index) => (
                        <div key={`${index}:${error.path}`} className="rounded-md bg-surface-elevated text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ padding: "8px 10px" }} title={`${error.reason}: ${error.path}`}>
                          <div className="truncate">{error.reason}</div>
                          <div className="truncate text-[var(--kimix-panel-text-muted)]">{error.path}</div>
                        </div>
                      ))}
                      {scanErrors.length > 5 && (
                        <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">还有 {scanErrors.length - 5} 个异常文件未展示</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {skillsSubTab === "store" && (
              <div className="flex min-w-0 flex-col" style={{ gap: 14 }}>
                <div className="kimix-soft-card rounded-xl" style={{ padding: "16px 18px" }}>
                  <div className="font-medium text-[var(--kimix-panel-text)]">官方内置能力</div>
                  <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 4 }}>
                    Kimi Code 官方产品能力（托管运行时 + 接线插件），由 v2 引擎提供，安装后可中断重试。
                  </div>
                  {capabilities.length > 0 ? (
                    <div className="flex flex-col" style={{ gap: 10, marginTop: 12 }}>
                      {capabilities.map((capability) => {
                        const state = capabilityStateMeta(capability);
                        const busy = installingCapabilityId === capability.id || capability.install.running;
                        const installable = capability.supported && capability.state !== "ready" && capability.state !== "unsupported";
                        return (
                          <div key={capability.id} className="rounded-lg bg-[var(--kimix-panel-soft-bg)]" style={{ padding: "12px 14px" }}>
                            <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                              <div className="min-w-0">
                                <div className="flex items-center" style={{ gap: 8 }}>
                                  <span className="truncate font-medium text-[var(--kimix-panel-text)]">{capability.displayName}</span>
                                  <span className={`h-6 shrink-0 rounded-full text-[12px] leading-6 ${state.className}`} style={{ paddingLeft: 9, paddingRight: 9 }}>
                                    {state.label}
                                  </span>
                                </div>
                                <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 4 }}>
                                  {capability.description}
                                </div>
                                {busy && (capability.install.step || typeof capability.install.percent === "number") && (
                                  <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 4 }}>
                                    安装中{capability.install.step ? `：${capability.install.step}` : ""}
                                    {typeof capability.install.percent === "number" ? ` ${capability.install.percent}%` : ""}
                                  </div>
                                )}
                                {!busy && capability.install.error && (
                                  <div className="text-[12px] leading-5 text-accent-danger" style={{ marginTop: 4 }}>
                                    上次安装失败：{capability.install.error}
                                  </div>
                                )}
                              </div>
                              {installable && (
                                <button
                                  type="button"
                                  onClick={() => void installCapability(capability)}
                                  disabled={Boolean(installingCapabilityId)}
                                  className="kimix-plugin-status-pill shrink-0 bg-accent-primary text-[12px] leading-6 text-white disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {busy ? "安装中" : capability.state === "partial" || capability.install.error ? "继续安装" : "安装"}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 10 }}>
                      {capabilitiesLoaded ? "当前引擎未提供内置能力（需要 SDK v2 引擎）。" : "正在读取内置能力状态..."}
                    </div>
                  )}
                </div>

                <div className="kimix-soft-card rounded-xl" style={{ padding: "16px 18px" }}>
                  <div className="font-medium text-[var(--kimix-panel-text)]">官方插件商店</div>
                  <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 4 }}>
                    官方 Marketplace 在架插件，可一键安装到 Kimi Code。
                  </div>
                  {marketplace.length > 0 ? (
                    <div className="flex flex-col" style={{ gap: 10, marginTop: 12 }}>
                      {marketplace.map((plugin) => {
                        const installed = sdkPlugins.some((p) => p.id === plugin.id);
                        return (
                          <div key={plugin.id} className="rounded-lg bg-[var(--kimix-panel-soft-bg)]" style={{ padding: "12px 14px" }}>
                            <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                              <div className="min-w-0">
                                <div className="truncate font-medium text-[var(--kimix-panel-text)]">
                                  {plugin.displayName}
                                  {plugin.version && <span className="text-[12px] text-[var(--kimix-panel-text-muted)]"> v{plugin.version}</span>}
                                </div>
                                <div className="truncate text-[12px] text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 2 }} title={plugin.description}>{plugin.description}</div>
                              </div>
                              <button
                                type="button"
                                onClick={() => void installMarketplacePlugin(plugin)}
                                disabled={Boolean(installingMarketId) || installed}
                                className="kimix-plugin-status-pill shrink-0 bg-accent-primary text-[12px] leading-6 text-white disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {installed ? "已安装" : installingMarketId === plugin.id ? "安装中" : "安装"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 10 }}>
                      未能读取官方 Marketplace 列表（可检查网络后重新打开本页）。
                    </div>
                  )}
                  <div className="flex" style={{ gap: 10, marginTop: 14 }}>
                    <button
                      type="button"
                      onClick={() => void openOfficialPluginStore()}
                      className="kimix-icon-text-button kimix-muted-action is-compact"
                    >
                      <ExternalLink size={14} />
                      <span>打开官方 Marketplace</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void openPluginDocs()}
                      className="kimix-icon-text-button kimix-muted-action is-compact"
                    >
                      <ExternalLink size={14} />
                      <span>自定义插件文档</span>
                    </button>
                  </div>
                </div>

                <div className="kimix-soft-card rounded-xl" style={{ padding: "16px 18px" }}>
                  <div className="font-medium text-[var(--kimix-panel-text)]">自定义安装</div>
                  <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 4 }}>
                    输入官方支持的 GitHub / ZIP plugin URL，安装后会自动刷新列表。
                  </div>
                  <div className="flex items-center" style={{ gap: 10, marginTop: 12 }}>
                    <input
                      value={pluginUrl}
                      onChange={(event) => setPluginUrl(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !installingPlugin) void installKimiPlugin();
                      }}
                      placeholder="https://github.com/owner/repo 或 https://.../plugin.zip"
                      className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[13px] text-[var(--kimix-panel-text)] outline-none focus:border-[var(--accent-blue)]"
                      style={{ paddingLeft: 12, paddingRight: 12 }}
                    />
                    <button
                      type="button"
                      onClick={() => void installKimiPlugin()}
                      disabled={installingPlugin}
                      className="kimix-icon-text-button kimix-muted-action is-compact shrink-0 disabled:cursor-wait disabled:opacity-50"
                    >
                      <Plus size={14} />
                      <span>{installingPlugin ? "安装中" : "安装 Plugin"}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {skillsSubTab === "runtime" && (
              <div className="flex min-w-0 flex-col" style={{ gap: 14 }}>
                <div className="kimix-soft-card rounded-xl" style={{ padding: "16px 18px" }}>
                  <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: 10 }}>
                    <div className="min-w-0 font-medium text-[var(--kimix-panel-text)]">官方运行时插件</div>
                    <span className="shrink-0 rounded-full bg-accent-primary text-[12px] leading-5 text-white" style={{ paddingLeft: 8, paddingRight: 8 }}>
                      SDK
                    </span>
                    <button
                      type="button"
                      onClick={() => void refreshSdkPlugins("已刷新官方运行时插件状态")}
                      disabled={sdkPluginRefreshing || Boolean(sdkPluginToggling)}
                      className="kimix-icon-text-button kimix-muted-action is-compact shrink-0 disabled:cursor-wait disabled:opacity-50"
                    >
                      <RefreshCw size={14} className={sdkPluginRefreshing ? "kimix-spin" : ""} />
                      <span>{sdkPluginRefreshing ? "刷新中" : "刷新"}</span>
                    </button>
                  </div>
                  {sdkPlugins.length > 0 ? (
                    <div className="flex flex-col" style={{ gap: 10, marginTop: 12 }}>
                      {sdkPlugins.map((plugin) => (
                        <div key={plugin.id} className="rounded-lg bg-[var(--kimix-panel-soft-bg)]" style={{ padding: "12px 14px" }}>
                          <div className="grid items-start" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-[var(--kimix-panel-text)]">{plugin.displayName}</div>
                              <div className="truncate text-[12px] text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 2 }} title={plugin.id}>
                                {plugin.id}
                                {plugin.version ? ` · v${plugin.version}` : ""}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void toggleSdkPlugin(plugin)}
                              disabled={Boolean(sdkPluginToggling)}
                              className={`kimix-plugin-status-pill shrink-0 text-[12px] leading-5 disabled:cursor-wait disabled:opacity-50 ${plugin.enabled ? "bg-accent-primary text-white" : "bg-[var(--kimix-panel-badge-bg)] text-[var(--kimix-panel-badge-text)]"}`}
                            >
                              {sdkPluginToggling === plugin.id ? "处理中" : sdkPluginStateLabel(plugin)}
                            </button>
                          </div>
                          <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 9 }}>
                            <div className="rounded-md bg-surface-elevated text-center" style={{ padding: "5px 7px" }}>
                              <div className="text-[11px] leading-4 text-[var(--kimix-panel-text-muted)]">来源</div>
                              <div className="truncate font-medium text-[var(--kimix-panel-text)]">{sdkPluginSourceLabel(plugin.source)}</div>
                            </div>
                            <div className="rounded-md bg-surface-elevated text-center" style={{ padding: "5px 7px" }}>
                              <div className="text-[11px] leading-4 text-[var(--kimix-panel-text-muted)]">Skills</div>
                              <div className="truncate font-medium text-[var(--kimix-panel-text)]">{plugin.skillCount}</div>
                            </div>
                            <div className="rounded-md bg-surface-elevated text-center" style={{ padding: "5px 7px" }}>
                              <div className="text-[11px] leading-4 text-[var(--kimix-panel-text-muted)]">MCP</div>
                              <div className="truncate font-medium text-[var(--kimix-panel-text)]">{plugin.enabledMcpServerCount}/{plugin.mcpServerCount}</div>
                            </div>
                          </div>
                          {plugin.originalSource && (
                            <div className="truncate text-[12px] text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 7 }} title={plugin.originalSource}>
                              {plugin.originalSource}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 10 }}>
                      当前官方运行时没有已安装 Plugin，或尚未刷新。
                    </div>
                  )}
                </div>

                <div className="grid min-w-0 items-start" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
                  <div className="kimix-soft-card rounded-xl" style={{ padding: "16px 18px" }}>
                    <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                      <div className="min-w-0 font-medium text-[var(--kimix-panel-text)]">配置诊断</div>
                      <span className={`shrink-0 rounded-full text-[12px] leading-5 ${configWarnings.length > 0 ? "bg-accent-warning text-white" : "bg-accent-success-light text-accent-success"}`} style={{ paddingLeft: 8, paddingRight: 8 }}>
                        {configWarnings.length > 0 ? `${configWarnings.length} 条警告` : "正常"}
                      </span>
                    </div>
                    {configWarnings.length > 0 ? (
                      <div className="flex flex-col" style={{ gap: 8, marginTop: 10 }}>
                        {configWarnings.slice(0, 4).map((warning, index) => (
                          <div
                            key={`${index}:${warning}`}
                            className="rounded-md bg-surface-elevated text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]"
                            style={{ padding: "8px 10px" }}
                            title={warning}
                          >
                            {warning}
                          </div>
                        ))}
                        {configWarnings.length > 4 && (
                          <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">还有 {configWarnings.length - 4} 条配置警告未展示</div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 8 }}>
                        官方运行时当前没有返回配置警告。
                      </div>
                    )}
                  </div>

                  <div className="kimix-soft-card rounded-xl" style={{ padding: "16px 18px" }}>
                    <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                      <div className="min-w-0 font-medium text-[var(--kimix-panel-text)]">已加载 Skills</div>
                      <span className="shrink-0 rounded-full bg-[var(--kimix-panel-badge-bg)] text-[12px] leading-5 text-[var(--kimix-panel-badge-text)]" style={{ paddingLeft: 8, paddingRight: 8 }}>
                        {sdkSkills.length}{subSkillCount > 0 ? ` / ${subSkillCount} 子` : ""}
                      </span>
                    </div>
                    {sdkSkills.length > 0 ? (
                      <div className="flex flex-col" style={{ gap: 7, marginTop: 9 }}>
                        {sdkSkills.slice(0, 5).map((skill) => (
                          <div key={`${skill.source}:${skill.name}`} className="min-w-0">
                            <div className="flex min-w-0 items-center" style={{ gap: 6 }}>
                              <div className="truncate text-[13px] font-medium leading-5 text-[var(--kimix-panel-text)]" title={skill.name}>{skill.name}</div>
                              {skill.isSubSkill && (
                                <span className="shrink-0 rounded-full bg-[var(--kimix-panel-badge-bg)] text-[11px] leading-5 text-[var(--kimix-panel-badge-text)]" style={{ paddingLeft: 7, paddingRight: 7 }}>
                                  Sub-skill
                                </span>
                              )}
                            </div>
                            <div className="truncate text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]" title={skill.path}>
                              {skill.type ?? "skill"} · {skill.source}
                            </div>
                          </div>
                        ))}
                        {sdkSkills.length > 5 && (
                          <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">还有 {sdkSkills.length - 5} 个 Skill 未展示</div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 8 }}>
                        当前官方会话没有加载 Skill，或尚未刷新。
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
