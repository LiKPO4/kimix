import { describe, expect, it } from "vitest";
import { classifySlashCommand, shouldActivateSkillBeforePrompt, slashCommandPattern } from "../slashRouting";

describe("classifySlashCommand", () => {
  it("keeps Kimix-only slash commands local", () => {
    expect(classifySlashCommand("theme")).toBe("local");
    for (const name of ["new", "clear", "fork", "title", "rename", "model", "settings", "config", "provider", "mcp", "plugins", "permission", "yolo", "yes", "auto", "tasks", "task", "export-md", "export", "copy", "help", "h", "version", "exit", "quit", "q", "init"]) {
      expect(classifySlashCommand(name)).toBe("local");
    }
  });

  it("routes official built-in Skill commands through Skill activation first", () => {
    expect(classifySlashCommand("custom-theme")).toBe("official-skill-first");
    expect(classifySlashCommand("import-from-cc-codex")).toBe("official-skill-first");
    expect(classifySlashCommand("mcp-config")).toBe("official-skill-first");
    expect(classifySlashCommand("write-goal")).toBe("official-skill-first");
    expect(classifySlashCommand("update-config")).toBe("official-skill-first");
    expect(classifySlashCommand("check-kimi-code-docs")).toBe("official-skill-first");
  });

  it("routes dotted sub-skill commands through Skill activation first", () => {
    expect(classifySlashCommand("sub-skill")).toBe("official-skill-first");
    expect(classifySlashCommand("sub-skill.review")).toBe("official-skill-first");
    expect(classifySlashCommand("sub-skill.consolidate")).toBe("official-skill-first");
  });

  it("parses dotted sub-skill command names with the shared pattern", () => {
    expect("/sub-skill.review 只审查".match(slashCommandPattern)?.[1]).toBe("sub-skill.review");
    expect("/sub-skill.review 只审查".match(slashCommandPattern)?.[2]).toBe("只审查");
    expect("/skill:code-style".match(slashCommandPattern)?.[1]).toBe("skill:code-style");
  });

  it("routes supported and compatibility commands before generic prompt submission", () => {
    expect(classifySlashCommand("goal")).toBe("direct");
    expect(classifySlashCommand("swarm")).toBe("direct");
    expect(classifySlashCommand("compact")).toBe("direct");
    expect(classifySlashCommand("undo")).toBe("direct");
  });

  it("lets skill slash commands reach the official route before local fallback", () => {
    expect(classifySlashCommand("skill:deploy-okf-knowledge")).toBe("direct");
  });

  it("activates skill slash commands before sending them as prompts", () => {
    expect(shouldActivateSkillBeforePrompt("skill:find-skills")).toBe(true);
    expect(shouldActivateSkillBeforePrompt("goal")).toBe(false);
  });

  it("passes through unknown slash commands", () => {
    expect(classifySlashCommand("unknown")).toBe("passthrough");
  });
});
