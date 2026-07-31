import { describe, expect, it } from "vitest";
import { splitBackgroundTasksByKind } from "../backgroundTasks";

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
