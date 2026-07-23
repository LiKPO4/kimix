import type { Session } from "@/types/ui";
import { getPrimaryRoomAgent, updateRoomAgent } from "@/utils/collaborationRooms";
import { normalizePathForComparison } from "@/utils/pathCase";
import { parseOfficialRoomMetadata } from "@/utils/roomSessionMetadata";
import { isDefaultSessionTitle, truncateSessionTitle } from "@/utils/sessionTitle";

const EMPTY_SESSION_CREATION_GRACE_MS = 5 * 60 * 1000;
/**
 * 误归档自愈宽限：官方归档状态在目录中的滞后最多分钟级，
 * 本地归档超过 24h 而官方仍在活动目录可见，必为历史误归档。
 */
const MISARCHIVE_RESTORE_GRACE_MS = 24 * 60 * 60 * 1000;

export interface OfficialSessionCatalogItem {
  id: string;
  workDir: string;
  updatedAt: number;
  brief?: string;
  title?: string;
  lastPrompt?: string;
  isCustomTitle?: boolean;
  archived?: boolean;
  source?: "server" | "sdk";
  metadata?: Record<string, unknown>;
}

export function selectStartupOfficialSession<T extends { id: string }>(
  sessions: T[],
  activeRuntimeIds: ReadonlySet<string>,
): T | undefined {
  if (activeRuntimeIds.size === 0) return undefined;
  return sessions.find((session) => activeRuntimeIds.has(session.id));
}

function normalizeProjectPath(projectPath: string | undefined) {
  return normalizePathForComparison(projectPath);
}

function belongsToOfficialSession(session: Session, officialId: string) {
  return session.id === officialId ||
    session.officialSessionId === officialId ||
    session.runtimeSessionId === officialId ||
    session.longTask?.executorSessionId === officialId ||
    session.longTask?.reviewerSessionId === officialId;
}

function catalogTitle(item: OfficialSessionCatalogItem): string | undefined {
  const officialTitle = item.title?.trim();
  const usableOfficialTitle = officialTitle && !isDefaultSessionTitle(officialTitle) ? officialTitle : undefined;
  const source = usableOfficialTitle || item.brief?.trim() || item.lastPrompt?.trim();
  return source ? truncateSessionTitle(source) || undefined : undefined;
}

function isOfficialMirrorSession(session: Session, projectPath: string) {
  return session.engine === "kimi-code" &&
    !session.longTask &&
    !session.archivedAt &&
    normalizeProjectPath(session.projectPath) === normalizeProjectPath(projectPath) &&
    Boolean(session.officialSessionId || session.runtimeSessionId || !session.id.startsWith("local-"));
}

function officialSessionIds(session: Session) {
  return [
    session.id,
    session.officialSessionId,
    session.runtimeSessionId,
  ].filter((id): id is string => Boolean(id));
}

function transparentSkillForkParent(item: OfficialSessionCatalogItem): string | undefined {
  if (!item.id.startsWith("skill-")) return undefined;
  if (item.metadata?.source !== "kimix-fork") return undefined;
  const forkedFrom = item.metadata.forkedFrom;
  return typeof forkedFrom === "string" && forkedFrom.trim() ? forkedFrom : undefined;
}

function normalizedCatalogTitle(item: OfficialSessionCatalogItem): string {
  return (catalogTitle(item) ?? "").trim().toLowerCase();
}

function normalizedSessionTitle(session: Session): string {
  return (session.title ?? "").trim().toLowerCase();
}

