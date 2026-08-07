import type { KimiCodeBackgroundTaskInfo } from "@electron/types/ipc";
import type { ComposerDockCard } from "@/types/ui";

/**
 * 会话级后台任务分组：按官方 tasks 的 kind（IPC 层透传为 subagentType）把任务拆成
 * 「子 Agent」与「后台 Bash」两组。官方 kind 取值未枚举，subagent 以外的取值
 * （bash/tool/未知/缺失，SDK 链路可能不带该字段）防御性归并到「后台 Bash」组。
 */
export function splitBackgroundTasksByKind<T extends { subagentType?: string }>(
  tasks: readonly T[],
): { subagentTasks: T[]; bashTasks: T[] } {
  const subagentTasks: T[] = [];
  const bashTasks: T[] = [];
  for (const task of tasks) {
    if (task.subagentType === "subagent") {
      subagentTasks.push(task);
    } else {
      bashTasks.push(task);
    }
  }
  return { subagentTasks, bashTasks };
}

/** 后台任务终态：completed/failed/killed/cancelled/stopped/exited，其余视为仍在运行。 */
export function isBackgroundTaskTerminalStatus(status: string) {
  return ["completed", "failed", "killed", "cancelled", "stopped", "exited"].includes(status);
}

/**
 * 互斥空态派生清理：某类后台任务（bash/subagent）列表为空时，侧栏对应块随之消失，
 * 「恢复胶囊」入口不可达；hidden 状态若残留，下次同类任务出现时胶囊仍被隐藏（只能重启复位）。
 * 在任务状态更新处调用，从 hidden keys 中剔除任务为空的类别。
 */
export function pruneHiddenTaskKeysWhenEmpty<T extends { subagentType?: string }>(
  tasks: readonly T[],
  hiddenKeys: readonly ComposerDockCard[],
): ComposerDockCard[] {
  const { bashTasks, subagentTasks } = splitBackgroundTasksByKind(tasks);
  const emptyKinds = new Set<ComposerDockCard>();
  if (bashTasks.length === 0) emptyKinds.add("bash");
  if (subagentTasks.length === 0) emptyKinds.add("subagent");
  if (emptyKinds.size === 0) return [...hiddenKeys];
  return hiddenKeys.filter((key) => !emptyKinds.has(key));
}

/** 会话级后台任务中是否存在仍在运行的后台 Bash 任务（子 Agent 组的运行任务不计入）。 */
export function hasRunningBackgroundBashTask<T extends { subagentType?: string; status: string }>(
  tasks: readonly T[],
): boolean {
  const { bashTasks } = splitBackgroundTasksByKind(tasks);
  return bashTasks.some((task) => !isBackgroundTaskTerminalStatus(task.status));
}

export function backgroundTaskTone(task: KimiCodeBackgroundTaskInfo) {
  if (task.status === "completed") return "success";
  if (["failed", "killed", "lost"].includes(task.status)) return "danger";
  if (task.status === "awaiting_approval") return "warning";
  return "primary";
}

export function backgroundTaskKindLabel(task: KimiCodeBackgroundTaskInfo) {
  if (task.subagentType === "subagent") return "subagent";
  if (task.subagentType?.trim()) return task.subagentType;
  // SDK 兼容链路可能不带 kind 字段，兜底按普通后台任务展示
  return "后台任务";
}

export function backgroundTaskDurationLabel(task: KimiCodeBackgroundTaskInfo) {
  if (!task.startedAt) return null;
  const end = task.endedAt ?? Date.now();
  const seconds = Math.max(0, Math.round((end - task.startedAt) / 1000));
  return `${seconds} s`;
}

export function backgroundTaskSummary(task: KimiCodeBackgroundTaskInfo) {
  if (task.failureReason) return task.failureReason;
  if (task.stopReason) return task.stopReason;
  if (task.timedOut) return "任务执行超时";
  if (task.exitCode !== null && task.exitCode !== 0) return `进程退出码 ${task.exitCode}`;
  if (task.status === "lost") return "SDK 认为任务状态已失联，可查看输出后决定是否继续。";
  if (task.status === "killed") return "任务已被停止。";
  if (task.status === "completed") return "后台任务已正常结束。";
  if (typeof task.outputBytes === "number" && task.outputBytes > 0) return `后台任务正在运行，已有约 ${formatTaskOutputBytes(task.outputBytes)} 输出可查看。`;
  return task.description || task.command || "后台任务正在运行。";
}

function formatTaskOutputBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
