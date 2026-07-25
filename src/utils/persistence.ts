import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Project, Session, TimelineEvent, UserMessageImage } from "@/types/ui";
import type { PendingMessage } from "@/stores/sessionStore";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import { isSamePath } from "@/utils/pathCase";
import { deduplicateTimelineEvents } from "@/utils/eventMapper";
import {
  getPrimaryRoomAgent,
  getRoomAgentRuntimeId,
  isPrimaryRoomAgent,
  normalizeLoadedSessionCollaboration,
  roomAgentActivityKey,
  scopeEventToRoomAgent,
  synchronizeCollaborationPrimaryMirror,
} from "@/utils/collaborationRooms";
import { sanitizePersistedEvents, settleInactiveEvents } from "./eventHelpers";
import { timeAsync } from "./perfDiag";
import { stripLegacyKimixClarificationWrapper } from "./eventMapper";
import {
  commitState,
  deleteImages,
  getAllImageIds,
  getStateItem,
  loadImages,
  removeStateItem,
  type StoredImage,
} from "./stateStorage";

export const LOCAL_SESSIONS_KEY = "kimix_sessions";
export const LOCAL_PENDING_KEY = "kimix_pending";
export const LOCAL_ACTIVE_CONTEXT_KEY = "kimix_active_context";
export const LOCAL_ARCHIVED_SESSION_TOMBSTONES_KEY = "kimix_archived_session_tombstones";
export const LOCAL_SESSIONS_INDEX_KEY = "kimix_local_sessions_index";
export const LOCAL_SESSION_PREFIX = "kimix_local_session_";
export const LOCAL_PERSIST_DEBOUNCE_MS = 900;

const STREAMING_PERSIST_DEBOUNCE_MS = 5000;
const STREAMING_MAX_PERSIST_WAIT_MS = 60_000;
const IDLE_MAX_PERSIST_WAIT_MS = 5000;
const STARTUP_PERSIST_DEBOUNCE_MS = 10_000;
const STARTUP_MAX_PERSIST_WAIT_MS = 30_000;
const STARTUP_WINDOW_MS = 30_000;

/**
 * Persist cadence for the debounced session-state writer. Each persist walks
 * and serializes the whole sessions value (tens of MB for long sessions:
 * stringify + IndexedDB structured clone on the main thread), so while the
 * agent is actively streaming we trade durability window for UI
 * responsiveness: at most one persist per minute, with an explicit flush when
 * streaming ends, on archive/delete, on visibility loss, and on unload.
 * Server-backed sessions re-import from canonical history after a crash, so
 * the wider window is safe.
 *
 * The startup window (first 30s of renderer lifetime) gets the same trade:
 * the history-repair loop and catalog sync each produce real setState changes
 * that would otherwise schedule near-immediate full persists (measured: two
 * 70MB persists ≈ 3.3s of long tasks during startup), so the idle cadence
 * stretches to a 10s debounce with a 30s ceiling to coalesce the storm into
 * at most 1-2 writes. The explicit flush paths (archive/delete, streaming
 * end, visibility loss, beforeunload) never go through this function and are
 * unaffected; repairs are idempotent and re-run on the next launch, so the
 * wider durability window is safe. `startupWindowActive` is injectable for
 * tests; when omitted it is probed from performance.now().
 */
export function resolvePersistDelayMs(options: {
  streaming: boolean;
  elapsedSincePersistMs: number;
  startupWindowActive?: boolean;
}): number {
  const startupWindowActive = options.startupWindowActive
    ?? (typeof performance !== "undefined" && performance.now() < STARTUP_WINDOW_MS);
  const debounce = options.streaming
    ? STREAMING_PERSIST_DEBOUNCE_MS
    : startupWindowActive ? STARTUP_PERSIST_DEBOUNCE_MS : LOCAL_PERSIST_DEBOUNCE_MS;
  const maxWait = options.streaming
    ? STREAMING_MAX_PERSIST_WAIT_MS
    : startupWindowActive ? STARTUP_MAX_PERSIST_WAIT_MS : IDLE_MAX_PERSIST_WAIT_MS;
  return Math.max(0, Math.min(debounce, maxWait - options.elapsedSincePersistMs));
}

