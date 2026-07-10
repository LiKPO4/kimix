import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { PendingMessage } from "@/stores/sessionStore";
import type { Project, Session, TimelineEvent, UserMessageImage } from "@/types/ui";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import {
  LOCAL_ACTIVE_CONTEXT_KEY,
  LOCAL_ARCHIVED_SESSION_TOMBSTONES_KEY,
  getArchivedSessionTombstones,
  getHiddenHandoffSessionIds,
  persistLocalConversationState,
} from "@/utils/persistence";
import type { ArchivedSessionTombstone } from "@/utils/persistence";
import type { SessionBackupSnapshot } from "../../electron/types/ipc";

const SESSION_BACKUP_SCHEMA_VERSION = 1;
const HIDDEN_HANDOFF_SESSION_KEY = "kimix_hidden_handoff_sessions";
const MAX_ARCHIVED_TOMBSTONES = 500;

export type SessionBackupImportStats = {
  importedSessions: number;
  addedSessions: number;
  updatedSessions: number;
  skippedSessions: number;
  forkedSessions: number;
  mergedEvents: number;
  importedArchivedSessions: number;
  importedArchivedTombstones: number;
  archivedTombstones: number;
  addedProjects: number;
  updatedProjects: number;
  skippedProjects: number;
  addedPendingMessages: number;
  skippedPendingMessages: number;
  hiddenHandoffSessionIds: number;
};

export type SessionBackupImportPlan = {
  snapshot: SessionBackupSnapshot;
  sessions: Session[];
  pendingMessages: PendingMessage[];
  projects: Project[];
  projectsToPersist: Project[];
  archivedTombstones: ArchivedSessionTombstone[];
  hiddenHandoffSessionIds: string[];
  stats: SessionBackupImportStats;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizePathForBackup(value: string | undefined) {
  return (value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function uniqueStrings(values: Array<string | undefined | null>) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))));
}

function sessionIdentityKeys(session: Pick<Session, "id" | "runtimeSessionId" | "officialSessionId" | "longTask">) {
  return uniqueStrings([
    session.id,
    session.runtimeSessionId,
    session.officialSessionId,
    session.longTask?.executorSessionId,
    session.longTask?.reviewerSessionId,
  ]);
}

function makeArchivedTombstone(session: Session): ArchivedSessionTombstone | null {
  const ids = sessionIdentityKeys(session);
  const archivedAt = session.archivedAt;
  if (!archivedAt || ids.length === 0 || !session.projectPath) return null;
  return {
    ids,
    projectPath: session.projectPath,
    title: session.title,
    archivedAt,
  };
}

function normalizeArchivedTombstone(value: unknown): ArchivedSessionTombstone | null {
  if (!isRecord(value)) return null;
  const ids = Array.isArray(value.ids)
    ? uniqueStrings(value.ids.map((item) => (typeof item === "string" ? item : undefined)))
    : [];
  const projectPath = stringValue(value.projectPath);
  const archivedAt = optionalNumber(value.archivedAt);
  if (ids.length === 0 || !projectPath || !archivedAt) return null;
  return {
    ids,
    projectPath,
    title: optionalString(value.title),
    archivedAt,
  };
}

function mergeArchivedTombstones(tombstones: ArchivedSessionTombstone[]) {
  const merged: ArchivedSessionTombstone[] = [];
  for (const tombstone of tombstones) {
    const normalized = normalizeArchivedTombstone(tombstone);
    if (!normalized) continue;
    const projectKey = normalizePathForBackup(normalized.projectPath);
    const index = merged.findIndex((item) => (
      normalizePathForBackup(item.projectPath) === projectKey &&
      item.ids.some((id) => normalized.ids.includes(id))
    ));
    if (index < 0) {
      merged.push(normalized);
      continue;
    }
    const current = merged[index];
    merged[index] = {
      ids: uniqueStrings([...current.ids, ...normalized.ids]),
      projectPath: current.projectPath || normalized.projectPath,
      title: current.title || normalized.title,
      archivedAt: Math.max(current.archivedAt, normalized.archivedAt),
    };
  }
  return merged.slice(-MAX_ARCHIVED_TOMBSTONES);
}

