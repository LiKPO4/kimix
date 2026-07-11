import { describe, expect, it } from "vitest";
import { pickUpdateAssetForPlatform } from "@/utils/updateAsset";

const assets = [
  { name: "Kimix-2.15.0-arm64.dmg" },
  { name: "Kimix-2.15.0-arm64-mac.zip" },
  { name: "Kimix-2.15.0.dmg" },
  { name: "Kimix-2.15.0-mac.zip" },
];

describe("pickUpdateAssetForPlatform", () => {
  it("selects arm64 macOS assets without falling back to x64", () => {
    expect(pickUpdateAssetForPlatform(assets, "darwin", "arm64")?.name).toBe("Kimix-2.15.0-arm64.dmg");
  });

  it("recognizes legacy unmarked macOS x64 assets", () => {
    expect(pickUpdateAssetForPlatform(assets, "darwin", "x64")?.name).toBe("Kimix-2.15.0.dmg");
  });

  it("does not offer an arm64 package to Intel macOS when no x64 or universal asset exists", () => {
    expect(pickUpdateAssetForPlatform([{ name: "Kimix-2.15.0-arm64.dmg" }], "darwin", "x64")).toBeNull();
  });
});
