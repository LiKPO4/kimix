import { useEffect, useRef, useState } from "react";
import { AlertCircle, BarChart3, Bot, CheckCircle2, Download, FolderOpen, GitBranch, Loader2, LogIn, PauseCircle, Radio, X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useLiveSession } from "@/hooks/useLiveSession";
import type { KimiUsageResponse, UsagePeriod } from "../../../electron/types/ipc";
import { compactModelDisplayName } from "@/utils/modelDisplay";

type UsageData = Extract<KimiUsageResponse, { success: true }>["data"];
const FALLBACK_KIMI_MODEL = "kimi-for-coding";
const KIMI_AUTH_CHANGED_EVENT = "kimix:kimi-auth-changed";
const KIMI_MODEL_CONFIG_CHANGED_EVENT = "kimix:kimi-model-config-changed";

function formatUsage(period: UsagePeriod) {
  if (!period.available || period.used === undefined || period.limit === undefined) {
    return period.message ?? "暂无官方数据";
  }
  const remaining = Math.max(0, period.limit - period.used);
  return `剩余 ${remaining}/${period.limit}`;
}

function formatDuration(ms: number) {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}天${hours}小时` : `${days}天`;
  if (hours > 0) return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
  return `${minutes}分钟`;
}

function formatUpdatedAt(value: number | undefined) {
  if (!value) return "尚未刷新";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未刷新";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function isUsageLoginExpired(message?: string) {
  return Boolean(message && /授权失败|重新登录|login|401|unauthorized/i.test(message));
}

function formatRefreshTime(value: number | undefined, now: number) {
  if (!value) return "刷新时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刷新时间未知";
  const remaining = value - now;
  if (remaining <= 0) return "即将刷新";
  return `将于 ${formatDuration(remaining)}后刷新`;
}

function UsageProgress({ period, now }: { period: UsagePeriod; now: number }) {
  const percent = Math.max(0, Math.min(100, period.percent ?? 0));
  return (
    <div style={{ paddingTop: 2, paddingBottom: 3 }}>
      <div className="flex items-center justify-between gap-5 text-[14px] leading-5">
        <span className="font-medium text-[var(--kimix-panel-text-secondary)]">{period.label}</span>
        <span className="shrink-0 text-[var(--kimix-panel-text-muted)]">{period.available ? `已用 ${percent.toFixed(0)}%` : "0%"}</span>
      </div>
      <div className="kimix-progress-track mt-2 h-2 overflow-hidden rounded-full">
        <div
          className="kimix-progress-fill h-full rounded-full"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[13px] leading-5 text-[var(--kimix-panel-text-muted)]">
        <span className="shrink-0">{formatRefreshTime(period.refreshAt, now)}</span>
        <span className="min-w-0 truncate">{formatUsage(period)}</span>
      </div>
    </div>
  );
}

function formatPluginSource(source: string | undefined) {
  return source === "marketplace" ? "Marketplace" : "Installed";
}

export function ContextBar({ onOpenGitDetails }: { onOpenGitDetails?: () => void }) {
  const project = useAppStore((s) => s.currentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const additionalWorkDirs = useAppStore((s) => s.additionalWorkDirs);
  const setAdditionalWorkDirs = useAppStore((s) => s.setAdditionalWorkDirs);
  const setWorkspaceView = useAppStore((s) => s.setWorkspaceView);
  const session = useLiveSession(currentSession?.id);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [workDirsOpen, setWorkDirsOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageLoginState, setUsageLoginState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [now, setNow] = useState(Date.now());
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const usageMenuRef = useRef<HTMLDivElement>(null);
  const workDirsRef = useRef<HTMLDivElement>(null);
  const activeSession = session ?? currentSession;
  const sessionHasStarted = Boolean(activeSession && activeSession.events.length > 0);
  const sessionModel = sessionHasStarted && activeSession?.model && activeSession.model !== "Kimi Code SDK" ? activeSession.model : null;
  const displayModel = defaultModel ?? sessionModel ?? FALLBACK_KIMI_MODEL;
  const compactDisplayModel = compactModelDisplayName(displayModel);
  const modelTitle = sessionModel && sessionModel === displayModel
    ? `当前对话模型：${displayModel}`
    : `当前默认模型：${displayModel}`;
  const pendingApprovalCount = activeSession?.events.filter((event) => event.type === "approval_request" && event.status === "pending").length ?? 0;
  const pendingQuestionCount = activeSession?.events.filter((event) => event.type === "question_request" && event.status === "pending").length ?? 0;
  const latestError = [...(activeSession?.events ?? [])].reverse().find((event) => event.type === "error");
  const isSessionRunning = Boolean(activeSession && runningSessionId === activeSession.id);
  const kimiStatus = pendingApprovalCount > 0
    ? { label: "待审批", tone: "warning" as const, icon: PauseCircle, detail: `${pendingApprovalCount} 个权限请求等待处理` }
    : pendingQuestionCount > 0
      ? { label: "待回答", tone: "warning" as const, icon: PauseCircle, detail: `${pendingQuestionCount} 个问题等待回答` }
      : isSessionRunning
        ? { label: "运行中", tone: "active" as const, icon: Loader2, detail: `Kimi Code 正在执行当前轮次` }
        : latestError
          ? { label: "有错误", tone: "danger" as const, icon: AlertCircle, detail: latestError.message }
          : activeSession?.engine === "kimi-code" || activeSession?.runtimeSessionId
            ? { label: "已连接", tone: "success" as const, icon: CheckCircle2, detail: `runtime: ${activeSession.runtimeSessionId ?? activeSession.id}` }
            : { label: "未连接", tone: "muted" as const, icon: Radio, detail: "当前没有 Kimi Code 运行会话" };
  const KimiStatusIcon = kimiStatus.icon;

  const handleExport = () => {
    if (!session) return;
    let md = `# ${session.title}\n\n`;
    for (const ev of session.events) {
      if (ev.type === "user_message") {
        md += `## User\n\n${ev.content}\n\n`;
      } else if (ev.type === "assistant_message") {
        md += `## Assistant\n\n${ev.content}\n\n`;
        if (ev.thinking) {
          md += `> **Thinking**\n> ${ev.thinking.replace(/\n/g, "\n> ")}\n\n`;
        }
      } else if (ev.type === "tool_call") {
        md += `> **Tool**: ${ev.toolName}\n\n`;
      } else if (ev.type === "error") {
        md += `> **Error**: ${ev.message}\n\n`;
      }
    }
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${session.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_")}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const addAdditionalWorkDir = async () => {
    let res;
    try {
      res = await window.api.chooseDirectory({ defaultPath: project?.path });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const needsRestart = message.includes("project:chooseDirectory") || message.includes("No handler registered");
      window.dispatchEvent(new CustomEvent("kimix:toast", {
        detail: needsRestart
          ? "选择目录入口需要重启到新版 Kimix 后生效"
          : `选择目录失败：${message}`,
      }));
      return;
    }
    if (!res.success) {
      window.dispatchEvent(new CustomEvent("kimix:toast", { detail: `选择目录失败：${res.error}` }));
      return;
    }
    const selected = res.data?.trim();
    if (!selected) return;
    const normalizedSelected = selected.replace(/\\/g, "/").toLowerCase();
    const exists = additionalWorkDirs.some((dir) => dir.replace(/\\/g, "/").toLowerCase() === normalizedSelected);
    if (exists) {
      window.dispatchEvent(new CustomEvent("kimix:toast", { detail: "该目录已在额外工作目录中" }));
      return;
    }
    setAdditionalWorkDirs([...additionalWorkDirs, selected]);
    window.dispatchEvent(new CustomEvent("kimix:toast", { detail: "已添加额外工作目录" }));
  };

  const removeAdditionalWorkDir = (index: number) => {
    setAdditionalWorkDirs(additionalWorkDirs.filter((_, itemIndex) => itemIndex !== index));
  };

  const loadUsage = async () => {
    setUsageLoading(true);
    setUsageLoginState("idle");
    try {
      const res = await window.api.getKimiUsage();
      if (res.success) {
        setUsageData(res.data);
      } else {
        setUsageData({
          available: false,
          updatedAt: Date.now(),
          source: "Kimi Code 官方用量接口",
          message: res.error,
          periods: [
            { label: "5小时", available: false, percent: 0, message: "获取失败" },
            { label: "本周", available: false, percent: 0, message: "获取失败" },
          ],
        });
      }
    } catch (err) {
      setUsageData({
        available: false,
        updatedAt: Date.now(),
        source: "Kimi Code 官方用量接口",
        message: err instanceof Error ? err.message : "获取失败",
        periods: [
          { label: "5小时", available: false, percent: 0, message: "获取失败" },
          { label: "本周", available: false, percent: 0, message: "获取失败" },
        ],
      });
    } finally {
      setUsageLoading(false);
    }
  };

  const loginForUsage = async () => {
    setUsageLoginState("running");
    const res = await window.api.loginKimi();
    if (!res.success) {
      setUsageLoginState("error");
      setUsageData((current) => current ? { ...current, message: res.error } : current);
      return;
    }
    setUsageLoginState("done");
    window.dispatchEvent(new CustomEvent(KIMI_AUTH_CHANGED_EVENT));
    await loadUsage();
  };
  const toggleUsage = () => {
    const next = !usageOpen;
    setUsageOpen(next);
    if (next && !usageData) {
      void loadUsage();
    }
  };

  const openModelSettings = async () => {
    setWorkspaceView("settings");
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("kimix:focus-model-settings"));
    }, 80);
  };

  const openKimiStatusSettings = async () => {
    setWorkspaceView("settings");
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(latestError ? "kimix:focus-auth-settings" : "kimix:focus-model-settings"));
    }, 80);
  };

  useEffect(() => {
    setGitBranch(null);
    if (!project?.path) return;
    let cancelled = false;
    window.api.getGitInfo(project.path).then((res) => {
      if (cancelled) return;
      setGitBranch(res.success && res.data.branch ? res.data.branch : null);
    }).catch(() => {
      if (!cancelled) setGitBranch(null);
    });
    return () => {
      cancelled = true;
    };
  }, [project?.path, project?.gitBranch]);

  useEffect(() => {
    let cancelled = false;
    const loadDefaultModel = async () => {
      try {
        const res = await window.api.getKimiModelConfig();
        if (cancelled) return;
        setDefaultModel(res.success ? (res.data.defaultModel?.trim() || FALLBACK_KIMI_MODEL) : FALLBACK_KIMI_MODEL);
      } catch {
        if (!cancelled) setDefaultModel(FALLBACK_KIMI_MODEL);
      }
    };
    void loadDefaultModel();
    const handleModelConfigChanged = () => void loadDefaultModel();
    window.addEventListener(KIMI_AUTH_CHANGED_EVENT, handleModelConfigChanged);
    window.addEventListener(KIMI_MODEL_CONFIG_CHANGED_EVENT, handleModelConfigChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(KIMI_AUTH_CHANGED_EVENT, handleModelConfigChanged);
      window.removeEventListener(KIMI_MODEL_CONFIG_CHANGED_EVENT, handleModelConfigChanged);
    };
  }, []);

  useEffect(() => {
    if (!usageOpen && !workDirsOpen) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    const handlePointerDown = (event: PointerEvent) => {
      if (!usageMenuRef.current?.contains(event.target as Node)) {
        setUsageOpen(false);
      }
      if (!workDirsRef.current?.contains(event.target as Node)) {
        setWorkDirsOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [usageOpen, workDirsOpen]);

  return (
    <div className="flex w-full items-center justify-between gap-3 px-1 text-[14px] text-[var(--kimix-panel-text-secondary)]" style={{ height: 36, lineHeight: "20px" }}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div ref={workDirsRef} className="relative min-w-0">
          <button
            type="button"
            onClick={() => setWorkDirsOpen((value) => !value)}
            className="kimix-contextbar-action kimix-muted-action flex min-w-0 items-center rounded-lg"
            style={{ gap: 8, height: 36, lineHeight: "20px", paddingLeft: 12, paddingRight: 12 }}
            title={project?.path ?? "当前项目"}
            aria-label={project?.name ? `当前项目：${project.name}` : "当前项目"}
          >
            <FolderOpen size={16} className="shrink-0" />
            <span className="max-w-[220px] truncate" style={{ lineHeight: "20px", paddingBottom: 1 }}>{project?.name ?? "未选择项目"}</span>
          </button>
          {workDirsOpen && (
            <div className="kimix-floating-panel absolute bottom-9 left-0 z-40 w-[360px] rounded-xl" style={{ padding: "16px 18px 18px" }}>
              <div className="grid items-center" style={{ columnGap: 16, gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                <div className="min-w-0 self-center">
                  <div className="text-[14px] font-semibold leading-5 text-[var(--kimix-panel-text)]">工作目录</div>
                  <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 4 }}>额外目录会通过 Kimi Code --add-dir 纳入当前会话。</div>
                </div>
                <button
                  type="button"
                  onClick={() => void addAdditionalWorkDir()}
                  className="kimix-icon-text-button is-compact flex shrink-0 items-center justify-center self-center rounded-lg bg-accent-primary text-white hover:bg-accent-primary-dark"
                  style={{ height: 34, minHeight: 34, transform: "translateY(1px)" }}
                >
                  <FolderOpen size={13} />
                  选择目录
                </button>
              </div>
              <div className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)]" style={{ marginTop: 16, padding: "12px 13px" }}>
                <div className="text-[12px] font-medium leading-5 text-[var(--kimix-panel-text-muted)]">主目录</div>
                <div className="break-all text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ marginTop: 4 }}>{project?.path ?? "未选择项目"}</div>
              </div>
              <div className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)]" style={{ marginTop: 14, padding: "12px 12px 12px" }}>
                <div className="grid items-center" style={{ gap: 10, gridTemplateColumns: "minmax(0, 1fr) auto", marginBottom: 10 }}>
                  <span className="text-[12px] font-medium leading-5 text-[var(--kimix-panel-text-muted)]">额外工作目录</span>
                  <span className="inline-flex items-center justify-center rounded-full bg-accent-primary-light text-[12px] leading-none text-accent-primary-dark" style={{ height: 20, minWidth: 20, paddingLeft: 8, paddingRight: 8 }}>{additionalWorkDirs.length}</span>
                </div>
                {additionalWorkDirs.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--kimix-panel-border-soft)] text-[13px] leading-6 text-[var(--kimix-panel-text-muted)]" style={{ padding: "13px 14px" }}>
                    暂无额外目录。点击“选择目录”添加共享库、相邻仓库或资源目录。
                  </div>
                ) : (
                  <div className="flex flex-col" style={{ gap: 8 }}>
                    {additionalWorkDirs.map((dir, index) => (
                      <div key={`${index}-${dir}`} className="grid items-center rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)]" style={{ columnGap: 10, gridTemplateColumns: "minmax(0, 1fr) 32px", padding: "10px 10px 10px 12px" }}>
                        <div className="min-w-0 flex-1 break-all text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]">{dir}</div>
                        <button
                          type="button"
                          onClick={() => removeAdditionalWorkDir(index)}
                          className="kimix-muted-action flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-lg text-accent-danger"
                          title="移除目录"
                          aria-label="移除目录"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div ref={usageMenuRef} className="relative hidden min-w-0 sm:block">
          <button
            type="button"
            onClick={toggleUsage}
            className="kimix-icon-text-button kimix-muted-action is-compact min-w-0"
            style={{ height: 36, paddingLeft: 12, paddingRight: 12 }}
            title="套餐用量"
            aria-label="套餐用量"
          >
            <BarChart3 size={16} className="shrink-0" />
            <span className="truncate">套餐用量</span>
          </button>
          {usageOpen && (
            <div
              className="kimix-floating-panel absolute bottom-10 left-0 z-40 w-[330px] rounded-xl"
              style={{ paddingLeft: 22, paddingRight: 22, paddingTop: 20, paddingBottom: 21 }}
            >
              <div className="flex items-center justify-between gap-4" style={{ marginBottom: 18 }}>
                <div className="min-w-0">
                  <div className="text-[16px] font-medium leading-5 text-[var(--kimix-panel-text)]">套餐用量</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={loadUsage}
                    className="kimix-icon-text-button kimix-muted-action is-compact shrink-0"
                  >
                    {usageLoading ? <Loader2 size={14} className="animate-spin" /> : "刷新"}
                  </button>
                </div>
              </div>
              <div className="flex flex-col" style={{ gap: 15 }}>
                {(usageData?.periods ?? [
                  { label: "5小时", available: false, percent: 0, message: "正在获取" },
                  { label: "本周", available: false, percent: 0, message: "正在获取" },
                ]).map((period) => (
                  <UsageProgress key={period.label} period={period} now={now} />
                ))}
              </div>
              {usageData?.message && (
                <div className="kimix-soft-card mt-5 rounded-lg text-[12.5px] leading-relaxed" style={{ padding: "13px 12px" }}>
                  {usageData.message}
                </div>
              )}
            </div>
          )}
        </div>
        {gitBranch && (
          <button
            type="button"
            onClick={onOpenGitDetails}
            className="kimix-contextbar-action kimix-muted-action hidden min-w-0 items-center rounded-lg md:flex"
            style={{ gap: 8, height: 36, lineHeight: "20px", paddingLeft: 12, paddingRight: 12 }}
            title={gitBranch}
            aria-label={`当前分支：${gitBranch}`}
          >
            <GitBranch size={16} className="shrink-0" />
            <span className="max-w-[150px] truncate" style={{ lineHeight: "20px", paddingBottom: 1 }}>{gitBranch}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => void openModelSettings()}
          className="kimix-contextbar-action kimix-muted-action hidden min-w-0 items-center rounded-lg lg:flex"
          style={{ gap: 8, height: 36, lineHeight: "20px", paddingLeft: 12, paddingRight: 12 }}
          title={modelTitle}
          aria-label={`${modelTitle}，打开模型设置`}
        >
          <Bot size={16} className="shrink-0" />
          <span className="shrink-0" style={{ lineHeight: "20px", paddingBottom: 1 }}>模型</span>
          <span className="max-w-[190px] truncate font-medium text-[var(--kimix-panel-text)]" style={{ lineHeight: "20px", paddingBottom: 1 }}>{compactDisplayModel}</span>
        </button>
        <button
          type="button"
          onClick={() => void openKimiStatusSettings()}
          className={`kimix-contextbar-action kimix-kimi-status-text is-${kimiStatus.tone} hidden min-w-0 items-center rounded-lg md:flex`}
          style={{ gap: 7, height: 36, lineHeight: "20px", paddingLeft: 10, paddingRight: 10 }}
          title={kimiStatus.detail}
          aria-label={`Kimi Code 状态：${kimiStatus.label}`}
        >
          <KimiStatusIcon size={16} className={`shrink-0 ${isSessionRunning ? "animate-spin" : ""}`} />
          <span className="truncate" style={{ lineHeight: "20px", paddingBottom: 1 }}>{kimiStatus.label}</span>
        </button>
      </div>

      {session && (
        <button
          onClick={handleExport}
          className="kimix-icon-text-button kimix-muted-action is-compact shrink-0"
          style={{ height: 36 }}
          title="导出聊天记录"
          aria-label="导出聊天记录"
        >
          <Download size={16} />
          <span>导出</span>
        </button>
      )}
    </div>
  );
}
