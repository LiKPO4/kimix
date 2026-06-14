import { describe, it, expect } from "vitest";
import {
  encodeOfficialWorkDirKey,
  kimiWorkDirBucketNames,
} from "../../../electron/sessionHistory";

/**
 * These assertions pin Kimix's read-side workDir->bucket hash to the EXACT
 * algorithm the vendored Kimi Code SDK uses when writing sessions. If they
 * diverge, sessions become invisible (the "dev vs packaged builds can't see
 * each other's messages" bug). The expected bucket names below are the real
 * on-disk directories under ~/.kimi-code/sessions/ as written by the SDK, so a
 * passing test proves Kimix reads the same bucket the SDK wrote.
 */
describe("encodeOfficialWorkDirKey (SDK algorithm parity)", () => {
  it("matches the real on-disk bucket for representative workDirs", () => {
    const cases: Array<[string, string]> = [
      ["D:/WORKS/Android Project/Project06", "wd_project06_34246546ba20"],
      ["D:/WORKS/Android Project/kimix", "wd_kimix_90b5212d0d7e"],
      ["C:/Users/Administrator", "wd_administrator_52e285c74c1f"],
      ["C:/Windows/System32", "wd_system32_ffa30e30ecb5"],
    ];
    for (const [workDir, expected] of cases) {
      expect(encodeOfficialWorkDirKey(workDir), `workDir=${workDir}`).toBe(expected);
    }
  });

  it("produces the same bucket regardless of slash direction on Windows", () => {
    // The SDK (pathe) normalizes backslashes to forward slashes, so both forms
    // must hash to the same bucket. This is the core of cross-build visibility.
    const forward = "D:/WORKS/Android Project/kimix";
    const back = "D:\\WORKS\\Android Project\\kimix";
    expect(encodeOfficialWorkDirKey(back)).toBe(encodeOfficialWorkDirKey(forward));
  });

  it("uppercases the leading drive letter (SDK pathe behaviour)", () => {
    // A lowercase drive letter must yield the same bucket as an uppercase one,
    // because the SDK force-uppercases the leading drive letter before hashing.
    const lower = "d:/WORKS/Android Project/kimix";
    const upper = "D:/WORKS/Android Project/kimix";
    expect(encodeOfficialWorkDirKey(lower)).toBe(encodeOfficialWorkDirKey(upper));
  });

  it("is case-preserving for the rest of the path (matches SDK)", () => {
    // Only the drive letter is uppercased; the rest is left as-is, so a path
    // with different casing elsewhere hashes differently (matches SDK).
    const a = encodeOfficialWorkDirKey("D:/WORKS/Android Project/kimix");
    const b = encodeOfficialWorkDirKey("D:/works/android project/kimix");
    expect(a).not.toBe(b);
  });
});

describe("kimiWorkDirBucketNames", () => {
  it("puts the official SDK bucket first", () => {
    const buckets = kimiWorkDirBucketNames("D:/WORKS/Android Project/kimix");
    expect(buckets[0]).toBe("wd_kimix_90b5212d0d7e");
    expect(buckets.length).toBeGreaterThanOrEqual(1);
  });

  it("deduplicates identical bucket names", () => {
    // POSIX-style paths have no backslashes, so the legacy variants collapse to
    // one entry; the result must still contain the official bucket.
    const buckets = kimiWorkDirBucketNames("D:/WORKS/Android Project/kimix");
    const unique = new Set(buckets);
    expect(unique.size).toBe(buckets.length);
    expect(unique.has("wd_kimix_90b5212d0d7e")).toBe(true);
  });
});
