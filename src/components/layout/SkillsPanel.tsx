import { useEffect, useState } from "react";
import { Cable, Check, ExternalLink, LayoutGrid, Plus, RefreshCw, Sparkles, Upload } from "lucide-react";
import { McpPanel } from "./McpPanel";
import { useAppStore } from "@/stores/appStore";
import { getRuntimeSessionId } from "@/utils/runtimeSession";
import type { KimiCodePluginSummary, KimiCodeMarketplacePlugin, KimiCodeSkillSummary } from "@electron/types/ipc";

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
  const [sdkPlugins, setSdkPlugins] = useState<KimiCodePluginSummary[]>([]);
  const [sdkSkills, setSdkSkills] = useState<KimiCodeSkillSummary[]>([]);
  const [sdkPluginRefreshing, setSdkPluginRefreshing] = useState(false);
  const [sdkPluginToggling, setSdkPluginToggling] = useState<string | null>(null);
  const [marketplace, setMarketplace] = useState<KimiCodeMarketplacePlugin[]>([]);
  const [installingMarketId, setInstallingMarketId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const selectedTab = onActiveTabChange ? activeTab : localActiveTab;
  const sdkRuntimeSessionId = currentSession?.engine === "kimi-code" ? getRuntimeSessionId(currentSession) : undefined;

  useEffect(() => {
    setLocalActiveTab(activeTab);
  }, [activeTab]);

  const refreshSdkPlugins = async (nextMessage?: string) => {
    setSdkPluginRefreshing(true);
    const [pluginRes, skillRes] = await Promise.all([
      window.api.listKimiCodePlugins(sdkRuntimeSessionId ? { sessionId: sdkRuntimeSessionId } : {}),
      window.api.listKimiCodeSkills(sdkRuntimeSessionId ? { sessionId: sdkRuntimeSessionId } : {}),
    ]);
    setSdkPluginRefreshing(false);
    if (!pluginRes.success) {
      setMessage(`刷新 SDK 插件状态失败：${pluginRes.error}`);
      return;
    }
    if (!skillRes.success) {
      setMessage(`刷新 SDK Skills 状态失败：${skillRes.error}`);
      return;
    }
    setSdkPlugins(pluginRes.data);
    setSdkSkills(skillRes.data);
    setMessage(nextMessage ?? `已从官方 SDK 读取 ${pluginRes.data.length} 个 Plugin、${skillRes.data.length} 个 Skill`);
  };

  useEffect(() => {
    if (!open) {
      setSdkPlugins([]);
      setSdkSkills([]);
      return;
    }
    void refreshSdkPlugins();
  }, [open, sdkRuntimeSessionId]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const res = await window.api.listKimiCodeMarketplace();
      if (res.success) setMarketplace(res.data);
    })();
  }, [open]);

  const installMarketplacePlugin = async (plugin: KimiCodeMarketplacePlugin) => {
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
    setMessage("正在通过官方 SDK 安装 Plugin...");
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
      setMessage(`切换 SDK Plugin 失败：${res.error}`);
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

  const sdkPluginSourceLabel = (source: KimiCodePluginSummary["source"]) => {
    if (source === "github") return "GitHub";
    if (source === "zip-url") return "ZIP";
    return "本地";
  };

  const sdkPluginStateLabel = (plugin: KimiCodePluginSummary) => {
    if (plugin.hasErrors || plugin.state === "error") return "异常";
    return plugin.enabled ? "已启用" : "已停用";
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
                勾选后全局启用 Skill；新建/恢复会话时通过官方 `--skills-dir` 传给 Kimi Code。
              </div>
              <div className="kimix-soft-card rounded-xl text-[13px] leading-6" style={{ padding: "14px 16px" }}>
                <div className="font-medium text-[var(--kimix-panel-text)]">官方插件商店</div>
                <div className="text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 6 }}>
                  以下为官方 Marketplace 在架插件，可一键安装到 Kimi Code SDK（含 Superpowers）。
                </div>
                {marketplace.length > 0 && (
                  <div className="flex flex-col" style={{ gap: 8, marginTop: 12 }}>
                    {marketplace.map((plugin) => {
                      const installed = sdkPlugins.some((p) => p.id === plugin.id);
                      return (
                        <div
                          key={plugin.id}
                          className="rounded-lg border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)]"
                          style={{ padding: "10px 12px" }}
                        >
                          <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-[var(--kimix-panel-text)]">{plugin.displayName} <span className="text-[12px] text-[var(--kimix-panel-text-muted)]">v{plugin.version}</span></div>
                              <div className="truncate text-[12px] text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 2 }} title={plugin.description}>{plugin.description}</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void installMarketplacePlugin(plugin)}
                              disabled={Boolean(installingMarketId) || installed}
                              className="shrink-0 rounded-full bg-accent-primary text-[12px] leading-6 text-white disabled:cursor-not-allowed disabled:opacity-50"
                              style={{ paddingLeft: 10, paddingRight: 10 }}
                            >
                              {installed ? "已安装" : installingMarketId === plugin.id ? "安装中" : "安装"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
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
                </div>
              </div>
              <div className="kimix-soft-card rounded-xl text-[13px] leading-6" style={{ padding: "14px 16px" }}>
                <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                  <div className="min-w-0 font-medium text-[var(--kimix-panel-text)]">官方 SDK 插件状态</div>
                    <span className="shrink-0 rounded-full bg-accent-primary text-[12px] leading-5 text-white" style={{ paddingLeft: 8, paddingRight: 8 }}>
                      SDK
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshSdkPlugins("已刷新官方 SDK 插件状态")}
                    disabled={sdkPluginRefreshing || Boolean(sdkPluginToggling)}
                    className="kimix-icon-text-button kimix-muted-action is-compact justify-center disabled:cursor-wait disabled:opacity-50"
                    style={{ width: "100%", marginTop: 12 }}
                  >
                    <RefreshCw size={14} className={sdkPluginRefreshing ? "kimix-spin" : ""} />
                    <span>{sdkPluginRefreshing ? "刷新中" : "刷新 SDK 状态"}</span>
                  </button>
                  <div
                    className="rounded-lg border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)]"
                    style={{ padding: "10px 12px", marginTop: 12 }}
                  >
                    <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                      <div className="min-w-0 font-medium text-[var(--kimix-panel-text)]">已加载 Skills</div>
                      <span className="shrink-0 rounded-full bg-[var(--kimix-panel-badge-bg)] text-[12px] leading-5 text-[var(--kimix-panel-badge-text)]" style={{ paddingLeft: 8, paddingRight: 8 }}>
                        {sdkSkills.length}
                      </span>
                    </div>
                    {sdkSkills.length > 0 ? (
                      <div className="flex flex-col" style={{ gap: 7, marginTop: 9 }}>
                        {sdkSkills.slice(0, 5).map((skill) => (
                          <div key={`${skill.source}:${skill.name}`} className="min-w-0">
                            <div className="truncate text-[13px] font-medium leading-5 text-[var(--kimix-panel-text)]" title={skill.name}>{skill.name}</div>
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
                      <div className="text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 8 }}>
                        当前 SDK 会话没有加载 Skill，或尚未刷新。
                      </div>
                    )}
                  </div>
                  {sdkPlugins.length > 0 ? (
                    <div className="flex flex-col" style={{ gap: 8, marginTop: 12 }}>
                      {sdkPlugins.map((plugin) => (
                        <div
                          key={plugin.id}
                          className="rounded-lg border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)]"
                          style={{ padding: "10px 12px" }}
                        >
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
                              className={`shrink-0 rounded-full text-[12px] leading-5 disabled:cursor-wait disabled:opacity-50 ${plugin.enabled ? "bg-accent-primary text-white" : "bg-[var(--kimix-panel-badge-bg)] text-[var(--kimix-panel-badge-text)]"}`}
                              style={{ paddingLeft: 9, paddingRight: 9 }}
                            >
                              {sdkPluginToggling === plugin.id ? "处理中" : sdkPluginStateLabel(plugin)}
                            </button>
                          </div>
                          <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 9 }}>
                            <div className="rounded-md bg-[var(--kimix-panel-soft-bg)] text-center" style={{ padding: "5px 7px" }}>
                              <div className="text-[11px] leading-4 text-[var(--kimix-panel-text-muted)]">来源</div>
                              <div className="truncate font-medium text-[var(--kimix-panel-text)]">{sdkPluginSourceLabel(plugin.source)}</div>
                            </div>
                            <div className="rounded-md bg-[var(--kimix-panel-soft-bg)] text-center" style={{ padding: "5px 7px" }}>
                              <div className="text-[11px] leading-4 text-[var(--kimix-panel-text-muted)]">Skills</div>
                              <div className="truncate font-medium text-[var(--kimix-panel-text)]">{plugin.skillCount}</div>
                            </div>
                            <div className="rounded-md bg-[var(--kimix-panel-soft-bg)] text-center" style={{ padding: "5px 7px" }}>
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
                    <div className="text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 10 }}>
                      当前 SDK 会话没有已安装 Plugin，或尚未刷新。
                    </div>
                  )}
              </div>
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
