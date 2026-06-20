import { describe, expect, it } from "vitest";
import { classifySlashCommand } from "../slashRouting";

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

  it("passes through skill and unknown slash commands", () => {
    expect(classifySlashCommand("skill:deploy-okf-knowledge")).toBe("passthrough");
    expect(classifySlashCommand("unknown")).toBe("passthrough");
  });
});
