import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Project } from "./types/ipc";

const execAsync = promisify(exec);

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
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeProjects(projects: Project[]) {
  ensureDataDir();
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
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
