import { FolderOpen, Monitor, GitBranch, Download } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";

export function ContextBar() {
  const project = useAppStore((s) => s.currentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const sessions = useSessionStore((s) => s.sessions);
  const session = sessions.find((s) => s.id === currentSession?.id);

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
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex items-center justify-center gap-5 px-4 py-2.5 text-xs text-text-muted border-t border-border-default bg-bg-secondary/50">
      <div className="flex items-center gap-1.5">
        <FolderOpen size={12} />
        <span className="font-medium text-text-secondary">{project?.name ?? "选择项目"}</span>
      </div>
      <div className="w-px h-3 bg-border-default" />
      <div className="flex items-center gap-1.5">
        <Monitor size={12} />
        <span>本地模式</span>
      </div>
      <div className="w-px h-3 bg-border-default" />
      <div className="flex items-center gap-1.5">
        <GitBranch size={12} />
        <span>{project?.gitBranch ?? "main"}</span>
      </div>
      {session && (
        <>
          <div className="w-px h-3 bg-border-default" />
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 hover:text-text-secondary transition-colors"
            title="导出聊天记录"
          >
            <Download size={12} />
            <span>导出</span>
          </button>
        </>
      )}
    </div>
  );
}
