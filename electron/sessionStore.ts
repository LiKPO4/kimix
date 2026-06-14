import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { app } from "electron";
import type { SessionPersistenceState } from "./types/ipc";

const STATE_FILE_NAME = "kimix-session-state.json";
const SUMMARY_FILE_NAME = "kimix-session-summary-state.json";
const SESSION_RECORDS_DIR_NAME = "kimix-session-records";
let cachedState: SessionPersistenceState | null = null;
let cachedMtimeMs = 0;

export function getSessionStatePath(): string {
  return path.join(app.getPath("userData"), STATE_FILE_NAME);
}

function getSessionSummaryPath(): string {
  return path.join(app.getPath("userData"), SUMMARY_FILE_NAME);
}

function getSessionRecordsDir(): string {
  return path.join(app.getPath("userData"), SESSION_RECORDS_DIR_NAME);
}

function getSessionRecordPath(id: string): string {
  const digest = createHash("sha1").update(id).digest("hex");
  return path.join(getSessionRecordsDir(), `${digest}.json`);
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(filePath: string, value: unknown) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value), "utf8");
  fs.renameSync(tmpPath, filePath);
}

function defaultState(): SessionPersistenceState {
  return {
    updatedAt: 0,
    sessions: [],
    pendingMessages: [],
    activeContext: null,
    archivedTombstones: [],
    hiddenHandoffSessionIds: [],
  };
}

export function normalizeState(value: unknown): SessionPersistenceState {
  if (!value || typeof value !== "object") return defaultState();
  const raw = value as Record<string, unknown>;
  const normalizeStringArray = (v: unknown): string[] => {
    if (!Array.isArray(v)) return [];
    return v.filter((item): item is string => typeof item === "string");
  };
  return {
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    pendingMessages: Array.isArray(raw.pendingMessages) ? raw.pendingMessages : [],
    activeContext: raw.activeContext ?? null,
    archivedTombstones: Array.isArray(raw.archivedTombstones) ? raw.archivedTombstones : [],
    hiddenHandoffSessionIds: normalizeStringArray(raw.hiddenHandoffSessionIds),
  };
}

function getRecordNumber(value: unknown, key: string) {
  return value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "number"
    ? (value as Record<string, number>)[key]
    : 0;
}

function getRecordString(value: unknown, key: string) {
  return value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "string"
    ? (value as Record<string, string>)[key]
    : "";
}

function eventCount(value: unknown) {
  return value && typeof value === "object" && Array.isArray((value as { events?: unknown }).events)
    ? (value as { events: unknown[] }).events.length
    : 0;
}

function pickRicherRecord(current: unknown, incoming: unknown) {
  const incomingEvents = eventCount(incoming);
  const currentEvents = eventCount(current);
  if (incomingEvents > currentEvents) return incoming;
  if (incomingEvents < currentEvents) return current;
  return getRecordNumber(incoming, "updatedAt") >= getRecordNumber(current, "updatedAt") ? incoming : current;
}

function mergeObjectArraysById(left: unknown[], right: unknown[]) {
  const byId = new Map<string, unknown>();
  const append = (item: unknown) => {
    const id = getRecordString(item, "id");
    if (!id) return;
    const existing = byId.get(id);
    byId.set(id, existing ? pickRicherRecord(existing, item) : item);
  };
  left.forEach(append);
  right.forEach(append);
  return Array.from(byId.values()).sort((a, b) => getRecordNumber(b, "updatedAt") - getRecordNumber(a, "updatedAt"));
}

function mergeStringArrays(left: string[], right: string[]) {
  return Array.from(new Set([...left, ...right].filter(Boolean))).slice(-1000);
}

function stripSessionEvents(session: unknown) {
  if (!session || typeof session !== "object" || Array.isArray(session)) return session;
  const events = Array.isArray((session as { events?: unknown }).events)
    ? (session as { events: unknown[] }).events
    : [];
  return {
    ...(session as Record<string, unknown>),
    events: [],
    persistedEventCount: events.length,
  };
}

function toSummaryState(state: SessionPersistenceState): SessionPersistenceState {
  return {
    ...state,
    sessions: state.sessions.map(stripSessionEvents),
  };
}

