import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppendLongTaskRoundRequest, LongTaskAgentRole, LongTaskDetail, LongTaskRoundRecord, LongTaskStage, LongTaskSummary, Project } from "./types/ipc";

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
- 规划阶段不启动审查 agent；执行 agent 必须先和用户完成澄清、形成完整 BIGPLAN.md，并等待用户确认进入执行阶段。
- 审查 agent 只在执行阶段接棒，审查每轮执行产出和验证结果。

## 分步计划
> 规划阶段由执行 agent 和用户多轮澄清后填写。每个 Step 只放一轮能完成的工作。

### Step 1
目标：
范围：
本轮不做：
验收标准：
验证方式/命令：
预期证据：
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
- 规划阶段如存在会影响目标、范围、文件、执行方式、验收标准、验证方式、风险边界或优先级的不确定点，且当前环境允许提问，优先走官方需求澄清能力。
- 如果当前环境不允许提问，不要解释内部规则；改为做合理假设、记录风险并继续规划。
- 使用官方需求澄清能力时，每轮只问 1-3 个最关键问题，避免一次性塞太多。
- 只有当需求已经足够明确，才能写完整 BIGPLAN.md 并请求用户确认进入执行阶段。
- 每个计划步骤必须是一轮可以完成的工作，不要把过多任务塞进同一个步骤。
- 每个计划步骤必须写清楚验收标准、验证方式/命令和预期证据，方便审查 agent 独立判断。
- 用户设置执行到第 N 步时，只按 BIGPLAN.md 顺序推进到目标步骤。
- 规划阶段只和用户澄清并维护 BIGPLAN.md，不要宣布交给审查 agent，也不要启动或模拟审查。
- 执行阶段每轮产出完成后，如需审查，只说明“交给审查 agent 审查”，不要自己调用 subagent、Reviewer、reviewer strict 或其它子代理来模拟审查。
- 每轮结束后，把产出、验证证据、风险和后续建议写入 rounds/ 对应记录。
- 如果你意识到自己的执行规则可以改进，只更新本文件，不要修改项目根 AGENTS.md。
- 审查 agent 发现问题后，先修复问题，再等待审查 agent 重新确认。

## 每轮结束格式
每轮结束必须使用以下格式，方便 Kimix 和审查 agent 识别：
1. 当前 Step
2. 本轮完成
3. 变更文件
4. 验证证据
5. 残余风险
6. 下一步状态（继续规划 / 等待用户确认 / 交给审查 agent 审查 / 阻塞）

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

你是 Kimix 长程任务的审查 agent。你和执行 agent 是两个独立真实 session，你的职责是审查每轮执行产出、发现风险，并在通过后生成下一轮执行提示词。

## 审查职责
- 每轮执行完成后，检查是否符合本步骤目标、范围和验收标准。
- 必须引用 BIGPLAN.md 当前 Step 编号、验收标准和执行 agent 提供的实际验证证据；不能仅凭执行 agent 自述放行。
- 发现问题时，必须先反馈给执行 agent 修复，不直接进入下一步。
- 暂时无法自动审查但不阻塞继续的内容，写入 reviews/REVIEW_QUEUE.md，并仍使用“结论：通过”。
- 只有无法安全继续、必须等待用户或外部环境确认时，才使用“结论：待人工审查”；该结论会让 Kimix 暂停长程任务。
- 审查通过后，生成下一步执行 prompt，交给调度器发送给执行 agent。

## 输出结论
每次审查最终正文第一行必须且只能是：
- 结论：通过
- 结论：需修复
- 结论：待人工审查

随后给出：
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
    if (["drafting", "planning", "ready"].includes(parsed.stage ?? "") && parsed.activeAgent === "reviewer") {
      return {
        ...(parsed as LongTaskSummary),
        activeAgent: "executor",
      };
    }
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

function readTextInsideProject(projectPath: string, relativePath: string) {
  const targetPath = path.join(projectPath, relativePath);
  assertInsideProject(projectPath, targetPath);
  return fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf-8") : "";
}

function readStateByTaskId(projectPath: string, taskId: string) {
  const statePath = findLongTaskStatePath(projectPath, taskId);
  if (!statePath) return null;
  assertInsideProject(projectPath, statePath);
  return readStateFile(statePath);
}

