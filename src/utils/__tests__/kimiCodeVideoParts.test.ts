import { describe, expect, it } from "vitest";
import { materializeVideoFileReferences, type KimiCodePromptPart } from "../../../electron/kimiCodeHost";

describe("materializeVideoFileReferences", () => {
  it("passes string prompts through untouched", async () => {
    await expect(materializeVideoFileReferences("hello")).resolves.toBe("hello");
  });

  it("keeps parts that carry no server file reference", async () => {
    const parts: KimiCodePromptPart[] = [
      { type: "text", text: "hi" },
      { type: "video_url", videoUrl: { url: "https://example.com/clip.mp4", id: "clip.mp4" } },
    ];
    await expect(materializeVideoFileReferences(parts)).resolves.toEqual(parts);
  });

  it("skips the server download when the part already carries a data: URL", async () => {
    const parts: KimiCodePromptPart[] = [
      { type: "video_url", videoUrl: { url: "data:video/mp4;base64,AA==", id: "clip.mp4", fileId: "file-stale" } },
    ];
    // A download attempt would reject: no Kimi Server is running in tests.
    await expect(materializeVideoFileReferences(parts)).resolves.toEqual(parts);
  });

  it("still downloads file-only references through the server", async () => {
    const parts: KimiCodePromptPart[] = [
      { type: "video_url", videoUrl: { fileId: "file-remote" } },
    ];
    await expect(materializeVideoFileReferences(parts)).rejects.toThrow("Kimi Server");
  });
});
