import { describe, expect, it } from "vitest";
import { findPreviewImageIndex, getPreviewImageNeighbor, type PreviewImage } from "../ImagePreviewOverlay";

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