function readJsonFromLocalStorage(key: string, fallback: unknown) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function timelineEventKey(event: TimelineEvent) {
  const record = event as unknown as Record<string, unknown>;
  const id = optionalString(record.id);
  if (id) return `id:${id}`;
  const type = optionalString(record.type) ?? "unknown";
  const timestamp = numberValue(record.timestamp, 0);
  const toolCallId = optionalString(record.toolCallId);
  const content = typeof record.content === "string" ? record.content.slice(0, 120) : "";
  return `sig:${type}:${timestamp}:${toolCallId ?? ""}:${content}`;
}

function mergeTimelineEvents(localEvents: TimelineEvent[], importedEvents: TimelineEvent[]) {
  const byKey = new Map<string, TimelineEvent>();
  for (const event of localEvents) byKey.set(timelineEventKey(event), event);
  let added = 0;
  for (const event of importedEvents) {
    const key = timelineEventKey(event);
    if (!byKey.has(key)) {
      added += 1;
      byKey.set(key, event);
    }
  }
  const events = Array.from(byKey.values()).sort((a, b) => numberValue(a.timestamp, 0) - numberValue(b.timestamp, 0));
  return { events, added };
}

function countUniqueTimelineEvents(sourceEvents: TimelineEvent[], targetEvents: TimelineEvent[]) {
  const targetKeys = new Set(targetEvents.map(timelineEventKey));
  return sourceEvents.reduce((count, event) => count + (targetKeys.has(timelineEventKey(event)) ? 0 : 1), 0);
}

function shouldForkImportedSession(local: Session, imported: Session) {
  if (local.events.length === 0 || imported.events.length === 0) return false;
  return countUniqueTimelineEvents(local.events, imported.events) > 0 &&
    countUniqueTimelineEvents(imported.events, local.events) > 0;
}

function createImportedSessionCopy(imported: Session, existingIds: Set<string>) {
  let id = `kimix-import-${crypto.randomUUID()}`;
  while (existingIds.has(id)) id = `kimix-import-${crypto.randomUUID()}`;
  existingIds.add(id);
  return {
    ...imported,
    id,
    runtimeSessionId: undefined,
    officialSessionId: undefined,
    longTask: undefined,
    title: imported.title.endsWith("（导入副本）") ? imported.title : `${imported.title}（导入副本）`,
    isLoading: false,
  };
}

function normalizeTimelineEvents(value: unknown): TimelineEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter((event): event is TimelineEvent => (
    isRecord(event) &&
    typeof event.type === "string" &&
    typeof event.timestamp === "number"
  ));
}

function normalizeImportedSession(value: unknown): Session | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const title = stringValue(value.title, "新会话");
  const projectPath = stringValue(value.projectPath);
  if (!id || !projectPath) return null;
  const createdAt = numberValue(value.createdAt, Date.now());
  const updatedAt = numberValue(value.updatedAt, createdAt);
  const engine = value.engine === "prompt" || value.engine === "kimi-code" ? value.engine : undefined;
  const base = value as Partial<Session>;
  return {
    ...base,
    id,
    engine,
    runtimeSessionId: optionalString(value.runtimeSessionId),
    officialSessionId: optionalString(value.officialSessionId),
    titleLocked: value.titleLocked === true ? true : undefined,
    model: typeof value.model === "string" || value.model === null ? value.model : undefined,
    longTask: isRecord(value.longTask) ? value.longTask as Session["longTask"] : undefined,
    title,
    projectPath,
    createdAt,
    updatedAt,
    archivedAt: optionalNumber(value.archivedAt),
    btwRounds: Array.isArray(value.btwRounds) ? value.btwRounds as Session["btwRounds"] : undefined,
    officialGoal: isRecord(value.officialGoal) ? value.officialGoal as Session["officialGoal"] : undefined,
    events: normalizeTimelineEvents(value.events),
    isLoading: false,
  };
}

