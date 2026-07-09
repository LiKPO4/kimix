import { describe, expect, it } from "vitest";
import { findPreviewImageIndex, type PreviewImage } from "../ImagePreviewOverlay";

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
