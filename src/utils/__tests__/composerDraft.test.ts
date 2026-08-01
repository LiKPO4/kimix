// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearComposerDraft,
  clearComposerDraftMemoryCache,
  readComposerDraft,
  resolveComposerDraftKey,
  writeComposerDraft,
} from "../composerDraft";

describe("composerDraft", () => {
  beforeEach(() => {
    localStorage.clear();
    clearComposerDraftMemoryCache();
  });

  it("uses isolated keys for existing sessions and unsent project conversations", () => {
    expect(resolveComposerDraftKey("session-1", "project-1")).toBe("session:session-1");
    expect(resolveComposerDraftKey(null, "project-1")).toBe("project:project-1:new");
    expect(resolveComposerDraftKey(null, null)).toBeNull();
  });

  it("persists exact unsent text across an in-memory restart", () => {
    const key = resolveComposerDraftKey("session-1", "project-1");
    writeComposerDraft(key, { content: "  尚未发送的正文\n第二行  ", attachments: [] });
    clearComposerDraftMemoryCache();

    expect(readComposerDraft(key).content).toBe("  尚未发送的正文\n第二行  ");
  });

  it("keeps attachments in memory while the chat workspace is unmounted", () => {
    const key = resolveComposerDraftKey("session-1", "project-1");
    writeComposerDraft(key, {
      content: "附带文件",
      attachments: [{ id: "image-1", name: "截图.png", dataUrl: "data:image/png;base64,AA==" }],
    });

    expect(readComposerDraft(key).attachments).toEqual([
      { id: "image-1", name: "截图.png", dataUrl: "data:image/png;base64,AA==" },
    ]);
  });

  it("does not leak a draft into another session and removes explicit clears", () => {
    const first = resolveComposerDraftKey("session-1", "project-1");
    const second = resolveComposerDraftKey("session-2", "project-1");
    writeComposerDraft(first, { content: "会话一草稿", attachments: [] });

    expect(readComposerDraft(second).content).toBe("");
    clearComposerDraft(first);
    expect(readComposerDraft(first)).toEqual({ content: "", attachments: [] });
  });

  it("ignores corrupted persistent data instead of breaking the composer", () => {
    const key = resolveComposerDraftKey("session-broken", "project-1")!;
    localStorage.setItem(`kimix_composer_draft_v1:${encodeURIComponent(key)}`, "not-json");

    expect(readComposerDraft(key)).toEqual({ content: "", attachments: [] });
  });

  it("keeps the draft contract wired across workspace unmounts and conversation switches", () => {
    const composer = readFileSync(resolve(process.cwd(), "src/components/chat/Composer.tsx"), "utf8");
    const appShell = readFileSync(resolve(process.cwd(), "src/components/layout/AppShell.tsx"), "utf8");

    expect(composer).toContain("const initialDraft = useRef(readComposerDraft(composerDraftKey)).current;");
    expect(composer).toContain("writeComposerDraft(composerDraftKey, {");
    expect(appShell).toContain('<Composer key={currentSession?.id ?? `project:${currentProject?.id ?? "none"}`} />');
  });
});
