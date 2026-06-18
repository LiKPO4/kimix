import { SquarePen, Settings, FolderOpen, Search, LayoutGrid, Clock, MoreHorizontal, Pin, Archive, X, FolderSearch, GitBranch, Loader2, Plus, Webhook, Download, FileText } from "lucide-react";
import { useState, useEffect, useMemo, useRef } from "react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Project, Session } from "@/types/ui";
import { mapHistoryEvents } from "@/utils/eventMapper";
import { deriveSessionTitle } from "@/utils/sessionTitle";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import { sessionToMarkdown } from "@/utils/markdownExport";
import { displayProjectName } from "@/utils/projectDisplay";
import { getRuntimeSessionId } from "@/utils/runtimeSession";
import { isSessionRuntimeRunning } from "@/utils/sessionActivity";

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
  return (path ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isSameProjectPath(a: string | undefined, b: string | undefined) {
  const left = normalizeProjectPath(a);
  const right = normalizeProjectPath(b);
  return Boolean(left && right && left === right);
}

function isSidebarSessionBusy(session: Session, runningSessionId: string | null) {
  return Boolean(
    session.isLoading ||
    isSessionRuntimeRunning(session, runningSessionId)
  );
}

interface SidebarProps {
  width?: number;
}

export function Sidebar({ width = 320 }: SidebarProps) {
  const currentProject = useAppStore((s) => s.currentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const creatingSessionProjectPath = useAppStore((s) => s.creatingSessionProjectPath);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const workspaceView = useAppStore((s) => s.workspaceView);
  const setWorkspaceView = useAppStore((s) => s.setWorkspaceView);
  const setLongTasksOpen = useAppStore((s) => s.setLongTasksOpen);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const setCreatingSessionProjectPath = useAppStore((s) => s.setCreatingSessionProjectPath);
  const recentProjects = useSessionStore((s) => s.recentProjects);
  const setRecentProjects = useSessionStore((s) => s.setRecentProjects);
  const addSession = useSessionStore((s) => s.addSession);
  const sessions = useSessionStore((s) => s.sessions);
  const archiveSession = useSessionStore((s) => s.archiveSession);
  const updateSession = useSessionStore((s) => s.updateSession);

  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => new Set());
  const [openProjectMenu, setOpenProjectMenu] = useState<string | null>(null);
  const lastAutoExpandedProjectId = useRef<string | null>(null);
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
    return () => document.removeEventListener("mousedown", close);
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
  }, [addSession, currentSession, sessions, updateSession]);

  const createSessionForProject = async (project: Project) => {
    if (useAppStore.getState().creatingSessionProjectPath) return;
    setCreatingSessionProjectPath(project.path);
    try {
      let model = "kimi-for-coding";
      try {
        const modelRes = await window.api.getKimiModelConfig();
        if (modelRes.success) model = modelRes.data.defaultModel?.trim() || model;
      } catch {
        // Keep the official built-in default.
      }
      const session = {
        id: crypto.randomUUID(),
        engine: "kimi-code" as const,
        model,
        title: "新会话",
        projectPath: project.path,
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
    setOpenProjectMenu(null);
    const res = await window.api.setProjectPinned({ id: project.id, pinned: true });
    if (res.success) setRecentProjects(res.data);
    toast("已置顶项目");
  };

  const unpinProject = async (project: Project) => {
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

  const archiveProjectSessions = (project: Project) => {
    const targets = sessions.filter((session) => isSameProjectPath(session.projectPath, project.path) && !session.archivedAt && !isHiddenInternalSession(session));
    targets.forEach((session) => archiveSession(session.id));
    if (currentSession && isSameProjectPath(currentSession.projectPath, project.path)) {
      setCurrentSession(null);
    }
    setOpenProjectMenu(null);
    toast(targets.length > 0 ? `已归档 ${targets.length} 个对话` : "没有可归档的对话");
  };

  const exportSessionArchive = async (sessionId: string, title: string) => {
    const target = sessions.find((session) => session.id === sessionId);
    const exportSessionId = target ? getRuntimeSessionId(target) : sessionId;
    if (!exportSessionId) {
      toast("没有找到可导出的官方会话");
      return;
    }
    const res = await window.api.exportSession({ sessionId: exportSessionId, title });
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

  const { visibleSessions, sessionsByProjectPath } = useMemo(() => {
    const visible = currentSession && !sessions.some((session) => session.id === currentSession.id)
      ? [currentSession, ...sessions]
      : sessions;
    const byProject = new Map<string, Session[]>();
    for (const session of visible) {
      if (session.archivedAt || isHiddenInternalSession(session)) continue;
      const projectKey = normalizeProjectPath(session.projectPath);
      if (!projectKey) continue;
      const items = byProject.get(projectKey);
      if (items) items.push(session);
      else byProject.set(projectKey, [session]);
    }
    return { visibleSessions: visible, sessionsByProjectPath: byProject };
  }, [currentSession, sessions]);

  const projectSessions = (projectPath: string) =>
    sessionsByProjectPath.get(normalizeProjectPath(projectPath)) ?? [];

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
    if (session.events.some((event) => event.type === "user_message" || event.type === "assistant_message")) return;

    const loaded = await window.api.loadSession({
      workDir: session.projectPath,
      sessionId: getRuntimeSessionId(session) ?? session.id,
    });
    if (!loaded.success) return;
    const events = mapHistoryEvents(Array.isArray(loaded.data.events) ? loaded.data.events : []);
    if (isHiddenInternalSession({ ...session, events })) {
      deleteSession(session.id);
      return;
    }
    updateSession(session.id, (current) => ({
      ...current,
      events,
      title: current.titleLocked ? current.title : deriveSessionTitle(events, current.title),
      isLoading: false,
      updatedAt: Date.now(),
    }));
    const updated = useSessionStore.getState().sessions.find((item) => item.id === session.id);
    if (updated) {
      syncProjectForSession(updated);
      setCurrentSession(updated);
    }
  };

  return (
    <aside style={{ width, paddingLeft: 12, paddingRight: 10 }} className="kimix-sidebar flex h-full shrink-0 select-none flex-col pb-2">
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

      <div className="kimix-stable-scrollbar min-h-0 flex-1 overflow-y-auto pt-2" style={{ paddingLeft: 8, paddingRight: 16, marginRight: -8, scrollbarGutter: "stable" }}>
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

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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
                          gap: 8,
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
                          style={{ paddingLeft: 20, paddingRight: 10 }}
                          className={`group/project relative flex h-9 w-full items-center gap-1 rounded-lg text-[15px] transition-colors ${
                            isActive
                              ? "bg-surface-hover text-text-primary"
                              : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                          }`}
                        >
                          <button
                            onClick={async () => {
                              if (isExpanded) lastAutoExpandedProjectId.current = project.id;
                              if (!isActive) {
                                setCurrentProject(project);
                                const latestSession = [...pSessions].sort((a, b) => b.updatedAt - a.updatedAt)[0];
                                if (latestSession) {
                                  setWorkspaceView("chat");
                                  void selectSession(latestSession.id);
                                } else {
                                  setCurrentSession(null);
                                }
                              } else {
                                // Only toggle expansion when clicking the already-active project.
                                // Clicking an expanded-but-inactive project should just select it.
                                setExpandedProjectIds((current) => {
                                  const next = new Set(current);
                                  if (isExpanded) next.delete(project.id);
                                  else next.add(project.id);
                                  return next;
                                });
                                if (!isExpanded && pSessions.length === 0 && !useAppStore.getState().creatingSessionProjectPath) {
                                  await createSessionForProject(project);
                                }
                              }
                            }}
                            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                          >
                            <FolderOpen size={16} className="shrink-0 text-text-muted" />
                            <span className="min-w-0 flex-1 truncate">{displayProjectName(project, "未命名项目")}</span>
                            {isPinned && <Pin size={12} className="shrink-0 text-text-muted" fill="currentColor" />}
                          </button>
                          <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/project:opacity-100">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenProjectMenu((current) => current === project.id ? null : project.id);
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
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
                              className="flex h-9 w-9 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-60"
                              title="在该项目下新对话"
                              aria-label="在该项目下新对话"
                            >
                              {creatingSessionProjectPath === project.path ? <Loader2 size={15} className="kimix-spin" /> : <SquarePen size={15} />}
                            </button>
                          </div>
                          {openProjectMenu === project.id && (
                            <div
                              className="absolute right-1 top-8 z-40 w-48 rounded-xl border border-border-subtle bg-surface-elevated py-1.5 text-[13px] text-text-primary shadow-floating-token"
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
                              <button onClick={() => archiveProjectSessions(project)} className="flex h-10 w-full items-center gap-3 text-left transition-colors hover:bg-surface-hover" style={{ paddingLeft: 18, paddingRight: 18 }}>
                                <Archive size={14} className="text-text-secondary" />
                                <span>归档对话</span>
                              </button>
                              <button onClick={() => void removeProject(project)} className="flex h-10 w-full items-center gap-3 text-left text-accent-danger transition-colors hover:bg-accent-danger-light" style={{ paddingLeft: 18, paddingRight: 18 }}>
                                <X size={14} />
                                <span>移除</span>
                              </button>
                            </div>
                          )}
                        </div>

                        {isExpanded && pSessions.length > 0 && (
                          <div
                            style={{
                              paddingLeft: 20,
                              paddingRight: 4,
                              display: "flex",
                              flexDirection: "column",
                              gap: 5,
                            }}
                          >
                            {pSessions.map((s) => {
                              const isSessionBusy = isSidebarSessionBusy(s, runningSessionId);
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
                                      setWorkspaceView("chat");
                                      void selectSession(s.id);
                                    }}
                                    className="min-w-0 flex-1 truncate text-left"
                                  >
                                    {s.title}
                                  </button>
                                  <span className="flex h-5 min-w-[34px] shrink-0 items-center justify-end text-[12px] text-text-muted">
                                    {isSessionBusy ? (
                                      <Loader2 size={14} className="animate-spin text-text-muted" aria-label="会话正在运行" />
                                    ) : (
                                      formatRelativeTime(s.updatedAt)
                                    )}
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void exportSessionMarkdown(s.id);
                                    }}
                                    className="rounded p-0.5 text-text-muted opacity-0 transition-all hover:bg-surface-hover hover:text-text-primary group-hover:opacity-100"
                                    title="导出 Markdown"
                                    aria-label="导出 Markdown"
                                  >
                                    <FileText size={11} />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void exportSessionArchive(s.id, s.title);
                                    }}
                                    className="rounded p-0.5 text-text-muted opacity-0 transition-all hover:bg-surface-hover hover:text-text-primary group-hover:opacity-100"
                                    title="导出 Kimi 调试包"
                                    aria-label="导出 Kimi 调试包"
                                  >
                                    <Download size={11} />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      archiveSession(s.id);
                                      if (currentSession?.id === s.id) {
                                        setCurrentSession(null);
                                      }
                                    }}
                                    className="rounded p-0.5 text-text-muted opacity-0 transition-all hover:bg-accent-danger/10 hover:text-accent-danger group-hover:opacity-100"
                                    title="归档会话"
                                    aria-label="归档会话"
                                  >
                                    <Archive size={11} />
                                  </button>
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
          <span className="ml-auto text-[13px] text-text-muted">v2.9.154</span>
        </button>
      </div>
    </aside>
  );
}
