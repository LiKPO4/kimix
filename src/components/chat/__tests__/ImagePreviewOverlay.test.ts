import { describe, expect, it, vi } from "vitest";
import { findPreviewImageIndex, getPreviewImageNeighbor, materializePreviewImageDataUrl, type PreviewImage } from "../ImagePreviewOverlay";

const img: PreviewImage = { name: "a.png", dataUrl: "data:a", id: "img-1" };
const imgNoId: PreviewImage = { name: "b.png", dataUrl: "data:b" };
const list: PreviewImage[] = [
  img,
  { name: "c.png", dataUrl: "data:c", id: "img-3" },
  imgNoId,
];

describe("findPreviewImageIndex", () => {
  it("matches by id", () => {
    expect(findPreviewImageIndex(img, list)).toBe(0);
  });

  it("matches by dataUrl when there is no id", () => {
    expect(findPreviewImageIndex(imgNoId, list)).toBe(2);
  });

  it("matches by dataUrl when id is not found in the list", () => {
    const orphan = { name: "d.png", dataUrl: "data:a", id: "img-missing" };
    // id "img-missing" doesn't exist, but dataUrl "data:a" matches index 0
    expect(findPreviewImageIndex(orphan, list)).toBe(0);
  });

  it("returns -1 when neither id nor dataUrl matches", () => {
    const unknown: PreviewImage = { name: "x.png", dataUrl: "data:x" };
    expect(findPreviewImageIndex(unknown, list)).toBe(-1);
  });

  it("returns -1 for an empty list", () => {
    expect(findPreviewImageIndex(img, [])).toBe(-1);
  });

  it("keeps distinct file-backed images distinct when both data URLs are empty", () => {
    const streamed: PreviewImage[] = [
      { name: "f_first", fileId: "f_first", dataUrl: "", url: "kimix-media://server-file/f_first" },
      { name: "f_second", fileId: "f_second", dataUrl: "", url: "kimix-media://server-file/f_second" },
    ];

    expect(findPreviewImageIndex(streamed[1], streamed)).toBe(1);
    expect(getPreviewImageNeighbor(streamed[1], streamed, -1)).toBe(streamed[0]);
  });
});

describe("materializePreviewImageDataUrl", () => {
  it("loads a file-backed image into a usable data URL for copy and drawing", async () => {
    const loadFile = vi.fn().mockResolvedValue({
      success: true,
      data: { fileId: "f_image", mediaType: "image/png", dataUrl: "data:image/png;base64,AA==" },
    });

    await expect(materializePreviewImageDataUrl({
      name: "f_image",
      fileId: "f_image",
      dataUrl: "",
      url: "kimix-media://server-file/f_image",
    }, loadFile)).resolves.toBe("data:image/png;base64,AA==");
    expect(loadFile).toHaveBeenCalledWith({ fileId: "f_image" });
  });

  it("rejects an unavailable stream instead of handing an empty data URL to copy or drawing", async () => {
    const loadFile = vi.fn().mockResolvedValue({ success: false, error: "File not found" });

    await expect(materializePreviewImageDataUrl({
      name: "f_missing",
      fileId: "f_missing",
      dataUrl: "",
    }, loadFile)).rejects.toThrow("File not found");
  });

  it("loads a blobref image from local session blobs for copy and drawing", async () => {
    const blobRef = "b".repeat(64);
    const loadFile = vi.fn().mockResolvedValue({
      success: true,
      data: { fileId: blobRef, mediaType: "image/png", dataUrl: "data:image/png;base64,AA==" },
    });

    await expect(materializePreviewImageDataUrl({
      name: "图片 2",
      blobRef,
      dataUrl: "",
      url: `kimix-media://blob/${blobRef}`,
    }, loadFile)).resolves.toBe("data:image/png;base64,AA==");
    expect(loadFile).toHaveBeenCalledWith({ fileId: undefined, blobRef });
  });
});

describe("blobref 预览导航", () => {
  it("keeps distinct blobref images distinct when data URLs are empty", () => {
    const streamed: PreviewImage[] = [
      { name: "图片 2", blobRef: "a".repeat(64), dataUrl: "" },
      { name: "图片 3", blobRef: "b".repeat(64), dataUrl: "" },
    ];

    expect(findPreviewImageIndex(streamed[1], streamed)).toBe(1);
    expect(getPreviewImageNeighbor(streamed[1], streamed, -1)).toBe(streamed[0]);
  });
});

describe("getPreviewImageNeighbor", () => {
  it("returns the previous image", () => {
    expect(getPreviewImageNeighbor(list[1], list, -1)).toBe(list[0]);
  });

  it("returns the next image", () => {
    expect(getPreviewImageNeighbor(list[0], list, 1)).toBe(list[1]);
  });

  it("returns null at the first image when going backward", () => {
    expect(getPreviewImageNeighbor(list[0], list, -1)).toBeNull();
  });

  it("returns null at the last image when going forward", () => {
    expect(getPreviewImageNeighbor(list[2], list, 1)).toBeNull();
  });

  it("returns null when current image is not in the list", () => {
    const unknown: PreviewImage = { name: "x.png", dataUrl: "data:x" };
    expect(getPreviewImageNeighbor(unknown, list, 1)).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(getPreviewImageNeighbor(img, [], -1)).toBeNull();
    expect(getPreviewImageNeighbor(img, [], 1)).toBeNull();
  });

  it("matches by dataUrl when id is not found", () => {
    const orphan = { name: "d.png", dataUrl: "data:a", id: "img-missing" };
    expect(getPreviewImageNeighbor(orphan, list, 1)).toBe(list[1]);
  });
});