function normalizePendingMessage(value: unknown): PendingMessage | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const sessionId = stringValue(value.sessionId);
  const content = typeof value.content === "string" ? value.content : "";
  const createdAt = optionalNumber(value.createdAt);
  if (!id || !sessionId || !createdAt) return null;
  const images = Array.isArray(value.images)
    ? value.images.filter((image): image is UserMessageImage => isRecord(image) && typeof image.name === "string")
    : undefined;
  return {
    id,
    sessionId,
    content,
    createdAt,
    images,
  };
}

function normalizeProject(value: unknown): Project | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  const projectPath = stringValue(value.path);
  const lastOpenedAt = optionalNumber(value.lastOpenedAt);
  if (!id || !name || !projectPath || !lastOpenedAt) return null;
  return {
    id,
    name,
    path: projectPath,
    lastOpenedAt,
    gitBranch: optionalString(value.gitBranch),
    pinned: value.pinned === true ? true : undefined,
    sortOrder: optionalNumber(value.sortOrder),
  };
}

function normalizeSnapshot(snapshot: SessionBackupSnapshot): SessionBackupSnapshot {
  return {
    schemaVersion: numberValue(snapshot.schemaVersion, SESSION_BACKUP_SCHEMA_VERSION),
    appVersion: optionalString(snapshot.appVersion),
    exportedAt: optionalString(snapshot.exportedAt),
    source: optionalString(snapshot.source),
    sessions: Array.isArray(snapshot.sessions) ? snapshot.sessions : [],
    pendingMessages: Array.isArray(snapshot.pendingMessages) ? snapshot.pendingMessages : [],
    projects: Array.isArray(snapshot.projects) ? snapshot.projects : [],
    archivedTombstones: Array.isArray(snapshot.archivedTombstones) ? snapshot.archivedTombstones : [],
    hiddenHandoffSessionIds: Array.isArray(snapshot.hiddenHandoffSessionIds)
      ? uniqueStrings(snapshot.hiddenHandoffSessionIds.map((id) => (typeof id === "string" ? id : undefined)))
      : [],
    activeContext: snapshot.activeContext,
  };
}

export function buildSessionBackupSnapshot(appVersion: string): SessionBackupSnapshot {
  const sessionState = useSessionStore.getState();
  const sessions = sessionState.sessions
    .filter((session) => !isHiddenInternalSession(session))
    .map((session) => ({
      ...session,
      isLoading: false,
    }));
  const generatedTombstones = sessions
    .map((session) => makeArchivedTombstone(session))
    .filter((item): item is ArchivedSessionTombstone => Boolean(item));
  return {
    schemaVersion: SESSION_BACKUP_SCHEMA_VERSION,
    appVersion,
    exportedAt: new Date().toISOString(),
    source: "Kimix",
    sessions,
    pendingMessages: sessionState.pendingMessages,
    projects: sessionState.recentProjects,
    archivedTombstones: mergeArchivedTombstones([...getArchivedSessionTombstones(), ...generatedTombstones]),
    hiddenHandoffSessionIds: getHiddenHandoffSessionIds(),
    activeContext: readJsonFromLocalStorage(LOCAL_ACTIVE_CONTEXT_KEY, null),
  };
}

