import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { LongTaskAgentRole, LongTaskStage, LongTaskSummary, Project } from "./types/ipc";

export type CreateLongTaskData = {
  project: Project;
  title: string;
  initialRequest: string;
  executorSessionId: string;
  reviewerSessionId: string;
};

const LONG_TASKS_DIR = ".kimix-long-tasks";
const STATE_FILE = "state.json";

type LongTaskState = LongTaskSummary & {
  schemaVersion: 1;
};

function ensureDirectory(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeSegment(value: string) {
  return (value || "long-task")
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "long-task";
}

function longTasksRoot(projectPath: string) {
  return path.join(projectPath, LONG_TASKS_DIR);
}

function relativeToProject(projectPath: string, targetPath: string) {
  return path.relative(projectPath, targetPath).replace(/\\/g, "/");
}

function assertInsideProject(projectPath: string, targetPath: string) {
  const resolvedProject = path.resolve(projectPath);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedProject, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Long task path escapes project");
  }
}

function readProjectAgent(projectPath: string) {
  const agentPath = path.join(projectPath, "AGENTS.md");
  try {
    return fs.existsSync(agentPath) ? fs.readFileSync(agentPath, "utf-8").trim() : "";
  } catch {
    return "";
  }
}

function buildBigPlan(task: Pick<LongTaskSummary, "title" | "projectName" | "projectPath" | "initialRequest" | "createdAt">) {
  return `# BIGPLAN

## 目标
${task.title}

## 初始需求
${task.initialRequest}

## 当前状态
- 阶段：drafting
- 当前步骤：0
- 目标执行到：未设置
- 当前工作 agent：executor
- 创建时间：${new Date(task.createdAt).toISOString()}
- 项目：${task.projectName}
- 项目路径：${task.projectPath}

## 关键决策
- 长程任务和普通聊天隔离，不复用已有聊天会话。
- 执行 agent 与审查 agent 使用两个真实 Kimi session，各自维护上下文。
- 每个计划步骤必须控制为一轮可完成的工作。
- 规划完成后必须先由审查 agent 审查计划，再交给用户确认。

## 分步计划
> 规划阶段由执行 agent 和用户多轮澄清后填写。每个 Step 只放一轮能完成的工作。

### Step 1
目标：
范围：
本轮不做：
验收标准：
执行提示词：
审查提示词：
状态：待规划

## 待人工审查
详见 reviews/REVIEW_QUEUE.md
`;
}

function buildExecutorPrompt(projectAgent: string, taskDir: string) {
  return `# 长程任务执行 Agent

你是 Kimix 长程任务的执行 agent。你只负责执行、澄清、设计计划和修复问题，不负责最终审查通过。

## 工作规则
- 始终先阅读并维护本任务的 BIGPLAN.md。
- 规划阶段需要和用户多轮澄清，直到计划足够具体、可执行、可审查。
- 每个计划步骤必须是一轮可以完成的工作，不要把过多任务塞进同一个步骤。
- 用户设置执行到第 N 步时，只按 BIGPLAN.md 顺序推进到目标步骤。
- 每轮结束后，把产出、验证证据、风险和后续建议写入 rounds/ 对应记录。
- 如果你意识到自己的执行规则可以改进，只更新本文件，不要修改项目根 AGENTS.md。
- 审查 agent 发现问题后，先修复问题，再等待审查 agent 重新确认。

## 隔离约束
- 本任务提示词目录：${taskDir}/prompts/executor
- 本任务计划文件：${taskDir}/BIGPLAN.md
- 不要污染普通聊天会话，不要把长程任务专属规则写回项目根 AGENTS.md。

## 项目原始 AGENTS.md 参考
${projectAgent || "当前项目根目录未找到 AGENTS.md。"}
`;
}

function buildReviewerPrompt(taskDir: string) {
  return `# 长程任务审查 Agent

你是 Kimix 长程任务的审查 agent。你和执行 agent 是两个独立真实 session，你的职责是审查计划、审查每轮产出、发现风险，并在通过后生成下一轮执行提示词。

## 审查职责
- 规划阶段先审查 BIGPLAN.md：步骤是否过大、验收标准是否明确、风险边界是否清楚。
- 每轮执行完成后，检查是否符合本步骤目标、范围和验收标准。
- 发现问题时，必须先反馈给执行 agent 修复，不直接进入下一步。
- 暂时无法自动审查或测试的内容，写入 reviews/REVIEW_QUEUE.md，留给用户最终处理。
- 审查通过后，生成下一步执行 prompt，交给调度器发送给执行 agent。

## 输出结论
每次审查必须明确给出：
- 结论：通过 / 需修复 / 待人工审查
- 发现的问题
- 缺失的验证
- 下一轮执行提示词

## 隔离约束
- 本任务提示词目录：${taskDir}/prompts/reviewer
- 本任务计划文件：${taskDir}/BIGPLAN.md
- 你可以改进本文件，但不要修改执行 agent 的提示词，除非用户明确要求。
`;
}

