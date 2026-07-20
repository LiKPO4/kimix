import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ThemeProvider } from "@/components/common/ThemeProvider";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Session, TimelineEvent, UserMessageImage } from "@/types/ui";
import { mapHistoryEvents, mapStreamEvent, mergeEvents, preserveLocalUserMediaInCanonicalHistory } from "@/utils/eventMapper";
import { mapKimiCodeApprovalRequest, mapKimiCodeEvent, mapKimiCodeQuestionRequest } from "@/utils/kimiCodeEventMapper";
import { deriveSessionTitle, isDefaultSessionTitle, truncateSessionTitle } from "@/utils/sessionTitle";
import { getLastUsedModelFromEvents, resolveAuthoritativeSessionModel } from "@/utils/modelDisplay";
import { reconcileOfficialSessionCatalog, selectStartupOfficialSession } from "@/utils/sessionCatalog";
import { recoverOrphanRoomsFromOfficialCatalog } from "@/utils/orphanRoomSessions";
import { countUserTurns, shouldRecommendNewSession } from "@/utils/sessionMetrics";
import { getLongTaskRoleForRuntime, getRuntimeSessionId } from "@/utils/runtimeSession";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import { getKimiAlreadyExistsSessionId, isKimiAbortError, isKimiActiveTurnError, sendKimiCodePromptWithRetry } from "@/utils/kimiCodeSendRetry";
import { shouldSkipKimiCodeSnapshotReplay } from "@/utils/kimiCodeSnapshotReplay";
import { shouldDeferLocalPendingDispatch } from "@/utils/promptQueue";
import { isKimiCodeSessionInactiveError, isKimiCodeSessionMissingError, isKimiCodeSessionUnavailableError, removeStaleKimiCodeStartupErrors } from "@/utils/kimiCodeSessionRecovery";
import { compareSessionsByRecentConversation, isActiveKimiCodeEngineStatus, isSessionRuntimeRunning, isSessionRuntimeTracked, isTerminalKimiCodeEngineStatus } from "@/utils/sessionActivity";
import { shouldAppendRuntimeStatusToTimeline } from "@/utils/runtimeStatusTimeline";
import { createStartupHydrationGate } from "@/utils/startupHydration";
import { selectStartupLocalSession, selectStartupProject } from "@/utils/startupContext";
import { inferTerminalGoalFromEvent, reconcileOfficialGoalSnapshot } from "@/utils/officialGoalState";
import { normalizeAdditionalWorkDirs } from "@/utils/additionalWorkDirs";
import { isSamePath } from "@/utils/pathCase";
import {
  approvalRequestNotificationKey,
  focusNotificationRoomAgent,
  resolveNotificationClickTarget,
  summarizeApprovalRequest,
  type NotificationClickTarget,
} from "@/utils/notificationRouting";
import {
  settleInactiveEvents,
  settleFailedEvents,
  sanitizePersistedEvents,
  sanitizeKimiSkillActivationTitle,
  hasMalformedAssistantMarkdown,
  hasTurnReceivedBody,
  latestAssistantContent,
  latestAssistantVisibleOrThinkingContent,
} from "@/utils/eventHelpers";
import {
  getHiddenHandoffSessionIds,
  isArchivedSessionTombstoned,
  rememberHiddenHandoffSession,
  rememberArchivedSessionTombstone,
  persistLocalConversationState,
  readLocalActiveContext,
  resetStaleSessionRecommendationEvents,
  loadLocalSessions,
  loadLocalPendingMessages,
} from "@/utils/persistence";
import { useRendererLagDetector } from "@/hooks/useRendererLagDetector";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSettingsSync } from "@/hooks/useSettingsSync";
import { useStatePersistence } from "@/hooks/useStatePersistence";
import { useEventStream } from "@/hooks/useEventStream";
import { useBootstrap } from "@/hooks/useBootstrap";
import { hasLegacyKimiClarificationWrapper, KIMI_HISTORY_CACHE_VERSION } from "@/utils/kimiHistoryCache";
import {
  hasEquivalentKimiHistoryTurnBodies,
  hasPossiblyLostUserImages,
  mergeMissingLatestCanonicalAssistant,
  shouldReplaceWithCanonicalKimiHistory,
} from "@/utils/kimiHistoryReconciliation";
import { logError } from "@/utils/reportError";
import {
  getRoomAgent,
  getRoomAgents,
  getPrimaryRoomAgent,
  getRoomAgentRuntimeId,
  getRoomAgentEvents,
  getRoomAgentSessionView,
  isPrimaryRoomAgent,
  resolveRoomRuntimeOwner,
  roomAgentActivityKey,
  scopeEventToRoomAgent,
  updateRoomAgent,
  updateRoomAgentEvents,
} from "@/utils/collaborationRooms";
import { markAgentKimiHistoryCacheCurrent, reconcileAgentCanonicalHistory } from "@/utils/collaborationHistory";
import {
  bindRecoveredRoomAgentRuntime,
  getRoomAgentRecoveryTargets,
  reconcileRoomAgentModelAvailability,
  resumeRoomAgentRuntime,
  roomAgentCanResume,
  setRoomAgentRecoveryIssue,
  type RoomAgentRecoveryTarget,
} from "@/utils/roomAgentRecovery";
import {
  applyRoomDeliveryRuntimeStatus,
  collectRoomDeliveryEvidenceFromHistory,
  recoverInterruptedRoomDeliveries,
  type RoomDeliveryOfficialEvidence,
} from "@/utils/roomDelivery";
import { getRoomAgentReconciliationTargets, getRunnableRoomAgentReconciliationTargets, isRoomAgentReconciliationStatus, settleStoppedRoomAgent, settleTerminalRoomAgent } from "@/utils/roomAgentControl";

function currentSessionPromptModel(sessionId: string): string | undefined {
  const session = useSessionStore.getState().sessions.find((item) => item.id === sessionId);
  if (!session) return undefined;
  const primary = getPrimaryRoomAgent(session);
  return primary.switchedToModel ?? primary.modelAlias ?? undefined;
}

function promptImages(attachments: UserMessageImage[] = []) {
  return attachments
    .filter((image): image is UserMessageImage & { dataUrl: string } => Boolean(image.dataUrl))
    .map((image) => ({ name: image.name, dataUrl: image.dataUrl }));
}

function contentWithFileAttachments(content: string, attachments: UserMessageImage[] = []) {
  const files = attachments.filter((image) => image.kind === "file" || Boolean(image.filePath));
  if (files.length === 0) return content;
  const fileLines = files.map((file, index) => {
    const filePath = file.filePath?.trim();
    return `${index + 1}. ${file.name}${filePath ? `\n   绝对路径：${filePath}` : "\n   绝对路径：未能从系统拖拽事件读取，请提示用户重新选择文件"}`;
  });
  return [
    content.trim(),
    "附件文件：",
    ...fileLines,
    "",
    "请直接使用上述绝对路径读取附件内容，不要只按文件名搜索。",
  ].filter(Boolean).join("\n");
}

function extractSwarmModeStatus(value: unknown): boolean | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as { swarmMode?: unknown };
  return typeof record.swarmMode === "boolean" ? record.swarmMode : undefined;
}

const HANDOFF_PROMPT = `请阅读项目规则，优先参考 AGENTS.md，然后生成可直接交给下一个 agent 的交接提示词。
只输出一个 Markdown 代码块，不要输出解释。

交接内容必须包含：
- 项目背景
- 当前目标
- 已完成
- 未完成
- 阻塞
- 关键文件/命令
- 下一步最小行动`;
const HANDOFF_TIMEOUT_MS = 180_000;
const STARTUP_ACTIVE_CONTEXT = readLocalActiveContext();
let rendererWindowFocusedHint = typeof document !== "undefined" ? document.hasFocus() : false;

interface HandoffJob {
  sourceSessionId: string;
  runtimeSessionId: string;
  projectPath: string;
  recommendationEventId: string;
  events: TimelineEvent[];
  timeoutId: number;
}

interface StartHandoffDetail {
  sourceSessionId: string;
  projectPath: string;
  recommendationEventId: string;
}

function findSessionByRuntimeIdentity(sessions: Session[], historySessionId: string, runtimeSessionId?: string, officialSessionId?: string | null): Session | undefined {
  const roomOwner = [historySessionId, runtimeSessionId, officialSessionId]
    .filter((id): id is string => Boolean(id))
    .map((id) => resolveRoomRuntimeOwner(sessions, id))
    .find((owner) => Boolean(owner));
  if (roomOwner) return roomOwner.session;
  const ids = new Set([historySessionId, runtimeSessionId, officialSessionId ?? undefined].filter((id): id is string => Boolean(id)));
  return sessions.find((session) => !session.archivedAt && (
    ids.has(session.id) ||
    Boolean(session.officialSessionId && ids.has(session.officialSessionId)) ||
    Boolean(session.runtimeSessionId && ids.has(session.runtimeSessionId)) ||
    Boolean(session.skillForkParentSessionId && ids.has(session.skillForkParentSessionId)) ||
    Boolean(session.longTask?.executorSessionId && ids.has(session.longTask.executorSessionId)) ||
    Boolean(session.longTask?.reviewerSessionId && ids.has(session.longTask.reviewerSessionId))
  ));
}

function findLocalSessionForRuntime(historySessionId: string, runtimeSessionId?: string, officialSessionId?: string | null): Session | undefined {
  return findSessionByRuntimeIdentity(useSessionStore.getState().sessions, historySessionId, runtimeSessionId, officialSessionId);
}

function hasArchivedLocalSessionForRuntime(historySessionId: string, runtimeSessionId?: string, officialSessionId?: string | null, projectPath?: string): boolean {
  const ids = new Set([historySessionId, runtimeSessionId, officialSessionId ?? undefined].filter((id): id is string => Boolean(id)));
  if (isArchivedSessionTombstoned([...ids], projectPath)) return true;
  return useSessionStore.getState().sessions.some((session) => (
    Boolean(session.archivedAt) &&
    (!projectPath || isSameLocalProjectPath(session.projectPath, projectPath)) &&
    (
      ids.has(session.id) ||
      Boolean(session.officialSessionId && ids.has(session.officialSessionId)) ||
      Boolean(session.runtimeSessionId && ids.has(session.runtimeSessionId)) ||
      Boolean(session.longTask?.executorSessionId && ids.has(session.longTask.executorSessionId)) ||
      Boolean(session.longTask?.reviewerSessionId && ids.has(session.longTask.reviewerSessionId))
    )
  ));
}

function isSameLocalProjectPath(a: string | undefined, b: string | undefined) {
  return isSamePath(a, b);
}

function roomAgentNeedsKimiCodeHistoryRepair(session: Session, roomAgentId: string) {
  const agent = getRoomAgent(session, roomAgentId);
  const events = getRoomAgentEvents(session, roomAgentId);
  const cacheVersion = session.collaboration ? agent?.kimiHistoryCacheVersion : session.kimiHistoryCacheVersion;
  return cacheVersion !== KIMI_HISTORY_CACHE_VERSION ||
    events.some((event) => (
      event.type === "assistant_message" &&
      (event.content.trim().length > 0 || (event.isComplete && event.content.trim().length === 0))
    )) ||
    hasLegacyKimiClarificationWrapper(events) ||
    hasMalformedAssistantMarkdown(events) ||
    hasPossiblyLostUserImages(events);
}

function needsKimiCodeHistoryRepair(session: Session) {
  return session.engine === "kimi-code" &&
    !session.longTask &&
    !session.archivedAt &&
    Boolean(session.projectPath) &&
    getRoomAgents(session).some((agent) => roomAgentNeedsKimiCodeHistoryRepair(session, agent.id));
}

function getKimiHistoryTargets(session: Session) {
  return getRoomAgentRecoveryTargets(session).filter((target) => (
    roomAgentNeedsKimiCodeHistoryRepair(session, target.roomAgentId)
  ));
}

function extractOfficialSessionTitle(event: unknown): string | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const record = event as Record<string, unknown>;
  if (record.type !== "session.meta.updated" || typeof record.title !== "string") return null;
  const title = truncateSessionTitle(record.title);
  return title && !isDefaultSessionTitle(title) ? title : null;
}

async function repairKimiCodeHistoryBodies(sessions: Session[]) {
  const activeSessionId = STARTUP_ACTIVE_CONTEXT?.sessionId;
  const candidates = sessions
    .filter((session) => session.id !== activeSessionId && needsKimiCodeHistoryRepair(session))
    .slice(0, 12);
  for (const session of candidates) {
    if (!session.projectPath) continue;
    for (const target of getKimiHistoryTargets(session)) {
      let historyReachable = false;
      let recoveryAccepted = false;
      for (const sessionId of target.sessionIds) {
        const loaded = await window.api.loadKimiCodeSession({ workDir: session.projectPath, sessionId }).catch(() => null);
        if (!loaded?.success) continue;
        historyReachable = true;
        const eventsSource =
          loaded.data && typeof loaded.data === "object" && Array.isArray(loaded.data.events)
            ? loaded.data.events
            : [];
        let applied = false;
        useSessionStore.setState((state) => ({
          sessions: state.sessions.map((item) => {
            if (item.id !== session.id) return item;
            const localEvents = getRoomAgentEvents(item, target.roomAgentId);
            const reconciliation = reconcileAgentCanonicalHistory({
              session: item,
              roomAgentId: target.roomAgentId,
              expectedRuntimeSessionId: sessionId,
              canonicalEvents: settleInactiveEvents(mapHistoryEvents(eventsSource)),
              reason: "repair",
            });
            if (!reconciliation.applied) {
              return item;
            }
            recoveryAccepted = true;
            const evidence = collectRoomDeliveryEvidenceFromHistory(
              reconciliation.session,
              target.roomAgentId,
            );
            const recoveredDeliveries = recoverInterruptedRoomDeliveries(
              item,
              evidence,
              Date.now(),
              new Set([target.roomAgentId]),
            );
            if (!shouldReplaceWithCanonicalKimiHistory(localEvents, reconciliation.events, { sessionId: item.id, roomAgentId: target.roomAgentId, reason: "repair" })) {
              const canonicalVerified = hasEquivalentKimiHistoryTurnBodies(localEvents, reconciliation.events);
              const patchedEvents = mergeMissingLatestCanonicalAssistant(
                localEvents,
                reconciliation.events,
                { sessionId: item.id, roomAgentId: target.roomAgentId, reason: "repair" },
              );
              const patched = patchedEvents === localEvents
                ? recoveredDeliveries
                : updateRoomAgentEvents(recoveredDeliveries, target.roomAgentId, () => patchedEvents);
              applied = patched !== item || canonicalVerified;
              return canonicalVerified
                ? markAgentKimiHistoryCacheCurrent(patched, target.roomAgentId)
                : patched;
            }
            applied = true;
            const recovered = recoverInterruptedRoomDeliveries(
              reconciliation.session,
              evidence,
              Date.now(),
              new Set([target.roomAgentId]),
            );
            return {
              ...markAgentKimiHistoryCacheCurrent(recovered, target.roomAgentId),
              title: isPrimaryRoomAgent(item, target.roomAgentId) && !item.titleLocked
                ? deriveSessionTitle(reconciliation.events, item.title)
                : item.title,
              isLoading: false,
            };
          }),
        }));
        if (!applied) continue;
        const latest = useSessionStore.getState().sessions.find((item) => item.id === session.id);
        if (latest && useAppStore.getState().currentSession?.id === session.id) {
          useAppStore.setState({ currentSession: latest });
        }
        void persistLocalConversationState();
        break;
      }
      if (recoveryAccepted && session.collaboration) {
        useSessionStore.setState((state) => ({
          sessions: state.sessions.map((item) => {
            if (item.id !== session.id) return item;
            const agent = getRoomAgent(item, target.roomAgentId);
            return agent?.recoveryIssue?.status === "error"
              ? setRoomAgentRecoveryIssue(item, target.roomAgentId, undefined)
              : item;
          }),
        }));
        void persistLocalConversationState();
      }
      if (historyReachable && !recoveryAccepted && session.collaboration) {
        useSessionStore.setState((state) => ({
          sessions: state.sessions.map((item) => (
            item.id === session.id
              ? setRoomAgentRecoveryIssue(item, target.roomAgentId, {
                status: "error",
                message: "后台修复结果到达时该 Agent 的 runtime 身份已变化，已保留现有 canonical history。",
                updatedAt: Date.now(),
              })
              : item
          )),
        }));
        void persistLocalConversationState();
      }
      if (!historyReachable && session.collaboration) {
        useSessionStore.setState((state) => ({
          sessions: state.sessions.map((item) => (
            item.id === session.id
              ? setRoomAgentRecoveryIssue(item, target.roomAgentId, {
                status: "error",
                message: "后台修复无法读取该 Agent 的官方历史，已保留本地 canonical history。",
                updatedAt: Date.now(),
              })
              : item
          )),
        }));
        void persistLocalConversationState();
      }
    }
  }
}

async function readAvailableRoomModelAliases(): Promise<ReadonlySet<string> | null> {
  const [configResult, serverResult] = await Promise.all([
    window.api.getKimiModelConfig().catch(() => null),
    window.api.getKimiCodeServerModelCatalog().catch(() => null),
  ]);
  if (!configResult?.success && !serverResult?.success) return null;
  const aliases = new Set<string>();
  if (configResult?.success) {
    for (const model of configResult.data.models) {
      if (model.alias.trim()) aliases.add(model.alias.trim());
    }
    if (configResult.data.defaultModel?.trim()) aliases.add(configResult.data.defaultModel.trim());
  }
  if (serverResult?.success) {
    if (serverResult.data.auth.defaultModel?.trim()) aliases.add(serverResult.data.auth.defaultModel.trim());
    for (const model of serverResult.data.models) {
      const rawModel = model.model.trim();
      const provider = model.provider.trim();
      if (!rawModel) continue;
      aliases.add(rawModel);
      if (provider && !rawModel.includes("/")) {
        aliases.add(`${provider}/${rawModel}`);
        if (provider.startsWith("managed:")) aliases.add(`${provider.slice("managed:".length)}/${rawModel}`);
      }
    }
  }
  return aliases;
}

