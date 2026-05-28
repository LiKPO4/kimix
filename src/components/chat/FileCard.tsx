import { ChevronDown, FileText } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import type { TimelineEvent } from "@/types/ui";

interface FileCardProps {
  event?: Extract<TimelineEvent, { type: "file_artifact" }>;
  filePath?: string;
  fileType?: string;
}

export function FileCard({ event, filePath, fileType }: FileCardProps) {
  const project = useAppStore((s) => s.currentProject);
  const path = event?.filePath ?? filePath ?? "";
  const type = event?.fileType ?? fileType ?? "文档 · MD";
  const name = path.split(/[\\/]/).pop() ?? path;

  const handleOpen = async () => {
    if (!project || !path) return;
    await window.api.openFile({ projectPath: project.path, filePath: path });
  };

  return (
    <div className="w-full rounded-[14px] border border-border-subtle bg-surface-elevated" style={{ padding: "18px 22px" }}>
      <div className="flex items-center" style={{ gap: 16 }}>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-surface-hover text-text-muted">
          <FileText size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold leading-6 text-text-primary">{name}</div>
          <div className="text-[13px] leading-5 text-text-muted">{type}</div>
        </div>
        <button
          type="button"
          onClick={handleOpen}
          disabled={!project || !path}
          className="flex h-9 shrink-0 items-center rounded-xl border border-border-subtle bg-surface-elevated text-[14px] text-text-secondary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
          style={{ gap: 8, paddingLeft: 14, paddingRight: 12 }}
        >
          <span>打开</span>
          <ChevronDown size={14} className="text-text-muted" />
        </button>
      </div>
    </div>
  );
}