function inferTransparentSkillForkParent(
  item: OfficialSessionCatalogItem,
  candidates: OfficialSessionCatalogItem[],
  sessions: Session[],
  projectPath: string,
): string | undefined {
  const explicitParent = transparentSkillForkParent(item);
  if (explicitParent) return explicitParent;
  if (!item.id.startsWith("skill-")) return undefined;
  const title = normalizedCatalogTitle(item);
  if (!title) return undefined;
  const normalizedProjectPath = normalizeProjectPath(item.workDir || projectPath);
  const parentCandidates = candidates
    .filter((candidate) => (
      candidate.id !== item.id &&
      candidate.archived !== true &&
      normalizeProjectPath(candidate.workDir || projectPath) === normalizedProjectPath &&
      normalizedCatalogTitle(candidate) === title &&
      (candidate.updatedAt || 0) <= (item.updatedAt || 0)
    ))
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  if (parentCandidates.length > 0) {
    const latestUpdatedAt = parentCandidates[0].updatedAt || 0;
    const latestParents = parentCandidates.filter((candidate) => (candidate.updatedAt || 0) === latestUpdatedAt);
    if (latestParents.length === 1) return latestParents[0].id;
  }
  const localCandidates = sessions
    .filter((session) => (
      !session.archivedAt &&
      isOfficialMirrorSession(session, projectPath) &&
      normalizeProjectPath(session.projectPath) === normalizedProjectPath &&
      normalizedSessionTitle(session) === title &&
      !officialSessionIds(session).some((id) => id.startsWith("skill-"))
    ))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  if (localCandidates.length === 0) return undefined;
  const latestLocalUpdatedAt = localCandidates[0].updatedAt;
  const latestLocalParents = localCandidates.filter((session) => session.updatedAt === latestLocalUpdatedAt);
  if (latestLocalParents.length !== 1) return undefined;
  return latestLocalParents[0].runtimeSessionId ?? latestLocalParents[0].officialSessionId ?? latestLocalParents[0].id;
}

function officialLineageIds(
  item: OfficialSessionCatalogItem,
  byId: Map<string, OfficialSessionCatalogItem>,
  parentById: Map<string, string>,
): Set<string> {
  const ids = new Set<string>();
  let current: OfficialSessionCatalogItem | undefined = item;
  while (current && !ids.has(current.id)) {
    ids.add(current.id);
    const parentId = parentById.get(current.id);
    if (!parentId) break;
    const parent = byId.get(parentId);
    if (!parent) {
      ids.add(parentId);
      break;
    }
    current = parent;
  }
  return ids;
}

function belongsToOfficialLineage(session: Session, lineageIds: Set<string>) {
  return officialSessionIds(session).some((id) => lineageIds.has(id));
}

function isAbandonedEmptyMirror(session: Session, projectPath: string) {
  return session.engine === "kimi-code" &&
    !session.longTask &&
    !session.collaboration &&
    !session.archivedAt &&
    normalizeProjectPath(session.projectPath) === normalizeProjectPath(projectPath) &&
    session.events.every((event) => event.type !== "user_message" && event.type !== "steer_message") &&
    Date.now() - session.createdAt >= EMPTY_SESSION_CREATION_GRACE_MS;
}

function isExactEmptyRuntimeMirror(session: Session, runtimeSessionId: string, projectPath: string | undefined) {
  return !session.archivedAt &&
    !session.collaboration &&
    !session.longTask &&
    session.id === runtimeSessionId &&
    normalizeProjectPath(session.projectPath) === normalizeProjectPath(projectPath) &&
    officialSessionIds(session).includes(runtimeSessionId) &&
    session.events.length === 0;
}

export function claimRuntimeSessionOwnership(
  sessions: Session[],
  ownerSessionId: string,
  runtimeSessionId: string,
  updateOwner: (session: Session) => Session,
  now = Date.now(),
): Session[] {
  const ownerIndex = sessions.findIndex((session) => session.id === ownerSessionId && !session.archivedAt);
  if (ownerIndex < 0) return sessions;
  const updatedOwner = updateOwner(sessions[ownerIndex]);
  let changed = updatedOwner !== sessions[ownerIndex];
  const next = sessions.map((session, index) => {
    if (index === ownerIndex) return updatedOwner;
    if (!isExactEmptyRuntimeMirror(session, runtimeSessionId, updatedOwner.projectPath)) return session;
    changed = true;
    return { ...session, archivedAt: now, updatedAt: Math.max(session.updatedAt, now) };
  });
  return changed ? next : sessions;
}

export function isUnconfirmedOfficialSessionPlaceholder(session: Session) {
  return session.engine === "kimi-code" &&
    !session.longTask &&
    !session.collaboration &&
    !session.archivedAt &&
    !session.officialCatalogConfirmedAt &&
    Boolean(session.officialSessionId || session.runtimeSessionId || !session.id.startsWith("local-")) &&
    session.events.every((event) => event.type !== "user_message" && event.type !== "steer_message") &&
    Date.now() - session.createdAt >= EMPTY_SESSION_CREATION_GRACE_MS;
}

