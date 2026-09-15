import { describe, expect, it } from "vitest";
import { readCompactionMaxAttempts, setCompactionMaxAttempts } from "../loopControlToml";

describe("loopControlToml", () => {
  it("无 loop_control 段时返回 null", () => {
    expect(readCompactionMaxAttempts("default_model = \"x\"\n")).toBeNull();
  });

  it("读取已有值", () => {
    const toml = "[loop_control]\ncompaction_max_attempts = 3\n";
    expect(readCompactionMaxAttempts(toml)).toBe(3);
  });

  it("段存在但无该键时返回 null", () => {
    const toml = "[loop_control]\nother = 1\n";
    expect(readCompactionMaxAttempts(toml)).toBeNull();
  });

  it("不读取其他段的值", () => {
    const toml = "[loop_control]\ncompaction_max_attempts = 5\n\n[experimental]\ncompaction_max_attempts = 99\n";
    expect(readCompactionMaxAttempts(toml)).toBe(5);
  });

  it("写入已存在的值（保留布局）", () => {
    const toml = "default_model = \"x\"\n\n[loop_control]\ncompaction_max_attempts = 3\n";
    const next = setCompactionMaxAttempts(toml, 8);
    expect(readCompactionMaxAttempts(next)).toBe(8);
    expect(next).toContain("default_model = \"x\"");
  });

  it("无段时新建段", () => {
    const toml = "default_model = \"x\"\n";
    const next = setCompactionMaxAttempts(toml, 6);
    expect(readCompactionMaxAttempts(next)).toBe(6);
  });

  it("CRLF 行尾保持", () => {
    const toml = "[loop_control]\r\ncompaction_max_attempts = 2\r\n";
    expect(readCompactionMaxAttempts(toml)).toBe(2);
    const next = setCompactionMaxAttempts(toml, 7);
    expect(readCompactionMaxAttempts(next)).toBe(7);
    expect(next.includes("\r\n")).toBe(true);
  });
});
