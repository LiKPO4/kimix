import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applySecondaryModelConfigToml } from "../../../electron/kimiCodeHost";

const ALIAS = "deepseek/deepseek-v4-flash";

const CONFIG_WITH_EFFORTS = `default_model = "kimi-for-coding"

[models."${ALIAS}"]
provider = "deepseek"
model = "deepseek-v4-flash"
support_efforts = ["low", "medium", "high"]
`;

const CONFIG_WITHOUT_EFFORTS = `[models."${ALIAS}"]
provider = "deepseek"
model = "deepseek-v4-flash"
`;

const tempDirs: string[] = [];

function createTempConfig(content: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-secondary-model-"));
  tempDirs.push(dir);
  const configPath = path.join(dir, "config.toml");
  fs.writeFileSync(configPath, content, "utf-8");
  return configPath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("secondary_model 保存写前校验", () => {
  it("拒绝写入未声明的思考档位且不改动 config.toml", () => {
    const configPath = createTempConfig(CONFIG_WITH_EFFORTS);
    const before = fs.readFileSync(configPath, "utf-8");

    expect(() => applySecondaryModelConfigToml(before, ALIAS, "max")).toThrow(
      `模型 ${ALIAS} 未声明思考档位 "max"（可用：low、medium、high）`,
    );
    // 校验在写盘前抛出，落盘内容必须保持原样
    expect(fs.readFileSync(configPath, "utf-8")).toBe(before);
  });

  it("已声明的合法档位正常写入 secondary_model 段", () => {
    const next = applySecondaryModelConfigToml(CONFIG_WITH_EFFORTS, ALIAS, "high");

    expect(next).toContain("[secondary_model]");
    expect(next).toContain(`model = "${ALIAS}"`);
    expect(next).toContain(`default_effort = "high"`);
    expect(next).toContain("[experimental]");
    expect(next).toContain("secondary-model = true");
    // 既有 models 段保持不动
    expect(next).toContain(`[models."${ALIAS}"]`);
    expect(next).toContain(`support_efforts = ["low", "medium", "high"]`);
  });

  it("模型未声明 support_efforts 时跳过校验", () => {
    const next = applySecondaryModelConfigToml(CONFIG_WITHOUT_EFFORTS, ALIAS, "max");

    expect(next).toContain("[secondary_model]");
    expect(next).toContain(`default_effort = "max"`);
  });

  it("未提供 defaultEffort 时不校验（保持现状）", () => {
    const next = applySecondaryModelConfigToml(CONFIG_WITH_EFFORTS, ALIAS, null);

    expect(next).toContain("[secondary_model]");
    expect(next).toContain(`model = "${ALIAS}"`);
    expect(next).not.toContain("default_effort");
  });

  it("开启 secondary-model 实验时保留其他实验开关", () => {
    const next = applySecondaryModelConfigToml([
      CONFIG_WITHOUT_EFFORTS.trimEnd(),
      "",
      "[experimental]",
      "tool-select = true",
      "secondary-model = false",
      "",
    ].join("\n"), ALIAS, "high");

    expect(next).toContain("tool-select = true");
    expect(next.match(/secondary-model = true/g)).toHaveLength(1);
    expect(next).not.toContain("secondary-model = false");
  });

  it("清除模型时不擅自关闭独立配置的实验开关", () => {
    const next = applySecondaryModelConfigToml([
      CONFIG_WITHOUT_EFFORTS.trimEnd(),
      "",
      "[experimental]",
      "secondary-model = true",
      "",
      "[secondary_model]",
      `model = "${ALIAS}"`,
      "default_effort = \"high\"",
      "",
    ].join("\n"), null, null);

    expect(next).not.toContain("[secondary_model]");
    expect(next).toContain("[experimental]");
    expect(next).toContain("secondary-model = true");
  });
});
