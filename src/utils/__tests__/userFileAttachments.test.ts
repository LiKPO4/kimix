import { describe, expect, it } from "vitest";
import { extractFileAttachmentText } from "../userFileAttachments";

describe("extractFileAttachmentText", () => {
  it("strips the legacy Kimix prompt block and restores file cards", () => {
    expect(extractFileAttachmentText([
      "请总结这份文档",
      "附件文件：",
      "1. spec.md",
      "   绝对路径：C:\\Users\\me\\Downloads\\spec.md",
      "",
      "请直接使用上述绝对路径读取附件内容，不要只按文件名搜索。",
    ].join("\n"))).toEqual({
      content: "请总结这份文档",
      files: [{
        kind: "file",
        name: "spec.md",
        filePath: "C:\\Users\\me\\Downloads\\spec.md",
      }],
    });
  });

  it("restores official Server notices without exposing managed paths", () => {
    const fileId = "f_550e8400-e29b-41d4-a716-446655440000";
    const managedPath = `C:\\sessions\\s1\\attachments\\${fileId}-report.pdf`;
    expect(extractFileAttachmentText([
      "请总结",
      `Attached file "report.pdf" (application/pdf, 24 bytes): ${managedPath} — open it with the Read tool`,
    ].join("\n"))).toEqual({
      content: "请总结",
      files: [{
        kind: "file",
        name: "report.pdf",
        filePath: managedPath,
        fileId,
        mediaType: "application/pdf",
        size: 24,
      }],
    });
  });

  it("keeps lookalike user text untouched", () => {
    const text = 'Attached file "a.pdf" (application/pdf, 3 bytes): C:\\tmp\\a.pdf - open it with the Read tool';
    expect(extractFileAttachmentText(text)).toEqual({ content: text, files: [] });
  });

  it("restores non-vision image placeholder lines as attachment cards", () => {
    expect(extractFileAttachmentText([
      "请描述这几张图",
      "图片：",
      "1. [图片: name.png]",
      "2. [图片: other.jpg]",
    ].join("\n"))).toEqual({
      content: "请描述这几张图",
      files: [
        { kind: "image", name: "name.png" },
        { kind: "image", name: "other.jpg" },
      ],
    });
  });

  it("restores a non-vision image placeholder without preceding text", () => {
    expect(extractFileAttachmentText("图片：\n1. [图片: solo.png]")).toEqual({
      content: "",
      files: [{ kind: "image", name: "solo.png" }],
    });
  });

  it("keeps a 图片： line without numbered placeholder items untouched", () => {
    const text = "图片：\n这是一段普通讨论图片的文字";
    expect(extractFileAttachmentText(text)).toEqual({ content: text, files: [] });
  });
});
