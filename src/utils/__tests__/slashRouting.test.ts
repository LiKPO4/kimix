import { describe, expect, it } from "vitest";
import { classifySlashCommand, shouldActivateSkillBeforePrompt } from "../slashRouting";

describe("classifySlashCommand", () => {
  it("keeps Kimix-only slash commands local", () => {
    expect(classifySlashCommand("theme")).toBe("local");
    expect(classifySlashCommand("custom-theme")).toBe("local");
    expect(classifySlashCommand("import-from-cc-codex")).toBe("local");
  });

  it("lets official slash commands reach the Kimi route before local fallback", () => {
    expect(classifySlashCommand("goal")).toBe("official-first");
    expect(classifySlashCommand("swarm")).toBe("official-first");
    expect(classifySlashCommand("compact")).toBe("official-first");
    expect(classifySlashCommand("undo")).toBe("official-first");
  });

  it("lets skill slash commands reach the official route before local fallback", () => {
    expect(classifySlashCommand("skill:deploy-okf-knowledge")).toBe("official-first");
  });

  it("activates skill slash commands before sending them as prompts", () => {
    expect(shouldActivateSkillBeforePrompt("skill:find-skills")).toBe(true);
    expect(shouldActivateSkillBeforePrompt("goal")).toBe(false);
  });

  it("passes through unknown slash commands", () => {
    expect(classifySlashCommand("unknown")).toBe("passthrough");
  });
});
