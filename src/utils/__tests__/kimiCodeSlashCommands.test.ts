import { describe, expect, it } from "vitest";
import { listKimiCodeSlashCommands } from "../../../electron/kimiCodeSlashCommands";

function rootNames(runtime: "server" | "sdk") {
  return new Set(listKimiCodeSlashCommands(runtime).map((command) => command.name.split(" ")[0]));
}

describe("listKimiCodeSlashCommands", () => {
  it("Server 清单不暴露尚无官方 API 的 SDK-only 命令", () => {
    const names = rootNames("server");
    expect(names.has("goal")).toBe(false);
    expect(names.has("swarm")).toBe(false);
  });

  it("SDK 清单保留 Goal 和 Swarm 兼容能力", () => {
    const names = rootNames("sdk");
    expect(names.has("goal")).toBe(true);
    expect(names.has("swarm")).toBe(true);
  });

  it("两种运行时都保留已实现的公共与 Kimix 本地命令", () => {
    for (const runtime of ["server", "sdk"] as const) {
      const names = rootNames(runtime);
      expect(names.has("compact")).toBe(true);
      expect(names.has("plan")).toBe(true);
      expect(names.has("btw")).toBe(true);
      expect(names.has("undo")).toBe(true);
      expect(names.has("reload")).toBe(true);
      expect(names.has("skill:")).toBe(true);
      expect(names.has("theme")).toBe(true);
      expect(names.has("custom-theme")).toBe(true);
      expect(names.has("import-from-cc-codex")).toBe(true);
      expect(names.has("mcp-config")).toBe(true);
      expect(names.has("write-goal")).toBe(true);
      expect(names.has("update-config")).toBe(true);
      expect(names.has("check-kimi-code-docs")).toBe(true);
      expect(names.has("sub-skill")).toBe(true);
      expect(names.has("sub-skill.review")).toBe(true);
      expect(names.has("sub-skill.consolidate")).toBe(true);
    }
  });
});
