import { useEffect, useState } from "react";
import { Cable, KeyRound, Plus, RefreshCw, ShieldCheck, TestTube2, Trash2 } from "lucide-react";

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
  transport: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  auth?: string;
};

type KeyValueItem = {
  id: string;
  key: string;
  value: string;
};

type AddFormState = {
  name: string;
  transport: "http" | "stdio";
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
  if (server.transport === "http") {
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
  const [auth, setAuth] = useState<KimiAuthStatus | null>(null);
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [configPath, setConfigPath] = useState("");
  const [message, setMessage] = useState("正在读取 Kimi Code 与 MCP 状态...");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<AddFormState>(() => createEmptyForm());
  const [lastTestOutput, setLastTestOutput] = useState<Record<string, string>>({});

  const refresh = async (nextMessage?: string) => {
    setLoading(true);
    const [authRes, listRes] = await Promise.all([
      window.api.getKimiAuthStatus(),
      window.api.listMcpServers(),
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
    setConfigPath(listRes.data.configPath);
    setMessage(nextMessage ?? authRes.data.message);
  };

  useEffect(() => {
    void refresh();
  }, []);

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

  const handleAddServer = async () => {
    await runBusy("add", async () => {
      setMessage("正在添加 MCP 服务...");
      const res = await window.api.addMcpServer({
        name: form.name.trim(),
        transport: form.transport,
        url: form.transport === "http" ? form.url.trim() : undefined,
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
      const res = await window.api.removeMcpServer({ name });
      if (!res.success) {
        setMessage(`移除失败：${res.error}`);
        return;
      }
      setLastTestOutput((current) => {
        const next = { ...current };
        delete next[name];
        return next;
      });
      await refresh(res.data.message);
    });
  };

  const handleAuthServer = async (name: string) => {
    await runBusy(`auth:${name}`, async () => {
      setMessage(`正在授权 ${name}...`);
      const res = await window.api.authMcpServer({ name });
      if (!res.success) {
        setMessage(`授权失败：${res.error}`);
        return;
      }
      setMessage(res.data.message);
    });
  };

  const handleResetAuth = async (name: string) => {
    await runBusy(`reset:${name}`, async () => {
      setMessage(`正在重置 ${name} 的授权...`);
      const res = await window.api.resetMcpServerAuth({ name });
      if (!res.success) {
        setMessage(`重置授权失败：${res.error}`);
        return;
      }
      setMessage(res.data.message);
    });
  };

  const handleTestServer = async (name: string) => {
    await runBusy(`test:${name}`, async () => {
      setMessage(`正在测试 ${name}...`);
      const res = await window.api.testMcpServer({ name });
      if (!res.success) {
        setMessage(`测试失败：${res.error}`);
        return;
      }
      setLastTestOutput((current) => ({ ...current, [name]: res.data.output }));
      setMessage(res.data.success ? `${name} 测试通过` : `${name} 测试失败`);
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
                      onChange={(event) => setForm((current) => ({ ...current, transport: event.target.value as "http" | "stdio" }))}
                      className="mt-2 h-10 w-full rounded-xl border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[14px] text-[var(--kimix-panel-text)] outline-none"
                      style={{ paddingLeft: 12, paddingRight: 18 }}
                    >
                      <option value="http">HTTP</option>
                      <option value="stdio">stdio</option>
                    </select>
                  </label>
                  {form.transport === "http" ? (
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
                      className={`mt-2 flex h-10 w-full items-center justify-between rounded-xl border text-[14px] ${form.authOauth ? "border-accent-primary-soft bg-accent-primary-light text-accent-primary-dark" : "border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[var(--kimix-panel-text-secondary)]"}`}
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
                  {form.transport === "http" && (
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
              {servers.length === 0 ? (
                <div className="kimix-soft-card rounded-xl text-[14px] leading-6 text-[var(--kimix-panel-text-secondary)]" style={{ padding: "18px 18px 16px", gridColumn: "1 / -1" }}>
                  当前还没有 MCP 服务。可以先添加一个 HTTP 或 stdio 服务，再做测试和授权。
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
