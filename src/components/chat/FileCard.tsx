import { memo, useState, useRef, useEffect } from "react";
import { ChevronDown, FileText, ExternalLink, Code, FolderOpen, Copy, Check } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import type { TimelineEvent } from "@/types/ui";

interface FileCardProps {
  event?: Extract<TimelineEvent, { type: "file_artifact" }>;
  filePath?: string;
  fileType?: string;
}

export const FileCard = memo(function FileCard({ event, filePath, fileType }: FileCardProps) {
  const project = useAppStore((s) => s.currentProject);
  const path = event?.filePath ?? filePath ?? "";
  const type = event?.fileType ?? fileType ?? "文档 · MD";
  const name = path.split(/[\\/]/).pop() ?? path;

  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState<"full" | "relative" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const fullPath = project?.path ? `${project.path}/${path.replace(/^[\\/]/, "")}` : path;

  const handleOpenDefault = async () => {
    setIsOpen(false);
    if (!project || !path) return;
    await window.api.openFile({ projectPath: project.path, filePath: path });
  };

  const handleOpenInEditor = async () => {
    setIsOpen(false);
    if (!path) return;
    const res = await window.api.openProjectEditor({ path: fullPath, editor: "vscode" });
    if (res && !res.success) {
      window.dispatchEvent(new CustomEvent("kimix:toast", { detail: `在编辑器打开失败：${res.error}` }));
    }
  };

  const handleRevealInFolder = async () => {
    setIsOpen(false);
    if (!path) return;
    const res = await window.api.revealPath({ path: fullPath });
    if (res && !res.success) {
      window.dispatchEvent(new CustomEvent("kimix:toast", { detail: `在管理器定位失败：${res.error}` }));
    }
  };

  const handleCopyFullPath = async () => {
    setIsOpen(false);
    if (!path) return;
    await navigator.clipboard.writeText(fullPath);
    setCopied("full");
    setTimeout(() => setCopied(null), 2000);
    window.dispatchEvent(new CustomEvent("kimix:toast", { detail: "已复制完整路径" }));
  };

  const handleCopyRelativePath = async () => {
    setIsOpen(false);
    if (!path) return;
    await navigator.clipboard.writeText(path);
    setCopied("relative");
    setTimeout(() => setCopied(null), 2000);
    window.dispatchEvent(new CustomEvent("kimix:toast", { detail: "已复制相对路径" }));
  };

  return (
    <div
      className={`kimix-section-card relative w-full transition-[box-shadow] ${
        isOpen ? "z-[60]" : "z-10"
      }`}
      style={{ padding: "18px 22px" }}
    >
      <div className="flex items-center" style={{ gap: 16 }}>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-surface-hover text-text-muted">
          <FileText size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold leading-6 text-text-primary">{name}</div>
          <div className="text-[13px] leading-5 text-text-muted">{type}</div>
        </div>

        <div className="relative shrink-0" ref={menuRef}>
          <div className={`kimix-file-open-control kimix-split-control inline-flex items-center ${isOpen ? "is-expanded" : ""}`}>
            <button
              type="button"
              onClick={handleOpenDefault}
              disabled={!project || !path}
              className="kimix-split-control-part flex h-9 items-center whitespace-nowrap text-[13.5px] font-medium text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-45"
              style={{ paddingLeft: 14, paddingRight: 8 }}
            >
              打开
            </button>
            <button
              type="button"
              onClick={() => setIsOpen((prev) => !prev)}
              disabled={!project || !path}
              title="选择打开方式"
              className="kimix-split-control-part flex h-9 w-8 items-center justify-center text-text-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-45"
            >
              <ChevronDown size={14} className={`transition-transform duration-150 ${isOpen ? "rotate-180 text-text-primary" : ""}`} />
            </button>
          </div>

          {isOpen && (
            <div
              className="kimix-menu-panel absolute right-0 top-full z-[100] min-w-[210px] whitespace-nowrap"
              style={{ marginTop: 8, padding: "8px 6px" }}
            >
              <button
                type="button"
                onClick={handleOpenDefault}
                className="kimix-menu-item text-left text-[13.5px] font-medium whitespace-nowrap"
                style={{ height: 36, gap: 10, paddingLeft: 14, paddingRight: 14 }}
              >
                <ExternalLink size={15} className="shrink-0 text-text-muted" />
                <span className="whitespace-nowrap">系统默认程序打开</span>
              </button>
              <button
                type="button"
                onClick={handleOpenInEditor}
                className="kimix-menu-item text-left text-[13.5px] font-medium whitespace-nowrap"
                style={{ height: 36, gap: 10, paddingLeft: 14, paddingRight: 14 }}
              >
                <Code size={15} className="shrink-0 text-text-muted" />
                <span className="whitespace-nowrap">在编辑器中打开 (VS Code)</span>
              </button>
              <button
                type="button"
                onClick={handleRevealInFolder}
                className="kimix-menu-item text-left text-[13.5px] font-medium whitespace-nowrap"
                style={{ height: 36, gap: 10, paddingLeft: 14, paddingRight: 14 }}
              >
                <FolderOpen size={15} className="shrink-0 text-text-muted" />
                <span className="whitespace-nowrap">在文件管理器中定位</span>
              </button>
              <div className="my-1.5 border-t border-border-subtle" />
              <button
                type="button"
                onClick={handleCopyFullPath}
                className="kimix-menu-item text-left text-[13.5px] font-medium whitespace-nowrap"
                style={{ height: 36, gap: 10, paddingLeft: 14, paddingRight: 14 }}
              >
                {copied === "full" ? <Check size={15} className="shrink-0 text-accent-primary" /> : <Copy size={15} className="shrink-0 text-text-muted" />}
                <span className="whitespace-nowrap">{copied === "full" ? "已复制完整路径" : "复制完整路径"}</span>
              </button>
              <button
                type="button"
                onClick={handleCopyRelativePath}
                className="kimix-menu-item text-left text-[13.5px] font-medium whitespace-nowrap"
                style={{ height: 36, gap: 10, paddingLeft: 14, paddingRight: 14 }}
              >
                {copied === "relative" ? <Check size={15} className="shrink-0 text-accent-primary" /> : <Copy size={15} className="shrink-0 text-text-muted" />}
                <span className="whitespace-nowrap">{copied === "relative" ? "已复制相对路径" : "复制相对路径"}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