function buildReviewQueue(taskTitle: string) {
  return `# 待审查

任务：${taskTitle}

这里记录审查 agent 暂时无法自动确认、需要用户或外部环境处理的事项。

## 待处理
- 暂无
`;
}

function buildRoundNote(title: string) {
  return `# Round 000

任务：${title}

此目录用于记录后续每轮执行和审查结果。
`;
}

function writeTextIfMissing(filePath: string, content: string) {
  if (fs.existsSync(filePath)) return;
  fs.writeFileSync(filePath, `${content.trimEnd()}\n`, "utf-8");
}

function readStateFile(statePath: string): LongTaskSummary | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf-8")) as Partial<LongTaskState>;
    if (!parsed.id || !parsed.projectPath || !parsed.taskDir || !parsed.title) return null;
    return parsed as LongTaskSummary;
  } catch {
    return null;
  }
}

export function listLongTasks(projectPath: string): LongTaskSummary[] {
  const root = longTasksRoot(projectPath);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readStateFile(path.join(root, entry.name, STATE_FILE)))
    .filter((task): task is LongTaskSummary => Boolean(task))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createLongTask(data: CreateLongTaskData): LongTaskSummary {
  if (!fs.existsSync(data.project.path)) {
    throw new Error("Project path does not exist");
  }

  const now = Date.now();
  const taskId = `lt-${new Date(now).toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8)}`;
  const root = longTasksRoot(data.project.path);
  const taskDir = path.join(root, `${taskId}-${safeSegment(data.title)}`);
  assertInsideProject(data.project.path, taskDir);

  const promptsDir = path.join(taskDir, "prompts");
  const executorPromptDir = path.join(promptsDir, "executor");
  const reviewerPromptDir = path.join(promptsDir, "reviewer");
  const reviewsDir = path.join(taskDir, "reviews");
  const roundsDir = path.join(taskDir, "rounds");

  [taskDir, executorPromptDir, reviewerPromptDir, reviewsDir, roundsDir].forEach(ensureDirectory);

  const bigPlanFile = path.join(taskDir, "BIGPLAN.md");
  const executorPromptFile = path.join(executorPromptDir, "AGENTS.md");
  const reviewerPromptFile = path.join(reviewerPromptDir, "AGENTS.md");
  const reviewQueueFile = path.join(reviewsDir, "REVIEW_QUEUE.md");

  const task: LongTaskSummary = {
    id: taskId,
    title: data.title,
    projectPath: data.project.path,
    projectName: data.project.name,
    taskDir,
    bigPlanPath: relativeToProject(data.project.path, bigPlanFile),
    executorPromptPath: relativeToProject(data.project.path, executorPromptFile),
    reviewerPromptPath: relativeToProject(data.project.path, reviewerPromptFile),
    reviewQueuePath: relativeToProject(data.project.path, reviewQueueFile),
    executorSessionId: data.executorSessionId,
    reviewerSessionId: data.reviewerSessionId,
    stage: "drafting" satisfies LongTaskStage,
    activeAgent: "executor" satisfies LongTaskAgentRole,
    currentStep: 0,
    targetStep: null,
    createdAt: now,
    updatedAt: now,
    initialRequest: data.initialRequest,
  };

  writeTextIfMissing(bigPlanFile, buildBigPlan(task));
  writeTextIfMissing(executorPromptFile, buildExecutorPrompt(readProjectAgent(data.project.path), taskDir));
  writeTextIfMissing(reviewerPromptFile, buildReviewerPrompt(taskDir));
  writeTextIfMissing(reviewQueueFile, buildReviewQueue(task.title));
  writeTextIfMissing(path.join(roundsDir, "000-bootstrap.md"), buildRoundNote(task.title));

  const state: LongTaskState = { ...task, schemaVersion: 1 };
  fs.writeFileSync(path.join(taskDir, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, "utf-8");

  return task;
}