export type LocalActiveContext = {
  project: Project | null;
  sessionId: string | null;
  updatedAt: number;
};

export type ArchivedSessionTombstone = {
  ids: string[];
  projectPath: string;
  title?: string;
  archivedAt: number;
};

export type PersistResult = { success: true } | { success: false; error: string };

let persistErrorHandler: ((error: Error) => void) | null = null;
const rememberedRoomSessions = new Map<string, Session>();

function rememberCollaborationSessions(sessions: Session[]) {
  sessions.forEach((session) => {
    if (session.collaboration) rememberedRoomSessions.set(session.id, session);
  });
}

function restoreRememberedCollaboration(session: Session): Session {
  if (session.collaboration || session.unsupportedCollaboration) return session;
  const remembered = rememberedRoomSessions.get(session.id);
  if (!remembered?.collaboration || !isSamePath(remembered.projectPath, session.projectPath)) return session;
  const restored = normalizeLoadedSessionCollaboration({
    ...remembered,
    ...session,
    updatedAt: Math.max(session.updatedAt, remembered.collaboration.primaryMirrorUpdatedAt + 1),
    events: session.events,
    collaboration: remembered.collaboration,
  });
  return restored.collaboration ? synchronizeCollaborationPrimaryMirror(restored) : session;
}

export function onPersistError(handler: ((error: Error) => void) | null) {
  persistErrorHandler = handler;
}

