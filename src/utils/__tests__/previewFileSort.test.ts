import { describe, expect, it } from "vitest";
import { sortPreviewFiles } from "../previewFileSort";

const files = [
  { path: "a.md", updatedAt: 100, size: 500 },
  { path: "b.md", updatedAt: 300, size: 100 },
  { path: "c.md", updatedAt: 200, size: 900 },
];

describe("sortPreviewFiles", () => {
  it("默认保持原始顺序", () => {
    expect(sortPreviewFiles(files, "default").map((f) => f.path)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("最新按修改时间降序", () => {
    expect(sortPreviewFiles(files, "newest").map((f) => f.path)).toEqual(["b.md", "c.md", "a.md"]);
  });

  it("最旧按修改时间升序", () => {
    expect(sortPreviewFiles(files, "oldest").map((f) => f.path)).toEqual(["a.md", "c.md", "b.md"]);
  });

  it("最大按文件大小降序", () => {
    expect(sortPreviewFiles(files, "largest").map((f) => f.path)).toEqual(["c.md", "a.md", "b.md"]);
  });

  it("最小按文件大小升序", () => {
    expect(sortPreviewFiles(files, "smallest").map((f) => f.path)).toEqual(["b.md", "a.md", "c.md"]);
  });

  it("不修改原数组", () => {
    const original = [...files];
    sortPreviewFiles(files, "newest");
    expect(files).toEqual(original);
  });
});
