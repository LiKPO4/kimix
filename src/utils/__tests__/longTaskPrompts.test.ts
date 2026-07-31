import { describe, expect, it } from "vitest";
import type { Session } from "@/types/ui";
import { buildLongTaskExecutorNextPrompt } from "@/utils/longTaskPrompts";

function makeSession(targetStep: number | null): Session {
  return {
    longTask: {
      taskId: "lt-1",
      title: "任务",
      stage: "running",
      activeAgent: "executor",
      executorSessionId: "exec-1",
      reviewerSessionId: "rev-1",
      bigPlanPath: ".kimix/long-tasks/lt-1/BIGPLAN.md",
      reviewQueuePath: ".kimix/long-tasks/lt-1/reviews/REVIEW_QUEUE.md",
      currentStep: 0,
      targetStep,
    },
  } as unknown as Session;
}

describe("buildLongTaskExecutorNextPrompt", () => {
  it("targetStep 为 null 时不宣称是最后一步", () => {
    const prompt = buildLongTaskExecutorNextPrompt(makeSession(null), 1);
    expect(prompt).toContain("Step 1 执行完成，继续下一步");
    expect(prompt).not.toContain("最后一个 Step");
    expect(prompt).not.toContain("长程任务执行完成”。");
  });

  it("nextStep 达到 targetStep 时宣称最后一步", () => {
    const prompt = buildLongTaskExecutorNextPrompt(makeSession(3), 3);
    expect(prompt).toContain("这是目标范围内最后一个 Step");
    expect(prompt).toContain("长程任务执行完成");
  });

  it("nextStep 小于 targetStep 时继续调度下一步", () => {
    const prompt = buildLongTaskExecutorNextPrompt(makeSession(3), 2);
    expect(prompt).toContain("Step 2 执行完成，继续下一步");
    expect(prompt).not.toContain("最后一个 Step");
  });

  it("缺少 longTask 元信息时返回空串", () => {
    expect(buildLongTaskExecutorNextPrompt({} as unknown as Session, 1)).toBe("");
  });
});
