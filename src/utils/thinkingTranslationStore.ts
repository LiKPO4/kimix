import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  buildThinkingTranslationChunk,
  DEFAULT_THINKING_TRANSLATION_INTERVAL_MS,
  isMostlyChineseThinking,
  joinThinkingTranslations,
  restoreThinkingCode,
  thinkingTranslationJoinSeparator,
} from "./thinkingTranslation";

export type ThinkingTranslationSnapshot = {
  sourceText: string;
  translatedText: string;
  translatedSourceEnd: number;
  status: "idle" | "translating" | "error";
  error?: string;
};

type TranslationEntry = ThinkingTranslationSnapshot & {
  key: string;
  intervalMs: number;
  finalRequested: boolean;
  inFlight: boolean;
  dirty: boolean;
  requestVersion: number;
  lastRequestStartedAt: number;
  retryCount: number;
  lastAccessAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  snapshot: ThinkingTranslationSnapshot;
  listeners: Set<() => void>;
};

const EMPTY_SNAPSHOT: ThinkingTranslationSnapshot = {
  sourceText: "",
  translatedText: "",
  translatedSourceEnd: 0,
  status: "idle",
};

const entries = new Map<string, TranslationEntry>();
const queuedKeys = new Set<string>();
let activeRequestCount = 0;
const MAX_CONCURRENT_REQUESTS = 2;
const MAX_CACHED_ENTRIES = 160;

function disposeEntry(entry: TranslationEntry) {
  entry.requestVersion += 1;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  queuedKeys.delete(entry.key);
  entries.delete(entry.key);
}

function trimInactiveEntries() {
  if (entries.size < MAX_CACHED_ENTRIES) return;
  const inactive = [...entries.values()]
    .filter((entry) => entry.listeners.size === 0 && !entry.inFlight)
    .sort((a, b) => a.lastAccessAt - b.lastAccessAt);
  while (entries.size >= MAX_CACHED_ENTRIES && inactive.length > 0) {
    disposeEntry(inactive.shift()!);
  }
}

function snapshotOf(entry: TranslationEntry): ThinkingTranslationSnapshot {
  return {
    sourceText: entry.sourceText,
    translatedText: entry.translatedText,
    translatedSourceEnd: entry.translatedSourceEnd,
    status: entry.status,
    ...(entry.error ? { error: entry.error } : {}),
  };
}

function publish(entry: TranslationEntry) {
  entry.snapshot = snapshotOf(entry);
  for (const listener of entry.listeners) listener();
}

function createEntry(key: string): TranslationEntry {
  trimInactiveEntries();
  const entry: TranslationEntry = {
    ...EMPTY_SNAPSHOT,
    key,
    intervalMs: DEFAULT_THINKING_TRANSLATION_INTERVAL_MS,
    finalRequested: false,
    inFlight: false,
    dirty: false,
    requestVersion: 0,
    // Live thinking gets one coalescing window before its first network call.
    // Settled blocks pass final=true and still flush immediately.
    lastRequestStartedAt: Date.now(),
    retryCount: 0,
    lastAccessAt: Date.now(),
    timer: null,
    snapshot: EMPTY_SNAPSHOT,
    listeners: new Set(),
  };
  entries.set(key, entry);
  return entry;
}

function getEntry(key: string): TranslationEntry {
  const entry = entries.get(key) ?? createEntry(key);
  entry.lastAccessAt = Date.now();
  return entry;
}

function enqueue(key: string) {
  queuedKeys.add(key);
  pumpQueue();
}

function pumpQueue() {
  while (activeRequestCount < MAX_CONCURRENT_REQUESTS && queuedKeys.size > 0) {
    const key = queuedKeys.values().next().value as string | undefined;
    if (!key) return;
    queuedKeys.delete(key);
    const entry = entries.get(key);
    if (!entry || entry.listeners.size === 0 || entry.inFlight) continue;
    activeRequestCount += 1;
    void translateNextChunk(entry).finally(() => {
      activeRequestCount = Math.max(0, activeRequestCount - 1);
      pumpQueue();
    });
  }
}

