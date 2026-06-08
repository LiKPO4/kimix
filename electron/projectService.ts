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
    const valid = parsed.filter(
      (p): p is Project =>
        p && typeof p === "object" &&
        typeof p.id === "string" &&
        typeof p.path === "string" &&
        typeof p.name === "string"
    );
    return sortProjects(valid.map(normalizeProject));
  } catch {
    return [];
  }
}

export function getProjectDisplayName(projectPath: string): string {
  const resolved = path.resolve(projectPath);
  const baseName = path.basename(resolved).trim();
  if (baseName) return baseName;
  const rootName = path.parse(resolved).root.trim();
  return rootName || projectPath.trim() || "未命名项目";
}

function normalizeProject(project: Project, index = 0): Project {
  return {
    ...project,
    name: project.name.trim() || getProjectDisplayName(project.path),
    pinned: project.pinned === true,
    sortOrder: typeof project.sortOrder === "number" ? project.sortOrder : index,
  };
}

/** Sort: pinned first, then by explicit sortOrder ascending (falls back to insertion order). */
function sortProjects(projects: Project[]): Project[] {
  return projects
    .map((p, index) => ({ p, index }))
    .sort((a, b) => {
      const aPinned = a.p.pinned ? 0 : 1;
      const bPinned = b.p.pinned ? 0 : 1;
      if (aPinned !== bPinned) return aPinned - bPinned;
      const aOrder = typeof a.p.sortOrder === "number" ? a.p.sortOrder : a.index;
      const bOrder = typeof b.p.sortOrder === "number" ? b.p.sortOrder : b.index;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.index - b.index;
    })
    .map(({ p }) => p);
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
  const prior = existing.find((p) => p.path === project.path);
  const filtered = existing.filter((p) => p.path !== project.path);
  if (prior) {
    // Re-opening a known project: keep its place, pin state and sort order — don't
    // yank it to the top. Only refresh metadata (name, lastOpenedAt, gitBranch).
    const merged = normalizeProject({
      ...prior,
      ...project,
      pinned: prior.pinned,
      sortOrder: prior.sortOrder,
    });
    writeProjects(sortProjects([...filtered, merged]).slice(0, 20));
    return;
  }
  // Brand-new project: append after existing ones (new sortOrder at the end of its region).
  const maxOrder = existing.reduce((max, p) => Math.max(max, p.sortOrder ?? 0), -1);
  const added = normalizeProject({ ...project, pinned: project.pinned === true, sortOrder: maxOrder + 1 });
  writeProjects(sortProjects([...filtered, added]).slice(0, 20));
}

export function removeRecentProject(id: string): void {
  const existing = readProjects();
  writeProjects(existing.filter((p) => p.id !== id));
}

export function setProjectPinned(id: string, pinned: boolean): Project[] {
  const existing = readProjects();
  const updated = existing.map((p) => (p.id === id ? { ...p, pinned } : p));
  const sorted = sortProjects(updated);
  writeProjects(sorted);
  return sorted;
}

/** Persist an explicit ordering by assigning sortOrder from the given id sequence. */
export function reorderProjects(orderedIds: string[]): Project[] {
  const existing = readProjects();
  const orderIndex = new Map(orderedIds.map((id, index) => [id, index]));
  const updated = existing.map((p) => {
    const idx = orderIndex.get(p.id);
    return idx === undefined ? p : { ...p, sortOrder: idx };
  });
  const sorted = sortProjects(updated);
  writeProjects(sorted);
  return sorted;
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
    const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-uall"], {
      cwd: projectPath,
      encoding: "utf-8",
      timeout: 5000,
    });
    return stdout.replace(/(?:\r?\n)+$/, "");
  } catch {
    return "";
  }
}

async function requireGitRoot(projectPath: string): Promise<string> {
  const gitRoot = await findGitRoot(projectPath);
  if (!gitRoot) throw new Error("当前项目不是 Git 仓库");
  return gitRoot;
}

