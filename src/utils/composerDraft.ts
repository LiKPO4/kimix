export type ComposerDraftAttachment = {
  id: string;
  kind?: "image" | "video" | "file";
  name: string;
  dataUrl?: string;
  filePath?: string;
  fileId?: string;
  mediaType?: string;
  size?: number;
  url?: string;
};

export type ComposerDraft = {
  content: string;
  attachments: ComposerDraftAttachment[];
};

const STORAGE_PREFIX = "kimix_composer_draft_v1:";
const memoryDrafts = new Map<string, ComposerDraft>();

export function resolveComposerDraftKey(sessionId?: string | null, projectId?: string | null): string | null {
  if (sessionId?.trim()) return `session:${sessionId.trim()}`;
  if (projectId?.trim()) return `project:${projectId.trim()}:new`;
  return null;
}

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(key)}`;
}

function cloneDraft(draft: ComposerDraft): ComposerDraft {
  return {
    content: draft.content,
    attachments: draft.attachments.map((attachment) => ({ ...attachment })),
  };
}

export function readComposerDraft(key: string | null): ComposerDraft {
  if (!key) return { content: "", attachments: [] };
  const cached = memoryDrafts.get(key);
  if (cached) return cloneDraft(cached);
  try {
    if (typeof localStorage === "undefined") return { content: "", attachments: [] };
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return { content: "", attachments: [] };
    const parsed = JSON.parse(raw) as { content?: unknown };
    const content = typeof parsed.content === "string" ? parsed.content : "";
    const restored = { content, attachments: [] } satisfies ComposerDraft;
    if (content) memoryDrafts.set(key, restored);
    return cloneDraft(restored);
  } catch {
    return { content: "", attachments: [] };
  }
}

export function writeComposerDraft(key: string | null, draft: ComposerDraft): void {
  if (!key) return;
  const next = cloneDraft(draft);
  if (!next.content && next.attachments.length === 0) memoryDrafts.delete(key);
  else memoryDrafts.set(key, next);
  try {
    if (typeof localStorage === "undefined") return;
    if (next.content) {
      localStorage.setItem(storageKey(key), JSON.stringify({ content: next.content, updatedAt: Date.now() }));
    } else {
      localStorage.removeItem(storageKey(key));
    }
  } catch {
    // 内存副本仍然保护本次应用运行中的草稿；磁盘配额/权限错误不应打断输入。
  }
}

export function clearComposerDraft(key: string | null): void {
  if (!key) return;
  memoryDrafts.delete(key);
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(storageKey(key));
  } catch {
    // 清理失败不影响当前 Composer 已清空的状态。
  }
}

export function clearComposerDraftMemoryCache(): void {
  memoryDrafts.clear();
}
