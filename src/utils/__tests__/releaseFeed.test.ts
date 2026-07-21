import { describe, expect, it } from "vitest";
import {
  buildGithubReleaseAssetUrl,
  electronBuilderLatestYmlName,
  mergeReleaseAssets,
  parseElectronBuilderLatestYml,
  parseReleaseAtom,
  releaseHasInstallerAsset,
} from "../../../electron/releaseFeed";

describe("parseReleaseAtom", () => {
  it("parses enclosure assets regardless of link attribute order", () => {
    const releases = parseReleaseAtom(`
      <entry>
        <title>v2.15.0</title>
        <updated>2026-07-08T00:00:00Z</updated>
        <link href="https://github.com/LiKPO4/kimix/releases/tag/v2.15.0" rel="alternate" />
        <link length="1234" title="Kimix-Setup.exe" href="https://example.com/Kimix-Setup.exe" rel="enclosure" />
        <content>&lt;p&gt;更新内容&lt;/p&gt;</content>
      </entry>
    `, 3, "https://github.com/LiKPO4/kimix/releases");

    expect(releases[0]).toMatchObject({
      tagName: "v2.15.0",
      assets: [{ name: "Kimix-Setup.exe", downloadUrl: "https://example.com/Kimix-Setup.exe", size: 1234 }],
    });
  });

  it("does not throw for malformed percent encoding or decode a title fallback", () => {
    expect(() => parseReleaseAtom(`
      <entry><title>release%ZZ</title><link rel="alternate" href="https://github.com/LiKPO4/kimix/releases/tag/release%ZZ" /></entry>
      <entry><title>title%ZZ</title></entry>
    `, 3, "https://github.com/LiKPO4/kimix/releases")).not.toThrow();
    const releases = parseReleaseAtom(`
      <entry><title>release%ZZ</title><link rel="alternate" href="https://github.com/LiKPO4/kimix/releases/tag/release%ZZ" /></entry>
      <entry><title>title%ZZ</title></entry>
    `, 3, "https://github.com/LiKPO4/kimix/releases");
    expect(releases.map((release) => release.tagName)).toEqual(["release%ZZ", "title%ZZ"]);
  });
});

describe("parseElectronBuilderLatestYml", () => {
  it("parses windows latest.yml installers with sha512 and size", () => {
    const parsed = parseElectronBuilderLatestYml(`
version: 2.16.88
files:
  - url: Kimix-Setup-2.16.88.exe
    sha512: EHiCM0lQ+rEOZ1jOk2hFiog+OyWnhjQ1UUZwXPmN5l+SUGwEXJQL0SUi+C2ZMCsK8SBNZSLobWjwTF7k3rAfCw==
    size: 96689127
path: Kimix-Setup-2.16.88.exe
sha512: EHiCM0lQ+rEOZ1jOk2hFiog+OyWnhjQ1UUZwXPmN5l+SUGwEXJQL0SUi+C2ZMCsK8SBNZSLobWjwTF7k3rAfCw==
releaseDate: '2026-07-21T10:07:35.238Z'
`, "LiKPO4/kimix");

    expect(parsed).toMatchObject({
      version: "2.16.88",
      tagName: "v2.16.88",
      publishedAt: "2026-07-21T10:07:35.238Z",
    });
    expect(parsed?.assets).toEqual([
      {
        name: "Kimix-Setup-2.16.88.exe",
        downloadUrl: "https://github.com/LiKPO4/kimix/releases/download/v2.16.88/Kimix-Setup-2.16.88.exe",
        size: 96689127,
        sha512: "EHiCM0lQ+rEOZ1jOk2hFiog+OyWnhjQ1UUZwXPmN5l+SUGwEXJQL0SUi+C2ZMCsK8SBNZSLobWjwTF7k3rAfCw==",
      },
    ]);
    expect(releaseHasInstallerAsset(parsed?.assets ?? [])).toBe(true);
  });

  it("parses multi-arch mac latest-mac.yml without dropping arm64 assets", () => {
    const parsed = parseElectronBuilderLatestYml(`
version: 2.16.88
files:
  - url: Kimix-2.16.88-x64.dmg
    sha512: aaa
    size: 1
  - url: Kimix-2.16.88-arm64.dmg
    sha512: bbb
    size: 2
path: Kimix-2.16.88-x64.dmg
sha512: aaa
releaseDate: "2026-07-21T10:08:43.347Z"
`, "LiKPO4/kimix");

    expect(parsed?.assets.map((asset) => asset.name)).toEqual([
      "Kimix-2.16.88-x64.dmg",
      "Kimix-2.16.88-arm64.dmg",
    ]);
  });
});

describe("release feed helpers", () => {
  it("builds download urls and platform yml names", () => {
    expect(buildGithubReleaseAssetUrl("LiKPO4/kimix", "v2.16.88", "Kimix-Setup-2.16.88.exe"))
      .toBe("https://github.com/LiKPO4/kimix/releases/download/v2.16.88/Kimix-Setup-2.16.88.exe");
    expect(electronBuilderLatestYmlName("win32")).toBe("latest.yml");
    expect(electronBuilderLatestYmlName("darwin")).toBe("latest-mac.yml");
    expect(electronBuilderLatestYmlName("linux")).toBe("latest-linux.yml");
  });

  it("merges atom empty assets with yml installers and keeps checksums", () => {
    const merged = mergeReleaseAssets(
      [{ name: "notes.md", downloadUrl: "https://example.com/notes.md" }],
      [{
        name: "Kimix-Setup-2.16.88.exe",
        downloadUrl: "https://github.com/LiKPO4/kimix/releases/download/v2.16.88/Kimix-Setup-2.16.88.exe",
        size: 10,
        sha512: "abc",
      }],
    );
    expect(releaseHasInstallerAsset(merged)).toBe(true);
    expect(merged.find((asset) => asset.name.endsWith(".exe"))?.sha512).toBe("abc");
  });
});
