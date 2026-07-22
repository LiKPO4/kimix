import { useEffect, useState } from "react";
import { Cable, ChevronDown, ChevronUp, KeyRound, Plus, RefreshCw, ShieldCheck, TestTube2, Trash2 } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import type { KimiCodeMarketplacePlugin, KimiCodeMcpServerInfo, KimiCodePluginSummary, KimiCodeServerAgentInfo, KimiCodeServerRuntimeDiagnostics } from "@electron/types/ipc";

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

type McpServerInfo = {
  name: string;
  transport: "http" | "sse" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  auth?: string;
};

type PluginMcpServerInfo = McpServerInfo & {
  pluginId: string;
  pluginName: string;
  pluginPath: string;
  manifestPath: string;
  enabled: boolean;
};

type KeyValueItem = {
  id: string;
  key: string;
  value: string;
};

type AddFormState = {
  name: string;
  transport: "http" | "sse" | "stdio";
  url: string;
  command: string;
  args: string[];
  envItems: KeyValueItem[];
  headerItems: KeyValueItem[];
  authOauth: boolean;
};

const KIMI_AUTH_CHANGED_EVENT = "kimix:kimi-auth-changed";

function createKeyValueItem(): KeyValueItem {
  return {
    id: crypto.randomUUID(),
    key: "",
    value: "",
  };
}

function createEmptyForm(): AddFormState {
  return {
    name: "",
    transport: "http",
    url: "",
    command: "",
    args: [""],
    envItems: [createKeyValueItem()],
    headerItems: [createKeyValueItem()],
    authOauth: false,
  };
}

function normalizeArgs(items: string[]) {
  return items.map((item) => item.trim()).filter(Boolean);
}

function normalizeKeyValueItems(items: KeyValueItem[], separator: "=" | ":") {
  return items
    .map((item) => {
      const key = item.key.trim();
      const value = item.value.trim();
      return key ? `${key}${separator}${value}` : "";
    })
    .filter(Boolean);
}

function summarizeServer(server: McpServerInfo) {
  if (server.transport === "http" || server.transport === "sse") {
    return server.url || "未配置 URL";
  }
  const args = server.args && server.args.length > 0 ? ` ${server.args.join(" ")}` : "";
  return `${server.command || "未配置命令"}${args}`;
}