type StartupRoomAgentRecoveryResult = {
  target: RoomAgentRecoveryTarget;
  success: boolean;
  sessionId?: string;
  canonicalEvents?: TimelineEvent[];
  runtimeIsActive?: boolean;
  engineStatus?: string;
  model?: string;
  swarmMode?: boolean;
  error?: string;
};

async function loadStartupRoomAgentHistory(
  room: Session,
  target: RoomAgentRecoveryTarget,
): Promise<StartupRoomAgentRecoveryResult> {
  if (target.sessionIds.length === 0) {
    return {
      target,
      success: false,
      error: "当前 Agent 尚未绑定可恢复的 Kimi Code session",
    };
  }
  let lastError = "未找到可读取的 Kimi Code 历史";
  for (const sessionId of target.sessionIds) {
    let loaded = await window.api.loadKimiCodeSession({
      workDir: room.projectPath,
      sessionId,
    }).catch((error) => ({
      success: false as const,
      error: error instanceof Error ? error.message : String(error),
    }));
    if (!loaded.success) {
      lastError = loaded.error;
      continue;
    }
    if (
      Array.isArray(loaded.data.events) &&
      loaded.data.events.length === 0 &&
      target.skillForkParentSessionId &&
      sessionId.startsWith("skill-")
    ) {
      const fallbackLoaded = await window.api.loadKimiCodeSession({
        workDir: room.projectPath,
        sessionId: target.skillForkParentSessionId,
      }).catch(() => null);
      if (fallbackLoaded?.success && Array.isArray(fallbackLoaded.data.events) && fallbackLoaded.data.events.length > 0) {
        loaded = fallbackLoaded;
      }
    }
    const runtimeStatus = await window.api.getKimiCodeStatus({ sessionId }).catch(() => null);
    const runtimeIsActive = Boolean(
      runtimeStatus?.success && isActiveKimiCodeEngineStatus(runtimeStatus.data.engineStatus)
    );
    const mappedEvents = mapHistoryEvents(Array.isArray(loaded.data.events) ? loaded.data.events : []);
    return {
      target,
      success: true,
      sessionId,
      canonicalEvents: runtimeIsActive ? mappedEvents : settleInactiveEvents(mappedEvents),
      runtimeIsActive,
      engineStatus: runtimeStatus?.success ? runtimeStatus.data.engineStatus : undefined,
      model: runtimeStatus?.success ? runtimeStatus.data.model : undefined,
      swarmMode: runtimeStatus?.success ? extractSwarmModeStatus(runtimeStatus.data) : undefined,
    };
  }
  return { target, success: false, error: lastError };
}

async function recoverCollaborationRoomAtStartup(roomId: string): Promise<void> {
  const snapshot = useSessionStore.getState().sessions.find((session) => session.id === roomId);
  if (!snapshot?.collaboration || snapshot.longTask) return;
  const [availableModelAliases, results] = await Promise.all([
    readAvailableRoomModelAliases(),
    Promise.all(getRoomAgentRecoveryTargets(snapshot).map((target) => loadStartupRoomAgentHistory(snapshot, target))),
  ]);
  let primaryActive = false;
  const activeResults: StartupRoomAgentRecoveryResult[] = [];
  const deliveryEvidence = new Map<string, RoomDeliveryOfficialEvidence>();
  useSessionStore.setState((state) => ({
    sessions: state.sessions.map((session) => {
      if (!session.collaboration) return session;
      if (session.id !== roomId) return reconcileRoomAgentModelAvailability(session, availableModelAliases);
      let next = session;
      for (const result of results) {
        if (!result.success || !result.sessionId || !result.canonicalEvents) {
          next = setRoomAgentRecoveryIssue(next, result.target.roomAgentId, {
            status: "error",
            message: `恢复 Agent 历史失败：${result.error ?? "未知错误"}`,
            updatedAt: Date.now(),
          });
          continue;
        }
        const localEvents = getRoomAgentEvents(next, result.target.roomAgentId);
        const reconciliation = reconcileAgentCanonicalHistory({
          session: next,
          roomAgentId: result.target.roomAgentId,
          expectedRuntimeSessionId: result.sessionId,
          canonicalEvents: result.canonicalEvents,
          reason: "startup",
        });
        if (!reconciliation.applied) {
          next = setRoomAgentRecoveryIssue(next, result.target.roomAgentId, {
            status: "error",
            message: "恢复结果到达时该 Agent 的 runtime 身份已变化，已保留现有 canonical history。",
            updatedAt: Date.now(),
          });
          continue;
        }
        for (const [attemptId, evidence] of collectRoomDeliveryEvidenceFromHistory(
          reconciliation.session,
          result.target.roomAgentId,
        )) {
          deliveryEvidence.set(attemptId, evidence);
        }
        const shouldUseCanonicalHistory = shouldReplaceWithCanonicalKimiHistory(localEvents, reconciliation.events, { sessionId: reconciliation.session.id, roomAgentId: result.target.roomAgentId, reason: "runtime-recovery" });
        const canonicalAdopted = localEvents.length === 0 || shouldUseCanonicalHistory;
        const rejectedPatchedEvents = canonicalAdopted
          ? localEvents
          : mergeMissingLatestCanonicalAssistant(
            localEvents,
            reconciliation.events,
            { sessionId: reconciliation.session.id, roomAgentId: result.target.roomAgentId, reason: "runtime-recovery" },
          );
        const hydratedEvents = !canonicalAdopted
          ? (result.runtimeIsActive ? rejectedPatchedEvents : settleInactiveEvents(rejectedPatchedEvents))
          : reconciliation.events;
        next = updateRoomAgentEvents(reconciliation.session, result.target.roomAgentId, () => hydratedEvents);
        next = updateRoomAgent(next, result.target.roomAgentId, (agent) => ({
          ...agent,
          runtimeSessionId: result.sessionId,
          officialSessionId: agent.officialSessionId ?? result.sessionId,
          modelAlias: resolveAuthoritativeSessionModel({
            runtimeModel: result.model,
            sessionModel: agent.switchedToModel ?? agent.modelAlias,
            historyModel: getLastUsedModelFromEvents(hydratedEvents),
          }),
          switchedToModel: result.model ? undefined : agent.switchedToModel,
          swarmMode: result.swarmMode ?? agent.swarmMode,
          missingSince: undefined,
          recoveryIssue: undefined,
        }));
        if (canonicalAdopted || hasEquivalentKimiHistoryTurnBodies(localEvents, reconciliation.events)) {
          next = markAgentKimiHistoryCacheCurrent(next, result.target.roomAgentId);
        }
        if (isPrimaryRoomAgent(next, result.target.roomAgentId) && !next.titleLocked) {
          next = { ...next, title: deriveSessionTitle(hydratedEvents, next.title) };
        }
        if (result.runtimeIsActive) {
          activeResults.push(result);
          if (isPrimaryRoomAgent(next, result.target.roomAgentId)) primaryActive = true;
        }
      }
      next = recoverInterruptedRoomDeliveries(next, deliveryEvidence);
      next = reconcileRoomAgentModelAvailability(next, availableModelAliases);
      return { ...next, isLoading: false };
    }),
  }));
  const recovered = useSessionStore.getState().sessions.find((session) => session.id === roomId);
  if (!recovered) return;
  for (const result of activeResults) {
    useAppStore.getState().setRoomAgentActivity({
      roomId,
      roomAgentId: result.target.roomAgentId,
      runtimeSessionId: result.sessionId,
      status: result.engineStatus === "waiting_approval" || result.engineStatus === "waiting_question"
        ? result.engineStatus
        : "running",
      updatedAt: Date.now(),
    });
  }
  if (useAppStore.getState().currentSession?.id === roomId) {
    useAppStore.setState({ currentSession: recovered });
  }
  useAppStore.getState().setRunningSessionId(primaryActive ? roomId : null);
  void persistLocalConversationState();
}

function appendSessionRecommendationIfNeeded(events: TimelineEvent[], enabled: boolean, turnLimit: number): TimelineEvent[] {
  const sessionLike = {
    id: "",
    title: "",
    projectPath: "",
    createdAt: 0,
    updatedAt: 0,
    events,
    isLoading: false,
  };
  if (!shouldRecommendNewSession(sessionLike, enabled, turnLimit)) return events;
  const turnCount = countUserTurns(events);
  const latest = events.at(-1);
  if (
    latest?.type === "session_recommendation" &&
    latest.reason === "turn_limit" &&
    latest.turnCount === turnCount &&
    latest.turnLimit === turnLimit
  ) {
    return events;
  }
  return [
    ...events,
    {
      id: crypto.randomUUID(),
      type: "session_recommendation",
      timestamp: Date.now(),
      reason: "turn_limit",
      turnCount,
      turnLimit,
    },
  ];
}

function settlePendingSteerMessages(events: TimelineEvent[], status: "sent" | "failed", error?: string): TimelineEvent[] {
  if (!events.some((event) => event.type === "steer_message" && (event.status === "sending" || event.status === "accepted"))) return events;
  return events.map((event) => (
    event.type === "steer_message" && (event.status === "sending" || event.status === "accepted")
      ? { ...event, status, error: status === "failed" ? error : undefined }
      : event
  ));
}

async function shouldWaitForOfficialPromptQueue(runtimeSessionId: string) {
  const response = await window.api.getKimiCodePromptQueue({ sessionId: runtimeSessionId }).catch(() => null);
  return shouldDeferLocalPendingDispatch(response?.success ? response.data : null);
}

function summarizeNotificationBody(content: string): string {
  const normalized = content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.length > 120 ? `${normalized.slice(0, 118)}...` : normalized;
}

function extractAssistantForTurn(
  events: TimelineEvent[],
  start?: { eventStartIndex: number; openAssistantIds: Set<string> },
) {
  const settled = settleInactiveEvents(events);
  const eventStartIndex = Math.max(0, Math.min(start?.eventStartIndex ?? 0, settled.length));
  const openAssistantIds = start?.openAssistantIds ?? new Set<string>();
  const assistant = settled
    .map((event, index) => ({ event, index }))
    .reverse()
    .find((entry): entry is { event: Extract<TimelineEvent, { type: "assistant_message" }>; index: number } => (
      entry.event.type === "assistant_message" &&
      entry.event.content.trim().length > 0 &&
      (entry.index >= eventStartIndex || openAssistantIds.has(entry.event.id))
    ));
  return assistant?.event;
}

function getNotificationAgentContext(uiSessionId: string, runtimeSessionId: string, target?: Partial<NotificationClickTarget>) {
  const session = useSessionStore.getState().sessions.find((item) => item.id === uiSessionId);
  const runtimeOwner = resolveRoomRuntimeOwner(session ? [session] : [], runtimeSessionId);
  const roomAgentId = target?.roomAgentId ?? runtimeOwner?.roomAgentId;
  const agent = session?.collaboration && roomAgentId ? getRoomAgent(session, roomAgentId) : undefined;
  return { session, roomAgentId, agentName: agent?.displayName };
}

function notifyTurnComplete(
  uiSessionId: string,
  runtimeSessionId: string,
  label?: string,
  assistant?: Extract<TimelineEvent, { type: "assistant_message" }>,
  target?: Partial<NotificationClickTarget>,
) {
  const { session, roomAgentId, agentName } = getNotificationAgentContext(uiSessionId, runtimeSessionId, target);
  const sessionTitle = session?.title?.trim() || "当前会话";
  const showContent = useAppStore.getState().notificationShowContent ?? false;
  const summary = showContent ? summarizeNotificationBody(assistant?.content ?? "") : "";
  const suffix = label ? `（${label}）` : "";
  const fallbackBody = agentName
    ? `${agentName} 已处理完成，可以回来查看结果。`
    : "当前轮次处理已完成，可以回来查看结果。";
  void window.api.notifyTurnComplete({
    title: agentName ? `Kimix · ${agentName} 本轮已完成${suffix}` : `Kimix 本轮已完成${suffix}`,
    body: summary
      ? `${agentName ? `${agentName}：` : ""}${summary}`
      : agentName
        ? `「${sessionTitle}」中的 ${agentName} 已处理完成，可以回来查看结果。`
        : `「${sessionTitle}」已处理完成，可以回来查看结果。`,
    fallbackBody,
    sessionId: uiSessionId,
    roomAgentId,
    agentTurnId: target?.agentTurnId ?? assistant?.agentTurnId,
    eventId: target?.eventId ?? assistant?.id,
    windowFocused: document.hasFocus() || rendererWindowFocusedHint,
    pageVisible: document.visibilityState === "visible",
  }).catch((err) => {
    console.warn("Notify turn complete failed:", err, { uiSessionId, runtimeSessionId });
  });
}

function notifyClarificationNeeded(uiSessionId: string, runtimeSessionId: string, event: Extract<TimelineEvent, { type: "question_request" }>) {
  const { session, roomAgentId, agentName } = getNotificationAgentContext(uiSessionId, runtimeSessionId, event);
  const sessionTitle = session?.title?.trim() || "当前会话";
  const showContent = useAppStore.getState().notificationShowContent ?? false;
  const summary = showContent ? summarizeNotificationBody(summarizeQuestionRequest(event)) : "";
  const fallbackBody = agentName
    ? `${agentName} 正在等待你的澄清回复。`
    : "当前会话正在等待你的澄清回复。";
  void window.api.notifyTurnComplete({
    title: agentName ? `Kimix · ${agentName} 等待你的回复` : "Kimix 需要你回复需求澄清",
    body: summary
      ? `${agentName ? `${agentName}：` : ""}${summary}`
      : agentName
        ? `「${sessionTitle}」中的 ${agentName} 正在等待你的澄清回复。`
        : `「${sessionTitle}」正在等待你的澄清回复。`,
    fallbackBody,
    sessionId: uiSessionId,
    roomAgentId,
    agentTurnId: event.agentTurnId,
    eventId: event.id,
    windowFocused: document.hasFocus() || rendererWindowFocusedHint,
    pageVisible: document.visibilityState === "visible",
  }).catch((err) => {
    console.warn("Notify clarification needed failed:", err, { uiSessionId, runtimeSessionId });
  });
}

function notifyApprovalNeeded(uiSessionId: string, runtimeSessionId: string, event: Extract<TimelineEvent, { type: "approval_request" }>) {
  const { session, roomAgentId, agentName } = getNotificationAgentContext(uiSessionId, runtimeSessionId, event);
  const sessionTitle = session?.title?.trim() || "当前会话";
  const showContent = useAppStore.getState().notificationShowContent ?? false;
  const summary = showContent ? summarizeNotificationBody(summarizeApprovalRequest(event)) : "";
  const fallbackBody = agentName
    ? `${agentName} 需要你确认工具操作后才能继续。`
    : "当前会话需要你确认工具操作后才能继续。";
  void window.api.notifyTurnComplete({
    title: agentName ? `Kimix · ${agentName} 等待审批` : "Kimix 工具操作等待审批",
    body: summary
      ? `${agentName ? `${agentName}：` : ""}${summary}`
      : agentName
        ? `「${sessionTitle}」中的 ${agentName} 需要你确认后才能继续。`
        : `「${sessionTitle}」需要你确认后才能继续。`,
    fallbackBody,
    sessionId: uiSessionId,
    roomAgentId,
    agentTurnId: event.agentTurnId,
    eventId: event.id,
    windowFocused: document.hasFocus() || rendererWindowFocusedHint,
    pageVisible: document.visibilityState === "visible",
  }).catch((err) => {
    console.warn("Notify approval needed failed:", err, { uiSessionId, runtimeSessionId, requestId: event.requestId });
  });
}

function updateRecommendationEvent(sessionId: string, eventId: string, patch: Partial<Extract<TimelineEvent, { type: "session_recommendation" }>>) {
  useSessionStore.getState().updateSession(sessionId, (session) => ({
    ...session,
    events: session.events.map((event) => (
      event.type === "session_recommendation" && event.id === eventId
        ? { ...event, ...patch }
        : event
    )),
    updatedAt: Date.now(),
  }));
}

function getHandoffTerminalStatus(event: unknown): "completed" | "error" | "interrupted" | null {
  const type = event && typeof event === "object" ? (event as { type?: unknown }).type : undefined;
  if (type === "turn.ended") {
    const reason = (event as { reason?: unknown }).reason;
    if (reason === "cancelled" || reason === "interrupted") return "interrupted";
    if (reason === "failed" || reason === "error") return "error";
    return "completed";
  }
  if (type === "error") return "error";
  return null;
}

