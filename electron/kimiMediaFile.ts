import fs from "node:fs";
import path from "node:path";

export const KIMI_MEDIA_FILE_ID = /^f_[A-Za-z0-9-]+$/;

export type LocalKimiMediaFile = {
  status: 200 | 206 | 416;
  data: Buffer;
  mediaType: string;
  totalSize: number;
  start?: number;
  end?: number;
};

type ByteRange = { start: number; end: number } | "unsatisfiable" | null;

/**
 * 只解析官方 file-backed media 的受控 files/<f_id> 路径。
 * shareDir 由调用方的 Kimi Home 解析逻辑提供，因而兼容 KIMI_CODE_HOME、
 * KIMI_SHARE_DIR 和 legacy ~/.kimi；不要在这里回退到任意用户路径。
 */
export function resolveKimiMediaFilePath(shareDir: string, fileId: string): string | null {
  if (!KIMI_MEDIA_FILE_ID.test(fileId)) return null;
  const filesDir = path.resolve(shareDir, "files");
  const filePath = path.resolve(filesDir, fileId);
  if (path.relative(filesDir, filePath) !== fileId || path.basename(filePath) !== fileId) return null;
  return filePath;
}

function resolveSingleByteRange(rangeHeader: string | null | undefined, totalSize: number): ByteRange {
  if (!rangeHeader?.trim()) return null;
  const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || totalSize <= 0) return "unsatisfiable";
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return "unsatisfiable";
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return "unsatisfiable";
    return { start: Math.max(0, totalSize - suffixLength), end: totalSize - 1 };
  }
  const start = Number(rawStart);
  if (!Number.isSafeInteger(start) || start < 0 || start >= totalSize) return "unsatisfiable";
  if (!rawEnd) return { start, end: totalSize - 1 };
  const end = Number(rawEnd);
  if (!Number.isSafeInteger(end) || end < start) return "unsatisfiable";
  return { start, end: Math.min(end, totalSize - 1) };
}

/** Infer common image types from bytes; file-backed IDs deliberately have no suffix. */
export function detectKimiMediaType(data: Buffer): string {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 6 && (data.subarray(0, 6).toString("ascii") === "GIF87a" || data.subarray(0, 6).toString("ascii") === "GIF89a")) return "image/gif";
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (data.length >= 2 && data[0] === 0x42 && data[1] === 0x4d) return "image/bmp";
  if (data.length >= 4 && data.readUInt16LE(0) === 0 && data.readUInt16LE(2) === 1) return "image/x-icon";
  if (data.length >= 12 && data.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = data.subarray(8, 12).toString("ascii").toLowerCase();
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return "application/octet-stream";
}

async function readFileSegment(filePath: string, start: number, length: number): Promise<Buffer> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const data = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(data, offset, length - offset, start + offset);
      if (bytesRead === 0) throw new Error("Kimi media file ended unexpectedly");
      offset += bytesRead;
    }
    return data;
  } finally {
    await handle.close();
  }
}

async function readKimiMediaHeader(filePath: string, totalSize: number): Promise<Buffer> {
  // All recognized image magic values fit in the first 12 bytes. Keep video Range reads bounded.
  return readFileSegment(filePath, 0, Math.min(32, totalSize));
}

export async function readLocalKimiMediaFile(
  shareDir: string,
  fileId: string,
  rangeHeader?: string | null,
): Promise<LocalKimiMediaFile> {
  const filePath = resolveKimiMediaFilePath(shareDir, fileId);
  if (!filePath) throw new Error("Invalid file id");
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) throw new Error("Kimi media entry is not a file");
  const totalSize = stat.size;
  const range = resolveSingleByteRange(rangeHeader, totalSize);
  if (range === "unsatisfiable") {
    return { status: 416, data: Buffer.alloc(0), mediaType: "application/octet-stream", totalSize };
  }

  if (!range) {
    // dataUrl consumers require a complete payload; protocol Range requests take the bounded branch below.
    const data = await fs.promises.readFile(filePath);
    return { status: 200, data, mediaType: detectKimiMediaType(data), totalSize };
  }
  const [header, data] = await Promise.all([
    readKimiMediaHeader(filePath, totalSize),
    readFileSegment(filePath, range.start, range.end - range.start + 1),
  ]);
  return {
    status: 206,
    data,
    mediaType: detectKimiMediaType(header),
    totalSize,
    start: range.start,
    end: range.end,
  };
}