function schedule(entry: TranslationEntry, immediate = false) {
  if (entry.timer || entry.inFlight || entry.listeners.size === 0) {
    if (entry.inFlight) entry.dirty = true;
    return;
  }
  const elapsed = Date.now() - entry.lastRequestStartedAt;
  const delay = immediate ? 0 : Math.max(0, entry.intervalMs - elapsed);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    enqueue(entry.key);
  }, delay);
}

function scheduleRetry(entry: TranslationEntry, delayMs: number) {
  if (entry.timer || entry.listeners.size === 0) return;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    enqueue(entry.key);
  }, Math.max(2_000, Math.min(30_000, delayMs)));
}

function retryDelayFor(code: string, retryAfterMs?: number): number | null {
  if (code === "rate_limited") return retryAfterMs ?? 10_000;
  if (code === "timeout" || code === "network_error" || code === "provider_error") return 5_000;
  return null;
}

async function translateNextChunk(entry: TranslationEntry): Promise<void> {
  if (entry.inFlight || entry.listeners.size === 0) return;
  const chunk = buildThinkingTranslationChunk(
    entry.sourceText,
    entry.translatedSourceEnd,
    entry.finalRequested,
  );
  if (!chunk) return;
  const joinSeparator = thinkingTranslationJoinSeparator(entry.sourceText.slice(0, entry.translatedSourceEnd));

  if (isMostlyChineseThinking(chunk.sourceText)) {
    entry.translatedText = joinThinkingTranslations(
      entry.translatedText,
      chunk.sourceText,
      joinSeparator,
    );
    entry.translatedSourceEnd = chunk.sourceEnd;
    entry.status = "idle";
    entry.error = undefined;
    publish(entry);
    if (entry.translatedSourceEnd < entry.sourceText.length) schedule(entry, entry.finalRequested);
    return;
  }

  entry.inFlight = true;
  entry.dirty = false;
  entry.status = "translating";
  entry.error = undefined;
  entry.lastRequestStartedAt = Date.now();
  const version = entry.requestVersion;
  const requestId = `${entry.key}:${version}:${chunk.sourceEnd}:${entry.lastRequestStartedAt}`;
  publish(entry);

  try {
    const response = await window.api.translateThinking({ text: chunk.protectedText, requestId });
    if (version !== entry.requestVersion || entry.listeners.size === 0) return;
    if (!response.success) {
      entry.status = "error";
      entry.error = response.error.message;
      publish(entry);
      const retryDelay = retryDelayFor(response.error.code, response.error.retryAfterMs);
      if (retryDelay !== null) {
        entry.retryCount += 1;
        scheduleRetry(entry, retryDelay * Math.min(4, entry.retryCount));
      }
      return;
    }
    const translated = restoreThinkingCode(response.data.translatedText, chunk.placeholders);
    entry.translatedText = joinThinkingTranslations(
      entry.translatedText,
      translated,
      joinSeparator,
    );
    entry.translatedSourceEnd = chunk.sourceEnd;
    entry.status = "idle";
    entry.retryCount = 0;
    publish(entry);
  } catch (error) {
    if (version !== entry.requestVersion) return;
    entry.status = "error";
    entry.error = error instanceof Error ? error.message : String(error);
    publish(entry);
  } finally {
    entry.inFlight = false;
    if (entry.listeners.size === 0) return;
    if (version !== entry.requestVersion) {
      if (entry.status !== "error" && entry.translatedSourceEnd < entry.sourceText.length) schedule(entry, entry.finalRequested);
      return;
    }
    const hasPendingSource = entry.translatedSourceEnd < entry.sourceText.length;
    if ((entry.dirty || entry.finalRequested) && hasPendingSource && entry.status !== "error") {
      schedule(entry, entry.finalRequested);
    }
  }
}

