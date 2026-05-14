import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Project } from "./types/ipc";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const DATA_DIR = path.join(os.homedir(), ".kimix");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readProjects(): Project[] {
  ensureDataDir();
  if (!fs.existsSync(PROJECTS_FILE)) return [];
  try {
    const data = fs.readFileSync(PROJECTS_FILE, "utf-8");
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is Project =>
        p && typeof p === "object" &&
        typeof p.id === "string" &&
        typeof p.path === "string" &&
        typeof p.name === "string"
    );
  } catch {
    return [];
  }
}

function writeProjects(projects: Project[]) {
  ensureDataDir();
  try {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
  } catch (err) {
    console.error("Failed to write projects file:", err);
    throw err;
  }
}

export function getRecentProjects(): Project[] {
  return readProjects();
}

export function addRecentProject(project: Project): void {
  const existing = readProjects();
  const filtered = existing.filter((p) => p.path !== project.path);
  const updated = [project, ...filtered].slice(0, 20);
  writeProjects(updated);
}

export function removeRecentProject(id: string): void {
  const existing = readProjects();
  writeProjects(existing.filter((p) => p.id !== id));
}

export async function getGitBranch(projectPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", {
      cwd: projectPath,
      encoding: "utf-8",
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

export async function getGitStatus(projectPath: string): Promise<string> {
  try {
    const { stdout } = await execAsync("git status --short", {
      cwd: projectPath,
      encoding: "utf-8",
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

export type GitStatusFile = {
  path: string;
  status: string;
};

export type RevertFileTarget = {
  path: string;
  additions?: number;
  deletions?: number;
};

export function parseGitStatus(status: string): GitStatusFile[] {
  return status
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const rawPath = line.slice(3).trim();
      const pathPart = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() ?? rawPath : rawPath;
      return {
        status: line.slice(0, 2).trim(),
        path: pathPart.replace(/^"|"$/g, ""),
      };
    })
    .filter((item) => item.path.length > 0);
}

export async function getGitStatusFiles(projectPath: string): Promise<GitStatusFile[]> {
  return parseGitStatus(await getGitStatus(projectPath));
}

export async function getGitLineStats(projectPath: string, files: string[]): Promise<Record<string, { additions: number; deletions: number }>> {
  const stats: Record<string, { additions: number; deletions: number }> = {};
  if (files.length === 0) return stats;
  try {
    const { stdout } = await execAsync("git diff --numstat -- " + files.map((file) => `"${file.replace(/"/g, '\\"')}"`).join(" "), {
      cwd: projectPath,
      encoding: "utf-8",
      timeout: 5000,
    });
    stdout.split(/\r?\n/).filter(Boolean).forEach((line) => {
      const parts = line.split(/\t/);
      const additions = Number.parseInt(parts[0] ?? "0", 10);
      const deletions = Number.parseInt(parts[1] ?? "0", 10);
      const file = parts.slice(2).join("\t");
      if (!file) return;
      stats[file] = {
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
      };
    });
  } catch {
    // Binary files or non-git projects can fail; callers still get file names.
  }
  return stats;
}

async function findGitRoot(startPath: string): Promise<string | null> {
  const cwd = fs.existsSync(startPath) && fs.statSync(startPath).isDirectory()
    ? startPath
    : path.dirname(startPath);
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
    });
    return path.resolve(stdout.trim());
  } catch {
    return null;
  }
}

function resolveRevertTarget(projectPath: string, target: RevertFileTarget) {
  const absolutePath = path.isAbsolute(target.path)
    ? path.resolve(target.path)
    : path.resolve(projectPath, target.path);
  return { ...target, absolutePath };
}

function isInsideLongTaskGeneratedArea(projectPath: string, absolutePath: string) {
  const relative = path.relative(path.resolve(projectPath), absolutePath).replace(/\\/g, "/");
  return !relative.startsWith("../") && !path.isAbsolute(relative) && relative.startsWith(".kimix-long-tasks/");
}

async function revertGitGroup(gitRoot: string, targets: Array<RevertFileTarget & { absolutePath: string }>) {
  const trackedPaths: string[] = [];
  for (const target of targets) {
    const relativePath = path.relative(gitRoot, target.absolutePath);
    const { stdout } = await execFileAsync("git", ["status", "--porcelain", "--", relativePath], {
      cwd: gitRoot,
      encoding: "utf-8",
      timeout: 5000,
    });
    if (stdout.trimStart().startsWith("??")) {
      if (fs.existsSync(target.absolutePath)) {
        fs.rmSync(target.absolutePath, { force: true, recursive: true });
      }
      continue;
    }
    trackedPaths.push(relativePath);
  }
  if (trackedPaths.length > 0) {
    await execFileAsync("git", ["checkout", "--", ...trackedPaths], {
      cwd: gitRoot,
      encoding: "utf-8",
      timeout: 10000,
    });
  }
}

function revertNonGitGeneratedFile(projectPath: string, target: RevertFileTarget & { absolutePath: string }) {
  const additions = target.additions ?? 0;
  const deletions = target.deletions ?? 0;
  if (!isInsideLongTaskGeneratedArea(projectPath, target.absolutePath)) {
    throw new Error("当前项目不是 Git 仓库，无法安全撤销普通文件修改");
  }
  if (additions === 0 && deletions === 0) return;
  if (additions > 0 && deletions === 0) {
    if (fs.existsSync(target.absolutePath)) {
      fs.rmSync(target.absolutePath, { force: true, recursive: true });
    }
    return;
  }
  throw new Error("当前项目不是 Git 仓库，无法恢复已有文件的旧内容");
}

export async function revertGitFiles(projectPath: string, targets: RevertFileTarget[]): Promise<void> {
  if (targets.length === 0) return;
  const resolvedTargets = targets.map((target) => resolveRevertTarget(projectPath, target));
  const gitGroups = new Map<string, Array<RevertFileTarget & { absolutePath: string }>>();
  const nonGitTargets: Array<RevertFileTarget & { absolutePath: string }> = [];

  for (const target of resolvedTargets) {
    const gitRoot = await findGitRoot(target.absolutePath);
    if (!gitRoot) {
      nonGitTargets.push(target);
      continue;
    }
    const group = gitGroups.get(gitRoot) ?? [];
    group.push(target);
    gitGroups.set(gitRoot, group);
  }

  for (const [gitRoot, group] of gitGroups) {
    await revertGitGroup(gitRoot, group);
  }
  for (const target of nonGitTargets) {
    revertNonGitGeneratedFile(projectPath, target);
  }
}