async function runGit(gitRoot: string, args: string[], timeout = 30000): Promise<string> {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd: gitRoot,
    encoding: "utf-8",
    timeout,
    maxBuffer: 16 * 1024 * 1024,
  });
  return [stdout, stderr].filter(Boolean).join("\n").trim();
}

const MAX_GIT_DETAIL_FILES = 300;

type GitRemoteState = {
  upstream?: string;
  remoteName?: string;
  remoteUrl?: string;
  ahead?: number;
  behind?: number;
};

async function getGitRemoteInfo(gitRoot: string): Promise<Pick<GitRemoteState, "remoteName" | "remoteUrl">> {
  try {
    const output = await runGit(gitRoot, ["remote", "-v"], 5000);
    const rows = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
        return match ? { name: match[1], url: match[2], kind: match[3] } : null;
      })
      .filter((row): row is { name: string; url: string; kind: string } => row !== null);
    const preferred = rows.find((row) => row.name === "origin" && row.kind === "push")
      ?? rows.find((row) => row.name === "origin")
      ?? rows.find((row) => row.kind === "push")
      ?? rows[0];
    return preferred ? { remoteName: preferred.name, remoteUrl: preferred.url } : {};
  } catch {
    return {};
  }
}

async function getGitRemoteState(gitRoot: string): Promise<GitRemoteState> {
  const remoteInfo = await getGitRemoteInfo(gitRoot);
  try {
    const upstream = await runGit(gitRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], 5000);
    const counts = await runGit(gitRoot, ["rev-list", "--left-right", "--count", "HEAD...@{u}"], 10000);
    const [aheadRaw, behindRaw] = counts.split(/\s+/);
    const ahead = Number.parseInt(aheadRaw ?? "0", 10);
    const behind = Number.parseInt(behindRaw ?? "0", 10);
    return {
      ...remoteInfo,
      upstream: upstream || undefined,
      ahead: Number.isFinite(ahead) ? ahead : 0,
      behind: Number.isFinite(behind) ? behind : 0,
    };
  } catch {
    return { ...remoteInfo, ahead: 0, behind: 0 };
  }
}

export async function getGitSnapshot(projectPath: string, options?: { includeRemote?: boolean }): Promise<{ branch?: string; status: string; gitRoot?: string } & GitRemoteState> {
  const gitRoot = await findGitRoot(projectPath);
  if (!gitRoot) return { branch: undefined, status: "" };
  const [branch, status] = await Promise.all([
    getGitBranch(gitRoot),
    getGitStatus(gitRoot),
  ]);
  const remote = options?.includeRemote ? await getGitRemoteState(gitRoot) : {};
  return { branch, status, gitRoot, ...remote };
}

function normalizeGitPath(gitRoot: string, filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const absolutePath = path.resolve(gitRoot, normalized);
  const relativePath = path.relative(gitRoot, absolutePath).replace(/\\/g, "/");
  if (!relativePath || relativePath.startsWith("../") || path.isAbsolute(relativePath)) {
    throw new Error(`文件不在 Git 仓库内：${filePath}`);
  }
  return relativePath;
}

function normalizeGitStatusPath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^"|"$/g, "");
}

function stripLeadingGitRootName(gitRoot: string, value: string) {
  const normalized = normalizeGitStatusPath(value);
  const rootName = path.basename(gitRoot).replace(/\\/g, "/");
  return rootName && normalized.toLowerCase().startsWith(`${rootName.toLowerCase()}/`)
    ? normalized.slice(rootName.length + 1)
    : normalized;
}

function stripFirstGitPathSegment(value: string) {
  const normalized = normalizeGitStatusPath(value);
  const index = normalized.indexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1);
}

function formatGitPathError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/pathspec .* did not match any files/i.test(message)) {
    return "Git 无法找到该路径，可能文件已移动或状态已过期，请刷新 Git 状态后重试";
  }
  const firstUsefulLine = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("Command failed:") && !line.startsWith("git "));
  return firstUsefulLine ?? "暂存失败，请刷新 Git 状态后重试";
}

