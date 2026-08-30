import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deleteUiStyleInboxDocuments, scanUiStyleInbox } from "../uiStyleInbox";
import { BUILTIN_UI_STYLE_DOCUMENTS } from "../../src/utils/builtinUiStyleDocuments";
import type { UiStyleDocumentV1 } from "../../src/utils/uiStyleContract";

function makeDoc(id: string, name: string): UiStyleDocumentV1 {
  return {
    ...BUILTIN_UI_STYLE_DOCUMENTS.default,
    id,
    name,
    description: "测试风格",
  };
}

const tmpDirs: string[] = [];
function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-ui-style-inbox-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe("scanUiStyleInbox", () => {
  it("扫描合法 JSON 并按 id 去重（文件名靠后的覆盖）", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify(makeDoc("ocean", "海洋")), "utf-8");
    fs.writeFileSync(path.join(dir, "b.json"), JSON.stringify(makeDoc("ocean", "海洋-v2")), "utf-8");
    fs.writeFileSync(path.join(dir, "c.json"), JSON.stringify(makeDoc("forest", "森林")), "utf-8");
    const result = scanUiStyleInbox(dir);
    expect(result.errors).toEqual([]);
    expect(result.documents.map((document) => document.id).sort()).toEqual(["forest", "ocean"]);
    expect(result.documents.find((document) => document.id === "ocean")?.name).toBe("海洋-v2");
  });

  it("忽略非法 JSON、不符合契约的文档与非 JSON 文件", () => {
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, "broken.json"), "{ not json", "utf-8");
    fs.writeFileSync(path.join(dir, "invalid.json"), JSON.stringify({ hello: 1 }), "utf-8");
    fs.writeFileSync(path.join(dir, "notes.txt"), "kimix-ui-style", "utf-8");
    const result = scanUiStyleInbox(dir);
    expect(result.documents).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].file).toBe("broken.json");
  });

  it("目录不存在时自动创建并返回空列表", () => {
    const dir = path.join(makeTmpDir(), "nested", "inbox");
    const result = scanUiStyleInbox(dir);
    expect(result.documents).toEqual([]);
    expect(fs.existsSync(dir)).toBe(true);
  });
});

describe("deleteUiStyleInboxDocuments", () => {
  it("只删除 id 匹配的文件，支持 custom: 前缀", () => {
    const dir = makeTmpDir();
    const keep = path.join(dir, "keep.json");
    const drop = path.join(dir, "drop.json");
    fs.writeFileSync(keep, JSON.stringify(makeDoc("keep", "保留")), "utf-8");
    fs.writeFileSync(drop, JSON.stringify(makeDoc("drop", "删除")), "utf-8");
    const deleted = deleteUiStyleInboxDocuments("custom:drop", dir);
    expect(deleted).toEqual([drop]);
    expect(fs.existsSync(drop)).toBe(false);
    expect(fs.existsSync(keep)).toBe(true);
  });

  it("空 id 不做任何删除", () => {
    const dir = makeTmpDir();
    const file = path.join(dir, "a.json");
    fs.writeFileSync(file, JSON.stringify(makeDoc("a", "A")), "utf-8");
    expect(deleteUiStyleInboxDocuments("  ", dir)).toEqual([]);
    expect(fs.existsSync(file)).toBe(true);
  });
});