function reportPersistError(context: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[persistence] ${context} failed:`, error);
  if (persistErrorHandler) {
    try {
      persistErrorHandler(new Error(`${context}: ${message}`));
    } catch {
      // Avoid crashing the caller if the handler itself throws.
    }
  }
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("kimix:toast", { detail: `状态保存失败：${message}` }));
    } catch {
      // Ignore toast dispatch failures.
    }
  }
}

export function resetStaleSessionRecommendationEvents(events: TimelineEvent[]) {
  let changed = false;
  const nextEvents = events.map((event) => {
    if (event.type !== "session_recommendation" || event.handoffStatus !== "running") return event;
    changed = true;
    const { handoffStatus: _handoffStatus, handoffError: _handoffError, ...rest } = event;
    return rest;
  });
  return changed ? nextEvents : events;
}

function normalizePathForArchive(value: string | undefined) {
  return (value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function sessionArchiveIds(session: Pick<Session, "id" | "runtimeSessionId" | "officialSessionId" | "longTask">) {
  return Array.from(new Set([
    session.id,
    session.runtimeSessionId,
    session.officialSessionId,
    session.longTask?.executorSessionId,
    session.longTask?.reviewerSessionId,
  ].filter((id): id is string => Boolean(id))));
}

export function getArchivedSessionTombstones(): ArchivedSessionTombstone[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_ARCHIVED_SESSION_TOMBSTONES_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): ArchivedSessionTombstone[] => {
      if (!item || typeof item !== "object") return [];
      const ids = Array.isArray((item as { ids?: unknown }).ids)
        ? (item as { ids: unknown[] }).ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
        : [];
      const projectPath = typeof (item as { projectPath?: unknown }).projectPath === "string"
        ? (item as { projectPath: string }).projectPath
        : "";
      const archivedAt = typeof (item as { archivedAt?: unknown }).archivedAt === "number"
        ? (item as { archivedAt: number }).archivedAt
        : 0;
      if (ids.length === 0 || !projectPath || !archivedAt) return [];
      return [{
        ids,
        projectPath,
        title: typeof (item as { title?: unknown }).title === "string" ? (item as { title: string }).title : undefined,
        archivedAt,
      }];
    });
  } catch {
    return [];
  }
}

function writeArchivedSessionTombstones(tombstones: ArchivedSessionTombstone[]) {
  localStorage.setItem(LOCAL_ARCHIVED_SESSION_TOMBSTONES_KEY, JSON.stringify(tombstones.slice(-5000)));
}

export function rememberArchivedSessionTombstone(session: Session) {
  const ids = sessionArchiveIds(session);
  if (ids.length === 0 || !session.projectPath) return;
  const projectPath = session.projectPath;
  const archivedAt = session.archivedAt ?? Date.now();
  const next: ArchivedSessionTombstone = {
    ids,
    projectPath,
    title: session.title,
    archivedAt,
  };
  const existing = getArchivedSessionTombstones().filter((item) => {
    if (normalizePathForArchive(item.projectPath) !== normalizePathForArchive(projectPath)) return true;
    return !item.ids.some((id) => ids.includes(id));
  });
  writeArchivedSessionTombstones([...existing, next]);
}

export function forgetArchivedSessionTombstone(session: Session) {
  const ids = sessionArchiveIds(session);
  if (ids.length === 0) return;
  writeArchivedSessionTombstones(getArchivedSessionTombstones().filter((item) => !item.ids.some((id) => ids.includes(id))));
}

export function forgetArchivedSessionTombstonesByIds(ids: string[]) {
  const normalizedIds = new Set(ids.filter((id) => typeof id === "string" && Boolean(id.trim())));
  if (normalizedIds.size === 0) return;
  writeArchivedSessionTombstones(getArchivedSessionTombstones().filter((item) => !item.ids.some((id) => normalizedIds.has(id))));
}

export function isArchivedSessionTombstoned(ids: Array<string | undefined | null>, projectPath?: string) {
  const normalizedIds = new Set(ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim())));
  if (normalizedIds.size === 0) return false;
  const normalizedProjectPath = normalizePathForArchive(projectPath);
  return getArchivedSessionTombstones().some((item) => {
    if (normalizedProjectPath && normalizePathForArchive(item.projectPath) !== normalizedProjectPath) return false;
    return item.ids.some((id) => normalizedIds.has(id));
  });
}

export function getHiddenHandoffSessionIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem("kimix_hidden_handoff_sessions") ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function rememberHiddenHandoffSession(sessionId: string) {
  const ids = Array.from(new Set([...getHiddenHandoffSessionIds(), sessionId]));
  localStorage.setItem("kimix_hidden_handoff_sessions", JSON.stringify(ids.slice(-50)));
}

export function persistLocalActiveContext() {
  try {
    const appState = useAppStore.getState();
    const currentSession = appState.currentSession;
    const sessionId = currentSession && !currentSession.archivedAt && !isHiddenInternalSession(currentSession)
      ? currentSession.id
      : null;
    const payload: LocalActiveContext = {
      project: appState.currentProject,
      sessionId,
      updatedAt: Date.now(),
    };
    localStorage.setItem(LOCAL_ACTIVE_CONTEXT_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn("Persist local active context failed:", err);
  }
}

export function readLocalActiveContext(): LocalActiveContext | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_ACTIVE_CONTEXT_KEY) ?? "null");
    if (!parsed || typeof parsed !== "object") return null;
    const project = (parsed as { project?: unknown }).project;
    const validProject = project && typeof project === "object" &&
      typeof (project as { id?: unknown }).id === "string" &&
      typeof (project as { path?: unknown }).path === "string" &&
      typeof (project as { name?: unknown }).name === "string" &&
      typeof (project as { lastOpenedAt?: unknown }).lastOpenedAt === "number"
      ? project as Project
      : null;
    const sessionId = typeof (parsed as { sessionId?: unknown }).sessionId === "string"
      ? (parsed as { sessionId: string }).sessionId
      : null;
    const updatedAt = typeof (parsed as { updatedAt?: unknown }).updatedAt === "number"
      ? (parsed as { updatedAt: number }).updatedAt
      : 0;
    return { project: validProject, sessionId, updatedAt };
  } catch {
    return null;
  }
}

async function makeImageRef(dataUrl: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataUrl));
      return Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      // Fall through to the non-cryptographic fallback.
    }
  }
  return `img-${dataUrl.length}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type PersistedImageRef = Omit<UserMessageImage, "dataUrl"> & { imageRef?: string };

async function extractImages(
  images: UserMessageImage[] | undefined,
  into: StoredImage[],
): Promise<PersistedImageRef[] | undefined> {
  if (!images || images.length === 0) return undefined;
  const out: PersistedImageRef[] = [];
  for (const image of images) {
    if (image.dataUrl && image.dataUrl.length > 0) {
      const id = await makeImageRef(image.dataUrl);
      into.push({
        id,
        name: image.name,
        kind: image.kind,
        dataUrl: image.dataUrl,
        filePath: image.filePath,
        fileId: image.fileId,
        mediaType: image.mediaType,
        url: image.url,
      });
      out.push({
        name: image.name,
        kind: image.kind,
        filePath: image.filePath,
        fileId: image.fileId,
        mediaType: image.mediaType,
        url: image.url,
        imageRef: id,
      });
    } else {
      out.push({
        name: image.name,
        kind: image.kind,
        filePath: image.filePath,
        fileId: image.fileId,
        mediaType: image.mediaType,
        url: image.url,
      });
    }
  }
  return out;
}

async function stripImagesFromSessions(sessions: Session[], into: StoredImage[]): Promise<unknown[]> {
  return Promise.all(
    sessions.map(async (session) => {
      const stripEvents = (events: TimelineEvent[]) => Promise.all(
        events.map(async (event) => {
          if (event.type !== "user_message" && event.type !== "steer_message") return event;
          const images = await extractImages(event.images, into);
          return { ...event, images } as unknown as TimelineEvent;
        }),
      );
      const strippedEvents = await stripEvents(session.events);
      const { unsupportedCollaboration, ...storedSession } = session;
      if (unsupportedCollaboration) {
        return {
          ...storedSession,
          collaboration: unsupportedCollaboration.raw,
          events: strippedEvents,
        };
      }
      if (!session.collaboration) return { ...storedSession, events: strippedEvents };

      const messages = await Promise.all(session.collaboration.messages.map(async (message) => ({
        ...message,
        images: await extractImages(message.images, into),
      })));
      const agentEvents = Object.fromEntries(await Promise.all(
        Object.entries(session.collaboration.agentEvents).map(async ([agentId, events]) => (
          [agentId, await stripEvents(events)] as const
        )),
      ));
      return {
        ...storedSession,
        events: strippedEvents,
        collaboration: {
          ...session.collaboration,
          messages,
          agentEvents,
        },
      };
    })
  );
}

async function stripImagesFromPending(pending: PendingMessage[], into: StoredImage[]): Promise<unknown[]> {
  return Promise.all(
    pending.map(async (message) => {
      const images = await extractImages(message.images, into);
      return { ...message, images };
    })
  );
}

function collectImageRefsFromSessions(sessions: unknown[], refs: Set<string>): void {
  for (const item of sessions) {
    if (!item || typeof item !== "object") continue;
    const session = item as { events?: TimelineEvent[]; collaboration?: { messages?: { images?: { imageRef?: string }[] }[] } };
    for (const event of session.events ?? []) {
      if (event.type === "user_message" || event.type === "steer_message") {
        for (const img of (event as Extract<TimelineEvent, { type: "user_message" }>).images ?? []) {
          const ref = (img as { imageRef?: string }).imageRef;
          if (ref) refs.add(ref);
        }
      }
    }
    if (session.collaboration?.messages) {
      for (const msg of session.collaboration.messages) {
        for (const img of msg.images ?? []) {
          if (img?.imageRef) refs.add(img.imageRef);
        }
      }
    }
  }
}

function collectImageRefsFromPending(pending: unknown[], refs: Set<string>): void {
  for (const item of pending) {
    if (!item || typeof item !== "object") continue;
    const msg = item as { images?: { imageRef?: string }[] };
    for (const img of msg.images ?? []) {
      if (img?.imageRef) refs.add(img.imageRef);
    }
  }
}

function hydrateMessageImages(
  images: (UserMessageImage & { imageRef?: string })[] | undefined,
  dataUrlById: Map<string, string>,
): UserMessageImage[] | undefined {
  if (!images || images.length === 0) return undefined;
  return images.map((image) => {
    if (image.imageRef) {
      return {
        ...image,
        dataUrl: dataUrlById.get(image.imageRef) ?? image.dataUrl,
      };
    }
    return image;
  });
}

function hydrateSessions(raw: unknown[], dataUrlById: Map<string, string>): Session[] {
  const sessions = raw.map((item) => {
    const hydrateEvents = (events: TimelineEvent[]) => events.map((event) => {
      if (event.type !== "user_message" && event.type !== "steer_message") return event;
      return {
        ...event,
        content: event.type === "user_message"
          ? stripLegacyKimixClarificationWrapper(event.content)
          : event.content,
        images: hydrateMessageImages(
          event.images as (UserMessageImage & { imageRef?: string })[] | undefined,
          dataUrlById,
        ),
      } as TimelineEvent;
    });
    const session = normalizeLoadedSessionCollaboration(item as Session);
    const hydrated: Session = {
      ...session,
      events: hydrateEvents(session.events),
    };
    if (!session.collaboration) return hydrated;
    const collaboration = {
      ...session.collaboration,
      messages: session.collaboration.messages.map((message) => ({
        ...message,
        content: stripLegacyKimixClarificationWrapper(message.content),
        outboundContent: message.outboundContent
          ? stripLegacyKimixClarificationWrapper(message.outboundContent)
          : message.outboundContent,
        images: hydrateMessageImages(
          message.images as (UserMessageImage & { imageRef?: string })[] | undefined,
          dataUrlById,
        ),
      })),
      agentEvents: Object.fromEntries(Object.entries(session.collaboration.agentEvents).map(([agentId, events]) => (
        [agentId, hydrateEvents(events)]
      ))),
    };
    return synchronizeCollaborationPrimaryMirror({ ...hydrated, collaboration });
  });
  rememberCollaborationSessions(sessions);
  return sessions;
}

function hydratePending(raw: unknown[], dataUrlById: Map<string, string>): PendingMessage[] {
  return raw.map((item) => {
    const message = item as PendingMessage;
    return {
      ...message,
      images: hydrateMessageImages(
        message.images as (UserMessageImage & { imageRef?: string })[] | undefined,
        dataUrlById,
      ),
    };
  });
}

type PersistSnapshot = {
  sessions: Session[];
  originalSessions: Session[];
  pendingMessages: PendingMessage[];
};

let persistQueue: PersistSnapshot | null = null;
let isPersisting = false;
let activePersistPromise: Promise<PersistResult> | null = null;

// Reference guard against redundant persists. Hydration registers the arrays
// it is about to setState, and every successful write re-registers the
// references it captured, so a persist triggered by state that is already
// durable (e.g. the subscription flush right after startup hydration
// re-applies the sessions it just read from disk) can return before the
// expensive prepare + strip + stringify walk over the whole sessions value.
let lastPersistedSessionsRef: Session[] | null = null;
let lastPersistedPendingRef: PendingMessage[] | null = null;

export function markConversationStatePersisted(sessions?: Session[], pendingMessages?: PendingMessage[]): void {
  if (sessions !== undefined) lastPersistedSessionsRef = sessions;
  if (pendingMessages !== undefined) lastPersistedPendingRef = pendingMessages;
}

type SessionIndexEntry = {
  id: string;
  updatedAt: number;
  archivedAt?: number;
  projectPath: string;
};

type SessionIndex = {
  version: 2;
  entries: SessionIndexEntry[];
};

function sessionIndexEntry(session: Session): SessionIndexEntry {
  return {
    id: session.id,
    updatedAt: session.updatedAt,
    archivedAt: session.archivedAt,
    projectPath: session.projectPath ?? "",
  };
}

function sessionKey(id: string): string {
  return `${LOCAL_SESSION_PREFIX}${id}`;
}

// Per-session reference cache established on hydration and updated on persist.
// runPersist compares current session references against this cache to skip
// unchanged sessions. Module-level to survive across persist calls.
let hydratedSessionRefs = new Map<string, Session>();

async function runPersist(snapshot: PersistSnapshot): Promise<PersistResult> {
  isPersisting = true;
  const runStart = performance.now();
  let stripMs = 0;
  let commitMs = 0;
  try {
    const images: StoredImage[] = [];
    const stripStart = performance.now();

    // Determine which sessions changed by comparing original refs against cache.
    const changedIds = new Set<string>();
    const currentIds = new Set<string>();
    const indexEntries: SessionIndexEntry[] = [];
    let indexChanged = false;

    for (let i = 0; i < snapshot.sessions.length; i++) {
      const prepared = snapshot.sessions[i];
      const original = snapshot.originalSessions[i];
      const id = prepared.id;
      currentIds.add(id);

      const cached = hydratedSessionRefs.get(id);
      if (cached === original) {
        // Unchanged: keep cache, use prepared metadata for index entry.
        indexEntries.push(sessionIndexEntry(prepared));
      } else {
        // Changed or new session.
        changedIds.add(id);
        indexEntries.push(sessionIndexEntry(prepared));
      }
    }

    // Detect deleted sessions (in cache but not in current state).
    const deletedIds: string[] = [];
    for (const [id] of hydratedSessionRefs) {
      if (!currentIds.has(id)) {
        deletedIds.push(id);
        changedIds.add(id);
      }
    }

    // Rebuild index if any session was added, removed, or updated.
    if (changedIds.size > 0) indexChanged = true;

    // Strip and write only changed sessions (plus pending).
    const entries: Array<{ key: string; value: unknown }> = [];
    for (const session of snapshot.sessions) {
      if (!changedIds.has(session.id)) continue;
      const strippedSessions = await stripImagesFromSessions([session], images);
      entries.push({ key: sessionKey(session.id), value: strippedSessions[0] });
    }

    // Write pending (always, single key).
    const [strippedPending] = await Promise.all([
      stripImagesFromPending(snapshot.pendingMessages, images),
    ]);
    entries.push({ key: LOCAL_PENDING_KEY, value: strippedPending });

    // Write index if changed.
    if (indexChanged) {
      const indexData: SessionIndex = { version: 2, entries: indexEntries };
      entries.push({ key: LOCAL_SESSIONS_INDEX_KEY, value: indexData });
    }

    stripMs = performance.now() - stripStart;

    // commitState batch writes all entries + images.
    const commitStart = performance.now();
    await timeAsync("persist.commitState", () => commitState(entries, images));
    commitMs = performance.now() - commitStart;

    // Delete stale session keys for removed sessions.
    for (const id of deletedIds) {
      await removeStateItem(sessionKey(id));
    }

    // Migrate away from old single-key format after the first successful
    // per-session write completes.
    try {
      const oldRaw = await getStateItem<unknown[]>(LOCAL_SESSIONS_KEY);
      if (oldRaw !== null) {
        await removeStateItem(LOCAL_SESSIONS_KEY);
      }
    } catch {
      // Best-effort migration cleanup.
    }

    // GC images: collect refs only from written sessions + pending.
    const referencedRefs = new Set<string>();
    for (const session of snapshot.sessions) {
      if (!changedIds.has(session.id) && !deletedIds.includes(session.id)) continue;
      // Collect image refs from the stripped (persisted) version.
      const stripped = entries.find((e) => e.key === sessionKey(session.id));
      if (stripped) {
        collectImageRefsFromSessions([stripped.value], referencedRefs);
      }
    }
    // For unchanged sessions, collect refs from cache (their images didn't change).
    for (const [id, cached] of hydratedSessionRefs) {
      if (changedIds.has(id) || deletedIds.includes(id)) continue;
      // Build a minimal representation for ref collection.
      const cachedRefs = new Set<string>();
      collectImageRefsFromSessions([cached], cachedRefs);
      for (const ref of cachedRefs) referencedRefs.add(ref);
    }
    collectImageRefsFromPending(strippedPending, referencedRefs);

    const allIds = await getAllImageIds();
    const toDelete = allIds.filter((id) => !referencedRefs.has(id));
    if (toDelete.length > 0) {
      await deleteImages(toDelete);
    }

    // Update the session reference cache for all current sessions.
    for (let i = 0; i < snapshot.originalSessions.length; i++) {
      const original = snapshot.originalSessions[i];
      const prepared = snapshot.sessions[i];
      if (deletedIds.includes(prepared.id)) continue;
      // Cache the original store reference (used for change detection).
      hydratedSessionRefs.set(prepared.id, original);
    }
    for (const id of deletedIds) {
      hydratedSessionRefs.delete(id);
    }

    // One low-frequency attribution entry per actual disk write (the
    // reference-guard skip path never reaches here), so startup long tasks
    // can be charged to the persist that caused them.
    const totalSessions = snapshot.sessions.length;
    const changedSessions = changedIds.size;
    void window.api?.writeDiag?.({
      message: "persist.run",
      data: {
        sessionCount: totalSessions,
        changedSessions,
        totalSessions,
        totalEvents: snapshot.sessions.reduce((sum, session) => sum + session.events.length, 0),
        stripMs: Math.round(stripMs),
        commitMs: Math.round(commitMs),
        totalMs: Math.round(performance.now() - runStart),
      },
    })?.catch?.(() => {});

    if (persistQueue) {
      const next = persistQueue;
      persistQueue = null;
      return runPersist(next);
    }

    return { success: true };
  } catch (err) {
    // Keep persistQueue so the latest snapshot can be retried on the next
    // persistLocalConversationState call instead of being silently dropped.
    reportPersistError("persistLocalConversationState", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    isPersisting = false;
  }
}

export async function persistLocalConversationState(): Promise<PersistResult> {
  const state = useSessionStore.getState();
  const appState = useAppStore.getState();
  rememberCollaborationSessions(state.sessions);
  const guardedSessions = state.sessions.map(restoreRememberedCollaboration);
  if (guardedSessions.some((session, index) => session !== state.sessions[index])) {
    useSessionStore.setState({ sessions: guardedSessions });
    const currentSessionId = appState.currentSession?.id;
    const restoredCurrent = currentSessionId
      ? guardedSessions.find((session) => session.id === currentSessionId)
      : undefined;
    if (restoredCurrent) useAppStore.setState({ currentSession: restoredCurrent });
  }
  // Skip the expensive persist when the store still holds the exact references
  // that are already durable (registered by hydration or by the last
  // successful write). Runs after the collaboration-restore correction above
  // so that repair side effect is never skipped.
  const current = useSessionStore.getState();
  if (lastPersistedSessionsRef === current.sessions && lastPersistedPendingRef === current.pendingMessages) {
    return { success: true };
  }
  const activeStatuses = new Set(["creating", "queued", "sending", "accepted", "running", "waiting_approval", "waiting_question"]);
  const prepareEvents = (session: Session, roomAgentId: string | null, events: TimelineEvent[]) => {
    const activity = roomAgentId
      ? appState.roomAgentActivities[roomAgentActivityKey(session.id, roomAgentId)]
      : undefined;
    const runtimeId = roomAgentId ? getRoomAgentRuntimeId(session, roomAgentId) : null;
    const legacyPrimaryRunning = Boolean(roomAgentId && isPrimaryRoomAgent(session, roomAgentId) && (
      appState.runningSessionId === session.id ||
      appState.runningSessionId === session.runtimeSessionId ||
      appState.runningSessionId === session.officialSessionId ||
      appState.runningSessionId === runtimeId
    ));
    const legacySessionRunning = !roomAgentId && (
      appState.runningSessionId === session.id ||
      appState.runningSessionId === session.runtimeSessionId ||
      appState.runningSessionId === session.officialSessionId
    );
    const active = activity ? activeStatuses.has(activity.status) : legacyPrimaryRunning || legacySessionRunning;
    const settled = active ? events : settleInactiveEvents(events, Date.now(), false, true);
    const sanitized = resetStaleSessionRecommendationEvents(sanitizePersistedEvents(settled));
    return roomAgentId ? sanitized.map((event) => scopeEventToRoomAgent(event, roomAgentId)) : sanitized;
  };
  const preparedSessions = guardedSessions.map((session) => {
    if (!session.collaboration) {
      return {
        ...session,
        events: prepareEvents(session, null, session.events),
        isLoading: false,
      };
    }
    const primary = getPrimaryRoomAgent(session);
    const agentEvents = Object.fromEntries(Object.entries(session.collaboration.agentEvents).map(([agentId, events]) => (
      [agentId, prepareEvents(session, agentId, events)]
    )));
    const prepared = synchronizeCollaborationPrimaryMirror({
      ...session,
      collaboration: {
        ...session.collaboration,
        agentEvents,
      },
      isLoading: false,
    });
    return {
      ...prepared,
      events: prepared.collaboration?.agentEvents[primary.id] ?? prepared.events,
    };
  });
  rememberCollaborationSessions(preparedSessions);

  const snapshot: PersistSnapshot = {
    sessions: preparedSessions,
    originalSessions: state.sessions,
    pendingMessages: state.pendingMessages,
  };

  if (isPersisting) {
    persistQueue = snapshot;
    // A queued snapshot is not durable yet. Room delivery relies on this
    // promise as a pre-dispatch barrier, so every concurrent caller must wait
    // until the current write and the latest coalesced snapshot both finish.
    return activePersistPromise ?? { success: false, error: "持久化队列状态异常" };
  }

  // A previous write may have failed after a newer snapshot was queued. The
  // current snapshot is always at least as new as that queued copy, so discard
  // it before starting a fresh write; otherwise it could be written after this
  // successful state and roll the persisted conversation backwards.
  persistQueue = null;
  const promise = runPersist(snapshot);
  activePersistPromise = promise;
  try {
    const result = await promise;
    if (result.success) {
      // Register the entry-captured references rather than the derived
      // snapshot: if the store moved on while the write was in flight the
      // references differ and the next call persists normally.
      lastPersistedSessionsRef = state.sessions;
      lastPersistedPendingRef = state.pendingMessages;
    }
    return result;
  } finally {
    if (activePersistPromise === promise) activePersistPromise = null;
  }
}

export async function loadLocalSessions(): Promise<Session[]> {
  // Try new per-session format first.
  const indexData = await getStateItem<SessionIndex>(LOCAL_SESSIONS_INDEX_KEY);
  if (indexData?.version === 2 && Array.isArray(indexData.entries) && indexData.entries.length > 0) {
    const ids = indexData.entries.map((e) => e.id);
    // Batch parallel loads (20 per batch).
    const BATCH_SIZE = 20;
    const rawSessions: unknown[] = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((id) => getStateItem<unknown>(sessionKey(id)))
      );
      for (const result of results) {
        if (result !== null) rawSessions.push(result);
      }
    }
    if (rawSessions.length === 0) return [];
    const refs = new Set<string>();
    collectImageRefsFromSessions(rawSessions, refs);
    const dataUrlById = await loadImages(Array.from(refs));
    const sessions = hydrateSessions(rawSessions, dataUrlById).map((session) => {
      const events = deduplicateTimelineEvents(session.events);
      if (!session.collaboration) {
        return events.length === session.events.length ? session : { ...session, events };
      }
      const agentEntries = Object.entries(session.collaboration.agentEvents);
      const agentEvents = Object.fromEntries(agentEntries.map(([agentId, list]) => [agentId, deduplicateTimelineEvents(list)]));
      const changed = events.length !== session.events.length ||
        agentEntries.some(([agentId, list]) => agentEvents[agentId].length !== list.length);
      return changed ? { ...session, events, collaboration: { ...session.collaboration, agentEvents } } : session;
    });
    // Establish the session reference cache so the first persist skips all sessions.
    for (const session of sessions) {
      hydratedSessionRefs.set(session.id, session);
    }
    return sessions;
  }

  // Fall back to old single-key format.
  const raw = await getStateItem<unknown[]>(LOCAL_SESSIONS_KEY);
  if (!raw || !Array.isArray(raw)) return [];
  const refs = new Set<string>();
  collectImageRefsFromSessions(raw, refs);
  const dataUrlById = await loadImages(Array.from(refs));
  // Replay duplication repair: histories written before the snapshot user
  // dedup guards may contain repeated user messages; clean once on load.
  const sessions = hydrateSessions(raw, dataUrlById).map((session) => {
    const events = deduplicateTimelineEvents(session.events);
    if (!session.collaboration) {
      return events.length === session.events.length ? session : { ...session, events };
    }
    const agentEntries = Object.entries(session.collaboration.agentEvents);
    const agentEvents = Object.fromEntries(agentEntries.map(([agentId, list]) => [agentId, deduplicateTimelineEvents(list)]));
    const changed = events.length !== session.events.length ||
      agentEntries.some(([agentId, list]) => agentEvents[agentId].length !== list.length);
    return changed ? { ...session, events, collaboration: { ...session.collaboration, agentEvents } } : session;
  });
  // Establish cache from old format too.
  for (const session of sessions) {
    hydratedSessionRefs.set(session.id, session);
  }
  return sessions;
}

export async function loadLocalPendingMessages(): Promise<PendingMessage[]> {
  const raw = await getStateItem<unknown[]>(LOCAL_PENDING_KEY);
  if (!raw || !Array.isArray(raw)) return [];
  const refs = new Set<string>();
  collectImageRefsFromPending(raw, refs);
  const dataUrlById = await loadImages(Array.from(refs));
  return hydratePending(raw, dataUrlById);
}
