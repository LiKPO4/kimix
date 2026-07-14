import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { archiveSdkSession, restoreSdkArchivedSession, toSdkArchivedSessionSummary } from "../../../electron/kimiCodeHost";

describe("Kimi Code SDK archive", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("按官方 SessionStore 语义标记 SDK 会话归档", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "kimix-sdk-archive-"));
    temporaryDirectories.push(root);
    const sessionDir = path.join(root, "session-official");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, "state.json"), JSON.stringify({
      title: "保留标题",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }), "utf-8");
    const closeManagedSession = vi.fn(async () => undefined);

    await archiveSdkSession({
      listSessions: async () => [{
        id: "session-official",
        workDir: root,
        sessionDir,
        createdAt: 1,
        updatedAt: 1,
      }],
    }, "session-official", closeManagedSession);

    const state = JSON.parse(await readFile(path.join(sessionDir, "state.json"), "utf-8"));
    expect(closeManagedSession).toHaveBeenCalledOnce();
    expect(state).toMatchObject({ title: "保留标题", archived: true });
    expect(state.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("归档前必须由 SDK 确认会话目录", async () => {
    await expect(archiveSdkSession({ listSessions: async () => [] }, "session-missing"))
      .rejects.toThrow('Session "session-missing" was not found');
  });

  it("把 SDK 归档摘要转换为设置页可恢复条目", () => {
    expect(toSdkArchivedSessionSummary({
      id: "session-official",
      title: "SDK 归档",
      workDir: "D:/project",
      sessionDir: "D:/sessions/session-official",
      createdAt: Date.parse("2026-01-01T00:00:00.000Z"),
      updatedAt: Date.parse("2026-01-02T00:00:00.000Z"),
      archived: true,
    })).toEqual({
      id: "session-official",
      title: "SDK 归档",
      projectPath: "D:/project",
      archivedAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("按 SDK SessionStore 语义移除归档标记", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "kimix-sdk-restore-"));
    temporaryDirectories.push(root);
    const sessionDir = path.join(root, "session-official");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(path.join(sessionDir, "state.json"), JSON.stringify({
      title: "恢复后的标题",
      archived: true,
      updatedAt: "2026-01-02T00:00:00.000Z",
    }), "utf-8");

    const restored = await restoreSdkArchivedSession({
      listSessions: async () => [{
        id: "session-official",
        title: "旧标题",
        workDir: root,
        sessionDir,
        createdAt: Date.parse("2026-01-01T00:00:00.000Z"),
        updatedAt: Date.parse("2026-01-02T00:00:00.000Z"),
        archived: true,
      }],
    }, "session-official");

    const state = JSON.parse(await readFile(path.join(sessionDir, "state.json"), "utf-8"));
    expect(state.archived).toBeUndefined();
    expect(Date.parse(state.updatedAt)).toBeGreaterThan(Date.parse("2026-01-02T00:00:00.000Z"));
    expect(restored).toMatchObject({ id: "session-official", title: "恢复后的标题", projectPath: root });
  });
});
