import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Project, Session, TimelineEvent, UserMessageImage } from "@/types/ui";
import type { PendingMessage } from "@/stores/sessionStore";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import { sanitizePersistedEvents, settleInactiveEvents } from "./eventHelpers";
import {
  getStateItem,
  loadImages,
  setStateItem,
  storeImages,
  type StoredImage,
} from "./stateStorage";

export const LOCAL_SESSIONS_KEY = "kimix_sessions";
export const LOCAL_PENDING_KEY = "kimix_pending";
export const LOCAL_ACTIVE_CONTEXT_KEY = "kimix_active_context";
export const LOCAL_ARCHIVED_SESSION_TOMBSTONES_KEY = "kimix_archived_session_tombstones";
export const LOCAL_PERSIST_DEBOUNCE_MS = 900;

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

type PersistedImageRef = Omit<UserMessageImage, "dataUrl"> & { imageRef: string };

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
      });
      out.push({
        name: image.name,
        kind: image.kind,
        filePath: image.filePath,
        imageRef: id,
      });
    } else {
      out.push({
        name: image.name,
        kind: image.kind,
        filePath: image.filePath,
      });
    }
  }
  return out;
}

async function stripImagesFromSessions(sessions: Session[], into: StoredImage[]): Promise<unknown[]> {
  return Promise.all(
    sessions.map(async (session) => {
      const strippedEvents = await Promise.all(
        session.events.map(async (event) => {
          if (event.type !== "user_message" && event.type !== "steer_message") return event;
          const images = await extractImages(event.images, into);
          return { ...event, images } as unknown as TimelineEvent;
        })
      );
      return { ...session, events: strippedEvents };
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

function collectImageRefs(value: unknown, refs: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectImageRefs(item, refs));
  } else if (value && typeof value === "object") {
    const record = value as { imageRef?: unknown };
    if (typeof record.imageRef === "string") refs.add(record.imageRef);
    Object.values(value as Record<string, unknown>).forEach((item) => collectImageRefs(item, refs));
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
  return raw.map((item) => {
    const session = item as Session;
    return {
      ...session,
      events: session.events.map((event) => {
        if (event.type !== "user_message" && event.type !== "steer_message") return event;
        return {
          ...event,
          images: hydrateMessageImages(
            event.images as (UserMessageImage & { imageRef?: string })[] | undefined,
            dataUrlById,
          ),
        } as TimelineEvent;
      }),
    };
  });
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

export async function persistLocalConversationState(): Promise<PersistResult> {
  try {
    const state = useSessionStore.getState();
    const runningSessionId = useAppStore.getState().runningSessionId;
    const preparedSessions = state.sessions.map((session) => ({
      ...session,
      events: resetStaleSessionRecommendationEvents(sanitizePersistedEvents(session.id === runningSessionId ? session.events : settleInactiveEvents(session.events))),
      isLoading: false,
    }));

    const images: StoredImage[] = [];
    const [strippedSessions, strippedPending] = await Promise.all([
      stripImagesFromSessions(preparedSessions, images),
      stripImagesFromPending(state.pendingMessages, images),
    ]);

    await Promise.all([
      setStateItem(LOCAL_SESSIONS_KEY, strippedSessions),
      setStateItem(LOCAL_PENDING_KEY, strippedPending),
      storeImages(images),
    ]);

    // Clean up image records that are no longer referenced by the current state.
    const referencedRefs = new Set<string>();
    collectImageRefs(strippedSessions, referencedRefs);
    collectImageRefs(strippedPending, referencedRefs);

    return { success: true };
  } catch (err) {
    reportPersistError("persistLocalConversationState", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadLocalSessions(): Promise<Session[]> {
  const raw = await getStateItem<unknown[]>(LOCAL_SESSIONS_KEY);
  if (!raw || !Array.isArray(raw)) return [];
  const refs = new Set<string>();
  raw.forEach((session) => collectImageRefs(session, refs));
  const dataUrlById = await loadImages(Array.from(refs));
  return hydrateSessions(raw, dataUrlById);
}

export async function loadLocalPendingMessages(): Promise<PendingMessage[]> {
  const raw = await getStateItem<unknown[]>(LOCAL_PENDING_KEY);
  if (!raw || !Array.isArray(raw)) return [];
  const refs = new Set<string>();
  raw.forEach((item) => collectImageRefs(item, refs));
  const dataUrlById = await loadImages(Array.from(refs));
  return hydratePending(raw, dataUrlById);
}
