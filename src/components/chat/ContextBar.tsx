import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, BarChart3, Bot, Check, CheckCircle2, ChevronDown, Download, FolderOpen, GitBranch, Loader2, LogIn, PauseCircle, Radio, Search, Settings2, X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useLiveSession } from "@/hooks/useLiveSession";
import type { KimiCodeServerModelCatalog, KimiModelConfigSummary, KimiUsageResponse, UsagePeriod } from "../../../electron/types/ipc";
import type { Session } from "@/types/ui";
import { compactModelDisplayName, getSessionModelForDisplay } from "@/utils/modelDisplay";
import { sessionToMarkdown } from "@/utils/markdownExport";
import { displayProjectName } from "@/utils/projectDisplay";
import { isSessionRuntimeRunning } from "@/utils/sessionActivity";
import { getRuntimeSessionId } from "@/utils/runtimeSession";
import { buildSessionModelOptions, groupSessionModelOptions } from "@/utils/sessionModelCatalog";
import { normalizeAdditionalWorkDirs } from "@/utils/additionalWorkDirs";
import { runKimiCodeSessionMutationWithRecovery } from "@/utils/kimiCodeSessionRecovery";

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

function formatTotalQuota(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function formatRefreshTime(value: number | undefined, now: number) {
  if (!value) return "刷新时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刷新时间未知";
  const remaining = value - now;
  if (remaining <= 0) return "即将刷新";
  return `将于 ${formatDuration(remaining)}后刷新`;
}

function getDisplaySessionId(session: Session | null | undefined): string | null {
  if (!session) return null;
  const candidates = [session.runtimeSessionId, session.officialSessionId, session.id].filter((id): id is string => Boolean(id));
  const nonSkill = candidates.find((id) => !id.startsWith("skill-"));
  return nonSkill ?? candidates[0] ?? null;
}

function getPeriodWindowMs(label: string): number | null {
  if (/5\s*小时/.test(label)) return 5 * 3600 * 1000;
  if (/本周|每周|一周|\bweek\b/i.test(label)) return 7 * 24 * 3600 * 1000;
  return null;
}

function UsageProgress({ period, now }: { period: UsagePeriod; now: number }) {
  const percent = Math.max(0, Math.min(100, period.percent ?? 0));
  // Prefer the actual window duration reported by the upstream API. Only fall
  // back to label-based heuristics when it is unavailable.
  const windowMs = period.windowMs ?? getPeriodWindowMs(period.label);
  // Elapsed-time bar: how much of the window has already passed.
  // e.g. 5h window with 1h remaining → elapsed = 4h → 80% green.
  const timePercent = (period.refreshAt && windowMs)
    ? Math.max(0, Math.min(100, (1 - (period.refreshAt - now) / windowMs) * 100))
    : null;
  return (
    <div style={{ paddingTop: 2, paddingBottom: 3 }}>
      <div className="flex items-center justify-between gap-5 text-[14px] leading-5">
        <span className="font-medium text-[var(--kimix-panel-text-secondary)]">{period.label}</span>
        <span className="kimix-tabular-nums shrink-0 text-[var(--kimix-panel-text-muted)]">{period.available ? `已用 ${percent.toFixed(0)}%` : "0%"}</span>
      </div>
      {/* Usage bar — square corners override the CSS class border-radius */}
      <div
        className="kimix-progress-track mt-2 h-2 overflow-hidden"
        style={{ borderRadius: 0 }}
      >
        <div
          className="kimix-progress-fill h-full"
          style={{ width: `${percent}%`, borderRadius: 0 }}
        />
      </div>
      {timePercent !== null && (
        <div
          className="kimix-progress-track mt-1 h-[3px] overflow-hidden"
          style={{ borderRadius: 0 }}
        >
          <div
            className="h-full"
            style={{ width: `${timePercent}%`, borderRadius: 0, background: "#2ddd19" }}
          />
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-3 text-[13px] leading-5 text-[var(--kimix-panel-text-muted)]">
        <span className="kimix-tabular-nums shrink-0">{formatRefreshTime(period.refreshAt, now)}</span>
        <span className="kimix-tabular-nums min-w-0 truncate">{formatUsage(period)}</span>
      </div>
    </div>
  );
}

export function ContextBar({ onOpenGitDetails }: { onOpenGitDetails?: () => void }) {
  const project = useAppStore((s) => s.currentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const additionalWorkDirs = useAppStore((s) => s.additionalWorkDirs);
  const setAdditionalWorkDirs = useAppStore((s) => s.setAdditionalWorkDirs);
  const setWorkspaceView = useAppStore((s) => s.setWorkspaceView);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const session = useLiveSession(currentSession?.id);
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [workDirsOpen, setWorkDirsOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [usageLoginState, setUsageLoginState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [now, setNow] = useState(Date.now());
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelCatalogLoading, setModelCatalogLoading] = useState(false);
  const [modelCatalogError, setModelCatalogError] = useState("");
  const [modelConfig, setModelConfig] = useState<KimiModelConfigSummary | null>(null);
  const [serverModelCatalog, setServerModelCatalog] = useState<KimiCodeServerModelCatalog | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [switchingModel, setSwitchingModel] = useState<string | null>(null);
  const usageMenuRef = useRef<HTMLDivElement>(null);
  const usageRequestIdRef = useRef(0);
  const workDirsRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const activeSession = session ?? currentSession;
  const projectDisplayName = displayProjectName(project);
  const sessionModel = getSessionModelForDisplay({
    events: activeSession?.events ?? [],
    sessionModel: activeSession?.switchedToModel || (activeSession?.model && activeSession.model !== "Kimi Code SDK" ? activeSession.model : null),
    modelSwitchedAt: activeSession?.modelSwitchedAt,
  });
  const displayModel = sessionModel ?? defaultModel ?? FALLBACK_KIMI_MODEL;
  const compactDisplayModel = compactModelDisplayName(displayModel);
  const modelDisplayFontSize = compactDisplayModel.length > 28 ? 11 : compactDisplayModel.length > 20 ? 12 : 13;
  const modelTitle = sessionModel
    ? `当前对话模型：${displayModel}`
    : `当前默认模型：${displayModel}`;
  const modelOptions = useMemo(
    () => buildSessionModelOptions(modelConfig, serverModelCatalog),
    [modelConfig, serverModelCatalog],
  );
  const filteredModelOptions = useMemo(() => {
    const query = modelSearch.trim().toLocaleLowerCase();
    if (!query) return modelOptions;
    return modelOptions.filter((option) => (
      option.label.toLocaleLowerCase().includes(query) ||
      option.id.toLocaleLowerCase().includes(query) ||
      option.providerLabel.toLocaleLowerCase().includes(query)
    ));
  }, [modelOptions, modelSearch]);
  const modelGroups = useMemo(() => groupSessionModelOptions(filteredModelOptions), [filteredModelOptions]);
  const pendingApprovalCount = activeSession?.events.filter((event) => event.type === "approval_request" && event.status === "pending").length ?? 0;
  const pendingQuestionCount = activeSession?.events.filter((event) => event.type === "question_request" && event.status === "pending").length ?? 0;
  const firstPendingApproval = activeSession?.events.find((event) => event.type === "approval_request" && event.status === "pending");
  const firstPendingQuestion = activeSession?.events.find((event) => event.type === "question_request" && event.status === "pending");
  const latestError = [...(activeSession?.events ?? [])].reverse().find((event) => event.type === "error");
  const isSessionRunning = isSessionRuntimeRunning(activeSession, runningSessionId);
  const activeRuntimeSessionId = activeSession ? getRuntimeSessionId(activeSession) : null;
  // Only block model switching when the active session is the one currently
  // tracked as running. A session with stale open timeline work should not
  // prevent the user from switching models in a different session.
  const isActiveRuntimeSessionRunning = Boolean(
    runningSessionId && activeSession && (
      runningSessionId === activeSession.id ||
      Boolean(activeRuntimeSessionId && runningSessionId === activeRuntimeSessionId)
    )
  );
  const kimiStatus = pendingApprovalCount > 0
    ? { label: "待审批", tone: "warning" as const, icon: PauseCircle, detail: `${pendingApprovalCount} 个权限请求等待处理` }
    : pendingQuestionCount > 0
      ? { label: "待回答", tone: "warning" as const, icon: PauseCircle, detail: `${pendingQuestionCount} 个问题等待回答` }
      : isSessionRunning
        ? { label: "运行中", tone: "active" as const, icon: Loader2, detail: `Kimi Code 正在执行当前轮次` }
        : latestError
          ? { label: "有错误", tone: "danger" as const, icon: AlertCircle, detail: latestError.message }
          : activeSession?.engine === "kimi-code" || activeSession?.runtimeSessionId
            ? (() => {
                const displayId = getDisplaySessionId(activeSession);
                const isRuntimeId = displayId === activeSession?.runtimeSessionId;
                return { label: "已连接", tone: "success" as const, icon: CheckCircle2, detail: `${isRuntimeId ? "runtime" : "会话"}: ${displayId ?? activeSession?.id}` };
              })()
            : { label: "未连接", tone: "muted" as const, icon: Radio, detail: "当前没有 Kimi Code 运行会话" };
  const KimiStatusIcon = kimiStatus.icon;

  const handleExport = async () => {
    if (!session) return;
    const res = await window.api.exportMarkdown({
      title: session.title,
      content: sessionToMarkdown(session),
    });
    if (!res.success) window.alert(`导出失败：${res.error}`);
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

  const loadUsage = async ({ background = false }: { background?: boolean } = {}) => {
    const requestId = usageRequestIdRef.current + 1;
    usageRequestIdRef.current = requestId;
    if (!background) setUsageLoading(true);
    setUsageLoginState("idle");
    try {
      const res = await window.api.getKimiCodeAccountUsage();
      if (usageRequestIdRef.current !== requestId) return;
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
      if (usageRequestIdRef.current !== requestId) return;
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
      if (usageRequestIdRef.current === requestId && !background) setUsageLoading(false);
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
    setModelMenuOpen(false);
    setUsageOpen(next);
    if (next) {
      // Refresh on open, but only spin when there is nothing to show yet.
      // With cached data present, refresh silently in the background so the
      // panel shows current numbers immediately without a loading spinner.
      void loadUsage({ background: Boolean(usageData) });
    }
  };

  const loadModelCatalog = async () => {
    setModelCatalogLoading(true);
    setModelCatalogError("");
    try {
      const [configResult, serverResult] = await Promise.all([
        window.api.getKimiModelConfig(),
        window.api.getKimiCodeServerModelCatalog(),
      ]);
      setModelConfig(configResult.success ? configResult.data : null);
      setServerModelCatalog(serverResult.success ? serverResult.data : null);
      if (configResult.success) {
        setDefaultModel(configResult.data.defaultModel?.trim() || FALLBACK_KIMI_MODEL);
      }
      if (!configResult.success && !serverResult.success) {
        setModelCatalogError("暂时无法读取模型列表");
      }
    } catch {
      setModelCatalogError("暂时无法读取模型列表");
    } finally {
      setModelCatalogLoading(false);
    }
  };

  const toggleModelMenu = () => {
    const next = !modelMenuOpen;
    setUsageOpen(false);
    setWorkDirsOpen(false);
    setModelMenuOpen(next);
    if (next) {
      setModelSearch("");
      void loadModelCatalog();
    }
  };

  const handleSelectModel = async (model: string) => {
    if (!activeSession || activeSession.isLoading || switchingModel) return;
    if (isActiveRuntimeSessionRunning) {
      showToast("本轮结束后可切换模型");
      return;
    }
    if (model === sessionModel) {
      setModelMenuOpen(false);
      return;
    }
    const runtimeSessionId = getRuntimeSessionId(activeSession);
    if (!runtimeSessionId) {
      showToast("当前会话尚未就绪");
      return;
    }
    setSwitchingModel(model);
    const switchedAt = Date.now();
    updateSession(activeSession.id, (current) => ({ ...current, modelSwitchedAt: switchedAt, switchedToModel: model, updatedAt: switchedAt }));
    let result;
    try {
      result = await runKimiCodeSessionMutationWithRecovery({
        sessionId: runtimeSessionId,
        projectPath: activeSession.projectPath,
        additionalWorkDirs: normalizeAdditionalWorkDirs(additionalWorkDirs),
        crossProjectError: "恢复后的会话属于其他项目，已拒绝切换模型",
        mutate: (sessionId) => window.api.setKimiCodeModel({ sessionId, model }),
        resumeSession: window.api.resumeKimiCodeSession,
      });
    } catch (error) {
      setSwitchingModel(null);
      updateSession(activeSession.id, (current) => ({ ...current, modelSwitchedAt: undefined, switchedToModel: undefined, updatedAt: Date.now() }));
      showToast(`切换模型失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    setSwitchingModel(null);
    if (!result.success) {
      updateSession(activeSession.id, (current) => ({ ...current, modelSwitchedAt: undefined, switchedToModel: undefined, updatedAt: Date.now() }));
      showToast(`切换模型失败：${result.error}`);
      return;
    }
    updateSession(activeSession.id, (current) => ({
      ...current,
      model,
      runtimeSessionId: result.sessionId,
      officialSessionId: result.sessionId,
      switchedToModel: undefined,
      updatedAt: switchedAt,
    }));
    const updated = useSessionStore.getState().sessions.find((item) => item.id === activeSession.id);
    if (updated && currentSession?.id === updated.id) setCurrentSession(updated);
    setModelMenuOpen(false);
    showToast(`已切换为 ${compactModelDisplayName(model)}`);
  };

  const openModelSettings = async () => {
    setWorkspaceView("settings");
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("kimix:focus-model-settings"));
    }, 80);
  };

  const showToast = (detail: string) => {
    window.dispatchEvent(new CustomEvent("kimix:toast", { detail }));
  };

  const scrollToStatusEvent = (elementId: string, successMessage: string) => {
    const element = document.getElementById(elementId);
    if (!element) {
      showToast("暂未找到对应卡片，请在当前对话中查看");
      return;
    }
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    showToast(successMessage);
  };

  const handleKimiStatusClick = async () => {
    if (firstPendingApproval?.type === "approval_request") {
      scrollToStatusEvent(`kimix-approval-${firstPendingApproval.id}`, `${pendingApprovalCount} 个权限请求等待处理`);
      return;
    }
    if (firstPendingQuestion?.type === "question_request") {
      scrollToStatusEvent(`kimix-question-${firstPendingQuestion.id}`, `${pendingQuestionCount} 个问题等待回答`);
      return;
    }
    if (latestError) {
      const message = latestError.message || String(latestError);
      try {
        await navigator.clipboard.writeText(message);
        showToast("错误信息已复制到剪贴板");
      } catch {
        showToast(`错误：${message}`);
      }
      return;
    }
    if (isSessionRunning) {
      showToast("当前轮次正在运行");
      return;
    }
    const displayId = getDisplaySessionId(activeSession);
    if (displayId) {
      await navigator.clipboard?.writeText(displayId);
      const isRuntimeId = displayId === activeSession?.runtimeSessionId;
      showToast(isRuntimeId ? "已复制 runtime session id" : "已复制会话 ID");
      return;
    }
    showToast("当前没有 Kimi Code 运行会话");
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
    if (!usageOpen && !workDirsOpen && !modelMenuOpen) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    const handlePointerDown = (event: PointerEvent) => {
      if (!usageMenuRef.current?.contains(event.target as Node)) {
        setUsageOpen(false);
      }
      if (!workDirsRef.current?.contains(event.target as Node)) {
        setWorkDirsOpen(false);
      }
      if (!modelMenuRef.current?.contains(event.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModelMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [usageOpen, workDirsOpen, modelMenuOpen]);

  return (
    <div className="flex w-full items-center justify-between gap-2 px-1 text-[14px] text-[var(--kimix-panel-text-secondary)]" style={{ height: 36, lineHeight: "20px" }}>
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <div ref={workDirsRef} className="relative min-w-0 shrink-0">
          <button
            type="button"
            onClick={() => setWorkDirsOpen((value) => !value)}
            className="kimix-contextbar-action kimix-muted-action flex min-w-0 items-center rounded-lg"
            style={{ gap: 8, height: 36, lineHeight: "20px", paddingLeft: 12, paddingRight: 12 }}
            title={project?.path ?? "当前项目"}
            aria-label={project ? `当前项目：${projectDisplayName}` : "当前项目"}
          >
            <FolderOpen size={16} className="shrink-0" />
            <span style={{ lineHeight: "20px", paddingBottom: 1 }}>工作空间</span>
          </button>
          {workDirsOpen && (
            <div className="kimix-floating-panel absolute bottom-9 left-0 z-40 w-[360px] rounded-xl" style={{ padding: "16px 18px 18px" }}>
              <div className="grid items-center" style={{ columnGap: 16, gridTemplateColumns: "minmax(0, 1fr) auto" }}>
                <div className="min-w-0 self-center">
                  <div className="text-[14px] font-semibold leading-5 text-[var(--kimix-panel-text)]">工作目录</div>
                  <div className="text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ marginTop: 4 }}>额外目录会纳入当前 Kimi Code 会话上下文。</div>
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
        <div ref={usageMenuRef} className="relative hidden shrink-0 sm:block">
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
                    onClick={() => void loadUsage()}
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
              {usageData?.totalQuota !== undefined && (
                <div
                  className="flex items-center justify-between border-t border-[var(--kimix-panel-border-soft)] text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]"
                  style={{ marginTop: 16, padding: "12px 2px 0" }}
                >
                  <span>Kimi Code 总额度</span>
                  <span className="kimix-tabular-nums shrink-0">{formatTotalQuota(usageData.totalQuota)}</span>
                </div>
              )}
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
        <div ref={modelMenuRef} className="relative hidden min-w-0 max-w-[280px] flex-1 lg:block">
          <button
            type="button"
            onClick={toggleModelMenu}
            className="kimix-contextbar-action kimix-muted-action flex min-w-0 items-center rounded-lg"
            style={{ gap: 8, height: 36, lineHeight: "20px", paddingLeft: 12, paddingRight: 12 }}
            title={modelTitle}
            aria-label={`${modelTitle}，选择会话模型`}
            aria-haspopup="menu"
            aria-expanded={modelMenuOpen}
          >
            <Bot size={16} className="shrink-0" />
            <span className="shrink-0" style={{ lineHeight: "20px", paddingBottom: 1 }}>模型</span>
            <span className="min-w-0 flex-1 truncate font-medium text-[var(--kimix-panel-text)]" style={{ lineHeight: "20px", paddingBottom: 1, fontSize: modelDisplayFontSize }}>{compactDisplayModel}</span>
            <ChevronDown size={14} className={`shrink-0 transition-transform duration-150 ${modelMenuOpen ? "rotate-180" : ""}`} />
          </button>
          {modelMenuOpen && (
            <div
              role="menu"
              aria-label="选择会话模型"
              className="kimix-floating-panel absolute bottom-10 right-0 z-50 w-[330px] overflow-hidden rounded-xl"
              style={{ padding: 12 }}
            >
              <div className="grid items-center" style={{ columnGap: 12, gridTemplateColumns: "minmax(0, 1fr) auto", paddingLeft: 4, paddingRight: 4 }}>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold leading-5 text-[var(--kimix-panel-text)]">会话模型</div>
                  <div className="truncate text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]" title={displayModel} style={{ marginTop: 2 }}>
                    当前：{compactDisplayModel}
                  </div>
                </div>
                {isActiveRuntimeSessionRunning && (
                  <span className="shrink-0 text-[12px] leading-5 text-[var(--kimix-panel-text-muted)]">本轮结束后可切换</span>
                )}
              </div>

              {modelOptions.length > 8 && (
                <label className="relative block" style={{ marginTop: 12 }}>
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--kimix-panel-text-muted)]" />
                  <input
                    value={modelSearch}
                    onChange={(event) => setModelSearch(event.target.value)}
                    placeholder="搜索模型"
                    className="h-9 w-full rounded-lg border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)] text-[13px] text-[var(--kimix-panel-text)] outline-none transition-colors focus:border-[var(--border-strong)]"
                    style={{ paddingLeft: 34, paddingRight: 12 }}
                    autoFocus
                  />
                </label>
              )}

              <div className="overflow-y-auto" style={{ maxHeight: 340, marginTop: 12, paddingRight: 2 }}>
                {modelCatalogLoading ? (
                  <div className="flex h-20 items-center justify-center text-[13px] text-[var(--kimix-panel-text-muted)]" style={{ gap: 8 }}>
                    <Loader2 size={15} className="animate-spin" />
                    正在读取模型
                  </div>
                ) : modelGroups.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-[var(--kimix-panel-border-soft)] text-[13px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ padding: "13px 14px" }}>
                    {modelCatalogError || (modelSearch ? "没有匹配的模型" : "尚未配置可用模型")}
                  </div>
                ) : (
                  <div className="flex flex-col" style={{ gap: modelGroups.length > 1 ? 14 : 4 }}>
                    {modelGroups.map((group) => (
                      <section key={group.provider}>
                        {modelGroups.length > 1 && (
                          <div className="truncate text-[11.5px] font-medium leading-5 text-[var(--kimix-panel-text-muted)]" style={{ paddingLeft: 12, paddingRight: 12, marginBottom: 4 }}>
                            {group.label}
                          </div>
                        )}
                        <div className="flex flex-col" style={{ gap: 3 }}>
                          {group.models.map((option) => {
                            const selected = option.id === sessionModel || (!sessionModel && option.id === defaultModel);
                            const switching = switchingModel === option.id;
                            return (
                              <button
                                key={option.id}
                                type="button"
                                role="menuitemradio"
                                aria-checked={selected}
                                disabled={isActiveRuntimeSessionRunning || Boolean(switchingModel) || activeSession?.isLoading}
                                onClick={() => void handleSelectModel(option.id)}
                                className="grid w-full items-center rounded-lg text-left text-[13px] text-[var(--kimix-panel-text-secondary)] transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                                style={{
                                  gridTemplateColumns: "minmax(0, 1fr) 22px",
                                  columnGap: 8,
                                  minHeight: 40,
                                  paddingLeft: 12,
                                  paddingRight: 10,
                                }}
                                title={option.id}
                              >
                                <span className="min-w-0 truncate font-medium">{option.label}</span>
                                <span className="flex h-[22px] w-[22px] items-center justify-center text-accent-primary">
                                  {switching ? <Loader2 size={14} className="animate-spin" /> : selected ? <Check size={15} /> : null}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-[var(--kimix-panel-border-soft)]" style={{ marginTop: 12, paddingTop: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    setModelMenuOpen(false);
                    void openModelSettings();
                  }}
                  className="kimix-icon-text-button kimix-muted-action w-full justify-start rounded-lg"
                  style={{ minHeight: 36, paddingLeft: 12, paddingRight: 12 }}
                >
                  <Settings2 size={15} />
                  <span>管理模型</span>
                </button>
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleKimiStatusClick()}
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
          onClick={() => void handleExport()}
          className="kimix-icon-text-button kimix-muted-action is-compact shrink-0"
          style={{ height: 36 }}
          title="导出 Markdown"
          aria-label="导出 Markdown"
        >
          <Download size={16} />
          <span>导出</span>
        </button>
      )}
    </div>
  );
}
