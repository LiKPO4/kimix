import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const TOWER_STATE_RELATIVE_PATH = path.join(".tower", "comms", "state.json");
const TOWER_ACTIVITY_RELATIVE_PATH = path.join(".tower", "comms", "log", "activity.log");
const MAX_ACTIVITY_BYTES = 512 * 1024;
const OPEN_MISSION_STATUSES = new Set(["planned", "active", "completed", "blocked", "paused"]);

const TowerMissionSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  slug: z.string(),
  kind: z.enum(["build", "survey"]).default("build"),
  scope: z.array(z.string()),
  branch: z.string(),
  worktree: z.string(),
  deps: z.array(z.string()),
  status: z.enum(["planned", "active", "completed", "blocked", "paused", "merged", "abandoned"]),
  owner: z.string().optional(),
  tasks: z.array(z.object({ text: z.string(), done: z.boolean() })),
  notes: z.array(z.string()),
  blockers: z.array(z.string()),
});

const TowerStateSchema = z.object({
  // version 为唯一可演进边界。未知版本一律拒绝读取，避免把未来协议误展示成安全状态。
  version: z.literal(1),
  base: z.string().min(1),
  mode: z.enum(["branch", "pr"]),
  createdAt: z.string(),
  sessionId: z.string().min(1).optional(),
  roster: z.object({
    agents: z.array(z.object({
      name: z.string().min(1),
      agentId: z.string().min(1),
      sessionId: z.string().min(1).optional(),
      kind: z.enum(["worker", "reviewer"]),
      missionId: z.string().min(1).optional(),
      reviewTarget: z.string().min(1).optional(),
      worktree: z.string().min(1).optional(),
      branch: z.string().min(1).optional(),
      spawnedAt: z.string(),
    })),
  }),
  missions: z.array(TowerMissionSchema),
});

export type TowerWorkspaceSnapshot = z.infer<typeof TowerStateSchema> & {
  repoRoot: string;
  activity: string[];
  ownership: {
    ownerSessionId?: string;
    ownedByCurrentSession: boolean;
    openMissionIds: string[];
  };
};

export type TowerWorkspacePreflight = {
  workDir: string;
  repoRoot?: string;
  isGitRepo: boolean;
  hasCommit: boolean;
  branch?: string;
  detached: boolean;
  dirty: boolean;
  warnings: string[];
  state: {
    exists: boolean;
    valid: boolean;
    ownerSessionId?: string;
    openMissionIds: string[];
    error?: string;
  };
  canEnable: boolean;
};

function execGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, windowsHide: true, timeout: 8_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message).trim()));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function resolveContainedPath(root: string, relativePath: string, options: { mustExist?: boolean } = {}): Promise<string> {
  const realRoot = await fs.realpath(root);
  const target = path.resolve(realRoot, relativePath);
  const relative = path.relative(realRoot, target);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Tower 路径越出工作区，已拒绝读取。");
  }
  if (options.mustExist) {
    // `.tower` 可被错误地替换成链接；对实际读取目标再次 realpath，拒绝任何越界链接。
    const realTarget = await fs.realpath(target);
    const resolvedRelative = path.relative(realRoot, realTarget);
    if (resolvedRelative.startsWith(`..${path.sep}`) || path.isAbsolute(resolvedRelative)) {
      throw new Error("Tower 文件链接到工作区外，已拒绝读取。");
    }
    return realTarget;
  }
  return target;
}

async function readTowerState(repoRoot: string) {
  const statePath = await resolveContainedPath(repoRoot, TOWER_STATE_RELATIVE_PATH, { mustExist: true });
  const raw = await fs.readFile(statePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Tower state.json 不是有效 JSON，已拒绝读取。");
  }
  const result = TowerStateSchema.safeParse(parsed);
  if (!result.success) {
    const version = parsed && typeof parsed === "object" ? (parsed as { version?: unknown }).version : undefined;
    if (version !== 1) throw new Error("Tower state.json 版本未知，已拒绝读取。");
    throw new Error(`Tower state.json 结构无效：${result.error.issues[0]?.message ?? "未知错误"}`);
  }
  return result.data;
}

function openMissionIds(state: z.infer<typeof TowerStateSchema>): string[] {
  return state.missions.filter((mission) => OPEN_MISSION_STATUSES.has(mission.status)).map((mission) => mission.id);
}

