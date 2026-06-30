import { describe, expect, it } from "vitest";
import { classifySlashCommand, shouldActivateSkillBeforePrompt } from "../slashRouting";

describe("classifySlashCommand", () => {
  it("keeps Kimix-only slash commands local", () => {
    expect(classifySlashCommand("theme")).toBe("local");
  });

  it("routes official built-in Skill commands through Skill activation first", () => {
    expect(classifySlashCommand("custom-theme")).toBe("official-skill-first");
    expect(classifySlashCommand("import-from-cc-codex")).toBe("official-skill-first");
    expect(classifySlashCommand("mcp-config")).toBe("official-skill-first");
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
