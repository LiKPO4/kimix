import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeKimiConfigTomlIfUnchanged } from "../kimiConfigWriteGuard";

const tempDirs: string[] = [];

function tempConfig(initial?: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-config-guard-"));
  tempDirs.push(dir);
  const configPath = path.join(dir, "config.toml");
  if (initial !== undefined) fs.writeFileSync(configPath, initial, "utf-8");
  return configPath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("writeKimiConfigTomlIfUnchanged", () => {
  it("仅在磁盘内容仍等于读取基线时写入", () => {
    const configPath = tempConfig('default_model = "old"\n');
    writeKimiConfigTomlIfUnchanged(configPath, 'default_model = "old"\n', 'default_model = "new"\n');
    expect(fs.readFileSync(configPath, "utf-8")).toBe('default_model = "new"\n');
  });

  it("外部修改后拒绝覆盖并保留外部内容", () => {
    const configPath = tempConfig('default_model = "old"\n');
    fs.writeFileSync(configPath, 'default_model = "external"\n[unrelated]\nkeep = true\n', "utf-8");

    expect(() => writeKimiConfigTomlIfUnchanged(
      configPath,
      'default_model = "old"\n',
      'default_model = "kimix"\n',
    )).toThrow("配置已被其他程序修改");
    expect(fs.readFileSync(configPath, "utf-8")).toContain('default_model = "external"');
    expect(fs.readFileSync(configPath, "utf-8")).toContain("keep = true");
  });

  it("原本不存在的配置若被外部创建也拒绝覆盖", () => {
    const configPath = tempConfig();
    fs.writeFileSync(configPath, "invalid = [\n", "utf-8");
    expect(() => writeKimiConfigTomlIfUnchanged(configPath, "", "default_model = \"kimix\"\n"))
      .toThrow("配置已被其他程序修改");
    expect(fs.readFileSync(configPath, "utf-8")).toBe("invalid = [\n");
  });
});
