import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const validator = path.resolve("scripts/validate-okf.mjs");

function createBundle(conceptFrontmatter: string) {
  const root = mkdtempSync(path.join(tmpdir(), "kimix-okf-validator-"));
  roots.push(root);
  mkdirSync(path.join(root, "concepts"));
  writeFileSync(path.join(root, "index.md"), `---\nokf_version: "0.1"\n---\n\n# Concepts\n\n* [Example](concepts/example.md) - Example concept.\n`);
  writeFileSync(path.join(root, "log.md"), "# Update Log\n\n## 2026-06-19\n* **Creation**: Added the example.\n");
  writeFileSync(path.join(root, "concepts", "index.md"), "# Example\n\n* [Example](example.md) - Example concept.\n");
  writeFileSync(path.join(root, "concepts", "example.md"), `---\n${conceptFrontmatter}\n---\n\n# Example\n\nA valid example.\n`);
  return root;
}

function validate(bundle: string, ...args: string[]) {
  return execFileSync(process.execPath, [validator, "--bundle", bundle, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("OKF validator", () => {
  it("accepts an OKF v0.1 bundle that satisfies the Kimix profile", () => {
    const bundle = createBundle('type: Reference\ntitle: Example\ndescription: Example concept.\ntags: [example]\ntimestamp: "2026-06-19T00:00:00Z"');
    expect(validate(bundle)).toContain("OKF v0.1 + Kimix strict profile: PASS");
  });

  it("rejects a concept without the normative type field", () => {
    const bundle = createBundle('title: Example\ndescription: Example concept.\ntags: [example]\ntimestamp: "2026-06-19T00:00:00Z"');
    expect(() => validate(bundle, "--spec-only")).toThrow(/requires a non-empty string 'type'/);
  });

  it("keeps upstream conformance separate from the stricter Kimix profile", () => {
    const bundle = createBundle("type: Reference");
    expect(validate(bundle, "--spec-only")).toContain("OKF v0.1 conformance: PASS");
    expect(() => validate(bundle)).toThrow(/Kimix profile requires a non-empty string 'title'/);
  });

  it("audits stale and orphan concepts deterministically", () => {
    const bundle = createBundle('type: Reference\ntitle: Example\ndescription: Example concept.\ntags: [example]\ntimestamp: "2025-01-01T00:00:00Z"');
    expect(() => validate(bundle, "--audit", "--now", "2026-06-20T00:00:00Z")).toThrow(/older than 180 days/);

    writeFileSync(path.join(bundle, "index.md"), '---\nokf_version: "0.1"\n---\n\n# Concepts\n\n* [Concepts](concepts/index.md) - Concept directory.\n');
    writeFileSync(path.join(bundle, "concepts", "index.md"), "# Example\n");
    expect(() => validate(bundle, "--audit", "--now", "2025-01-02T00:00:00Z")).toThrow(/orphan concept/);
  });

  it("accepts a current, indexed bundle in maintenance audit mode", () => {
    const bundle = createBundle('type: Reference\ntitle: Example\ndescription: Example concept.\ntags: [example]\ntimestamp: "2026-06-19T00:00:00Z"');
    expect(validate(bundle, "--audit", "--now", "2026-06-20T00:00:00Z")).toContain(
      "OKF v0.1 + Kimix maintenance audit (180 days): PASS",
    );
  });
});