function KeyValueListEditor({
  title,
  placeholderKey,
  placeholderValue,
  items,
  onChange,
  separator,
}: {
  title: string;
  placeholderKey: string;
  placeholderValue: string;
  items: KeyValueItem[];
  onChange: (items: KeyValueItem[]) => void;
  separator: "=" | ":";
}) {
  const patchItem = (id: string, patch: Partial<KeyValueItem>) => {
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const removeItem = (id: string) => {
    const next = items.filter((item) => item.id !== id);
    onChange(next.length > 0 ? next : [createKeyValueItem()]);
  };

  return (
    <div className="min-w-0">
      <div className="text-[13px] text-[var(--kimix-panel-text-secondary)]">{title}</div>
      <div className="mt-2 flex flex-col" style={{ gap: 10 }}>
        {items.map((item) => (
          <div
            key={item.id}
            className="grid min-w-0 items-center"
            style={{ gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr) auto", gap: 12 }}
          >
            <input
              value={item.key}
              onChange={(event) => patchItem(item.id, { key: event.target.value })}
              placeholder={placeholderKey}
              className="h-10 min-w-0 rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[14px] text-[var(--kimix-panel-text)] outline-none"
              style={{ paddingLeft: 18, paddingRight: 18 }}
            />
            <div className="text-[13px] text-[var(--kimix-panel-text-muted)]">{separator}</div>
            <input
              value={item.value}
              onChange={(event) => patchItem(item.id, { value: event.target.value })}
              placeholder={placeholderValue}
              className="h-10 min-w-0 rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[14px] text-[var(--kimix-panel-text)] outline-none"
              style={{ paddingLeft: 18, paddingRight: 18 }}
            />
            <button
              type="button"
              onClick={() => removeItem(item.id)}
              className="kimix-muted-action flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              aria-label={`删除${title}项`}
              title={`删除${title}项`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...items, createKeyValueItem()])}
          className="kimix-icon-text-button kimix-muted-action is-compact self-start"
        >
          <Plus size={14} />
          <span>添加一项</span>
        </button>
      </div>
    </div>
  );
}

export function McpPanel({ onBackToChat, embedded = false }: { onBackToChat?: () => void; embedded?: boolean }) {
  const currentSession = useAppStore((state) => state.currentSession);
  const runtimeSessionId = currentSession?.engine === "kimi-code"
    ? currentSession.runtimeSessionId ?? currentSession.officialSessionId ?? undefined
    : undefined;
  const [auth, setAuth] = useState<KimiAuthStatus | null>(null);
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [pluginServers, setPluginServers] = useState<PluginMcpServerInfo[]>([]);
  const [configPath, setConfigPath] = useState("");
  const [message, setMessage] = useState("正在读取 Kimi Code 与 MCP 状态...");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<AddFormState>(() => createEmptyForm());
  const [lastTestOutput, setLastTestOutput] = useState<Record<string, string>>({});
  const [runtimeServers, setRuntimeServers] = useState<KimiCodeMcpServerInfo[]>([]);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<KimiCodeServerRuntimeDiagnostics | null>(null);
  const [sdkPlugins, setSdkPlugins] = useState<KimiCodePluginSummary[]>([]);
  const [marketplacePlugins, setMarketplacePlugins] = useState<KimiCodeMarketplacePlugin[]>([]);
  const [cardMessages, setCardMessages] = useState<Record<string, string>>({});
  const [toolsExpanded, setToolsExpanded] = useState(false);

  const refresh = async (nextMessage?: string) => {
    setLoading(true);
    const [authRes, listRes, runtimeRes, diagnosticsRes, pluginRes, marketplaceRes] = await Promise.all([
      window.api.getKimiAuthStatus(),
      window.api.listMcpServers(),
      runtimeSessionId
        ? window.api.listKimiCodeMcpServers({ sessionId: runtimeSessionId })
        : Promise.resolve(null),
      runtimeSessionId
        ? window.api.getKimiCodeServerRuntimeDiagnostics({ sessionId: runtimeSessionId })
        : Promise.resolve(null),
      window.api.listKimiCodePlugins(runtimeSessionId ? { sessionId: runtimeSessionId } : {}),
      window.api.listKimiCodeMarketplace(),
    ]);
    setLoading(false);
    if (!authRes.success) {
      setMessage(`读取登录状态失败：${authRes.error}`);
      return;
    }
    if (!listRes.success) {
      setAuth(authRes.data);
      setMessage(`读取 MCP 配置失败：${listRes.error}`);
      return;
    }
    setAuth(authRes.data);
    setServers(listRes.data.servers);
    setPluginServers(listRes.data.pluginServers ?? []);
    setSdkPlugins(pluginRes.success ? pluginRes.data : []);
    setMarketplacePlugins(marketplaceRes.success ? marketplaceRes.data : []);
    setRuntimeDiagnostics(diagnosticsRes?.success ? diagnosticsRes.data : null);
    setRuntimeServers(diagnosticsRes?.success ? diagnosticsRes.data.mcpServers : runtimeRes?.success ? runtimeRes.data : []);
    setConfigPath(listRes.data.configPath);
    setMessage(nextMessage ?? authRes.data.message);
  };

  useEffect(() => {
    void refresh();
  }, [runtimeSessionId]);

  useEffect(() => {
    const handleAuthChanged = () => {
      void refresh();
    };
    window.addEventListener(KIMI_AUTH_CHANGED_EVENT, handleAuthChanged);
    return () => window.removeEventListener(KIMI_AUTH_CHANGED_EVENT, handleAuthChanged);
  }, []);

  const runBusy = async (key: string, action: () => Promise<void>) => {
    setBusyAction(key);
    try {
      await action();
    } finally {
      setBusyAction(null);
    }
  };

  const setCardMessage = (key: string, value: string) => {
    setCardMessages((current) => ({ ...current, [key]: value }));
  };

  const handleRestartRuntimeServer = async (server: KimiCodeMcpServerInfo) => {
    if (!runtimeSessionId) return;
    const cardKey = `runtime:${server.id ?? server.name}`;
    await runBusy(`restart-runtime:${server.id ?? server.name}`, async () => {
      setCardMessage(cardKey, `正在重启 ${server.name}...`);
      const res = await window.api.reconnectKimiCodeMcpServer({
        sessionId: runtimeSessionId,
        name: server.id ?? server.name,
      });
      if (!res.success) {
        setCardMessage(cardKey, `重启失败：${res.error}`);
        setMessage(`重启 ${server.name} 失败：${res.error}`);
        return;
      }
      setCardMessage(cardKey, `已请求重启 ${server.name}`);
      await refresh(`已请求官方 Server 重启 ${server.name}`);
    });
  };
  const runtimeToolCounts = runtimeDiagnostics?.tools.reduce((counts, tool) => {
    counts[tool.source] += 1;
    return counts;
  }, { builtin: 0, skill: 0, mcp: 0 }) ?? { builtin: 0, skill: 0, mcp: 0 };
  const disabledToolCount = runtimeDiagnostics?.tools.reduce((count, tool) => count + (tool.active === false ? 1 : 0), 0) ?? 0;
  const disposedAgentCount = runtimeDiagnostics?.agents.reduce((count, agent) => count + (agent.disposedObservedAt ? 1 : 0), 0) ?? 0;
  const formatAgentTime = (value: string | null | undefined) => {
    if (!value) return null;
    const time = Date.parse(value);
    if (Number.isNaN(time)) return null;
    return new Date(time).toLocaleTimeString("zh-CN", { hour12: false });
  };
  const agentTimelineText = (agent: KimiCodeServerAgentInfo) => {
    const parts = [
      agent.createdAt ? `创建 ${formatAgentTime(agent.createdAt)}` : null,
      agent.startedAt ? `启动 ${formatAgentTime(agent.startedAt)}` : null,
      agent.completedAt ? `完成 ${formatAgentTime(agent.completedAt)}` : null,
      agent.disposedObservedAt ? `释放 ${formatAgentTime(agent.disposedObservedAt)}` : null,
    ].filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(" · ") : "仅事件观测，暂无官方时间记录";
  };
  const subscribedConnectionCount = runtimeDiagnostics?.connections.filter((connection) => connection.subscribedToCurrentSession).length ?? 0;
  const visibleRuntimeTools = toolsExpanded ? runtimeDiagnostics?.tools ?? [] : runtimeDiagnostics?.tools.slice(0, 8) ?? [];

  const handleAddServer = async () => {
    await runBusy("add", async () => {
      setMessage("正在添加 MCP 服务...");
      const res = await window.api.addMcpServer({
        name: form.name.trim(),
        transport: form.transport,
        url: form.transport === "http" || form.transport === "sse" ? form.url.trim() : undefined,
        command: form.transport === "stdio" ? form.command.trim() : undefined,
        args: form.transport === "stdio" ? normalizeArgs(form.args) : undefined,
        env: normalizeKeyValueItems(form.envItems, "="),
        headers: normalizeKeyValueItems(form.headerItems, ":"),
        auth: form.authOauth ? "oauth" : undefined,
      });
      if (!res.success) {
        setMessage(`添加失败：${res.error}`);
        return;
      }
      setForm(createEmptyForm());
      setAddOpen(false);
      await refresh(res.data.message);
    });
  };

  const handleRemoveServer = async (name: string) => {
    await runBusy(`remove:${name}`, async () => {
      setCardMessage(`server:${name}`, `正在删除 ${name}...`);
      const res = await window.api.removeMcpServer({ name });
      if (!res.success) {
        setCardMessage(`server:${name}`, `删除失败：${res.error}`);
        setMessage(`移除失败：${res.error}`);
        return;
      }
      setLastTestOutput((current) => {
        const next = { ...current };
        delete next[name];
        return next;
      });
      setCardMessage(`server:${name}`, res.data.message);
      await refresh(res.data.message);
    });
  };

  const handleAuthServer = async (name: string) => {
    await runBusy(`auth:${name}`, async () => {
      setCardMessage(`server:${name}`, `正在授权 ${name}...`);
      setMessage(`正在授权 ${name}...`);
      const res = await window.api.authMcpServer({ name });
      if (!res.success) {
        setCardMessage(`server:${name}`, `授权失败：${res.error}`);
        setMessage(`授权失败：${res.error}`);
        return;
      }
      setCardMessage(`server:${name}`, res.data.message);
      setMessage(res.data.message);
    });
  };

  const handleResetAuth = async (name: string) => {
    await runBusy(`reset:${name}`, async () => {
      setCardMessage(`server:${name}`, `正在重置 ${name} 的授权...`);
      setMessage(`正在重置 ${name} 的授权...`);
      const res = await window.api.resetMcpServerAuth({ name });
      if (!res.success) {
        setCardMessage(`server:${name}`, `重置授权失败：${res.error}`);
        setMessage(`重置授权失败：${res.error}`);
        return;
      }
      setCardMessage(`server:${name}`, res.data.message);
      setMessage(res.data.message);
    });
  };

  const handleTestServer = async (name: string) => {
    await runBusy(`test:${name}`, async () => {
      setCardMessage(`server:${name}`, `正在测试 ${name}...`);
      setMessage(`正在测试 ${name}...`);
      const res = await window.api.testMcpServer({ name });
      if (!res.success) {
        setCardMessage(`server:${name}`, `测试失败：${res.error}`);
        setMessage(`测试失败：${res.error}`);
        return;
      }
      setLastTestOutput((current) => ({ ...current, [name]: res.data.output }));
      setCardMessage(`server:${name}`, res.data.success ? `${name} 测试通过` : `${name} 测试失败`);
      setMessage(res.data.success ? `${name} 测试通过` : `${name} 测试失败`);
    });
  };

  const handleImportPluginServer = async (server: PluginMcpServerInfo) => {
    await runBusy(`import-plugin:${server.manifestPath}:${server.name}`, async () => {
      setCardMessage(`plugin:${server.pluginId}:${server.name}`, `正在写入 ${server.pluginName} / ${server.name} 到 mcp.json...`);
      setMessage(`正在将 ${server.pluginName} / ${server.name} 加入 MCP 配置...`);
      const res = await window.api.importPluginMcpServer({
        manifestPath: server.manifestPath,
        name: server.name,
      });
      if (!res.success) {
        setCardMessage(`plugin:${server.pluginId}:${server.name}`, `写入失败：${res.error}`);
        setMessage(`加入失败：${res.error}`);
        return;
      }
      setCardMessage(`plugin:${server.pluginId}:${server.name}`, `${res.data.message}。这是兼容写入，不是使用前置条件。`);
      await refresh(`${res.data.message}。现在可以在普通 MCP 服务卡片里测试或授权。`);
    });
  };

  const resolvePluginUpdateSource = (server: PluginMcpServerInfo) => {
    const sdkPlugin = sdkPlugins.find((plugin) =>
      plugin.id === server.pluginId ||
      plugin.displayName === server.pluginName ||
      plugin.id === server.pluginName
    );
    if (sdkPlugin?.originalSource) return sdkPlugin.originalSource;
    const marketplacePlugin = marketplacePlugins.find((plugin) =>
      plugin.id === server.pluginId ||
      plugin.displayName === server.pluginName ||
      plugin.id === server.pluginName
    );
    if (marketplacePlugin?.source) return marketplacePlugin.source;
    return server.pluginPath;
  };

  const isRuntimeUsingPluginServer = (server: PluginMcpServerInfo) => runtimeServers.some((item) =>
    item.name === server.name ||
    item.id === server.name ||
    item.id === `plugin:${server.pluginId}:${server.name}` ||
    item.id === `${server.pluginId}:${server.name}` ||
    item.name === `plugin:${server.pluginId}:${server.name}`
  );

  const formatPluginUpdateError = (error: string, server: PluginMcpServerInfo) => {
    if (/EBUSY|resource busy|locked|rmdir|ENOTEMPTY|EPERM/i.test(error)) {
      return [
        `更新失败：${server.pluginName} 的插件目录仍被某个 MCP / Kimi Code 进程占用，Windows 暂时不能替换。`,
        "Kimix 已尝试释放当前会话运行态和内部插件管理会话；如果仍失败，请关闭其它 Kimi Code/Kimix 窗口后再点一次更新。",
      ].join(" ");
    }
    return `更新失败：${error}`;
  };

  const handleUpdatePluginServer = async (server: PluginMcpServerInfo) => {
    const source = resolvePluginUpdateSource(server);
    const cardKey = `plugin:${server.pluginId}:${server.name}`;
    await runBusy(`update-plugin:${server.pluginId}:${server.name}`, async () => {
      if (runtimeSessionId && isRuntimeUsingPluginServer(server)) {
        const releaseMessage = `${server.pluginName} / ${server.name} 正在当前会话运行态中加载；正在先关闭当前官方 runtime，并释放 Kimix 内部插件管理会话，再走官方插件安装链路更新...`;
        setCardMessage(cardKey, releaseMessage);
        setMessage(releaseMessage);
        const closeRes = await window.api.closeKimiCodeSession({ sessionId: runtimeSessionId });
        if (!closeRes.success) {
          const failedMessage = `释放当前会话运行态失败：${closeRes.error}。请关闭其它 Kimi Code/Kimix 窗口后再点一次更新。`;
          setCardMessage(cardKey, failedMessage);
          setMessage(failedMessage);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      setCardMessage(cardKey, `正在通过官方插件安装链路更新 ${server.pluginName}...`);
      setMessage(`正在通过官方插件安装链路更新 ${server.pluginName}...`);
      const res = await window.api.installKimiCodePlugin({
        source,
      });
      if (!res.success) {
        const formatted = formatPluginUpdateError(res.error, server);
        setCardMessage(cardKey, formatted);
        setMessage(formatted);
        return;
      }
      const successMessage = `已通过官方插件链路更新 ${res.data.displayName}。按官方语义，请 /reload 或开启新会话后生效；刚才如关闭了当前 runtime，下一次发送会重新建立连接。`;
      setCardMessage(cardKey, successMessage);
      await refresh(successMessage);
    });
  };


  const header = (
    <div className="flex items-center justify-between border-b border-[var(--kimix-panel-divider)]" style={{ padding: "20px 28px" }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 text-[20px] font-semibold leading-7 text-[var(--kimix-panel-text)]">
            <Cable size={20} />
            <span>MCP</span>
          </div>
          <div className="mt-1 text-[13.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">
            管理 MCP 服务配置，以及授权和连通性测试。
          </div>
        </div>
        <div className="flex items-center" style={{ gap: 8 }}>
          <button
            type="button"
            onClick={() => void refresh("已刷新 Kimi Code 与 MCP 状态")}
            disabled={loading || Boolean(busyAction)}
            className="kimix-icon-text-button kimix-muted-action is-compact disabled:cursor-wait disabled:opacity-50"
          >
            <RefreshCw size={15} className={loading ? "kimix-spin" : ""} />
            <span>刷新</span>
          </button>
          <button
            type="button"
            onClick={() => setAddOpen((current) => !current)}
            className="kimix-icon-text-button kimix-muted-action is-compact"
          >
            <Plus size={15} />
            <span>{addOpen ? "收起添加" : "添加服务"}</span>
          </button>
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
  );

  const body = (
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: embedded ? "0" : "22px 28px 30px" }}>
        <div className="grid min-w-0 items-start" style={{ gridTemplateColumns: "320px minmax(0, 1fr)", gap: 18 }}>
          <aside className="flex min-w-0 flex-col" style={{ gap: 14 }}>
            <div className="kimix-soft-card rounded-xl text-[13px] leading-6" style={{ padding: "16px 16px 15px" }}>
              <div className="font-medium text-[var(--kimix-panel-text)]">当前配置</div>
              <div className="mt-2 text-[var(--kimix-panel-text-secondary)]">
                登录状态：{loading ? "读取中" : auth?.loggedIn ? "已登录" : "未登录"}
              </div>
              <div className="mt-2 text-[var(--kimix-panel-text-secondary)]">
                默认模型：{auth?.defaultModel ?? "未设置"}
              </div>
              <div className="text-[var(--kimix-panel-text-secondary)]">
                默认思考：{auth?.defaultThinking ? "开启" : "关闭"}
              </div>
              <div className="mt-2 break-all text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">
                config.toml：{auth?.configPath || "-"}
              </div>
              <div className="mt-1 break-all text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">
                mcp.json：{configPath || auth?.mcpConfigPath || "-"}
              </div>
            </div>

            <div className="kimix-soft-card rounded-xl text-[13px] leading-6" style={{ padding: "16px 16px 15px" }}>
              <div className="font-medium text-[var(--kimix-panel-text)]">状态</div>
              <div className="mt-2 text-[var(--kimix-panel-text-secondary)]">{message}</div>
            </div>
          </aside>

          <section className="min-w-0">
            {addOpen && (
              <div className="kimix-soft-card rounded-xl" style={{ padding: "20px 22px 18px", marginBottom: 16 }}>
                <div className="flex items-center gap-2 text-[15px] font-medium text-[var(--kimix-panel-text)]">
                  <Plus size={16} />
                  <span>添加 MCP 服务</span>
                </div>
                <div className="grid min-w-0" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12, marginTop: 14 }}>
                  <label className="min-w-0">
                    <div className="text-[13px] text-[var(--kimix-panel-text-secondary)]">服务名</div>
                    <input
                      value={form.name}
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                      className="mt-2 h-10 w-full rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[14px] text-[var(--kimix-panel-text)] outline-none"
                      style={{ paddingLeft: 18, paddingRight: 18 }}
                    />
                  </label>
                  <label className="min-w-0">
                    <div className="text-[13px] text-[var(--kimix-panel-text-secondary)]">传输方式</div>
                    <select
                      value={form.transport}
                      onChange={(event) => setForm((current) => ({ ...current, transport: event.target.value as "http" | "sse" | "stdio" }))}
                      className="mt-2 h-10 w-full rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[14px] text-[var(--kimix-panel-text)] outline-none"
                      style={{ paddingLeft: 12, paddingRight: 18 }}
                    >
                      <option value="http">HTTP</option>
                      <option value="sse">SSE</option>
                      <option value="stdio">stdio</option>
                    </select>
                  </label>
                  {form.transport === "http" || form.transport === "sse" ? (
                    <label className="min-w-0">
                      <div className="text-[13px] text-[var(--kimix-panel-text-secondary)]">URL</div>
                      <input
                        value={form.url}
                        onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
                        className="mt-2 h-10 w-full rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[14px] text-[var(--kimix-panel-text)] outline-none"
                        style={{ paddingLeft: 18, paddingRight: 18 }}
                      />
                    </label>
                  ) : (
                    <label className="min-w-0">
                      <div className="text-[13px] text-[var(--kimix-panel-text-secondary)]">命令</div>
                      <input
                        value={form.command}
                        onChange={(event) => setForm((current) => ({ ...current, command: event.target.value }))}
                        className="mt-2 h-10 w-full rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[14px] text-[var(--kimix-panel-text)] outline-none"
                        style={{ paddingLeft: 18, paddingRight: 18 }}
                      />
                    </label>
                  )}
                  <label className="min-w-0">
                    <div className="text-[13px] text-[var(--kimix-panel-text-secondary)]">OAuth 授权</div>
                    <button
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, authOauth: !current.authOauth }))}
                      className={`mt-2 flex h-10 w-full items-center justify-between rounded-xl border text-[14px] transition-colors ${form.authOauth ? "border-accent-primary-soft bg-accent-primary-light text-accent-primary-dark hover:bg-accent-primary-light/80" : "border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[var(--kimix-panel-text-secondary)] hover:bg-surface-hover"}`}
                      style={{ paddingLeft: 16, paddingRight: 16 }}
                    >
                      <span>{form.authOauth ? "已启用" : "未启用"}</span>
                      <KeyRound size={14} />
                    </button>
                  </label>
                  {form.transport === "stdio" && (
                    <div className="min-w-0">
                      <div className="text-[13px] text-[var(--kimix-panel-text-secondary)]">命令参数</div>
                      <div className="mt-2 flex flex-col" style={{ gap: 10 }}>
                        {form.args.map((arg, index) => (
                          <div
                            key={index}
                            className="grid min-w-0 items-center"
                            style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8 }}
                          >
                            <input
                              value={arg}
                              onChange={(event) => setForm((current) => ({
                                ...current,
                                args: current.args.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)),
                              }))}
                              placeholder={`参数 ${index + 1}`}
                              className="h-10 min-w-0 rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[14px] text-[var(--kimix-panel-text)] outline-none"
                              style={{ paddingLeft: 18, paddingRight: 18 }}
                            />
                            <button
                              type="button"
                              onClick={() => setForm((current) => {
                                const next = current.args.filter((_, itemIndex) => itemIndex !== index);
                                return { ...current, args: next.length > 0 ? next : [""] };
                              })}
                              className="kimix-muted-action flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                              aria-label="删除命令参数"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => setForm((current) => ({ ...current, args: [...current.args, ""] }))}
                          className="kimix-icon-text-button kimix-muted-action is-compact self-start"
                        >
                          <Plus size={14} />
                          <span>添加参数</span>
                        </button>
                      </div>
                    </div>
                  )}
                  <KeyValueListEditor
                    title="环境变量"
                    placeholderKey="KEY"
                    placeholderValue="VALUE"
                    items={form.envItems}
                    onChange={(envItems) => setForm((current) => ({ ...current, envItems }))}
                    separator="="
                  />
                  {(form.transport === "http" || form.transport === "sse") && (
                    <KeyValueListEditor
                      title="请求头"
                      placeholderKey="Header"
                      placeholderValue="Value"
                      items={form.headerItems}
                      onChange={(headerItems) => setForm((current) => ({ ...current, headerItems }))}
                      separator=":"
                    />
                  )}
                </div>
                <div className="flex items-center justify-end" style={{ gap: 8, marginTop: 16 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAddOpen(false);
                      setForm(createEmptyForm());
                    }}
                    className="kimix-icon-text-button kimix-muted-action is-compact"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAddServer()}
                    disabled={busyAction === "add"}
                    className="kimix-icon-text-button is-compact bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-wait disabled:opacity-55"
                  >
                    <Plus size={14} />
                    <span>{busyAction === "add" ? "添加中" : "确认添加"}</span>
                  </button>
                </div>
              </div>
            )}

            <div className="grid min-w-0" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              {runtimeSessionId && (
                <div className="kimix-soft-card rounded-xl" style={{ padding: "18px 18px 16px", gridColumn: "1 / -1" }}>
                  <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 14 }}>
                    <div className="min-w-0">
                      <div className="flex items-center text-[15px] font-medium text-[var(--kimix-panel-text)]" style={{ gap: 8 }}>
                        <Cable size={15} />
                        <span>当前会话运行态</span>
                      </div>
                      <div className="text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 8 }}>
                        来自官方 Kimi Server；显示实际连接状态、工具数量，并可按服务重启。
                      </div>
                    </div>
                    <div className="rounded-full bg-[var(--kimix-panel-badge-bg)] text-[11px] font-medium text-[var(--kimix-panel-badge-text)]" style={{ height: 28, minWidth: 62, paddingLeft: 12, paddingRight: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {runtimeServers.length} 个服务
                    </div>
                  </div>
                  {runtimeDiagnostics && (
                    <div style={{ marginTop: 14 }}>
                      <div className="grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
                        {[
                          ["内置工具", runtimeToolCounts.builtin],
                          ["Skill 工具", runtimeToolCounts.skill],
                          ["MCP 工具", runtimeToolCounts.mcp],
                          ["订阅连接", subscribedConnectionCount],
                        ].map(([label, count]) => (
                          <div key={label} className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-elevated" style={{ padding: "11px 12px" }}>
                            <div className="text-[11.5px] leading-5 text-[var(--kimix-panel-text-muted)]">{label}</div>
                            <div className="text-[16px] font-semibold leading-6 text-[var(--kimix-panel-text)]" style={{ marginTop: 2 }}>{count}</div>
                          </div>
                        ))}
                      </div>
                      <div className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-elevated" style={{ marginTop: 12, padding: "13px 14px" }}>
                        <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}>
                          <div className="min-w-0">
                            <div className="text-[13.5px] font-medium leading-5 text-[var(--kimix-panel-text)]">会话有效工具目录</div>
                            <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 3 }}>
                              共 {runtimeDiagnostics.tools.length} 个工具{disabledToolCount > 0 ? ` · ${disabledToolCount} 个被策略禁用` : ""} · {runtimeDiagnostics.connections.length} 个活跃客户端
                            </div>
                          </div>
                          {runtimeDiagnostics.tools.length > 8 && (
                            <button
                              type="button"
                              onClick={() => setToolsExpanded((value) => !value)}
                              className="kimix-icon-text-button kimix-muted-action is-compact"
                            >
                              {toolsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              <span>{toolsExpanded ? "收起" : "展开全部"}</span>
                            </button>
                          )}
                        </div>
                        {visibleRuntimeTools.length > 0 ? (
                          <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 12 }}>
                            {visibleRuntimeTools.map((tool) => (
                              <div key={`${tool.source}:${tool.mcpServerId ?? ""}:${tool.name}`} className="rounded-lg bg-surface-base" style={{ padding: "10px 12px" }}>
                                <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8 }}>
                                  <div className={`truncate text-[12.5px] font-medium leading-5 ${tool.active === false ? "text-[var(--kimix-panel-text-muted)]" : "text-[var(--kimix-panel-text)]"}`} title={tool.name}>{tool.name}</div>
                                  <div className="flex items-center" style={{ gap: 6 }}>
                                    {tool.active === false && (
                                      <span className="rounded-full bg-[var(--kimix-panel-badge-bg)] text-[10.5px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ paddingLeft: 8, paddingRight: 8 }} title="已注册但被当前 Agent 工具策略禁用">
                                        已禁用
                                      </span>
                                    )}
                                    <span className="rounded-full bg-[var(--kimix-panel-badge-bg)] text-[10.5px] leading-5 text-[var(--kimix-panel-badge-text)]" style={{ paddingLeft: 8, paddingRight: 8 }}>
                                      {tool.source === "builtin" ? "内置" : tool.source === "skill" ? "Skill" : "MCP"}
                                    </span>
                                  </div>
                                </div>
                                <div className="line-clamp-2 text-[11.5px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 4 }} title={tool.description}>
                                  {tool.description || "无说明"}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 12 }}>当前会话没有可用工具。</div>
                        )}
                      </div>
                      {runtimeDiagnostics.agents.length > 0 && (
                        <div className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-elevated" style={{ marginTop: 12, padding: "13px 14px" }}>
                          <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}>
                            <div className="min-w-0">
                              <div className="text-[13.5px] font-medium leading-5 text-[var(--kimix-panel-text)]">Agent 生命周期</div>
                              <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 3 }}>
                                共 {runtimeDiagnostics.agents.length} 个 Agent{disposedAgentCount > 0 ? ` · ${disposedAgentCount} 个已释放` : ""}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                            {runtimeDiagnostics.agents.map((agent) => (
                              <div key={agent.agentId} className="rounded-lg bg-surface-base" style={{ padding: "10px 12px" }}>
                                <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8 }}>
                                  <div className="truncate text-[12.5px] font-medium leading-5 text-[var(--kimix-panel-text)]" title={agent.description ?? agent.agentId}>
                                    {agent.subagentType ? `${agent.subagentType} · ` : ""}{agent.agentId}
                                  </div>
                                  <div className="flex items-center" style={{ gap: 6 }}>
                                    {agent.disposedObservedAt && (
                                      <span className="rounded-full bg-[var(--kimix-panel-badge-bg)] text-[10.5px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ paddingLeft: 8, paddingRight: 8 }}>
                                        已释放
                                      </span>
                                    )}
                                    <span className="rounded-full bg-[var(--kimix-panel-badge-bg)] text-[10.5px] leading-5 text-[var(--kimix-panel-badge-text)]" style={{ paddingLeft: 8, paddingRight: 8 }}>
                                      {agent.status ?? "已观测"}
                                    </span>
                                  </div>
                                </div>
                                <div className="text-[11.5px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 4 }}>
                                  {agentTimelineText(agent)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {runtimeServers.length > 0 ? (
                    <div className="flex flex-col" style={{ gap: 10, marginTop: 14 }}>
                      {runtimeServers.map((server) => (
                        <div key={server.id ?? server.name} className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-elevated" style={{ padding: "13px 14px 12px" }}>
                          <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 14 }}>
                            <div className="min-w-0">
                              <div className="truncate text-[14px] font-medium text-[var(--kimix-panel-text)]">{server.name}</div>
                              <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 4 }}>
                                {server.transport.toUpperCase()} · {server.toolCount} 个工具 · {server.status === "connected" ? "已连接" : server.status === "pending" ? "连接中" : server.status === "failed" ? "连接失败" : "未连接"}
                              </div>
                              {server.error && <div className="break-all text-[12px] leading-5 text-accent-danger" style={{ marginTop: 5 }}>{server.error}</div>}
                              {cardMessages[`runtime:${server.id ?? server.name}`] && (
                                <div
                                  className="rounded-lg bg-[var(--kimix-panel-soft-bg)] text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]"
                                  style={{ marginTop: 8, padding: "8px 10px" }}
                                >
                                  {cardMessages[`runtime:${server.id ?? server.name}`]}
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleRestartRuntimeServer(server)}
                              disabled={Boolean(busyAction)}
                              className="kimix-icon-text-button kimix-muted-action is-compact disabled:cursor-wait disabled:opacity-55"
                            >
                              <RefreshCw size={14} className={busyAction === `restart-runtime:${server.id ?? server.name}` ? "animate-spin" : ""} />
                              <span>{busyAction === `restart-runtime:${server.id ?? server.name}` ? "重启中" : "重启"}</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[13px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 14 }}>
                      当前官方 Server 会话没有加载 MCP 服务。
                    </div>
                  )}
                </div>
              )}
              {pluginServers.length > 0 && (
                <div className="kimix-soft-card rounded-xl" style={{ padding: "18px 18px 16px", gridColumn: "1 / -1" }}>
                  <div className="flex items-center gap-2 text-[15px] font-medium text-[var(--kimix-panel-text)]">
                    <Cable size={15} />
                    <span>Plugin 随带 MCP</span>
                  </div>
                  <div className="text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 8 }}>
                    这些服务来自已安装 Plugin 的 manifest。默认会随官方 Kimi Code 会话加载，Kimix 也会直接读取运行态；不需要先写入 mcp.json 才能使用。
                  </div>
                  <div className="flex flex-col" style={{ gap: 10, marginTop: 14 }}>
                    {pluginServers.map((server) => (
                      <div
                        key={`${server.pluginId}:${server.name}:${server.manifestPath}`}
                        className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-elevated"
                        style={{ padding: "13px 14px 12px" }}
                      >
                        <div className="grid items-start" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}>
                          <div className="min-w-0">
                            <div className="truncate text-[14px] font-medium text-[var(--kimix-panel-text)]">
                              {server.name}
                            </div>
                            <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 4 }}>
                              来源：{server.pluginName} · {server.transport.toUpperCase()}
                            </div>
                            <div className="break-all text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 5 }}>
                              {summarizeServer(server)}
                            </div>
                          </div>
                          <div
                            className="flex shrink-0 flex-col items-end"
                            style={{ gap: 8 }}
                          >
                            <div
                              className={`rounded-full text-[11px] font-medium ${server.enabled ? "bg-accent-success-light text-accent-success" : "bg-[var(--kimix-panel-badge-bg)] text-[var(--kimix-panel-badge-text)]"}`}
                              style={{ height: 26, minWidth: 58, paddingLeft: 10, paddingRight: 10, display: "flex", alignItems: "center", justifyContent: "center" }}
                            >
                              {server.enabled ? "默认启用" : "已禁用"}
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleUpdatePluginServer(server)}
                              disabled={Boolean(busyAction)}
                              className="kimix-icon-text-button kimix-muted-action is-compact disabled:cursor-wait disabled:opacity-55"
                            >
                              <RefreshCw size={14} className={busyAction === `update-plugin:${server.pluginId}:${server.name}` ? "kimix-spin" : ""} />
                              <span>{busyAction === `update-plugin:${server.pluginId}:${server.name}` ? "更新中" : "更新 MCP"}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleImportPluginServer(server)}
                              disabled={Boolean(busyAction)}
                              className="kimix-icon-text-button kimix-muted-action is-compact disabled:cursor-wait disabled:opacity-55"
                              title="兼容旧版普通 MCP 配置：把这个 Plugin MCP 复制到 mcp.json。默认使用不需要这一步。"
                            >
                              <Plus size={14} />
                              <span>{busyAction === `import-plugin:${server.manifestPath}:${server.name}` ? "写入中" : "写入 mcp.json"}</span>
                            </button>
                          </div>
                        </div>
                        {cardMessages[`plugin:${server.pluginId}:${server.name}`] && (
                          <div
                            className="rounded-lg bg-[var(--kimix-panel-soft-bg)] text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]"
                            style={{ marginTop: 12, padding: "9px 12px" }}
                          >
                            {cardMessages[`plugin:${server.pluginId}:${server.name}`]}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {servers.length === 0 ? (
                <div className="kimix-soft-card rounded-xl text-[14px] leading-6 text-[var(--kimix-panel-text-secondary)]" style={{ padding: "18px 18px 16px", gridColumn: "1 / -1" }}>
                  当前还没有 MCP 服务。可以先添加一个 HTTP、SSE 或 stdio 服务，再做测试和授权。
                </div>
              ) : (
                servers.map((server) => (
                  <div key={server.name} className="kimix-soft-card rounded-xl" style={{ padding: "18px 18px 16px" }}>
                    <div className="grid items-start" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[15px] font-medium text-[var(--kimix-panel-text)]">
                          <Cable size={15} />
                          <span className="truncate">{server.name}</span>
                        </div>
                        <div className="mt-2 text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                          {server.transport.toUpperCase()}
                          {server.auth ? ` · ${server.auth}` : ""}
                        </div>
                        <div className="mt-2 break-all text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]">
                          {summarizeServer(server)}
                        </div>
                        <div className="mt-2 text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">
                          {server.env && Object.keys(server.env).length > 0 ? `环境变量 ${Object.keys(server.env).length} 项` : "无环境变量"}
                          {" · "}
                          {server.headers && Object.keys(server.headers).length > 0 ? `请求头 ${Object.keys(server.headers).length} 项` : "无请求头"}
                        </div>
                      </div>
                      <div className="rounded-full bg-surface-elevated text-[11px] font-medium text-text-muted" style={{ minWidth: 56, height: 28, paddingLeft: 12, paddingRight: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {server.transport}
                      </div>
                    </div>

                    <div className="flex flex-wrap" style={{ gap: 8, marginTop: 14 }}>
                      <button
                        type="button"
                        onClick={() => void handleTestServer(server.name)}
                        disabled={Boolean(busyAction)}
                        className="kimix-icon-text-button kimix-muted-action is-compact disabled:cursor-wait disabled:opacity-55"
                      >
                        <TestTube2 size={14} />
                        <span>{busyAction === `test:${server.name}` ? "测试中" : "测试"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleAuthServer(server.name)}
                        disabled={Boolean(busyAction)}
                        className="kimix-icon-text-button kimix-muted-action is-compact disabled:cursor-wait disabled:opacity-55"
                      >
                        <ShieldCheck size={14} />
                        <span>{busyAction === `auth:${server.name}` ? "授权中" : "授权"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleResetAuth(server.name)}
                        disabled={Boolean(busyAction)}
                        className="kimix-icon-text-button kimix-muted-action is-compact disabled:cursor-wait disabled:opacity-55"
                      >
                        <KeyRound size={14} />
                        <span>{busyAction === `reset:${server.name}` ? "重置中" : "重置授权"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRemoveServer(server.name)}
                        disabled={Boolean(busyAction)}
                        className="kimix-icon-text-button is-compact border border-[var(--kimix-panel-border-soft)] text-accent-danger hover:bg-accent-danger-light disabled:cursor-wait disabled:opacity-55"
                      >
                        <Trash2 size={14} />
                        <span>{busyAction === `remove:${server.name}` ? "删除中" : "删除"}</span>
                      </button>
                    </div>

                    {lastTestOutput[server.name] && (
                      <pre className="mt-3 overflow-x-auto rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ padding: "12px 14px", whiteSpace: "pre-wrap" }}>
                        {lastTestOutput[server.name]}
                      </pre>
                    )}
                    {cardMessages[`server:${server.name}`] && (
                      <div
                        className="rounded-xl bg-[var(--kimix-panel-soft-bg)] text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]"
                        style={{ marginTop: 12, padding: "9px 12px" }}
                      >
                        {cardMessages[`server:${server.name}`]}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
  );

  if (embedded) return body;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--kimix-panel-bg)]">
      {header}
      {body}
    </div>
  );
}
