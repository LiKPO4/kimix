import { FolderOpen, Monitor, GitBranch } from "lucide-react";
import { useAppStore } from "@/stores/appStore";

export function ContextBar() {
  const project = useAppStore((s) => s.currentProject);

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
    </div>
  );
}
