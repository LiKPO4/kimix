import { ChevronDown, ChevronRight, ChevronUp, FileText, RotateCcw } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TimelineEvent } from "@/types/ui";

interface Change {
  path: string;
  oldText?: string;
  newText?: string;
  additions?: number;
  deletions?: number;
}

interface ChangeCardProps {
  changes?: Change[];
  event?: Extract<TimelineEvent, { type: "change_summary" }>;
}

type ChangeRow = {
  path: string;
  oldText?: string;
  newText?: string;
  additions?: number;
  deletions?: number;
};

function countLines(value?: string) {
  if (!value) return 0;
  return value.split("\n").filter(Boolean).length;
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").toLowerCase();
}

function mergeChangeRows(rows: ChangeRow[]) {
  const byPath = new Map<string, ChangeRow>();
  rows.forEach((row) => {
    const key = normalizePath(row.path);
    const existing = byPath.get(key);
    byPath.set(key, {
      path: existing?.path ?? row.path,
      oldText: existing?.oldText ?? row.oldText,
      newText: row.newText ?? existing?.newText,
      additions: (existing?.additions ?? 0) + (row.additions ?? 0),
      deletions: (existing?.deletions ?? 0) + (row.deletions ?? 0),
    });
  });
  return Array.from(byPath.values());
}

function findDiffForPath(events: TimelineEvent[], filePath: string) {
  const normalizedFile = normalizePath(filePath);
  const diffs = events.filter((item): item is Extract<TimelineEvent, { type: "diff" }> => item.type === "diff");
  for (let index = diffs.length - 1; index >= 0; index -= 1) {
    const diff = diffs[index];
    const normalizedDiff = normalizePath(diff.filePath);
    if (
      normalizedDiff === normalizedFile ||
      normalizedDiff.endsWith(`/${normalizedFile}`) ||
      normalizedFile.endsWith(`/${normalizedDiff}`)
    ) {
      return diff;
    }
  }
  return null;
}

type DiffLine = {
  kind: "same" | "added" | "removed";
  oldLine?: string;
  newLine?: string;
};

function buildLineDiff(oldText = "", newText = ""): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const rows = oldLines.length + 1;
  const cols = newLines.length + 1;
  const table = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      table[i][j] = oldLines[i] === newLines[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const diff: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      diff.push({ kind: "same", oldLine: oldLines[i], newLine: newLines[j] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      diff.push({ kind: "removed", oldLine: oldLines[i] });
      i += 1;
    } else {
      diff.push({ kind: "added", newLine: newLines[j] });
      j += 1;
    }
  }
  while (i < oldLines.length) {
    diff.push({ kind: "removed", oldLine: oldLines[i] });
    i += 1;
  }
  while (j < newLines.length) {
    diff.push({ kind: "added", newLine: newLines[j] });
    j += 1;
  }
  return diff;
}

function renderDiffColumn(lines: DiffLine[], side: "old" | "new") {
  return lines.map((line, index) => {
    const isRemoved = side === "old" && line.kind === "removed";
    const isAdded = side === "new" && line.kind === "added";
    const isBlank = (side === "old" && line.kind === "added") || (side === "new" && line.kind === "removed");
    const text = side === "old" ? line.oldLine : line.newLine;
    return (
      <div
        key={`${side}-${index}`}
        className="grid grid-cols-[40px_1fr] font-mono text-[12px] leading-5"
        style={{
          backgroundColor: isRemoved ? "var(--accent-danger-light)" : isAdded ? "var(--accent-success-light)" : isBlank ? "var(--surface-hover)" : "transparent",
          color: isRemoved ? "var(--accent-danger)" : isAdded ? "var(--accent-success)" : "var(--text-secondary)",
        }}
      >
        <span className="select-none text-right text-text-muted" style={{ paddingRight: 10 }}>
          {isBlank ? "" : index + 1}
        </span>
        <span className="whitespace-pre-wrap break-words" style={{ paddingLeft: 8, paddingRight: 8 }}>
          {isBlank ? " " : text || " "}
        </span>
      </div>
    );
  });
}

