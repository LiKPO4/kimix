import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  CirclePlay,
  Copy,
  CornerDownLeft,
  ImageIcon,
  RefreshCw,
  Send,
  Square,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import type { TuiKeyName, TuiPluginSnapshot, TuiSessionStatus, TuiSessionSummary } from "@electron/types/ipc";

function statusMeta(status: TuiSessionStatus) {
  switch (status) {
    case "starting":
      return { label: "启动中", dot: "bg-accent-warning", text: "text-accent-warning" };
    case "running":
      return { label: "运行中", dot: "bg-accent-success", text: "text-accent-success" };
    case "stopping":
      return { label: "停止中", dot: "bg-accent-warning", text: "text-accent-warning" };
    case "error":
      return { label: "错误", dot: "bg-accent-danger", text: "text-accent-danger" };
    case "exited":
    default:
      return { label: "已退出", dot: "bg-text-muted", text: "text-text-muted" };
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
  const [infoExpanded, setInfoExpanded] = useState(false);
  const [pluginsExpanded, setPluginsExpanded] = useState(false);
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
    void window.api
      .listTuiSessions()
      .then((res) => {
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
      })
      .catch((error) => {
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
        const next = [payload.session, ...current.filter((item) => item.sessionId !== payload.sessionId)].sort(
          (a, b) => b.updatedAt - a.updatedAt,
        );
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
      setTerminalSize((current) => (current.cols === cols && current.rows === rows ? current : { cols, rows }));
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
      void window.api
        .resizeTuiSession({ sessionId: activeSession.sessionId, ...terminalSize })
        .then((res) => {
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
    setSessions((current) =>
      [res.data, ...current.filter((item) => item.sessionId !== res.data.sessionId)].sort((a, b) => b.updatedAt - a.updatedAt),
    );
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
      setMessage(
        res.success
          ? "已写入剪贴板并发送 Ctrl+V。请看 Screen 是否出现 [image:…]，Wire/Semantic 是否出现 ReadMediaFile。"
          : `剪贴板图片探针失败：${res.error}`,
      );
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
    setActiveSessionId((current) =>
      current && next.some((item) => item.sessionId === current) ? current : next[0]?.sessionId ?? null,
    );
    setMessage("已刷新 TUI 会话。");
  };

  const clearView = () => {
    setSessions([]);
    setActiveSessionId(null);
    setMessage("已清空调试视图。");
  };

  const copyOutput = async () => {
    const text =
      outputMode === "screen"
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
    setMessage(
      outputMode === "screen"
        ? "已复制终端镜像。"
        : outputMode === "wire"
          ? "已复制 raw wire。"
          : outputMode === "semantic"
            ? "已复制 semantic events。"
            : outputMode === "ansi"
              ? "已复制原始 ANSI 输出。"
              : "已复制清洗后的文本输出。",
    );
  };

  const activeStatus = activeSession ? statusMeta(activeSession.status) : null;
  const visibleOutput =
    outputMode === "screen"
      ? activeSession?.screen?.lines.join("\n")
      : outputMode === "wire"
        ? activeSession?.rawWireTail
        : outputMode === "semantic"
          ? formatSemanticEvents(activeSession?.semanticEventsTail ?? [])
          : outputMode === "ansi"
            ? activeSession?.rawOutput
            : activeSession?.output;

  const outputModeLabel =
    outputMode === "screen"
      ? "Screen"
      : outputMode === "wire"
        ? "Wire"
        : outputMode === "semantic"
          ? "Semantic"
          : outputMode === "ansi"
            ? "Raw ANSI"
            : "文本";

  const tuiPlugins = activeSession?.screen?.plugins ?? [];
  const selectedTuiPlugin = tuiPlugins.find((plugin) => plugin.selected);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--kimix-panel-bg)]">
      {/* 顶部标题栏 */}
      <div
        className="flex shrink-0 items-center justify-between border-b border-[var(--kimix-panel-divider)]"
        style={{ padding: "14px 20px" }}
      >
        <div className="flex items-center gap-2.5">
          <TerminalSquare size={20} className="text-[var(--kimix-panel-text)]" />
          <span className="text-[18px] font-semibold leading-7 text-[var(--kimix-panel-text)]">TUI 调试</span>
          {activeStatus ? (
            <span className={`ml-2 flex items-center gap-1.5 rounded-full text-[12px] leading-5 ${activeStatus.text}`} style={{ padding: "2px 10px" }}>
              <span className={`h-1.5 w-1.5 rounded-full ${activeStatus.dot}`} />
              {activeStatus.label}
            </span>
          ) : null}
        </div>
        <div className="flex items-center" style={{ gap: 6 }}>
          <button
            type="button"
            onClick={() => void refreshSessions()}
            disabled={busyAction === "refresh"}
            className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover"
          >
            <RefreshCw size={13} className={busyAction === "refresh" ? "kimix-spin" : ""} />
            刷新
          </button>
          <button
            type="button"
            onClick={clearView}
            className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover"
          >
            <Trash2 size={13} />
            清空视图
          </button>
        </div>
      </div>

      {/* 主体：左右分栏 */}
      <div className="flex min-h-0 flex-1" style={{ padding: "16px 20px 20px", gap: 16 }}>
        {/* 左栏：输出区（主角） */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface-elevated">
          {/* 标签栏 */}
          <div
            className="flex shrink-0 items-center justify-between border-b border-border-subtle"
            style={{ padding: "8px 10px", gap: 10 }}
          >
            <div className="flex items-center" style={{ gap: 4 }}>
              {(["screen", "wire", "semantic", "text", "ansi"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setOutputMode(mode)}
                  className={`rounded-md text-[12.5px] leading-5 transition-colors ${
                    outputMode === mode
                      ? "bg-accent-primary/10 font-medium text-accent-primary"
                      : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                  }`}
                  style={{ padding: "4px 10px" }}
                >
                  {mode === "screen" ? "Screen" : mode === "wire" ? "Wire" : mode === "semantic" ? "Semantic" : mode === "text" ? "文本" : "ANSI"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-text-muted">
                {activeSession?.screen
                  ? `${activeSession.screen.cols}×${activeSession.screen.rows}`
                  : `${terminalSize.cols}×${terminalSize.rows}`}
              </span>
              <button
                type="button"
                onClick={() => void copyOutput()}
                className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover"
              >
                <Copy size={13} />
                复制
              </button>
            </div>
          </div>

          {/* 输出内容 */}
          <pre
            ref={logRef}
            className="min-h-0 flex-1 overflow-auto text-[13px] leading-5 text-text-primary"
            style={{
              padding: "14px 16px",
              whiteSpace: "pre",
              wordBreak: "normal",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            }}
          >
            {visibleOutput?.trimEnd() ||
              (outputMode === "wire"
                ? "等待 wire.jsonl 输出。"
                : outputMode === "semantic"
                  ? "等待 semantic events。"
                  : "等待 TUI 输出。")}
          </pre>
        </div>

        {/* 右栏：控制面板 */}
        <div className="flex w-[300px] shrink-0 flex-col overflow-y-auto" style={{ gap: 12 }}>
          {/* 会话列表 */}
          {sessions.length > 0 && (
            <div className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)]" style={{ padding: "10px 12px" }}>
              <div className="mb-1.5 text-[12px] font-medium text-[var(--kimix-panel-text-muted)]">会话</div>
              <div className="flex flex-col" style={{ gap: 4 }}>
                {sessions.slice(0, 6).map((s) => {
                  const meta = statusMeta(s.status);
                  const isActive = s.sessionId === activeSessionId;
                  return (
                    <button
                      key={s.sessionId}
                      type="button"
                      onClick={() => setActiveSessionId(s.sessionId)}
                      className={`flex items-center gap-2 rounded-lg text-left text-[12.5px] leading-5 transition-colors ${
                        isActive ? "bg-[var(--kimix-panel-bg)] font-medium text-[var(--kimix-panel-text)]" : "text-[var(--kimix-panel-text-secondary)] hover:bg-[var(--kimix-panel-bg)]"
                      }`}
                      style={{ padding: "6px 8px" }}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
                      <span className="min-w-0 truncate">
                        {s.sessionId.slice(0, 8)}… · {s.backend.toUpperCase()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 会话信息（紧凑，可展开） */}
          <div className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)]" style={{ padding: "10px 12px" }}>
            <button
              type="button"
              onClick={() => setInfoExpanded((v) => !v)}
              className="flex w-full items-center justify-between text-[12px] font-medium text-[var(--kimix-panel-text-muted)]"
            >
              <span>会话信息</span>
              {infoExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
            {infoExpanded ? (
              <div className="mt-2 flex flex-col" style={{ gap: 4 }}>
                <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                  <span className="text-[var(--kimix-panel-text-muted)]">ID：</span>
                  {activeSession?.sessionId ?? "-"}
                </div>
                <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                  <span className="text-[var(--kimix-panel-text-muted)]">命令：</span>
                  {activeSession?.command ?? "-"}
                </div>
                <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                  <span className="text-[var(--kimix-panel-text-muted)]">后端：</span>
                  {activeSession?.backend.toUpperCase() ?? "-"}
                </div>
                <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                  <span className="text-[var(--kimix-panel-text-muted)]">工作目录：</span>
                  <span className="break-all">{activeSession?.workDir || workDir || "未设置"}</span>
                </div>
                <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                  <span className="text-[var(--kimix-panel-text-muted)]">PID：</span>
                  {activeSession?.pid ?? "?"}
                </div>
                <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                  <span className="text-[var(--kimix-panel-text-muted)]">尺寸：</span>
                  {activeSession ? `${terminalSize.cols}×${terminalSize.rows}` : "-"}
                </div>
                <div className="text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                  <span className="text-[var(--kimix-panel-text-muted)]">更新：</span>
                  {activeSession ? formatTime(activeSession.updatedAt) : "-"}
                </div>
                {activeSession?.wireFile && (
                  <div className="break-all text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                    <span className="text-[var(--kimix-panel-text-muted)]">Wire：</span>
                    {activeSession.wireFile}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-1 truncate text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                {activeSession
                  ? `${activeSession.sessionId.slice(0, 8)}… · ${activeSession.backend.toUpperCase()} · ${activeSession.workDir || workDir || "未设置"}`
                  : "尚未启动 TUI。"}
              </div>
            )}
            {activeSession?.error && (
              <div className="mt-2 rounded-md bg-accent-danger-light px-2.5 py-1.5 text-[12px] leading-4 text-accent-danger">
                {activeSession.error}
              </div>
            )}
          </div>

          {/* 插件（折叠） */}
          {tuiPlugins.length > 0 && (
            <div className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)]" style={{ padding: "10px 12px" }}>
              <button
                type="button"
                onClick={() => setPluginsExpanded((v) => !v)}
                className="flex w-full items-center justify-between text-[12px] font-medium text-[var(--kimix-panel-text-muted)]"
              >
                <span>插件 ({tuiPlugins.length})</span>
                {pluginsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
              {pluginsExpanded && (
                <div className="mt-2 flex flex-col" style={{ gap: 6 }}>
                  {tuiPlugins.map((plugin) => (
                    <div
                      key={`${plugin.source}:${plugin.id}`}
                      className={`rounded-md border ${plugin.selected ? "border-[var(--kimix-panel-border)] bg-[var(--kimix-panel-bg)]" : "border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)]"}`}
                      style={{ padding: "6px 8px" }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate text-[12.5px] font-medium text-[var(--kimix-panel-text)]">{plugin.name}</span>
                        <div className="flex shrink-0 items-center" style={{ gap: 4 }}>
                          <span className="rounded-full bg-[var(--kimix-panel-badge-bg)] text-[11px] leading-4 text-[var(--kimix-panel-badge-text)]" style={{ padding: "1px 6px" }}>
                            {pluginTrustLabel(plugin.trustLevel)}
                          </span>
                          <span className="rounded-full bg-accent-primary text-[11px] leading-4 text-white" style={{ padding: "1px 6px" }}>
                            {pluginStatusLabel(plugin.status)}
                          </span>
                        </div>
                      </div>
                      <div className="truncate text-[11px] leading-4 text-[var(--kimix-panel-text-secondary)]">
                        {plugin.id}
                        {plugin.version ? ` · v${plugin.version}` : ""}
                        {plugin.skillsCount !== null ? ` · ${plugin.skillsCount} skills` : ""}
                        {plugin.mcpSummary ? ` · ${plugin.mcpSummary}` : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!pluginsExpanded && selectedTuiPlugin && (
                <div className="mt-1 truncate text-[12px] leading-5 text-[var(--kimix-panel-text-secondary)]">
                  选中：<span className="font-medium text-[var(--kimix-panel-text)]">{selectedTuiPlugin.name}</span>
                </div>
              )}
            </div>
          )}

          {/* 发送区 */}
          <div className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)]" style={{ padding: "10px 12px" }}>
            <div className="mb-1.5 text-[12px] font-medium text-[var(--kimix-panel-text-muted)]">发送内容</div>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              className="kimix-settings-input w-full resize-none rounded-lg text-[13px] leading-5 outline-none transition-colors"
              style={{ padding: "8px 10px" }}
              placeholder="输入要发送给 TUI 的内容"
            />
            <div className="mt-2 flex items-center" style={{ gap: 6 }}>
              <button
                type="button"
                onClick={() => void sendDraft(draft)}
                disabled={busyAction === "send"}
                className="kimix-icon-text-button is-compact bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-wait disabled:opacity-55"
              >
                <Send size={12} />
                发送
              </button>
              <button
                type="button"
                onClick={() => void sendDraft("只回复 OK")}
                disabled={busyAction === "send"}
                className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55"
              >
                只回复 OK
              </button>
            </div>
          </div>

          {/* 方向键 */}
          <div className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)]" style={{ padding: "10px 12px" }}>
            <div className="mb-1.5 text-[12px] font-medium text-[var(--kimix-panel-text-muted)]">按键</div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 5 }}>
              <button
                type="button"
                onClick={() => void sendKey("escape")}
                disabled={busyAction === "key"}
                className="flex h-[30px] items-center justify-center rounded-md text-[11px] text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55"
              >
                Esc
              </button>
              <button
                type="button"
                onClick={() => void sendKey("arrowUp")}
                disabled={busyAction === "key"}
                className="flex h-[30px] items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55"
              >
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                onClick={() => void sendKey("enter")}
                disabled={busyAction === "key"}
                className="flex h-[30px] items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55"
              >
                <CornerDownLeft size={13} />
              </button>
              <button
                type="button"
                onClick={() => void sendKey("arrowLeft")}
                disabled={busyAction === "key"}
                className="flex h-[30px] items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55"
              >
                <ArrowLeft size={13} />
              </button>
              <button
                type="button"
                onClick={() => void sendKey("arrowDown")}
                disabled={busyAction === "key"}
                className="flex h-[30px] items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55"
              >
                <ArrowDown size={13} />
              </button>
              <button
                type="button"
                onClick={() => void sendKey("arrowRight")}
                disabled={busyAction === "key"}
                className="flex h-[30px] items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55"
              >
                <ArrowRight size={13} />
              </button>
            </div>
            <div className="mt-2 grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 5 }}>
              <button
                type="button"
                onClick={() => void sendKey("space")}
                disabled={busyAction === "key"}
                className="flex h-[28px] items-center justify-center rounded-md text-[11px] text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55"
              >
                Space
              </button>
              <button
                type="button"
                onClick={() => void sendKey("tab")}
                disabled={busyAction === "key"}
                className="flex h-[28px] items-center justify-center rounded-md text-[11px] text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55"
              >
                Tab
              </button>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex flex-col" style={{ gap: 6 }}>
            <button
              type="button"
              onClick={() => void startSession()}
              disabled={busyAction === "start"}
              className="kimix-icon-text-button justify-center bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-wait disabled:opacity-55"
              style={{ height: 34 }}
            >
              <CirclePlay size={14} />
              启动 TUI
            </button>
            <button
              type="button"
              onClick={() => void stopSession()}
              disabled={busyAction === "stop"}
              className="kimix-icon-text-button justify-center text-accent-danger hover:bg-accent-danger-light disabled:cursor-wait disabled:opacity-55"
              style={{ height: 34 }}
            >
              <Square size={14} />
              停止
            </button>
            <button
              type="button"
              onClick={() => probeFileRef.current?.click()}
              disabled={busyAction === "probe" || !activeSession}
              className="kimix-icon-text-button justify-center text-text-secondary hover:bg-surface-hover disabled:cursor-wait disabled:opacity-55"
              style={{ height: 34 }}
              title="剪贴板图片探针：写入系统剪贴板后向 TUI 发 Ctrl+V"
            >
              <ImageIcon size={14} />
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

          {/* 消息提示 */}
          {message && (
            <div className="rounded-md bg-[var(--kimix-panel-soft-bg)] px-2.5 py-1.5 text-[12px] leading-4 text-[var(--kimix-panel-text-secondary)]">
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