function mergeSession(local: Session, imported: Session) {
  const eventMerge = mergeTimelineEvents(local.events, imported.events);
  const importedNewer = imported.updatedAt > local.updatedAt;
  const localLooksLikePlaceholder = local.events.length === 0 && local.updatedAt <= imported.updatedAt;
  const archivedAt = local.archivedAt
    ? (imported.archivedAt ? Math.max(local.archivedAt, imported.archivedAt) : local.archivedAt)
    : (imported.archivedAt && localLooksLikePlaceholder ? imported.archivedAt : undefined);
  const merged: Session = {
    ...local,
    engine: local.engine ?? imported.engine,
    runtimeSessionId: local.runtimeSessionId ?? imported.runtimeSessionId,
    officialSessionId: local.officialSessionId ?? imported.officialSessionId,
    titleLocked: local.titleLocked ?? imported.titleLocked,
    model: local.model ?? imported.model,
    longTask: local.longTask ?? imported.longTask,
    btwRounds: local.btwRounds ?? imported.btwRounds,
    officialGoal: importedNewer ? (imported.officialGoal ?? local.officialGoal) : (local.officialGoal ?? imported.officialGoal),
    title: local.titleLocked || (!importedNewer && local.title.trim()) ? local.title : imported.title,
    projectPath: local.projectPath || imported.projectPath,
    createdAt: Math.min(local.createdAt, imported.createdAt),
    updatedAt: Math.max(local.updatedAt, imported.updatedAt),
    archivedAt,
    events: eventMerge.events,
    isLoading: false,
  };
  const changed =
    eventMerge.added > 0 ||
    importedNewer ||
    (!local.runtimeSessionId && Boolean(imported.runtimeSessionId)) ||
    (!local.officialSessionId && Boolean(imported.officialSessionId)) ||
    local.archivedAt !== merged.archivedAt;
  return { session: merged, changed, addedEvents: eventMerge.added };
}

function mergeProjects(localProjects: Project[], importedProjects: Project[]) {
  const next = [...localProjects];
  const projectsToPersist: Project[] = [];
  const stats = { addedProjects: 0, updatedProjects: 0, skippedProjects: 0 };
  const findIndex = (project: Project) => {
    const pathKey = normalizePathForBackup(project.path);
    return next.findIndex((item) => item.id === project.id || normalizePathForBackup(item.path) === pathKey);
  };
  for (const project of importedProjects) {
    const index = findIndex(project);
    if (index < 0) {
      next.push(project);
      projectsToPersist.push(project);
      stats.addedProjects += 1;
      continue;
    }
    const current = next[index];
    if (project.lastOpenedAt > current.lastOpenedAt) {
      const merged = {
        ...current,
        ...project,
        pinned: current.pinned ?? project.pinned,
        sortOrder: current.sortOrder ?? project.sortOrder,
      };
      next[index] = merged;
      projectsToPersist.push(merged);
      stats.updatedProjects += 1;
    } else {
      stats.skippedProjects += 1;
    }
  }
  return { projects: next, projectsToPersist, stats };
}

function mergePendingMessages(
  localPending: PendingMessage[],
  importedPending: PendingMessage[],
  validSessionIds: Set<string>,
  sessionIdMap: Map<string, string>,
) {
  const next = [...localPending];
  let addedPendingMessages = 0;
  let skippedPendingMessages = 0;
  const ids = new Set(next.map((message) => message.id));
  const signatures = new Set(next.map((message) => `${message.sessionId}\n${message.createdAt}\n${message.content}`));
  for (const message of importedPending) {
    const targetSessionId = sessionIdMap.get(message.sessionId) ?? message.sessionId;
    if (!validSessionIds.has(targetSessionId)) {
      skippedPendingMessages += 1;
      continue;
    }
    const normalizedMessage = targetSessionId === message.sessionId ? message : { ...message, sessionId: targetSessionId };
    const signature = `${normalizedMessage.sessionId}\n${normalizedMessage.createdAt}\n${normalizedMessage.content}`;
    if (ids.has(message.id) || signatures.has(signature)) {
      skippedPendingMessages += 1;
      continue;
    }
    next.push(normalizedMessage);
    ids.add(message.id);
    signatures.add(signature);
    addedPendingMessages += 1;
  }
  return { pendingMessages: next, addedPendingMessages, skippedPendingMessages };
}

