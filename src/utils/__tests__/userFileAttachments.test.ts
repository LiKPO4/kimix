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
});
