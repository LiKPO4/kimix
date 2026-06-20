import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareSkillDirectoryForKimi, syncAgentSkillDirectories } from "../../../electron/skillMigration";

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

  it("synchronizes newly installed top-level Agent Skills with their sub-skills", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-agent-skill-sync-"));
    temporaryRoots.push(root);
    const agentRoot = path.join(root, ".agents", "skills");
    const gameSkill = path.join(agentRoot, "game-development");
    const kimiHome = path.join(root, ".kimi-code");
    fs.mkdirSync(path.join(gameSkill, "game-design"), { recursive: true });
    fs.writeFileSync(path.join(gameSkill, "SKILL.md"), "---\nname: game-development\n---\n", "utf8");
    fs.writeFileSync(path.join(gameSkill, "game-design", "SKILL.md"), "---\nname: game-design\n---\n", "utf8");

    const result = syncAgentSkillDirectories(agentRoot, kimiHome);

    expect(result.names).toEqual(["game-development", "game-development/game-design"]);
    expect(result.copiedNames).toEqual(["game-development", "game-development/game-design"]);
    expect(result.latestModifiedAt).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(kimiHome, "skills", "game-development", "game-design", "SKILL.md"))).toBe(true);
    expect(fs.readFileSync(path.join(kimiHome, "skills", "game-development_game-design", "SKILL.md"), "utf8"))
      .toContain("name: game-development/game-design");
  });
});
