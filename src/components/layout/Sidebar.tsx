import { Plus, Settings, FolderOpen, ChevronRight, MessageSquare, Trash2, Search, Wrench, Zap } from "lucide-react";
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

export function Sidebar() {
  const { currentProject, currentSession, sidebarOpen, toggleSidebar, setCurrentProject, setCurrentSession, setSettingsOpen } = useAppStore();
  const { recentProjects, setRecentProjects, addSession, sessions, deleteSession } = useSessionStore();
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
      const project = {
        ...res.data,
        id: crypto.randomUUID(),
        lastOpenedAt: Date.now(),
      };
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
      <div className="w-12 border-r border-border-default bg-bg-secondary flex flex-col items-center py-2 gap-1 shrink-0">
        <button
          onClick={toggleSidebar}
          className="p-2 rounded-lg hover:bg-bg-hover text-text-secondary transition-colors"
          title="展开侧边栏"
          aria-label="展开侧边栏"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    );
  }

  const projectSessions = (projectPath: string) =>
    sessions.filter((s) => s.projectPath === projectPath);

  return (
    <div className="w-[280px] border-r border-border-default bg-bg-secondary flex flex-col h-full shrink-0 select-none">
      {/* Top Navigation */}
      <div className="px-3 pt-3 pb-1 space-y-0.5">
        <button
          onClick={async () => {
            if (currentProject) {
              await createSessionForProject(currentProject);
            }
          }}
          disabled={!currentProject}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-text-primary text-sm hover:bg-bg-hover transition-colors disabled:opacity-40"
        >
          <Plus size={16} className="text-text-secondary" />
          <span>新对话</span>
        </button>
        <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-text-primary text-sm hover:bg-bg-hover transition-colors">
          <Search size={16} className="text-text-secondary" />
          <span>搜索</span>
        </button>
        <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-text-primary text-sm hover:bg-bg-hover transition-colors">
          <Wrench size={16} className="text-text-secondary" />
          <span>技能</span>
        </button>
        <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-text-primary text-sm hover:bg-bg-hover transition-colors">
          <Zap size={16} className="text-text-secondary" />
          <span>自动化</span>
          <span className="ml-auto text-xs text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded-full">1</span>
        </button>
      </div>

      <div className="mx-3 my-2 border-t border-border-default" />

      {/* Projects */}
      <div className="flex-1 overflow-y-auto px-2">
        <div className="text-[11px] font-medium text-text-muted px-3 py-1.5">
          项目
        </div>

        {recentProjects.map((project) => {
          const isExpanded = expandedProject === project.id;
          const isActive = currentProject?.id === project.id;
          const pSessions = projectSessions(project.path);

          return (
            <div key={project.id} className="mb-0.5">
              <button
                onClick={async () => {
                  setCurrentProject(project);
                  setExpandedProject(isExpanded ? null : project.id);
                  const hasSession = sessions.some((s) => s.projectPath === project.path);
                  if (!hasSession) {
                    await createSessionForProject(project);
                  }
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-sm ${
                  isActive
                    ? "bg-bg-hover text-text-primary"
                    : "hover:bg-bg-hover text-text-secondary"
                }`}
              >
                <FolderOpen size={15} className="shrink-0 opacity-70" />
                <span className="flex-1 text-left truncate">{project.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenProject();
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-tertiary text-text-muted"
                  title="打开项目"
                >
                  <ChevronRight size={12} />
                </button>
              </button>

              {isExpanded && pSessions.length > 0 && (
                <div className="ml-5 mt-0.5 space-y-0.5">
                  {pSessions.map((s) => (
                    <div
                      key={s.id}
                      className={`group flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors ${
                        currentSession?.id === s.id
                          ? "bg-bg-hover text-text-primary"
                          : "text-text-muted hover:text-text-secondary hover:bg-bg-hover"
                      }`}
                    >
                      <MessageSquare size={11} className="shrink-0 opacity-50" />
                      <button
                        onClick={() => setCurrentSession(s)}
                        className="flex-1 text-left truncate min-w-0"
                      >
                        {s.title}
                      </button>
                      <span className="shrink-0 text-[10px] text-text-muted opacity-60">
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
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent-red/10 hover:text-accent-red transition-all"
                        title="删除会话"
                        aria-label="删除会话"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {recentProjects.length === 0 && !currentProject && (
          <div className="px-3 py-4 text-xs text-text-muted text-center">
            尚未选择项目
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-border-default">
        <button
          onClick={() => setSettingsOpen(true)}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-bg-hover transition-colors text-text-secondary text-sm"
        >
          <Settings size={16} />
          <span>设置</span>
        </button>
      </div>
    </div>
  );
}
