import { FileText, ChevronDown } from "lucide-react";

interface FileCardProps {
  filePath: string;
  fileType?: string;
}

export function FileCard({ filePath, fileType }: FileCardProps) {
  const name = filePath.split(/[\\/]/).pop() ?? filePath;

  return (
    <div className="flex justify-center">
      <div className="max-w-[90%] w-full rounded-xl border border-border-default bg-bg-secondary px-4 py-3 flex items-center gap-3">
        <FileText size={20} className="text-text-muted shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-text-primary truncate">{name}</div>
          <div className="text-xs text-text-muted">{fileType ?? "文件"}</div>
        </div>
        <button className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-bg-tertiary text-xs text-text-secondary transition-colors">
          <span>打开</span>
          <ChevronDown size={12} />
        </button>
      </div>
    </div>
  );
}
