import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareSkillDirectoryForKimi } from "../../../electron/skillMigration";

const temporaryRoots: string[] = [];

afterEach(() => {
  temporaryRoots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

describe("prepareSkillDirectoryForKimi", () => {
  it("copies a complete local Skill into the Kimi user Skill directory", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-skill-migration-"));
    temporaryRoots.push(root);
    const source = path.join(root, "source", "find-skills");
    const kimiHome = path.join(root, "kimi-home");
    fs.mkdirSync(path.join(source, "references"), { recursive: true });
    fs.writeFileSync(path.join(source, "SKILL.md"), "# Find skills\n", "utf8");
    fs.writeFileSync(path.join(source, "references", "guide.md"), "guide\n", "utf8");

    const result = prepareSkillDirectoryForKimi(path.join(source, "SKILL.md"), "find-skills", kimiHome);

    expect(result.copied).toBe(true);
    expect(fs.readFileSync(path.join(kimiHome, "skills", "find-skills", "SKILL.md"), "utf8")).toContain("Find skills");
    expect(fs.existsSync(path.join(kimiHome, "skills", "find-skills", "references", "guide.md"))).toBe(true);
  });

  it("does not overwrite an existing Kimi Skill", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-skill-migration-"));
    temporaryRoots.push(root);
    const source = path.join(root, "source");
    const target = path.join(root, "kimi-home", "skills", "review");
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(source, "SKILL.md"), "source\n", "utf8");
    fs.writeFileSync(path.join(target, "SKILL.md"), "existing\n", "utf8");

    const result = prepareSkillDirectoryForKimi(path.join(source, "SKILL.md"), "review", path.join(root, "kimi-home"));

    expect(result.copied).toBe(false);
    expect(fs.readFileSync(path.join(target, "SKILL.md"), "utf8")).toBe("existing\n");
  });
});