export function createSessionBackupImportPlan(rawSnapshot: SessionBackupSnapshot): SessionBackupImportPlan {
  const snapshot = normalizeSnapshot(rawSnapshot);
  const importedSessions = snapshot.sessions
    .map(normalizeImportedSession)
    .filter((session): session is Session => Boolean(session) && !isHiddenInternalSession(session));
  const importedPending = snapshot.pendingMessages
    .map(normalizePendingMessage)
    .filter((message): message is PendingMessage => Boolean(message));
  const importedProjects = snapshot.projects
    .map(normalizeProject)
    .filter((project): project is Project => Boolean(project));
  const importedTombstones = snapshot.archivedTombstones
    .map(normalizeArchivedTombstone)
    .filter((tombstone): tombstone is ArchivedSessionTombstone => Boolean(tombstone));

  const currentState = useSessionStore.getState();
  const hiddenCurrentSessions = currentState.sessions.filter((session) => isHiddenInternalSession(session));
  const nextSessions = currentState.sessions.filter((session) => !isHiddenInternalSession(session));
  const sessionIdMap = new Map<string, string>();
  const existingSessionIds = new Set(nextSessions.map((session) => session.id));
  const lookup = new Map<string, number>();
  const rememberSessionIndex = (session: Session, index: number) => {
    for (const key of sessionIdentityKeys(session)) lookup.set(key, index);
  };
  nextSessions.forEach(rememberSessionIndex);

  const stats: SessionBackupImportStats = {
    importedSessions: importedSessions.length,
    addedSessions: 0,
    updatedSessions: 0,
    skippedSessions: 0,
    forkedSessions: 0,
    mergedEvents: 0,
    importedArchivedSessions: importedSessions.filter((session) => session.archivedAt).length,
    importedArchivedTombstones: 0,
    archivedTombstones: 0,
    addedProjects: 0,
    updatedProjects: 0,
    skippedProjects: 0,
    addedPendingMessages: 0,
    skippedPendingMessages: 0,
    hiddenHandoffSessionIds: 0,
  };

  for (const imported of importedSessions) {
    const matchIndex = sessionIdentityKeys(imported)
      .map((key) => lookup.get(key))
      .find((index): index is number => typeof index === "number");
    if (matchIndex === undefined) {
      const index = nextSessions.length;
      nextSessions.push(imported);
      rememberSessionIndex(imported, index);
      existingSessionIds.add(imported.id);
      sessionIdMap.set(imported.id, imported.id);
      stats.addedSessions += 1;
      continue;
    }
    if (shouldForkImportedSession(nextSessions[matchIndex], imported)) {
      const copy = createImportedSessionCopy(imported, existingSessionIds);
      nextSessions.push(copy);
      sessionIdMap.set(imported.id, copy.id);
      stats.addedSessions += 1;
      stats.forkedSessions += 1;
      continue;
    }
    const merged = mergeSession(nextSessions[matchIndex], imported);
    nextSessions[matchIndex] = merged.session;
    rememberSessionIndex(merged.session, matchIndex);
    sessionIdMap.set(imported.id, merged.session.id);
    stats.mergedEvents += merged.addedEvents;
    if (merged.changed) stats.updatedSessions += 1;
    else stats.skippedSessions += 1;
  }

  const sortedVisibleSessions = [...nextSessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const finalSessions = [...sortedVisibleSessions, ...hiddenCurrentSessions];
  const projectMerge = mergeProjects(currentState.recentProjects, importedProjects);
  stats.addedProjects = projectMerge.stats.addedProjects;
  stats.updatedProjects = projectMerge.stats.updatedProjects;
  stats.skippedProjects = projectMerge.stats.skippedProjects;

  const validSessionIds = new Set(finalSessions.map((session) => session.id));
  const pendingMerge = mergePendingMessages(currentState.pendingMessages, importedPending, validSessionIds, sessionIdMap);
  stats.addedPendingMessages = pendingMerge.addedPendingMessages;
  stats.skippedPendingMessages = pendingMerge.skippedPendingMessages;

  const activeIdentityKeys = new Set(finalSessions
    .filter((session) => !session.archivedAt)
    .flatMap((session) => sessionIdentityKeys(session)));
  const safeImportedTombstones = importedTombstones.filter((tombstone) => (
    !tombstone.ids.some((id) => activeIdentityKeys.has(id))
  ));
  stats.importedArchivedTombstones = safeImportedTombstones.length;
  const generatedTombstones = finalSessions
    .map((session) => makeArchivedTombstone(session))
    .filter((item): item is ArchivedSessionTombstone => Boolean(item));
  const archivedTombstones = mergeArchivedTombstones([
    ...getArchivedSessionTombstones(),
    ...safeImportedTombstones,
    ...generatedTombstones,
  ]);
  stats.archivedTombstones = archivedTombstones.length;

  const hiddenHandoffSessionIds = uniqueStrings([
    ...getHiddenHandoffSessionIds(),
    ...snapshot.hiddenHandoffSessionIds,
  ]).slice(-200);
  stats.hiddenHandoffSessionIds = hiddenHandoffSessionIds.length;

  return {
    snapshot,
    sessions: finalSessions,
    pendingMessages: pendingMerge.pendingMessages,
    projects: projectMerge.projects,
    projectsToPersist: projectMerge.projectsToPersist,
    archivedTombstones,
    hiddenHandoffSessionIds,
    stats,
  };
}

export function hasSessionBackupImportChanges(stats: SessionBackupImportStats) {
  return (
    stats.addedSessions > 0 ||
    stats.updatedSessions > 0 ||
    stats.forkedSessions > 0 ||
    stats.addedProjects > 0 ||
    stats.updatedProjects > 0 ||
    stats.addedPendingMessages > 0 ||
    stats.importedArchivedTombstones > 0 ||
    stats.archivedTombstones > getArchivedSessionTombstones().length ||
    stats.hiddenHandoffSessionIds > getHiddenHandoffSessionIds().length
  );
}

export function formatSessionBackupImportSummary(plan: SessionBackupImportPlan) {
  const { stats, snapshot } = plan;
  const exportedAt = snapshot.exportedAt ? `\n导出时间：${snapshot.exportedAt}` : "";
  return [
    "将以去重合并方式导入 Kimix 会话快照：",
    exportedAt,
    `新增会话：${stats.addedSessions}`,
    `更新会话：${stats.updatedSessions}`,
    `分叉副本：${stats.forkedSessions}`,
    `跳过重复会话：${stats.skippedSessions}`,
    `合并新增消息事件：${stats.mergedEvents}`,
    `归档会话保持归档：${stats.importedArchivedSessions}`,
    `导入归档屏蔽记录：${stats.importedArchivedTombstones}`,
    `合并后归档屏蔽记录：${stats.archivedTombstones}`,
    `新增/更新项目：${stats.addedProjects + stats.updatedProjects}`,
    `新增待发送队列：${stats.addedPendingMessages}`,
    "",
    "本地已有且更新的内容会优先保留。继续导入吗？",
  ].filter(Boolean).join("\n");
}

export async function applySessionBackupImportPlan(plan: SessionBackupImportPlan) {
  localStorage.setItem(LOCAL_ARCHIVED_SESSION_TOMBSTONES_KEY, JSON.stringify(plan.archivedTombstones.slice(-MAX_ARCHIVED_TOMBSTONES)));
  localStorage.setItem(HIDDEN_HANDOFF_SESSION_KEY, JSON.stringify(plan.hiddenHandoffSessionIds.slice(-200)));
  if (plan.snapshot.activeContext && !localStorage.getItem(LOCAL_ACTIVE_CONTEXT_KEY)) {
    localStorage.setItem(LOCAL_ACTIVE_CONTEXT_KEY, JSON.stringify(plan.snapshot.activeContext));
  }

  useSessionStore.setState({
    sessions: plan.sessions,
    pendingMessages: plan.pendingMessages,
    recentProjects: plan.projects,
  });

  const currentSession = useAppStore.getState().currentSession;
  if (currentSession) {
    const currentKeys = sessionIdentityKeys(currentSession);
    const updatedCurrent = plan.sessions.find((session) => sessionIdentityKeys(session).some((key) => currentKeys.includes(key)));
    if (updatedCurrent) useAppStore.getState().setCurrentSession(updatedCurrent);
  }

  for (const project of plan.projectsToPersist) {
    await window.api.addRecentProject(project).catch(() => undefined);
  }
  await persistLocalConversationState();
}
