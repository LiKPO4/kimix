/**
 * Self-contained session history and listing utilities.
 *
 * Extracted from the former bridge layer so history parsing no longer depends on
 * a runtime SDK import.
 *
 * All functions operate purely on the filesystem — no SDK imports, no harness lifecycle.
 * The same wire.jsonl format is used by both old prompt-mode and new kimi-code sessions.
 */

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import * as fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionHistoryEvent {
  type: string;
  payload: unknown;
  time?: unknown;
}

export interface SessionInfo {
  id: string;
  workDir: string;
  contextFile: string;
  updatedAt: number;
  brief: string;
}

// ---------------------------------------------------------------------------
// Share / home directory resolution
// ---------------------------------------------------------------------------

function defaultKimiCodeShareDir() {
  return path.join(os.homedir(), ".kimi-code");
}

function legacyKimiShareDir() {
  return path.join(os.homedir(), ".kimi");
}

export function resolveKimiShareDir() {
  if (process.env.KIMI_CODE_HOME) return process.env.KIMI_CODE_HOME;
  if (process.env.KIMI_SHARE_DIR) return process.env.KIMI_SHARE_DIR;
  const current = defaultKimiCodeShareDir();
  const legacy = legacyKimiShareDir();
  if (fs.existsSync(current)) return current;
  if (fs.existsSync(legacy)) return legacy;
  return current;
}

export function candidateKimiShareDirs() {
  const dirs = process.env.KIMI_CODE_HOME
    ? [process.env.KIMI_CODE_HOME]
    : process.env.KIMI_SHARE_DIR
      ? [process.env.KIMI_SHARE_DIR]
      : [defaultKimiCodeShareDir(), legacyKimiShareDir()];
  return Array.from(new Set(dirs));
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export function readDefaultKimiModelFromConfig(): string | null {
  const configPath = path.join(resolveKimiShareDir(), "config.toml");
  if (!fs.existsSync(configPath)) return null;
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const match = raw.match(/^\s*default_model\s*=\s*"((?:\\.|[^"])*)"\s*$/m);
    return match ? match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim() || null : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function stripFileTags(text: string) {
  return text
    .replace(/<uploaded_files>[\s\S]*?<\/uploaded_files>\s*/g, "")
    .replace(/<document[^>]*>[\s\S]*?<\/document>\s*/g, "")
    .replace(/<image[^>]*>[\s\S]*?<\/image>\s*/g, "")
    .trim();
}

export function isInternalPromptText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return [
    /^只回复\s*(OK|NEW)$/i,
    /^【Kimix Hooks 上下文】/,
    /^【Kimix 需求澄清工具[:：]/,
    /^【Kimix 长程任务[:：]/,
    /^【Kimix 隐藏 Superpowers Bootstrap】/,
    /^<!-- kimix-superpowers-bootstrap -->/,
    /^请查看agent文档，给出用于交接下一个agent的提示词/,
    /^请作为(执行|审查)\s*agent/,
    /^你正在作为 Kimix 长程任务/,
    /^你是 Kimix Hooks 规则创建 agent/,
    /这是 Kimix 内部调度指令/,
  ].some((pattern) => pattern.test(normalized));
}

function extractUserText(userInput: unknown): string {
  if (typeof userInput === "string") return stripFileTags(userInput);
  if (Array.isArray(userInput)) {
    return stripFileTags(
      userInput
        .filter(
          (part): part is { type: string; text: string } =>
            part &&
            typeof part === "object" &&
            (part as { type?: unknown }).type === "text" &&
            typeof (part as { text?: unknown }).text === "string",
        )
        .map((part) => part.text)
        .join("\n"),
    );
  }
  return "";
}