function resolveSelectedGitStatusPath(gitRoot: string, selectedPath: string, statusFiles: GitStatusFile[]): GitStatusFile | null {
  const normalized = normalizeGitStatusPath(selectedPath);
  const strippedRootName = stripLeadingGitRootName(gitRoot, normalized);
  const withoutFirstSegment = stripFirstGitPathSegment(strippedRootName);
  const exact = statusFiles.find((file) => file.path === normalized || file.path === strippedRootName);
  if (exact) return exact;
  const sameInnerPathMatches = statusFiles.filter((file) => stripFirstGitPathSegment(file.path) === withoutFirstSegment);
  if (sameInnerPathMatches.length === 1) return sameInnerPathMatches[0];
  const suffixMatches = statusFiles.filter((file) => (
    file.path.endsWith(normalized) ||
    normalized.endsWith(file.path) ||
    file.path.endsWith(strippedRootName) ||
    strippedRootName.endsWith(file.path)
  ));
  return suffixMatches.length === 1 ? suffixMatches[0] : null;
}

async function stageGitFiles(gitRoot: string, selectedFiles: string[]): Promise<{ stagedFiles: string[]; skippedFiles: string[] }> {
  const statusFiles = parseGitStatus(await getGitStatus(gitRoot));
  const stagedFiles: string[] = [];
  const skippedFiles: string[] = [];
  const uniqueFiles = Array.from(new Set(selectedFiles));
  for (const selectedFile of uniqueFiles) {
    const statusFile = resolveSelectedGitStatusPath(gitRoot, selectedFile, statusFiles);
    if (!statusFile) {
      skippedFiles.push(`${selectedFile}：当前 Git 状态中未找到`);
      continue;
    }
    const normalizedPath = normalizeGitPath(gitRoot, statusFile.path);
    try {
      await runGit(gitRoot, ["add", "--", normalizedPath], 30000);
      stagedFiles.push(normalizedPath);
    } catch (error) {
      skippedFiles.push(`${normalizedPath}：${formatGitPathError(error)}`);
    }
  }
  return { stagedFiles, skippedFiles };
}

export async function commitGitChanges(projectPath: string, message: string, files?: string[]): Promise<{ branch?: string; status: string; output: string } & GitRemoteState> {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) throw new Error("请输入提交说明");
  const gitRoot = await requireGitRoot(projectPath);
  const beforeStatus = await getGitStatus(gitRoot);
  if (!beforeStatus.trim()) throw new Error("当前没有可提交的改动");
  const selectedFiles = files?.map((file) => normalizeGitStatusPath(file));
  if (selectedFiles && selectedFiles.length === 0) throw new Error("请选择要提交的文件");
  const stageResult = selectedFiles ? await stageGitFiles(gitRoot, selectedFiles) : { stagedFiles: [], skippedFiles: [] };
  if (selectedFiles && stageResult.stagedFiles.length === 0) {
    const reason = stageResult.skippedFiles.length > 0 ? `：${stageResult.skippedFiles.join("；")}` : "";
    throw new Error(`所选文件都无法暂存${reason}`);
  }
  if (!selectedFiles) await runGit(gitRoot, ["add", "-A"], 30000);
  const staged = await runGit(gitRoot, ["diff", "--cached", "--name-only"], 10000);
  if (!staged.trim()) throw new Error("当前没有已暂存的改动");
  const output = await runGit(gitRoot, selectedFiles ? ["commit", "-m", trimmedMessage, "--", ...stageResult.stagedFiles] : ["commit", "-m", trimmedMessage], 60000);
  const snapshot = await getGitSnapshot(gitRoot, { includeRemote: true });
  const skippedOutput = stageResult.skippedFiles.length > 0 ? `\nSkipped files:\n${stageResult.skippedFiles.join("\n")}` : "";
  return { branch: snapshot.branch, status: snapshot.status, upstream: snapshot.upstream, remoteName: snapshot.remoteName, remoteUrl: snapshot.remoteUrl, ahead: snapshot.ahead, behind: snapshot.behind, output: `${output}${skippedOutput}` };
}

