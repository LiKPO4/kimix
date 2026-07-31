import type { Session } from "@/types/ui";

export function buildLongTaskExecutorNextPrompt(session: Session, nextStep: number) {
  const meta = session.longTask;
  if (!meta) return "";
  // targetStep 为 null 表示目标步数尚未确定（任务初始化默认值），此时不能宣称
  // 当前是最后一步，否则 agent 第一步就会输出"长程任务执行完成"导致任务提前终止。
  const isFinalStep = meta.targetStep != null && nextStep >= meta.targetStep;
  return `【Kimix 长程任务：继续执行 Step ${nextStep}】
本任务按 BIGPLAN 自动自推进。

请按以下规则执行：
1. 先阅读 ${meta.bigPlanPath}，确认当前进度和 Step ${nextStep} 的目标、范围、验收标准、验证方式。
2. 只执行 Step ${nextStep} 这一轮，不要合并后续多个 Step。
3. 完成后更新必要文件，并把本轮产出、验证证据、残余风险写入 rounds/ 对应记录。
4. 不要启动、模拟或等待额外审查流程；不要输出 \`kimix-long-task-status\` 或任何机器状态代码块。
${isFinalStep
  ? "5. 这是目标范围内最后一个 Step。完成后必须输出“最终结果”和“建议用户全盘审查的内容”，并明确写出“长程任务执行完成”。"
  : `5. 完成后必须明确写出“Step ${nextStep} 执行完成，继续下一步”，然后停止本轮输出，等待 Kimix 自动调度 Step ${nextStep + 1}。`}

如果发现必须由用户确认或外部环境处理的问题，请写入 ${meta.reviewQueuePath}，并明确说明阻塞原因。`;
}
