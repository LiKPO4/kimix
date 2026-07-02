import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { archiveSdkSession } from "../../../electron/kimiCodeHost";

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
});