export function updateThinkingTranslationSource(options: {
  key: string;
  sourceText: string;
  intervalMs?: number;
  final?: boolean;
}) {
  const entry = getEntry(options.key);
  const sourceText = options.sourceText;
  const isAppend = sourceText.startsWith(entry.sourceText);
  let seededFromCompatibleEntry = false;
  if (!isAppend) {
    entry.requestVersion += 1;
    entry.translatedText = "";
    entry.translatedSourceEnd = 0;
    entry.status = "idle";
    entry.error = undefined;
    entry.retryCount = 0;
  }
  entry.sourceText = sourceText;
  entry.intervalMs = Math.max(2000, Math.min(3000, options.intervalMs ?? DEFAULT_THINKING_TRANSLATION_INTERVAL_MS));
  entry.finalRequested = Boolean(options.final);
  if (options.final && entry.translatedSourceEnd === 0 && !entry.translatedText) {
    const compatible = [...entries.values()]
      .filter((candidate) => candidate !== entry && candidate.translatedSourceEnd > 0 && candidate.translatedText)
      .filter((candidate) => (
        sourceText.slice(0, candidate.translatedSourceEnd) === candidate.sourceText.slice(0, candidate.translatedSourceEnd)
      ))
      .sort((a, b) => b.translatedSourceEnd - a.translatedSourceEnd)[0];
    if (compatible) {
      entry.translatedText = compatible.translatedText;
      entry.translatedSourceEnd = compatible.translatedSourceEnd;
      entry.status = "idle";
      seededFromCompatibleEntry = true;
    }
  }
  // Appended deltas already rendered this leaf once through the canonical draft
  // subscription. Do not publish the same source change through a second store
  // subscription; only a reset needs to invalidate an existing translated prefix.
  if (!isAppend || seededFromCompatibleEntry) publish(entry);
  if (entry.translatedSourceEnd < sourceText.length && entry.status !== "error") {
    schedule(entry, entry.finalRequested);
  }
}

export function clearThinkingTranslation(key: string) {
  const entry = entries.get(key);
  if (!entry) return;
  disposeEntry(entry);
}

export function retryVisibleThinkingTranslations() {
  for (const entry of entries.values()) {
    if (entry.translatedSourceEnd >= entry.sourceText.length) continue;
    entry.status = "idle";
    entry.error = undefined;
    entry.retryCount = 0;
    if (entry.listeners.size > 0) {
      publish(entry);
      schedule(entry, true);
    }
  }
}

export function clearThinkingTranslationsAfterCredentialRemoval() {
  for (const entry of [...entries.values()]) {
    entry.requestVersion += 1;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    queuedKeys.delete(entry.key);
    if (entry.listeners.size === 0 && !entry.inFlight) {
      entries.delete(entry.key);
      continue;
    }
    entry.translatedText = "";
    entry.translatedSourceEnd = 0;
    entry.status = "error";
    entry.error = "翻译凭据已清除";
    entry.retryCount = 0;
    publish(entry);
  }
}

function subscribe(key: string, listener: () => void) {
  const entry = getEntry(key);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size > 0) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    queuedKeys.delete(key);
    entry.requestVersion += 1;
    entry.lastAccessAt = Date.now();
    trimInactiveEntries();
  };
}

export function useThinkingTranslation(options: {
  key: string;
  sourceText: string;
  enabled: boolean;
  intervalMs?: number;
  final?: boolean;
}): ThinkingTranslationSnapshot {
  const subscribeStore = useCallback(
    (listener: () => void) => options.enabled ? subscribe(options.key, listener) : () => {},
    [options.enabled, options.key],
  );
  const getSnapshot = useCallback(
    () => options.enabled ? (entries.get(options.key)?.snapshot ?? EMPTY_SNAPSHOT) : EMPTY_SNAPSHOT,
    [options.enabled, options.key],
  );
  const snapshot = useSyncExternalStore(
    subscribeStore,
    getSnapshot,
    () => EMPTY_SNAPSHOT,
  );

  useEffect(() => {
    if (!options.enabled) {
      clearThinkingTranslation(options.key);
      return;
    }
    updateThinkingTranslationSource(options);
  }, [options.enabled, options.final, options.intervalMs, options.key, options.sourceText]);

  return snapshot;
}

export function resetThinkingTranslationStoreForTests() {
  for (const entry of entries.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  entries.clear();
  queuedKeys.clear();
  activeRequestCount = 0;
}