export async function pullGit(projectPath: string): Promise<{ branch?: string; status: string; output: string } & GitRemoteState> {
  const gitRoot = await requireGitRoot(projectPath);
  const status = await getGitStatus(gitRoot);
  if (status.trim()) throw new Error("工作区有未提交改动，请先提交或处理后再拉取");
  const output = await runGit(gitRoot, ["pull", "--ff-only"], 120000);
  const snapshot = await getGitSnapshot(gitRoot, { includeRemote: true });
  return { branch: snapshot.branch, status: snapshot.status, upstream: snapshot.upstream, remoteName: snapshot.remoteName, remoteUrl: snapshot.remoteUrl, ahead: snapshot.ahead, behind: snapshot.behind, output };
}

export async function pushGit(projectPath: string): Promise<{ branch?: string; status: string; output: string } & GitRemoteState> {
  const gitRoot = await requireGitRoot(projectPath);
  const snapshotBefore = await getGitSnapshot(gitRoot, { includeRemote: true });
  if (!snapshotBefore.upstream && !snapshotBefore.remoteName) {
    throw new Error("当前仓库未配置 Git 远端，请先添加 origin");
  }
  if (!snapshotBefore.upstream && !snapshotBefore.branch) {
    throw new Error("当前分支名不可用，无法设置远端跟踪分支");
  }
  const output = snapshotBefore.upstream
    ? await runGit(gitRoot, ["push"], 120000)
    : await runGit(gitRoot, ["push", "-u", snapshotBefore.remoteName as string, snapshotBefore.branch as string], 120000);
  const snapshot = await getGitSnapshot(gitRoot, { includeRemote: true });
  return { branch: snapshot.branch, status: snapshot.status, upstream: snapshot.upstream, remoteName: snapshot.remoteName, remoteUrl: snapshot.remoteUrl, ahead: snapshot.ahead, behind: snapshot.behind, output };
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
      const rawPath = line[2] === " " ? line.slice(3).trim() : line.slice(2).trim();
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
  const collect = (stdout: string) => {
    stdout.split(/\r?\n/).filter(Boolean).forEach((line) => {
      const parts = line.split(/\t/);
      const additions = Number.parseInt(parts[0] ?? "0", 10);
      const deletions = Number.parseInt(parts[1] ?? "0", 10);
      const file = parts.slice(2).join("\t");
      if (!file) return;
      const current = stats[file] ?? { additions: 0, deletions: 0 };
      stats[file] = {
        additions: current.additions + (Number.isFinite(additions) ? additions : 0),
        deletions: current.deletions + (Number.isFinite(deletions) ? deletions : 0),
      };
    });
  };
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--numstat", "--", ...files], {
      cwd: projectPath,
      encoding: "utf-8",
      timeout: 5000,
    });
    collect(stdout);
    const { stdout: cachedStdout } = await execFileAsync("git", ["diff", "--cached", "--numstat", "--", ...files], {
      cwd: projectPath,
      encoding: "utf-8",
      timeout: 5000,
    });
    collect(cachedStdout);
  } catch {
    // Binary files or non-git projects can fail; callers still get file names.
  }
  return stats;
}

export async function getGitDetails(projectPath: string): Promise<{ branch?: string; status: string; gitRoot?: string; files: Array<GitStatusFile & { additions?: number; deletions?: number }>; totalFileCount?: number; truncated?: boolean } & GitRemoteState> {
  const snapshot = await getGitSnapshot(projectPath, { includeRemote: true });
  if (!snapshot.gitRoot) return { ...snapshot, files: [], totalFileCount: 0, truncated: false };
  const allFiles = parseGitStatus(snapshot.status);
  const files = allFiles.slice(0, MAX_GIT_DETAIL_FILES);
  const stats = await getGitLineStats(snapshot.gitRoot, files.map((file) => file.path));
  return {
    ...snapshot,
    totalFileCount: allFiles.length,
    truncated: allFiles.length > files.length,
    files: files.map((file) => ({
      ...file,
      additions: stats[file.path]?.additions ?? 0,
      deletions: stats[file.path]?.deletions ?? 0,
    })),
  };
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
