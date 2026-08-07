import { describe, expect, it } from "vitest";
import { hasRunningBackgroundBashTask, isBackgroundTaskTerminalStatus, pruneHiddenTaskKeysWhenEmpty, splitBackgroundTasksByKind } from "../backgroundTasks";

describe("splitBackgroundTasksByKind", () => {
  it("subagent 进子 Agent 组，bash/tool/未知/缺失 kind 进后台 Bash 组", () => {
    const tasks = [
      { taskId: "sub-1", subagentType: "subagent" },
      { taskId: "bash-1", subagentType: "bash" },
      { taskId: "tool-1", subagentType: "tool" },
      { taskId: "unknown-1", subagentType: "future-kind" },
      { taskId: "missing-1" },
      { taskId: "sub-2", subagentType: "subagent" },
    ];
    const { subagentTasks, bashTasks } = splitBackgroundTasksByKind(tasks);
    expect(subagentTasks.map((task) => task.taskId)).toEqual(["sub-1", "sub-2"]);
    expect(bashTasks.map((task) => task.taskId)).toEqual(["bash-1", "tool-1", "unknown-1", "missing-1"]);
  });

  it("空数组返回两个空数组", () => {
    const { subagentTasks, bashTasks } = splitBackgroundTasksByKind([]);
    expect(subagentTasks).toEqual([]);
    expect(bashTasks).toEqual([]);
  });

  it("不修改原数组且保持原有顺序", () => {
    const tasks = [
      { taskId: "b", subagentType: "bash" },
      { taskId: "a", subagentType: "subagent" },
      { taskId: "c", subagentType: "tool" },
    ];
    const snapshot = [...tasks];
    const { subagentTasks, bashTasks } = splitBackgroundTasksByKind(tasks);
    expect(tasks).toEqual(snapshot);
    expect(subagentTasks.map((task) => task.taskId)).toEqual(["a"]);
    expect(bashTasks.map((task) => task.taskId)).toEqual(["b", "c"]);
  });
});

describe("isBackgroundTaskTerminalStatus", () => {
  it("终态与运行态判定", () => {
    for (const status of ["completed", "failed", "killed", "cancelled", "stopped", "exited"]) {
      expect(isBackgroundTaskTerminalStatus(status)).toBe(true);
    }
    expect(isBackgroundTaskTerminalStatus("running")).toBe(false);
    expect(isBackgroundTaskTerminalStatus("pending")).toBe(false);
    expect(isBackgroundTaskTerminalStatus("")).toBe(false);
  });
});

describe("hasRunningBackgroundBashTask", () => {
  it("bash 组存在非终态任务时返回 true", () => {
    const tasks = [
      { taskId: "bash-running", subagentType: "bash", status: "running" },
      { taskId: "bash-completed", subagentType: "bash", status: "completed" },
      { taskId: "sub-running", subagentType: "subagent", status: "running" },
    ];
    expect(hasRunningBackgroundBashTask(tasks)).toBe(true);
  });

  it("只有终态任务或空列表时返回 false", () => {
    expect(hasRunningBackgroundBashTask([])).toBe(false);
    expect(hasRunningBackgroundBashTask([
      { taskId: "bash-done", subagentType: "bash", status: "completed" },
      { taskId: "sub-done", subagentType: "subagent", status: "completed" },
    ])).toBe(false);
  });

  it("subagent 组的运行任务不计入 Bash 判定", () => {
    expect(hasRunningBackgroundBashTask([
      { taskId: "sub-running", subagentType: "subagent", status: "running" },
    ])).toBe(false);
  });
});

describe("pruneHiddenTaskKeysWhenEmpty", () => {
  it("bash 任务列表为空时从 hidden keys 中移除 bash", () => {
    expect(pruneHiddenTaskKeysWhenEmpty([], ["bash", "subagent", "todo"] as const)).toEqual(["todo"]);
    expect(pruneHiddenTaskKeysWhenEmpty(
      [{ taskId: "sub-1", subagentType: "subagent" }],
      ["bash", "subagent"] as const,
    )).toEqual(["subagent"]);
  });

  it("subagent 任务列表为空时从 hidden keys 中移除 subagent", () => {
    expect(pruneHiddenTaskKeysWhenEmpty(
      [{ taskId: "bash-1", subagentType: "bash" }],
      ["bash", "subagent", "todo"] as const,
    )).toEqual(["bash", "todo"]);
  });

  it("两类任务都存在时保持 hidden keys 不变", () => {
    const hidden = ["bash", "subagent", "todo"] as const;
    const pruned = pruneHiddenTaskKeysWhenEmpty(
      [
        { taskId: "bash-1", subagentType: "bash" },
        { taskId: "sub-1", subagentType: "subagent" },
      ],
      hidden,
    );
    expect(pruned).toEqual(hidden);
    expect(pruned).not.toBe(hidden);
  });

  it("未知 kind 任务归入 bash 组：只有 tool 任务时移除 subagent key 并保留 bash key", () => {
    expect(pruneHiddenTaskKeysWhenEmpty(
      [{ taskId: "tool-1", subagentType: "tool" }],
      ["bash", "subagent"] as const,
    )).toEqual(["bash"]);
  });

  it("空 hidden keys 返回空数组且不修改入参", () => {
    expect(pruneHiddenTaskKeysWhenEmpty([], [])).toEqual([]);
    const tasks = [{ taskId: "bash-1", subagentType: "bash" }];
    pruneHiddenTaskKeysWhenEmpty(tasks, ["bash"]);
    expect(tasks).toEqual([{ taskId: "bash-1", subagentType: "bash" }]);
  });
});
