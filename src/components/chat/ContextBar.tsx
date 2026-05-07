import { FolderOpen, Monitor, GitBranch, ChevronDown, Download } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";

export function ContextBar() {
  const project = useAppStore((s) => s.currentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const session = useSessionStore((s) => s.sessions.find((sess) => sess.id === currentSession?.id));

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
    <div className="flex items-center justify-center gap-1 px-4 pb-3 pt-1">
      <button className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-colors">
        <FolderOpen size={12} />
        <span>{project?.name ?? "选择项目"}</span>
        <ChevronDown size={10} />
      </button>
      <button className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-colors">
        <Monitor size={12} />
        <span>本地模式</span>
        <ChevronDown size={10} />
      </button>
      <button className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-colors">
        <GitBranch size={12} />
        <span>{project?.gitBranch ?? "main"}</span>
        <ChevronDown size={10} />
      </button>
      {session && (
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-colors"
          title="导出聊天记录"
          aria-label="导出聊天记录"
        >
          <Download size={12} />
          <span>导出</span>
        </button>
      )}
    </div>
  );
}
