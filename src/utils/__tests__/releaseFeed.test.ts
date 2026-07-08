import { describe, expect, it } from "vitest";
import { parseReleaseAtom } from "../../../electron/releaseFeed";

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
