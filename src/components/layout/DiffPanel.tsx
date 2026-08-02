import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Check, FileText, RefreshCw, X } from "lucide-react";
import type { PreviewFileInfo } from "@electron/types/ipc";
import { PREVIEW_FILE_SORT_LABELS, PREVIEW_FILE_SORT_MODES, sortPreviewFiles, type PreviewFileSortMode } from "@/utils/previewFileSort";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeExtensions(extensions: string[]) {
  return Array.from(new Set(extensions
    .map((item) => item.trim().toLowerCase().replace(/^\.+/, ""))
    .filter((item) => /^[a-z0-9]{1,12}$/.test(item))))
    .slice(0, 20);
}

interface ProjectFilePreviewPanelProps {
  width: number;
  projectPath?: string;
  allowedExtensions: string[];
  selectedPath?: string;
  onSelectFile: (file: PreviewFileInfo) => void;
  onClose: () => void;
}

export function DiffPanel({ width, projectPath, allowedExtensions, selectedPath, onSelectFile, onClose }: ProjectFilePreviewPanelProps) {
  const normalizedExtensions = useMemo(() => normalizeExtensions(allowedExtensions), [allowedExtensions]);
  const [files, setFiles] = useState<PreviewFileInfo[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState("");
  const [sortMode, setSortMode] = useState<PreviewFileSortMode>("default");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  const loadFiles = async () => {
    if (!projectPath) {
      setFiles([]);
      setError("当前没有可预览的项目。");
      return;
    }
    setLoadingList(true);
    setError("");
    const res = await window.api.listPreviewFiles({ projectPath, extensions: normalizedExtensions }).catch((err) => ({
      success: false as const,
      error: err instanceof Error ? err.message : String(err),
    }));
    setLoadingList(false);
    if (!res.success) {
      setFiles([]);
      setError(`读取文件列表失败：${res.error}`);
      return;
    }
    setFiles(res.data);
  };

  useEffect(() => {
    void loadFiles();
    // selectedPath is intentionally excluded so refresh does not run after every file click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, normalizedExtensions.join("|")]);

  const sortedFiles = useMemo(() => sortPreviewFiles(files, sortMode), [files, sortMode]);
  const extensionText = normalizedExtensions.length > 0 ? normalizedExtensions.map((item) => `.${item}`).join("、") : "未配置";

  return (
    <aside style={{ width, backgroundColor: "var(--surface-base)" }} className="kimix-diff-panel flex h-full shrink-0 flex-col overflow-hidden border border-border-subtle">
      <div className="grid h-14 shrink-0 items-center border-b border-border-subtle" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", paddingLeft: 18, paddingRight: 14, columnGap: 12 }}>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold leading-5 text-text-primary">文件预览</div>
          <div className="mt-0.5 truncate text-[12.5px] leading-5 text-text-muted">
            {files.length > 0 ? `${files.length} 个可预览文件 · ${extensionText}` : `根目录与下一级 · ${extensionText}`}
          </div>
        </div>
        <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
          <button
            type="button"
            onClick={() => void loadFiles()}
            className="kimix-muted-action flex h-8 w-8 items-center justify-center rounded-lg"
            aria-label="刷新文件列表"
            title="刷新"
          >
            <RefreshCw size={15} className={loadingList ? "kimix-spin" : ""} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="kimix-muted-action flex h-8 w-8 items-center justify-center rounded-lg"
            aria-label="关闭文件预览"
            title="关闭"
          >
            <X size={15} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "14px 18px 18px" }}>
        {error && (
          <div className="rounded-xl bg-surface-base text-[13px] leading-6 text-accent-danger" style={{ padding: "14px 16px", marginBottom: 14 }}>
            {error}
          </div>
        )}
        <div className="rounded-xl bg-surface-base" style={{ padding: "14px 14px 16px" }}>
          <div className="flex items-center justify-between" style={{ gap: 12, marginBottom: 12 }}>
            <div className="min-w-0 text-[13.5px] font-semibold leading-5 text-text-primary">可预览文件</div>
            <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSortMenuOpen((open) => !open)}
                  className="kimix-icon-text-button is-compact text-text-secondary hover:bg-surface-hover"
                  aria-haspopup="menu"
                  aria-expanded={sortMenuOpen}
                  title="排序方式"
                >
                  <ArrowUpDown size={13} />
                  {PREVIEW_FILE_SORT_LABELS[sortMode]}
                </button>
                {sortMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setSortMenuOpen(false)} />
                    <div className="kimix-menu-panel absolute right-0 z-50" style={{ top: "calc(100% + 6px)", minWidth: 118, padding: 6 }}>
                      <div className="flex flex-col" style={{ gap: 2 }}>
                        {PREVIEW_FILE_SORT_MODES.map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            role="menuitemradio"
                            aria-checked={mode === sortMode}
                            onClick={() => { setSortMode(mode); setSortMenuOpen(false); }}
                            className={`kimix-menu-item text-left text-[13px] ${mode === sortMode ? "bg-accent-primary-light text-accent-primary" : "text-text-secondary"}`}
                            style={{ height: 32, paddingLeft: 10, paddingRight: 12, gap: 6 }}
                          >
                            <span className="flex w-4 shrink-0 items-center justify-center">{mode === sortMode ? <Check size={13} /> : null}</span>
                            {PREVIEW_FILE_SORT_LABELS[mode]}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
              <span className="shrink-0 rounded-full bg-surface-hover text-[12px] leading-5 text-text-muted" style={{ paddingLeft: 9, paddingRight: 9 }}>
                {files.length}
              </span>
            </div>
          </div>
          {loadingList ? (
            <div className="text-[13px] leading-6 text-text-muted">正在读取文件列表...</div>
          ) : files.length > 0 ? (
            <div className="flex flex-col" style={{ gap: 8 }}>
              {sortedFiles.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => onSelectFile(file)}
                  className={`grid min-w-0 items-center rounded-lg border text-left transition-colors ${
                    selectedPath === file.path ? "border-accent-primary bg-accent-primary-light" : "border-border-subtle bg-surface-base hover:bg-surface-hover"
                  }`}
                  style={{ gridTemplateColumns: "18px minmax(0, 1fr) auto", gap: 10, padding: "10px 12px" }}
                  title={file.path}
                >
                  <FileText size={15} className="text-text-muted" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium leading-5 text-text-primary">{file.name}</span>
                    {file.path !== file.name && (
                      <span className="mt-0.5 block truncate text-[12px] leading-4 text-text-muted">{file.path}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-[12px] leading-5 text-text-muted">{formatBytes(file.size)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-[13px] leading-6 text-text-muted">
              没有找到允许预览的文件。可在设置里调整允许类型。
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
