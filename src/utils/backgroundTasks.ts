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

/** 会话级后台任务中是否存在仍在运行的后台 Bash 任务（子 Agent 组的运行任务不计入）。 */
export function hasRunningBackgroundBashTask<T extends { subagentType?: string; status: string }>(
  tasks: readonly T[],
): boolean {
  const { bashTasks } = splitBackgroundTasksByKind(tasks);
  return bashTasks.some((task) => !isBackgroundTaskTerminalStatus(task.status));
}
