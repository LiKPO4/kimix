import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  ClipboardCopy,
  Copy,
  FileText,
  FolderSearch,
  GitBranch,
  GitCommitHorizontal,
  GripVertical,
  Loader2,
  MessageCircleQuestion,
  ChevronDown,
  ChevronUp,
  Play,
  Pause,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  Target,
  Terminal,
  Trash2,
  LogIn,
  Wrench,
  X,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { BtwRound, ComposerDockCard, RightSidebarCardId, Session } from "@/types/ui";
import type { KimiCodeBackgroundTaskInfo, LongTaskDetail, LongTaskSummary } from "@electron/types/ipc";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { formatReleaseDate } from "@/utils/format";
import type { ParsedLongTaskDetail } from "@/utils/longTaskParser";
import { isTerminalGoalStatus } from "@/utils/officialGoalState";
import { getRuntimeSessionId } from "@/utils/runtimeSession";

export type HiddenComposerCardEntry = {
  key: ComposerDockCard;
  title: string;
  desc: string;
  icon: LucideIcon;
};

export type SessionPlanState = {
  loading: boolean;
  path: string | null;
  content: string;
  updatedAt: number | null;
  error: string | null;
  message?: string;
};

export type LongTaskBackgroundTaskView = KimiCodeBackgroundTaskInfo & {
  runtimeSessionId: string;
  role: "executor" | "reviewer";
};

export type BtwPanelState = {
  input: string;
  loading: boolean;
  error: string | null;
  rounds: BtwRound[];
};

function countGitChanges(status: string) {
  return status.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
}

function gitSummaryText(status: string) {
  const count = countGitChanges(status);
  if (count === 0) return "工作区干净";
  return `${count} 个改动`;
}

interface LongTaskInspectorPanelProps {
  width: number;
  title: string;
  subtitle: string;
  longTaskMeta?: Session["longTask"];
  longTaskDetail: LongTaskDetail | null;
  longTaskDetailLoading: boolean;
  longTaskDetailError: string | null;
  parsedLongTaskDetail: ParsedLongTaskDetail | null;
  pendingReviewItems: string[];
  completedReviewItems: string[];
  targetStepDraft: string;
  targetStepBusy: boolean;
  longTaskControlBusy: boolean;
  runningSessionId: string | null;
  totalLongTaskSteps: number;
  sessionLongTasksLoading: boolean;
  shutdownAfterLongTaskId: string | null;
  sessionPlanState: SessionPlanState;
  sessionPlanPath: string | null;
  liveCurrentSession: Session | null;
  currentProject: { path?: string } | null;
  hiddenComposerCardEntries: HiddenComposerCardEntry[];
  composerCardSessionId: string;
  visibleSessionLongTasks: LongTaskSummary[];
  backgroundTasks: LongTaskBackgroundTaskView[];
  backgroundTasksLoading: boolean;
  backgroundTasksError: string | null;
  sessionDiffs: { id: string; filePath: string; additions: number; deletions: number; timestamp: number }[];
  btwState: BtwPanelState;
  btwDisabled: boolean;
  defaultPlanMode: boolean;
  officialGoal: Session["officialGoal"] | null | undefined;
  onClose: () => void;
  onPatchLongTaskMeta: (
    patch: Partial<NonNullable<Session["longTask"]>>,
    options?: { stopRunning?: boolean; message?: string },
  ) => Promise<void>;
  onApplyTargetStep: (startNow: boolean) => Promise<void>;
  onSetReviewItemChecked: (item: string, checked: boolean) => void;
  onCopyNextLongTaskPrompt: () => Promise<void>;
  onRefreshLongTaskDetail: () => void;
  onRefreshSessionPlan: () => void;
  onRefreshSessionLongTasks: () => void;
  onRefreshBackgroundTasks: () => void;
  onCopyBackgroundTaskOutput: (task: LongTaskBackgroundTaskView) => Promise<void>;
  onStopBackgroundTask: (task: LongTaskBackgroundTaskView) => Promise<void>;
  onSetTargetStepDraft: (value: string) => void;
  onSetShutdownAfterLongTaskId: (taskId: string | null) => void;
  onSetComposerCardHidden: (sessionId: string, key: ComposerDockCard, hidden: boolean) => void;
  onSetBtwInput: (value: string) => void;
  onAskBtw: () => Promise<void>;
  onClearBtw: () => void;
  onRefreshOfficialGoal: () => Promise<void>;
  onCreateOfficialGoal: (objective: string, replace?: boolean) => Promise<void>;
  onPauseOfficialGoal: () => Promise<void>;
  onResumeOfficialGoal: () => Promise<void>;
  onCancelOfficialGoal: () => Promise<void>;
  showToast: (message: string) => void;
  copyToClipboard: (text: string, successMessage?: string) => Promise<void>;
}

