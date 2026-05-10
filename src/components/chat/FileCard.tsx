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
    <div className="w-full rounded-[14px] border border-[#e8e3da] bg-white" style={{ padding: "18px 22px" }}>
      <div className="flex items-center" style={{ gap: 16 }}>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-[#f3f1ec] text-[#6f6a62]">
          <FileText size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold leading-6 text-[#24211d]">{name}</div>
          <div className="text-[13px] leading-5 text-[#8a847a]">{type}</div>
        </div>
        <button
          type="button"
          onClick={handleOpen}
          disabled={!project || !path}
          className="flex h-9 shrink-0 items-center rounded-xl border border-[#ebe6dd] bg-white text-[14px] text-[#3a362f] transition-colors hover:bg-[#faf8f4] disabled:cursor-not-allowed disabled:opacity-45"
          style={{ gap: 8, paddingLeft: 14, paddingRight: 12 }}
        >
          <span>打开</span>
          <ChevronDown size={14} className="text-[#8a847a]" />
        </button>
      </div>
    </div>
  );
}
