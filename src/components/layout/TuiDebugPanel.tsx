import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CirclePlay, Copy, CornerDownLeft, ImageIcon, RefreshCw, Send, Square, TerminalSquare, Trash2 } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import type { TuiKeyName, TuiPluginSnapshot, TuiSessionStatus, TuiSessionSummary } from "@electron/types/ipc";

function statusMeta(status: TuiSessionStatus) {
  switch (status) {
    case "starting":
      return { label: "启动中", className: "bg-accent-warning-light text-accent-warning" };
    case "running":
      return { label: "运行中", className: "bg-accent-success-light text-accent-success" };
    case "stopping":
      return { label: "停止中", className: "bg-accent-warning-light text-accent-warning" };
    case "error":
      return { label: "错误", className: "bg-accent-danger-light text-accent-danger" };
    case "exited":
    default:
      return { label: "已退出", className: "bg-[var(--kimix-panel-badge-bg)] text-[var(--kimix-panel-badge-text)]" };
  }
}

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function pluginStatusLabel(status: TuiPluginSnapshot["status"]) {
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
}

function pluginTrustLabel(trustLevel: TuiPluginSnapshot["trustLevel"]) {
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
}

function formatSemanticEvents(events: TuiSessionSummary["semanticEventsTail"]) {
  if (!events || events.length === 0) return "";
  return events.map((event) => JSON.stringify(event, null, 2)).join("\n");
}

