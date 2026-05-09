import { SquarePen, Settings, FolderOpen, ChevronRight, MessageSquare, Trash2, Search, LayoutGrid, Clock, PanelLeftOpen } from "lucide-react";
import { useState, useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";

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

const navItemClass = "flex h-9 w-full items-center gap-3 rounded-xl px-3 text-[15px] text-[#302d28] transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40";

export function Sidebar() {
  const currentProject = useAppStore((s) => s.currentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);

  const recentProjects = useSessionStore((s) => s.recentProjects);
  const setRecentProjects = useSessionStore((s) => s.setRecentProjects);
  const addSession = useSessionStore((s) => s.addSession);
  const sessions = useSessionStore((s) => s.sessions);
  const deleteSession = useSessionStore((s) => s.deleteSession);

  const [expandedProject, setExpandedProject] = useState<string | null>(null);

  useEffect(() => {
    if (currentProject) {
      setExpandedProject(currentProject.id);
    }
  }, [currentProject]);

  const createSessionForProject = async (project: { path: string; name: string }) => {
    const sessionRes = await window.api.startSession({
      workDir: project.path,
      thinking: true,
    });
    if (sessionRes.success) {
      const session = {
        id: sessionRes.data.sessionId,
        title: "新会话",
        projectPath: project.path,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        events: [],
        isLoading: false,
      };
      addSession(session);
      setCurrentSession(session);
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

  if (!sidebarOpen) {
    return (
      <aside className="flex w-[52px] shrink-0 flex-col items-center bg-[#f6f4ef] px-1 py-1.5">
        <button
          onClick={toggleSidebar}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-[#706b63] transition-colors hover:bg-black/5 hover:text-[#26231f]"
          title="展开侧边栏"
          aria-label="展开侧边栏"
        >
          <PanelLeftOpen size={18} />
        </button>
      </aside>
    );
  }

  const projectSessions = (projectPath: string) =>
    sessions.filter((s) => s.projectPath === projectPath);

  return (
    <aside className="flex h-full w-[320px] shrink-0 select-none flex-col bg-[#f6f4ef] pb-2 pl-1 pr-2">
      <div className="no-drag space-y-1 px-2 pb-2">
        <button
          onClick={async () => {
            if (currentProject) {
              await createSessionForProject(currentProject);
            }
          }}
          disabled={!currentProject}
          className={navItemClass}
        >
          <SquarePen size={17} className="shrink-0 text-[#706b63]" />
          <span>新对话</span>
        </button>
        <button disabled className={navItemClass} title="搜索功能即将上线">
          <Search size={17} className="shrink-0 text-[#706b63]" />
          <span>搜索</span>
        </button>
        <button disabled className={navItemClass} title="技能功能即将上线">
          <LayoutGrid size={17} className="shrink-0 text-[#706b63]" />
          <span>技能</span>
        </button>
        <button disabled className={`${navItemClass} justify-between`} title="自动化功能即将上线">
          <span className="flex items-center gap-3">
            <Clock size={17} className="shrink-0 text-[#706b63]" />
            <span>自动化</span>
          </span>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[12px] text-[#8a847a]">1</span>
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

        <div className="space-y-3">
          {recentProjects.map((project) => {
            const isExpanded = expandedProject === project.id;
            const isActive = currentProject?.id === project.id;
            const pSessions = projectSessions(project.path);

            return (
              <section key={project.id} className="space-y-1">
                <button
                  onClick={async () => {
                    setCurrentProject(project);
                    setExpandedProject(isExpanded ? null : project.id);
                    const hasSession = sessions.some((s) => s.projectPath === project.path);
                    if (!hasSession) {
                      await createSessionForProject(project);
                    }
                  }}
                  className={`flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-[15px] transition-colors ${
                    isActive
                      ? "bg-black/5 text-[#26231f]"
                      : "text-[#625d55] hover:bg-black/5 hover:text-[#26231f]"
                  }`}
                >
                  <FolderOpen size={16} className="shrink-0 text-[#777168]" />
                  <span className="min-w-0 flex-1 truncate text-left">{project.name}</span>
                </button>

                {isExpanded && pSessions.length > 0 && (
                  <div className="space-y-0.5 pl-7 pr-1">
                    {pSessions.map((s) => (
                      <div
                        key={s.id}
                        className={`group flex h-8 items-center gap-2 rounded-lg px-2 text-[14px] transition-colors ${
                          currentSession?.id === s.id
                            ? "bg-black/6 text-[#24211d]"
                            : "text-[#6f695f] hover:bg-black/5 hover:text-[#24211d]"
                        }`}
                      >
                        <MessageSquare size={12} className="shrink-0 text-[#9a948b]" />
                        <button
                          onClick={() => setCurrentSession(s)}
                          className="min-w-0 flex-1 truncate text-left"
                        >
                          {s.title}
                        </button>
                        <span className="shrink-0 text-[12px] text-[#9a948b]">
                          {formatRelativeTime(s.updatedAt)}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSession(s.id);
                            if (currentSession?.id === s.id) {
                              setCurrentSession(null);
                            }
                          }}
                          className="rounded p-0.5 text-[#9a948b] opacity-0 transition-all hover:bg-accent-red/10 hover:text-accent-red group-hover:opacity-100"
                          title="删除会话"
                          aria-label="删除会话"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
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

      <div className="px-2 pt-2">
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex h-9 w-full items-center gap-3 rounded-xl px-3 text-[15px] text-[#302d28] transition-colors hover:bg-black/5"
        >
          <Settings size={17} className="text-[#706b63]" />
          <span>设置</span>
          <span className="ml-auto text-[11px] text-[#aaa49a]">v0.1.0</span>
        </button>
      </div>
    </aside>
  );
}
