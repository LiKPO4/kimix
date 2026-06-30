import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deleteKimiThemeSourceFile, resolveDeletableKimiThemeFile } from "../../../electron/kimiThemeFiles";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function createThemesDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-theme-delete-"));
  tempRoots.push(root);
  const themesDir = path.join(root, "themes");
  fs.mkdirSync(themesDir);
  return { root, themesDir };
}

describe("Kimi theme source deletion", () => {
  it("deletes a direct JSON child from the themes directory", () => {
    const { themesDir } = createThemesDir();
    const themePath = path.join(themesDir, "custom.json");
    fs.writeFileSync(themePath, "{}", "utf8");

    expect(deleteKimiThemeSourceFile(themesDir, themePath)).toBe(themePath);
    expect(fs.existsSync(themePath)).toBe(false);
  });

  it("rejects paths outside the themes directory", () => {
    const { root, themesDir } = createThemesDir();
    const outsidePath = path.join(root, "outside.json");

    expect(() => resolveDeletableKimiThemeFile(themesDir, outsidePath))
      .toThrow("只能删除当前 Kimi Code themes 目录中的直接子文件");
  });

  it("rejects nested and non-JSON files", () => {
    const { themesDir } = createThemesDir();

    expect(() => resolveDeletableKimiThemeFile(themesDir, path.join(themesDir, "nested", "theme.json")))
      .toThrow("只能删除当前 Kimi Code themes 目录中的直接子文件");
    expect(() => resolveDeletableKimiThemeFile(themesDir, path.join(themesDir, "theme.txt")))
      .toThrow("只能删除 Kimi Code 主题 JSON 文件");
  });
});