export function shouldHideOfficialSessionPlaceholder(session: Session) {
  if (isUnconfirmedOfficialSessionPlaceholder(session)) return true;
  return session.engine === "kimi-code" &&
    !session.longTask &&
    !session.collaboration &&
    !session.archivedAt &&
    isDefaultSessionTitle(session.title) &&
    session.events.every((event) => event.type !== "user_message" && event.type !== "steer_message") &&
    Date.now() - session.createdAt >= EMPTY_SESSION_CREATION_GRACE_MS;
}

/**
 * Reconcile the lightweight official session catalog into Kimix's local mirror.
 * Message bodies remain lazy-loaded when the user opens a discovered session.
 */
export function reconcileOfficialSessionCatalog(
  sessions: Session[],
  officialSessions: OfficialSessionCatalogItem[],
  projectPath: string,
  options: { source?: "server" | "sdk" } = {},
): Session[] {
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  const serverAuthoritative = options.source === "server" || officialSessions.some((session) => session.source === "server");
  const officialById = new Map(officialSessions.map((session) => [session.id, session]));
  const parentById = new Map<string, string>();
  for (const official of officialSessions) {
    const parentId = inferTransparentSkillForkParent(official, officialSessions, sessions, projectPath);
    if (parentId) parentById.set(official.id, parentId);
  }
  const supersededOfficialIds = new Set(
    Array.from(parentById.values()),
  );
  const effectiveOfficialSessions = officialSessions.filter((official) => !supersededOfficialIds.has(official.id));
  const visibleOfficialIds = new Set(
    effectiveOfficialSessions
      .filter((official) => official.archived !== true && normalizeProjectPath(official.workDir || projectPath) === normalizedProjectPath)
      .map((official) => official.id)
      .filter(Boolean),
  );
  const archivedOfficialIds = new Set(
    officialSessions
      .filter((official) => official.archived === true && normalizeProjectPath(official.workDir || projectPath) === normalizedProjectPath)
      .map((official) => official.id)
      .filter(Boolean),
  );
  const catalogConfirmedAt = Date.now();
  let changed = false;
  let next = sessions;
  const claimedSessionIndexes = new Set<number>();
  const hiddenRoomOfficialIds = new Set<string>();
  const roomMatches = new Map<string, Array<{ official: OfficialSessionCatalogItem; roomIndex: number; agentId: string }>>();

  for (const official of effectiveOfficialSessions) {
    if (official.archived === true || normalizeProjectPath(official.workDir || projectPath) !== normalizedProjectPath) continue;
    const metadata = parseOfficialRoomMetadata(official.metadata);
    if (!metadata) continue;
    const roomIndex = sessions.findIndex((session) => (
      session.id === metadata.roomId &&
      !session.archivedAt &&
      Boolean(session.collaboration) &&
      normalizeProjectPath(session.projectPath) === normalizedProjectPath
    ));
    if (roomIndex < 0) continue;
    const room = sessions[roomIndex];
    const primary = getPrimaryRoomAgent(room);
    const primaryIds = new Set([
      room.id,
      room.runtimeSessionId,
      room.officialSessionId,
      primary.runtimeSessionId,
      primary.officialSessionId,
    ].filter((id): id is string => Boolean(id)));
    const agent = room.collaboration?.agents.find((candidate) => candidate.id === metadata.roomAgentId);
    if (!agent || agent.removedAt || agent.archivedAt || agent.id === primary.id || !primaryIds.has(metadata.primarySessionId)) continue;
    const key = `${metadata.roomId}\n${metadata.roomAgentId}`;
    const matches = roomMatches.get(key) ?? [];
    matches.push({ official, roomIndex, agentId: agent.id });
    roomMatches.set(key, matches);
  }

  for (const matches of roomMatches.values()) {
    if (matches.length !== 1) continue;
    const { official, roomIndex, agentId } = matches[0];
    const current = next[roomIndex];
    const agent = current.collaboration?.agents.find((candidate) => candidate.id === agentId);
    if (!agent) continue;
    hiddenRoomOfficialIds.add(official.id);
    const alreadyBound = agent.officialSessionId === official.id &&
      (!agent.runtimeSessionId || agent.runtimeSessionId === official.id) &&
      !agent.missingSince &&
      agent.officialCatalogConfirmedAt;
    if (alreadyBound && current.updatedAt >= (official.updatedAt || 0)) continue;
    if (next === sessions) next = [...sessions];
    const rebound = updateRoomAgent(current, agentId, (candidate) => ({
      ...candidate,
      runtimeSessionId: candidate.runtimeSessionId === official.id ? candidate.runtimeSessionId : undefined,
      officialSessionId: official.id,
      officialCatalogConfirmedAt: catalogConfirmedAt,
      missingSince: undefined,
    }));
    next[roomIndex] = {
      ...rebound,
      updatedAt: Math.max(rebound.updatedAt, official.updatedAt || 0),
    };
    changed = true;
  }

  for (const official of effectiveOfficialSessions.filter((item) => !hiddenRoomOfficialIds.has(item.id))) {
    if (!official.id || normalizeProjectPath(official.workDir || projectPath) !== normalizedProjectPath) continue;
    if (official.archived === true) continue;
    const lineageIds = officialLineageIds(official, officialById, parentById);
    const skillForkParentSessionId = parentById.get(official.id);
    const archivedMirrorIndex = next.findIndex((session) => (
      Boolean(session.archivedAt) &&
      normalizeProjectPath(session.projectPath) === normalizedProjectPath &&
      belongsToOfficialSession(session, official.id)
    ));
    if (archivedMirrorIndex >= 0) {
      if (!serverAuthoritative) continue;
      const existing = next[archivedMirrorIndex];
      // The active catalog can lag behind a successful archive mutation. Only a
      // catalog row updated after the local archive is evidence of a real restore.
      // 例外：本地归档已超过 24h 而官方仍在活动目录可见——官方归档滞后不可能超过
      // 分钟级，必为历史误归档（sweep 曾仅凭目录缺席归档有内容会话），自动恢复。
      const restoredAfterArchive = (official.updatedAt || 0) > (existing.archivedAt ?? 0);
      const misArchivedEvidence = Date.now() - (existing.archivedAt ?? 0) > MISARCHIVE_RESTORE_GRACE_MS;
      if (!restoredAfterArchive && !misArchivedEvidence) continue;
      const updatedAt = Math.max(existing.updatedAt, official.updatedAt || 0);
      const officialSessionId = official.id;
      const runtimeSessionId = lineageIds.size > 1 ? official.id : existing.runtimeSessionId;
      const engine = existing.engine ?? "kimi-code";
      const title = existing.titleLocked ? existing.title : catalogTitle(official) ?? existing.title;
      if (next === sessions) next = [...sessions];
      next[archivedMirrorIndex] = {
        ...existing,
        engine,
        runtimeSessionId,
        officialSessionId,
        skillForkParentSessionId,
        title,
        updatedAt,
        archivedAt: undefined,
        officialCatalogConfirmedAt: catalogConfirmedAt,
      };
      claimedSessionIndexes.add(archivedMirrorIndex);
      changed = true;
      continue;
    }
    const existingCandidates = next.flatMap((session, index) => (
      !session.archivedAt && !claimedSessionIndexes.has(index) && belongsToOfficialLineage(session, lineageIds)
        ? [index]
        : []
    ));
    const nonEmptyCandidates = existingCandidates.filter((index) => (
      !isExactEmptyRuntimeMirror(next[index], official.id, projectPath)
    ));
    const stableLocalCandidates = nonEmptyCandidates.filter((index) => !lineageIds.has(next[index].id));
    const preferredCandidates = stableLocalCandidates.length > 0
      ? stableLocalCandidates
      : nonEmptyCandidates.length > 0
        ? nonEmptyCandidates
        : existingCandidates;
    if (preferredCandidates.length > 1) {
      // Two content-bearing owners are real ambiguity. Preserve both and wait
      // for an identity-aware repair instead of selecting by array order.
      preferredCandidates.forEach((index) => claimedSessionIndexes.add(index));
      continue;
    }
    const existingIndex = preferredCandidates[0] ?? -1;
    if (existingIndex >= 0) {
      claimedSessionIndexes.add(existingIndex);
      for (const duplicateIndex of existingCandidates) {
        if (duplicateIndex === existingIndex || !isExactEmptyRuntimeMirror(next[duplicateIndex], official.id, projectPath)) continue;
        if (next === sessions) next = [...sessions];
        next[duplicateIndex] = {
          ...next[duplicateIndex],
          archivedAt: catalogConfirmedAt,
          updatedAt: Math.max(next[duplicateIndex].updatedAt, catalogConfirmedAt),
        };
        changed = true;
      }
      const existing = next[existingIndex];
      if (existing.archivedAt) continue;
      const updatedAt = Math.max(existing.updatedAt, official.updatedAt || 0);
      const officialSessionId = official.id;
      const runtimeSessionId = lineageIds.size > 1 ? official.id : existing.runtimeSessionId;
      const engine = existing.engine ?? "kimi-code";
      const title = existing.titleLocked ? existing.title : catalogTitle(official) ?? existing.title;
      if (
        updatedAt === existing.updatedAt &&
        officialSessionId === existing.officialSessionId &&
        runtimeSessionId === existing.runtimeSessionId &&
        skillForkParentSessionId === existing.skillForkParentSessionId &&
        engine === existing.engine &&
        title === existing.title &&
        existing.officialCatalogConfirmedAt
      ) continue;
      if (next === sessions) next = [...sessions];
      next[existingIndex] = { ...existing, engine, runtimeSessionId, officialSessionId, skillForkParentSessionId, title, updatedAt, officialCatalogConfirmedAt: catalogConfirmedAt };
      changed = true;
      continue;
    }

    if (next === sessions) next = [...sessions];
    next.push({
      id: official.id,
      engine: "kimi-code",
      officialSessionId: official.id,
      skillForkParentSessionId,
      officialCatalogConfirmedAt: catalogConfirmedAt,
      model: null,
      title: catalogTitle(official) ?? "新会话",
      projectPath,
      createdAt: official.updatedAt || Date.now(),
      updatedAt: official.updatedAt || Date.now(),
      events: [],
      isLoading: false,
    });
    claimedSessionIndexes.add(next.length - 1);
    changed = true;
  }

  if (serverAuthoritative) {
    const missingAt = Date.now();
    next.forEach((session, roomIndex) => {
      if (!session.collaboration || session.archivedAt || normalizeProjectPath(session.projectPath) !== normalizedProjectPath) return;
      const primary = getPrimaryRoomAgent(session);
      let room = session;
      let roomChanged = false;
      for (const agent of session.collaboration.agents) {
        if (agent.id === primary.id || agent.removedAt || agent.archivedAt) continue;
        const boundIds = [agent.runtimeSessionId, agent.officialSessionId].filter((id): id is string => Boolean(id));
        if (boundIds.length === 0) continue;
        const present = boundIds.some((id) => visibleOfficialIds.has(id));
        if (present || agent.missingSince) continue;
        room = updateRoomAgent(room, agent.id, (candidate) => ({ ...candidate, missingSince: missingAt }));
        roomChanged = true;
      }
      if (!roomChanged) return;
      if (next === sessions) next = [...sessions];
      next[roomIndex] = room;
      changed = true;
    });
  }

  if (serverAuthoritative || archivedOfficialIds.size > 0 || supersededOfficialIds.size > 0 || next.some((session) => isAbandonedEmptyMirror(session, projectPath))) {
    const archivedAt = Date.now();
    next.forEach((session, index) => {
      if (session.collaboration) return;
      if (!isOfficialMirrorSession(session, projectPath)) return;
      if (claimedSessionIndexes.has(index)) return;
      const referencesVisibleSession = officialSessionIds(session).some((id) => visibleOfficialIds.has(id));
      const explicitlyArchived = officialSessionIds(session).some((id) => archivedOfficialIds.has(id));
      const supersededByTransparentFork = officialSessionIds(session).some((id) => supersededOfficialIds.has(id));
      // Kimi Code 0.24+（agent-core-v2）的 exclude_empty 会把刚创建的空会话立即滤出官方目录；
      // “不在列表里”不等于“已被官方移除”，创建宽限期内只凭显式归档证据处理。
      if (!explicitlyArchived && Date.now() - session.createdAt < EMPTY_SESSION_CREATION_GRACE_MS) return;
      // 目录缺席不等于官方移除（exclude_empty、注册表不全、快照分页都会让目录不完整），
      // 所有路由统一只凭显式证据归档：可见重复镜像 / 官方明确归档 / 透明 fork 取代 / 本地空镜像。
      if (!referencesVisibleSession && !explicitlyArchived && !supersededByTransparentFork && !isAbandonedEmptyMirror(session, projectPath)) return;
      if (next === sessions) next = [...sessions];
      next[index] = { ...session, archivedAt, updatedAt: Math.max(session.updatedAt, archivedAt) };
      changed = true;
    });
  }

  if (!changed) return sessions;
  return next.sort((left, right) => right.updatedAt - left.updatedAt);
}
