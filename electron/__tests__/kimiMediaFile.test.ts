import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectKimiMediaType,
  readLocalKimiMediaFile,
  readLocalMediaFileAtPath,
  resolveKimiMediaBlobPath,
  resolveKimiMediaFilePath,
} from "../kimiMediaFile";

const tempDirs: string[] = [];

function createKimiHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-media-file-"));
  tempDirs.push(home);
  fs.mkdirSync(path.join(home, "files"), { recursive: true });
  return home;
}

function writeFile(home: string, fileId: string, bytes: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]) {
  fs.writeFileSync(path.join(home, "files", fileId), Buffer.from(bytes));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("Kimi file-backed media 本地受控回退", () => {
  it("从传入的自定义 KIMI_CODE_HOME files 目录读取图片，而非固定用户目录", async () => {
    const home = createKimiHome();
    writeFile(home, "f_custom-home");

    await expect(readLocalKimiMediaFile(home, "f_custom-home")).resolves.toMatchObject({
      status: 200,
      mediaType: "image/png",
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]),
    });
  });

  it("同一受控解析兼容 legacy .kimi 目录作为调用方传入的 shareDir", async () => {
    const legacyHome = createKimiHome();
    writeFile(legacyHome, "f_legacy");

    await expect(readLocalKimiMediaFile(legacyHome, "f_legacy")).resolves.toMatchObject({
      status: 200,
      mediaType: "image/png",
    });
  });

  it("拒绝非法 fileId 与路径逃逸", async () => {
    const home = createKimiHome();
    expect(resolveKimiMediaFilePath(home, "../config.toml")).toBeNull();
    expect(resolveKimiMediaFilePath(home, "f_../../config")).toBeNull();
    await expect(readLocalKimiMediaFile(home, "../config.toml")).rejects.toThrow("Invalid file id");
  });

  it("支持单个 bytes Range 并返回 206 和 Content-Range 所需元数据", async () => {
    const home = createKimiHome();
    writeFile(home, "f_range", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const fullRead = vi.spyOn(fs.promises, "readFile").mockRejectedValue(new Error("Range 不应整文件读取"));

    try {
      await expect(readLocalKimiMediaFile(home, "f_range", "bytes=2-5")).resolves.toMatchObject({
        status: 206,
        start: 2,
        end: 5,
        totalSize: 10,
        data: Buffer.from([2, 3, 4, 5]),
      });
      expect(fullRead).not.toHaveBeenCalled();
    } finally {
      fullRead.mockRestore();
    }
  });

  it("对超界 Range 返回 416 所需元数据而不是读取整个文件", async () => {
    const home = createKimiHome();
    writeFile(home, "f_range-invalid", [0, 1, 2]);

    await expect(readLocalKimiMediaFile(home, "f_range-invalid", "bytes=9-12")).resolves.toMatchObject({
      status: 416,
      totalSize: 3,
      data: Buffer.alloc(0),
    });
  });

  it("按二进制头识别常见无扩展名图片，供 dataUrl 回退使用", () => {
    expect(detectKimiMediaType(Buffer.from([0xff, 0xd8, 0xff, 0xdb]))).toBe("image/jpeg");
    expect(detectKimiMediaType(Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
  });
});

describe("Kimi blobref 会话 blob 解析", () => {
  function writeBlob(home: string, hash: string, bytes: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]) {
    const blobDir = path.join(home, "sessions", "wd_test", "session_blob", "agents", "main", "blobs");
    fs.mkdirSync(blobDir, { recursive: true });
    fs.writeFileSync(path.join(blobDir, hash), Buffer.from(bytes));
    return path.join(blobDir, hash);
  }

  it("按哈希解析会话目录 agents blobs 下的 blob 并支持 Range 读取", async () => {
    const home = createKimiHome();
    const hash = "8b621fe204cc9bfdc9adbf6c90f31ef28df85f5e390a8dd5d20a939b3144e235";
    const blobFile = writeBlob(home, hash);

    expect(resolveKimiMediaBlobPath([home], hash)).toBe(blobFile);
    await expect(readLocalMediaFileAtPath(blobFile, "bytes=0-3")).resolves.toMatchObject({
      status: 206,
      mediaType: "image/png",
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
  });

  it("拒绝非 sha256 十六进制哈希，blob 缺失返回 null", () => {
    const home = createKimiHome();
    expect(resolveKimiMediaBlobPath([home], "../config.toml")).toBeNull();
    expect(resolveKimiMediaBlobPath([home], "z".repeat(64))).toBeNull();
    expect(resolveKimiMediaBlobPath([home], "c".repeat(64))).toBeNull();
  });
});
