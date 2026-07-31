import { z } from "zod";

// 与 electron/types/ipc.ts 的 LongTaskRecoveryInfo 保持一致。
// 渲染层每次持久化长程任务状态都会携带 recovery（可能为 null），
// patch 使用 .strict()，缺这个字段会导致整个补丁被 zod 拒绝。
const LongTaskRecoveryInfoSchema = z.object({
  status: z.enum(["none", "failed", "interrupted", "paused"]),
  reason: z.string().max(20000),
  suggestedAction: z.string().max(20000),
  updatedAt: z.number(),
});

export const UpdateLongTaskStateSchema = z.object({
  projectPath: z.string().min(1).max(4096),
  taskId: z.string().min(1).max(160),
  patch: z.object({
    stage: z.enum(["drafting", "planning", "ready", "running", "reviewing", "paused", "completed"]).optional(),
    activeAgent: z.enum(["executor", "reviewer"]).optional(),
    recovery: LongTaskRecoveryInfoSchema.nullable().optional(),
    currentStep: z.number().int().min(0).optional(),
    targetStep: z.number().int().min(0).nullable().optional(),
    reviewedReviewItems: z.array(z.string().max(20000)).max(500).optional(),
    executorSessionId: z.string().min(1).max(160).optional(),
    reviewerSessionId: z.string().min(1).max(160).optional(),
  }).strict(),
});