export async function getFirstUserMessage(wireFile: string): Promise<string> {
  try {
    const stream = fs.createReadStream(wireFile, { encoding: "utf-8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as {
          type?: string;
          input?: unknown;
          message?: { type?: string; payload?: { user_input?: unknown } };
        };
        let userInput: unknown = undefined;
        if (record.message?.type === "TurnBegin") {
          userInput = record.message.payload?.user_input;
        } else if (record.type === "turn.prompt") {
          userInput = record.input;
        }
        if (userInput === undefined) continue;
        const text = extractUserText(userInput);
        if (text && !isInternalPromptText(text)) {
          rl.close();
          stream.destroy();
          return text;
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Ignore unreadable history files.
  }
  return "";
}

// ---------------------------------------------------------------------------
// Path helpers (inline replaces for old SDK's createKimiPaths)
// ---------------------------------------------------------------------------

export function sanitizeKimiWorkDirName(workDir: string) {
  const base = path.basename(path.resolve(workDir)).toLowerCase() || "default-project";
  return base.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "default-project";
}

export function kimiWorkDirBucketNames(workDir: string): string[] {
  const resolved = path.resolve(workDir);
  const normalized = resolved.replace(/\\/g, "/");
  const variants = Array.from(new Set([normalized, resolved]));
  return variants.map((value) => {
    const hash = createHash("sha256").update(value).digest("hex").slice(0, 12);
    return `wd_${sanitizeKimiWorkDirName(workDir)}_${hash}`;
  });
}

function kimiSessionDirNames(sessionId: string): string[] {
  const bare = sessionId.replace(/^(session_|ses_)/, "");
  return Array.from(new Set([sessionId, `session_${bare}`, `ses_${bare}`, bare]));
}

function getNewKimiWireFile(sessionDir: string) {
  return path.join(sessionDir, "agents", "main", "wire.jsonl");
}

// ---------------------------------------------------------------------------
// Session directory discovery
// ---------------------------------------------------------------------------

export async function findKimiCodeSessionDir(
  shareDir: string,
  workDir: string,
  sessionId: string,
): Promise<string | null> {
  const sessionsRoot = path.join(shareDir, "sessions");
  const names = kimiSessionDirNames(sessionId);
  const buckets = kimiWorkDirBucketNames(workDir);

  // Fast path: try known bucket names first.
  for (const bucket of buckets) {
    for (const name of names) {
      const candidate = path.join(sessionsRoot, bucket, name);
      if (fs.existsSync(getNewKimiWireFile(candidate))) return candidate;
    }
  }

  // Exhaustive fallback: scan all bucket dirs (handles any hash algorithm).
  const bucketEntries = await fsp.readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  for (const bucket of bucketEntries) {
    if (!bucket.isDirectory()) continue;
    const bucketDir = path.join(sessionsRoot, bucket.name);
    const sessionEntries = await fsp.readdir(bucketDir, { withFileTypes: true }).catch(() => []);
    for (const entry of sessionEntries) {
      if (!entry.isDirectory() || !names.includes(entry.name)) continue;
      const candidate = path.join(bucketDir, entry.name);
      if (fs.existsSync(getNewKimiWireFile(candidate))) return candidate;
    }
  }

  return null;
}

export async function getKimiCodeSessionDirs(
  shareDir: string,
  workDir: string,
): Promise<string[]> {
  const sessionsRoot = path.join(shareDir, "sessions");
  const buckets = new Set(kimiWorkDirBucketNames(workDir));
  const bucketEntries = await fsp.readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
  const dirs: string[] = [];

  // Only scan buckets that belong to the requested workDir. Scanning every
  // bucket (the previous behaviour) leaked sessions from other projects and the
  // plugin-management temp dir (os.tmpdir()/kimix-plugin-mgmt) into this list,
  // which made bootstrap resume the wrong SDK session and bind the chat to the
  // temp workDir. CLI 0.7.0 uses a stable hash, so the legacy-hash fallback is
  // no longer needed.
  const matchingBucketDirs: string[] = [];
  for (const bucket of bucketEntries) {
    if (!bucket.isDirectory()) continue;
    if (!buckets.has(bucket.name)) continue;
    matchingBucketDirs.push(bucket.name);
  }

  for (const bucketName of matchingBucketDirs) {
    const bucketDir = path.join(sessionsRoot, bucketName);
    const sessionEntries = await fsp.readdir(bucketDir, { withFileTypes: true }).catch(() => []);
    for (const entry of sessionEntries) {
      if (!entry.isDirectory() || !/^(session_|ses_)?[0-9a-f-]{36}$/i.test(entry.name)) continue;
      const sessionDir = path.join(bucketDir, entry.name);
      if (fs.existsSync(getNewKimiWireFile(sessionDir))) dirs.push(sessionDir);
    }
  }

  return dirs;
}

export function readKimiCodeSessionMetadata(
  sessionDir: string,
): { title?: string; updatedAt?: string; lastPrompt?: string } | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(sessionDir, "state.json"), "utf-8"),
    ) as { title?: string; updatedAt?: string; lastPrompt?: string };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Model resolution from wire.jsonl
// ---------------------------------------------------------------------------