function isSummaryCacheFresh() {
  const summaryPath = getSessionSummaryPath();
  if (!fs.existsSync(summaryPath)) return false;
  const statePath = getSessionStatePath();
  if (!fs.existsSync(statePath)) return true;
  return fs.statSync(summaryPath).mtimeMs + 2 >= fs.statSync(statePath).mtimeMs;
}

function writeSummaryCache(state: SessionPersistenceState) {
  writeJsonAtomic(getSessionSummaryPath(), toSummaryState(state));
}

function writeSessionRecordCache(sessions: unknown[]) {
  if (sessions.length === 0) return;
  const recordsDir = getSessionRecordsDir();
  ensureDir(recordsDir);
  for (const session of sessions) {
    const id = getRecordString(session, "id");
    if (!id) continue;
    writeJsonAtomic(getSessionRecordPath(id), session);
  }
}

function rebuildSessionCaches(state: SessionPersistenceState) {
  writeSummaryCache(state);
  writeSessionRecordCache(state.sessions);
}

function readSummaryCache(): SessionPersistenceState | null {
  try {
    if (!isSummaryCacheFresh()) return null;
    const raw = fs.readFileSync(getSessionSummaryPath(), "utf8");
    return normalizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function readSessionRecordCache(id: string): unknown | null {
  try {
    if (!isSummaryCacheFresh()) return null;
    const filePath = getSessionRecordPath(id);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function mergeSessionStates(current: SessionPersistenceState, incoming: SessionPersistenceState): SessionPersistenceState {
  const currentActiveUpdatedAt = getRecordNumber(current.activeContext, "updatedAt");
  const incomingActiveUpdatedAt = getRecordNumber(incoming.activeContext, "updatedAt");
  return {
    updatedAt: Math.max(current.updatedAt, incoming.updatedAt, Date.now()),
    sessions: mergeObjectArraysById(current.sessions, incoming.sessions),
    pendingMessages: mergeObjectArraysById(current.pendingMessages, incoming.pendingMessages),
    activeContext: incomingActiveUpdatedAt >= currentActiveUpdatedAt ? incoming.activeContext : current.activeContext,
    archivedTombstones: mergeObjectArraysById(current.archivedTombstones, incoming.archivedTombstones),
    hiddenHandoffSessionIds: mergeStringArrays(current.hiddenHandoffSessionIds, incoming.hiddenHandoffSessionIds),
  };
}

export function readSessionState(): SessionPersistenceState {
  try {
    const filePath = getSessionStatePath();
    if (!fs.existsSync(filePath)) return defaultState();
    const stat = fs.statSync(filePath);
    if (cachedState && cachedMtimeMs === stat.mtimeMs) return cachedState;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const state = normalizeState(parsed);
    cachedState = state;
    cachedMtimeMs = stat.mtimeMs;
    return state;
  } catch (err) {
    console.error("[sessionStore] read failed:", err);
    return defaultState();
  }
}

export function readSessionSummaryState(): SessionPersistenceState {
  const cachedSummary = readSummaryCache();
  if (cachedSummary) return cachedSummary;
  const state = readSessionState();
  rebuildSessionCaches(state);
  return toSummaryState(state);
}

export function getPersistedSession(id: string): unknown | null {
  const normalizedId = id.trim();
  if (!normalizedId) return null;
  const cachedRecord = readSessionRecordCache(normalizedId);
  if (cachedRecord) return cachedRecord;
  const state = readSessionState();
  rebuildSessionCaches(state);
  return state.sessions.find((session) => getRecordString(session, "id") === normalizedId) ?? null;
}

export function writeSessionState(state: SessionPersistenceState, sessionCacheCandidates: unknown[] = state.sessions): void {
  try {
    const filePath = getSessionStatePath();
    const dir = path.dirname(filePath);
    ensureDir(dir);
    writeJsonAtomic(filePath, state);
    writeSummaryCache(state);
    writeSessionRecordCache(sessionCacheCandidates);
    const stat = fs.statSync(filePath);
    cachedState = state;
    cachedMtimeMs = stat.mtimeMs;
  } catch (err) {
    console.error("[sessionStore] write failed:", err);
  }
}
