import { SquarePen, Settings, FolderOpen, ChevronRight, Search, LayoutGrid, Clock, MoreHorizontal, Pin, Archive, X, FolderSearch, GitBranch, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Project } from "@/types/ui";
import { mapHistoryEvents } from "@/utils/eventMapper";
import { deriveSessionTitle } from "@/utils/sessionTitle";

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

const navItemClass = "kimix-sidebar-nav-item flex h-10 w-full items-center rounded-xl text-[15px] text-[#302d28] transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const collapsedNavItemClass = "flex h-9 w-9 items-center justify-center rounded-xl text-[#706b63] transition-colors hover:bg-black/5 hover:text-[#26231f] disabled:cursor-not-allowed disabled:opacity-40";

export function Sidebar() {
  const currentProject = useAppStore((s) => s.currentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const creatingSessionProjectPath = useAppStore((s) => s.creatingSessionProjectPath);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const setSkillsOpen = useAppStore((s) => s.setSkillsOpen);
  const setLongTasksOpen = useAppStore((s) => s.setLongTasksOpen);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const setCreatingSessionProjectPath = useAppStore((s) => s.setCreatingSessionProjectPath);

  const recentProjects = useSessionStore((s) => s.recentProjects);
  const setRecentProjects = useSessionStore((s) => s.setRecentProjects);
  const addSession = useSessionStore((s) => s.addSession);
  const sessions = useSessionStore((s) => s.sessions);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const archiveSession = useSessionStore((s) => s.archiveSession);
  const updateSession = useSessionStore((s) => s.updateSession);

  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [openProjectMenu, setOpenProjectMenu] = useState<string | null>(null);

  const toast = (message: string) => {
    window.dispatchEvent(new CustomEvent("kimix:toast", { detail: message }));
  };

  useEffect(() => {
    const close = () => setOpenProjectMenu(null);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (currentProject) {
      setExpandedProject(currentProject.id);
    }
  }, [currentProject]);

  const createSessionForProject = async (project: Project) => {
    if (useAppStore.getState().creatingSessionProjectPath) return;
    const previousSession = useAppStore.getState().currentSession;
    const placeholder = {
      id: `creating-${crypto.randomUUID()}`,
      title: "正在创建新会话",
      projectPath: project.path,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      events: [],
      isLoading: true,
    };
    setCreatingSessionProjectPath(project.path);
    addSession(placeholder);
    setCurrentProject(project);
    setCurrentSession(placeholder);
    setExpandedProject(project.id);
    try {
      const sessionRes = await window.api.startSession({
        workDir: project.path,
        model: "kimi-code/kimi-for-coding",
        thinking: defaultThinking,
        yoloMode: permissionMode === "yolo",
      });
      if (!sessionRes.success) {
        deleteSession(placeholder.id);
        setCurrentSession(previousSession?.id === placeholder.id ? null : previousSession);
        return;
      }
      const session = {
        ...placeholder,
        id: sessionRes.data.sessionId,
        title: "新会话",
        updatedAt: Date.now(),
        isLoading: false,
      };
      updateSession(placeholder.id, () => session);
      setCurrentSession(session);
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
    await window.api.addRecentProject({ ...project, lastOpenedAt: Date.now() });
    await refreshRecentProjects();
    setOpenProjectMenu(null);
    toast("已置顶项目");
  };

  const unpinProject = async (project: Project) => {
    const nextProject = recentProjects.find((item) => item.path !== project.path);
    setOpenProjectMenu(null);
    if (!nextProject) {
      toast("只有一个项目，无法取消置顶");
      return;
    }
    await window.api.addRecentProject({ ...nextProject, lastOpenedAt: Date.now() });
    await refreshRecentProjects();
    toast("已取消置顶项目");
  };

  const openProjectPath = async (project: Project) => {
    const res = await window.api.openProjectPath({ path: project.path });
    setOpenProjectMenu(null);
    toast(res.success ? "已在资源管理器中打开" : `打开失败：${res.error}`);
  };

  const archiveProjectSessions = (project: Project) => {
    const targets = sessions.filter((session) => session.projectPath === project.path && !session.archivedAt);
    targets.forEach((session) => archiveSession(session.id));
    if (currentSession && currentSession.projectPath === project.path) {
      setCurrentSession(null);
    }
    setOpenProjectMenu(null);
    toast(targets.length > 0 ? `已归档 ${targets.length} 个对话` : "没有可归档的对话");
  };

  const removeProject = async (project: Project) => {
    await window.api.removeRecentProject(project.id);
    const nextProjects = await refreshRecentProjects();
    if (currentProject?.id === project.id) {
      const nextProject = nextProjects.find((item) => item.id !== project.id) ?? null;
      setCurrentProject(nextProject);
      setCurrentSession(null);
      setExpandedProject(nextProject?.id ?? null);
    }
    setOpenProjectMenu(null);
    toast("已从侧栏移除项目");
  };

  if (!sidebarOpen) {
    return (
      <aside className="flex w-[52px] shrink-0 flex-col items-start bg-[#f6f4ef]" style={{ paddingLeft: 12, paddingRight: 4, paddingTop: 12, gap: 8 }}>
        <button
          onClick={async () => {
            if (currentProject) {
              await createSessionForProject(currentProject);
            }
          }}
          disabled={!currentProject || Boolean(creatingSessionProjectPath)}
          className={collapsedNavItemClass}
          title={creatingSessionProjectPath ? "创建中" : "新对话"}
          aria-label={creatingSessionProjectPath ? "创建中" : "新对话"}
        >
          {creatingSessionProjectPath ? <Loader2 size={17} className="kimix-spin" /> : <SquarePen size={17} />}
        </button>
        <button
          onClick={() => setSearchOpen(true)}
          className={collapsedNavItemClass}
          title="搜索"
          aria-label="搜索"
        >
          <Search size={17} />
        </button>
        <button
          onClick={() => setSkillsOpen(true)}
          className={collapsedNavItemClass}
          title="技能"
          aria-label="技能"
        >
          <LayoutGrid size={17} />
        </button>
      </aside>
    );
  }

  const projectSessions = (projectPath: string) =>
    sessions.filter((s) => s.projectPath === projectPath && !s.archivedAt);

  const selectSession = async (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    setCurrentSession(session);
    if (session.events.some((event) => event.type === "user_message" || event.type === "assistant_message")) return;

    const loaded = await window.api.loadSession({
      workDir: session.projectPath,
      sessionId: session.id,
    });
    if (!loaded.success) return;
    const events = mapHistoryEvents(Array.isArray(loaded.data.events) ? loaded.data.events : []);
    updateSession(session.id, (current) => ({
      ...current,
      events,
      title: deriveSessionTitle(events, current.title),
      isLoading: false,
      updatedAt: Date.now(),
    }));
  };

  return (
    <aside style={{ paddingLeft: 12, paddingRight: 10 }} className="flex h-full w-[320px] shrink-0 select-none flex-col bg-[#f6f4ef] pb-2">
      <div className="no-drag space-y-1 px-2 pb-2">
        <button
          onClick={async () => {
            if (currentProject) {
              await createSessionForProject(currentProject);
            }
          }}
          disabled={!currentProject || Boolean(creatingSessionProjectPath)}
          className={navItemClass}
        >
          {creatingSessionProjectPath ? <Loader2 size={17} className="kimix-spin shrink-0 text-[#706b63]" /> : <SquarePen size={17} className="shrink-0 text-[#706b63]" />}
          <span>{creatingSessionProjectPath ? "创建中" : "新对话"}</span>
        </button>
        <button onClick={() => setSearchOpen(true)} className={navItemClass} title="搜索对话">
          <Search size={17} className="shrink-0 text-[#706b63]" />
          <span>搜索</span>
        </button>
        <button onClick={() => setSkillsOpen(true)} className={navItemClass} title="技能">
          <LayoutGrid size={17} className="shrink-0 text-[#706b63]" />
          <span>技能</span>
        </button>
        <button onClick={() => setLongTasksOpen(true)} className={navItemClass} title="长程任务">
          <span className="flex items-center gap-3">
            <Clock size={17} className="shrink-0 text-[#706b63]" />
            <span>长程任务</span>
          </span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-2">
        <div className="mb-2 flex items-center justify-between px-3">
          <span className="text-[13px] font-medium text-[#8a847a]">项目</span>
          <button
            onClick={handleOpenProject}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[#8a847a] transition-colors hover:bg-black/5 hover:text-[#26231f]"
            title="打开项目"
            aria-label="打开项目"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {recentProjects.map((project) => {
            const isExpanded = expandedProject === project.id;
            const isActive = currentProject?.id === project.id;
            const isPinned = recentProjects[0]?.path === project.path;
            const pSessions = projectSessions(project.path);

            return (
              <section
                key={project.id}
                style={{ display: "flex", flexDirection: "column", gap: 8 }}
              >
                <div
                  style={{ paddingLeft: 20, paddingRight: 10 }}
                  className={`group/project relative flex h-9 w-full items-center gap-1 rounded-xl pl-3 pr-1 text-[15px] transition-colors ${
                    isActive
                      ? "bg-black/5 text-[#26231f]"
                      : "text-[#625d55] hover:bg-black/5 hover:text-[#26231f]"
                  }`}
                >
                  <button
                    onClick={async () => {
                      setCurrentProject(project);
                      setExpandedProject(isExpanded ? null : project.id);
                      const hasSession = sessions.some((s) => s.projectPath === project.path && !s.archivedAt);
                      if (!hasSession && !useAppStore.getState().creatingSessionProjectPath) {
                        await createSessionForProject(project);
                      }
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    <FolderOpen size={16} className="shrink-0 text-[#777168]" />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  </button>
                  <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/project:opacity-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenProjectMenu((current) => current === project.id ? null : project.id);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-[#8a847a] transition-colors hover:bg-black/5 hover:text-[#26231f]"
                      title="项目菜单"
                      aria-label="项目菜单"
                    >
                      <MoreHorizontal size={15} />
                    </button>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        setCurrentProject(project);
                        setExpandedProject(project.id);
                        await createSessionForProject(project);
                      }}
                      disabled={Boolean(creatingSessionProjectPath)}
                      className="flex h-9 w-9 items-center justify-center rounded-xl text-[#8a847a] transition-colors hover:bg-black/6 hover:text-[#26231f] disabled:cursor-wait disabled:opacity-60"
                      title="在该项目下新对话"
                      aria-label="在该项目下新对话"
                    >
                      {creatingSessionProjectPath === project.path ? <Loader2 size={15} className="kimix-spin" /> : <SquarePen size={15} />}
                    </button>
                  </div>
                  {openProjectMenu === project.id && (
                    <div
                      className="absolute right-1 top-8 z-40 w-48 rounded-xl border border-[#e5e1d8] bg-white py-1.5 text-[13px] text-[#3a362f] shadow-[0_16px_36px_rgba(25,23,20,0.16)]"
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <button onClick={() => void (isPinned ? unpinProject(project) : pinProject(project))} className="flex h-10 w-full items-center gap-3 text-left transition-colors hover:bg-[#f3f1ec]" style={{ paddingLeft: 18, paddingRight: 18 }}>
                        <Pin size={14} className="text-[#706b63]" />
                        <span>{isPinned ? "取消置顶" : "置顶项目"}</span>
                      </button>
                      <button onClick={() => void openProjectPath(project)} className="flex h-10 w-full items-center gap-3 text-left transition-colors hover:bg-[#f3f1ec]" style={{ paddingLeft: 18, paddingRight: 18 }}>
                        <FolderSearch size={14} className="text-[#706b63]" />
                        <span>在资源管理器中打开</span>
                      </button>
                      <button onClick={() => { setOpenProjectMenu(null); toast("待实现"); }} className="flex h-10 w-full items-center gap-3 text-left transition-colors hover:bg-[#f3f1ec]" style={{ paddingLeft: 18, paddingRight: 18 }}>
                        <GitBranch size={14} className="text-[#706b63]" />
                        <span>创建永久工作树</span>
                      </button>
                      <button onClick={() => { setOpenProjectMenu(null); toast("待实现"); }} className="flex h-10 w-full items-center gap-3 text-left transition-colors hover:bg-[#f3f1ec]" style={{ paddingLeft: 18, paddingRight: 18 }}>
                        <SquarePen size={14} className="text-[#706b63]" />
                        <span>重命名项目</span>
                      </button>
                      <button onClick={() => archiveProjectSessions(project)} className="flex h-10 w-full items-center gap-3 text-left transition-colors hover:bg-[#f3f1ec]" style={{ paddingLeft: 18, paddingRight: 18 }}>
                        <Archive size={14} className="text-[#706b63]" />
                        <span>归档对话</span>
                      </button>
                      <button onClick={() => void removeProject(project)} className="flex h-10 w-full items-center gap-3 text-left text-[#8b3d34] transition-colors hover:bg-[#f9ece9]" style={{ paddingLeft: 18, paddingRight: 18 }}>
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
                      const isSessionBusy = runningSessionId === s.id || s.isLoading;
                      const isLongTaskSession = Boolean(s.longTask);

                      return (
                        <div
                          key={s.id}
                          style={{ paddingLeft: 16, paddingRight: 10 }}
                          className={`group flex h-8 items-center gap-2 rounded-lg text-[14px] transition-colors ${
                            currentSession?.id === s.id
                              ? isLongTaskSession
                                ? "bg-[#dff0ff] text-[#1f4f7a]"
                                : "bg-black/6 text-[#24211d]"
                              : isLongTaskSession
                                ? "bg-[#eef7ff] text-[#2f6fad] hover:bg-[#dff0ff] hover:text-[#1f4f7a]"
                                : "text-[#6f695f] hover:bg-black/5 hover:text-[#24211d]"
                          }`}
                        >
                          <button
                            onClick={() => void selectSession(s.id)}
                            className="min-w-0 flex-1 truncate text-left"
                          >
                            {s.title}
                          </button>
                          <span className="flex h-5 min-w-[34px] shrink-0 items-center justify-end text-[12px] text-[#9a948b]">
                            {isSessionBusy ? (
                              <Loader2 size={14} className="animate-spin text-[#8f887e]" aria-label="会话正在运行" />
                            ) : (
                              formatRelativeTime(s.updatedAt)
                            )}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              archiveSession(s.id);
                              if (currentSession?.id === s.id) {
                                setCurrentSession(null);
                              }
                            }}
                            className="rounded p-0.5 text-[#9a948b] opacity-0 transition-all hover:bg-accent-red/10 hover:text-accent-red group-hover:opacity-100"
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
          <div className="px-3 py-8 text-center text-[13px] text-[#9a948b]">
            尚未选择项目
          </div>
        )}
      </div>

      <div className="px-2 pt-2" style={{ paddingBottom: 10 }}>
        <button
          onClick={() => setSettingsOpen(true)}
          className="kimix-settings-entry flex w-full items-center gap-3 rounded-xl text-[16px] text-[#302d28] transition-colors"
          style={{ height: 36 }}
        >
          <Settings size={18} className="text-[#706b63]" />
          <span>设置</span>
          <span className="ml-auto text-[13px] text-[#aaa49a]">v2.7.32</span>
        </button>
      </div>
    </aside>
  );
}