export function readKimiCodeSessionModelFromWire(wireFile: string): string | null {
  if (!fs.existsSync(wireFile)) return null;
  try {
    const lines = fs.readFileSync(wireFile, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      const record = JSON.parse(line) as {
        type?: unknown;
        modelAlias?: unknown;
        model?: unknown;
      };
      if (
        record.type === "config.update" &&
        typeof record.modelAlias === "string" &&
        record.modelAlias.trim()
      ) {
        return record.modelAlias.trim();
      }
      if (
        record.type === "usage.record" &&
        typeof record.model === "string" &&
        record.model.trim()
      ) {
        return record.model.trim();
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function resolveSessionModel(
  workDir: string,
  sessionId: string,
  requestedModel?: string,
): Promise<string | undefined> {
  return (
    requestedModel ??
    (await readSessionModelFromShareDir(resolveKimiShareDir(), workDir, sessionId)) ??
    readDefaultKimiModelFromConfig() ??
    undefined
  );
}

async function readSessionModelFromShareDir(
  shareDir: string,
  workDir: string,
  sessionId: string,
): Promise<string | null> {
  // First try the new kimi-code session dir layout.
  const newSessionDir = await findKimiCodeSessionDir(shareDir, workDir, sessionId);
  if (newSessionDir) {
    const model = readKimiCodeSessionModelFromWire(getNewKimiWireFile(newSessionDir));
    if (model) return model;
  }

  // Legacy layout: <shareDir>/sessions/<bucket>/<sessionId>/wire.jsonl (any bucket).
  // findKimiCodeSessionDir already does an exhaustive scan, so this is for
  // edge-case non-bucket layouts.
  const simpleName = sanitizeKimiWorkDirName(workDir);
  const sessionsRoot = path.join(shareDir, "sessions");
  const legacyDir = path.join(sessionsRoot, simpleName, sessionId);
  if (fs.existsSync(path.join(legacyDir, "wire.jsonl"))) {
    return readKimiCodeSessionModelFromWire(path.join(legacyDir, "wire.jsonl"));
  }

  return null;
}

// ---------------------------------------------------------------------------
// Event parsing (local passthrough)
// ---------------------------------------------------------------------------

/**
 * Passes wire.jsonl message records through for renderer-side history mapping.
 */
function parseEventPayload(
  type: string,
  payload: unknown,
): { ok: true; value: SessionHistoryEvent } | { ok: false; error: string } {
  // The old parser could return { ok: false } for unknown event types; we keep the
  // same contract but accept everything — the renderer's mapHistoryEvents simply
  // skips events it doesn't recognise.
  return { ok: true, value: { type, payload } };
}

function parseKimiCodeRecord(record: Record<string, unknown>): SessionHistoryEvent | null {
  // New-format: { message: { type, payload } } (same as old wire format after passthrough).
  if (record.message && typeof record.message === "object") {
    const message = record.message as { type?: unknown; payload?: unknown };
    if (typeof message.type !== "string") return null;
    const result = parseEventPayload(message.type, message.payload);
    return result.ok ? result.value : null;
  }

  // Kimi-code turn prompt marker: emit as TurnBegin so history shows user messages.
  if (record.type === "turn.prompt") {
    return {
      type: "TurnBegin",
      payload: { user_input: record.input },
      time: record.time,
    };
  }

  if (typeof record.type === "string" && (
    record.type === "assistant.delta" ||
    record.type === "thinking.delta" ||
    record.type === "turn.ended" ||
    record.type === "tool.call.started" ||
    record.type === "tool.call.delta" ||
    record.type === "tool.result" ||
    record.type === "tool.progress" ||
    record.type === "subagent.spawned" ||
    record.type === "subagent.started" ||
    record.type === "subagent.suspended" ||
    record.type === "subagent.completed" ||
    record.type === "subagent.failed" ||
    record.type === "compaction.started" ||
    record.type === "compaction.completed" ||
    record.type === "compaction.cancelled" ||
    record.type === "warning" ||
    record.type === "error"
  )) {
    return {
      type: record.type,
      payload: record,
      time: record.time,
    };
  }

  // Loop events: content parts and step ends.
  if (record.type === "context.append_loop_event" && record.event && typeof record.event === "object") {
    const event = record.event as { type?: unknown; part?: unknown; time?: unknown };
    if (event.type === "content.part" && event.part && typeof event.part === "object") {
      return { type: "ContentPart", payload: event.part, time: event.time ?? record.time };
    }
    if (event.type === "step.end") {
      return { type: "TurnEnd", payload: {}, time: event.time ?? record.time };
    }
  }

  return null;
}

async function parseKimiCodeWireEvents(wireFile: string): Promise<SessionHistoryEvent[]> {
  if (!fs.existsSync(wireFile)) return [];
  const events: SessionHistoryEvent[] = [];
  const stream = fs.createReadStream(wireFile, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      const event = parseKimiCodeRecord(record);
      if (event) events.push(event);
    } catch {
      continue;
    }
  }
  return events;
}

async function parseSessionEventsFromShareDir(
  shareDir: string,
  workDir: string,
  sessionId: string,
): Promise<SessionHistoryEvent[]> {
  // New kimi-code format: sessions/<bucket>/<sessionId>/agents/main/wire.jsonl
  const newSessionDir = await findKimiCodeSessionDir(shareDir, workDir, sessionId);
  if (newSessionDir) {
    const events = await parseKimiCodeWireEvents(getNewKimiWireFile(newSessionDir));
    if (events.length > 0) return events;
  }

  // Legacy format fallback: sessions/<workDir>/<sessionId>/wire.jsonl (no bucket, no agents/main)
  const simpleName = sanitizeKimiWorkDirName(workDir);
  const sessionsRoot = path.join(shareDir, "sessions");
  const legacyWire = path.join(sessionsRoot, simpleName, sessionId, "wire.jsonl");
  if (!fs.existsSync(legacyWire)) return [];
  const events: SessionHistoryEvent[] = [];
  const stream = fs.createReadStream(legacyWire, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as { message?: { type?: string; payload?: unknown } };
      if (!record.message?.type) continue;
      const result = parseEventPayload(record.message.type, record.message.payload);
      if (result.ok) events.push(result.value);
    } catch {
      continue;
    }
  }
  return events;
}

async function readPromptModeSessionModelFromWire(wireFile: string) {
  return readKimiCodeSessionModelFromWire(wireFile);
}

// ---------------------------------------------------------------------------
// Session listing
// ---------------------------------------------------------------------------

export async function getSessions(workDir: string): Promise<SessionInfo[]> {
  const HIDDEN_PREFIXES = ["kimix-hidden-hooks-"];
  const byId = new Map<string, SessionInfo>();

  for (const shareDir of candidateKimiShareDirs()) {
    const newSessionDirs = await getKimiCodeSessionDirs(shareDir, workDir);

    for (const sessionDir of newSessionDirs) {
      const wireFile = getNewKimiWireFile(sessionDir);
      try {
        const st = await fsp.stat(wireFile);
        if (st.size === 0) continue;
        const metadata = readKimiCodeSessionMetadata(sessionDir);
        const firstMsg = await getFirstUserMessage(wireFile);
        const officialTitle = metadata?.title && metadata.title !== "New Session" ? metadata.title : "";
        const brief = officialTitle || firstMsg || metadata?.lastPrompt || "";
        if (!brief || isInternalPromptText(brief)) continue;
        const sessionId = path.basename(sessionDir);
        if (HIDDEN_PREFIXES.some((prefix) => sessionId.startsWith(prefix))) continue;
        const info: SessionInfo = {
          id: sessionId,
          workDir,
          contextFile: wireFile,
          updatedAt: metadata?.updatedAt ? Date.parse(metadata.updatedAt) || st.mtimeMs : st.mtimeMs,
          brief,
        };
        const existing = byId.get(sessionId);
        if (!existing || info.updatedAt > existing.updatedAt) byId.set(sessionId, info);
      } catch {
        continue;
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Parses wire.jsonl for a given (workDir, sessionId), handling both the new
 * kimi-code format and the old format equally — same wire file, same passthrough parser.
 */
export async function getSessionHistory(
  workDir: string,
  sessionId: string,
): Promise<SessionHistoryEvent[]> {
  for (const shareDir of candidateKimiShareDirs()) {
    const events = await parseSessionEventsFromShareDir(shareDir, workDir, sessionId);
    if (events.length > 0) return events;
  }
  return [];
}

/**
 * Scans all workDirs for a given sessionId (used when the workDir is unknown).
 */
export async function getSessionHistoryById(
  sessionId: string,
): Promise<SessionHistoryEvent[]> {
  for (const shareDir of candidateKimiShareDirs()) {
    const sessionsRoot = path.join(shareDir, "sessions");
    const bucketEntries = await fsp
      .readdir(sessionsRoot, { withFileTypes: true })
      .catch(() => []);
    for (const bucket of bucketEntries) {
      if (!bucket.isDirectory()) continue;
      const bucketDir = path.join(sessionsRoot, bucket.name);
      const sessionEntries = await fsp
        .readdir(bucketDir, { withFileTypes: true })
        .catch(() => []);
      for (const entry of sessionEntries) {
        if (!entry.isDirectory() || entry.name !== sessionId) continue;
        const sessionDir = path.join(bucketDir, entry.name);
        const wireFile = getNewKimiWireFile(sessionDir);
        if (!fs.existsSync(wireFile)) continue;
        const events = await parseKimiCodeWireEvents(wireFile);
        if (events.length > 0) return events;
      }
    }
  }
  return [];
}
