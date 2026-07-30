import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { materializeSdkFilePartInDirectory } from "../../../electron/kimiCodeHost";

describe("materializeSdkFilePartInDirectory", () => {
  it("copies a generic file into the session attachment directory and returns an official notice", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-sdk-file-"));
    const sourceDir = path.join(tempDir, "downloads");
    const attachmentsDir = path.join(tempDir, "session", "attachments");
    fs.mkdirSync(sourceDir, { recursive: true });
    const sourcePath = path.join(sourceDir, "notes.md");
    fs.writeFileSync(sourcePath, "# Notes\n", "utf-8");
    try {
      const first = await materializeSdkFilePartInDirectory(attachmentsDir, {
        name: "notes.md",
        filePath: sourcePath,
        mediaType: "text/markdown",
      });
      const second = await materializeSdkFilePartInDirectory(attachmentsDir, {
        name: "notes.md",
        filePath: sourcePath,
        mediaType: "text/markdown",
      });

      expect(second).toEqual(first);
      expect(first.type).toBe("text");
      expect(first.text).toMatch(/^Attached file "notes\.md" \(text\/markdown, 8 bytes\): .+ — open it with the Read tool$/);
      const managedPath = first.text.match(/: (.+) — open it with the Read tool$/)?.[1];
      expect(managedPath).toBeTruthy();
      expect(fs.readFileSync(managedPath!, "utf-8")).toBe("# Notes\n");
      expect(fs.readdirSync(attachmentsDir)).toHaveLength(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects files above the bounded main-process limit before copying", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kimix-sdk-file-large-"));
    const sourcePath = path.join(tempDir, "large.bin");
    fs.writeFileSync(sourcePath, "");
    fs.truncateSync(sourcePath, 50 * 1024 * 1024 + 1);
    try {
      await expect(materializeSdkFilePartInDirectory(path.join(tempDir, "attachments"), {
        name: "large.bin",
        filePath: sourcePath,
      })).rejects.toThrow("超过 50MB 上限");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