export function TuiDebugPanel() {
  const currentProject = useAppStore((s) => s.currentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const [sessions, setSessions] = useState<TuiSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("只回复 OK");
  const [busyAction, setBusyAction] = useState<"start" | "send" | "key" | "stop" | "refresh" | "probe" | null>(null);
  const [message, setMessage] = useState("等待启动 TUI。");
  const [outputMode, setOutputMode] = useState<"screen" | "wire" | "semantic" | "text" | "ansi">("screen");
  const [terminalSize, setTerminalSize] = useState({ cols: 120, rows: 32 });
  const logRef = useRef<HTMLPreElement>(null);
  const lastResizeRef = useRef<string>("");
  const probeFileRef = useRef<HTMLInputElement>(null);

  const workDir = currentProject?.path ?? currentSession?.projectPath ?? "";
  const activeSession = useMemo(
    () => sessions.find((session) => session.sessionId === activeSessionId) ?? sessions[0] ?? null,
    [activeSessionId, sessions],
  );

  useEffect(() => {
    let cancelled = false;
    void window.api.listTuiSessions().then((res) => {
      if (cancelled) return;
      if (!res.success) {
        setMessage(`读取 TUI 会话失败：${res.error}`);
        return;
      }
      const next = [...res.data].sort((a, b) => b.updatedAt - a.updatedAt);
      setSessions(next);
      const running = next.find((item) => item.status === "running" || item.status === "starting");
      setActiveSessionId(running?.sessionId ?? next[0]?.sessionId ?? null);
      setMessage(next.length > 0 ? "已加载 TUI 会话。" : "等待启动 TUI。");
    }).catch((error) => {
      if (cancelled) return;
      setMessage(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return window.api.onTuiEvent((payload) => {
      setSessions((current) => {
        const next = [
          payload.session,
          ...current.filter((item) => item.sessionId !== payload.sessionId),
        ].sort((a, b) => b.updatedAt - a.updatedAt);
        return next;
      });
      setActiveSessionId(payload.sessionId);
      if (payload.message) setMessage(payload.message);
    });
  }, []);

  useEffect(() => {
    const element = logRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [activeSession?.output, activeSession?.rawOutput, activeSession?.rawWireTail, activeSession?.semanticEventsTail, outputMode]);

  useEffect(() => {
    const element = logRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect;
      if (!rect) return;
      const cols = Math.max(20, Math.min(240, Math.floor((rect.width - 32) / 8.2)));
      const rows = Math.max(8, Math.min(120, Math.floor((rect.height - 28) / 20)));
      setTerminalSize((current) => current.cols === cols && current.rows === rows ? current : { cols, rows });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!activeSession || activeSession.status !== "running" || activeSession.backend !== "pty") return;
    const key = `${activeSession.sessionId}:${terminalSize.cols}:${terminalSize.rows}`;
    if (lastResizeRef.current === key) return;
    lastResizeRef.current = key;
    const timer = window.setTimeout(() => {
      void window.api.resizeTuiSession({ sessionId: activeSession.sessionId, ...terminalSize }).then((res) => {
        if (!res.success) setMessage(`同步 TUI 尺寸失败：${res.error}`);
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [activeSession?.sessionId, activeSession?.status, activeSession?.backend, terminalSize.cols, terminalSize.rows]);

  const startSession = async () => {
    if (busyAction) return;
    setBusyAction("start");
    setMessage(workDir ? `正在启动 hidden TUI：${workDir}` : "正在启动 hidden TUI。");
    const res = await window.api.startTuiSession({ workDir });
    setBusyAction(null);
    if (!res.success) {
      setMessage(`启动失败：${res.error}`);
      return;
    }
    setSessions((current) => [
      res.data,
      ...current.filter((item) => item.sessionId !== res.data.sessionId),
    ].sort((a, b) => b.updatedAt - a.updatedAt));
    setActiveSessionId(res.data.sessionId);
    setMessage("TUI 已启动。");
  };

  const sendDraft = async (text: string) => {
    const payload = text.trim();
    if (!payload) {
      setMessage("请输入要发送的内容。");
      return;
    }
    if (!activeSession) {
      setMessage("请先启动 TUI。");
      return;
    }
    if (busyAction) return;
    setBusyAction("send");
    const res = await window.api.sendTuiInput({ sessionId: activeSession.sessionId, text: payload });
    setBusyAction(null);
    setMessage(res.success ? "已发送到 TUI。" : `发送失败：${res.error}`);
    if (res.success) setDraft("");
  };

  const stopSession = async () => {
    if (!activeSession) {
      setMessage("当前没有可停止的 TUI 会话。");
      return;
    }
    if (busyAction) return;
    setBusyAction("stop");
    const res = await window.api.stopTuiSession({ sessionId: activeSession.sessionId });
    setBusyAction(null);
    setMessage(res.success ? "已发送停止信号。" : `停止失败：${res.error}`);
  };

  const sendKey = async (key: TuiKeyName) => {
    if (!activeSession) {
      setMessage("请先启动 TUI。");
      return;
    }
    if (busyAction) return;
    setBusyAction("key");
    const res = await window.api.sendTuiKey({ sessionId: activeSession.sessionId, key });
    setBusyAction(null);
    setMessage(res.success ? `已发送按键：${key}` : `发送按键失败：${res.error}`);
  };

  // 剪贴板图片探针：把选中的图片写入系统剪贴板后向 TUI 发 Ctrl+V，
  // 验证官方是否走原生粘贴路径（屏幕出现 [image:…]、wire 出现 ReadMediaFile）。
  const runClipboardImageProbe = async (file: File) => {
    if (!activeSession) {
      setMessage("请先启动 TUI。");
      return;
    }
    if (busyAction) return;
    setBusyAction("probe");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
        reader.readAsDataURL(file);
      });
      const res = await window.api.probeTuiClipboardImage({ sessionId: activeSession.sessionId, dataUrl });
      setMessage(res.success
        ? "已写入剪贴板并发送 Ctrl+V。请看 Screen 是否出现 [image:…]，Wire/Semantic 是否出现 ReadMediaFile。"
        : `剪贴板图片探针失败：${res.error}`);
    } catch (err) {
      setMessage(`剪贴板图片探针失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyAction(null);
    }
  };

  const refreshSessions = async () => {
    if (busyAction) return;
    setBusyAction("refresh");
    const res = await window.api.listTuiSessions();
    setBusyAction(null);
    if (!res.success) {
      setMessage(`刷新失败：${res.error}`);
      return;
    }
    const next = [...res.data].sort((a, b) => b.updatedAt - a.updatedAt);
    setSessions(next);
    setActiveSessionId((current) => current && next.some((item) => item.sessionId === current) ? current : next[0]?.sessionId ?? null);
    setMessage("已刷新 TUI 会话。");
  };

  const clearView = () => {
    setSessions([]);
    setActiveSessionId(null);
    setMessage("已清空调试视图。");
  };

  const copyOutput = async () => {
    const text = outputMode === "screen"
      ? activeSession?.screen?.lines.join("\n")
      : outputMode === "wire"
        ? activeSession?.rawWireTail
        : outputMode === "semantic"
          ? formatSemanticEvents(activeSession?.semanticEventsTail ?? [])
          : outputMode === "ansi"
            ? activeSession?.rawOutput
            : activeSession?.output;
    if (!text) {
      setMessage("当前没有可复制的 TUI 输出。");
      return;
    }
    await navigator.clipboard.writeText(text);
    setMessage(outputMode === "screen" ? "已复制终端镜像。" : outputMode === "wire" ? "已复制 raw wire。" : outputMode === "semantic" ? "已复制 semantic events。" : outputMode === "ansi" ? "已复制原始 ANSI 输出。" : "已复制清洗后的文本输出。");
  };

  const activeStatus = activeSession ? statusMeta(activeSession.status) : null;
  const visibleOutput = outputMode === "screen"
    ? activeSession?.screen?.lines.join("\n")
    : outputMode === "wire"
      ? activeSession?.rawWireTail
      : outputMode === "semantic"
        ? formatSemanticEvents(activeSession?.semanticEventsTail ?? [])
        : outputMode === "ansi"
          ? activeSession?.rawOutput
          : activeSession?.output;
  const outputModeLabel = outputMode === "screen" ? "Raw screen"
    : outputMode === "wire" ? "Raw wire"
      : outputMode === "semantic" ? "Semantic events"
        : outputMode === "ansi" ? "Raw ANSI"
          : "清洗文本输出";
  const tuiPlugins = activeSession?.screen?.plugins ?? [];
  const selectedTuiPlugin = tuiPlugins.find((plugin) => plugin.selected);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--kimix-panel-bg)]">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ padding: "20px 24px 22px" }}>
        <div className="flex items-center justify-between border-b border-[var(--kimix-panel-divider)]" style={{ gap: 12, paddingBottom: 14 }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 text-[20px] font-semibold leading-7 text-[var(--kimix-panel-text)]">
              <TerminalSquare size={20} />
              <span>TUI 调试</span>
            </div>
            <div className="mt-1 text-[13.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">
              隐藏启动真实 kimi TUI，只用于验证输出、输入和停止链路。
            </div>
          </div>
          <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
            {activeStatus ? (
              <span className={`rounded-full text-[12.5px] leading-5 ${activeStatus.className}`} style={{ paddingLeft: 10, paddingRight: 10 }}>
                {activeStatus.label}
              </span>
            ) : null}
            <button type="button" onClick={() => void refreshSessions()} disabled={busyAction === "refresh"} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover">
              <RefreshCw size={13} className={busyAction === "refresh" ? "kimix-spin" : ""} />
              刷新
            </button>
            <button type="button" onClick={clearView} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover">
              <Trash2 size={13} />
              清空视图
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden" style={{ marginTop: 14, display: "grid", gridTemplateRows: "auto minmax(0, 1fr) auto", gap: 14 }}>
          <div className="kimix-settings-card" style={{ padding: "16px 18px" }}>
            <div className="grid min-w-0" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}>
              <div className="min-w-0">
                <div className="text-[14.5px] font-medium text-[var(--kimix-panel-text)]">会话信息</div>
                <div className="mt-1 text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                  {activeSession ? `#${activeSession.sessionId} · ${activeSession.command} · ${activeSession.backend.toUpperCase()}` : "尚未启动 TUI。"}
                </div>
                <div className="mt-1 truncate text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                  工作目录：{activeSession?.workDir || workDir || "未设置"}
                </div>
                {activeSession?.wireFile && (
                  <div className="mt-1 truncate text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                    Wire：{activeSession.wireFile}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end justify-between" style={{ gap: 6 }}>
                <span className="text-right text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                  {activeSession ? `PID ${activeSession.pid ?? "?"}` : "PID -"}
                </span>
                <span className="text-right text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                  {activeSession ? `${terminalSize.cols}x${terminalSize.rows} · ${formatTime(activeSession.updatedAt)}` : `当前时间 ${formatTime(Date.now())}`}
                </span>
                {activeSession?.semanticEventsTail && activeSession.semanticEventsTail.length > 0 && (
                  <span className="text-right text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                    semantic {activeSession.semanticEventsTail.length} 条
                  </span>
                )}
              </div>
            </div>
            {activeSession?.error && (
              <div className="mt-3 rounded-lg bg-accent-danger-light px-3 py-2 text-[13px] leading-5 text-accent-danger">
                {activeSession.error}
              </div>
            )}
            {tuiPlugins.length > 0 && (
              <div className="rounded-lg border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)]" style={{ marginTop: 12, padding: "12px 14px" }}>
                <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12 }}>
                  <div className="min-w-0 text-[13.5px] font-medium leading-5 text-[var(--kimix-panel-text)]">插件状态</div>
                  <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                    {tuiPlugins[0]?.source === "marketplace" ? "官方 Marketplace" : "已安装插件"}
                  </div>
                </div>
                {selectedTuiPlugin && (
                  <div
                    className="rounded-lg border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)] text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]"
                    style={{ marginTop: 10, padding: "8px 10px" }}
                  >
                    当前选中：<span className="font-medium text-[var(--kimix-panel-text)]">{selectedTuiPlugin.name}</span>
                  </div>
                )}
                <div className="flex flex-col" style={{ gap: 8, marginTop: 10 }}>
                  {tuiPlugins.map((plugin) => (
                    <div key={`${plugin.source}:${plugin.id}`} className={`grid min-w-0 items-center rounded-lg border ${plugin.selected ? "border-[var(--kimix-panel-border)] bg-[var(--kimix-panel-soft-bg)]" : "border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)]"}`} style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, padding: "9px 12px" }}>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium leading-5 text-[var(--kimix-panel-text)]">{plugin.name}</div>
                        <div className="truncate text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                          {plugin.id}
                          {plugin.version ? ` · v${plugin.version}` : ""}
                          {plugin.skillsCount !== null ? ` · ${plugin.skillsCount} skills` : ""}
                          {plugin.mcpSummary ? ` · ${plugin.mcpSummary}` : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center" style={{ gap: 6 }}>
                        <span className="rounded-full bg-[var(--kimix-panel-badge-bg)] text-[12px] leading-5 text-[var(--kimix-panel-badge-text)]" style={{ paddingLeft: 8, paddingRight: 8 }}>
                          {pluginTrustLabel(plugin.trustLevel)}
                        </span>
                        {plugin.selected && (
                          <span className="rounded-full bg-[var(--kimix-panel-badge-bg)] text-[12px] leading-5 text-[var(--kimix-panel-badge-text)]" style={{ paddingLeft: 8, paddingRight: 8 }}>
                            当前
                          </span>
                        )}
                        <span className="rounded-full bg-accent-primary text-[12px] leading-5 text-white" style={{ paddingLeft: 8, paddingRight: 8 }}>
                          {pluginStatusLabel(plugin.status)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface-elevated">
            <div className="flex items-center justify-between border-b border-border-subtle" style={{ padding: "10px 12px", gap: 10 }}>
              <div className="min-w-0 truncate text-[12.5px] leading-5 text-text-secondary">
                {outputModeLabel} · {activeSession?.screen ? `${activeSession.screen.cols} 列 x ${activeSession.screen.rows} 行` : `${terminalSize.cols} 列 x ${terminalSize.rows} 行`}
              </div>
              <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                {(["screen", "wire", "semantic", "text", "ansi"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setOutputMode(mode)}
                    className={`kimix-icon-text-button is-compact ${outputMode === mode ? "bg-surface-hover text-text-primary" : "text-text-secondary hover:bg-surface-hover"}`}
                    style={{ paddingLeft: 12, paddingRight: 12 }}
                  >
                    {mode === "screen" ? "Screen" : mode === "wire" ? "Wire" : mode === "semantic" ? "Semantic" : mode === "text" ? "文本" : "ANSI"}
                  </button>
                ))}
                <button type="button" onClick={() => void copyOutput()} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover">
                  <Copy size={13} />
                  复制
                </button>
              </div>
            </div>
            <pre
              ref={logRef}
              className="min-h-0 flex-1 overflow-auto text-[13px] leading-5 text-text-primary"
              style={{ padding: "14px 16px", whiteSpace: "pre", wordBreak: "normal", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}
            >
              {visibleOutput?.trimEnd() || (outputMode === "wire" ? "等待 wire.jsonl 输出。" : outputMode === "semantic" ? "等待 semantic events。" : "等待 TUI 输出。")}
            </pre>
          </div>

          <div className="kimix-settings-card" style={{ padding: "16px 18px" }}>
            <div className="flex items-end" style={{ gap: 12 }}>
              <div className="min-w-0 flex-1">
                <label className="mb-2 block text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]">发送内容</label>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={3}
                  className="kimix-settings-input w-full resize-none rounded-xl text-[14px] leading-6 outline-none transition-colors"
                  style={{ padding: "12px 14px" }}
                  placeholder="输入要发送给隐藏 TUI 的内容"
                />
              </div>
              <div className="flex shrink-0 flex-col justify-end" style={{ gap: 8 }}>
                <button type="button" onClick={() => void startSession()} disabled={busyAction === "start"} className="kimix-icon-text-button is-compact bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-wait disabled:opacity-55">
                  <CirclePlay size={13} />
                  启动 TUI
                </button>
                <button type="button" onClick={() => void sendDraft(draft)} disabled={busyAction === "send"} className="kimix-icon-text-button is-compact bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-wait disabled:opacity-55">
                  <Send size={13} />
                  发送
                </button>
                <button type="button" onClick={() => void sendDraft("只回复 OK")} disabled={busyAction === "send"} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover">
                  只回复 OK
                </button>
                <div className="grid" style={{ gridTemplateColumns: "repeat(3, 34px)", gap: 6 }}>
                  <button type="button" onClick={() => void sendKey("escape")} disabled={busyAction === "key"} className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-[12px] text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55" title="Esc">
                    Esc
                  </button>
                  <button type="button" onClick={() => void sendKey("arrowUp")} disabled={busyAction === "key"} className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55" title="上">
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" onClick={() => void sendKey("enter")} disabled={busyAction === "key"} className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55" title="Enter">
                    <CornerDownLeft size={14} />
                  </button>
                  <button type="button" onClick={() => void sendKey("arrowLeft")} disabled={busyAction === "key"} className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55" title="左">
                    <ArrowLeft size={14} />
                  </button>
                  <button type="button" onClick={() => void sendKey("arrowDown")} disabled={busyAction === "key"} className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55" title="下">
                    <ArrowDown size={14} />
                  </button>
                  <button type="button" onClick={() => void sendKey("arrowRight")} disabled={busyAction === "key"} className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55" title="右">
                    <ArrowRight size={14} />
                  </button>
                </div>
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <button type="button" onClick={() => void sendKey("space")} disabled={busyAction === "key"} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55" style={{ justifyContent: "center", paddingLeft: 10, paddingRight: 10 }}>
                    Space
                  </button>
                  <button type="button" onClick={() => void sendKey("tab")} disabled={busyAction === "key"} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55" style={{ justifyContent: "center", paddingLeft: 10, paddingRight: 10 }}>
                    Tab
                  </button>
                </div>
                <button type="button" onClick={() => void stopSession()} disabled={busyAction === "stop"} className="kimix-icon-text-button is-compact text-accent-danger hover:bg-accent-danger-light disabled:cursor-wait disabled:opacity-55">
                  <Square size={13} />
                  停止
                </button>
                <button type="button" onClick={() => probeFileRef.current?.click()} disabled={busyAction === "probe" || !activeSession} className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55" title="剪贴板图片探针：写入系统剪贴板后向 TUI 发 Ctrl+V，验证官方原生粘贴（[image:…] / ReadMediaFile）">
                  <ImageIcon size={13} />
                  剪贴板图片探针
                </button>
                <input
                  ref={probeFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void runClipboardImageProbe(file);
                  }}
                />
              </div>
            </div>
            {message && (
              <div className="mt-3 text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                {message}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