async function readActivityTail(repoRoot: string): Promise<string[]> {
  let activityPath: string;
  try {
    activityPath = await resolveContainedPath(repoRoot, TOWER_ACTIVITY_RELATIVE_PATH, { mustExist: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(activityPath, "r");
    const stat = await handle.stat();
    const length = Math.min(stat.size, MAX_ACTIVITY_BYTES);
    if (length === 0) return [];
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stat.size - length);
    const lines = buffer.toString("utf8").split(/\r?\n/);
    // 从中间截取时，首行可能是不完整记录。
    if (stat.size > length) lines.shift();
    return lines.filter(Boolean).slice(-100);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  } finally {
    await handle?.close();
  }
}

export async function preflightTowerWorkspace(workDir: string): Promise<TowerWorkspacePreflight> {
  const resolvedWorkDir = path.resolve(workDir);
  const result: TowerWorkspacePreflight = {
    workDir: resolvedWorkDir,
    isGitRepo: false,
    hasCommit: false,
    detached: false,
    dirty: false,
    warnings: [],
    state: { exists: false, valid: false, openMissionIds: [] },
    canEnable: false,
  };
  let repoRoot: string;
  try {
    repoRoot = await execGit(resolvedWorkDir, ["rev-parse", "--show-toplevel"]);
  } catch {
    result.warnings.push("当前工作目录不是 Git 仓库，不能启用 Tower。");
    return result;
  }
  result.repoRoot = path.resolve(repoRoot);
  result.isGitRepo = true;
  try {
    await execGit(result.repoRoot, ["rev-parse", "--verify", "HEAD"]);
    result.hasCommit = true;
  } catch {
    result.warnings.push("仓库尚无提交，请先创建初始提交后再启用 Tower。");
  }
  const branch = result.hasCommit
    ? await execGit(result.repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])
    : "HEAD";
  result.branch = branch;
  result.detached = branch === "HEAD";
  if (result.detached) result.warnings.push("当前处于 detached HEAD，Tower 需要明确的本地基准分支。");
  const porcelain = await execGit(result.repoRoot, ["status", "--porcelain"]);
  result.dirty = porcelain.length > 0;
  if (result.dirty) result.warnings.push("工作区存在未提交修改；Tower 可以启用，但 teardown 会保留脏 worktree。");

  try {
    await resolveContainedPath(result.repoRoot, TOWER_STATE_RELATIVE_PATH, { mustExist: true });
    result.state.exists = true;
    const state = await readTowerState(result.repoRoot);
    result.state.valid = true;
    result.state.ownerSessionId = state.sessionId;
    result.state.openMissionIds = openMissionIds(state);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      result.state.exists = false;
    } else {
      // 路径存在但链接或协议无效时，绝不能退化成“未初始化、可新建”。
      result.state.exists = true;
      result.state.error = error instanceof Error ? error.message : String(error);
      result.warnings.push(result.state.error);
    }
  }
  result.canEnable = result.isGitRepo && result.hasCommit && !result.detached && (!result.state.exists || result.state.valid);
  return result;
}

export async function getTowerWorkspaceSnapshot(workDir: string, sessionId: string): Promise<TowerWorkspaceSnapshot> {
  const preflight = await preflightTowerWorkspace(workDir);
  if (!preflight.isGitRepo || !preflight.repoRoot) throw new Error("当前工作目录不是 Git 仓库，无法读取 Tower 状态。");
  if (!preflight.state.exists) throw new Error("当前仓库尚未初始化 Tower。");
  if (!preflight.state.valid) throw new Error(preflight.state.error ?? "Tower 状态无效，已拒绝读取。");
  const state = await readTowerState(preflight.repoRoot);
  const missions = openMissionIds(state);
  return {
    ...state,
    repoRoot: preflight.repoRoot,
    activity: await readActivityTail(preflight.repoRoot),
    ownership: {
      ownerSessionId: state.sessionId,
      ownedByCurrentSession: state.sessionId === sessionId,
      openMissionIds: missions,
    },
  };
}

// 官方 TUI 使用的同一指令；其调用 TowerTeardown 时不传 force，因此保留官方脏 worktree 保护。
export const TOWER_TEARDOWN_INSTRUCTION =
  "Tear down the tower: call TowerTeardown with an empty argument object and report what it did. Keep the official dirty-worktree protection enabled.";
