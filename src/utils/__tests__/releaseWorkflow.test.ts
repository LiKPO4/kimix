import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("release workflow notes gate", () => {
  it("fails the release instead of silently reusing stale fallback notes", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/release.yml"), "utf8");
    const validationStep = workflow.match(/- name: Validate release notes([\s\S]*?)\n\s+- name: Setup Node\.js/)?.[1] ?? "";
    const publishStep = workflow.match(/- name: Publish release([\s\S]*?)\n\s+- name: Generate and upload/)?.[1] ?? "";

    expect(validationStep).toContain('NOTES_FILE="docs/release-notes/${GITHUB_REF_NAME}.md"');
    expect(validationStep).toContain("exit 1");
    expect(publishStep).toContain('NOTES_FILE="docs/release-notes/${GITHUB_REF_NAME}.md"');
    expect(publishStep).toContain('echo "::error::Missing required release notes: $NOTES_FILE"');
    expect(publishStep).toContain("exit 1");
    expect(publishStep).not.toContain('NOTES_FILE="RELEASE_NOTES.md"');
    expect(workflow.indexOf("- name: Validate release notes")).toBeLessThan(workflow.indexOf("build-win:"));
  });
});
