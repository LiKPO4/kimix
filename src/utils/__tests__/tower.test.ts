import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeTowerPreflight, normalizeTowerSnapshot, towerStatusLabel } from "../tower";

describe("Tower renderer projection", () => {
  it("maps the official preflight result without treating a dirty worktree as a hard block", () => {
    expect(normalizeTowerPreflight({
      workDir: "D:/repo",
      isGitRepo: true,
      hasCommit: true,
      branch: "master",
      detached: false,
      dirty: true,
      warnings: ["working tree dirty"],
      state: { exists: true, valid: true, ownerSessionId: "session-a", openMissionIds: ["m1", "m2"] },
      canEnable: true,
    })).toMatchObject({
      allowed: true,
      dirty: true,
      base: "master",
      towerExists: true,
      openMissions: 2,
      owner: "session-a",
    });
  });

  it("projects missions, roster and string activity into dense inspector rows", () => {
    const snapshot = normalizeTowerSnapshot({
      version: 1,
      repoRoot: "D:/repo",
      base: "master",
      mode: "branch",
      createdAt: "2026-08-28T00:00:00Z",
      roster: { agents: [{ name: "worker-1", agentId: "a1", sessionId: "session-worker-1", kind: "worker", missionId: "m1", branch: "tower/m1", spawnedAt: "2026-08-28T00:00:00Z" }] },
      missions: [{ id: "m1", title: "设置页", slug: "settings", kind: "build", scope: ["src"], branch: "tower/m1", worktree: "D:/repo/.tower/m1", deps: [], status: "completed", tasks: [{ text: "实现", done: true }, { text: "测试", done: false }], notes: [], blockers: [] }, { id: "m2", title: "合并设置", slug: "merge-settings", kind: "build", scope: ["src"], branch: "tower/m2", worktree: "D:/repo/.tower/m2", deps: ["m1"], status: "merged", tasks: [], notes: [], blockers: [] }],
      activity: ["worker-1 started"],
      ownership: { ownerSessionId: "session-a", ownedByCurrentSession: true, openMissionIds: ["m1"] },
    });
    expect(snapshot).toMatchObject({ base: "master", owner: "session-a", totalCount: 2, mergedCount: 1, blockedCount: 0 });
    expect(snapshot.missions[0]).toMatchObject({ id: "m1", completedTasks: 1, totalTasks: 2 });
    expect(snapshot.agents[0]).toMatchObject({
      id: "a1",
      sessionId: "session-worker-1",
      mission: "m1",
      branch: "tower/m1",
      status: "completed",
      spawnedAt: "2026-08-28T00:00:00Z",
    });
    expect(snapshot.activity[0]?.message).toBe("worker-1 started");
  });

  it("keeps user-facing status labels stable", () => {
    expect(towerStatusLabel("active")).toBe("运行中");
    expect(towerStatusLabel("blocked")).toBe("受阻");
    expect(towerStatusLabel("completed")).toBe("已完成");
    expect(towerStatusLabel("merged")).toBe("已合并");
    expect(towerStatusLabel("abandoned")).toBe("已放弃");
  });

  it("keeps the setting and Composer mode guards wired to the Tower contract", () => {
    const settings = readFileSync(resolve(process.cwd(), "src/components/settings/SettingsPanel.tsx"), "utf8");
    const composer = readFileSync(resolve(process.cwd(), "src/components/chat/Composer.tsx"), "utf8");
    expect(settings).toContain('id: "tower"');
    expect(settings).toContain("重启 Kimix 或托管 Kimi Server");
    expect(composer).toContain("preflightKimiCodeTower");
    expect(composer).toContain("towerModeDesired: true");
    expect(composer).toContain("不能与多 Agent 房间协作同时使用");
    expect(composer).toContain("请先退出 Tower 后再开启 Plan");
    expect(composer).toContain("请先退出 Tower 后再使用 Swarm");
  });
});
