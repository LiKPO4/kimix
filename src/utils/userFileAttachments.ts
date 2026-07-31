import type { UserMessageImage } from "@/types/ui";

const LEGACY_ATTACHMENT_FOOTER = "请直接使用上述绝对路径读取附件内容，不要只按文件名搜索。";
const OFFICIAL_ATTACHMENT_NOTICE_RE =
  /^Attached file "(.+)" \(([^,]+), (\d+) bytes\): (.+) — open it with the Read tool$/;
const FILE_STORE_ID_AT_START_RE =
  /^f_(?:[0-9A-Za-z]{26}|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})(?=-)/;

export type ExtractedFileAttachmentText = {
  content: string;
  files: UserMessageImage[];
};

function officialFileAttachment(line: string): UserMessageImage | null {
  const match = OFFICIAL_ATTACHMENT_NOTICE_RE.exec(line.trim());
  if (!match) return null;
  const filePath = match[4] ?? "";
  const basename = filePath.split(/[\\/]/).at(-1) ?? "";
  return {
    kind: "file",
    name: match[1] ?? "附件文件",
    filePath,
    fileId: FILE_STORE_ID_AT_START_RE.exec(basename)?.[0],
    mediaType: match[2],
    size: Number(match[3]),
  };
}

function extractOfficialAttachmentNotices(content: string): ExtractedFileAttachmentText {
  const files: UserMessageImage[] = [];
  const visibleLines = content.split("\n").filter((line) => {
    const file = officialFileAttachment(line);
    if (!file) return true;
    files.push(file);
    return false;
  });
  return {
    content: visibleLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    files,
  };
}

function extractLegacyAttachmentBlock(content: string): ExtractedFileAttachmentText {
  const marker = content.search(/(?:^|\n)附件文件：\n/);
  if (marker < 0) return { content, files: [] };
  const blockStart = content.indexOf("附件文件：", marker);
  const block = content.slice(blockStart);
  if (!block.trimEnd().endsWith(LEGACY_ATTACHMENT_FOOTER)) return { content, files: [] };

  const lines = block.split("\n");
  const files: UserMessageImage[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const item = lines[index]?.match(/^\d+\.\s+(.+)$/);
    if (!item) continue;
    const pathLine = lines[index + 1]?.match(/^\s+绝对路径：(.+)$/);
    const filePath = pathLine?.[1]?.trim();
    files.push({
      kind: "file",
      name: item[1]?.trim() || "附件文件",
      filePath: filePath && filePath !== "未能从系统拖拽事件读取，请提示用户重新选择文件"
        ? filePath
        : undefined,
    });
    if (pathLine) index += 1;
  }
  return {
    content: content.slice(0, marker).trim(),
    files,
  };
}

// electron/main.ts 的 adaptPromptForModel 在非 vision 模型下把图片降级为
// "图片：\n1. [图片: name.png]" 文本行写进正文；canonical 回放时据此还原附件卡片，
// 避免用户气泡直接显示占位行。
const NON_VISION_IMAGE_ITEM_RE = /^\d+\.\s+\[图片: (.+)\]$/;

function extractNonVisionImageBlock(content: string): ExtractedFileAttachmentText {
  const marker = content.search(/(?:^|\n)图片：\n/);
  if (marker < 0) return { content, files: [] };
  const blockStart = content.indexOf("图片：", marker);
  const lines = content.slice(blockStart).split("\n");
  const files: UserMessageImage[] = [];
  let consumed = 1;
  for (let index = 1; index < lines.length; index += 1) {
    const item = lines[index]?.match(NON_VISION_IMAGE_ITEM_RE);
    if (!item) break;
    files.push({ kind: "image", name: item[1]?.trim() || "图片" });
    consumed += 1;
  }
  if (files.length === 0) return { content, files: [] };
  const before = content.slice(0, marker).trim();
  const after = lines.slice(consumed).join("\n").trim();
  return { content: [before, after].filter(Boolean).join("\n"), files };
}

export function extractFileAttachmentText(content: string): ExtractedFileAttachmentText {
  const legacy = extractLegacyAttachmentBlock(content);
  const nonVision = extractNonVisionImageBlock(legacy.content);
  const official = extractOfficialAttachmentNotices(nonVision.content);
  return {
    content: official.content,
    files: [...legacy.files, ...nonVision.files, ...official.files],
  };
}
