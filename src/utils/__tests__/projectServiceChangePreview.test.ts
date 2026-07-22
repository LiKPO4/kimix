import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { getChangePreview } from "../../../electron/projectService";

const tempDirs: string[] = [];

function git(cwd: string, args: string[]) {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function createRepo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-change-preview-"));
  tempDirs.push(cwd);
  git(cwd, ["init"]);
  git(cwd, ["config", "user.email", "kimix-test@example.com"]);
  git(cwd, ["config", "user.name", "Kimix Test"]);
  fs.writeFileSync(path.join(cwd, "README.md"), "fixture\n");
  git(cwd, ["add", "README.md"]);
  git(cwd, ["commit", "-m", "fixture"]);
  return cwd;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("getChangePreview", () => {
  it("requires an exact commit when multiple historical commits are plausible", async () => {
    const cwd = createRepo();
    const eventTimestamp = Date.now();
    fs.writeFileSync(path.join(cwd, "storylets.json"), "before\n");
    git(cwd, ["add", "storylets.json"]);
    git(cwd, ["commit", "-m", "add story"]);
    fs.writeFileSync(path.join(cwd, "storylets.json"), "after\n");
    git(cwd, ["add", "storylets.json"]);
    git(cwd, ["commit", "-m", "change story"]);
    fs.writeFileSync(path.join(cwd, "storylets.json"), "unrelated later workspace edit\n");

    const preview = await getChangePreview({ projectPath: cwd, filePath: "storylets.json", eventTimestamp });
    expect(preview.source).toBe("unavailable");

    const commitSha = git(cwd, ["rev-parse", "HEAD"]);
    const exact = await getChangePreview({ projectPath: cwd, filePath: "storylets.json", commitSha });
    expect(exact).toMatchObject({ source: "commit", additions: 1, deletions: 1, commitSha });
    expect(exact.patch).toContain("-before");
    expect(exact.patch).toContain("+after");
  });

  it("recovers the only historical commit touching a file", async () => {
    const cwd = createRepo();
    const eventTimestamp = Date.now();
    fs.writeFileSync(path.join(cwd, "storylets.json"), "new line\n");
    git(cwd, ["add", "storylets.json"]);
    git(cwd, ["commit", "-m", "add story"]);

    const preview = await getChangePreview({ projectPath: cwd, filePath: "storylets.json", eventTimestamp });
    expect(preview).toMatchObject({ source: "commit", additions: 1, deletions: 0 });
  });

  it("previews a current uncommitted replacement when no historical commit is known", async () => {
    const cwd = createRepo();
    fs.writeFileSync(path.join(cwd, "app.ts"), "before\n");
    git(cwd, ["add", "app.ts"]);
    git(cwd, ["commit", "-m", "add app"]);
    fs.writeFileSync(path.join(cwd, "app.ts"), "after\n");

    const preview = await getChangePreview({ projectPath: cwd, filePath: "app.ts" });
    expect(preview).toMatchObject({ source: "workspace", additions: 1, deletions: 1 });
  });
});
