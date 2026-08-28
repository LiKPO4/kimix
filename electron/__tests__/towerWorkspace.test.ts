import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getTowerWorkspaceSnapshot,
  preflightTowerWorkspace,
  TOWER_TEARDOWN_INSTRUCTION,
} from "../towerWorkspace";

const tempDirs: string[] = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-tower-workspace-"));
  tempDirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

function initializedRepo() {
  const dir = tempDir();
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "tower-test@kimix.local"]);
  git(dir, ["config", "user.name", "Kimix Tower Test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "tower\n", "utf8");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-m", "initial"]);
  return dir;
}

function writeTowerState(repoRoot: string, value: unknown) {
  const statePath = path.join(repoRoot, ".tower", "comms", "state.json");
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(value), "utf8");
}

function validTowerState(owner = "session-owner") {
  return {
    version: 1,
    base: "main",
    mode: "branch",
    createdAt: "2026-08-28T00:00:00.000Z",
    sessionId: owner,
    roster: {
      agents: [{
        name: "worker-a", agentId: "agent-a", sessionId: owner, kind: "worker",
        missionId: "M1", worktree: ".tower/worktrees/M1", branch: "tower/M1", spawnedAt: "2026-08-28T00:00:00.000Z",
      }],
    },
    missions: [{
      id: "M1", title: "实现预检", slug: "preflight", kind: "build", scope: ["electron/**"],
      branch: "tower/M1", worktree: ".tower/worktrees/M1", deps: [], status: "active", owner: "worker-a",
      tasks: [{ text: "实现", done: false }], notes: [], blockers: [],
    }],
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("Tower 工作区只读协议", () => {
  it("拒绝非 Git 工作目录", async () => {
    const result = await preflightTowerWorkspace(tempDir());
    expect(result.isGitRepo).toBe(false);
    expect(result.canEnable).toBe(false);
  });

  it("识别初始提交、脏工作区和未初始化 Tower", async () => {
    const repo = initializedRepo();
    fs.writeFileSync(path.join(repo, "dirty.txt"), "dirty", "utf8");
    const result = await preflightTowerWorkspace(repo);
    expect(result.hasCommit).toBe(true);
    expect(result.dirty).toBe(true);
    expect(result.state).toMatchObject({ exists: false, valid: false, openMissionIds: [] });
    expect(result.canEnable).toBe(true);
  });

  it("损坏或未知版本的 state.json 均 fail closed", async () => {
    const repo = initializedRepo();
    writeTowerState(repo, { version: 2 });
    const unknownVersion = await preflightTowerWorkspace(repo);
    expect(unknownVersion.state.valid).toBe(false);
    expect(unknownVersion.canEnable).toBe(false);
    expect(unknownVersion.state.error).toContain("版本未知");

    writeTowerState(repo, "not-json");
    const malformed = await preflightTowerWorkspace(repo);
    expect(malformed.state.valid).toBe(false);
    expect(malformed.canEnable).toBe(false);
  });

  it("读取 v1 mission、owner、open missions 和最近 100 行活动", async () => {
    const repo = initializedRepo();
    writeTowerState(repo, validTowerState());
    const logPath = path.join(repo, ".tower", "comms", "log", "activity.log");
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, Array.from({ length: 105 }, (_, index) => `activity-${index + 1}`).join("\n"), "utf8");

    const snapshot = await getTowerWorkspaceSnapshot(repo, "session-owner");
    expect(snapshot.ownership).toEqual({
      ownerSessionId: "session-owner",
      ownedByCurrentSession: true,
      openMissionIds: ["M1"],
    });
    expect(snapshot.activity).toHaveLength(100);
    expect(snapshot.activity[0]).toBe("activity-6");
    expect(snapshot.missions[0]?.status).toBe("active");
  });

  it("拒绝链接到仓库外的 Tower 状态文件", async () => {
    const repo = initializedRepo();
    const outside = tempDir();
    const outsideTower = path.join(outside, "tower-state");
    fs.mkdirSync(path.join(outsideTower, "comms"), { recursive: true });
    fs.writeFileSync(path.join(outsideTower, "comms", "state.json"), JSON.stringify(validTowerState()), "utf8");
    try {
      fs.symlinkSync(outsideTower, path.join(repo, ".tower"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      // 部分 Windows CI 禁止创建链接；生产代码仍对 realpath 后的链接路径执行校验。
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    const result = await preflightTowerWorkspace(repo);
    expect(result.state.valid).toBe(false);
    expect(result.canEnable).toBe(false);
    expect(result.state.error).toContain("工作区外");
  });

  it("固定 teardown 指令只允许空参数调用", () => {
    expect(TOWER_TEARDOWN_INSTRUCTION).toContain("empty argument object");
    expect(TOWER_TEARDOWN_INSTRUCTION).not.toMatch(/force\s*[:=]/i);
  });
});
