import { Download, FolderOpen, GitBranch, Monitor } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";

export function ContextBar() {
  const project = useAppStore((s) => s.currentProject);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const session = useSessionStore((s) => s.sessions.find((sess) => sess.id === currentSession?.id));

  const handleOpenProject = async () => {
    const res = await window.api.openProject({ defaultPath: project?.path });
    if (res.success && res.data) {
      setCurrentProject(res.data);
    }
  };

  const handleExport = () => {
    if (!session) return;
    let md = `# ${session.title}\n\n`;
    for (const ev of session.events) {
      if (ev.type === "user_message") {
        md += `## User\n\n${ev.content}\n\n`;
      } else if (ev.type === "assistant_message") {
        md += `## Assistant\n\n${ev.content}\n\n`;
        if (ev.thinking) {
          md += `> **Thinking**\n> ${ev.thinking.replace(/\n/g, "\n> ")}\n\n`;
        }
      } else if (ev.type === "tool_call") {
        md += `> **Tool**: ${ev.toolName}\n\n`;
      } else if (ev.type === "error") {
        md += `> **Error**: ${ev.message}\n\n`;
      }
    }
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${session.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_")}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex h-[34px] w-full items-center justify-between gap-3 px-1 text-[14px] leading-none text-[#7c756c]">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <button
          onClick={handleOpenProject}
          className="flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-[#f1eee8] hover:text-[#3a362f]"
          title={project?.path ?? "选择项目"}
        >
          <FolderOpen size={16} className="shrink-0" />
          <span className="max-w-[220px] truncate">{project?.name ?? "选择项目"}</span>
        </button>
        <div className="hidden min-w-0 items-center gap-1.5 sm:flex" title="本地模式">
          <Monitor size={16} className="shrink-0" />
          <span className="truncate">本地模式</span>
        </div>
        <div className="hidden min-w-0 items-center gap-1.5 md:flex" title={project?.gitBranch ?? "当前分支"}>
          <GitBranch size={16} className="shrink-0" />
          <span className="max-w-[150px] truncate">{project?.gitBranch ?? "main"}</span>
        </div>
      </div>

      {session && (
        <button
          onClick={handleExport}
          className="flex h-8 shrink-0 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-[#f1eee8] hover:text-[#3a362f]"
          title="导出聊天记录"
          aria-label="导出聊天记录"
        >
          <Download size={16} />
          <span>导出</span>
        </button>
      )}
    </div>
  );
}
