import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  ClipboardCopy,
  Copy,
  FileText,
  Play,
  Pause,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import type { Session } from "@/types/ui";
import type { LongTaskDetail, LongTaskSummary } from "@electron/types/ipc";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { formatReleaseDate } from "@/utils/format";
import type { ParsedLongTaskDetail } from "@/utils/longTaskParser";

export type HiddenComposerCardEntry = {
  key: "todo" | "pending";
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
  sessionDiffs: { id: string; filePath: string; additions: number; deletions: number; timestamp: number }[];
  defaultPlanMode: boolean;
  buildNextLongTaskPrompt: () => string;
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
  onSetTargetStepDraft: (value: string) => void;
  onSetShutdownAfterLongTaskId: (taskId: string | null) => void;
  onSetComposerCardHidden: (sessionId: string, key: "todo" | "pending", hidden: boolean) => void;
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
  sessionDiffs,
  defaultPlanMode,
  buildNextLongTaskPrompt,
  onClose,
  onPatchLongTaskMeta,
  onApplyTargetStep,
  onSetReviewItemChecked,
  onCopyNextLongTaskPrompt,
  onRefreshSessionPlan,
  onRefreshSessionLongTasks,
  onSetTargetStepDraft,
  onSetShutdownAfterLongTaskId,
  onSetComposerCardHidden,
  showToast,
  copyToClipboard,
}: LongTaskInspectorPanelProps) {
  const openFile = (filePath: string) => {
    if (liveCurrentSession) void window.api.openFile({ projectPath: liveCurrentSession.projectPath, filePath });
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
            <section className="rounded-xl border border-border-subtle bg-surface-elevated" style={{ padding: "18px 16px 20px" }}>
              <div className="text-[13px] font-medium leading-5 text-text-muted">当前状态</div>
              <div className="mt-2 text-[14px] leading-6 text-text-primary">
                {longTaskMeta.activeAgent === "reviewer" ? "审查 agent" : "执行 agent"} · {longTaskMeta.stage}
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
                  <div className="flex flex-col" style={{ gap: 16 }}>
                    <span className="text-[13px] font-medium leading-5 text-accent-primary">工作 agent</span>
                    <div className="flex w-full items-center rounded-lg bg-surface-elevated" style={{ gap: 10, padding: 7 }}>
                      <button
                        type="button"
                        disabled={longTaskControlBusy}
                        onClick={() => void onPatchLongTaskMeta({ activeAgent: "executor", stage: longTaskMeta.stage === "reviewing" ? "paused" : longTaskMeta.stage }, { message: "已切换到执行 agent" })}
                        className={`h-9 flex-1 rounded-md text-[12.5px] leading-5 transition-colors disabled:cursor-wait disabled:opacity-60 ${longTaskMeta.activeAgent === "executor" ? "bg-accent-primary-light text-accent-primary" : "text-text-muted hover:bg-accent-primary-light"}`}
                        style={{ paddingLeft: 14, paddingRight: 14 }}
                      >
                        执行
                      </button>
                      <button
                        type="button"
                        disabled={longTaskControlBusy}
                        onClick={() => void onPatchLongTaskMeta({ activeAgent: "reviewer", stage: longTaskMeta.stage === "running" ? "paused" : longTaskMeta.stage }, { message: "已切换到审查 agent" })}
                        className={`h-9 flex-1 rounded-md text-[12.5px] leading-5 transition-colors disabled:cursor-wait disabled:opacity-60 ${longTaskMeta.activeAgent === "reviewer" ? "bg-accent-warning-light text-accent-warning" : "text-text-muted hover:bg-accent-primary-light"}`}
                        style={{ paddingLeft: 14, paddingRight: 14 }}
                      >
                        审查
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center" style={{ gap: 14, marginTop: 22 }}>
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
                <div className="rounded-lg bg-surface-elevated text-[13px] leading-5 text-text-muted" style={{ padding: "13px 12px" }}>
                  <div className="flex items-center justify-between" style={{ gap: 10 }}>
                    <span className="font-medium text-accent-primary">下一步 prompt</span>
                    <button
                      type="button"
                      onClick={() => void onCopyNextLongTaskPrompt()}
                      className="kimix-icon-text-button is-compact shrink-0 bg-surface-elevated text-accent-primary hover:bg-accent-primary-light"
                    >
                      <ClipboardCopy size={13} />
                      复制
                    </button>
                  </div>
                  <div className="mt-3 line-clamp-4 whitespace-pre-wrap text-text-muted">
                    {buildNextLongTaskPrompt()}
                  </div>
                </div>
              </div>
            </section>
            <section className="rounded-xl border border-border-subtle bg-surface-elevated" style={{ order: 2, padding: "16px 16px 18px" }}>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium leading-5 text-text-muted">BIGPLAN</div>
                  <div className="mt-1 truncate text-[13px] leading-5 text-text-primary">{longTaskMeta.bigPlanPath}</div>
                </div>
                <button
                  type="button"
                  onClick={() => openFile(longTaskMeta.bigPlanPath)}
                  className="kimix-icon-text-button is-compact shrink-0 bg-accent-primary-light text-accent-primary hover:bg-accent-primary-light/70"
                >
                  打开
                </button>
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
                        BIGPLAN 还没有解析到 Step，等待执行 agent 完成规划。
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </section>
            <section className="rounded-xl border border-border-subtle bg-surface-elevated" style={{ order: 3, padding: "16px 16px 18px" }}>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium leading-5 text-text-muted">轮次记录</div>
                  <div className="mt-1 truncate text-[13px] leading-5 text-text-primary">rounds/step-XXX.md</div>
                </div>
                <span className="shrink-0 rounded-full bg-accent-primary-light text-[12px] leading-5 text-accent-primary" style={{ paddingLeft: 9, paddingRight: 9 }}>
                  {parsedLongTaskDetail?.rounds.length ?? 0}
                </span>
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
            <section className="rounded-xl border border-border-subtle bg-surface-elevated" style={{ order: 1, padding: "16px 16px 18px" }}>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium leading-5 text-text-muted">待审查</div>
                  <div className="mt-1 truncate text-[13px] leading-5 text-text-primary">{longTaskMeta.reviewQueuePath}</div>
                </div>
                <button
                  type="button"
                  onClick={() => openFile(longTaskMeta.reviewQueuePath)}
                  className="kimix-icon-text-button is-compact shrink-0 bg-accent-primary-light text-accent-primary hover:bg-accent-primary-light/70"
                >
                  打开
                </button>
              </div>
              {longTaskDetailLoading ? (
                <div className="mt-4 rounded-lg bg-accent-warning-light text-[13px] leading-6 text-accent-warning" style={{ padding: "13px 12px" }}>
                  正在读取待审查队列...
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
                      title="点击标记为已审查"
                    >
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-accent-warning/50 text-transparent">
                        <CheckCircle2 size={12} />
                      </span>
                      <span className="min-w-0 flex-1">{item}</span>
                    </button>
                  ))}
                  {pendingReviewItems.length === 0 && (
                    <div className="rounded-lg bg-accent-warning-light text-[13px] leading-6 text-accent-warning" style={{ padding: "13px 12px" }}>
                      待审查项都已确认。
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-4 rounded-lg bg-accent-warning-light text-[13px] leading-6 text-accent-warning" style={{ padding: "13px 12px" }}>
                  暂无待人工审查项。
                </div>
              )}
            </section>
            {completedReviewItems.length > 0 && (
              <section className="rounded-xl border border-border-subtle bg-surface-elevated" style={{ order: 4, padding: "16px 16px 18px" }}>
                <div className="flex items-center justify-between" style={{ gap: 10 }}>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium leading-5 text-text-muted">已审查</div>
                    <div className="mt-1 text-[13px] leading-5 text-text-muted">点击条目可撤回到待审查</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-accent-primary-light text-[12px] leading-5 text-accent-primary" style={{ paddingLeft: 9, paddingRight: 9 }}>
                    {completedReviewItems.length}
                  </span>
                </div>
                <div className="mt-4 flex flex-col" style={{ gap: 10 }}>
                  {completedReviewItems.map((item, index) => (
                    <button
                      key={`${index}-${item}`}
                      type="button"
                      onClick={() => onSetReviewItemChecked(item, false)}
                      className="flex w-full items-start rounded-lg border border-accent-success/30 bg-accent-success-light text-left text-[13px] leading-5 text-accent-success transition-colors hover:bg-accent-success-light/70"
                      style={{ gap: 10, padding: "12px 12px" }}
                      title="点击撤回到待审查"
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
              <section className="rounded-xl border border-border-subtle bg-surface-elevated" style={{ order: 0, padding: "16px 16px 18px" }}>
                <div className="flex items-start justify-between" style={{ gap: 12 }}>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium leading-5 text-text-muted">已收起卡片</div>
                    <div className="mt-1 truncate text-[13px] leading-5 text-text-primary">可恢复到输入框上方</div>
                  </div>
                  <span className="shrink-0 rounded-full bg-accent-primary-light text-[12px] leading-5 text-accent-primary" style={{ paddingLeft: 9, paddingRight: 9 }}>
                    {hiddenComposerCardEntries.length}
                  </span>
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
            <section className="rounded-xl border border-border-subtle bg-surface-elevated" style={{ order: 4, padding: "16px 16px 18px" }}>
              <div className="flex items-start justify-between" style={{ gap: 12 }}>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium leading-5 text-text-muted">长程任务</div>
                  <div className="mt-1 truncate text-[13px] leading-5 text-text-primary">
                    {visibleSessionLongTasks.length > 0 ? `${visibleSessionLongTasks.length} 个任务` : "当前项目暂无任务"}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={sessionLongTasksLoading || !(liveCurrentSession?.projectPath ?? currentProject?.path)}
                  onClick={() => onRefreshSessionLongTasks()}
                  className="kimix-icon-text-button is-compact shrink-0 bg-accent-primary-light text-accent-primary hover:bg-accent-primary-light/70 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <RefreshCw size={13} className={sessionLongTasksLoading ? "animate-spin" : ""} />
                  刷新
                </button>
              </div>
              {visibleSessionLongTasks.length > 0 ? (
                <div className="mt-4 flex flex-col" style={{ gap: 10 }}>
                  {visibleSessionLongTasks.slice(0, 3).map((task) => (
                    <div key={task.id} className="rounded-lg border border border-border-subtle bg-surface-elevated" style={{ padding: "12px 12px" }}>
                      <div className="truncate text-[13.5px] font-medium leading-5 text-text-primary">{task.title}</div>
                      <div className="mt-1 text-[12.5px] leading-5 text-text-muted">
                        Step {task.currentStep}{task.targetStep ? ` / ${task.targetStep}` : ""} · {task.stage}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-lg bg-surface-elevated text-[13px] leading-6 text-text-muted" style={{ padding: "13px 12px" }}>
                  如果这个对话已经关联长程任务，刷新后这里会显示任务卡片。
                </div>
              )}
            </section>
            <section className="rounded-xl border border-border-subtle bg-surface-elevated" style={{ order: 1, padding: "16px 16px 18px" }}>
              <div className="flex items-start justify-between" style={{ gap: 12 }}>
                <div className="min-w-0">
                  <div className="text-[13px] font-medium leading-5 text-text-muted">Plan</div>
                  <div className="mt-1 truncate text-[13px] leading-5 text-text-primary">
                    {sessionPlanState.path || (sessionPlanPath === "__latest_kimi_plan__" ? "最近官方 Plan 文件" : sessionPlanPath) || "当前会话还没有捕获到官方 Plan 文件"}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!liveCurrentSession || sessionPlanState.loading}
                  onClick={() => onRefreshSessionPlan()}
                  className="kimix-icon-text-button is-compact shrink-0 bg-accent-primary-light text-accent-primary hover:bg-accent-primary-light/70 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <RefreshCw size={13} className={sessionPlanState.loading ? "animate-spin" : ""} />
                  刷新
                </button>
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

            <section className="rounded-xl border border-border-subtle bg-surface-elevated" style={{ order: 2, padding: "16px 16px 18px" }}>
              <div className="text-[13px] font-medium leading-5 text-text-muted">会话信息</div>
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

            <section className="rounded-xl border border-border-subtle bg-surface-elevated" style={{ order: 3, padding: "16px 16px 18px" }}>
              <div className="flex items-center justify-between" style={{ gap: 10 }}>
                <div className="text-[13px] font-medium leading-5 text-text-muted">最近变更</div>
                <span className="shrink-0 rounded-full bg-accent-primary-light text-[12px] leading-5 text-accent-primary" style={{ paddingLeft: 9, paddingRight: 9 }}>
                  {sessionDiffs.length}
                </span>
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