function extractAssistantContent(events: TimelineEvent[]): string {
  const assistant = [...settleInactiveEvents(events)]
    .reverse()
    .find((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => event.type === "assistant_message" && event.content.trim().length > 0);
  return assistant?.content.trim() ?? "";
}

function eventToHandoffLine(event: TimelineEvent): string | null {
  if (event.type === "user_message") return `用户：${event.content || "[图片]"}`;
  if (event.type === "steer_message") return `用户引导：${event.content}`;
  if (event.type === "assistant_message") return event.content.trim() ? `助手：${event.content.trim()}` : null;
  if (event.type === "tool_call") return `执行命令：${event.toolName} ${event.rawArguments ?? JSON.stringify(event.arguments)}`;
  if (event.type === "change_summary") {
    const files = event.files.map((file) => `${file.path} (+${file.additions ?? 0}/-${file.deletions ?? 0})`).join("；");
    return `文件变更：${files}`;
  }
  if (event.type === "file_artifact") return `文件：${event.filePath}`;
  if (event.type === "todo") return `TodoList：${event.items.map((item) => `${item.status} ${item.content}`).join("；")}`;
  if (event.type === "error") return `错误：${event.message}`;
  return null;
}

function buildHandoffPrompt(sourceSession: Session | undefined): string {
  const visibleHistory = sourceSession?.events
    .map(eventToHandoffLine)
    .filter((line): line is string => Boolean(line?.trim()))
    .slice(-80)
    .join("\n\n") || "当前没有可用的可见聊天记录。";
  return `${HANDOFF_PROMPT}

下面是 Kimix 当前窗口中可见的会话记录。请只基于这些记录生成交接提示词，不要编造，不要把这次交接生成任务本身写进交接内容，不要输出解释。

会话标题：${sourceSession?.title ?? "未知会话"}
工作目录：${sourceSession?.projectPath ?? "未知目录"}

--- 可见会话记录开始 ---
${visibleHistory}
--- 可见会话记录结束 ---`;
}

function resolveUiSessionId(sessionId: string, officialSessionId?: string | null): string {
  const roomOwner = resolveRoomRuntimeOwner(useSessionStore.getState().sessions, sessionId, officialSessionId);
  if (roomOwner) return roomOwner.roomId;
  const ids = new Set([sessionId, officialSessionId ?? undefined].filter((id): id is string => Boolean(id)));
  const owner = useSessionStore.getState().sessions.find((session) => (
    ids.has(session.id) ||
    Boolean(session.runtimeSessionId && ids.has(session.runtimeSessionId)) ||
    Boolean(session.officialSessionId && ids.has(session.officialSessionId)) ||
    Boolean(session.longTask?.executorSessionId && ids.has(session.longTask.executorSessionId)) ||
    Boolean(session.longTask?.reviewerSessionId && ids.has(session.longTask.reviewerSessionId))
  ));
  return owner?.id ?? sessionId;
}

function resolveRuntimeSessionId(sessionId: string): string {
  const owner = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
  return getRuntimeSessionId(owner) ?? sessionId;
}

function buildLongTaskRecovery(
  role: "executor" | "reviewer",
  status: "error" | "interrupted" | "paused",
  reason?: string,
): NonNullable<Session["longTask"]>["recovery"] {
  const roleLabel = role === "reviewer" ? "用户审查流程" : "长程任务";
  if (status === "error") {
    return {
      status: "failed",
      reason: reason || `${roleLabel} 运行失败`,
      suggestedAction: `查看本轮错误后点击继续，Kimix 会从${roleLabel}继续；必要时先复制下一步 prompt 手动调整。`,
      updatedAt: Date.now(),
    };
  }
  if (status === "interrupted") {
    return {
      status: "interrupted",
      reason: reason || `${roleLabel} 被中断`,
      suggestedAction: `确认中断原因后点击继续，Kimix 会从${roleLabel}恢复当前 Step。`,
      updatedAt: Date.now(),
    };
  }
  return {
    status: "paused",
    reason: reason || "用户暂停了长程任务",
    suggestedAction: "确认当前状态后点击继续，或复制下一步 prompt 手动恢复。",
    updatedAt: Date.now(),
  };
}

function markLongTaskRuntimeActivity(uiSessionId: string, runtimeSessionId: string, status?: "running" | "error" | "interrupted" | "completed") {
  const store = useSessionStore.getState();
  const target = store.sessions.find((session) => session.id === uiSessionId);
  const role = getLongTaskRoleForRuntime(target, runtimeSessionId);
  if (!target?.longTask || !role) return;

  store.updateSession(uiSessionId, (session) => {
    if (!session.longTask) return session;
    let stage = session.longTask.stage;
    let recovery: NonNullable<Session["longTask"]>["recovery"] | null = session.longTask.recovery ?? null;
    if (status === "interrupted" || status === "error") {
      stage = "paused";
      recovery = buildLongTaskRecovery(role, status);
    } else if (status === "running" && role === "reviewer") {
      stage = "reviewing";
      recovery = null;
    } else if (status === "running" && role === "executor" && stage === "reviewing") {
      stage = "running";
      recovery = null;
    } else if (status === "running" || status === "completed") {
      recovery = null;
    }
    return {
      ...session,
      longTask: {
        ...session.longTask,
        activeAgent: role,
        stage,
        recovery,
      },
      updatedAt: Date.now(),
    };
  });
  const latest = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
  if (latest?.longTask) {
    void window.api.updateLongTaskState({
      projectPath: latest.projectPath,
      taskId: latest.longTask.taskId,
      patch: {
        activeAgent: latest.longTask.activeAgent,
        stage: latest.longTask.stage,
        recovery: latest.longTask.recovery ?? null,
        currentStep: latest.longTask.currentStep,
        targetStep: latest.longTask.targetStep,
        reviewedReviewItems: latest.longTask.reviewedReviewItems ?? [],
        },
      }).catch(logError("persistLongTaskMeta"));
    }

    const active = useAppStore.getState().currentSession;
  if (active?.id === uiSessionId) {
    if (latest) useAppStore.getState().setCurrentSession(latest);
  }
}

function hasPendingQuestion(events: TimelineEvent[]) {
  return events.some((event) => event.type === "question_request" && event.status === "pending");
}

function questionRequestNotificationKey(event: Extract<TimelineEvent, { type: "question_request" }>) {
  return event.rpcRequestId || event.requestId || event.toolCallId || event.id;
}

function summarizeQuestionRequest(event: Extract<TimelineEvent, { type: "question_request" }>) {
  return event.questions.map((question) => question.question).filter(Boolean).join(" / ");
}

function settlePendingQuestions(events: TimelineEvent[], status: "skipped" | "answered" = "skipped"): TimelineEvent[] {
  if (!events.some((event) => event.type === "question_request" && event.status === "pending")) return events;
  return events.map((event) => (
    event.type === "question_request" && event.status === "pending"
      ? { ...event, status, answers: event.answers ?? {} }
      : event
  ));
}

/**
 * 在 runtime 会话终止时清理不用的 per-runtime ref 条目。
 * notifiedQuestionRequestRef 仅在 error/interrupted 时清理，
 * 以免同一 runtime 在新轮中丢掉 question 去重。
 */
function cleanupRuntimeRefs(
  runtimeSessionId: string,
  terminalStatus: "completed" | "error" | "interrupted",
  refs: {
    notifiedQuestionRequest: Set<string>;
    hiddenLongTaskEvents: Map<string, TimelineEvent[]>;
  },
) {
  // 仅 error/interrupted 清理 question 去重记录；completed 保留以保护新轮去重
  if (terminalStatus !== "completed") {
    for (const key of refs.notifiedQuestionRequest) {
      if (key.startsWith(`${runtimeSessionId}:`)) {
        refs.notifiedQuestionRequest.delete(key);
      }
    }
  }
  refs.hiddenLongTaskEvents.delete(runtimeSessionId);
}

function isLongTaskRuntimeHiddenFromChat(session: Session | undefined, runtimeSessionId: string) {
  return Boolean(
    session?.longTask &&
    session.longTask.reviewerSessionId !== session.longTask.executorSessionId &&
    session.longTask.reviewerSessionId === runtimeSessionId
  );
}

function shouldMirrorHiddenLongTaskEvent(event: TimelineEvent) {
  return ["approval_request", "question_request", "error"].includes(event.type);
}

function attachLongTaskAgentRole(event: TimelineEvent, role: "executor" | "reviewer" | null): TimelineEvent {
  if (!role) return event;
  if (event.type === "assistant_message" || event.type === "status_update") {
    return { ...event, agentRole: role };
  }
  return event;
}

function toLongTaskMeta(summary: {
  id: string;
  title: string;
  stage: NonNullable<Session["longTask"]>["stage"];
  activeAgent: NonNullable<Session["longTask"]>["activeAgent"];
  executorSessionId: string;
  reviewerSessionId: string;
  bigPlanPath: string;
  reviewQueuePath: string;
  reviewedReviewItems?: string[];
  currentStep: number;
  targetStep: number | null;
}): NonNullable<Session["longTask"]> {
  return {
    taskId: summary.id,
    title: summary.title,
    stage: summary.stage,
    activeAgent: summary.activeAgent,
    executorSessionId: summary.executorSessionId,
    reviewerSessionId: summary.reviewerSessionId,
    bigPlanPath: summary.bigPlanPath,
    reviewQueuePath: summary.reviewQueuePath,
    reviewedReviewItems: summary.reviewedReviewItems ?? [],
    currentStep: summary.currentStep,
    targetStep: summary.targetStep,
  };
}

function extractLongTaskStepNumbers(content: string) {
  const numbers: number[] = [];
  const patterns = [
    /当前步骤[：:\s]*(\d+)/gi,
    /Step\s*(\d+)/gi,
    /step\s*(\d+)/gi,
    /rounds\/step(\d+)\.md/gi,
  ];
  patterns.forEach((pattern) => {
    for (const match of content.matchAll(pattern)) {
      const value = Number(match[1]);
      if (Number.isInteger(value) && value > 0) numbers.push(value);
    }
  });
  return numbers;
}

function extractLongTaskCurrentStep(content: string) {
  const patterns = [
    /当前步骤[：:\s]*(\d+)/gi,
    /Step\s*(\d+)\s*(?:执行完成|完成|已完成|已修复|修复完成|交给审查|交给审查\s*agent)/gi,
    /rounds\/step(\d+)\.md/gi,
  ];
  const numbers: number[] = [];
  patterns.forEach((pattern) => {
    for (const match of content.matchAll(pattern)) {
      const value = Number(match[1]);
      if (Number.isInteger(value) && value > 0) numbers.push(value);
    }
  });
  return numbers.length > 0 ? Math.max(...numbers) : null;
}

type LongTaskStatusBlock = {
  role?: "executor" | "reviewer";
  status?: string;
  conclusion?: string;
  step?: number;
  totalSteps?: number;
};

function normalizeLongTaskRole(value: unknown): LongTaskStatusBlock["role"] {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "executor" || normalized === "执行" || normalized === "执行 agent") return "executor";
  if (normalized === "reviewer" || normalized === "审查" || normalized === "审核" || normalized === "审查 agent") return "reviewer";
  return undefined;
}