export function LongTaskInspectorPanel({
  width,
  title,
  subtitle,
  longTaskMeta,
  longTaskDetailLoading,
  longTaskDetailError,
  parsedLongTaskDetail,
  pendingReviewItems,
  completedReviewItems,
  targetStepDraft,
  targetStepBusy,
  longTaskControlBusy,
  runningSessionId,
  totalLongTaskSteps,
  sessionLongTasksLoading,
  shutdownAfterLongTaskId,
  sessionPlanState,
  sessionPlanPath,
  liveCurrentSession,
  currentProject,
  hiddenComposerCardEntries,
  composerCardSessionId,
  visibleSessionLongTasks,
  backgroundTasks,
  backgroundTasksLoading,
  backgroundTasksError,
  sessionDiffs,
  btwState,
  btwDisabled,
  defaultPlanMode,
  officialGoal,
  onClose,
  onPatchLongTaskMeta,
  onApplyTargetStep,
  onSetReviewItemChecked,
  onCopyNextLongTaskPrompt,
  onRefreshSessionPlan,
  onRefreshSessionLongTasks,
  onRefreshBackgroundTasks,
  onCopyBackgroundTaskOutput,
  onStopBackgroundTask,
  onSetTargetStepDraft,
  onSetShutdownAfterLongTaskId,
  onSetComposerCardHidden,
  onSetBtwInput,
  onAskBtw,
  onClearBtw,
  onRefreshOfficialGoal,
  onCreateOfficialGoal,
  onPauseOfficialGoal,
  onResumeOfficialGoal,
  onCancelOfficialGoal,
  showToast,
  copyToClipboard,
}: LongTaskInspectorPanelProps) {
  const rightSidebarCardOrder = useAppStore((state) => state.rightSidebarCardOrder);
  const setRightSidebarCardOrder = useAppStore((state) => state.setRightSidebarCardOrder);
  const setWorkspaceView = useAppStore((state) => state.setWorkspaceView);
  const setCurrentSession = useAppStore((state) => state.setCurrentSession);
  const defaultThinking = useAppStore((state) => state.defaultThinking);
  const defaultPlanModeSetting = useAppStore((state) => state.defaultPlanMode);
  const permissionMode = useAppStore((state) => state.permissionMode);
  const additionalWorkDirs = useAppStore((state) => state.additionalWorkDirs);
  const updateSession = useSessionStore((state) => state.updateSession);
  const [collapsedBtwRoundIds, setCollapsedBtwRoundIds] = useState<Set<string>>(() => new Set());
  const [goalDraft, setGoalDraft] = useState("");
  const [goalBusy, setGoalBusy] = useState<"refresh" | "create" | "replace" | "pause" | "resume" | "cancel" | null>(null);
  const [dragRightCardId, setDragRightCardId] = useState<RightSidebarCardId | null>(null);
  const [rightCardDrop, setRightCardDrop] = useState<{ id: RightSidebarCardId; position: "above" | "below" } | null>(null);
  const [kimiHealthOpen, setKimiHealthOpen] = useState(false);
  const [kimiHealthLoading, setKimiHealthLoading] = useState(false);
  const [kimiHealth, setKimiHealth] = useState<{
    cli: "ok" | "warning" | "error";
    auth: "ok" | "warning" | "error";
    model: "ok" | "warning" | "error";
    git: "ok" | "warning" | "error";
    session: "ok" | "warning" | "error";
    summary: string;
    details: string[];
  } | null>(null);
  const [gitBranch, setGitBranch] = useState<string | undefined>(undefined);
  const [gitStatus, setGitStatus] = useState("");
  const [gitError, setGitError] = useState<string | null>(null);
  const [gitBusy, setGitBusy] = useState<"refresh" | "commit" | "pull" | null>(null);
  const [gitCommitMessage, setGitCommitMessage] = useState("");
  const rightCardRefs = useRef(new Map<RightSidebarCardId, HTMLElement>());
  const openFile = (filePath: string) => {
    if (liveCurrentSession) void window.api.openFile({ projectPath: liveCurrentSession.projectPath, filePath });
  };
  const projectPathForKimi = liveCurrentSession?.projectPath ?? currentProject?.path ?? "";
  const loadKimiHealth = async () => {
    setKimiHealthLoading(true);
    try {
      const [cliRes, authRes, modelRes, gitRes] = await Promise.all([
        window.api.checkKimiCli({ verify: false }).catch((error) => ({ success: false as const, error: error instanceof Error ? error.message : String(error) })),
        window.api.getKimiAuthStatus().catch((error) => ({ success: false as const, error: error instanceof Error ? error.message : String(error) })),
        window.api.getKimiModelConfig().catch((error) => ({ success: false as const, error: error instanceof Error ? error.message : String(error) })),
        projectPathForKimi
          ? window.api.getGitInfo(projectPathForKimi).catch((error) => ({ success: false as const, error: error instanceof Error ? error.message : String(error) }))
          : Promise.resolve({ success: false as const, error: "未选择项目" }),
      ]);
      const runtimeId = liveCurrentSession ? getRuntimeSessionId(liveCurrentSession) : undefined;
      const cliOk = cliRes.success && cliRes.data.available;
      const authOk = authRes.success && authRes.data.loggedIn;
      const modelOk = modelRes.success && (modelRes.data.defaultModel || modelRes.data.models.length > 0);
      const gitOk = gitRes.success && Boolean(gitRes.data.branch || gitRes.data.gitRoot);
      const sessionOk = Boolean(liveCurrentSession?.engine === "kimi-code" && runtimeId);
      const details = [
        cliRes.success ? cliRes.data.message : `CLI 检测失败：${cliRes.error}`,
        authRes.success ? authRes.data.message : `登录状态失败：${authRes.error}`,
        modelRes.success ? `模型：${modelRes.data.defaultModel ?? "未设置默认模型"}` : `模型配置失败：${modelRes.error}`,
        gitRes.success ? (gitOk ? `Git：${gitRes.data.branch ?? "已检测仓库"}` : "Git：当前项目不是 Git 仓库") : `Git：${gitRes.error}`,
        liveCurrentSession ? `会话：${runtimeId ? "已绑定 Kimi Code" : "缺少 runtime id"}` : "会话：未选择会话",
      ];
      const issueCount = [cliOk, authOk, modelOk, projectPathForKimi ? gitOk : true, liveCurrentSession ? sessionOk : true].filter((ok) => !ok).length;
      setKimiHealth({
        cli: cliOk ? "ok" : "error",
        auth: authOk ? "ok" : "warning",
        model: modelOk ? "ok" : "warning",
        git: projectPathForKimi ? (gitOk ? "ok" : "warning") : "warning",
        session: liveCurrentSession ? (sessionOk ? "ok" : "warning") : "warning",
        summary: issueCount === 0 ? "状态正常" : `${issueCount} 项需关注`,
        details,
      });
    } finally {
      setKimiHealthLoading(false);
    }
  };
  const reconnectCurrentKimiSession = async () => {
    if (!liveCurrentSession) {
      showToast("当前没有可重连的会话");
      return;
    }
    if (!projectPathForKimi) {
      showToast("当前会话缺少项目目录");
      return;
    }
    setKimiHealthLoading(true);
    const res = await window.api.startSession({
      workDir: projectPathForKimi,
      sessionId: liveCurrentSession.officialSessionId ?? liveCurrentSession.runtimeSessionId ?? liveCurrentSession.id,
      thinking: defaultThinking,
      yoloMode: permissionMode === "yolo",
      autoMode: permissionMode === "auto",
      planMode: defaultPlanModeSetting,
      additionalWorkDirs,
    });
    setKimiHealthLoading(false);
    if (!res.success) {
      showToast(`重连失败：${res.error}`);
      await loadKimiHealth();
      return;
    }
    const nextSession = {
      ...liveCurrentSession,
      engine: "kimi-code" as const,
      runtimeSessionId: res.data.sessionId,
      model: res.data.model ?? liveCurrentSession.model ?? null,
      isLoading: false,
      updatedAt: Date.now(),
    };
    updateSession(liveCurrentSession.id, () => nextSession);
    setCurrentSession(nextSession);
    showToast("已重连当前 Kimi Code 会话");
    await loadKimiHealth();
  };
  const openKimiAuthSettings = () => {
    setWorkspaceView("settings");
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("kimix:focus-auth-settings")), 80);
  };
  const openKimiModelSettings = () => {
    setWorkspaceView("settings");
    window.setTimeout(() => window.dispatchEvent(new CustomEvent("kimix:focus-model-settings")), 80);
  };
  useEffect(() => {
    void loadKimiHealth();
  }, [projectPathForKimi, liveCurrentSession?.id, liveCurrentSession?.runtimeSessionId, runningSessionId]);
  const projectPathForGit = liveCurrentSession?.projectPath ?? currentProject?.path ?? "";
  const refreshGitInfo = async (mode: "silent" | "manual" = "manual") => {
    if (!projectPathForGit) {
      setGitBranch(undefined);
      setGitStatus("");
      setGitError(null);
      return;
    }
    if (mode === "manual") setGitBusy("refresh");
    try {
      const res = await window.api.getGitInfo(projectPathForGit);
      if (!res.success) {
        setGitError(res.error);
        return;
      }
      setGitBranch(res.data.branch);
      setGitStatus(res.data.status);
      setGitError(null);
    } finally {
      if (mode === "manual") setGitBusy(null);
    }
  };
  useEffect(() => {
    void refreshGitInfo("silent");
  }, [projectPathForGit]);
  const commitGit = async () => {
    if (!projectPathForGit || gitBusy) return;
    const message = gitCommitMessage.trim();
    if (!message) {
      showToast("请输入提交说明");
      return;
    }
    setGitBusy("commit");
    try {
      const res = await window.api.commitGitChanges({ projectPath: projectPathForGit, message });
      if (!res.success) {
        setGitError(res.error);
        showToast(`提交失败：${res.error}`);
        return;
      }
      setGitBranch(res.data.branch);
      setGitStatus(res.data.status);
      setGitError(null);
      setGitCommitMessage("");
      showToast("Git 提交完成");
    } finally {
      setGitBusy(null);
    }
  };
  const pullGit = async () => {
    if (!projectPathForGit || gitBusy) return;
    setGitBusy("pull");
    try {
      const res = await window.api.pullGitChanges({ projectPath: projectPathForGit });
      if (!res.success) {
        setGitError(res.error);
        showToast(`拉取失败：${res.error}`);
        return;
      }
      setGitBranch(res.data.branch);
      setGitStatus(res.data.status);
      setGitError(null);
      showToast("Git 拉取完成");
    } finally {
      setGitBusy(null);
    }
  };
  const rightCardOrderValue = (id: RightSidebarCardId, fallback: number) => {
    const index = rightSidebarCardOrder.indexOf(id);
    return index >= 0 ? index : fallback;
  };
  const applyRightCardDrop = (source: RightSidebarCardId | null, indicator: { id: RightSidebarCardId; position: "above" | "below" } | null) => {
    if (!source || !indicator || source === indicator.id) return;
    const ordered = [...rightSidebarCardOrder];
    const fromIndex = ordered.indexOf(source);
    if (fromIndex < 0) return;
    const [moved] = ordered.splice(fromIndex, 1);
    const targetIndex = ordered.indexOf(indicator.id);
    if (targetIndex < 0) return;
    ordered.splice(indicator.position === "below" ? targetIndex + 1 : targetIndex, 0, moved);
    setRightSidebarCardOrder(ordered);
    showToast("已保存右侧卡片顺序");
  };
  const getRightCardDropAtPoint = (source: RightSidebarCardId, clientY: number) => {
    const visibleCards = Array.from(rightCardRefs.current.entries())
      .filter(([id, element]) => id !== source && element.offsetParent !== null)
      .map(([id, element]) => ({ id, rect: element.getBoundingClientRect() }))
      .sort((a, b) => a.rect.top - b.rect.top);
    if (visibleCards.length === 0) return null;
    const first = visibleCards[0];
    const last = visibleCards[visibleCards.length - 1];
    if (clientY <= first.rect.top) return { id: first.id, position: "above" as const };
    if (clientY >= last.rect.bottom) return { id: last.id, position: "below" as const };
    for (const card of visibleCards) {
      if (clientY >= card.rect.top && clientY <= card.rect.bottom) {
        return {
          id: card.id,
          position: clientY < card.rect.top + card.rect.height / 2 ? "above" as const : "below" as const,
        };
      }
      if (clientY < card.rect.top) return { id: card.id, position: "above" as const };
    }
    return { id: last.id, position: "below" as const };
  };
  const rightCardProps = (id: RightSidebarCardId, fallbackOrder: number) => {
    const dropActive = rightCardDrop?.id === id ? rightCardDrop.position : null;
    return {
      ref: (element: HTMLElement | null) => {
        if (element) rightCardRefs.current.set(id, element);
        else rightCardRefs.current.delete(id);
      },
      "data-right-sidebar-card-id": id,
      "data-right-sidebar-drop-position": dropActive ?? undefined,
      style: {
        order: rightCardOrderValue(id, fallbackOrder),
        position: "relative" as const,
        opacity: dragRightCardId === id ? 0.55 : 1,
      },
    };
  };
  const rightCardDragHandle = (id: RightSidebarCardId, label: string) => (
    <button
      type="button"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        setDragRightCardId(id);
        let latestDrop: { id: RightSidebarCardId; position: "above" | "below" } | null = null;
        const previousUserSelect = document.body.style.userSelect;
        const previousCursor = document.body.style.cursor;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
        const updateDrop = (clientY: number) => {
          const nextDrop = getRightCardDropAtPoint(id, clientY);
          latestDrop = nextDrop;
          setRightCardDrop((current) => (
            current?.id === nextDrop?.id && current?.position === nextDrop?.position ? current : nextDrop
          ));
        };
        const handlePointerMove = (moveEvent: PointerEvent) => {
          moveEvent.preventDefault();
          updateDrop(moveEvent.clientY);
        };
        const finishDrag = (upEvent: PointerEvent) => {
          upEvent.preventDefault();
          window.removeEventListener("pointermove", handlePointerMove);
          window.removeEventListener("pointerup", finishDrag);
          window.removeEventListener("pointercancel", cancelDrag);
          document.body.style.userSelect = previousUserSelect;
          document.body.style.cursor = previousCursor;
          setDragRightCardId(null);
          setRightCardDrop(null);
          applyRightCardDrop(id, latestDrop);
        };
        const cancelDrag = () => {
          window.removeEventListener("pointermove", handlePointerMove);
          window.removeEventListener("pointerup", finishDrag);
          window.removeEventListener("pointercancel", cancelDrag);
          document.body.style.userSelect = previousUserSelect;
          document.body.style.cursor = previousCursor;
          setDragRightCardId(null);
          setRightCardDrop(null);
        };
        updateDrop(event.clientY);
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", finishDrag);
        window.addEventListener("pointercancel", cancelDrag);
      }}
      className="flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary active:cursor-grabbing"
      title="长按拖动调整位置"
      aria-label={`拖动${label}卡片`}
    >
      <GripVertical size={14} />
    </button>
  );
  const rightCardSectionProps = (id: RightSidebarCardId, fallbackOrder: number, style: React.CSSProperties) => {
    const props = rightCardProps(id, fallbackOrder);
    return {
      ...props,
      style: { ...props.style, ...style },
    };
  };
  const visibleBtwRounds = [...btwState.rounds].reverse().slice(0, 8);
  const toggleBtwRoundCollapsed = (roundId: string) => {
    setCollapsedBtwRoundIds((current) => {
      const next = new Set(current);
      if (next.has(roundId)) next.delete(roundId);
      else next.add(roundId);
      return next;
    });
  };
  const handleBtwKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (btwDisabled || btwState.loading || !btwState.input.trim()) return;
    void onAskBtw();
  };
  const rawCurrentGoal = officialGoal?.goal ?? null;
  const currentGoal = rawCurrentGoal && !isTerminalGoalStatus(rawCurrentGoal.status) ? rawCurrentGoal : null;
  const goalStatusLabel = currentGoal?.status === "active"
    ? "进行中"
    : currentGoal?.status === "paused"
      ? "已暂停"
      : currentGoal?.status === "blocked"
        ? "受阻"
        : currentGoal?.status === "complete"
          ? "已完成"
          : currentGoal?.status ?? "未启动";
  const runGoalAction = async (busy: typeof goalBusy, action: () => Promise<void>) => {
    if (goalBusy) return;
    setGoalBusy(busy);
    try {
      await action();
    } finally {
      setGoalBusy(null);
    }
  };

  return (
    <aside style={{ width, backgroundColor: "var(--surface-base)" }} className="kimix-longtask-inspector flex h-full shrink-0 flex-col overflow-hidden rounded-[20px] border border-border-subtle shadow-[0_1px_2px_rgba(25,23,20,0.04)]">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle" style={{ paddingLeft: 18, paddingRight: 14 }}>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold leading-5 text-text-primary">{title}</div>
          <div className="mt-0.5 truncate text-[12.5px] leading-5 text-text-muted">{subtitle}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
          aria-label="关闭会话侧栏"
          title="关闭"
        >
          <X size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ paddingLeft: 18, paddingRight: 18, paddingTop: 14, paddingBottom: 20 }}>
        {longTaskMeta ? (
          <div className="flex flex-col" style={{ gap: 16 }}>
            <section className="rounded-xl border border-border-subtle bg-surface-elevated" {...rightCardSectionProps("longTaskStatus", 0, { padding: "18px 16px 20px" })}>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <div className="text-[13px] font-medium leading-5 text-text-muted">当前状态</div>
                {rightCardDragHandle("longTaskStatus", "当前状态")}
              </div>
              <div className="mt-2 text-[14px] leading-6 text-text-primary">
                长程任务 · {longTaskMeta.stage === "reviewing" ? "paused" : longTaskMeta.stage}
              </div>
              <div className="mt-1 text-[13px] leading-5 text-text-muted">
                步骤 {longTaskMeta.currentStep}{longTaskMeta.targetStep ? ` / ${longTaskMeta.targetStep}` : " / 未设置"}
              </div>
              {longTaskMeta.recovery && longTaskMeta.recovery.status !== "none" && (
                <div
                  className="rounded-lg border border-accent-warning/30 bg-accent-warning-light text-[13px] leading-5 text-accent-warning"
                  style={{ marginTop: 14, padding: "13px 14px" }}
                >
                  <div className="font-medium">可恢复状态</div>
                  <div style={{ marginTop: 6 }}>{longTaskMeta.recovery.reason}</div>
                  <div className="text-[12.5px] leading-5" style={{ marginTop: 8 }}>
                    {longTaskMeta.recovery.suggestedAction}
                  </div>
                  <div className="flex items-center" style={{ gap: 10, marginTop: 12 }}>
                    <button
                      type="button"
                      disabled={longTaskControlBusy || Boolean(runningSessionId) || longTaskMeta.stage === "completed"}
                      onClick={() => void onApplyTargetStep(true)}
                      className="kimix-icon-text-button is-compact bg-surface-elevated text-accent-warning hover:bg-white/60 disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <Play size={14} />
                      <span>继续</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void onCopyNextLongTaskPrompt()}
                      className="kimix-icon-text-button is-compact bg-surface-elevated text-accent-warning hover:bg-white/60"
                    >
                      <ClipboardCopy size={13} />
                      <span>复制 prompt</span>
                    </button>
                  </div>
                </div>
              )}
              <div className="flex flex-col" style={{ gap: 18, marginTop: 22 }}>
                <div className="rounded-lg bg-accent-primary-light/40" style={{ padding: "20px 16px 18px" }}>
                  <div className="text-[13px] font-medium leading-5 text-accent-primary">执行控制</div>
                  <div className="flex items-center" style={{ gap: 14, marginTop: 16 }}>
                    <button
                      type="button"
                      disabled={longTaskControlBusy || longTaskMeta.stage === "paused" || longTaskMeta.stage === "completed"}
                      onClick={() => void onPatchLongTaskMeta({ stage: "paused" }, { stopRunning: true, message: "已暂停长程任务" })}
                      className="kimix-icon-text-button is-compact flex-1 justify-center bg-surface-elevated text-text-muted hover:bg-accent-primary-light disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <Pause size={14} />
                      暂停
                    </button>
                    <button
                      type="button"
                      disabled={longTaskControlBusy || Boolean(runningSessionId) || longTaskMeta.stage === "completed"}
                      onClick={() => void onApplyTargetStep(true)}
                      className="kimix-icon-text-button is-compact flex-1 justify-center bg-surface-elevated text-accent-primary hover:bg-accent-primary-light disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <Play size={14} />
                      继续
                    </button>
                  </div>
                </div>
                <div className="rounded-lg bg-accent-primary-light/40" style={{ padding: "20px 16px 18px" }}>
                  <div className="flex flex-col" style={{ gap: 14 }}>
                    <label className="text-[13px] font-medium leading-5 text-accent-primary" htmlFor="long-task-target-step">
                      执行到
                    </label>
                    <input
                      id="long-task-target-step"
                      type="number"
                      min={1}
                      max={totalLongTaskSteps || undefined}
                      value={targetStepDraft}
                      onChange={(event) => onSetTargetStepDraft(event.target.value)}
                      className="h-9 w-full min-w-0 rounded-lg border border-border-subtle bg-surface-elevated text-[13px] text-text-primary outline-none focus:border-accent-primary-soft"
                      style={{ paddingLeft: 10, paddingRight: 10 }}
                      placeholder={totalLongTaskSteps ? `1-${totalLongTaskSteps}` : "Step"}
                    />
                  </div>
                  <label className="flex items-center justify-between rounded-lg bg-surface-elevated text-[13px] leading-5 text-text-primary" style={{ gap: 14, marginTop: 18, padding: "13px 14px" }}>
                    <span className="min-w-0">执行完成后关机</span>
                    <input
                      type="checkbox"
                      checked={shutdownAfterLongTaskId === longTaskMeta.taskId}
                      onChange={(event) => onSetShutdownAfterLongTaskId(event.target.checked ? longTaskMeta.taskId : null)}
                      className="h-4 w-4 shrink-0 accent-accent-primary"
                    />
                  </label>
                  <div className="flex items-center" style={{ gap: 14, marginTop: 20 }}>
                    <button
                      type="button"
                      disabled={targetStepBusy}
                      onClick={() => void onApplyTargetStep(false)}
                      className="kimix-icon-text-button is-compact flex-1 justify-center bg-surface-elevated text-accent-primary hover:bg-accent-primary-light disabled:cursor-wait disabled:opacity-60"
                    >
                      保存目标
                    </button>
                    <button
                      type="button"
                      disabled={targetStepBusy || Boolean(runningSessionId)}
                      onClick={() => void onApplyTargetStep(true)}
                      className="kimix-icon-text-button is-compact flex-1 justify-center bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-wait disabled:opacity-60"
                    >
                      {runningSessionId ? "运行中" : "开始执行"}
                    </button>
                  </div>
                </div>
              </div>
            </section>
            <section className="rounded-xl border border-border-subtle bg-surface-elevated" {...rightCardSectionProps("background", 2, { padding: "16px 16px 18px" })}>
              <div className="flex items-start justify-between" style={{ gap: 12 }}>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium leading-5 text-text-muted">SDK 后台任务</div>
                  <div className="mt-1 truncate text-[13px] leading-5 text-text-primary">
                    {backgroundTasks.length > 0 ? `${backgroundTasks.length} 个任务` : "当前没有后台任务"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                  <button
                    type="button"
                    disabled={backgroundTasksLoading}
                    onClick={() => onRefreshBackgroundTasks()}
                    className="kimix-icon-text-button is-compact shrink-0 bg-accent-primary-light text-accent-primary hover:bg-accent-primary-light/70 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <RefreshCw size={13} className={backgroundTasksLoading ? "animate-spin" : ""} />
                    刷新
                  </button>
                  {rightCardDragHandle("background", "SDK 后台任务")}
                </div>
              </div>
              {backgroundTasksError ? (
                <div className="rounded-lg border border-accent-warning/30 bg-accent-warning-light text-[13px] leading-6 text-accent-warning" style={{ marginTop: 14, padding: "13px 12px" }}>
                  读取失败：{backgroundTasksError}
                </div>
              ) : backgroundTasksLoading && backgroundTasks.length === 0 ? (
                <div className="rounded-lg bg-accent-primary-light/40 text-[13px] leading-6 text-text-muted" style={{ marginTop: 14, padding: "13px 12px" }}>
                  正在读取 SDK 后台任务...
                </div>
              ) : backgroundTasks.length > 0 ? (
                <div className="flex flex-col" style={{ gap: 10, marginTop: 14 }}>
                  {backgroundTasks.slice(0, 8).map((task) => {
                    const tone = backgroundTaskTone(task);
                    const isDanger = tone === "danger";
                    const isSuccess = tone === "success";
                    const isWarning = tone === "warning";
                    const roleLabel = task.role === "reviewer" ? "审查" : "执行";
                    const statusLabel = backgroundTaskStatusLabels[task.status] ?? task.status;
                    return (
                      <div
                        key={`${task.runtimeSessionId}-${task.taskId}`}
                        className={`rounded-lg border ${isDanger ? "border-accent-danger/30 bg-accent-danger-light" : isSuccess ? "border-accent-success/30 bg-accent-success-light" : isWarning ? "border-accent-warning/30 bg-accent-warning-light" : "border-border-subtle bg-surface-elevated"}`}
                        style={{ padding: "12px 12px" }}
                      >
                        <div className="grid items-start" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center" style={{ gap: 8 }}>
                              {isDanger ? (
                                <AlertTriangle size={14} className="shrink-0 text-accent-danger" />
                              ) : (
                                <Terminal size={14} className={`shrink-0 ${isSuccess ? "text-accent-success" : isWarning ? "text-accent-warning" : "text-text-muted"}`} />
                              )}
                              <span className="truncate text-[13.5px] font-medium leading-5 text-text-primary">
                                {task.description || task.command || task.taskId}
                              </span>
                            </div>
                            <div className="text-[12.5px] leading-5 text-text-muted" style={{ marginTop: 5 }}>
                              {roleLabel} agent · {task.taskId}
                            </div>
                          </div>
                          <span className={`shrink-0 rounded-lg text-[12px] leading-5 ${isDanger ? "bg-white/60 text-accent-danger" : isSuccess ? "bg-white/60 text-accent-success" : isWarning ? "bg-white/60 text-accent-warning" : "bg-accent-primary-light text-accent-primary"}`} style={{ minHeight: 24, paddingLeft: 9, paddingRight: 9 }}>
                            {statusLabel}
                          </span>
                        </div>
                        <div className={`text-[12.5px] leading-5 ${isDanger ? "text-accent-danger" : isSuccess ? "text-accent-success" : isWarning ? "text-accent-warning" : "text-text-muted"}`} style={{ marginTop: 9 }}>
                          {backgroundTaskSummary(task)}
                        </div>
                        <div className="flex flex-wrap items-center" style={{ gap: 10, marginTop: 12 }}>
                          <button
                            type="button"
                            onClick={() => void onCopyBackgroundTaskOutput(task)}
                            className="kimix-icon-text-button is-compact bg-surface-elevated text-accent-primary hover:bg-accent-primary-light"
                          >
                            <ClipboardCopy size={13} />
                            输出
                          </button>
                          {!isBackgroundTaskTerminal(task.status) && (
                            <button
                              type="button"
                              onClick={() => void onStopBackgroundTask(task)}
                              className="kimix-icon-text-button is-compact bg-surface-elevated text-accent-danger hover:bg-accent-danger-light"
                            >
                              <Square size={13} />
                              停止
                            </button>
                          )}
                          {task.exitCode !== null && (
                            <span className="rounded-lg bg-surface-elevated text-[12px] leading-5 text-text-muted" style={{ minHeight: 24, paddingLeft: 9, paddingRight: 9 }}>
                              exit {task.exitCode}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg bg-surface-elevated text-[13px] leading-6 text-text-muted" style={{ marginTop: 14, padding: "13px 12px" }}>
                  后台 Shell / Agent 任务出现后会显示真实终态、失败原因和输出入口。
                </div>
              )}
            </section>
            <section className="rounded-xl border border-border-subtle bg-surface-elevated" {...rightCardSectionProps("bigPlan", 3, { padding: "16px 16px 18px" })}>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium leading-5 text-text-muted">BIGPLAN</div>
                  <div className="mt-1 truncate text-[13px] leading-5 text-text-primary">{longTaskMeta.bigPlanPath}</div>
                </div>
                <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => openFile(longTaskMeta.bigPlanPath)}
                    className="kimix-icon-text-button is-compact shrink-0 bg-accent-primary-light text-accent-primary hover:bg-accent-primary-light/70"
                  >
                    打开
                  </button>
                  {rightCardDragHandle("bigPlan", "BIGPLAN")}
                </div>
              </div>
              {longTaskDetailLoading ? (
                <div className="mt-4 rounded-lg bg-accent-primary-light/40 text-[13px] leading-6 text-text-muted" style={{ padding: "13px 12px" }}>
                  正在读取 BIGPLAN...
                </div>
              ) : longTaskDetailError ? (
                <div className="mt-4 rounded-lg bg-accent-danger-light text-[13px] leading-6 text-accent-danger" style={{ padding: "13px 12px" }}>
                  读取失败：{longTaskDetailError}
                </div>
              ) : parsedLongTaskDetail ? (
                <div className="mt-4 flex flex-col" style={{ gap: 12 }}>
                  <div className="rounded-lg bg-accent-primary-light/40 text-[13px] leading-6 text-text-primary" style={{ padding: "13px 12px" }}>
                    <div className="font-medium text-accent-primary">目标</div>
                    <div className="mt-1 line-clamp-3 text-text-muted">{parsedLongTaskDetail.goal}</div>
                    <div className="mt-2 font-medium text-accent-primary">初始需求</div>
                    <div className="mt-1 line-clamp-3 text-text-muted">{parsedLongTaskDetail.initialRequest}</div>
                  </div>
                  <div className="flex flex-col" style={{ gap: 10 }}>
                    {parsedLongTaskDetail.steps.map((step) => {
                      const isCurrent = step.index === longTaskMeta.currentStep;
                      return (
                        <div
                          key={step.index}
                          className={`rounded-lg border ${isCurrent ? "border-accent-primary-soft bg-accent-primary-light/40" : "border-border-subtle bg-surface-elevated"}`}
                          style={{ padding: "12px 12px" }}
                        >
                          <div className="flex items-center justify-between" style={{ gap: 10 }}>
                            <div className="min-w-0 truncate text-[13.5px] font-medium leading-5 text-text-primary">
                              Step {step.index}
                            </div>
                            <span className="shrink-0 rounded-full bg-accent-primary-light text-[12px] leading-5 text-accent-primary" style={{ paddingLeft: 9, paddingRight: 9 }}>
                              {step.status}
                            </span>
                          </div>
                          <div className="mt-2 text-[13px] leading-5 text-text-muted">
                            {step.goal || step.title || "暂未填写目标"}
                          </div>
                          {(step.scope || step.acceptance) && (
                            <div className="mt-2 text-[12.5px] leading-5 text-text-muted">
                              {step.scope && <div className="line-clamp-2">范围：{step.scope}</div>}
                              {step.acceptance && <div className="line-clamp-2">验收：{step.acceptance}</div>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {parsedLongTaskDetail.steps.length === 0 && (
                      <div className="rounded-lg bg-accent-primary-light/40 text-[13px] leading-6 text-text-muted" style={{ padding: "13px 12px" }}>
                        BIGPLAN 还没有解析到 Step，等待规划完成。
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </section>
            <section className="rounded-xl border border-border-subtle bg-surface-elevated" {...rightCardSectionProps("rounds", 4, { padding: "16px 16px 18px" })}>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium leading-5 text-text-muted">轮次记录</div>
                  <div className="mt-1 truncate text-[13px] leading-5 text-text-primary">rounds/step-XXX.md</div>
                </div>
                <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                  <span className="rounded-full bg-accent-primary-light text-[12px] leading-5 text-accent-primary" style={{ paddingLeft: 9, paddingRight: 9 }}>
                    {parsedLongTaskDetail?.rounds.length ?? 0}
                  </span>
                  {rightCardDragHandle("rounds", "轮次记录")}
                </div>
              </div>
              {longTaskDetailLoading ? (
                <div className="mt-4 rounded-lg bg-surface-elevated text-[13px] leading-6 text-text-muted" style={{ padding: "13px 12px" }}>
                  正在读取轮次记录...
                </div>
              ) : parsedLongTaskDetail && parsedLongTaskDetail.rounds.length > 0 ? (
                <div className="mt-4 flex flex-col" style={{ gap: 10 }}>
                  {parsedLongTaskDetail.rounds.map((round) => (
                    <div key={round.filePath} className="rounded-lg border border border-border-subtle bg-surface-elevated" style={{ padding: "12px 12px" }}>
                      <div className="flex items-center justify-between" style={{ gap: 10 }}>
                        <div className="flex min-w-0 items-center" style={{ gap: 7 }}>
                          <FileText size={14} className="shrink-0 text-text-muted" />
                          <span className="truncate text-[13.5px] font-medium leading-5 text-text-primary">Step {round.step}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => openFile(round.filePath)}
                          className="kimix-icon-text-button is-compact shrink-0 bg-surface-elevated text-accent-primary hover:bg-accent-primary-light"
                        >
                          打开
                        </button>
                      </div>
                      <div className="mt-3 flex flex-col" style={{ gap: 10 }}>
                        {round.entries.map((entry, index) => (
                          <div key={`${round.filePath}-${index}`} className="rounded-lg bg-surface-elevated text-[13px] leading-5 text-text-muted" style={{ padding: "11px 11px" }}>
                            <div className="flex items-center justify-between" style={{ gap: 8 }}>
                              <div className="min-w-0 truncate font-medium text-accent-primary">{entry.title}</div>
                              {(entry.phase || entry.role) && (
                                <span className="shrink-0 rounded-full bg-accent-primary-light/40 text-[12px] leading-5 text-text-muted" style={{ paddingLeft: 8, paddingRight: 8 }}>
                                  {[entry.phase, entry.role].filter(Boolean).join(" · ")}
                                </span>
                              )}
                            </div>
                            {entry.conclusion && (
                              <div className="mt-1 text-[12.5px] leading-5 text-text-muted">结论：{entry.conclusion}</div>
                            )}
                            <div className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-text-muted">
                              {entry.content || "暂无正文。"}
                            </div>
                          </div>
                        ))}
                        {round.entries.length === 0 && (
                          <div className="rounded-lg bg-surface-elevated text-[13px] leading-6 text-text-muted" style={{ padding: "11px 11px" }}>
                            这个 Step 记录暂时为空。
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-lg bg-surface-elevated text-[13px] leading-6 text-text-muted" style={{ padding: "13px 12px" }}>
                  暂无 Step 轮次记录。
                </div>
              )}
            </section>
            <section className="rounded-xl border border-border-subtle bg-surface-elevated" {...rightCardSectionProps("review", 5, { padding: "16px 16px 18px" })}>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium leading-5 text-text-muted">用户审查清单</div>
                  <div className="mt-1 truncate text-[13px] leading-5 text-text-primary">{longTaskMeta.reviewQueuePath}</div>
                </div>
                <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => openFile(longTaskMeta.reviewQueuePath)}
                    className="kimix-icon-text-button is-compact shrink-0 bg-accent-primary-light text-accent-primary hover:bg-accent-primary-light/70"
                  >
                    打开
                  </button>
                  {rightCardDragHandle("review", "用户审查清单")}
                </div>
              </div>
              {longTaskDetailLoading ? (
                <div className="mt-4 rounded-lg bg-accent-warning-light text-[13px] leading-6 text-accent-warning" style={{ padding: "13px 12px" }}>
                  正在读取用户审查清单...
                </div>
              ) : parsedLongTaskDetail && parsedLongTaskDetail.reviewItems.length > 0 ? (
                <div className="mt-4 flex flex-col" style={{ gap: 10 }}>
                  {pendingReviewItems.map((item, index) => (
                    <button
                      key={`${index}-${item}`}
                      type="button"
                      onClick={() => onSetReviewItemChecked(item, true)}
                      className="flex w-full items-start rounded-lg border border-accent-warning/30 bg-accent-warning-light text-left text-[13px] leading-5 text-accent-warning transition-colors hover:bg-accent-warning-light/70"
                      style={{ gap: 10, padding: "12px 12px" }}
                      title="点击标记为已确认"
                    >
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-accent-warning/50 text-transparent">
                        <CheckCircle2 size={12} />
                      </span>
                      <span className="min-w-0 flex-1">{item}</span>
                    </button>
                  ))}
                  {pendingReviewItems.length === 0 && (
                    <div className="rounded-lg bg-accent-warning-light text-[13px] leading-6 text-accent-warning" style={{ padding: "13px 12px" }}>
                      审查项都已确认。
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-4 rounded-lg bg-accent-warning-light text-[13px] leading-6 text-accent-warning" style={{ padding: "13px 12px" }}>
                  暂无需要用户审查的事项。
                </div>
              )}
            </section>
            {completedReviewItems.length > 0 && (
              <section className="rounded-xl border border-border-subtle bg-surface-elevated" {...rightCardSectionProps("confirmed", 6, { padding: "16px 16px 18px" })}>
                <div className="flex items-center justify-between" style={{ gap: 10 }}>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium leading-5 text-text-muted">已确认</div>
                    <div className="mt-1 text-[13px] leading-5 text-text-muted">点击条目可撤回到审查清单</div>
                  </div>
                  <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                    <span className="rounded-full bg-accent-primary-light text-[12px] leading-5 text-accent-primary" style={{ paddingLeft: 9, paddingRight: 9 }}>
                      {completedReviewItems.length}
                    </span>
                    {rightCardDragHandle("confirmed", "已确认")}
                  </div>
                </div>
                <div className="mt-4 flex flex-col" style={{ gap: 10 }}>
                  {completedReviewItems.map((item, index) => (
                    <button
                      key={`${index}-${item}`}
                      type="button"
                      onClick={() => onSetReviewItemChecked(item, false)}
                      className="flex w-full items-start rounded-lg border border-accent-success/30 bg-accent-success-light text-left text-[13px] leading-5 text-accent-success transition-colors hover:bg-accent-success-light/70"
                      style={{ gap: 10, padding: "12px 12px" }}
                      title="点击撤回到审查清单"
                    >
                      <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-accent-success" />
                      <span className="min-w-0 flex-1 line-through decoration-accent-success/50 decoration-1">{item}</span>
                      <RotateCcw size={13} className="mt-1 shrink-0 text-accent-success/70" />
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          <div className="flex flex-col" style={{ gap: 14 }}>
            {hiddenComposerCardEntries.length > 0 && (
              <section className="rounded-xl border border-border-subtle bg-surface-elevated" {...rightCardSectionProps("hidden", 0, { padding: "16px 16px 18px" })}>
                <div className="flex items-start justify-between" style={{ gap: 12 }}>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium leading-5 text-text-muted">已收起卡片</div>
                    <div className="mt-1 truncate text-[13px] leading-5 text-text-primary">可恢复到输入框上方</div>
                  </div>
                  <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                    <span className="rounded-full bg-accent-primary-light text-[12px] leading-5 text-accent-primary" style={{ paddingLeft: 9, paddingRight: 9 }}>
                      {hiddenComposerCardEntries.length}
                    </span>
                    {rightCardDragHandle("hidden", "已收起卡片")}
                  </div>
                </div>
                <div className="mt-4 flex flex-col" style={{ gap: 10 }}>
                  {hiddenComposerCardEntries.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => {
                        onSetComposerCardHidden(composerCardSessionId, entry.key, false);
                        showToast(`${entry.title}已恢复到输入框上方`);
                      }}
                      className="flex w-full items-center rounded-lg border border border-border-subtle bg-surface-elevated text-left transition-colors hover:bg-accent-primary-light/40"
                      style={{ gap: 10, padding: "12px 12px" }}
                    >
                      <entry.icon size={16} className="shrink-0 text-text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium leading-5 text-text-primary">{entry.title}</span>
                        <span className="block truncate text-[12.5px] leading-5 text-text-muted">{entry.desc}</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-surface-elevated text-[12px] leading-5 text-accent-primary" style={{ paddingLeft: 9, paddingRight: 9 }}>
                        显示
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {longTaskMeta && (
              <section className="rounded-xl border border-border-subtle bg-surface-elevated" {...rightCardSectionProps("longTask", 1, { padding: "16px 16px 18px" })}>
                <div className="flex items-start justify-between" style={{ gap: 12 }}>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium leading-5 text-text-muted">长程任务</div>
                    <div className="mt-1 truncate text-[13px] leading-5 text-text-primary">
                      {visibleSessionLongTasks.length > 0 ? `${visibleSessionLongTasks.length} 个任务` : "当前会话暂无其他任务"}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                    <button
                      type="button"
                      disabled={sessionLongTasksLoading || !(liveCurrentSession?.projectPath ?? currentProject?.path)}
                      onClick={() => onRefreshSessionLongTasks()}
                      className="kimix-icon-text-button is-compact shrink-0 bg-accent-primary-light text-accent-primary hover:bg-accent-primary-light/70 disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <RefreshCw size={13} className={sessionLongTasksLoading ? "animate-spin" : ""} />
                      刷新
                    </button>
                    {rightCardDragHandle("longTask", "长程任务")}
                  </div>
                </div>
                {visibleSessionLongTasks.length > 0 ? (
                  <div className="mt-4 flex flex-col" style={{ gap: 10 }}>
                    {visibleSessionLongTasks.slice(0, 3).map((task) => (
                      <div key={task.id} className="rounded-lg border border-border-subtle bg-surface-elevated" style={{ padding: "12px 12px" }}>
                        <div className="truncate text-[13.5px] font-medium leading-5 text-text-primary">{task.title}</div>
                        <div className="mt-1 text-[12.5px] leading-5 text-text-muted">
                          Step {task.currentStep}{task.targetStep ? ` / ${task.targetStep}` : ""} · {task.stage}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg bg-surface-elevated text-[13px] leading-6 text-text-muted" style={{ padding: "13px 12px" }}>
                    当前长程任务会话没有其他未归档任务。
                  </div>
                )}
              </section>
            )}
            <section className="rounded-xl border border-border-subtle bg-surface-elevated" {...rightCardSectionProps("kimi", 2, { padding: "16px 16px 18px" })}>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setKimiHealthOpen((value) => !value)}
                  className="flex min-w-0 items-center text-left"
                  style={{ gap: 8 }}
                  title="Kimi Code 健康状态"
                >
                  {kimiHealthLoading ? (
                    <Loader2 size={15} className="kimix-spin shrink-0 text-text-muted" />
                  ) : kimiHealth?.summary === "状态正常" ? (
                    <CheckCircle2 size={15} className="shrink-0 text-accent-success" />
                  ) : (
                    <AlertCircle size={15} className="shrink-0 text-accent-warning" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium leading-5 text-text-muted">Kimi Code</div>
                    <div className="truncate text-[12.5px] leading-5 text-text-muted">{kimiHealth?.summary ?? "正在检测"}</div>
                  </div>
                </button>
                <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => void loadKimiHealth()}
                    disabled={kimiHealthLoading}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-55"
                    title="刷新 Kimi Code 状态"
                    aria-label="刷新 Kimi Code 状态"
                  >
                    <RefreshCw size={13} className={kimiHealthLoading ? "kimix-spin" : ""} />
                  </button>
                  {rightCardDragHandle("kimi", "Kimi Code")}
                </div>
              </div>
              {kimiHealthOpen && (
                <div style={{ marginTop: 14 }}>
                  <div className="grid" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 6 }}>
                    {([
                      ["CLI", kimiHealth?.cli],
                      ["登录", kimiHealth?.auth],
                      ["模型", kimiHealth?.model],
                      ["Git", kimiHealth?.git],
                      ["会话", kimiHealth?.session],
                    ] as const).map(([label, status]) => (
                      <div
                        key={label}
                        className={`rounded-lg text-center text-[11.5px] leading-5 ${
                          status === "ok"
                            ? "bg-accent-success-light text-accent-success"
                            : status === "error"
                              ? "bg-accent-danger-light text-accent-danger"
                              : "bg-accent-warning-light text-accent-warning"
                        }`}
                        style={{ minHeight: 24, paddingLeft: 4, paddingRight: 4 }}
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-col" style={{ gap: 7, marginTop: 10 }}>
                    {(kimiHealth?.details ?? ["正在检测 Kimi Code 状态..."]).slice(0, 5).map((detail, index) => (
                      <div key={`${index}-${detail}`} className="truncate text-[12px] leading-5 text-text-muted" title={detail}>
                        {detail}
                      </div>
                    ))}
                  </div>
                  <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                    <button
                      type="button"
                      onClick={openKimiAuthSettings}
                      className="kimix-icon-text-button is-compact justify-center text-text-secondary hover:bg-surface-hover"
                    >
                      <LogIn size={13} />
                      登录
                    </button>
                    <button
                      type="button"
                      onClick={openKimiModelSettings}
                      className="kimix-icon-text-button is-compact justify-center text-text-secondary hover:bg-surface-hover"
                    >
                      <Wrench size={13} />
                      模型
                    </button>
                    <button
                      type="button"
                      onClick={() => projectPathForKimi && void window.api.openProjectPath({ path: projectPathForKimi })}
                      disabled={!projectPathForKimi}
                      className="kimix-icon-text-button is-compact justify-center text-text-secondary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <FolderSearch size={13} />
                      项目
                    </button>
                    <button
                      type="button"
                      onClick={() => void reconnectCurrentKimiSession()}
                      disabled={kimiHealthLoading || !liveCurrentSession}
                      className="kimix-icon-text-button is-compact justify-center bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <Activity size={13} />
                      重连
                    </button>
                  </div>
                </div>
              )}
            </section>
            <section className="rounded-xl border border-border-subtle bg-surface-elevated" {...rightCardSectionProps("git", 3, { padding: "16px 16px 18px" })}>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <div className="flex min-w-0 items-center" style={{ gap: 8 }}>
                  <GitBranch size={15} className="shrink-0 text-accent-primary" />
                  <div className="text-[13px] font-medium leading-5 text-text-muted">Git</div>
                </div>
                {rightCardDragHandle("git", "Git")}
              </div>
              <div className="flex flex-col" style={{ gap: 12, marginTop: 14 }}>
                <div className="rounded-lg bg-surface-base text-[13px] leading-5" style={{ padding: "12px 12px" }}>
                  <div className="flex items-center justify-between" style={{ gap: 10 }}>
                    <span className="min-w-0 truncate text-text-primary">{gitBranch ?? "未检测到分支"}</span>
                    <span className="shrink-0 rounded-full bg-accent-primary-light text-[12px] leading-5 text-accent-primary" style={{ paddingLeft: 8, paddingRight: 8 }}>
                      {gitSummaryText(gitStatus)}
                    </span>
                  </div>
                  {gitError && <div className="mt-2 line-clamp-2 text-[12.5px] leading-5 text-accent-danger">{gitError}</div>}
                </div>
                <input
                  value={gitCommitMessage}
                  onChange={(event) => setGitCommitMessage(event.target.value)}
                  disabled={!projectPathForGit || gitBusy !== null}
                  placeholder="提交说明"
                  className="h-9 w-full min-w-0 rounded-lg border border-border-subtle bg-surface-base text-[13px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent-primary-soft disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ paddingLeft: 12, paddingRight: 12 }}
                />
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <button
                    type="button"
                    disabled={!projectPathForGit || gitBusy !== null}
                    onClick={() => void pullGit()}
                    className="kimix-icon-text-button is-compact justify-center bg-surface-base text-text-muted hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {gitBusy === "pull" ? <Loader2 size={14} className="animate-spin" /> : <ArrowDownToLine size={14} />}
                    <span>拉取</span>
                  </button>
                  <button
                    type="button"
                    disabled={!projectPathForGit || gitBusy !== null || !gitCommitMessage.trim() || countGitChanges(gitStatus) === 0}
                    onClick={() => void commitGit()}
                    className="kimix-icon-text-button is-compact justify-center bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {gitBusy === "commit" ? <Loader2 size={14} className="animate-spin" /> : <GitCommitHorizontal size={14} />}
                    <span>提交</span>
                  </button>
                </div>
                <button
                  type="button"
                  disabled={!projectPathForGit || gitBusy !== null}
                  onClick={() => void refreshGitInfo()}
                  className="kimix-icon-text-button is-compact w-full justify-center bg-surface-base text-accent-primary hover:bg-accent-primary-light disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {gitBusy === "refresh" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  <span>刷新状态</span>
                </button>
              </div>
            </section>
            <section className="rounded-xl border border-border-subtle bg-surface-elevated" {...rightCardSectionProps("goal", 4, { padding: "16px 16px 18px" })}>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <div className="flex min-w-0 items-center" style={{ gap: 8 }}>
                  <Target size={15} className="shrink-0 text-accent-primary" />
                  <div className="text-[13px] font-medium leading-5 text-text-muted">官方 Goal</div>
                </div>
                <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                  <button
                    type="button"
                    disabled={!liveCurrentSession || Boolean(goalBusy)}
                    onClick={() => void runGoalAction("refresh", onRefreshOfficialGoal)}
                    className="kimix-icon-text-button is-compact shrink-0 bg-accent-primary-light text-accent-primary hover:bg-accent-primary-light/70 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <RefreshCw size={13} className={goalBusy === "refresh" ? "animate-spin" : ""} />
                    刷新
                  </button>
                  {rightCardDragHandle("goal", "官方 Goal")}
                </div>
              </div>
              <div className="flex flex-col" style={{ gap: 12, marginTop: 14 }}>
                <div
                  className={`rounded-lg border ${currentGoal ? "border-accent-primary-soft bg-accent-primary-light/40" : "border-border-subtle bg-surface-base"} text-[13px] leading-5`}
                  style={{ padding: "12px 12px" }}
                >
                  <div className="flex items-center justify-between" style={{ gap: 10 }}>
                    <span className="font-medium text-accent-primary">{goalStatusLabel}</span>
                    {currentGoal && (
                      <span className="shrink-0 rounded-lg bg-surface-elevated text-[12px] leading-5 text-text-muted" style={{ minHeight: 24, paddingLeft: 9, paddingRight: 9 }}>
                        {currentGoal.turnsUsed ?? 0} 轮
                      </span>
                    )}
                  </div>
                  <div className="whitespace-pre-wrap break-words text-text-secondary" style={{ marginTop: 8 }}>
                    {currentGoal?.objective ?? "用 /goal 或下方输入框启动一个官方 Goal。"}
                  </div>
                  {currentGoal?.terminalReason && (
                    <div className="text-[12.5px] leading-5 text-text-muted" style={{ marginTop: 8 }}>
                      {currentGoal.terminalReason}
                    </div>
                  )}
                  {officialGoal?.error && (
                    <div className="text-[12.5px] leading-5 text-accent-danger" style={{ marginTop: 8 }}>
                      {officialGoal.error}
                    </div>
                  )}
                </div>
                <textarea
                  value={goalDraft}
                  onChange={(event) => setGoalDraft(event.target.value)}
                  placeholder="输入一个可验证的目标"
                  className="min-h-[70px] w-full resize-none rounded-lg border border-border-subtle bg-surface-base text-[13px] leading-5 text-text-primary outline-none transition-colors placeholder:text-text-faint focus:border-accent-primary"
                  style={{ padding: "12px 12px" }}
                />
                <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                  <div className="flex min-w-0 items-center" style={{ gap: 8 }}>
                    {currentGoal?.status === "active" ? (
                      <button
                        type="button"
                        disabled={Boolean(goalBusy)}
                        onClick={() => void runGoalAction("pause", onPauseOfficialGoal)}
                        className="kimix-icon-text-button is-compact shrink-0 text-text-muted hover:bg-surface-hover"
                      >
                        <Pause size={13} />
                        暂停
                      </button>
                    ) : currentGoal ? (
                      <button
                        type="button"
                        disabled={Boolean(goalBusy)}
                        onClick={() => void runGoalAction("resume", onResumeOfficialGoal)}
                        className="kimix-icon-text-button is-compact shrink-0 text-accent-primary hover:bg-accent-primary-light"
                      >
                        <Play size={13} />
                        继续
                      </button>
                    ) : null}
                    {currentGoal && (
                      <button
                        type="button"
                        disabled={Boolean(goalBusy)}
                        onClick={() => void runGoalAction("cancel", onCancelOfficialGoal)}
                        className="kimix-icon-text-button is-compact shrink-0 text-accent-danger hover:bg-accent-danger-light"
                      >
                        <Trash2 size={13} />
                        取消
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={Boolean(goalBusy) || !goalDraft.trim()}
                    onClick={() => void runGoalAction(currentGoal ? "replace" : "create", async () => {
                      await onCreateOfficialGoal(goalDraft.trim(), Boolean(currentGoal));
                      setGoalDraft("");
                    })}
                    className="kimix-icon-text-button is-compact shrink-0 bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <Target size={13} />
                    {currentGoal ? "替换" : "启动"}
                  </button>
                </div>
              </div>
            </section>
            <section className="rounded-xl border border-border-subtle bg-surface-elevated" {...rightCardSectionProps("btw", 5, { padding: "16px 16px 18px" })}>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <div className="flex min-w-0 items-center" style={{ gap: 8 }}>
                  <MessageCircleQuestion size={15} className="shrink-0 text-accent-primary" />
                  <div className="text-[13px] font-medium leading-5 text-text-muted">BTW</div>
                </div>
                <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                  {btwState.rounds.length > 0 && (
                    <button
                      type="button"
                      onClick={onClearBtw}
                      className="kimix-icon-text-button is-compact shrink-0 text-text-muted hover:bg-surface-hover hover:text-text-primary"
                    >
                      <Trash2 size={13} />
                      清空
                    </button>
                  )}
                  {rightCardDragHandle("btw", "BTW")}
                </div>
              </div>
              <div className="flex flex-col" style={{ gap: 10, marginTop: 12 }}>
                <textarea
                  value={btwState.input}
                  onChange={(event) => onSetBtwInput(event.target.value)}
                  onKeyDown={handleBtwKeyDown}
                  placeholder="问一个不影响主轮次的问题"
                  className="min-h-[72px] w-full resize-none rounded-lg border border-border-subtle bg-surface-base text-[13px] leading-5 text-text-primary outline-none transition-colors placeholder:text-text-faint focus:border-accent-primary"
                  style={{ padding: "12px 12px" }}
                />
                <div className="flex items-center justify-between" style={{ gap: 10 }}>
                  <span className="min-w-0 truncate text-[12.5px] leading-5 text-text-muted">
                    {btwState.error ?? (btwState.rounds.length ? `${btwState.rounds.length} 轮侧问` : "暂无侧问记录")}
                  </span>
                  <button
                    type="button"
                    disabled={btwDisabled || btwState.loading || !btwState.input.trim()}
                    onClick={() => void onAskBtw()}
                    className="kimix-icon-text-button is-compact shrink-0 bg-accent-primary text-white hover:bg-accent-primary/90 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <Send size={13} />
                    {btwState.loading ? "发送中" : "发送"}
                  </button>
                </div>
                {btwState.rounds.length > 0 && (
                  <div className="flex max-h-[360px] flex-col overflow-y-auto" style={{ gap: 10, marginTop: 2 }}>
                    {visibleBtwRounds.map((round, index) => {
                      const collapsed = collapsedBtwRoundIds.has(round.id);
                      return (
                        <div
                          key={round.id}
                          className="rounded-lg border border-border-subtle bg-surface-base text-[13px] leading-5 text-text-secondary"
                          style={{ padding: "11px 12px" }}
                        >
                          <div className="rounded-lg border border-accent-primary-soft bg-accent-primary-light/40 text-accent-primary" style={{ padding: "9px 10px" }}>
                            <div className="whitespace-pre-wrap break-words">{round.userContent}</div>
                          </div>
                          <div style={{ marginTop: 10 }}>
                            <button
                              type="button"
                              onClick={() => toggleBtwRoundCollapsed(round.id)}
                              className="flex w-full items-center justify-between text-left text-[12.5px] leading-5 text-text-muted transition-colors hover:text-text-primary"
                              style={{ gap: 10, minHeight: 24 }}
                            >
                              <span>{index === 0 ? "最新回复" : "回复"}</span>
                              {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                            </button>
                            <div
                              className={`min-w-0 overflow-hidden text-[13px] leading-6 text-text-secondary ${collapsed ? "line-clamp-2" : ""}`}
                              style={{ marginTop: 6 }}
                            >
                              {round.assistantContent ? (
                                <MarkdownRenderer content={round.assistantContent} wrapLongLines />
                              ) : (
                                <span className="text-text-muted">等待回复...</span>
                              )}
                            </div>
                            {round.thinking && !collapsed && (
                              <details style={{ marginTop: 8 }}>
                                <summary className="cursor-pointer text-[12px] leading-5 text-text-muted">思考</summary>
                                <div className="whitespace-pre-wrap break-words text-[12.5px] leading-5 text-text-muted" style={{ marginTop: 6 }}>
                                  {round.thinking}
                                </div>
                              </details>
                            )}
                          </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
            <section className="rounded-xl border border-border-subtle bg-surface-elevated" {...rightCardSectionProps("plan", 6, { padding: "16px 16px 18px" })}>
              <div className="flex items-start justify-between" style={{ gap: 12 }}>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium leading-5 text-text-muted">Plan</div>
                  <div className="mt-1 truncate text-[13px] leading-5 text-text-primary">
                    {sessionPlanState.path || (sessionPlanPath === "__latest_kimi_plan__" ? "最近官方 Plan 文件" : sessionPlanPath) || "当前会话还没有捕获到官方 Plan 文件"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                  <button
                    type="button"
                    disabled={!liveCurrentSession || sessionPlanState.loading}
                    onClick={() => onRefreshSessionPlan()}
                    className="kimix-icon-text-button is-compact shrink-0 bg-accent-primary-light text-accent-primary hover:bg-accent-primary-light/70 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    <RefreshCw size={13} className={sessionPlanState.loading ? "animate-spin" : ""} />
                    刷新
                  </button>
                  {rightCardDragHandle("plan", "Plan")}
                </div>
              </div>
              {sessionPlanState.loading ? (
                <div className="mt-4 rounded-lg bg-accent-primary-light/40 text-[13px] leading-6 text-text-muted" style={{ padding: "13px 12px" }}>
                  正在读取 Plan 内容...
                </div>
              ) : sessionPlanState.error ? (
                <div className="mt-4 rounded-lg bg-accent-danger-light text-[13px] leading-6 text-accent-danger" style={{ padding: "13px 12px" }}>
                  读取失败：{sessionPlanState.error}
                </div>
              ) : sessionPlanState.content ? (
                <div className="mt-4 rounded-lg border border border-border-subtle bg-surface-elevated" style={{ padding: "14px 13px" }}>
                  <div className="max-h-[460px] min-w-0 overflow-x-hidden overflow-y-auto text-[13px] leading-6 text-text-secondary">
                    <MarkdownRenderer content={sessionPlanState.content} wrapLongLines />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[12px] leading-5 text-text-muted" style={{ gap: 10 }}>
                    <span className="truncate">
                      {sessionPlanState.updatedAt ? `更新于 ${formatReleaseDate(new Date(sessionPlanState.updatedAt).toISOString())}` : "已读取官方 Plan 文件"}
                    </span>
                    <button
                      type="button"
                      onClick={() => void copyToClipboard(sessionPlanState.content, "已复制 Plan 内容")}
                      className="kimix-icon-text-button is-compact shrink-0 text-accent-primary hover:bg-accent-primary-light"
                    >
                      <Copy size={13} />
                      复制
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-lg bg-surface-elevated text-[13px] leading-6 text-text-muted" style={{ padding: "13px 12px" }}>
                  {sessionPlanState.message || "开启 Plan 模式并让 Kimi 生成计划后，这里会显示官方写入的 markdown 内容。"}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-border-subtle bg-surface-elevated" {...rightCardSectionProps("session", 7, { padding: "16px 16px 18px" })}>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <div className="text-[13px] font-medium leading-5 text-text-muted">会话信息</div>
                {rightCardDragHandle("session", "会话信息")}
              </div>
              <div className="mt-3 flex flex-col text-[13px] leading-5 text-text-muted" style={{ gap: 10 }}>
                <div className="rounded-lg bg-accent-primary-light/40" style={{ padding: "11px 12px" }}>
                  <div className="font-medium text-accent-primary">Session</div>
                  <div className="mt-1 break-all">{liveCurrentSession?.id ?? "未选择会话"}</div>
                </div>
                <div className="rounded-lg bg-surface-elevated" style={{ padding: "11px 12px" }}>
                  <div className="font-medium text-accent-primary">工作目录</div>
                  <div className="mt-1 break-all">{liveCurrentSession?.projectPath ?? currentProject?.path ?? "未选择项目"}</div>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-surface-elevated" style={{ gap: 12, padding: "11px 12px" }}>
                  <span className="font-medium text-accent-primary">Plan 模式</span>
                  <span className="rounded-full bg-surface-elevated text-[12px] leading-5 text-text-muted" style={{ paddingLeft: 9, paddingRight: 9 }}>
                    {defaultPlanMode ? "已开启" : "已关闭"}
                  </span>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-border-subtle bg-surface-elevated" {...rightCardSectionProps("diffs", 8, { padding: "16px 16px 18px" })}>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <div className="text-[13px] font-medium leading-5 text-text-muted">最近变更</div>
                <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
                  <span className="rounded-full bg-accent-primary-light text-[12px] leading-5 text-accent-primary" style={{ paddingLeft: 9, paddingRight: 9 }}>
                    {sessionDiffs.length}
                  </span>
                  {rightCardDragHandle("diffs", "最近变更")}
                </div>
              </div>
              {sessionDiffs.length > 0 ? (
                <div className="mt-4 flex flex-col" style={{ gap: 10 }}>
                  {sessionDiffs.slice(0, 4).map((diff) => (
                    <button
                      key={diff.id}
                      type="button"
                      onClick={() => {
                        if (liveCurrentSession) void window.api.openFile({ projectPath: liveCurrentSession.projectPath, filePath: diff.filePath });
                      }}
                      className="w-full rounded-lg border border border-border-subtle bg-surface-elevated text-left transition-colors hover:bg-accent-primary-light/40"
                      style={{ padding: "12px 12px" }}
                    >
                      <div className="truncate text-[13px] font-medium leading-5 text-text-primary">{diff.filePath}</div>
                      <div className="mt-1 text-[12px] leading-5 text-text-muted">+{diff.additions} / -{diff.deletions}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-lg bg-surface-elevated text-[13px] leading-6 text-text-muted" style={{ padding: "13px 12px" }}>
                  当前会话还没有 diff 记录。
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}

const backgroundTaskStatusLabels: Record<string, string> = {
  running: "运行中",
  awaiting_approval: "等待审批",
  completed: "已完成",
  failed: "失败",
  killed: "已终止",
  lost: "已失联",
};

function isBackgroundTaskTerminal(status: string) {
  return ["completed", "failed", "killed", "lost"].includes(status);
}

function backgroundTaskTone(task: LongTaskBackgroundTaskView) {
  if (task.status === "completed") return "success";
  if (["failed", "killed", "lost"].includes(task.status)) return "danger";
  if (task.status === "awaiting_approval") return "warning";
  return "primary";
}

function backgroundTaskSummary(task: LongTaskBackgroundTaskView) {
  if (task.failureReason) return task.failureReason;
  if (task.stopReason) return task.stopReason;
  if (task.timedOut) return "任务执行超时";
  if (task.exitCode !== null && task.exitCode !== 0) return `进程退出码 ${task.exitCode}`;
  if (task.status === "lost") return "SDK 认为任务状态已失联，可查看输出后决定是否继续。";
  if (task.status === "killed") return "任务已被停止。";
  if (task.status === "completed") return "后台任务已正常结束。";
  return task.description || task.command || "后台任务正在运行。";
}
