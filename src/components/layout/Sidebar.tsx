import { Plus, Settings, FolderOpen, ChevronRight, ChevronDown, FolderOpenIcon, MessageSquare } from "lucide-react";
import { useState, useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";

export function Sidebar() {
  const { currentProject, sidebarOpen, toggleSidebar, setCurrentProject, setCurrentSession } = useAppStore();
  const { recentProjects, setRecentProjects, addSession, sessions } = useSessionStore();
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
      <div className="w-14 border-r border-border-default bg-bg-secondary flex flex-col items-center py-3 gap-2 shrink-0">
        <button
          onClick={toggleSidebar}
          className="p-2 rounded-xl hover:bg-bg-tertiary text-text-secondary transition-colors"
          title="展开侧边栏"
        >
          <ChevronRight size={20} />
        </button>
      </div>
    );
  }

  const projectSessions = (projectPath: string) =>
    sessions.filter((s) => s.projectPath === projectPath);

  return (
    <div className="w-[260px] border-r border-border-default bg-bg-secondary flex flex-col h-full shrink-0">
      {/* Header */}
      <div className="p-3 space-y-2">
        <button
          onClick={handleOpenProject}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-accent-blue text-white hover:opacity-90 transition-opacity text-sm font-medium shadow-sm"
        >
          <FolderOpenIcon size={16} />
          <span>打开项目</span>
        </button>
        <button className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-border-default hover:bg-bg-tertiary hover:border-border-strong transition-all text-text-primary text-sm bg-bg-elevated">
          <Plus size={16} />
          <span>新对话</span>
        </button>
      </div>

      {/* Projects */}
      <div className="flex-1 overflow-y-auto px-2">
        <div className="text-[11px] font-semibold text-text-muted px-3 py-2 uppercase tracking-wider">
          最近项目
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
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl transition-all text-sm ${
                  isActive
                    ? "bg-bg-tertiary text-text-primary border border-border-strong"
                    : "hover:bg-bg-tertiary/60 text-text-secondary border border-transparent"
                }`}
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <FolderOpen size={16} className="text-accent-yellow shrink-0" />
                <span className="flex-1 text-left truncate font-medium">{project.name}</span>
              </button>

              {isExpanded && pSessions.length > 0 && (
                <div className="ml-6 mt-0.5 space-y-0.5">
                  {pSessions.map((s) => (
                    <button
                      key={s.id}
                      className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-text-secondary hover:bg-bg-tertiary/40 transition-colors text-left"
                    >
                      <MessageSquare size={12} />
                      <span className="truncate">{s.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {recentProjects.length === 0 && !currentProject && (
          <div className="px-3 py-6 text-sm text-text-muted text-center">
            尚未选择项目
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border-default space-y-0.5">
        <button className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-bg-tertiary transition-colors text-text-secondary text-sm">
          <Settings size={16} />
          <span>设置</span>
        </button>
        <button
          onClick={toggleSidebar}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-bg-tertiary transition-colors text-text-secondary text-sm"
        >
          <ChevronDown size={16} className="rotate-90" />
          <span>收起</span>
        </button>
      </div>
    </div>
  );
}
