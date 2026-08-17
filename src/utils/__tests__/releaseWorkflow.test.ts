import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("release workflow contract", () => {
  it("fails the release instead of silently reusing stale fallback notes", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/release.yml"), "utf8");
    const validationStep = workflow.match(/- name: Validate release notes([\s\S]*?)\n\s+- name: Setup Node\.js/)?.[1] ?? "";
    const publishStep = workflow.match(/- name: Create draft release and upload all platform artifacts([\s\S]*?)\n\s+- name: Generate checksums and publish release/)?.[1] ?? "";

    expect(validationStep).toContain('NOTES_FILE="docs/release-notes/${GITHUB_REF_NAME}.md"');
    expect(validationStep).toContain("exit 1");
    expect(publishStep).toContain('NOTES_FILE="docs/release-notes/${GITHUB_REF_NAME}.md"');
    expect(publishStep).toContain('echo "::error::Missing required release notes: $NOTES_FILE"');
    expect(publishStep).toContain("exit 1");
    expect(publishStep).not.toContain('NOTES_FILE="RELEASE_NOTES.md"');
    expect(workflow.indexOf("- name: Validate release notes")).toBeLessThan(workflow.indexOf("build-win:"));
  });

  it("builds in parallel but gives final publication to one serial job", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/release.yml"), "utf8");

    expect(workflow).not.toContain("--publish always");
    expect(workflow.match(/--publish never/g)).toHaveLength(3);
    expect(workflow.match(/actions\/upload-artifact@v4/g)).toHaveLength(3);
    expect(workflow).toContain("actions/download-artifact@v4");
    expect(workflow).toContain("merge-multiple: true");
    expect(workflow.match(/gh release create/g)).toHaveLength(1);
    expect(workflow.match(/--draft=false --latest/g)).toHaveLength(1);
  });
});
