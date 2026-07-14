import { SquarePen, Settings, FolderOpen, Search, LayoutGrid, Clock, MoreHorizontal, Pin, Archive, X, FolderSearch, GitBranch, Loader2, Plus, Webhook, Download, FileText } from "lucide-react";
import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Project, Session } from "@/types/ui";
import { mapHistoryEvents } from "@/utils/eventMapper";
import { deriveSessionTitle, isDefaultSessionTitle } from "@/utils/sessionTitle";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import { sessionToMarkdown } from "@/utils/markdownExport";
import { displayProjectName } from "@/utils/projectDisplay";
import { getRuntimeSessionId } from "@/utils/runtimeSession";
import { compareSessionsByRecentConversation, getSessionConversationActivityAt, isSessionSidebarBusy } from "@/utils/sessionActivity";
import { useArchiveSession } from "@/hooks/useArchiveSession";
import { hasCanonicalKimiThinkingHistory, hasRicherKimiProcessHistory, KIMI_HISTORY_CACHE_VERSION } from "@/utils/kimiHistoryCache";
import { normalizeAdditionalWorkDirs } from "@/utils/additionalWorkDirs";
import { isSamePath, normalizePathForComparison } from "@/utils/pathCase";
import { reportError } from "@/utils/reportError";
import { reconcileOfficialSessionCatalog, shouldHideOfficialSessionPlaceholder } from "@/utils/sessionCatalog";
import { getLastUsedModelFromEvents } from "@/utils/modelDisplay";
import { getHiddenHandoffSessionIds } from "@/utils/persistence";
import { getRoomAgentRuntimeId } from "@/utils/collaborationRooms";
import { formatRoomLifecycleOutcomes } from "@/utils/sessionArchive";

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  const weeks = Math.floor(diff / 604800000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分`;
  if (hours < 24) return `${hours} 小时`;
  if (days < 7) return `${days} 天`;
  return `${weeks} 周`;
}

const navItemClass = "kimix-sidebar-nav-item flex h-10 w-full items-center rounded-lg text-[15px] text-text-primary transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const collapsedNavItemClass = "flex items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40";
const collapsedSettingsItemClass = "flex items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary";
const collapsedNavButtonStyle = { width: 40, height: 40, minWidth: 40, minHeight: 40, padding: 0 } as const;
const collapsedSettingsButtonStyle = { width: 40, height: 36, minWidth: 40, minHeight: 36, padding: 0 } as const;

function normalizeProjectPath(path: string | undefined) {
  return normalizePathForComparison(path);
}

function isSameProjectPath(a: string | undefined, b: string | undefined) {
  return isSamePath(a, b);
}

function sessionIdentitySet(session: Session): Set<string> {
  return new Set([
    session.id,
    session.runtimeSessionId,
    session.officialSessionId,
    session.skillForkParentSessionId,
    session.longTask?.executorSessionId,
    session.longTask?.reviewerSessionId,
  ].filter((id): id is string => Boolean(id)));
}

function normalizedSidebarSessionTitle(session: Session): string {
  return session.title.trim().toLowerCase();
}

function hasSkillForkIdentity(session: Session): boolean {
  return Boolean(session.skillForkParentSessionId) ||
    Array.from(sessionIdentitySet(session)).some((id) => id.startsWith("skill-"));
}

function areRelatedSidebarSessions(left: Session, right: Session): boolean {
  if (!isSameProjectPath(left.projectPath, right.projectPath)) return false;
  const leftIds = sessionIdentitySet(left);
  const rightIds = sessionIdentitySet(right);
  for (const id of leftIds) {
    if (rightIds.has(id)) return true;
  }
  const sameTitle = normalizedSidebarSessionTitle(left) &&
    normalizedSidebarSessionTitle(left) === normalizedSidebarSessionTitle(right);
  if (sameTitle && (hasSkillForkIdentity(left) || hasSkillForkIdentity(right))) return true;
  return false;
}

function preferSidebarSession(left: Session, right: Session, currentSessionId?: string): Session {
  if (left.id === currentSessionId && right.id !== currentSessionId) return left;
  if (right.id === currentSessionId && left.id !== currentSessionId) return right;
  const leftHasSkillLeaf = Boolean(left.runtimeSessionId?.startsWith("skill-") || left.officialSessionId?.startsWith("skill-"));
  const rightHasSkillLeaf = Boolean(right.runtimeSessionId?.startsWith("skill-") || right.officialSessionId?.startsWith("skill-"));
  if (leftHasSkillLeaf !== rightHasSkillLeaf) return leftHasSkillLeaf ? left : right;
  if (left.events.length !== right.events.length) return left.events.length > right.events.length ? left : right;
  const leftActivityAt = getSessionConversationActivityAt(left);
  const rightActivityAt = getSessionConversationActivityAt(right);
  if (leftActivityAt !== rightActivityAt) return leftActivityAt > rightActivityAt ? left : right;
  return left.updatedAt >= right.updatedAt ? left : right;
}

function dedupeSidebarSessions(sessions: Session[], currentSessionId?: string): Session[] {
  const result: Session[] = [];
  for (const session of sessions) {
    const existingIndex = result.findIndex((item) => areRelatedSidebarSessions(item, session));
    if (existingIndex < 0) {
      result.push(session);
      continue;
    }
    result[existingIndex] = preferSidebarSession(result[existingIndex], session, currentSessionId);
  }
  return result.sort(compareSessionsByRecentConversation);
}

interface SidebarProps {
  width?: number;
}

export function Sidebar({ width = 320 }: SidebarProps) {
  const currentProject = useAppStore((s) => s.currentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const creatingSessionProjectPath = useAppStore((s) => s.creatingSessionProjectPath);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const workspaceView = useAppStore((s) => s.workspaceView);
  const setWorkspaceView = useAppStore((s) => s.setWorkspaceView);
  const setLongTasksOpen = useAppStore((s) => s.setLongTasksOpen);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const setCreatingSessionProjectPath = useAppStore((s) => s.setCreatingSessionProjectPath);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const defaultPlanMode = useAppStore((s) => s.defaultPlanMode);
  const additionalWorkDirs = useAppStore((s) => s.additionalWorkDirs);
  const recentProjects = useSessionStore((s) => s.recentProjects);
  const setRecentProjects = useSessionStore((s) => s.setRecentProjects);
  const addSession = useSessionStore((s) => s.addSession);
  const sessions = useSessionStore((s) => s.sessions);
  const archiveSession = useArchiveSession();
  const updateSession = useSessionStore((s) => s.updateSession);

  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => new Set());
  const [openProjectMenu, setOpenProjectMenu] = useState<{ projectId: string; top: number; left: number } | null>(null);
  const [projectActionFocusId, setProjectActionFocusId] = useState<string | null>(null);
  const [sessionActionFocusId, setSessionActionFocusId] = useState<string | null>(null);
  const lastAutoExpandedProjectId = useRef<string | null>(null);
  const projectCatalogRefreshInFlightRef = useRef<Set<string>>(new Set());
  const pluginWorkspaceActive = workspaceView === "plugins" || workspaceView === "mcp";

  const toast = (message: string) => {
    window.dispatchEvent(new CustomEvent("kimix:toast", { detail: message }));
  };

  const toggleWorkspaceView = (view: "plugins" | "hooks" | "settings") => {
    const isSameView = view === "plugins"
      ? workspaceView === "plugins" || workspaceView === "mcp"
      : workspaceView === view;
    setWorkspaceView(isSameView ? "chat" : view);
  };

  const openPlugins = async () => {
    toggleWorkspaceView("plugins");
  };

  useEffect(() => {
    const close = () => setOpenProjectMenu(null);
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, []);

  useEffect(() => {
    if (!currentProject) {
      lastAutoExpandedProjectId.current = null;
      return;
    }
    if (lastAutoExpandedProjectId.current !== currentProject.id) {
      lastAutoExpandedProjectId.current = currentProject.id;
      setExpandedProjectIds((current) => new Set([...current, currentProject.id]));
    }
  }, [currentProject?.id]);

  useEffect(() => {
    for (const project of recentProjects) {
      if (!expandedProjectIds.has(project.id)) continue;
      const projectKey = normalizeProjectPath(project.path);
      if (!projectKey || projectCatalogRefreshInFlightRef.current.has(projectKey)) continue;

      projectCatalogRefreshInFlightRef.current.add(projectKey);
      void window.api.listKimiCodeSessions({ workDir: project.path }).then((res) => {
        if (!res.success) return;
        const hiddenHandoffSessionIds = new Set(getHiddenHandoffSessionIds());
        const catalogSessions = res.data.filter((session) => (
          !hiddenHandoffSessionIds.has(session.id) &&
          !isHiddenInternalSession(session)
        ));
        useSessionStore.setState((state) => ({
          sessions: reconcileOfficialSessionCatalog(state.sessions, catalogSessions, project.path, { source: res.source }),
        }));
      }).catch((err: unknown) => {
        reportError(err, { context: "refreshExpandedProjectSessions" });
      }).finally(() => {
        projectCatalogRefreshInFlightRef.current.delete(projectKey);
      });
    }
  }, [expandedProjectIds, recentProjects]);

  const currentSessionId = currentSession?.id;
  const currentSessionUpdatedAt = currentSession?.updatedAt;
  const currentSessionEventsLength = currentSession?.events.length;
  useEffect(() => {
    if (!currentSession || currentSession.archivedAt || isHiddenInternalSession(currentSession)) return;
    const existing = sessions.find((session) => session.id === currentSession.id);
    if (!existing) {
      addSession(currentSession);
      return;
    }
    const currentHasMoreEvents = currentSession.events.length > existing.events.length;
    const hasCurrentMetadataUpdate = currentSession.updatedAt >= existing.updatedAt && (
      existing.title !== currentSession.title ||
      existing.projectPath !== currentSession.projectPath ||
      existing.engine !== currentSession.engine ||
      existing.runtimeSessionId !== currentSession.runtimeSessionId ||
      existing.officialSessionId !== currentSession.officialSessionId ||
      existing.model !== currentSession.model ||
      existing.titleLocked !== currentSession.titleLocked ||
      existing.longTask !== currentSession.longTask ||
      existing.btwRounds !== currentSession.btwRounds ||
      existing.officialGoal !== currentSession.officialGoal ||
      existing.isLoading !== currentSession.isLoading
    );
    if (!currentHasMoreEvents && !hasCurrentMetadataUpdate) return;

    const nextSession = {
      ...(hasCurrentMetadataUpdate ? { ...existing, ...currentSession } : existing),
      events: currentHasMoreEvents ? currentSession.events : existing.events,
      updatedAt: Math.max(existing.updatedAt, currentSession.updatedAt),
    };

    if (
      nextSession.title === existing.title &&
      nextSession.projectPath === existing.projectPath &&
      nextSession.engine === existing.engine &&
      nextSession.runtimeSessionId === existing.runtimeSessionId &&
      nextSession.officialSessionId === existing.officialSessionId &&
      nextSession.model === existing.model &&
      nextSession.titleLocked === existing.titleLocked &&
      nextSession.longTask === existing.longTask &&
      nextSession.btwRounds === existing.btwRounds &&
      nextSession.officialGoal === existing.officialGoal &&
      nextSession.isLoading === existing.isLoading &&
      nextSession.events === existing.events &&
      nextSession.updatedAt === existing.updatedAt
    ) return;

    updateSession(currentSession.id, () => nextSession);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addSession, currentSessionId, currentSessionUpdatedAt, currentSessionEventsLength, sessions, updateSession]);

  const createSessionForProject = async (project: Project) => {
    if (useAppStore.getState().creatingSessionProjectPath) return;
    setCreatingSessionProjectPath(project.path);
    try {
      // 先在后端创建 runtime 会话，拿到真实 sessionId
      const runtimeRes = await window.api.startKimiCodeRuntime({
        workDir: project.path,
        thinking: defaultThinking,
        yoloMode: permissionMode === "yolo",
        autoMode: permissionMode === "auto",
        planMode: defaultPlanMode,
        additionalWorkDirs: normalizeAdditionalWorkDirs(additionalWorkDirs),
      });
      if (!runtimeRes.success) throw new Error(runtimeRes.error);

      const session: Session = {
        id: runtimeRes.data.sessionId,
        engine: "kimi-code" as const,
        model: runtimeRes.data.model ?? "kimi-for-coding",
        title: "新会话",
        projectPath: project.path,
        runtimeSessionId: runtimeRes.data.sessionId,
        officialSessionId: runtimeRes.data.sessionId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        events: [],
        isLoading: false,
      };
      addSession(session);
      setCurrentProject(project);
      setWorkspaceView("chat");
      setCurrentSession(session);
      setExpandedProjectIds((current) => new Set([...current, project.id]));
      } catch (err) {
        reportError(err, { context: "createSessionForProject", userVisible: true });
      } finally {
      setCreatingSessionProjectPath(null);
    }
  };

  const handleOpenProject = async () => {
    const res = await window.api.openProject();
    if (res.success && res.data) {
      const data = res.data;
      const existing = recentProjects.find((p) => p.path === data.path);
      const project = existing
        ? { ...existing, lastOpenedAt: Date.now() }
        : { ...data, id: crypto.randomUUID(), lastOpenedAt: Date.now() };
      setCurrentProject(project);
      await createSessionForProject(project);
      const recent = await window.api.listRecentProjects();
      if (recent.success) {
        setRecentProjects(recent.data);
      }
    }
  };

  const refreshRecentProjects = async () => {
    const recent = await window.api.listRecentProjects();
    if (recent.success) setRecentProjects(recent.data);
    return recent.success ? recent.data : recentProjects;
  };

  const pinProject = async (project: Project) => {
    setProjectActionFocusId(null);
    setOpenProjectMenu(null);
    const res = await window.api.setProjectPinned({ id: project.id, pinned: true });
    if (res.success) setRecentProjects(res.data);
    toast("已置顶项目");
  };

  const unpinProject = async (project: Project) => {
    setProjectActionFocusId(null);
    setOpenProjectMenu(null);
    const res = await window.api.setProjectPinned({ id: project.id, pinned: false });
    if (res.success) setRecentProjects(res.data);
    toast("已取消置顶项目");
  };

  const [dragProjectId, setDragProjectId] = useState<string | null>(null);
  // Insertion marker: shows a line above/below the hovered row to indicate where the drop lands.
  const [dropIndicator, setDropIndicator] = useState<{ id: string; position: "above" | "below" } | null>(null);

  const sameRegion = (id: string, pinned: boolean) =>
    (recentProjects.find((p) => p.id === id)?.pinned ?? false) === pinned;

  // Reorder within the same region (pinned-with-pinned, unpinned-with-unpinned).
  const handleProjectDrop = async () => {
    const sourceId = dragProjectId;
    const indicator = dropIndicator;
    setDragProjectId(null);
    setDropIndicator(null);
    if (!sourceId || !indicator || sourceId === indicator.id) return;
    const source = recentProjects.find((p) => p.id === sourceId);
    const target = recentProjects.find((p) => p.id === indicator.id);
    if (!source || !target || !!source.pinned !== !!target.pinned) return; // only reorder within same region

    const ordered = [...recentProjects];
    const fromIndex = ordered.findIndex((p) => p.id === sourceId);
    const [moved] = ordered.splice(fromIndex, 1);
    // Recompute target index after removal, then insert above/below the target row.
    const targetIndex = ordered.findIndex((p) => p.id === indicator.id);
    const insertAt = indicator.position === "below" ? targetIndex + 1 : targetIndex;
    ordered.splice(insertAt, 0, moved);

    setRecentProjects(ordered); // optimistic
    const res = await window.api.reorderProjects({ orderedIds: ordered.map((p) => p.id) });
    if (res.success) setRecentProjects(res.data);
  };

  const openProjectPath = async (project: Project) => {
    const res = await window.api.openProjectPath({ path: project.path });
    setOpenProjectMenu(null);
    toast(res.success ? "已在资源管理器中打开" : `打开失败：${res.error}`);
  };

  const archiveProjectSessions = async (project: Project) => {
    const targets = sessions.filter((session) => isSameProjectPath(session.projectPath, project.path) && !session.archivedAt && !isHiddenInternalSession(session));
    const results = await Promise.all(targets.map((session) => archiveSession(session.id)));
    const archivedIds = new Set(targets.filter((_, index) => results[index].success).map((session) => session.id));
    const archivedRuntimeIds = new Set(targets.filter((t) => archivedIds.has(t.id)).map((t) => t.runtimeSessionId).filter(Boolean));
    const failedCount = results.length - archivedIds.size;
    if (currentSession && archivedIds.has(currentSession.id)) {
      setCurrentSession(null);
    }
    // 批量归档运行中会话时清理 runningSessionId
    if (runningSessionId && (archivedIds.has(runningSessionId) || archivedRuntimeIds.has(runningSessionId))) {
      setRunningSessionId(null);
    }
    setOpenProjectMenu(null);
    if (targets.length === 0) toast("没有可归档的对话");
    else if (failedCount > 0) toast(`已归档 ${archivedIds.size} 个对话，${failedCount} 个失败`);
    else toast(`已归档 ${archivedIds.size} 个对话`);
  };

  const exportSessionArchive = async (sessionId: string, title: string) => {
    const target = sessions.find((session) => session.id === sessionId);
    if (target?.collaboration) {
      const agents = target.collaboration.agents
        .filter((agent) => !agent.removedAt)
        .map((agent) => ({
          roomAgentId: agent.id,
          displayName: agent.displayName,
          sessionId: getRoomAgentRuntimeId(target, agent.id),
        }))
        .filter((agent): agent is typeof agent & { sessionId: string } => Boolean(agent.sessionId));
      if (agents.length === 0) {
        toast("房间中没有可导出的官方 Agent 会话");
        return;
      }
      const res = await window.api.exportKimiCodeSession({ title, agents });
      if (!res.success) {
        toast(`导出失败：${res.error}`);
        return;
      }
      toast(res.data.path
        ? `已导出 ${res.data.selectedAgentName || "所选 Agent"} 的 Kimi 调试包`
        : "已取消导出");
      return;
    }
    const exportSessionId = target ? getRuntimeSessionId(target) : sessionId;
    if (!exportSessionId) {
      toast("没有找到可导出的官方会话");
      return;
    }
    const res = await window.api.exportKimiCodeSession({ sessionId: exportSessionId, title });
    if (!res.success) {
      toast(`导出失败：${res.error}`);
      return;
    }
    toast(res.data.path ? "已导出 Kimi 调试包" : "已取消导出");
  };

  const exportSessionMarkdown = async (sessionId: string) => {
    const target = sessions.find((session) => session.id === sessionId);
    if (!target) {
      toast("没有找到要导出的会话");
      return;
    }
    const res = await window.api.exportMarkdown({
      title: target.title,
      content: sessionToMarkdown(target),
    });
    if (!res.success) {
      toast(`导出失败：${res.error}`);
      return;
    }
    toast(res.data.path ? "已导出 Markdown" : "已取消导出");
  };

  const removeProject = async (project: Project) => {
    await window.api.removeRecentProject(project.id);
    const nextProjects = await refreshRecentProjects();
    if (currentProject?.id === project.id) {
      const nextProject = nextProjects.find((item) => item.id !== project.id) ?? null;
      setCurrentProject(nextProject);
      setCurrentSession(null);
      setExpandedProjectIds((current) => {
        const next = new Set(current);
        next.delete(project.id);
        if (nextProject?.id) next.add(nextProject.id);
        return next;
      });
    }
    setOpenProjectMenu(null);
    toast("已从侧栏移除项目");
  };

  const { visibleSessions, sessionsByProjectPath } = useMemo(() => {
    const rawVisible = currentSession && !sessions.some((session) => session.id === currentSession.id)
      ? [currentSession, ...sessions]
      : sessions;
    const visible = dedupeSidebarSessions(rawVisible, currentSession?.id);
    const byProject = new Map<string, Session[]>();
    for (const session of visible) {
      if (session.archivedAt || isHiddenInternalSession(session) || shouldHideOfficialSessionPlaceholder(session)) continue;
      const projectKey = normalizeProjectPath(session.projectPath);
      if (!projectKey) continue;
      const items = byProject.get(projectKey);
      if (items) items.push(session);
      else byProject.set(projectKey, [session]);
    }
    return { visibleSessions: visible, sessionsByProjectPath: byProject };
  }, [currentSession, sessions]);

  if (!sidebarOpen) {
    return (
      <aside
        className="kimix-sidebar shrink-0 bg-surface-ground"
        style={{ display: "flex", flexDirection: "column", width: 52, height: "100%", minHeight: 0, paddingLeft: 10, paddingRight: 2, paddingTop: 0, paddingBottom: 18 }}
      >
        <div className="flex flex-col" style={{ gap: 4 }}>
          <button
            onClick={async () => {
              if (currentProject) {
                setWorkspaceView("chat");
                await createSessionForProject(currentProject);
              }
            }}
            disabled={!currentProject || Boolean(creatingSessionProjectPath)}
            className={collapsedNavItemClass}
            style={collapsedNavButtonStyle}
            title={creatingSessionProjectPath ? "创建中" : "新对话"}
            aria-label={creatingSessionProjectPath ? "创建中" : "新对话"}
          >
            {creatingSessionProjectPath ? <Loader2 size={17} className="kimix-spin" /> : <SquarePen size={17} />}
          </button>
          <button
            onClick={() => setSearchOpen(true)}
            className={collapsedNavItemClass}
            style={collapsedNavButtonStyle}
            title="搜索"
            aria-label="搜索"
          >
            <Search size={17} />
          </button>
          <button
            onClick={() => void openPlugins()}
            className={`${collapsedNavItemClass} ${pluginWorkspaceActive ? "bg-surface-hover text-text-primary" : ""}`}
            style={collapsedNavButtonStyle}
            title="插件"
            aria-label="插件"
          >
            <LayoutGrid size={17} />
          </button>
          <button
            onClick={() => toggleWorkspaceView("hooks")}
            className={`${collapsedNavItemClass} ${workspaceView === "hooks" ? "bg-surface-hover text-text-primary" : ""}`}
            style={collapsedNavButtonStyle}
            title="Hooks"
            aria-label="Hooks"
          >
            <Webhook size={17} />
          </button>
          <button
            onClick={() => setLongTasksOpen(true)}
            className={collapsedNavItemClass}
            style={collapsedNavButtonStyle}
            title="长程任务"
            aria-label="长程任务"
          >
            <Clock size={17} />
          </button>
        </div>
        <div style={{ marginTop: "auto", height: 36 }}>
          <button
            onClick={() => toggleWorkspaceView("settings")}
            className={`${collapsedSettingsItemClass} ${workspaceView === "settings" ? "bg-surface-hover text-text-primary" : ""}`}
            style={collapsedSettingsButtonStyle}
            title="设置"
            aria-label="设置"
          >
            <Settings size={17} />
          </button>
        </div>
      </aside>
    );
  }

  const projectSessions = (projectPath: string) =>
    sessionsByProjectPath.get(normalizeProjectPath(projectPath)) ?? [];

  const loadSessionWithSkillParentFallback = async (session: Session) => {
    let loaded = await window.api.loadKimiCodeSession({
      workDir: session.projectPath,
      sessionId: getRuntimeSessionId(session) ?? session.id,
    });
    if (
      loaded.success &&
      Array.isArray(loaded.data.events) &&
      loaded.data.events.length === 0 &&
      session.skillForkParentSessionId &&
      (getRuntimeSessionId(session) ?? session.id).startsWith("skill-")
    ) {
      const fallbackLoaded = await window.api.loadKimiCodeSession({
        workDir: session.projectPath,
        sessionId: session.skillForkParentSessionId,
      });
      if (fallbackLoaded.success && Array.isArray(fallbackLoaded.data.events) && fallbackLoaded.data.events.length > 0) {
        loaded = fallbackLoaded;
      }
    }
    return loaded;
  };

  const syncProjectForSession = (session: { projectPath: string }) => {
    const project = recentProjects.find((item) => isSameProjectPath(item.path, session.projectPath));
    if (!project) return;
    setCurrentProject(project);
    setExpandedProjectIds((current) => new Set([...current, project.id]));
  };

  const selectSession = async (sessionId: string) => {
    const session = visibleSessions.find((s) => s.id === sessionId);
    if (!session) return;
    syncProjectForSession(session);
    setCurrentSession(session);
    const hasConversation = session.events.some((event) => event.type === "user_message" || event.type === "assistant_message");
    if (hasConversation && session.kimiHistoryCacheVersion === KIMI_HISTORY_CACHE_VERSION) {
      if (session.isLoading) {
        updateSession(session.id, (current) => ({ ...current, isLoading: false }));
        const updated = useSessionStore.getState().sessions.find((item) => item.id === session.id);
        if (updated) setCurrentSession(updated);
      }
      return;
    }

    const loaded = await loadSessionWithSkillParentFallback(session);
    if (!loaded.success) {
      updateSession(session.id, (current) => ({ ...current, isLoading: false }));
      const updated = useSessionStore.getState().sessions.find((item) => item.id === session.id);
      if (updated) setCurrentSession(updated);
      toast(`读取会话失败：${loaded.error}`);
      return;
    }
    const events = mapHistoryEvents(Array.isArray(loaded.data.events) ? loaded.data.events : []);
    if (isHiddenInternalSession({ ...session, events })) {
      deleteSession(session.id);
      if (currentSession?.id === session.id) {
        setCurrentSession(null);
      }
      return;
    }
    updateSession(session.id, (current) => {
      const hydratedEvents = !hasConversation ||
        hasRicherKimiProcessHistory(current.events, events) ||
        hasCanonicalKimiThinkingHistory(current.events, events)
        ? events
        : current.events;
      return {
        ...current,
        events: hydratedEvents,
        model: getLastUsedModelFromEvents(hydratedEvents) ?? current.model,
        kimiHistoryCacheVersion: KIMI_HISTORY_CACHE_VERSION,
        title: current.titleLocked || !isDefaultSessionTitle(current.title) ? current.title : deriveSessionTitle(
          hydratedEvents,
          current.title,
        ),
        isLoading: false,
      };
    });
    const updated = useSessionStore.getState().sessions.find((item) => item.id === session.id);
    if (updated) {
      syncProjectForSession(updated);
      setCurrentSession(updated);
    }
  };

  return (
    <aside style={{ width, paddingLeft: 12, paddingRight: 6 }} className="kimix-sidebar flex h-full shrink-0 select-none flex-col pb-2">
      <div className="no-drag space-y-1 px-2 pb-2">
        <button
          onClick={async () => {
            if (currentProject) {
              setWorkspaceView("chat");
              await createSessionForProject(currentProject);
            }
          }}
          disabled={!currentProject || Boolean(creatingSessionProjectPath)}
          className={navItemClass}
        >
          {creatingSessionProjectPath ? <Loader2 size={17} className="kimix-spin shrink-0 text-text-secondary" /> : <SquarePen size={17} className="shrink-0 text-text-secondary" />}
          <span>{creatingSessionProjectPath ? "创建中" : "新对话"}</span>
        </button>
        <button onClick={() => setSearchOpen(true)} className={navItemClass} title="搜索对话">
          <Search size={17} className="shrink-0 text-text-secondary" />
          <span>搜索</span>
        </button>
        <button
          onClick={() => void openPlugins()}
          className={`${navItemClass} ${pluginWorkspaceActive ? "bg-surface-hover text-text-primary" : ""}`}
          title="插件"
        >
          <LayoutGrid size={17} className="shrink-0 text-text-secondary" />
          <span>插件</span>
        </button>
        <button
          onClick={() => toggleWorkspaceView("hooks")}
          className={`${navItemClass} ${workspaceView === "hooks" ? "bg-surface-hover text-text-primary" : ""}`}
          title="Hooks"
        >
          <Webhook size={17} className="shrink-0 text-text-secondary" />
          <span>Hooks</span>
        </button>
        <button onClick={() => setLongTasksOpen(true)} className={navItemClass} title="长程任务">
          <span className="flex items-center gap-3">
            <Clock size={17} className="shrink-0 text-text-secondary" />
            <span>长程任务</span>
          </span>
        </button>
      </div>

      <div className="kimix-stable-scrollbar min-h-0 flex-1 overflow-y-auto pt-2" style={{ paddingLeft: 2, paddingRight: 4, marginRight: -6, scrollbarGutter: "stable" }}>
        <div className="mb-2 flex items-center justify-between px-3">
          <span className="text-[13px] font-medium text-text-muted">项目</span>
          <button
            onClick={handleOpenProject}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
            title="打开项目"
            aria-label="打开项目"
          >
            <Plus size={14} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {recentProjects.map((project, projectIndex) => {
                    const isExpanded = expandedProjectIds.has(project.id);
                    const isActive = currentProject?.id === project.id;
                    const isPinned = project.pinned ?? false;
                    const pSessions = projectSessions(project.path);
                    const prev = recentProjects[projectIndex - 1];
                    const showRegionDivider = !isPinned && (prev?.pinned ?? false);
                    const isDragging = dragProjectId === project.id;
                    const canDropHere = dragProjectId !== null && dragProjectId !== project.id && sameRegion(dragProjectId, isPinned);
                    const showLineAbove = canDropHere && dropIndicator?.id === project.id && dropIndicator.position === "above";
                    const showLineBelow = canDropHere && dropIndicator?.id === project.id && dropIndicator.position === "below";

                    return (
                      <section
                        key={project.id}
                        style={{
                          position: "relative",
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                          marginTop: showRegionDivider ? 6 : 0,
                          borderTop: showRegionDivider ? "1px solid var(--kimix-panel-divider, rgba(127,127,127,0.18))" : undefined,
                          paddingTop: showRegionDivider ? 12 : 0,
                          opacity: isDragging ? 0.4 : 1,
                        }}
                        draggable
                        onDragStart={(e) => { setDragProjectId(project.id); e.dataTransfer.effectAllowed = "move"; }}
                        onDragEnd={() => { setDragProjectId(null); setDropIndicator(null); }}
                        onDragOver={(e) => {
                          if (!dragProjectId || dragProjectId === project.id || !sameRegion(dragProjectId, isPinned)) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          const rect = e.currentTarget.getBoundingClientRect();
                          const position = e.clientY < rect.top + rect.height / 2 ? "above" : "below";
                          setDropIndicator((cur) => (cur?.id === project.id && cur.position === position ? cur : { id: project.id, position }));
                        }}
                        onDrop={(e) => { e.preventDefault(); void handleProjectDrop(); }}
                      >
                        {showLineAbove && (
                          <div aria-hidden style={{ position: "absolute", left: 12, right: 12, top: showRegionDivider ? 6 : -5, height: 2, borderRadius: 2, background: "var(--accent-blue)", zIndex: 10 }} />
                        )}
                        {showLineBelow && (
                          <div aria-hidden style={{ position: "absolute", left: 12, right: 12, bottom: -5, height: 2, borderRadius: 2, background: "var(--accent-blue)", zIndex: 10 }} />
                        )}
                        <div
                          className={`kimix-sidebar-project-row group/project relative flex h-9 w-full items-center text-[15px] ${
                            isActive
                              ? "bg-surface-hover text-text-primary"
                              : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                          }`}
                        >
                          <button
                            onClick={() => {
                              setProjectActionFocusId(null);
                              if (isExpanded) lastAutoExpandedProjectId.current = project.id;
                              setExpandedProjectIds((current) => {
                                const next = new Set(current);
                                if (next.has(project.id)) next.delete(project.id);
                                else next.add(project.id);
                                return next;
                              });
                            }}
                            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                          >
                            <FolderOpen size={16} className="shrink-0 text-text-muted" />
                            <span className="min-w-0 flex-1 truncate">{displayProjectName(project, "未命名项目")}</span>
                          </button>
                          <div
                            className={`kimix-sidebar-project-row-actions flex shrink-0 items-center transition-opacity ${
                              projectActionFocusId === project.id ? "opacity-100" : "opacity-0 group-hover/project:opacity-100"
                            }`}
                            style={{ gap: 0 }}
                            onFocusCapture={() => setProjectActionFocusId(project.id)}
                            onBlurCapture={(e) => {
                              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setProjectActionFocusId(null);
                            }}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                void (isPinned ? unpinProject(project) : pinProject(project));
                              }}
                              className="kimix-sidebar-icon-action flex items-center justify-center text-text-muted hover:bg-surface-hover hover:text-text-primary"
                              title={isPinned ? "取消置顶项目" : "置顶项目"}
                              aria-label={isPinned ? "取消置顶项目" : "置顶项目"}
                            >
                              <Pin size={14} fill={isPinned ? "currentColor" : "none"} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const rect = e.currentTarget.getBoundingClientRect();
                                const menuWidth = 192;
                                setOpenProjectMenu((current) =>
                                  current?.projectId === project.id
                                    ? null
                                    : { projectId: project.id, top: rect.top, bottom: rect.bottom, left: Math.max(4, rect.right - menuWidth) }
                                );
                              }}
                              className="kimix-sidebar-icon-action flex items-center justify-center text-text-muted hover:bg-surface-hover hover:text-text-primary"
                              title="项目菜单"
                              aria-label="项目菜单"
                            >
                              <MoreHorizontal size={15} />
                            </button>
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                setCurrentProject(project);
                                setExpandedProjectIds((current) => new Set([...current, project.id]));
                                await createSessionForProject(project);
                              }}
                              disabled={Boolean(creatingSessionProjectPath)}
                              className="kimix-sidebar-icon-action flex items-center justify-center text-text-muted hover:bg-surface-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
                              title="在该项目下新对话"
                              aria-label="在该项目下新对话"
                            >
                              {creatingSessionProjectPath === project.path ? <Loader2 size={15} className="kimix-spin" /> : <SquarePen size={15} />}
                            </button>
                          </div>
                          {openProjectMenu?.projectId === project.id && createPortal(
                            (() => {
                              const menuHeight = 246;
                              const menuTop = openProjectMenu.bottom + 4 + menuHeight > window.innerHeight
                                ? Math.max(4, openProjectMenu.top - menuHeight - 4)
                                : openProjectMenu.bottom + 4;
                              return (
                                <div
                                  className="w-48 rounded-xl border border-border-subtle bg-surface-elevated py-1.5 text-[13px] text-text-primary shadow-floating-token"
                                  style={{
                                    position: "fixed",
                                    top: menuTop,
                                    left: openProjectMenu.left,
                                    width: 192,
                                    zIndex: 100,
                                  }}
                                  onMouseDown={(e) => e.stopPropagation()}
                                >
                                  <button onClick={() => void (isPinned ? unpinProject(project) : pinProject(project))} className="flex h-10 w-full items-center gap-3 text-left transition-colors hover:bg-surface-hover" style={{ paddingLeft: 18, paddingRight: 18 }}>
                                    <Pin size={14} className="text-text-secondary" />
                                    <span>{isPinned ? "取消置顶" : "置顶项目"}</span>
                                  </button>
                                  <button onClick={() => void openProjectPath(project)} className="flex h-10 w-full items-center gap-3 text-left transition-colors hover:bg-surface-hover" style={{ paddingLeft: 18, paddingRight: 18 }}>
                                    <FolderSearch size={14} className="text-text-secondary" />
                                    <span>在资源管理器中打开</span>
                                  </button>
                                  <button onClick={() => { setOpenProjectMenu(null); toast("待实现"); }} className="flex h-10 w-full items-center gap-3 text-left transition-colors hover:bg-surface-hover" style={{ paddingLeft: 18, paddingRight: 18 }}>
                                    <GitBranch size={14} className="text-text-secondary" />
                                    <span>创建永久工作树</span>
                                  </button>
                                  <button onClick={() => { setOpenProjectMenu(null); toast("待实现"); }} className="flex h-10 w-full items-center gap-3 text-left transition-colors hover:bg-surface-hover" style={{ paddingLeft: 18, paddingRight: 18 }}>
                                    <SquarePen size={14} className="text-text-secondary" />
                                    <span>重命名项目</span>
                                  </button>
                                  <button onClick={() => void archiveProjectSessions(project)} className="flex h-10 w-full items-center gap-3 text-left transition-colors hover:bg-surface-hover" style={{ paddingLeft: 18, paddingRight: 18 }}>
                                    <Archive size={14} className="text-text-secondary" />
                                    <span>归档对话</span>
                                  </button>
                                  <button onClick={() => void removeProject(project)} className="flex h-10 w-full items-center gap-3 text-left text-accent-danger transition-colors hover:bg-accent-danger-light" style={{ paddingLeft: 18, paddingRight: 18 }}>
                                    <X size={14} />
                                    <span>移除</span>
                                  </button>
                                </div>
                              );
                            })(),
                            document.body
                          )}
                        </div>

                        {isExpanded && pSessions.length > 0 && (
                          <div
                            style={{
                              paddingLeft: 20,
                              paddingRight: 4,
                              display: "flex",
                              flexDirection: "column",
                              gap: 2,
                            }}
                          >
                            {pSessions.map((s) => {
                              const isSessionBusy = isSessionSidebarBusy(s, runningSessionId, currentSession?.id);
                              const isLongTaskSession = Boolean(s.longTask);

                              return (
                                <div
                                  key={s.id}
                                  style={{ paddingLeft: 16, paddingRight: 10 }}
                                  className={`group flex h-8 items-center gap-2 rounded-lg text-[14px] transition-colors ${
                                    currentSession?.id === s.id
                                      ? isLongTaskSession
                                        ? "bg-accent-primary-light text-accent-primary-dark"
                                        : "bg-surface-hover text-text-primary"
                                      : isLongTaskSession
                                        ? "bg-accent-primary-light/60 text-accent-primary hover:bg-accent-primary-light hover:text-accent-primary-dark"
                                        : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                                  }`}
                                >
                                  <button
                                    onClick={() => {
                                      setSessionActionFocusId(null);
                                      setWorkspaceView("chat");
                                      void selectSession(s.id);
                                    }}
                                    className="min-w-0 flex-1 truncate text-left"
                                  >
                                    {s.title}
                                  </button>
                                  <div className="relative h-7 w-[80px] shrink-0">
                                    <span className={`absolute inset-0 flex items-center justify-end text-[12px] text-text-muted transition-opacity ${sessionActionFocusId === s.id ? "opacity-0" : "group-hover:opacity-0"}`}>
                                      {isSessionBusy ? (
                                        <Loader2 size={14} className="animate-spin text-text-muted" aria-label="会话正在运行" />
                                      ) : (
                                        formatRelativeTime(getSessionConversationActivityAt(s))
                                      )}
                                    </span>
                                    <div
                                      className={`absolute inset-0 flex items-center justify-end transition-opacity ${sessionActionFocusId === s.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                                      style={{ gap: 1 }}
                                      onFocusCapture={() => setSessionActionFocusId(s.id)}
                                      onBlurCapture={(e) => {
                                        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSessionActionFocusId(null);
                                      }}
                                    >
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void exportSessionMarkdown(s.id);
                                        }}
                                        className="kimix-inline-icon-action text-text-muted hover:bg-surface-hover hover:text-text-primary"
                                        style={{ width: 26, height: 26, flexBasis: 26 }}
                                        title="导出 Markdown"
                                        aria-label="导出 Markdown"
                                      >
                                        <FileText size={13} />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void exportSessionArchive(s.id, s.title);
                                        }}
                                        className="kimix-inline-icon-action text-text-muted hover:bg-surface-hover hover:text-text-primary"
                                        style={{ width: 26, height: 26, flexBasis: 26 }}
                                        title="导出 Kimi 调试包"
                                        aria-label="导出 Kimi 调试包"
                                      >
                                        <Download size={13} />
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void archiveSession(s.id).then((result) => {
                                            if (result.outcomes?.length) {
                                              toast(`房间${formatRoomLifecycleOutcomes("archive", result.outcomes)}`);
                                              if (!result.success) return;
                                            }
                                            if (!result.success) {
                                              toast(`归档失败：${result.error}`);
                                              return;
                                            }
                                            if (currentSession?.id === s.id) {
                                              setCurrentSession(null);
                                            }
                                            // 归档运行中会话时清理 runningSessionId
                                            if (runningSessionId === s.id || runningSessionId === s.runtimeSessionId) {
                                              setRunningSessionId(null);
                                            }
                                            if (!result.outcomes?.length) toast("已归档对话");
                                          });
                                        }}
                                        className="kimix-inline-icon-action text-text-muted hover:bg-accent-danger/10 hover:text-accent-danger"
                                        style={{ width: 26, height: 26, flexBasis: 26 }}
                                        title="归档会话"
                                        aria-label="归档会话"
                                      >
                                        <Archive size={13} />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </section>
                    );
          })}
        </div>

        {recentProjects.length === 0 && !currentProject && (
          <div className="px-3 py-8 text-center text-[13px] text-text-muted">
            尚未选择项目
          </div>
        )}

      </div>

      <div className="px-2 pt-2" style={{ paddingBottom: 10 }}>
        <button
          onClick={() => toggleWorkspaceView("settings")}
          className={`kimix-settings-entry flex w-full items-center gap-3 rounded-lg text-[16px] text-text-primary transition-colors ${workspaceView === "settings" ? "bg-surface-hover" : ""}`}
          style={{ height: 36 }}
        >
          <Settings size={18} className="text-text-secondary" />
          <span>设置</span>
          <span className="ml-auto shrink-0 text-[13px] text-text-muted">v2.15.38</span>
        </button>
      </div>
    </aside>
  );
}