function normalizeLongTaskPositiveInt(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function extractLongTaskStatusBlock(content: string): LongTaskStatusBlock | null {
  const blocks: string[] = [];
  const fenceRegex = /```(?:kimix-long-task-status|kimix_long_task_status)\s*([\s\S]*?)```/gi;
  for (const match of content.matchAll(fenceRegex)) {
    if (match[1]?.trim()) blocks.push(match[1].trim());
  }
  const inlineRegex = /KIMIX_LONG_TASK_STATUS\s*({[\s\S]*?})/gi;
  for (const match of content.matchAll(inlineRegex)) {
    if (match[1]?.trim()) blocks.push(match[1].trim());
  }
  for (const raw of blocks.reverse()) {
    try {
      const parsed = JSON.parse(raw.replace(/^json\s*/i, "").trim()) as Record<string, unknown>;
      return {
        role: normalizeLongTaskRole(parsed.role ?? parsed.agent),
        status: typeof parsed.status === "string" ? parsed.status.trim() : typeof parsed.state === "string" ? parsed.state.trim() : undefined,
        conclusion: typeof parsed.conclusion === "string" ? parsed.conclusion.trim() : undefined,
        step: normalizeLongTaskPositiveInt(parsed.step ?? parsed.currentStep),
        totalSteps: normalizeLongTaskPositiveInt(parsed.totalSteps ?? parsed.targetStep ?? parsed.steps),
      };
    } catch {
      // Ignore malformed machine blocks and fall back to human-readable parsing below.
    }
  }
  return null;
}

function normalizeLongTaskExecutorStatus(value: string | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  if (["planning", "clarifying", "needs_clarification", "drafting"].includes(normalized)) return "planning";
  if (["ready", "planning_ready", "waiting_user", "awaiting_confirmation", "ready_for_execution"].includes(normalized)) return "ready";
  if (["ready_for_review", "needs_review", "review", "handoff_to_reviewer", "awaiting_review"].includes(normalized)) return "ready_for_review";
  if (["blocked", "manual_review", "paused", "needs_user"].includes(normalized)) return "blocked";
  if (["running", "executing"].includes(normalized)) return "running";
  if (["completed", "complete", "done"].includes(normalized)) return "completed";
  return null;
}

function inferLongTaskProgressPatch(session: Session, runtimeSessionId: string) {
  const meta = session.longTask;
  if (!meta || meta.executorSessionId !== runtimeSessionId) return null;
  const content = latestAssistantContent(session.events);
  if (!content) return null;

  const machineStatus = extractLongTaskStatusBlock(content);
  const executorStatus = machineStatus?.role === "reviewer" ? null : normalizeLongTaskExecutorStatus(machineStatus?.status);
  if (executorStatus) {
    const patch: Partial<NonNullable<Session["longTask"]>> = {};
    if (executorStatus === "planning") patch.stage = "planning";
    if (executorStatus === "ready") patch.stage = "ready";
    if (executorStatus === "ready_for_review" || executorStatus === "running") patch.stage = "running";
    if (executorStatus === "blocked") patch.stage = "paused";
    if (machineStatus?.step && machineStatus.step > 0) patch.currentStep = machineStatus.step;
    if (machineStatus?.totalSteps && machineStatus.totalSteps > 0 && !meta.targetStep) patch.targetStep = machineStatus.totalSteps;
    if (Object.keys(patch).length > 0) return patch;
  }

  const stepNumbers = extractLongTaskStepNumbers(content);
  const maxStep = stepNumbers.length > 0 ? Math.max(...stepNumbers) : null;
  const currentStep = extractLongTaskCurrentStep(content);
  const asksForPlanConfirmation = /请确认|是否同意|确认后.*开始执行|进入执行阶段|开始执行\s*Step/i.test(content) &&
    /计划|BIGPLAN|Step\s*\d+/i.test(content);
  const executionProgress = /执行完成|已写入执行记录|rounds\/step\d+\.md|待审查|交给审查\s*agent|当前步骤[：:\s]*\d+/i.test(content);

  const patch: Partial<NonNullable<Session["longTask"]>> = {};
  if (asksForPlanConfirmation) {
    patch.stage = "ready";
    if (maxStep && !meta.targetStep) patch.targetStep = maxStep;
  }
  if (executionProgress) {
    patch.stage = "running";
    if (currentStep) patch.currentStep = currentStep;
    if (maxStep && !meta.targetStep) patch.targetStep = maxStep;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function applyLongTaskProgressFromLatestOutput(uiSessionId: string, runtimeSessionId: string) {
  const current = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
  if (!current?.longTask) return current;
  const patch = inferLongTaskProgressPatch(current, runtimeSessionId);
  if (!patch) return current;

  useSessionStore.getState().updateSession(uiSessionId, (session) => {
    if (!session.longTask) return session;
    return {
      ...session,
      longTask: {
        ...session.longTask,
        ...patch,
      },
      updatedAt: Date.now(),
    };
  });

  const latest = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
  if (latest?.longTask) {
    void window.api.updateLongTaskState({
      projectPath: latest.projectPath,
      taskId: latest.longTask.taskId,
      patch: {
        activeAgent: latest.longTask.activeAgent,
        stage: latest.longTask.stage,
        recovery: latest.longTask.recovery ?? null,
        currentStep: latest.longTask.currentStep,
        targetStep: latest.longTask.targetStep,
        reviewedReviewItems: latest.longTask.reviewedReviewItems ?? [],
      },
      }).catch(logError("persistLongTaskMeta"));
      const active = useAppStore.getState().currentSession;
    if (active?.id === uiSessionId) useAppStore.getState().setCurrentSession(latest);
  }
  return latest ?? current;
}

function isLongTaskExecutorTurnComplete(content: string) {
  const machineStatus = extractLongTaskStatusBlock(content);
  const executorStatus = machineStatus?.role === "reviewer" ? null : normalizeLongTaskExecutorStatus(machineStatus?.status);
  if (executorStatus === "ready_for_review") return true;
  return /执行完成|长程任务执行完成|已写入执行记录|rounds\/step\d+\.md|Step\s*\d+.*(?:完成|已完成|执行完成)|下一步状态[：:\s]*(?:继续下一步|全部完成)|交给.*审查/i.test(content);
}

function normalizeLongTaskPlanningSession<T extends Session>(session: T): T {
  if (!session.longTask || !["drafting", "planning", "ready"].includes(session.longTask.stage)) return session;
  if (session.longTask.activeAgent === "executor" && session.runtimeSessionId === session.longTask.executorSessionId) return session;
  return {
    ...session,
    runtimeSessionId: session.longTask.executorSessionId,
    longTask: {
      ...session.longTask,
      activeAgent: "executor",
    },
  };
}

function hydrateLongTaskProgressFromHistory<T extends Session>(session: T): T {
  const normalized = normalizeLongTaskPlanningSession(session);
  if (!normalized.longTask) return normalized;
  const patch = inferLongTaskProgressPatch(normalized, normalized.longTask.executorSessionId);
  if (!patch) return normalized;
  return {
    ...normalized,
    runtimeSessionId: normalized.longTask.executorSessionId,
    longTask: {
      ...normalized.longTask,
      ...patch,
      activeAgent: "executor",
    },
  };
}

function shouldContinueLongTaskExecution(session: Session, runtimeSessionId: string) {
  if (!session.longTask) return false;
  if (session.longTask.executorSessionId !== runtimeSessionId) return false;
  if (session.longTask.stage !== "running") return false;
  if (hasPendingQuestion(session.events)) return false;
  const content = latestAssistantContent(session.events);
  return isLongTaskExecutorTurnComplete(content);
}

function buildLongTaskExecutorNextPrompt(session: Session, nextStep: number) {
  const meta = session.longTask;
  if (!meta) return "";
  const targetStep = meta.targetStep ?? nextStep;
  const isFinalStep = nextStep >= targetStep;
  return `【Kimix 长程任务：继续执行 Step ${nextStep}】
本任务按 BIGPLAN 自动自推进。

请按以下规则执行：
1. 先阅读 ${meta.bigPlanPath}，确认当前进度和 Step ${nextStep} 的目标、范围、验收标准、验证方式。
2. 只执行 Step ${nextStep} 这一轮，不要合并后续多个 Step。
3. 完成后更新必要文件，并把本轮产出、验证证据、残余风险写入 rounds/ 对应记录。
4. 不要启动、模拟或等待额外审查流程；不要输出 \`kimix-long-task-status\` 或任何机器状态代码块。
${isFinalStep
  ? "5. 这是目标范围内最后一个 Step。完成后必须输出“最终结果”和“建议用户全盘审查的内容”，并明确写出“长程任务执行完成”。"
  : `5. 完成后必须明确写出“Step ${nextStep} 执行完成，继续下一步”，然后停止本轮输出，等待 Kimix 自动调度 Step ${nextStep + 1}。`}

如果发现必须由用户确认或外部环境处理的问题，请写入 ${meta.reviewQueuePath}，并明确说明阻塞原因。`;
}

async function createSessionAndSendPrompt(projectPath: string, content: string) {
  const appState = useAppStore.getState();
  const additionalWorkDirs = normalizeAdditionalWorkDirs(appState.additionalWorkDirs);
  const sessionStore = useSessionStore.getState();
  const sessionRes = await window.api.startKimiCodeRuntime({
    workDir: projectPath,
    additionalWorkDirs,
    yoloMode: appState.permissionMode === "yolo",
    autoMode: appState.permissionMode === "auto",
    planMode: appState.defaultPlanMode,
    thinking: appState.defaultThinking,
  });
  if (!sessionRes.success) throw new Error(sessionRes.error);

  const session = {
    id: sessionRes.data.sessionId,
    model: sessionRes.data.model ?? null,
    title: "交接新会话",
    projectPath,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    events: [] as TimelineEvent[],
    isLoading: false,
  };
  sessionStore.addSession(session);
  appState.setCurrentSession(session);

  const userEvent: TimelineEvent = {
    id: crypto.randomUUID(),
    type: "user_message",
    timestamp: Date.now(),
    content,
  };
  const responsePlaceholder: TimelineEvent = {
    id: crypto.randomUUID(),
    type: "assistant_message",
    timestamp: Date.now(),
    content: "",
    isThinking: appState.defaultThinking,
    isComplete: false,
  };
  useSessionStore.getState().updateSession(session.id, (current) => ({
    ...current,
    events: [userEvent, responsePlaceholder],
    updatedAt: Date.now(),
  }));
  useAppStore.getState().setRunningSessionId(session.id);
  await window.api.sendKimiCodePrompt({
    sessionId: session.id,
    content,
    model: session.model ?? undefined,
  });
}

function App() {
  const setTheme = useAppStore((s) => s.setTheme);
  const setThemePalette = useAppStore((s) => s.setThemePalette);
  const setCustomThemePalette = useAppStore((s) => s.setCustomThemePalette);
  const setKimiThemePalettes = useAppStore((s) => s.setKimiThemePalettes);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const setDefaultThinking = useAppStore((s) => s.setDefaultThinking);
  const setDefaultPlanMode = useAppStore((s) => s.setDefaultPlanMode);
  const setFontSize = useAppStore((s) => s.setFontSize);
  const setAdditionalWorkDirs = useAppStore((s) => s.setAdditionalWorkDirs);
  const setDetailedContext = useAppStore((s) => s.setDetailedContext);
  const setStatusUpdateDisplay = useAppStore((s) => s.setStatusUpdateDisplay);
  const setSessionRecommendationEnabled = useAppStore((s) => s.setSessionRecommendationEnabled);
  const setSessionRecommendationTurnLimit = useAppStore((s) => s.setSessionRecommendationTurnLimit);
  const setVoiceShortcut = useAppStore((s) => s.setVoiceShortcut);
  const setNotificationMode = useAppStore((s) => s.setNotificationMode);
  const setNotificationShowContent = useAppStore((s) => s.setNotificationShowContent);
  const setFilePreviewExtensions = useAppStore((s) => s.setFilePreviewExtensions);
  const setHandoffSessionId = useAppStore((s) => s.setHandoffSessionId);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const setRoomAgentActivity = useAppStore((s) => s.setRoomAgentActivity);
  const fontSize = useAppStore((s) => s.fontSize);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const roomAgentActivities = useAppStore((s) => s.roomAgentActivities);
  const activeRoomAgentActivitySignature = Object.values(roomAgentActivities)
    .filter((activity) => isRoomAgentReconciliationStatus(activity.status))
    .map((activity) => `${activity.roomId}:${activity.roomAgentId}:${activity.runtimeSessionId ?? ""}:${activity.status}`)
    .sort()
    .join("|");
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const updateSession = useSessionStore((s) => s.updateSession);
  const setRecentProjects = useSessionStore((s) => s.setRecentProjects);
  const activeRoomDeliverySignature = useSessionStore((s) => s.sessions.flatMap((session) => (
    getRoomAgentReconciliationTargets(session, []).map((target) => ({ ...target, roomId: session.id }))
  ))
    .map((target) => `${target.roomId}:${target.roomAgentId}:${target.runtimeSessionId ?? ""}:${target.status}`)
    .sort()
    .join("|"));
  const currentSession = useAppStore((s) => s.currentSession);
  const currentProject = useAppStore((s) => s.currentProject);
  const currentSessionRef = useRef(currentSession);
  currentSessionRef.current = currentSession;
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const bootstrapDoneRef = useRef(false);
  const [startupContextResolved, setStartupContextResolved] = useState(false);
  const handoffJobRef = useRef<HandoffJob | null>(null);
  const longTaskRoundAppendRef = useRef<Set<string>>(new Set());
  const hiddenLongTaskEventsRef = useRef<Map<string, TimelineEvent[]>>(new Map());
  const runtimeTurnStartRef = useRef<Map<string, { eventStartIndex: number; openAssistantIds: Set<string> }>>(new Map());
  const goalRefreshTimersRef = useRef<Map<string, number>>(new Map());
  const goalLastRefreshRef = useRef<Map<string, number>>(new Map());
  const pendingQueueDispatchRef = useRef<Set<string>>(new Set());
  const notifiedQuestionRequestRef = useRef<Set<string>>(new Set());
  const notifiedApprovalRequestRef = useRef<Set<string>>(new Set());
  const runtimeTerminalPollRef = useRef<Map<string, number>>(new Map());
  const runtimeLastStreamEventAtRef = useRef<Map<string, number>>(new Map());
  const runtimeHistoryRefreshAtRef = useRef<Map<string, number>>(new Map());

  useEffect(() => window.api.onNotificationClick((payload) => {
    const sessionState = useSessionStore.getState();
    const target = resolveNotificationClickTarget(sessionState.sessions, payload);
    if (!target) return;
    const focusedSession = focusNotificationRoomAgent(target.session, target.roomAgentId);
    if (focusedSession !== target.session) {
      sessionState.updateSession(target.session.id, () => focusedSession);
      void persistLocalConversationState();
    }
    const appState = useAppStore.getState();
    const project = sessionState.recentProjects.find((item) => isSamePath(item.path, focusedSession.projectPath));
    if (project) appState.setCurrentProject(project);
    appState.setWorkspaceView("chat");
    appState.setSettingsOpen(false);
    appState.setCurrentSession(focusedSession);
    if (target.eventId) {
      window.dispatchEvent(new CustomEvent("kimix:focus-timeline-event", {
        detail: { sessionId: focusedSession.id, eventId: target.eventId },
      }));
    }
  }), []);

  useRendererLagDetector();
  useSettingsSync();
  useStatePersistence(startupContextResolved);
  const { enqueueStreamEvent, flushStreamEvents } = useEventStream();

  const handleEscape = useCallback(() => {
    const state = useAppStore.getState();
    const currentSession = state.currentSession;
    const activeRunningSessionId = state.runningSessionId;
    // Escape 只应停止当前可见会话，不能静默停止后台运行的其他会话。
    if (!currentSession) return;
    if (!isSessionRuntimeRunning(currentSession, activeRunningSessionId)) return;
    setRunningSessionId(null);
    const runtimeSessionId = resolveRuntimeSessionId(currentSession.id);
    if (runtimeSessionId) {
      window.api.cancelKimiCodeTurn({ sessionId: runtimeSessionId }).catch(logError("cancelKimiCodeTurn"));
    }
  }, [setRunningSessionId]);

    useKeyboardShortcuts(toggleSidebar, () => setSearchOpen(true), handleEscape);
    const bootstrapSetters = useMemo(() => ({
      setTheme,
      setThemePalette,
      setCustomThemePalette,
      setKimiThemePalettes,
      setPermissionMode,
      setDefaultThinking,
      setDefaultPlanMode,
      setFontSize,
      setAdditionalWorkDirs,
      setDetailedContext,
      setStatusUpdateDisplay,
      setSessionRecommendationEnabled,
      setSessionRecommendationTurnLimit,
      setVoiceShortcut,
      setNotificationMode,
      setNotificationShowContent,
      setFilePreviewExtensions,
      setRecentProjects,
    }), [
      setTheme, setThemePalette, setCustomThemePalette, setKimiThemePalettes,
      setPermissionMode, setDefaultThinking, setDefaultPlanMode, setFontSize,
      setAdditionalWorkDirs, setDetailedContext, setStatusUpdateDisplay,
      setSessionRecommendationEnabled, setSessionRecommendationTurnLimit,
      setVoiceShortcut, setNotificationMode, setNotificationShowContent,
      setFilePreviewExtensions, setRecentProjects,
    ]);
    useBootstrap(bootstrapSetters);

  useEffect(() => {
    if (!window.api.onMainLog) return;
    return window.api.onMainLog((payload) => {
      const fn = (console[payload.level as keyof Console] as typeof console.log) ?? console.log;
      fn(`[MAIN] ${payload.message}`);
    });
  }, []);

  useEffect(() => {
    const projectPath = currentProject?.path;
    if (!projectPath) return;
    let cancelled = false;
    void window.api.listKimiCodeSessions({ workDir: projectPath }).then((res) => {
      if (cancelled || !res.success) return;
      const hiddenHandoffSessionIds = new Set(getHiddenHandoffSessionIds());
      const catalogSessions = res.data.filter((session) => (
        !hiddenHandoffSessionIds.has(session.id) &&
        !isHiddenInternalSession(session)
      ));
      const recovery = recoverOrphanRoomsFromOfficialCatalog(
        useSessionStore.getState().sessions,
        catalogSessions,
        projectPath,
      );
      useSessionStore.setState({
        sessions: reconcileOfficialSessionCatalog(recovery.sessions, catalogSessions, projectPath, { source: res.source }),
      });
      recovery.recoveredRoomIds.forEach((roomId) => void recoverCollaborationRoomAtStartup(roomId));
      }).catch(logError("listKimiCodeSessions"));
      return () => {
        cancelled = true;
      };
    }, [currentProject?.path]);

  const syncCurrentSessionFromStore = (uiSessionId: string) => {
    const latest = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    if (!latest) return;
    const active = useAppStore.getState().currentSession;
    if (active?.id === uiSessionId) {
      useAppStore.getState().setCurrentSession(latest);
    }
  };

  const syncSessionSwarmMode = useCallback((uiSessionId: string, source: unknown, roomAgentId?: string) => {
    const swarmMode = extractSwarmModeStatus(source);
    if (swarmMode === undefined) return;
    updateSession(uiSessionId, (session) => {
      if (session.collaboration && roomAgentId) {
        return updateRoomAgent(session, roomAgentId, (agent) => (
          agent.swarmMode === swarmMode ? agent : { ...agent, swarmMode }
        ));
      }
      return session.swarmMode === swarmMode ? session : { ...session, swarmMode };
    });
    syncCurrentSessionFromStore(uiSessionId);
  }, [updateSession]);

  const refreshOfficialGoalState = async (uiSessionId: string, runtimeSessionId: string, roomAgentId?: string) => {
    const target = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    if (!target) return;
    const ownerAgentId = roomAgentId ?? resolveRoomRuntimeOwner([target], runtimeSessionId)?.roomAgentId ?? getPrimaryRoomAgent(target).id;
    const targetView = getRoomAgentSessionView(target, ownerAgentId);
    if (!targetView.officialGoal) return;
    try {
      const res = await window.api.getKimiCodeGoal({ sessionId: runtimeSessionId });
      useSessionStore.getState().updateSession(uiSessionId, (session) => {
        const view = getRoomAgentSessionView(session, ownerAgentId);
        const officialGoal = {
          goal: res.success ? reconcileOfficialGoalSnapshot(res.data.goal, view.officialGoal?.goal) : view.officialGoal?.goal ?? null,
          error: res.success ? null : res.error,
          updatedAt: Date.now(),
        };
        if (session.collaboration) {
          return {
            ...updateRoomAgent(session, ownerAgentId, (agent) => ({ ...agent, officialGoal })),
            updatedAt: Date.now(),
          };
        }
        return { ...session, officialGoal, updatedAt: Date.now() };
      });
      syncCurrentSessionFromStore(uiSessionId);
    } catch (err) {
      useSessionStore.getState().updateSession(uiSessionId, (session) => {
        const view = getRoomAgentSessionView(session, ownerAgentId);
        const officialGoal = {
          goal: view.officialGoal?.goal ?? null,
          error: err instanceof Error ? err.message : String(err),
          updatedAt: Date.now(),
        };
        if (session.collaboration) {
          return {
            ...updateRoomAgent(session, ownerAgentId, (agent) => ({ ...agent, officialGoal })),
            updatedAt: Date.now(),
          };
        }
        return { ...session, officialGoal, updatedAt: Date.now() };
      });
      syncCurrentSessionFromStore(uiSessionId);
    }
  };

  const scheduleOfficialGoalRefresh = (uiSessionId: string, runtimeSessionId: string, roomAgentId?: string) => {
    const target = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    if (!target) return;
    const ownerAgentId = roomAgentId ?? resolveRoomRuntimeOwner([target], runtimeSessionId)?.roomAgentId ?? getPrimaryRoomAgent(target).id;
    if (!getRoomAgentSessionView(target, ownerAgentId).officialGoal?.goal) return;
    const key = `${uiSessionId}:${ownerAgentId}:${runtimeSessionId}`;
    if (goalRefreshTimersRef.current.has(key)) return;
    const elapsed = Date.now() - (goalLastRefreshRef.current.get(key) ?? 0);
    const delay = Math.max(0, 1200 - elapsed);
    const timer = window.setTimeout(() => {
      goalRefreshTimersRef.current.delete(key);
      goalLastRefreshRef.current.set(key, Date.now());
      void refreshOfficialGoalState(uiSessionId, runtimeSessionId, ownerAgentId);
    }, delay);
    goalRefreshTimersRef.current.set(key, timer);
  };

  const persistLongTaskMeta = (session: Session | undefined) => {
    if (!session?.longTask) return;
    void window.api.updateLongTaskState({
      projectPath: session.projectPath,
      taskId: session.longTask.taskId,
      patch: {
        activeAgent: session.longTask.activeAgent,
        stage: session.longTask.stage,
        recovery: session.longTask.recovery ?? null,
        currentStep: session.longTask.currentStep,
        targetStep: session.longTask.targetStep,
        reviewedReviewItems: session.longTask.reviewedReviewItems ?? [],
        executorSessionId: session.longTask.executorSessionId,
        reviewerSessionId: session.longTask.reviewerSessionId,
      },
    }).catch(logError("persistLongTaskMeta"));
  };

  const upsertLongTaskAgentProxyMessage = (
    uiSessionId: string,
    role: "executor" | "reviewer",
    status: "running" | "completed" | "error" | "interrupted",
    detailContent?: string,
  ) => {
    updateSession(uiSessionId, (session) => {
      const events = [...session.events];
      const detail = detailContent?.trim();
      const latestProxyIndex = events.findLastIndex((event) => {
        if (event.type !== "assistant_message" || event.agentRole !== role) return false;
        if (status === "running") return !event.isComplete;
        if (detail) return true;
        return !event.content.trim() && !event.thinking?.trim();
      });

      if (status === "running") {
        const existing = latestProxyIndex >= 0 ? events[latestProxyIndex] : null;
        if (existing?.type === "assistant_message" && !existing.isComplete) {
          return session;
        }
        return {
          ...session,
          events: [
            ...events,
            {
              id: crypto.randomUUID(),
              type: "assistant_message" as const,
              timestamp: Date.now(),
              agentRole: role,
              content: "",
              isThinking: true,
              isComplete: false,
            },
          ],
          updatedAt: Date.now(),
        };
      }

      if (latestProxyIndex === -1) {
        if (!detail) return session;
        return {
          ...session,
          events: [
            ...events,
            {
              id: crypto.randomUUID(),
              type: "assistant_message" as const,
              timestamp: Date.now(),
              agentRole: role,
              content: detail,
              thinkingParts: [
                {
                  id: crypto.randomUUID(),
                  timestamp: Date.now(),
                  text: detail,
                },
              ],
              isThinking: false,
              isComplete: true,
            },
          ],
          updatedAt: Date.now(),
        };
      }
      const latestProxy = events[latestProxyIndex];
      if (latestProxy.type !== "assistant_message") return session;
      if (latestProxy.isComplete && !detailContent?.trim()) return session;
      const detailPart = detail
        ? {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            text: detail,
          }
        : null;
      events[latestProxyIndex] = {
        ...latestProxy,
        content: detail || latestProxy.content,
        thinkingParts: detailPart ? [detailPart] : latestProxy.thinkingParts,
        isThinking: false,
        isComplete: true,
        durationMs: latestProxy.durationMs ?? Math.max(0, Date.now() - latestProxy.timestamp),
      };
      return {
        ...session,
        events,
        updatedAt: Date.now(),
      };
    });
    syncCurrentSessionFromStore(uiSessionId);
  };

  const pauseLongTaskReviewerWithError = (uiSessionId: string, message: string) => {
    updateSession(uiSessionId, (session) => {
      if (!session.longTask) return session;
      const latestError = [...session.events].reverse().find((event): event is Extract<TimelineEvent, { type: "error" }> => event.type === "error");
      const nextEvents = session.events.filter((event) => !(event.type === "assistant_message" && !event.isComplete && !event.content.trim()));
      return {
        ...session,
        longTask: {
          ...session.longTask,
          activeAgent: "reviewer",
          stage: "paused",
        },
        events: latestError?.message === message
          ? nextEvents
          : [
            ...nextEvents,
            {
              id: crypto.randomUUID(),
              type: "error" as const,
              timestamp: Date.now(),
              message,
              canDismiss: false,
            },
          ],
        updatedAt: Date.now(),
      };
    });
    const latest = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    syncCurrentSessionFromStore(uiSessionId);
    persistLongTaskMeta(latest);
    setRunningSessionId(null);
  };

  const appendLongTaskRoundOnce = (
    session: Session,
    payload: {
      step: number;
      role: "executor" | "reviewer";
      phase: "execution" | "review" | "fix" | "handoff" | "complete";
      conclusion?: string;
      content: string;
    },
  ) => {
    if (!session.longTask) return;
    const key = [
      session.longTask.taskId,
      payload.step,
      payload.role,
      payload.phase,
      session.events.length,
      payload.conclusion ?? "",
    ].join(":");
    if (longTaskRoundAppendRef.current.has(key)) return;
    longTaskRoundAppendRef.current.add(key);
    void window.api.appendLongTaskRound({
      projectPath: session.projectPath,
      taskId: session.longTask.taskId,
      ...payload,
    }).catch(logError("appendLongTaskRound"));
  };

  const mergeHiddenLongTaskEvent = (runtimeSessionId: string, event: TimelineEvent) => {
    const current = hiddenLongTaskEventsRef.current.get(runtimeSessionId) ?? [];
    hiddenLongTaskEventsRef.current.set(runtimeSessionId, mergeEvents(current, event));
  };

  const getHiddenLongTaskAssistantContent = (runtimeSessionId: string) => {
    return latestAssistantVisibleOrThinkingContent(hiddenLongTaskEventsRef.current.get(runtimeSessionId) ?? []);
  };

  const dispatchLongTaskExecutorNext = (uiSessionId: string, runtimeSessionId: string) => {
    const latestSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
    if (!latestSession?.longTask || !shouldContinueLongTaskExecution(latestSession, runtimeSessionId)) {
      return false;
    }

    const currentStep = Math.max(latestSession.longTask.currentStep || 1, 1);
    const targetStep = latestSession.longTask.targetStep;
    if (!targetStep) return false;
    const executorOutput = latestAssistantContent(latestSession.events);
    appendLongTaskRoundOnce(latestSession, {
      step: currentStep,
      role: "executor",
      phase: "execution",
      content: executorOutput,
    });

    if (targetStep && currentStep >= targetStep) {
      updateSession(uiSessionId, (session) => session.longTask ? {
        ...session,
        runtimeSessionId: session.longTask.executorSessionId,
        longTask: {
          ...session.longTask,
          activeAgent: "executor",
          stage: "completed",
          recovery: null,
        },
        updatedAt: Date.now(),
      } : session);
      syncCurrentSessionFromStore(uiSessionId);
      persistLongTaskMeta(useSessionStore.getState().sessions.find((session) => session.id === uiSessionId));
      appendLongTaskRoundOnce(latestSession, {
        step: currentStep,
        role: "executor",
        phase: "complete",
        conclusion: "完成",
        content: `目标 Step ${targetStep} 已达到。请用户根据最终输出和 ${latestSession.longTask.reviewQueuePath} 做全盘审查。`,
      });
      return true;
    }

    const nextStep = currentStep + 1;
    const prompt = buildLongTaskExecutorNextPrompt(latestSession, nextStep);
    appendLongTaskRoundOnce(latestSession, {
      step: nextStep,
      role: "executor",
      phase: "handoff",
      content: prompt,
    });
    updateSession(uiSessionId, (session) => session.longTask ? {
      ...session,
      runtimeSessionId: session.longTask.executorSessionId,
      longTask: {
        ...session.longTask,
        activeAgent: "executor",
        stage: "running",
        currentStep: nextStep,
        recovery: null,
      },
      events: [
        ...session.events,
        {
          id: crypto.randomUUID(),
          type: "assistant_message" as const,
          timestamp: Date.now(),
          content: "",
          isThinking: true,
          isComplete: false,
        },
      ],
      updatedAt: Date.now(),
    } : session);
    syncCurrentSessionFromStore(uiSessionId);
    persistLongTaskMeta(useSessionStore.getState().sessions.find((session) => session.id === uiSessionId));
    setRunningSessionId(uiSessionId);
    void window.api.sendKimiCodePrompt({
      sessionId: latestSession.longTask.executorSessionId,
      content: prompt,
      model: latestSession.switchedToModel ?? latestSession.model ?? undefined,
    }).then((res) => {
      if (res.success) return;
      throw new Error(res.error);
    }).catch((err: unknown) => {
      updateSession(uiSessionId, (session) => ({
        ...session,
        longTask: session.longTask ? {
          ...session.longTask,
          activeAgent: "executor",
          stage: "paused",
          recovery: buildLongTaskRecovery("executor", "error", `启动下一步执行失败：${err instanceof Error ? err.message : String(err)}`),
        } : session.longTask,
        events: [
          ...session.events.filter((event) => !(event.type === "assistant_message" && !event.isComplete && !event.content.trim())),
          {
            id: crypto.randomUUID(),
            type: "error" as const,
            timestamp: Date.now(),
            message: `启动下一步执行失败：${err instanceof Error ? err.message : String(err)}`,
            canDismiss: false,
          },
        ],
        updatedAt: Date.now(),
      }));
      syncCurrentSessionFromStore(uiSessionId);
      persistLongTaskMeta(useSessionStore.getState().sessions.find((session) => session.id === uiSessionId));
      setRunningSessionId(null);
    });
    return true;
  };

  const dispatchNextPendingKimiMessage = async (uiSessionId: string, runtimeSessionId: string) => {
    if (pendingQueueDispatchRef.current.has(uiSessionId)) return false;
    pendingQueueDispatchRef.current.add(uiSessionId);
    let dispatched = false;
    try {
      const latestSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
      if (latestSession && hasPendingQuestion(latestSession.events)) {
        void persistLocalConversationState();
        return false;
      }
      if (await shouldWaitForOfficialPromptQueue(runtimeSessionId)) {
        setRunningSessionId(uiSessionId);
        void persistLocalConversationState();
        return false;
      }
      const next = useSessionStore.getState().shiftPendingMessage(uiSessionId);
      if (!next) return false;
      dispatched = true;

    const userEventId = Math.random().toString(36).substring(2, 11);
    const placeholderId = Math.random().toString(36).substring(2, 11);
    updateSession(uiSessionId, (session) => ({
      ...session,
      events: [
        ...session.events,
        {
          id: userEventId,
          type: "user_message" as const,
          timestamp: Date.now(),
          content: next.content,
          images: next.images,
        },
        {
          id: placeholderId,
          type: "assistant_message" as const,
          timestamp: Date.now(),
          content: "",
          isThinking: useAppStore.getState().defaultThinking,
          isComplete: false,
        },
      ],
      updatedAt: Date.now(),
    }));
    setRunningSessionId(uiSessionId);
    const timer = setTimeout(() => {
      sendKimiCodePromptWithRetry({
        sessionId: runtimeSessionId,
        content: contentWithFileAttachments(next.content, next.images),
        images: promptImages(next.images),
        model: currentSessionPromptModel(uiSessionId),
      }).then((res) => {
        if (res.success) return;
        throw new Error(res.error);
      }).catch(async (err) => {
        let message = err instanceof Error ? err.message : String(err);
        const alreadyExistingRuntimeId = getKimiAlreadyExistsSessionId(message);
        const shouldRecoverRuntime = Boolean(alreadyExistingRuntimeId) ||
          isKimiCodeSessionInactiveError(message) ||
          isKimiCodeSessionMissingError(message);
        if (shouldRecoverRuntime) {
          const latestSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
          const primaryAgentId = latestSession ? getPrimaryRoomAgent(latestSession).id : undefined;
          let recoveryRes = latestSession && primaryAgentId && roomAgentCanResume(latestSession, primaryAgentId)
            ? await resumeRoomAgentRuntime({
              session: latestSession,
              roomAgentId: primaryAgentId,
              preferredSessionIds: [alreadyExistingRuntimeId ?? runtimeSessionId],
              additionalWorkDirs: normalizeAdditionalWorkDirs(useAppStore.getState().additionalWorkDirs),
              resume: (request) => window.api.resumeKimiCodeSession(request),
            })
            : {
              success: false as const,
              error: latestSession && primaryAgentId
                ? getRoomAgent(latestSession, primaryAgentId)?.recoveryIssue?.message ?? "当前 Agent 暂时不可恢复"
                : "当前会话不存在",
            };
          if (!recoveryRes.success && latestSession?.projectPath && (!latestSession.collaboration || roomAgentCanResume(latestSession, primaryAgentId!))) {
            recoveryRes = await window.api.createKimiCodeSession({
              workDir: latestSession.projectPath,
              model: getPrimaryRoomAgent(latestSession).modelAlias ?? undefined,
              permission: useAppStore.getState().permissionMode,
              planMode: useAppStore.getState().defaultPlanMode,
              additionalWorkDirs: normalizeAdditionalWorkDirs(useAppStore.getState().additionalWorkDirs),
            });
          }
          if (recoveryRes.success && primaryAgentId) {
            updateSession(uiSessionId, (session) => ({
              ...bindRecoveredRoomAgentRuntime(session, primaryAgentId, {
                sessionId: recoveryRes.data.sessionId,
                model: recoveryRes.data.model,
              }),
              engine: "kimi-code" as const,
            }));
            syncCurrentSessionFromStore(uiSessionId);
            const retryRes = await sendKimiCodePromptWithRetry({
              sessionId: recoveryRes.data.sessionId,
              content: contentWithFileAttachments(next.content, next.images),
              images: promptImages(next.images),
              model: currentSessionPromptModel(uiSessionId),
            });
            if (retryRes.success) return;
            message = retryRes.error;
          } else {
            message = "error" in recoveryRes ? recoveryRes.error : "恢复 Agent 会话失败";
          }
        }
        if (isKimiAbortError(message)) {
          updateSession(uiSessionId, (session) => ({
            ...session,
            events: settleInactiveEvents(session.events.filter((event) => event.id !== placeholderId)),
            updatedAt: Date.now(),
          }));
          syncCurrentSessionFromStore(uiSessionId);
          setRunningSessionId(null);
          return;
        }
        useSessionStore.getState().addPendingMessage(uiSessionId, next.content, next.images);
        if (isKimiActiveTurnError(message)) {
          updateSession(uiSessionId, (session) => {
            const filteredEvents = session.events.filter((event) => event.id !== placeholderId && event.id !== userEventId);
            console.log("[App pending dispatch active-turn]", {
              uiSessionId,
              placeholderId,
              userEventId,
              beforeCount: session.events.length,
              afterCount: filteredEvents.length,
            });
            return {
              ...session,
              events: filteredEvents,
              updatedAt: Date.now(),
            };
          });
          setRunningSessionId(uiSessionId);
          return;
        }
        if (
          isKimiCodeSessionInactiveError(message) ||
          isKimiCodeSessionMissingError(message) ||
          Boolean(getKimiAlreadyExistsSessionId(message))
        ) {
          updateSession(uiSessionId, (session) => ({
            ...session,
            events: session.events.filter((event) => event.id !== placeholderId && event.id !== userEventId),
            updatedAt: Date.now(),
          }));
          setRunningSessionId(null);
          return;
        }
        updateSession(uiSessionId, (session) => ({
          ...session,
          events: [
            ...session.events.filter((event) => event.id !== placeholderId && event.id !== userEventId),
            {
              id: crypto.randomUUID(),
              type: "error" as const,
              timestamp: Date.now(),
              message,
              source: "ipc" as const,
            },
          ],
          updatedAt: Date.now(),
        }));
        setRunningSessionId(null);
      }).finally(() => {
        pendingQueueDispatchRef.current.delete(uiSessionId);
      });
    }, 300);
    timersRef.current.push(timer);
    return true;
    } finally {
      if (!dispatched) pendingQueueDispatchRef.current.delete(uiSessionId);
    }
  };

  useEffect(() => {
    const localSessionsHydration = createStartupHydrationGate();
    const unsubscribeBootstrap = window.api.onBootstrap(async (payload) => {
      if (bootstrapDoneRef.current) return;
      bootstrapDoneRef.current = true;
      // The main-process bootstrap event can arrive before IndexedDB finishes
      // hydrating local sessions. Room identity only exists in that local state,
      // so selecting the startup session before hydration silently falls back to
      // a recent project/new conversation and never revisits the saved room.
      await localSessionsHydration.wait();
      const activeContext = STARTUP_ACTIVE_CONTEXT;
      const localSessions = useSessionStore.getState().sessions;
      const latestLocalSession = [...localSessions]
        .filter((session) => !session.archivedAt && !isHiddenInternalSession(session))
        .sort(compareSessionsByRecentConversation)[0];
      const activeContextSession = activeContext?.sessionId
        ? findSessionByRuntimeIdentity(localSessions, activeContext.sessionId)
        : undefined;
      const activeLocalSession = selectStartupLocalSession({
        activeContext,
        activeContextSession,
        latestLocalSession,
      });

      window.api.listRecentProjects().then(async (projectsRes) => {
        const recentProjects = projectsRes.success ? projectsRes.data : [payload.project];
        if (projectsRes.success) setRecentProjects(projectsRes.data);
        const activeProject = selectStartupProject({
          activeContext,
          activeLocalSession,
          recentProjects,
          fallbackProject: payload.project,
        });
        const startupActiveSession = activeLocalSession
          ? { ...activeLocalSession, isLoading: true }
          : null;
        if (startupActiveSession) {
          useSessionStore.setState((state) => {
            const exists = state.sessions.some((session) => session.id === startupActiveSession.id);
            return {
              sessions: exists
                ? state.sessions.map((session) => (
                    session.id === startupActiveSession.id ? startupActiveSession : session
                  ))
                : [startupActiveSession, ...state.sessions],
            };
          });
        }
        useAppStore.setState({
          currentProject: activeProject,
          currentSession: startupActiveSession,
        });
        setStartupContextResolved(true);

        window.setTimeout(() => {
          void (async () => {
            try {
              const hiddenHandoffSessionIds = new Set(getHiddenHandoffSessionIds());
              const activeRuntimeIds = new Set([
                activeContext?.sessionId,
                activeLocalSession?.id,
                activeLocalSession?.officialSessionId,
                activeLocalSession?.runtimeSessionId,
                activeLocalSession?.longTask?.executorSessionId,
                activeLocalSession?.longTask?.reviewerSessionId,
              ].filter((id): id is string => Boolean(id)));
              const isUsableHistorySession = (session: { id: string; title?: string; lastPrompt?: string }) => (
                !hiddenHandoffSessionIds.has(session.id) &&
                !isHiddenInternalSession(session)
              );

              const res = await window.api.listKimiCodeSessions({ workDir: activeProject.path });
              if (!res.success) return;
              const catalogSummaries = res.data.filter((session) => (
                !hiddenHandoffSessionIds.has(session.id) && !isHiddenInternalSession(session)
              ));
              const activeSummaries = catalogSummaries.filter((session) => session.archived !== true && isUsableHistorySession(session));
              const orphanRecovery = recoverOrphanRoomsFromOfficialCatalog(
                useSessionStore.getState().sessions,
                catalogSummaries,
                activeProject.path,
              );
              useSessionStore.setState({
                sessions: reconcileOfficialSessionCatalog(orphanRecovery.sessions, catalogSummaries, activeProject.path, { source: res.source }),
              });
              const startupRoom = activeLocalSession
                ? useSessionStore.getState().sessions.find((session) => session.id === activeLocalSession.id)
                : undefined;
              if (startupRoom?.collaboration) {
                await recoverCollaborationRoomAtStartup(startupRoom.id);
                orphanRecovery.recoveredRoomIds
                  .filter((roomId) => roomId !== startupRoom.id)
                  .forEach((roomId) => void recoverCollaborationRoomAtStartup(roomId));
                return;
              }
              orphanRecovery.recoveredRoomIds.forEach((roomId) => void recoverCollaborationRoomAtStartup(roomId));
              if (useSessionStore.getState().sessions.some((session) => Boolean(session.collaboration))) {
                void readAvailableRoomModelAliases().then((availableModelAliases) => {
                  useSessionStore.setState((state) => ({
                    sessions: state.sessions.map((session) => (
                      reconcileRoomAgentModelAvailability(session, availableModelAliases)
                    )),
                  }));
                  void persistLocalConversationState();
                });
              }
              const latest = selectStartupOfficialSession(activeSummaries, activeRuntimeIds);
              const historySessionId = latest?.id ?? activeLocalSession?.officialSessionId ?? activeLocalSession?.runtimeSessionId;
              if (!historySessionId) return;
              if (res.source !== "server" && hasArchivedLocalSessionForRuntime(historySessionId, undefined, latest?.id, activeProject.path)) {
                setRunningSessionId(null);
                return;
              }
              const roomRuntimeOwner = resolveRoomRuntimeOwner(
                useSessionStore.getState().sessions,
                historySessionId,
                latest?.id,
              );
              const runtimeOwner = roomRuntimeOwner?.session
                ?? findLocalSessionForRuntime(historySessionId, undefined, latest?.id);
              let loaded = await window.api.loadKimiCodeSession({
                workDir: activeProject.path,
                sessionId: historySessionId,
              });
              const skillForkParentSessionId = roomRuntimeOwner?.agent.skillForkParentSessionId
                ?? runtimeOwner?.skillForkParentSessionId
                ?? activeLocalSession?.skillForkParentSessionId;
              if (
                loaded.success &&
                Array.isArray(loaded.data.events) &&
                loaded.data.events.length === 0 &&
                skillForkParentSessionId &&
                historySessionId.startsWith("skill-")
              ) {
                const fallbackLoaded = await window.api.loadKimiCodeSession({
                  workDir: activeProject.path,
                  sessionId: skillForkParentSessionId,
                });
                if (fallbackLoaded.success && Array.isArray(fallbackLoaded.data.events) && fallbackLoaded.data.events.length > 0) {
                  loaded = fallbackLoaded;
                }
              }
              if (!loaded.success) {
                const errorOwner = runtimeOwner ?? activeLocalSession;
                if (errorOwner) {
                  const ownerAgentId = roomRuntimeOwner?.roomAgentId ?? getPrimaryRoomAgent(errorOwner).id;
                  const failedAt = Date.now();
                  const errorSession = {
                    ...updateRoomAgentEvents(errorOwner, ownerAgentId, (events) => [
                      ...events,
                      scopeEventToRoomAgent({
                        id: crypto.randomUUID(),
                        type: "error" as const,
                        timestamp: failedAt,
                        message: `读取上次 Kimi Code 历史失败：${loaded.error}`,
                        canDismiss: false,
                      }, ownerAgentId),
                    ]),
                    isLoading: false,
                    updatedAt: failedAt,
                  };
                  useSessionStore.setState((state) => ({
                    sessions: state.sessions.map((item) => (item.id === errorSession.id ? errorSession : item)),
                  }));
                  useAppStore.setState({ currentProject: activeProject, currentSession: errorSession });
                  setRunningSessionId(null);
                }
                return;
              }
              const runtimeStatus = await window.api.getKimiCodeStatus({ sessionId: historySessionId }).catch(() => null);
              const runtimeIsActive = Boolean(
                runtimeStatus?.success && isActiveKimiCodeEngineStatus(runtimeStatus.data.engineStatus)
              );
              const runtimeModel = runtimeStatus?.success ? runtimeStatus.data.model : undefined;
              const runtimeSwarmMode = runtimeStatus?.success ? extractSwarmModeStatus(runtimeStatus.data) : undefined;
              const mappedEvents = mapHistoryEvents(Array.isArray(loaded.data.events) ? loaded.data.events : []);
              const canonicalEvents = runtimeIsActive ? mappedEvents : settleInactiveEvents(mappedEvents);

              if (runtimeOwner) {
                const latestOwner = useSessionStore.getState().sessions.find((item) => item.id === runtimeOwner.id) ?? runtimeOwner;
                const ownerAgentId = roomRuntimeOwner?.roomAgentId ?? getPrimaryRoomAgent(latestOwner).id;
                const localAgentEvents = getRoomAgentEvents(latestOwner, ownerAgentId);
                const reconciliation = reconcileAgentCanonicalHistory({
                  session: latestOwner,
                  roomAgentId: ownerAgentId,
                  expectedRuntimeSessionId: historySessionId,
                  canonicalEvents,
                  reason: "startup",
                });
                const shouldUseCanonicalHistory = reconciliation.applied &&
                  shouldReplaceWithCanonicalKimiHistory(localAgentEvents, reconciliation.events, { sessionId: latestOwner.id, roomAgentId: ownerAgentId, reason: "startup" });
                const canonicalAdopted = reconciliation.applied && (localAgentEvents.length === 0 || shouldUseCanonicalHistory);
                const rejectedPatchedEvents = !reconciliation.applied || canonicalAdopted
                  ? localAgentEvents
                  : mergeMissingLatestCanonicalAssistant(
                    localAgentEvents,
                    reconciliation.events,
                    { sessionId: latestOwner.id, roomAgentId: ownerAgentId, reason: "startup" },
                  );
                const hydratedEvents = !canonicalAdopted
                  ? (runtimeIsActive ? rejectedPatchedEvents : settleInactiveEvents(rejectedPatchedEvents))
                  : reconciliation.events;
                let hydrated = reconciliation.applied ? reconciliation.session : latestOwner;
                hydrated = updateRoomAgentEvents(hydrated, ownerAgentId, () => hydratedEvents);
                if (hydrated.collaboration) {
                  hydrated = updateRoomAgent(hydrated, ownerAgentId, (agent) => ({
                    ...agent,
                    runtimeSessionId: agent.runtimeSessionId ?? historySessionId,
                    officialSessionId: agent.officialSessionId ?? historySessionId,
                    modelAlias: resolveAuthoritativeSessionModel({
                      runtimeModel,
                      sessionModel: agent.switchedToModel ?? agent.modelAlias,
                      historyModel: getLastUsedModelFromEvents(hydratedEvents),
                    }),
                    switchedToModel: runtimeModel ? undefined : agent.switchedToModel,
                    swarmMode: runtimeSwarmMode ?? agent.swarmMode,
                  }));
                } else {
                  hydrated = {
                    ...hydrated,
                    runtimeSessionId: hydrated.runtimeSessionId ?? historySessionId,
                    officialSessionId: hydrated.officialSessionId ?? historySessionId,
                    model: resolveAuthoritativeSessionModel({
                      runtimeModel,
                      sessionModel: hydrated.switchedToModel ?? hydrated.model,
                      historyModel: getLastUsedModelFromEvents(hydratedEvents),
                    }),
                    switchedToModel: runtimeModel ? undefined : hydrated.switchedToModel,
                    swarmMode: runtimeSwarmMode ?? hydrated.swarmMode,
                  };
                }
                if (canonicalAdopted || (
                  reconciliation.applied &&
                  hasEquivalentKimiHistoryTurnBodies(localAgentEvents, reconciliation.events)
                )) {
                  hydrated = markAgentKimiHistoryCacheCurrent(hydrated, ownerAgentId);
                }
                const session = hydrateLongTaskProgressFromHistory({
                  ...hydrated,
                  isLoading: false,
                });
                useSessionStore.setState((state) => ({
                  sessions: state.sessions.map((item) => (item.id === session.id ? session : item)),
                }));
                useAppStore.setState({ currentSession: session });
                if (runtimeIsActive) {
                  setRoomAgentActivity({
                    roomId: session.id,
                    roomAgentId: ownerAgentId,
                    runtimeSessionId: historySessionId,
                    status: runtimeStatus?.success && isActiveKimiCodeEngineStatus(runtimeStatus.data.engineStatus)
                      ? runtimeStatus.data.engineStatus
                      : "running",
                    updatedAt: Date.now(),
                  });
                }
                setRunningSessionId(runtimeIsActive && isPrimaryRoomAgent(session, ownerAgentId) ? session.id : null);
                return;
              }

              const longTasksRes = await window.api.listLongTasks({ projectPath: activeProject.path });
              const matchedLongTask = longTasksRes.success
                ? longTasksRes.data.find((task) => (
                  task.executorSessionId === historySessionId ||
                  task.reviewerSessionId === historySessionId
                ))
                : undefined;

              const events = preserveLocalUserMediaInCanonicalHistory(activeLocalSession?.events ?? [], canonicalEvents);
              const session = hydrateLongTaskProgressFromHistory({
                id: historySessionId,
                model: resolveAuthoritativeSessionModel({
                  runtimeModel,
                  sessionModel: activeLocalSession?.switchedToModel ?? activeLocalSession?.model,
                  historyModel: getLastUsedModelFromEvents(events),
                }),
                swarmMode: runtimeSwarmMode ?? activeLocalSession?.swarmMode,
                title: deriveSessionTitle(events, latest?.brief || activeLocalSession?.title || "新会话"),
                projectPath: activeProject.path,
                createdAt: latest?.updatedAt ?? activeLocalSession?.createdAt ?? Date.now(),
                updatedAt: latest?.updatedAt ?? activeLocalSession?.updatedAt ?? Date.now(),
                officialSessionId: historySessionId,
                longTask: matchedLongTask ? toLongTaskMeta(matchedLongTask) : undefined,
                events,
              isLoading: false,
            });

            useSessionStore.setState((state) => {
                const existing = state.sessions.find((item) => item.id === session.id);
                if (existing?.archivedAt) {
                  // Preserve local archive state; do not resurrect an archived session just because
                  // its history was rediscovered from the SDK store.
                  return state;
                }
                return {
                  sessions: existing
                    ? state.sessions.map((item) => (item.id === session.id ? session : item))
                    : [session, ...state.sessions],
                };
              });
              useAppStore.setState({ currentSession: session });
              setRunningSessionId(runtimeIsActive ? session.id : null);
            } catch {
              setRunningSessionId(null);
            } finally {
              if (activeLocalSession) {
                useSessionStore.setState((state) => ({
                  sessions: state.sessions.map((session) => (
                    session.id === activeLocalSession.id && session.isLoading
                      ? { ...session, isLoading: false }
                      : session
                  )),
                }));
                const current = useAppStore.getState().currentSession;
                if (current?.id === activeLocalSession.id && current.isLoading) {
                  const settled = useSessionStore.getState().sessions.find((session) => session.id === activeLocalSession.id);
                  if (settled) useAppStore.setState({ currentSession: settled });
                }
              }
            }
          })();
        }, 0);
      }).catch((error) => {
        useAppStore.setState({
          currentProject: activeContext?.project ?? payload.project,
          currentSession: activeLocalSession ?? null,
        });
        setStartupContextResolved(true);
        logError("loadKimiCodeSession")(error);
      });
    });

    void (async () => {
      try {
        const parsed = await loadLocalSessions();
        if (parsed.length > 0) {
          const restoringActiveSessionId = STARTUP_ACTIVE_CONTEXT?.sessionId;
          const visibleSessions = parsed
            .filter((session) => !isHiddenInternalSession(session))
            .map((session) => ({
              ...session,
              title: typeof session.title === "string" ? sanitizeKimiSkillActivationTitle(session.title) : "新会话",
              events: removeStaleKimiCodeStartupErrors(resetStaleSessionRecommendationEvents(sanitizePersistedEvents(Array.isArray(session.events) ? session.events : []))),
            }));
          const restoredSessions = visibleSessions.map((session) => {
            const rawEngine = (session as { engine?: unknown }).engine;
            const knownEngine = rawEngine === "prompt" || rawEngine === "kimi-code";
            return hydrateLongTaskProgressFromHistory({
              ...session,
              engine: knownEngine ? rawEngine : "kimi-code",
              runtimeSessionId: knownEngine ? session.runtimeSessionId : undefined,
              events: removeStaleKimiCodeStartupErrors(resetStaleSessionRecommendationEvents(sanitizePersistedEvents(Array.isArray(session.events) ? settleInactiveEvents(session.events) : []))),
              isLoading: session.id === restoringActiveSessionId,
            });
          });
          useSessionStore.setState({ sessions: restoredSessions });
          restoredSessions.filter((session) => session.archivedAt).forEach(rememberArchivedSessionTombstone);
          void repairKimiCodeHistoryBodies(restoredSessions);
        }
      } catch {
        // ignore load error
      } finally {
        localSessionsHydration.markReady();
      }

      try {
        const pendingMessages = await loadLocalPendingMessages();
        useSessionStore.setState({ pendingMessages });
      } catch {
        // ignore
      }
    })();

    const markRendererWindowFocused = () => {
      rendererWindowFocusedHint = true;
    };
    const markRendererWindowBlurred = () => {
      rendererWindowFocusedHint = false;
    };
    window.addEventListener("focus", markRendererWindowFocused);
    window.addEventListener("blur", markRendererWindowBlurred);
    document.addEventListener("pointerdown", markRendererWindowFocused, true);
    document.addEventListener("keydown", markRendererWindowFocused, true);

    const finishHandoffJob = async (job: HandoffJob, status: "completed" | "error" | "interrupted") => {
      handoffJobRef.current = null;
      window.clearTimeout(job.timeoutId);
      void window.api.closeKimiCodeSession({ sessionId: job.runtimeSessionId }).catch(logError("closeKimiCodeSession"));
      if (status !== "completed") {
        setHandoffSessionId(null);
        setRunningSessionId(null);
        updateRecommendationEvent(job.sourceSessionId, job.recommendationEventId, {
          handoffStatus: "error",
          handoffError: status === "interrupted" ? "交接生成被中断" : "交接生成失败",
        });
        return;
      }
      const content = extractAssistantContent(job.events);
      if (!content) {
        setHandoffSessionId(null);
        setRunningSessionId(null);
        updateRecommendationEvent(job.sourceSessionId, job.recommendationEventId, {
          handoffStatus: "error",
          handoffError: "未生成可用交接内容",
        });
        return;
      }
      try {
        await createSessionAndSendPrompt(job.projectPath, content);
        setHandoffSessionId(null);
        updateRecommendationEvent(job.sourceSessionId, job.recommendationEventId, { handoffStatus: "completed" });
        notifyTurnComplete(job.sourceSessionId, job.runtimeSessionId, "交接");
      } catch (err) {
        setHandoffSessionId(null);
        setRunningSessionId(null);
        updateRecommendationEvent(job.sourceSessionId, job.recommendationEventId, {
          handoffStatus: "error",
          handoffError: err instanceof Error ? err.message : String(err),
        });
      }
    };

    const handleStartHandoff = (event: Event) => {
      const detail = (event as CustomEvent<StartHandoffDetail>).detail;
      if (!detail?.sourceSessionId || !detail.projectPath || !detail.recommendationEventId) return;
      if (handoffJobRef.current) return;
      setHandoffSessionId(detail.sourceSessionId);
      setRunningSessionId(detail.sourceSessionId);
      updateRecommendationEvent(detail.sourceSessionId, detail.recommendationEventId, {
        handoffStatus: "running",
        handoffError: undefined,
      });
      const sourceSession = useSessionStore.getState().sessions.find((session) => session.id === detail.sourceSessionId);
      void (async () => {
        const appState = useAppStore.getState();
        const startRes = await window.api.startKimiCodeRuntime({
          workDir: detail.projectPath,
          additionalWorkDirs: normalizeAdditionalWorkDirs(appState.additionalWorkDirs),
          yoloMode: appState.permissionMode === "yolo",
          autoMode: appState.permissionMode === "auto",
          planMode: appState.defaultPlanMode,
          thinking: appState.defaultThinking,
        });
        if (!startRes.success) throw new Error(startRes.error);
        rememberHiddenHandoffSession(startRes.data.sessionId);
        const timeoutId = window.setTimeout(() => {
          const job = handoffJobRef.current;
          if (!job || job.runtimeSessionId !== startRes.data.sessionId) return;
          void finishHandoffJob(job, "error");
        }, HANDOFF_TIMEOUT_MS);
        handoffJobRef.current = {
          sourceSessionId: detail.sourceSessionId,
          runtimeSessionId: startRes.data.sessionId,
          projectPath: detail.projectPath,
          recommendationEventId: detail.recommendationEventId,
          events: [],
          timeoutId,
        };
        const prompt = buildHandoffPrompt(sourceSession);
        const sendRes = await window.api.sendKimiCodePrompt({
          sessionId: startRes.data.sessionId,
          content: prompt,
          model: startRes.data.model ?? undefined,
        });
        if (!sendRes.success) throw new Error(sendRes.error);
      })().catch((err) => {
        const job = handoffJobRef.current;
        handoffJobRef.current = null;
        if (job?.timeoutId) window.clearTimeout(job.timeoutId);
        setHandoffSessionId(null);
        setRunningSessionId(null);
        if (job?.runtimeSessionId) void window.api.closeKimiCodeSession({ sessionId: job.runtimeSessionId }).catch(logError("closeKimiCodeSession"));
        updateRecommendationEvent(detail.sourceSessionId, detail.recommendationEventId, {
          handoffStatus: "error",
          handoffError: err instanceof Error ? err.message : String(err),
        });
      });
    };
    window.addEventListener("kimix:startHandoff", handleStartHandoff);

    const unsubscribeKimiCodeEvent = window.api.onKimiCodeEvent((payload) => {
      const currentHandoffJob = handoffJobRef.current;
      if (currentHandoffJob?.runtimeSessionId === payload.sessionId) {
        const mapped = mapStreamEvent(payload.event);
        if (mapped) currentHandoffJob.events = mergeEvents(currentHandoffJob.events, mapped);
        const terminalStatus = getHandoffTerminalStatus(payload.event);
        if (terminalStatus) void finishHandoffJob(currentHandoffJob, terminalStatus);
        return;
      }
      const roomOwner = resolveRoomRuntimeOwner(useSessionStore.getState().sessions, payload.sessionId);
      const uiSessionId = roomOwner?.roomId ?? resolveUiSessionId(payload.sessionId);
      const targetSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
      if (targetSession?.engine && targetSession.engine !== "kimi-code" && !targetSession.longTask) return;
      const roomAgentId = roomOwner?.roomAgentId ?? (targetSession ? getPrimaryRoomAgent(targetSession).id : undefined);
      const targetAgentSession = targetSession && roomAgentId
        ? getRoomAgentSessionView(targetSession, roomAgentId)
        : targetSession;
      const roomActivity = targetSession && roomAgentId
        ? useAppStore.getState().roomAgentActivities[roomAgentActivityKey(targetSession.id, roomAgentId)]
        : undefined;
      const runtimeActive = targetSession?.collaboration && roomAgentId
        ? Boolean(roomActivity && isRoomAgentReconciliationStatus(roomActivity.status))
        // Snapshot completion must be guarded only by authoritative runtime
        // ownership. Using recent open timeline work here creates a loop: the
        // replayed assistant makes itself look active, so its own TurnEnd is
        // skipped and the row can remain "running" forever.
        : isSessionRuntimeTracked(targetAgentSession, useAppStore.getState().runningSessionId);
      const rawEvent = payload.event && typeof payload.event === "object" && !Array.isArray(payload.event)
        ? payload.event as Record<string, unknown>
        : null;
      if (rawEvent?.type === "agent.status.updated") {
        syncSessionSwarmMode(uiSessionId, rawEvent, roomAgentId);
      }
      const officialTitle = extractOfficialSessionTitle(rawEvent);
      if (
        officialTitle &&
        !targetSession?.titleLocked &&
        (!roomAgentId || !targetSession || isPrimaryRoomAgent(targetSession, roomAgentId))
      ) {
        updateSession(uiSessionId, (session) => ({
          ...session,
          title: officialTitle,
          updatedAt: Date.now(),
        }));
        syncCurrentSessionFromStore(uiSessionId);
      }
      if (shouldSkipKimiCodeSnapshotReplay(rawEvent, targetAgentSession?.events, runtimeActive)) return;
      const mapped = rawEvent?.type === "kimix.approval.request"
        ? mapKimiCodeApprovalRequest({
            ...(rawEvent.request && typeof rawEvent.request === "object" && !Array.isArray(rawEvent.request) ? rawEvent.request as Record<string, unknown> : {}),
            toolCallId: typeof rawEvent.requestId === "string" ? rawEvent.requestId : undefined,
          })
        : rawEvent?.type === "kimix.question.request"
          ? mapKimiCodeQuestionRequest({
              ...(rawEvent.request && typeof rawEvent.request === "object" && !Array.isArray(rawEvent.request) ? rawEvent.request as Record<string, unknown> : {}),
              toolCallId: typeof rawEvent.requestId === "string" ? rawEvent.requestId : undefined,
          })
        : mapKimiCodeEvent(payload.event);
      if (!mapped) return;
      const longTaskRole = getLongTaskRoleForRuntime(targetSession, payload.sessionId);
      const mappedWithRole = attachLongTaskAgentRole(mapped, longTaskRole);
      const roomScopedEvent = targetSession?.longTask || !roomAgentId
        ? mappedWithRole
        : scopeEventToRoomAgent(mappedWithRole, roomAgentId);
      const mappedForRoom = targetSession?.longTask || !roomAgentId
        ? roomScopedEvent
        : {
            ...roomScopedEvent,
            roomMessageId: roomScopedEvent.roomMessageId ?? roomActivity?.roomMessageId,
            agentTurnId: roomScopedEvent.agentTurnId ?? roomActivity?.activeTurnId,
          };
      if (mappedForRoom.type !== "status_update") {
        runtimeLastStreamEventAtRef.current.set(payload.sessionId, Date.now());
      }
      if (!shouldAppendRuntimeStatusToTimeline({
        rawType: typeof rawEvent?.type === "string" ? rawEvent.type : undefined,
        mappedEvent: mappedForRoom,
        session: targetAgentSession,
        runtimeSessionId: payload.sessionId,
        runningSessionId: useAppStore.getState().runningSessionId,
        runtimeActive: targetSession?.collaboration && roomAgentId
          ? Boolean(roomActivity && ["sending", "running", "waiting_approval", "waiting_question"].includes(roomActivity.status))
          : undefined,
      })) {
        return;
      }
      const modelSwitchedAt = targetAgentSession?.modelSwitchedAt;
      if (
        mappedForRoom.type === "status_update" &&
        modelSwitchedAt &&
        !targetAgentSession.events.some((event) => event.type === "assistant_message" && event.timestamp > modelSwitchedAt)
      ) {
        return;
      }

      markLongTaskRuntimeActivity(uiSessionId, payload.sessionId);
      if (mappedForRoom.type === "question_request" && mappedForRoom.status === "pending") {
        if (roomAgentId) {
          setRoomAgentActivity({
            roomId: uiSessionId,
            roomAgentId,
            runtimeSessionId: payload.sessionId,
            status: "waiting_question",
            roomMessageId: roomActivity?.roomMessageId,
            activeTurnId: roomActivity?.activeTurnId,
            updatedAt: Date.now(),
          });
        }
        const notifyKey = `${payload.sessionId}:${questionRequestNotificationKey(mappedForRoom)}`;
        if (!notifiedQuestionRequestRef.current.has(notifyKey)) {
          notifiedQuestionRequestRef.current.add(notifyKey);
          notifyClarificationNeeded(uiSessionId, payload.sessionId, mappedForRoom);
        }
      }
      if (mappedForRoom.type === "approval_request" && mappedForRoom.status === "pending") {
        if (roomAgentId) {
          setRoomAgentActivity({
            roomId: uiSessionId,
            roomAgentId,
            runtimeSessionId: payload.sessionId,
            status: "waiting_approval",
            roomMessageId: roomActivity?.roomMessageId,
            activeTurnId: roomActivity?.activeTurnId,
            updatedAt: Date.now(),
          });
        }
        const notifyKey = `${payload.sessionId}:${approvalRequestNotificationKey(mappedForRoom)}`;
        if (!notifiedApprovalRequestRef.current.has(notifyKey)) {
          notifiedApprovalRequestRef.current.add(notifyKey);
          notifyApprovalNeeded(uiSessionId, payload.sessionId, mappedForRoom);
        }
      }
      if (isLongTaskRuntimeHiddenFromChat(targetSession, payload.sessionId)) {
        mergeHiddenLongTaskEvent(payload.sessionId, mappedForRoom);
        if (shouldMirrorHiddenLongTaskEvent(mappedForRoom)) {
          enqueueStreamEvent(uiSessionId, mappedForRoom);
        }
        if (mappedForRoom.type === "question_request" || mappedForRoom.type === "approval_request" || mappedForRoom.type === "error") {
          flushStreamEvents();
          void persistLocalConversationState();
        }
        return;
      }
      enqueueStreamEvent(uiSessionId, mappedForRoom);
      scheduleOfficialGoalRefresh(uiSessionId, payload.sessionId, roomAgentId);
      if ((mappedForRoom.type === "tool_call" || mappedForRoom.type === "tool_result") && roomAgentId) {
        updateSession(uiSessionId, (session) => {
          const agentView = getRoomAgentSessionView(session, roomAgentId);
          const terminalGoal = inferTerminalGoalFromEvent(mappedForRoom, agentView.officialGoal?.goal);
          if (!terminalGoal) return session;
          const officialGoal = {
              goal: terminalGoal,
              error: null,
              updatedAt: Date.now(),
          };
          if (session.collaboration) {
            return {
              ...updateRoomAgent(session, roomAgentId, (agent) => ({ ...agent, officialGoal })),
              updatedAt: Date.now(),
            };
          }
          return { ...session, officialGoal, updatedAt: Date.now() };
        });
        syncCurrentSessionFromStore(uiSessionId);
      }
      if (mappedForRoom.type === "question_request" || mappedForRoom.type === "approval_request" || mappedForRoom.type === "error") {
        flushStreamEvents();
        void persistLocalConversationState();
      }
    });

    const unsubscribeKimiCodeStatus = window.api.onKimiCodeStatus((payload) => {
      const handoffJob = handoffJobRef.current;
      if (handoffJob?.runtimeSessionId === payload.sessionId) {
        if (payload.status === "running") {
          setRunningSessionId(handoffJob.sourceSessionId);
          return;
        }
        if (["completed", "error", "interrupted"].includes(payload.status)) {
          void finishHandoffJob(handoffJob, payload.status as "completed" | "error" | "interrupted");
          return;
        }
      }

      const statusOwner = resolveRoomRuntimeOwner(useSessionStore.getState().sessions, payload.sessionId);
      const uiSessionId = statusOwner?.roomId ?? resolveUiSessionId(payload.sessionId);
      const roomAgentId = statusOwner?.roomAgentId
        ?? (() => {
          const session = useSessionStore.getState().sessions.find((item) => item.id === uiSessionId);
          return session ? getPrimaryRoomAgent(session).id : undefined;
        })();
      const statusRuntimeSessionId = payload.migratedTo ?? payload.sessionId;

      // Server 会话 mid-turn 失败后已迁移到新的 SDK 会话：更新本地 runtime id。
      if (payload.migratedTo) {
        const turnStart = runtimeTurnStartRef.current.get(payload.sessionId);
        if (turnStart) {
          runtimeTurnStartRef.current.set(payload.migratedTo, turnStart);
          runtimeTurnStartRef.current.delete(payload.sessionId);
        }
        const lastStreamEventAt = runtimeLastStreamEventAtRef.current.get(payload.sessionId);
        if (lastStreamEventAt) {
          runtimeLastStreamEventAtRef.current.set(payload.migratedTo, lastStreamEventAt);
          runtimeLastStreamEventAtRef.current.delete(payload.sessionId);
        }
        updateSession(uiSessionId, (session) => {
          if (session.collaboration && roomAgentId) {
            return {
              ...updateRoomAgent(session, roomAgentId, (agent) => ({
                ...agent,
                runtimeSessionId: payload.migratedTo,
                officialSessionId: undefined,
              })),
              updatedAt: Date.now(),
            };
          }
          return {
            ...session,
            runtimeSessionId: payload.migratedTo,
            officialSessionId: undefined,
            updatedAt: Date.now(),
          };
        });
        if (useAppStore.getState().currentSession?.id === uiSessionId) {
          const latest = useSessionStore.getState().sessions.find((s) => s.id === uiSessionId);
          if (latest) useAppStore.getState().setCurrentSession(latest);
        }
        void window.api.getKimiCodeStatus({ sessionId: payload.migratedTo }).then((response) => {
          if (!response.success) return;
          updateSession(uiSessionId, (session) => {
            if (session.collaboration && roomAgentId) {
              return {
                ...updateRoomAgent(session, roomAgentId, (agent) => ({
                  ...agent,
                  modelAlias: response.data.model ?? agent.modelAlias,
                  swarmMode: extractSwarmModeStatus(response.data) ?? agent.swarmMode,
                })),
                updatedAt: Date.now(),
              };
            }
            return {
              ...session,
              model: response.data.model ?? session.model,
              swarmMode: extractSwarmModeStatus(response.data) ?? session.swarmMode,
              updatedAt: Date.now(),
            };
          });
          syncCurrentSessionFromStore(uiSessionId);
        }).catch(logError("refreshMigratedSessionModel"));
      }

      const targetSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
      if (targetSession?.engine && targetSession.engine !== "kimi-code" && !targetSession.longTask) return;
      // longTask 会话由专属监听器 (unsubscribeLongTaskStatus) 单独处理，通用监听器跳过避免重复执行
      if (targetSession?.longTask) return;

      if (isActiveKimiCodeEngineStatus(payload.status)) {
        const activeStatus = payload.status;
        runtimeLastStreamEventAtRef.current.set(statusRuntimeSessionId, Date.now());
        const runningSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
        const runningEvents = runningSession && roomAgentId
          ? getRoomAgentEvents(runningSession, roomAgentId)
          : runningSession?.events ?? [];
        if (payload.status === "running" && !runtimeTurnStartRef.current.has(statusRuntimeSessionId)) {
          runtimeTurnStartRef.current.set(statusRuntimeSessionId, {
            eventStartIndex: runningEvents.length,
            openAssistantIds: new Set(runningEvents.flatMap((event) => (
              event.type === "assistant_message" && !event.isComplete ? [event.id] : []
            ))),
          });
        }
        if (roomAgentId) {
          const previous = useAppStore.getState().roomAgentActivities[roomAgentActivityKey(uiSessionId, roomAgentId)];
          setRoomAgentActivity({
            roomId: uiSessionId,
            roomAgentId,
            runtimeSessionId: statusRuntimeSessionId,
            status: activeStatus,
            roomMessageId: previous?.roomMessageId,
            activeTurnId: previous?.activeTurnId,
            startedAt: previous?.startedAt ?? Date.now(),
            updatedAt: Date.now(),
          });
          if (runningSession && previous?.roomMessageId) {
            updateSession(uiSessionId, (session) => applyRoomDeliveryRuntimeStatus(
              session,
              previous.roomMessageId,
              roomAgentId,
              activeStatus,
            ));
          }
          if (runningSession && isPrimaryRoomAgent(runningSession, roomAgentId)) {
            setRunningSessionId(uiSessionId);
          }
        }
        return;
      }

      if (!isTerminalKimiCodeEngineStatus(payload.status) || payload.status === "idle") return;
      const terminalStatus = payload.status;

      if (payload.migratedTo) {
        cleanupRuntimeRefs(payload.sessionId, payload.status as "completed" | "error" | "interrupted", {
          notifiedQuestionRequest: notifiedQuestionRequestRef.current,
          hiddenLongTaskEvents: hiddenLongTaskEventsRef.current,
        });
      }
      cleanupRuntimeRefs(statusRuntimeSessionId, payload.status as "completed" | "error" | "interrupted", {
        notifiedQuestionRequest: notifiedQuestionRequestRef.current,
        hiddenLongTaskEvents: hiddenLongTaskEventsRef.current,
      });
      runtimeLastStreamEventAtRef.current.delete(statusRuntimeSessionId);
      runtimeHistoryRefreshAtRef.current.delete(statusRuntimeSessionId);

      flushStreamEvents();
      void refreshOfficialGoalState(uiSessionId, statusRuntimeSessionId, roomAgentId);
      goalLastRefreshRef.current.set(`${uiSessionId}:${roomAgentId ?? "primary"}:${statusRuntimeSessionId}`, Date.now());
      const terminalActivity = roomAgentId
        ? useAppStore.getState().roomAgentActivities[roomAgentActivityKey(uiSessionId, roomAgentId)]
        : undefined;
      if (roomAgentId) {
        setRoomAgentActivity({
          roomId: uiSessionId,
          roomAgentId,
          runtimeSessionId: statusRuntimeSessionId,
          status: terminalStatus,
          updatedAt: Date.now(),
        });
        if (terminalActivity?.roomMessageId) {
          updateSession(uiSessionId, (session) => applyRoomDeliveryRuntimeStatus(
            session,
            terminalActivity.roomMessageId,
            roomAgentId,
            terminalStatus,
          ));
        }
      }
      const activeRunningSessionId = useAppStore.getState().runningSessionId;
      const latestRoom = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
      if (
        (!roomAgentId || !latestRoom || isPrimaryRoomAgent(latestRoom, roomAgentId)) &&
        (activeRunningSessionId === uiSessionId || activeRunningSessionId === statusRuntimeSessionId)
      ) {
        setRunningSessionId(null);
      }

      if (payload.status === "error" || payload.status === "interrupted") {
        runtimeTurnStartRef.current.delete(statusRuntimeSessionId);
        const failureMessage = payload.status === "interrupted" ? "当前轮已中断。" : "当前轮执行失败。";
        updateSession(uiSessionId, (session) => {
          const ownerAgentId = roomAgentId ?? getPrimaryRoomAgent(session).id;
          const next = updateRoomAgentEvents(session, ownerAgentId, (events) => (
            settlePendingSteerMessages(
              settlePendingQuestions(settleFailedEvents(events, failureMessage)),
              "failed",
              payload.status === "interrupted" ? "引导未完成，当前轮已中断。" : "引导未完成，当前轮执行失败。",
            )
          ));
          return { ...next, updatedAt: Date.now() };
        });
        return;
      }

      const turnStart = runtimeTurnStartRef.current.get(statusRuntimeSessionId);
      updateSession(uiSessionId, (session) => {
        const ownerAgentId = roomAgentId ?? getPrimaryRoomAgent(session).id;
        const next = updateRoomAgentEvents(session, ownerAgentId, (events) => {
          const settled = settleInactiveEvents(events);
          return isPrimaryRoomAgent(session, ownerAgentId)
            ? appendSessionRecommendationIfNeeded(
                settled,
                useAppStore.getState().sessionRecommendationEnabled,
                useAppStore.getState().sessionRecommendationTurnLimit,
              )
            : settled;
        });
        return { ...next, updatedAt: Date.now() };
      });
      const completedSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
      const completedEvents = completedSession && roomAgentId
        ? getRoomAgentEvents(completedSession, roomAgentId)
        : completedSession?.events ?? [];
      const assistant = extractAssistantForTurn(completedEvents, turnStart);
      notifyTurnComplete(uiSessionId, statusRuntimeSessionId, undefined, assistant, {
        roomAgentId,
        agentTurnId: assistant?.agentTurnId ?? terminalActivity?.activeTurnId,
        eventId: assistant?.id,
      });
      runtimeTurnStartRef.current.delete(statusRuntimeSessionId);

      if (!roomAgentId || !completedSession || isPrimaryRoomAgent(completedSession, roomAgentId)) {
        void dispatchNextPendingKimiMessage(uiSessionId, statusRuntimeSessionId);
      }
    });

    const unsubscribeLongTaskStatus = window.api.onKimiCodeStatus((payload) => {
      const handoffJob = handoffJobRef.current;
      if (handoffJob?.runtimeSessionId === payload.sessionId) {
        if (payload.status === "running") {
          setRunningSessionId(handoffJob.sourceSessionId);
          return;
        }
        if (["completed", "error", "interrupted"].includes(payload.status)) {
          void finishHandoffJob(handoffJob, payload.status as "completed" | "error" | "interrupted");
          return;
        }
      }

      const statusUiSessionId = resolveUiSessionId(payload.sessionId);
      const statusSession = useSessionStore.getState().sessions.find((session) => session.id === statusUiSessionId);
      if (statusSession?.engine === "kimi-code" && !statusSession.longTask) {
        return;
      }

      if (payload.status === "running") {
        const uiSessionId = statusUiSessionId;
        const runningSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
        runtimeTurnStartRef.current.set(payload.sessionId, {
          eventStartIndex: runningSession?.events.length ?? 0,
          openAssistantIds: new Set((runningSession?.events ?? []).flatMap((event) => (
            event.type === "assistant_message" && !event.isComplete ? [event.id] : []
          ))),
        });
        markLongTaskRuntimeActivity(uiSessionId, payload.sessionId, "running");
        if (
          runningSession?.longTask?.reviewerSessionId !== runningSession?.longTask?.executorSessionId &&
          runningSession?.longTask?.reviewerSessionId === payload.sessionId
        ) {
          upsertLongTaskAgentProxyMessage(uiSessionId, "reviewer", "running");
        }
        setRunningSessionId(uiSessionId);
        return;
      }

      if (!["completed", "error", "interrupted"].includes(payload.status)) {
        return;
      }

      cleanupRuntimeRefs(payload.sessionId, payload.status as "completed" | "error" | "interrupted", {
        notifiedQuestionRequest: notifiedQuestionRequestRef.current,
        hiddenLongTaskEvents: hiddenLongTaskEventsRef.current,
      });

      const uiSessionId = statusUiSessionId;
      const terminalStatus = payload.status as "completed" | "error" | "interrupted";
      const terminalSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
      const isReviewerTerminal = Boolean(
        terminalSession?.longTask &&
        terminalSession.longTask.reviewerSessionId !== terminalSession.longTask.executorSessionId &&
        terminalSession.longTask.reviewerSessionId === payload.sessionId
      );
      flushStreamEvents();
      markLongTaskRuntimeActivity(uiSessionId, payload.sessionId, terminalStatus);
      if (isReviewerTerminal && terminalStatus !== "completed") {
        upsertLongTaskAgentProxyMessage(uiSessionId, "reviewer", terminalStatus);
      }
      const activeRunningSessionId = useAppStore.getState().runningSessionId;
      if (activeRunningSessionId === uiSessionId || activeRunningSessionId === payload.sessionId) {
        setRunningSessionId(null);
      }

      if (payload.status === "error" || payload.status === "interrupted") {
        runtimeTurnStartRef.current.delete(payload.sessionId);
        const failureMessage = payload.status === "interrupted" ? "当前轮已中断。" : "当前轮执行失败。";
        updateSession(uiSessionId, (session) => ({
          ...session,
          events: settlePendingSteerMessages(
            settlePendingQuestions(settleFailedEvents(session.events, failureMessage)),
            "failed",
            payload.status === "interrupted" ? "引导未完成，当前轮已中断。" : "引导未完成，当前轮执行失败。",
          ),
          updatedAt: Date.now(),
        }));
      }

      if (payload.status === "completed") {
        const turnStart = runtimeTurnStartRef.current.get(payload.sessionId);
        updateSession(uiSessionId, (session) => ({
          ...session,
          events: appendSessionRecommendationIfNeeded(
            settleInactiveEvents(session.events),
            useAppStore.getState().sessionRecommendationEnabled,
            useAppStore.getState().sessionRecommendationTurnLimit,
          ),
          updatedAt: Date.now(),
        }));
        const completedRole = getLongTaskRoleForRuntime(
          useSessionStore.getState().sessions.find((session) => session.id === uiSessionId),
          payload.sessionId,
        );
        const completedSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
        const assistant = extractAssistantForTurn(completedSession?.events ?? [], turnStart);
        notifyTurnComplete(uiSessionId, payload.sessionId, completedRole === "executor" ? "执行" : completedRole === "reviewer" ? "审核" : undefined, assistant);
        runtimeTurnStartRef.current.delete(payload.sessionId);

        applyLongTaskProgressFromLatestOutput(uiSessionId, payload.sessionId);
        if (dispatchLongTaskExecutorNext(uiSessionId, payload.sessionId)) {
          return;
        }
        if (isReviewerTerminal) {
          const reviewerOutput = getHiddenLongTaskAssistantContent(payload.sessionId);
          pauseLongTaskReviewerWithError(
            uiSessionId,
            reviewerOutput.trim().length > 0
              ? "用户审查流程已结束，但没有给出明确结论（通过 / 需修复 / 待人工审查），已暂停当前长程任务。"
              : "用户审查流程已结束，但没有返回可用结果，已暂停当前长程任务。",
          );
          return;
        }

        const latestSession = useSessionStore.getState().sessions.find((session) => session.id === uiSessionId);
        if (latestSession && hasPendingQuestion(latestSession.events)) {
          void persistLocalConversationState();
          return;
        }

        void shouldWaitForOfficialPromptQueue(payload.sessionId).then((shouldWait) => {
          if (shouldWait) {
            setRunningSessionId(uiSessionId);
            void persistLocalConversationState();
            return;
          }
          const next = useSessionStore.getState().shiftPendingMessage(uiSessionId);
          if (next) {
          const userEventId = Math.random().toString(36).substring(2, 11);
          const placeholderId = Math.random().toString(36).substring(2, 11);
          updateSession(uiSessionId, (session) => ({
            ...session,
            events: [
              ...session.events,
              {
                id: userEventId,
                type: "user_message" as const,
                timestamp: Date.now(),
                content: next.content,
                images: next.images,
              },
              {
                id: placeholderId,
                type: "assistant_message" as const,
                timestamp: Date.now(),
                content: "",
                isThinking: useAppStore.getState().defaultThinking,
                isComplete: false,
              },
            ],
            updatedAt: Date.now(),
          }));
          setRunningSessionId(uiSessionId);
          const timer = setTimeout(() => {
            const runtimeSessionId = resolveRuntimeSessionId(uiSessionId);
            const sendPromise = sendKimiCodePromptWithRetry({
              sessionId: runtimeSessionId,
              content: contentWithFileAttachments(next.content, next.images),
              images: promptImages(next.images),
              model: currentSessionPromptModel(uiSessionId),
            });
            sendPromise.then((res) => {
              if (res.success) return;
              throw new Error(res.error);
            }).catch((err) => {
              const message = err instanceof Error ? err.message : String(err);
              if (isKimiAbortError(message)) {
                updateSession(uiSessionId, (session) => ({
                  ...session,
                  events: settleInactiveEvents(session.events.filter((event) => event.id !== placeholderId)),
                  updatedAt: Date.now(),
                }));
                syncCurrentSessionFromStore(uiSessionId);
                setRunningSessionId(null);
                return;
              }
              useSessionStore.getState().addPendingMessage(uiSessionId, next.content, next.images);
              if (isKimiActiveTurnError(message)) {
                updateSession(uiSessionId, (session) => {
                  const filteredEvents = session.events.filter((event) => event.id !== placeholderId && event.id !== userEventId);
                  console.log("[App queue dispatch active-turn]", {
                    uiSessionId,
                    placeholderId,
                    userEventId,
                    beforeCount: session.events.length,
                    afterCount: filteredEvents.length,
                  });
                  return {
                    ...session,
                    events: filteredEvents,
                    updatedAt: Date.now(),
                  };
                });
                setRunningSessionId(uiSessionId);
                return;
              }
              updateSession(uiSessionId, (session) => ({
                ...session,
                events: [
                  ...session.events.filter((event) => event.id !== placeholderId && event.id !== userEventId),
                  {
                    id: crypto.randomUUID(),
                    type: "error" as const,
                    timestamp: Date.now(),
                    message,
                    source: "ipc" as const,
                  },
                ],
                updatedAt: Date.now(),
              }));
              setRunningSessionId(null);
            });
          }, 300);
            timersRef.current.push(timer);
          }
        });
      }
    });

    return () => {
      unsubscribeLongTaskStatus();
      unsubscribeKimiCodeEvent();
      unsubscribeKimiCodeStatus();
      unsubscribeBootstrap();
      window.removeEventListener("kimix:startHandoff", handleStartHandoff);
      window.removeEventListener("focus", markRendererWindowFocused);
      window.removeEventListener("blur", markRendererWindowBlurred);
      document.removeEventListener("pointerdown", markRendererWindowFocused, true);
      document.removeEventListener("keydown", markRendererWindowFocused, true);
      if (handoffJobRef.current) {
        window.clearTimeout(handoffJobRef.current.timeoutId);
        handoffJobRef.current = null;
      }
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      goalRefreshTimersRef.current.forEach(clearTimeout);
      goalRefreshTimersRef.current.clear();
      goalLastRefreshRef.current.clear();
    };
  // Runtime listeners own session continuity. Preference changes are read from
  // useAppStore at operation time and must never restart bootstrap or history recovery.
  }, [setHandoffSessionId, setRunningSessionId, setRoomAgentActivity, updateSession, setRecentProjects, enqueueStreamEvent, flushStreamEvents, syncSessionSwarmMode]);

  useEffect(() => {
    if (!runningSessionId && !activeRoomAgentActivitySignature && !activeRoomDeliverySignature) return;
    let disposed = false;
    const checkingRuntimeIds = new Set<string>();
    const reconciliationStartedAt = Date.now();

    const reconcileAgentRuntime = async (
      roomId: string,
      roomAgentId: string,
      runtimeSessionId: string,
    ) => {
      if (disposed || checkingRuntimeIds.has(runtimeSessionId)) return;
      const session = useSessionStore.getState().sessions.find((item) => item.id === roomId);
      if (!session || session.longTask) return;
      checkingRuntimeIds.add(runtimeSessionId);
      try {
        const runtimeCandidates = Array.from(new Set([
          runtimeSessionId,
          ...(getRoomAgentRecoveryTargets(session).find((target) => target.roomAgentId === roomAgentId)?.sessionIds ?? []),
        ]));
        let resolvedRuntimeSessionId = runtimeSessionId;
        let response = await window.api.getKimiCodeStatus({ sessionId: runtimeSessionId });
        let allCandidatesUnavailable = !response.success && isKimiCodeSessionUnavailableError(response.error);
        for (const candidate of runtimeCandidates.slice(1)) {
          if (response.success) break;
          const candidateResponse = await window.api.getKimiCodeStatus({ sessionId: candidate });
          if (!candidateResponse.success) {
            allCandidatesUnavailable = allCandidatesUnavailable && isKimiCodeSessionUnavailableError(candidateResponse.error);
            continue;
          }
          response = candidateResponse;
          resolvedRuntimeSessionId = candidate;
        }
        if (disposed) return;
        if (!response.success) {
          if (!allCandidatesUnavailable) return;
          const stoppedAt = Date.now();
          const latestSession = useSessionStore.getState().sessions.find((item) => item.id === roomId) ?? session;
          const currentActivity = useAppStore.getState().roomAgentActivities[roomAgentActivityKey(roomId, roomAgentId)];
          const controlTarget = getRoomAgentReconciliationTargets(
            latestSession,
            Object.values(useAppStore.getState().roomAgentActivities),
          ).find((target) => target.roomAgentId === roomAgentId);
          updateSession(roomId, (item) => settleStoppedRoomAgent(item, {
            roomAgentId,
            roomMessageId: currentActivity?.roomMessageId ?? controlTarget?.roomMessageId,
          }, stoppedAt));
          setRoomAgentActivity({
            roomId,
            roomAgentId,
            runtimeSessionId,
            status: "interrupted",
            roomMessageId: currentActivity?.roomMessageId ?? controlTarget?.roomMessageId,
            activeTurnId: currentActivity?.activeTurnId ?? controlTarget?.activeTurnId,
            updatedAt: stoppedAt,
          });
          if (isPrimaryRoomAgent(latestSession, roomAgentId)) setRunningSessionId(null);
          syncCurrentSessionFromStore(roomId);
          return;
        }
        if (resolvedRuntimeSessionId !== runtimeSessionId) {
          updateSession(session.id, (item) => bindRecoveredRoomAgentRuntime(item, roomAgentId, {
            sessionId: resolvedRuntimeSessionId,
            model: response.success ? response.data.model : undefined,
          }));
          syncCurrentSessionFromStore(session.id);
        }
        runtimeSessionId = resolvedRuntimeSessionId;
        syncSessionSwarmMode(session.id, response.data, roomAgentId);
        if (isActiveKimiCodeEngineStatus(response.data.engineStatus)) {
          setRoomAgentActivity({
            roomId: session.id,
            roomAgentId,
            runtimeSessionId,
            status: response.data.engineStatus,
            startedAt: useAppStore.getState().roomAgentActivities[roomAgentActivityKey(session.id, roomAgentId)]?.startedAt ?? reconciliationStartedAt,
            updatedAt: Date.now(),
          });
          runtimeTerminalPollRef.current.delete(runtimeSessionId);
          const now = Date.now();
          const lastStreamEventAt = runtimeLastStreamEventAtRef.current.get(runtimeSessionId) ?? reconciliationStartedAt;
          const lastHistoryRefreshAt = runtimeHistoryRefreshAtRef.current.get(runtimeSessionId) ?? 0;
          if (
            response.data.engineStatus === "running" &&
            now - lastStreamEventAt >= 4_000 &&
            now - lastHistoryRefreshAt >= 4_000
          ) {
            runtimeHistoryRefreshAtRef.current.set(runtimeSessionId, now);
            const loaded = await window.api.loadKimiCodeSession({
              workDir: session.projectPath,
              sessionId: runtimeSessionId,
            }).catch(() => null);
            if (disposed || !loaded?.success) return;
            const canonicalSnapshotEvents = mapHistoryEvents(Array.isArray(loaded.data.events) ? loaded.data.events : []);
            let applied = false;
            updateSession(session.id, (item) => {
              const localAgentEvents = getRoomAgentEvents(item, roomAgentId);
              const reconciliation = reconcileAgentCanonicalHistory({
                session: item,
                roomAgentId,
                expectedRuntimeSessionId: runtimeSessionId,
                canonicalEvents: canonicalSnapshotEvents,
                reason: "running-sample",
              });
              if (!reconciliation.applied) {
                return item;
              }
              if (!shouldReplaceWithCanonicalKimiHistory(localAgentEvents, reconciliation.events, { sessionId: session.id, roomAgentId, reason: "running-sample" })) {
                const patchedEvents = mergeMissingLatestCanonicalAssistant(
                  localAgentEvents,
                  reconciliation.events,
                  { sessionId: session.id, roomAgentId, reason: "running-sample" },
                );
                if (patchedEvents !== localAgentEvents) {
                  applied = true;
                  return updateRoomAgentEvents(item, roomAgentId, () => patchedEvents);
                }
                if (!hasEquivalentKimiHistoryTurnBodies(localAgentEvents, reconciliation.events)) return item;
                applied = true;
                return markAgentKimiHistoryCacheCurrent(item, roomAgentId);
              }
              applied = true;
              return markAgentKimiHistoryCacheCurrent(reconciliation.session, roomAgentId);
            });
            if (applied) syncCurrentSessionFromStore(session.id);
          }
          return;
        }
        if (!isTerminalKimiCodeEngineStatus(response.data.engineStatus)) return;
        const terminalStatus = response.data.engineStatus;
        if (Date.now() - reconciliationStartedAt < 2500) return;

        const terminalPolls = (runtimeTerminalPollRef.current.get(runtimeSessionId) ?? 0) + 1;
        runtimeTerminalPollRef.current.set(runtimeSessionId, terminalPolls);
        if (terminalPolls < 2) return;
        runtimeTerminalPollRef.current.delete(runtimeSessionId);
        runtimeLastStreamEventAtRef.current.delete(runtimeSessionId);
        runtimeHistoryRefreshAtRef.current.delete(runtimeSessionId);

        // 提前误判终端保护：0.27 Server 可能在 assistant body 还没 stream 到时就
        // 报 idle/completed。如果当前轮次从未收到过任何 assistant body/thinking/
        // tool/error 事件，这个"终端"很可能是误判——body 还在路上。此时仍 settle
        // （清 running state、派发下一条排队消息），但保留空 placeholder 让消息头
        // 可见，等 body 真正到达后填充。不设时间上限：body 可能来得很慢（401 重试、
        // 长思考模型），只要从未收过 body 就保留 placeholder。
        const guardSession = useSessionStore.getState().sessions.find((item) => item.id === session.id) ?? session;
        const guardAgentEvents = getRoomAgentEvents(guardSession, roomAgentId);
        const turnReceivedBody = hasTurnReceivedBody(guardAgentEvents);

        const active = useAppStore.getState().roomAgentActivities[roomAgentActivityKey(session.id, roomAgentId)];
        const latestRunningId = useAppStore.getState().runningSessionId;
        const latestSession = useSessionStore.getState().sessions.find((item) => item.id === session.id) ?? session;
        const persistedTarget = getRoomAgentReconciliationTargets(latestSession, [])
          .find((target) => target.roomAgentId === roomAgentId);
        if (
          !active &&
          latestRunningId !== session.id &&
          latestRunningId !== runtimeSessionId &&
          !persistedTarget
        ) return;
        flushStreamEvents();
        const settledAt = Date.now();
        updateSession(session.id, (item) => settleTerminalRoomAgent(item, {
          roomAgentId,
          roomMessageId: active?.roomMessageId ?? persistedTarget?.roomMessageId,
        }, terminalStatus, settledAt, turnReceivedBody));
        syncCurrentSessionFromStore(session.id);
        setRoomAgentActivity({
          roomId: session.id,
          roomAgentId,
          runtimeSessionId,
          status: terminalStatus,
          updatedAt: Date.now(),
        });
        if (isPrimaryRoomAgent(session, roomAgentId)) setRunningSessionId(null);
        if (
          isPrimaryRoomAgent(session, roomAgentId) &&
          (response.data.engineStatus === "completed" || response.data.engineStatus === "idle")
        ) {
          dispatchNextPendingKimiMessage(session.id, runtimeSessionId);
        }
      } finally {
        checkingRuntimeIds.delete(runtimeSessionId);
      }
    };

    const reconcileRuntimeStatus = async () => {
      if (disposed) return;
      const state = useAppStore.getState();
      const roomActivities = Object.values(state.roomAgentActivities);
      const reconciliationTargets = useSessionStore.getState().sessions.flatMap((session) => (
        getRoomAgentReconciliationTargets(session, roomActivities).map((target) => ({ ...target, roomId: session.id }))
      ));
      const runnableReconciliationTargets = getRunnableRoomAgentReconciliationTargets(reconciliationTargets);
      if (runnableReconciliationTargets.length > 0) {
        await Promise.all(runnableReconciliationTargets.map(async (target) => {
          await reconcileAgentRuntime(target.roomId, target.roomAgentId, target.runtimeSessionId);
        }));
        return;
      }

      const activeRunningId = state.runningSessionId;
      if (!activeRunningId) return;
      const session = useSessionStore.getState().sessions.find((item) => (
        item.id === activeRunningId || item.runtimeSessionId === activeRunningId || item.officialSessionId === activeRunningId
      ));
      if (!session || session.longTask) return;
      const primary = getPrimaryRoomAgent(session);
      const runtimeId = getRoomAgentRuntimeId(session, primary.id) ?? getRuntimeSessionId(session);
      if (!runtimeId) return;
      await reconcileAgentRuntime(session.id, primary.id, runtimeId);
    };

    const firstCheck = window.setTimeout(() => void reconcileRuntimeStatus(), 1200);
    const timer = window.setInterval(() => void reconcileRuntimeStatus(), 1500);
    const syncNow = () => void reconcileRuntimeStatus();
    window.addEventListener("focus", syncNow);
    document.addEventListener("visibilitychange", syncNow);
    return () => {
      disposed = true;
      window.clearTimeout(firstCheck);
      window.clearInterval(timer);
      window.removeEventListener("focus", syncNow);
      document.removeEventListener("visibilitychange", syncNow);
    };
  }, [activeRoomAgentActivitySignature, activeRoomDeliverySignature, runningSessionId, setRoomAgentActivity, setRunningSessionId, updateSession, flushStreamEvents, syncSessionSwarmMode]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (useAppStore.getState().runningSessionId) return;
      const sessions = useSessionStore.getState().sessions;
      for (const session of sessions) {
        if (!session.longTask) continue;
        const hydrated = hydrateLongTaskProgressFromHistory(session);
        if (hydrated.longTask && (
          hydrated.longTask.stage !== session.longTask.stage ||
          hydrated.longTask.currentStep !== session.longTask.currentStep ||
          hydrated.longTask.targetStep !== session.longTask.targetStep ||
          hydrated.longTask.activeAgent !== session.longTask.activeAgent
        )) {
          updateSession(session.id, () => hydrated);
          const active = useAppStore.getState().currentSession;
          if (active?.id === session.id) useAppStore.getState().setCurrentSession(hydrated);
        }
        if (dispatchLongTaskExecutorNext(session.id, session.longTask.executorSessionId)) break;
      }
    }, 1400);
    return () => clearTimeout(timer);
  }, [updateSession]);

  return (
    <ThemeProvider>
      <div
        style={{
          "--kimix-chat-font-size": `${fontSize}px`,
          "--kimix-composer-font-size": `${Math.max(12, fontSize)}px`,
          "--kimix-sidebar-font-size": `${Math.max(12, fontSize - 1)}px`,
        } as CSSProperties}
      >
        <AppShell />
      </div>
    </ThemeProvider>
  );
}

export default App;