export function getLongTaskDetail(projectPath: string, taskId: string): LongTaskDetail {
  const task = listLongTasks(projectPath).find((item) => item.id === taskId);
  if (!task) {
    throw new Error("Long task not found");
  }
  return {
    ...task,
    bigPlanContent: readTextInsideProject(projectPath, task.bigPlanPath),
    reviewQueueContent: readTextInsideProject(projectPath, task.reviewQueuePath),
    rounds: readLongTaskRounds(projectPath, task),
  };
}

function readLongTaskRounds(projectPath: string, task: LongTaskSummary): LongTaskRoundRecord[] {
  const roundsDir = path.join(task.taskDir, "rounds");
  assertInsideProject(projectPath, roundsDir);
  if (!fs.existsSync(roundsDir)) return [];

  return fs.readdirSync(roundsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = entry.name.match(/^step-(\d+)\.md$/i);
      if (!match) return null;
      const filePath = path.join(roundsDir, entry.name);
      assertInsideProject(projectPath, filePath);
      const stat = fs.statSync(filePath);
      return {
        step: Number(match[1]),
        filePath: relativeToProject(projectPath, filePath),
        content: fs.readFileSync(filePath, "utf-8"),
        updatedAt: stat.mtimeMs,
      };
    })
    .filter((round): round is LongTaskRoundRecord => Boolean(round))
    .sort((a, b) => a.step - b.step || a.updatedAt - b.updatedAt);
}

function findLongTaskStatePath(projectPath: string, taskId: string) {
  const root = longTasksRoot(projectPath);
  if (!fs.existsSync(root)) return null;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const statePath = path.join(root, entry.name, STATE_FILE);
    const task = readStateFile(statePath);
    if (task?.id === taskId) return statePath;
  }
  return null;
}

export function updateLongTaskState(
  projectPath: string,
  taskId: string,
  patch: Partial<Pick<LongTaskSummary, "stage" | "activeAgent" | "recovery" | "currentStep" | "targetStep" | "reviewedReviewItems" | "executorSessionId" | "reviewerSessionId">>,
): LongTaskSummary {
  const statePath = findLongTaskStatePath(projectPath, taskId);
  if (!statePath) {
    throw new Error("Long task not found");
  }
  assertInsideProject(projectPath, statePath);
  const current = readStateFile(statePath);
  if (!current) {
    throw new Error("Invalid long task state");
  }
  const updated: LongTaskState = {
    ...(current as LongTaskState),
    ...patch,
    updatedAt: Date.now(),
    schemaVersion: 1,
  };
  fs.writeFileSync(statePath, `${JSON.stringify(updated, null, 2)}\n`, "utf-8");
  return updated;
}

function roundRoleLabel(role: LongTaskAgentRole) {
  return role === "reviewer" ? "审查 agent" : "执行 agent";
}

function roundPhaseLabel(phase: AppendLongTaskRoundRequest["phase"]) {
  const labels: Record<AppendLongTaskRoundRequest["phase"], string> = {
    execution: "执行",
    review: "审查",
    fix: "修复",
    handoff: "接棒",
    complete: "完成",
  };
  return labels[phase];
}

function sanitizeRoundContent(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return "无正文。";
  return trimmed.length > 30000 ? `${trimmed.slice(0, 30000)}\n\n...内容过长，已截断记录。` : trimmed;
}

export function appendLongTaskRound(request: AppendLongTaskRoundRequest): { filePath: string } {
  const task = readStateByTaskId(request.projectPath, request.taskId);
  if (!task) {
    throw new Error("Long task not found");
  }

  const roundsDir = path.join(task.taskDir, "rounds");
  assertInsideProject(request.projectPath, roundsDir);
  ensureDirectory(roundsDir);

  const step = Math.max(0, Math.floor(request.step));
  const filePath = path.join(roundsDir, `step-${String(step).padStart(3, "0")}.md`);
  assertInsideProject(request.projectPath, filePath);

  const exists = fs.existsSync(filePath);
  const header = exists ? "" : `# Step ${step}\n\n任务：${task.title}\n\n`;
  const conclusion = request.conclusion ? `- 结论：${request.conclusion}\n` : "";
  const entry = `## ${new Date().toISOString()} · ${roundPhaseLabel(request.phase)} · ${roundRoleLabel(request.role)}

- 阶段：${request.phase}
- 角色：${request.role}
${conclusion}### 记录
${sanitizeRoundContent(request.content)}

`;
  fs.appendFileSync(filePath, `${header}${entry}`, "utf-8");
  return { filePath: relativeToProject(request.projectPath, filePath) };
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
    reviewedReviewItems: [],
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
