import { describe, expect, it } from "vitest";
import { parseMarkdownFrontmatter } from "../markdownFrontmatter";

describe("parseMarkdownFrontmatter", () => {
  it("解析基本键值", () => {
    const parsed = parseMarkdownFrontmatter("---\ntitle: 测试标题\ndate: 2026-09-15\n---\n# 正文\n");
    expect(parsed).not.toBeNull();
    expect(parsed!.meta).toEqual([
      { key: "title", value: "测试标题" },
      { key: "date", value: "2026-09-15" },
    ]);
    expect(parsed!.body).toBe("# 正文\n");
  });

  it("解析内联数组为标签", () => {
    const parsed = parseMarkdownFrontmatter("---\ntags: [a, b, c]\n---\nbody");
    expect(parsed!.meta).toEqual([{ key: "tags", value: ["a", "b", "c"] }]);
  });

  it("解析 - item 列表", () => {
    const parsed = parseMarkdownFrontmatter("---\ntags:\n  - alpha\n  - beta\n---\nbody");
    expect(parsed!.meta).toEqual([{ key: "tags", value: ["alpha", "beta"] }]);
  });

  it("剥离引号", () => {
    const parsed = parseMarkdownFrontmatter('---\ntitle: "带引号"\n---\nbody');
    expect(parsed!.meta).toEqual([{ key: "title", value: "带引号" }]);
  });

  it("空值键保留为空数组", () => {
    const parsed = parseMarkdownFrontmatter("---\ntags:\n---\nbody");
    expect(parsed!.meta).toEqual([{ key: "tags", value: [] }]);
  });

  it("无 frontmatter 时返回 null", () => {
    expect(parseMarkdownFrontmatter("# 普通标题\n\n正文")).toBeNull();
    expect(parseMarkdownFrontmatter("")).toBeNull();
  });

  it("中间出现的 --- 不算 frontmatter", () => {
    const text = "正文\n\n---\nkey: value\n---\n";
    expect(parseMarkdownFrontmatter(text)).toBeNull();
  });

  it("CRLF 行尾", () => {
    const parsed = parseMarkdownFrontmatter("---\r\ntitle: CRLF\r\n---\r\nbody");
    expect(parsed!.meta).toEqual([{ key: "title", value: "CRLF" }]);
    expect(parsed!.body).toBe("body");
  });

  it("仅 frontmatter 无正文", () => {
    const parsed = parseMarkdownFrontmatter("---\ntitle: x\n---\n");
    expect(parsed!.body).toBe("");
  });
});
