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

const LEGACY_STORAGE_PREFIX = "kimix_composer_draft_v1:";
const STORAGE_PREFIX = "kimix_composer_draft_v2:";
const WRITER_SESSION_KEY = "kimix_composer_draft_writer_v1";
const MAX_PERSISTED_WRITERS_PER_DRAFT = 12;
const memoryDrafts = new Map<string, ComposerDraft>();
let writerIdCache: string | null = null;

export function resolveComposerDraftKey(sessionId?: string | null, projectId?: string | null): string | null {
  if (sessionId?.trim()) return `session:${sessionId.trim()}`;
  if (projectId?.trim()) return `project:${projectId.trim()}:new`;
  return null;
}

function legacyStorageKey(key: string): string {
  return `${LEGACY_STORAGE_PREFIX}${encodeURIComponent(key)}`;
}

function draftStoragePrefix(key: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(key)}:`;
}

function writerId(): string {
  if (writerIdCache) return writerIdCache;
  try {
    const existing = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(WRITER_SESSION_KEY);
    if (existing) {
      writerIdCache = existing;
      return existing;
    }
  } catch {
    // sessionStorage 不可用时仍可用本次 renderer 的内存身份隔离草稿。
  }
  const generated = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  writerIdCache = generated;
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(WRITER_SESSION_KEY, generated);
  } catch {
    // 写入失败只会让窗口刷新后生成新槽，不会让并行窗口共用一个槽。
  }
  return generated;
}

function storageKey(key: string): string {
  return `${draftStoragePrefix(key)}${encodeURIComponent(writerId())}`;
}

function readPersistedContent(key: string): string {
  if (typeof localStorage === "undefined") return "";
  const parse = (raw: string | null): { content: string; updatedAt: number } | null => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { content?: unknown; updatedAt?: unknown };
      if (typeof parsed.content !== "string") return null;
      return {
        content: parsed.content,
        updatedAt: typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0,
      };
    } catch {
      return null;
    }
  };
  const own = parse(localStorage.getItem(storageKey(key)));
  if (own) return own.content;
  const candidates: Array<{ content: string; updatedAt: number }> = [];
  const collect = (raw: string | null) => {
    const parsed = parse(raw);
    // 空内容是一次权威清空，而不是“没有候选”。renderer 重启后 writerId 会变化，
    // 若忽略较新的空槽，就会从其他旧 writer 槽恢复用户已经删除的文字。
    if (parsed) candidates.push(parsed);
  };
  collect(localStorage.getItem(legacyStorageKey(key)));
  const prefix = draftStoragePrefix(key);
  for (let index = 0; index < localStorage.length; index += 1) {
    const candidateKey = localStorage.key(index);
    if (candidateKey?.startsWith(prefix)) collect(localStorage.getItem(candidateKey));
  }
  candidates.sort((left, right) => right.updatedAt - left.updatedAt);
  return candidates[0]?.content ?? "";
}

function prunePersistedWriters(key: string, keepKey: string): void {
  if (typeof localStorage === "undefined") return;
  const prefix = draftStoragePrefix(key);
  const slots: Array<{ key: string; updatedAt: number }> = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const candidateKey = localStorage.key(index);
    if (!candidateKey?.startsWith(prefix)) continue;
    let updatedAt = 0;
    try {
      const parsed = JSON.parse(localStorage.getItem(candidateKey) ?? "") as { updatedAt?: unknown };
      if (typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)) updatedAt = parsed.updatedAt;
    } catch {
      // 损坏槽按最旧记录处理，优先在超限时清理。
    }
    slots.push({ key: candidateKey, updatedAt });
  }
  slots.sort((left, right) => right.updatedAt - left.updatedAt);
  for (const slot of slots.slice(MAX_PERSISTED_WRITERS_PER_DRAFT)) {
    if (slot.key !== keepKey) localStorage.removeItem(slot.key);
  }
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
    const content = readPersistedContent(key);
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
    const currentStorageKey = storageKey(key);
    if (next.content) {
      localStorage.setItem(currentStorageKey, JSON.stringify({
        content: next.content,
        updatedAt: Date.now(),
        writerId: writerId(),
      }));
    } else {
      localStorage.setItem(currentStorageKey, JSON.stringify({
        content: "",
        updatedAt: Date.now(),
        writerId: writerId(),
      }));
    }
    prunePersistedWriters(key, currentStorageKey);
    localStorage.removeItem(legacyStorageKey(key));
  } catch {
    // 内存副本仍然保护本次应用运行中的草稿；磁盘配额/权限错误不应打断输入。
  }
}

export function clearComposerDraft(key: string | null): void {
  if (!key) return;
  memoryDrafts.delete(key);
  try {
    if (typeof localStorage !== "undefined") {
      const currentStorageKey = storageKey(key);
      localStorage.setItem(currentStorageKey, JSON.stringify({
        content: "",
        updatedAt: Date.now(),
        writerId: writerId(),
      }));
      prunePersistedWriters(key, currentStorageKey);
      localStorage.removeItem(legacyStorageKey(key));
    }
  } catch {
    // 清理失败不影响当前 Composer 已清空的状态。
  }
}

export function clearComposerDraftMemoryCache(): void {
  memoryDrafts.clear();
}
