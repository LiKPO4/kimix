import { describe, expect, it } from "vitest";
import { parseSha256SumsText } from "../releaseFeed";

describe("parseSha256SumsText", () => {
  it("解析标准 sha256sum 输出（无空格文件名）", () => {
    const map = parseSha256SumsText(
      [
        "1f27dcf13511c1c48f2b8bcd533fe093bb3cf0af30f6688c451355d8c2727fda  Kimix-Setup-2.21.75.exe",
        "90e2bb2a20a906e6ed7dd363f1d7ffdc9a0f84496e30eeac0c2ba5dca423a0bd  Kimix-Setup-2.21.75.exe.blockmap",
      ].join("\n"),
    );
    expect(map.size).toBe(2);
    expect(map.get("Kimix-Setup-2.21.75.exe"))
      .toBe("1f27dcf13511c1c48f2b8bcd533fe093bb3cf0af30f6688c451355d8c2727fda");
  });

  it("解析带空格文件名（旧实现会截断成 Kimix 而匹配不上）", () => {
    const map = parseSha256SumsText(
      "2953df4c9b2b0eaa9652e01b461121d25a966c21dc3fa9280751eb36dcc10092  Kimix 2.21.88.exe\n",
    );
    expect(map.get("Kimix 2.21.88.exe"))
      .toBe("2953df4c9b2b0eaa9652e01b461121d25a966c21dc3fa9280751eb36dcc10092");
  });

  it("过滤注释与空行，兼容 BSD 风格的 * 前缀标记", () => {
    const map = parseSha256SumsText(
      [
        "# comment line",
        "",
        "2953df4c9b2b0eaa9652e01b461121d25a966c21dc3fa9280751eb36dcc10092 *Kimix 2.21.88.exe",
        "bad line without checksum",
        "xyz  abc",
      ].join("\n"),
    );
    expect(map.size).toBe(1);
    expect(map.get("Kimix 2.21.88.exe"))
      .toBe("2953df4c9b2b0eaa9652e01b461121d25a966c21dc3fa9280751eb36dcc10092");
  });
});