export const ChangeCard = memo(function ChangeCard({ changes, event }: ChangeCardProps) {
  const currentSession = useAppStore((s) => s.currentSession);
  const project = useAppStore((s) => s.currentProject);
  const updateSession = useSessionStore((s) => s.updateSession);
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});
  const files = useMemo(() => mergeChangeRows(event?.files ?? (changes ?? []).map((change) => ({
    path: change.path,
    oldText: change.oldText,
    newText: change.newText,
    additions: change.additions ?? Math.max(0, countLines(change.newText) - countLines(change.oldText)),
    deletions: change.deletions ?? Math.max(0, countLines(change.oldText) - countLines(change.newText)),
  }))), [changes, event?.files]);
  const additions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const deletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0);
  const projectPath = event?.projectPath ?? project?.path;
  const canExpand = files.length > 3;
  const visibleFiles = expanded ? files : files.slice(0, 3);
  const hiddenFileCount = Math.max(0, files.length - visibleFiles.length);
  const collapsibleFileCount = Math.max(0, files.length - 3);
  const changesByPath = useMemo(() => {
    const map = new Map<string, Change>();
    files.forEach((change) => {
      if (change.oldText !== undefined || change.newText !== undefined) {
        map.set(normalizePath(change.path), change);
      }
    });
    return map;
  }, [files]);

  const removeRevertedFiles = (paths: string[]) => {
    if (!currentSession || !event) return;
    const reverted = new Set(paths.map((path) => normalizePath(path)));
    updateSession(currentSession.id, (session) => ({
      ...session,
      events: session.events.flatMap((item) => {
        if (item.type !== "change_summary") return [item];
        const eventIds = event.id.split(":");
        if (!eventIds.includes(item.id)) return [item];
        const nextFiles = item.files.filter((file) => !reverted.has(normalizePath(file.path)));
        if (nextFiles.length === 0) return [];
        return [{
          ...item,
          files: nextFiles,
          additions: nextFiles.reduce((sum, file) => sum + (file.additions ?? 0), 0),
          deletions: nextFiles.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
        }];
      }),
      updatedAt: Date.now(),
    }));
  };

  const handleRevert = async (targetFiles = files) => {
    if (!projectPath || targetFiles.length === 0 || reverting) return;
    setReverting(true);
    setError("");
    const res = await window.api.revertFiles({
      projectPath,
      files: targetFiles.map((file) => ({
        path: file.path,
        additions: file.additions,
        deletions: file.deletions,
      })),
    });
    setReverting(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    removeRevertedFiles(targetFiles.map((file) => file.path));
  };

  const renderFileRow = (file: { path: string; additions?: number; deletions?: number }) => {
    const key = normalizePath(file.path);
    const diffEvent = currentSession ? findDiffForPath(currentSession.events, file.path) : null;
    const change = changesByPath.get(key);
    const oldText = change?.oldText ?? diffEvent?.oldText;
    const newText = change?.newText ?? diffEvent?.newText;
    const hasStructuredDiff = oldText !== undefined || newText !== undefined;
    const diffExpanded = hasStructuredDiff && Boolean(expandedDiffs[key]);
    const diffLines = hasStructuredDiff ? buildLineDiff(oldText, newText) : [];
    return (
      <div key={file.path} className="border-b border-border-subtle last:border-b-0">
        <div
          className="grid min-h-11 items-center"
          style={{
            gridTemplateColumns: "minmax(0, 1fr) auto auto 72px",
            paddingLeft: 18,
            paddingRight: 18,
            columnGap: 10,
          }}
        >
          <button
            type="button"
            onClick={() => {
              if (!hasStructuredDiff) return;
              setExpandedDiffs((state) => ({ ...state, [key]: !state[key] }));
            }}
            className={`flex min-w-0 flex-1 items-center rounded-lg text-left transition-colors ${hasStructuredDiff ? "hover:bg-surface-hover" : "cursor-default"}`}
            style={{ gap: 8, padding: "6px 8px" }}
            title={file.path}
          >
            {hasStructuredDiff
              ? diffExpanded
                ? <ChevronDown size={14} className="shrink-0 text-text-muted" />
                : <ChevronRight size={14} className="shrink-0 text-text-muted" />
              : <FileText size={14} className="shrink-0 text-text-muted" />}
            <span className="min-w-0 flex-1 truncate text-[14px] text-text-primary">{file.path}</span>
          </button>
          <div className="kimix-tabular-nums flex items-center justify-self-end text-[13.5px]" style={{ gap: 8, minWidth: 72 }}>
            <span className="text-accent-success">+{file.additions ?? 0}</span>
            <span className="text-accent-danger">-{file.deletions ?? 0}</span>
          </div>
          {!hasStructuredDiff && (
            <span
              className="justify-self-end rounded-md bg-surface-hover text-[12.5px] leading-5 text-text-muted"
              style={{ paddingLeft: 8, paddingRight: 8 }}
              title={`完整路径：${file.path}`}
            >
              摘要
            </span>
          )}
          {hasStructuredDiff && <span />}
          <button
            type="button"
            onClick={() => void handleRevert([file])}
            disabled={!projectPath || reverting}
            className="flex h-8 items-center justify-self-end rounded-md text-[12.5px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-45"
            style={{ gap: 6, paddingLeft: 10, paddingRight: 10, minWidth: 68 }}
            title="撤销此文件"
          >
            <span>{reverting ? "撤销中" : "撤销"}</span>
            <RotateCcw size={13} />
          </button>
        </div>
        {hasStructuredDiff && diffExpanded && (
          <div className="bg-surface-base" style={{ padding: "0 18px 14px 40px" }}>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="overflow-hidden rounded-lg border border-accent-danger/30 bg-surface-elevated">
                <div style={{ padding: "10px 12px" }} className="border-b border-accent-danger/20 text-[12px] font-medium leading-5 text-accent-danger">修改前</div>
                <div className="max-h-72 overflow-auto" style={{ paddingTop: 8, paddingBottom: 8 }}>
                  {renderDiffColumn(diffLines, "old")}
                </div>
              </div>
              <div className="overflow-hidden rounded-lg border border-accent-success/30 bg-surface-elevated">
                <div style={{ padding: "10px 12px" }} className="border-b border-accent-success/20 text-[12px] font-medium leading-5 text-accent-success">修改后</div>
                <div className="max-h-72 overflow-auto" style={{ paddingTop: 8, paddingBottom: 8 }}>
                  {renderDiffColumn(diffLines, "new")}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full overflow-hidden rounded-[14px] border border-border-subtle bg-surface-elevated">
      <div
        className="grid items-center border-b border-border-subtle"
        style={{ gridTemplateColumns: "minmax(0, 1fr) auto", minHeight: 44, paddingLeft: 18, paddingRight: 18, columnGap: 14 }}
      >
        <button
          type="button"
          onClick={() => canExpand && setExpanded((value) => !value)}
          disabled={!canExpand}
          className="flex min-w-0 items-center rounded-lg text-[14px] leading-5 text-text-primary transition-colors hover:bg-surface-hover disabled:cursor-default disabled:hover:bg-transparent"
          style={{ gap: 8, height: 30, paddingLeft: canExpand ? 4 : 0, paddingRight: 8 }}
        >
          {canExpand && (expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
          <span className="truncate">文件变更</span>
          <span className="kimix-tabular-nums shrink-0 text-[13.5px] text-text-muted">{files.length} 个</span>
          <span className="kimix-tabular-nums shrink-0 text-accent-success">+{additions}</span>
          <span className="kimix-tabular-nums shrink-0 text-accent-danger">-{deletions}</span>
        </button>
        <button
          type="button"
          onClick={() => void handleRevert(files)}
          disabled={!projectPath || reverting || files.length === 0}
          className="flex shrink-0 items-center justify-self-end rounded-md text-[12.5px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text-secondary disabled:cursor-not-allowed disabled:opacity-45"
          style={{ gap: 6, height: 30, paddingLeft: 12, paddingRight: 12, minWidth: 92 }}
          title="撤销全部文件"
        >
          <span>{reverting ? "撤销中" : "全部撤销"}</span>
          <RotateCcw size={13} />
        </button>
      </div>
      <div>
        {visibleFiles.map((file) => renderFileRow(file))}
        {hiddenFileCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex min-h-10 w-full items-center border-b border-border-subtle text-left text-[13.5px] text-text-secondary transition-colors hover:bg-surface-hover"
            style={{ paddingLeft: 26, paddingRight: 18, gap: 8 }}
          >
            <ChevronDown size={14} />
            <span>再显示 {hiddenFileCount} 个文件</span>
          </button>
        )}
        {expanded && canExpand && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="flex min-h-10 w-full items-center text-left text-[13.5px] text-text-secondary transition-colors hover:bg-surface-hover"
            style={{ paddingLeft: 26, paddingRight: 18, gap: 8 }}
          >
            <ChevronUp size={14} />
            <span>收起 {collapsibleFileCount} 个文件</span>
          </button>
        )}
      </div>
      {error && (
        <div className="border-t border-border-subtle text-[13px] leading-5 text-accent-danger" style={{ padding: "10px 22px" }}>
          撤销失败：{error}
        </div>
      )}
    </div>
  );
});
