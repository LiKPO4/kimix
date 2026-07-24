import { ChevronDown, ChevronRight, ChevronUp, Loader2, RotateCcw } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { normalizePathForComparison } from "@/utils/pathCase";
import type { TimelineEvent } from "@/types/ui";
import { sha256Hex } from "@/utils/hash";
import { countUnifiedDiffChanges } from "@/utils/diff";
import { findDiffForChangeFile } from "@/utils/changePreview";

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
  diffEventId?: string;
  commitSha?: string;
  sourceEventIds?: string[];
};

function stripOuterQuotes(value: string) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizePath(value: string, projectPath?: string) {
  const path = stripOuterQuotes(value).replace(/\\/g, "/");
  if (!projectPath || /^(?:[a-z]:\/|\/)/i.test(path)) return normalizePathForComparison(path);
  return normalizePathForComparison(`${projectPath.replace(/[\\/]+$/, "")}/${path}`);
}

function formatPathForDisplay(value: string, projectPath?: string) {
  const path = stripOuterQuotes(value).replace(/\\/g, "/");
  const root = projectPath ? normalizePathForComparison(projectPath).replace(/\/+$/, "") : "";
  const normalized = normalizePathForComparison(path);
  if (root && (normalized === root || normalized.startsWith(`${root}/`))) {
    return path.slice(root.length + 1);
  }
  return path;
}

function mergeChangeRows(rows: ChangeRow[], projectPath?: string) {
  const byPath = new Map<string, ChangeRow>();
  rows.forEach((row) => {
    const key = normalizePath(row.path, projectPath);
    const existing = byPath.get(key);
    const stats = row.additions === undefined && row.deletions === undefined && (row.oldText !== undefined || row.newText !== undefined)
      ? countUnifiedDiffChanges(row.oldText, row.newText)
      : undefined;
    const additions = row.additions ?? stats?.additions;
    const deletions = row.deletions ?? stats?.deletions;
    byPath.set(key, {
      path: existing?.path ?? row.path,
      oldText: existing?.oldText ?? row.oldText,
      newText: row.newText ?? existing?.newText,
      additions: existing
        ? existing.additions === undefined || additions === undefined ? undefined : existing.additions + additions
        : additions,
      deletions: existing
        ? existing.deletions === undefined || deletions === undefined ? undefined : existing.deletions + deletions
        : deletions,
      diffEventId: row.diffEventId ?? existing?.diffEventId,
      commitSha: row.commitSha ?? existing?.commitSha,
      sourceEventIds: Array.from(new Set([...(existing?.sourceEventIds ?? []), ...(row.sourceEventIds ?? [])])),
    });
  });
  return Array.from(byPath.values());
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

function renderGitPatch(patch: string) {
  return patch.split(/\r?\n/).map((line, index) => {
    const isHeader = line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ");
    const isHunk = line.startsWith("@@");
    const isAdded = line.startsWith("+") && !line.startsWith("+++");
    const isRemoved = line.startsWith("-") && !line.startsWith("---");
    return (
      <div
        key={`${index}-${line.slice(0, 24)}`}
        className="whitespace-pre-wrap break-words font-mono text-[12px] leading-5"
        style={{
          minHeight: 20,
          paddingLeft: 12,
          paddingRight: 12,
          color: isAdded
            ? "var(--accent-success)"
            : isRemoved
              ? "var(--accent-danger)"
              : isHunk || isHeader
                ? "var(--text-muted)"
                : "var(--text-secondary)",
          backgroundColor: isAdded
            ? "var(--accent-success-light)"
            : isRemoved
              ? "var(--accent-danger-light)"
              : "transparent",
        }}
      >
        {line || " "}
      </div>
    );
  });
}

export const ChangeCard = memo(function ChangeCard({ changes, event }: ChangeCardProps) {
  const currentSession = useAppStore((s) => s.currentSession);
  const project = useAppStore((s) => s.currentProject);
  const additionalWorkDirs = useAppStore((s) => s.additionalWorkDirs);
  const updateSession = useSessionStore((s) => s.updateSession);
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [expandedDiffs, setExpandedDiffs] = useState<Record<string, boolean>>({});
  const [loadedPreviews, setLoadedPreviews] = useState<Record<string, {
    patch: string;
    source: "commit" | "workspace";
    additions?: number;
    deletions?: number;
    commitSha?: string;
    truncated?: boolean;
  }>>({});
  const [previewLoading, setPreviewLoading] = useState<Record<string, boolean>>({});
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
  const [headerToggleActive, setHeaderToggleActive] = useState(false);
  const projectPath = event?.projectPath ?? project?.path;
  const baseFiles = useMemo(() => mergeChangeRows(event?.files ?? (changes ?? []).map((change) => ({
    path: change.path,
    oldText: change.oldText,
    newText: change.newText,
    additions: change.additions,
    deletions: change.deletions,
  })), projectPath), [changes, event?.files, projectPath]);
  const files = useMemo(() => baseFiles.map((file) => {
    const preview = loadedPreviews[normalizePath(file.path, projectPath)];
    return preview ? {
      ...file,
      additions: preview.additions ?? file.additions,
      deletions: preview.deletions ?? file.deletions,
      commitSha: preview.commitSha ?? file.commitSha,
    } : file;
  }), [baseFiles, loadedPreviews, projectPath]);
  const statsKnown = files.every((file) => file.additions !== undefined && file.deletions !== undefined);
  const additions = statsKnown ? files.reduce((sum, file) => sum + (file.additions ?? 0), 0) : undefined;
  const deletions = statsKnown ? files.reduce((sum, file) => sum + (file.deletions ?? 0), 0) : undefined;
  const canExpand = files.length > 3;
  const visibleFiles = expanded ? files : files.slice(0, 3);
  const hiddenFileCount = Math.max(0, files.length - visibleFiles.length);
  const collapsibleFileCount = Math.max(0, files.length - 3);
  const changesByPath = useMemo(() => {
    const map = new Map<string, Change>();
    files.forEach((change) => {
      if (change.oldText !== undefined || change.newText !== undefined) {
        map.set(normalizePath(change.path, projectPath), change);
      }
    });
    return map;
  }, [files, projectPath]);

  const removeRevertedFiles = (paths: string[]) => {
    if (!currentSession || !event) return;
    const reverted = new Set(paths.map((path) => normalizePath(path, projectPath)));
    const sourceEventIds = new Set(event.files.flatMap((file) => file.sourceEventIds ?? []));
    if (sourceEventIds.size === 0) sourceEventIds.add(event.id);
    updateSession(currentSession.id, (session) => ({
      ...session,
      events: session.events.flatMap<TimelineEvent>((item) => {
        if (item.type !== "change_summary") return [item];
        if (!sourceEventIds.has(item.id)) return [item];
        const nextFiles = item.files.filter((file) => !reverted.has(normalizePath(file.path, projectPath)));
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
    const maxListedFiles = 8;
    const listedFiles = targetFiles.slice(0, maxListedFiles).map((file) => file.path);
    const omittedCount = Math.max(0, targetFiles.length - listedFiles.length);
    const fileList = [
      ...listedFiles,
      omittedCount > 0 ? `…以及另外 ${omittedCount} 个文件` : "",
    ].filter(Boolean).join("\n");
    const confirmMessage = targetFiles.length === 1
      ? `确定要撤销以下文件吗？\n\n${fileList}\n\n此操作不可恢复。如果该文件在 Agent 修改后又被你手动编辑过，这些新修改也会被一并丢弃。`
      : `确定要撤销以下 ${targetFiles.length} 个文件吗？\n\n${fileList}\n\n此操作不可恢复。如果这些文件在 Agent 修改后又被你手动编辑过，这些新修改也会被一并丢弃。`;
    if (!window.confirm(confirmMessage)) return;
    setReverting(true);
    setError("");
    try {
      const filesWithSnapshot = await Promise.all(targetFiles.map(async (file) => {
        const key = normalizePath(file.path, projectPath);
        const diffEvent = currentSession && event
          ? findDiffForChangeFile(currentSession.events, event, file, projectPath)
          : null;
        const change = changesByPath.get(key);
        const newText = change?.newText ?? diffEvent?.newText;
        const snapshotHash = newText ? await sha256Hex(newText) : undefined;
        return {
          path: file.path,
          additions: file.additions,
          deletions: file.deletions,
          snapshotHash,
        };
      }));
      const conflictCheck = await window.api.checkRevertConflicts({
        projectPath,
        additionalWorkDirs,
        files: filesWithSnapshot.map((f) => ({ path: f.path, snapshotHash: f.snapshotHash })),
      });
      if (!conflictCheck.success) {
        setError(conflictCheck.error);
        setReverting(false);
        return;
      }
      if (conflictCheck.conflicts.length > 0) {
        const conflictPaths = conflictCheck.conflicts.slice(0, 6).map((c) => c.path);
        const moreCount = Math.max(0, conflictCheck.conflicts.length - conflictPaths.length);
        const conflictList = [
          ...conflictPaths,
          moreCount > 0 ? `…以及另外 ${moreCount} 个文件` : "",
        ].filter(Boolean).join("\n");
        const forceMessage = conflictCheck.conflicts.length === 1
          ? `以下文件在 Agent 修改后已被变更，撤销将覆盖这些新修改：\n\n${conflictList}\n\n确定要继续吗？`
          : `以下 ${conflictCheck.conflicts.length} 个文件在 Agent 修改后已被变更，撤销将覆盖这些新修改：\n\n${conflictList}\n\n确定要继续吗？`;
        if (!window.confirm(forceMessage)) {
          setReverting(false);
          return;
        }
      }
      const res = await window.api.revertFiles({
        projectPath,
        additionalWorkDirs,
        files: filesWithSnapshot,
        force: conflictCheck.conflicts.length > 0,
      });
      setReverting(false);
      if (!res.success) {
        setError(res.error);
        return;
      }
      removeRevertedFiles(targetFiles.map((file) => file.path));
    } catch (err) {
      setReverting(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleFilePreview = async (file: ChangeRow, hasStructuredDiff: boolean) => {
    const key = normalizePath(file.path, projectPath);
    if (hasStructuredDiff || loadedPreviews[key]) {
      setExpandedDiffs((state) => ({ ...state, [key]: !state[key] }));
      return;
    }
    if (!projectPath || previewLoading[key]) return;
    setPreviewLoading((state) => ({ ...state, [key]: true }));
    setPreviewErrors((state) => ({ ...state, [key]: "" }));
    try {
      const response = await window.api.getChangePreview({
        projectPath,
        filePath: file.path,
        eventTimestamp: event?.timestamp,
        commitSha: file.commitSha,
      });
      if (!response.success) throw new Error(response.error);
      const preview = response.data;
      if (preview.source === "unavailable" || !preview.patch) {
        setPreviewErrors((state) => ({ ...state, [key]: "未找到可确认属于本轮的差异。" }));
        return;
      }
      const previewSource: "commit" | "workspace" = preview.source;
      setLoadedPreviews((state) => ({
        ...state,
        [key]: {
          patch: preview.patch,
          source: previewSource,
          additions: preview.additions,
          deletions: preview.deletions,
          commitSha: preview.commitSha,
          truncated: preview.truncated,
        },
      }));
      if (currentSession && event && preview.source === "commit" && preview.commitSha) {
        const sourceEventIds = new Set(file.sourceEventIds?.length ? file.sourceEventIds : [event.id]);
        const normalizedFile = normalizePath(file.path, projectPath);
        updateSession(currentSession.id, (session) => ({
          ...session,
          events: session.events.map((item) => {
            if (item.type !== "change_summary" || !sourceEventIds.has(item.id)) return item;
            return {
              ...item,
              files: item.files.map((itemFile) => normalizePath(itemFile.path, projectPath) === normalizedFile
                ? { ...itemFile, commitSha: preview.commitSha }
                : itemFile),
            };
          }),
          updatedAt: Date.now(),
        }));
      }
      setExpandedDiffs((state) => ({ ...state, [key]: true }));
    } catch (previewError) {
      setPreviewErrors((state) => ({
        ...state,
        [key]: previewError instanceof Error ? previewError.message : String(previewError),
      }));
    } finally {
      setPreviewLoading((state) => ({ ...state, [key]: false }));
    }
  };

  const renderFileRow = (file: ChangeRow) => {
    const key = normalizePath(file.path, projectPath);
    const diffEvent = currentSession && event
      ? findDiffForChangeFile(currentSession.events, event, file, projectPath)
      : null;
    const change = changesByPath.get(key);
    const oldText = change?.oldText ?? diffEvent?.oldText;
    const newText = change?.newText ?? diffEvent?.newText;
    const hasStructuredDiff = oldText !== undefined || newText !== undefined;
    const loadedPreview = loadedPreviews[key];
    const diffExpanded = Boolean(expandedDiffs[key]) && (hasStructuredDiff || Boolean(loadedPreview));
    const diffLines = hasStructuredDiff ? buildLineDiff(oldText, newText) : [];
    const loading = Boolean(previewLoading[key]);
    const previewError = previewErrors[key];
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
            onClick={() => void toggleFilePreview(file, hasStructuredDiff)}
            className="flex min-w-0 flex-1 items-center rounded-lg text-left transition-colors hover:bg-surface-hover"
            style={{ gap: 8, padding: "6px 8px" }}
            title={`预览 ${file.path} 的本轮变更`}
          >
            {loading
              ? <Loader2 size={14} className="shrink-0 animate-spin text-text-muted" />
              : diffExpanded
                ? <ChevronDown size={14} className="shrink-0 text-text-muted" />
                : <ChevronRight size={14} className="shrink-0 text-text-muted" />}
            <span className="min-w-0 flex-1 truncate text-[14px] text-text-primary">{formatPathForDisplay(file.path, projectPath)}</span>
          </button>
          <div className="kimix-tabular-nums flex items-center justify-self-end text-[13.5px]" style={{ gap: 8, minWidth: 72 }}>
            {file.additions !== undefined && file.deletions !== undefined ? (
              <>
                <span className="text-accent-success">+{file.additions}</span>
                <span className="text-accent-danger">-{file.deletions}</span>
              </>
            ) : <span className="text-text-muted" title="点击预览后尝试恢复统计">统计待恢复</span>}
          </div>
          <button
            type="button"
            onClick={() => void toggleFilePreview(file, hasStructuredDiff)}
            disabled={loading}
            className="justify-self-end rounded-md text-[12.5px] leading-5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-secondary disabled:opacity-50"
            style={{ minHeight: 32, paddingLeft: 12, paddingRight: 12 }}
          >
            {loading ? "加载中" : diffExpanded ? "收起" : "预览"}
          </button>
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
        {!hasStructuredDiff && loadedPreview && diffExpanded && (
          <div className="bg-surface-base" style={{ padding: "0 18px 14px 40px" }}>
            <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-elevated">
              <div className="flex items-center justify-between border-b border-border-subtle text-[12px] leading-5 text-text-muted" style={{ minHeight: 36, paddingLeft: 12, paddingRight: 12, gap: 12 }}>
                <span>{loadedPreview.source === "commit" ? `提交 ${loadedPreview.commitSha?.slice(0, 7) ?? ""}` : "当前工作区差异"}</span>
                {loadedPreview.truncated && <span>内容过大，已截断</span>}
              </div>
              <div className="max-h-80 overflow-auto" style={{ paddingTop: 8, paddingBottom: 8 }}>
                {renderGitPatch(loadedPreview.patch)}
              </div>
            </div>
          </div>
        )}
        {previewError && (
          <div className="text-[12.5px] leading-5 text-text-muted" style={{ padding: "0 22px 12px 40px" }}>
            {previewError}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full overflow-hidden rounded-[14px] border border-border-subtle bg-surface-elevated">
      <div
        className="grid items-center border-b border-border-subtle"
        style={{
          gridTemplateColumns: "minmax(0, 1fr) auto",
          minHeight: 44,
          paddingLeft: 18,
          paddingRight: 18,
          columnGap: 14,
          backgroundColor: headerToggleActive ? "var(--surface-hover)" : "transparent",
          transition: "background-color var(--duration-base) var(--ease-hover)",
        }}
      >
        <button
          type="button"
          onClick={() => canExpand && setExpanded((value) => !value)}
          onMouseEnter={() => canExpand && setHeaderToggleActive(true)}
          onMouseLeave={() => setHeaderToggleActive(false)}
          onFocus={() => canExpand && setHeaderToggleActive(true)}
          onBlur={() => setHeaderToggleActive(false)}
          disabled={!canExpand}
          className="flex min-w-0 items-center text-[14px] leading-5 text-text-primary disabled:cursor-default"
          style={{ gap: 8, height: 30, paddingLeft: canExpand ? 4 : 0, paddingRight: 8 }}
          aria-expanded={canExpand ? expanded : undefined}
        >
          {canExpand && (expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
          <span className="truncate">文件变更</span>
          <span className="kimix-tabular-nums shrink-0 text-[13.5px] text-text-muted">{files.length} 个</span>
          {statsKnown ? (
            <>
              <span className="kimix-tabular-nums shrink-0 text-accent-success">+{additions}</span>
              <span className="kimix-tabular-nums shrink-0 text-accent-danger">-{deletions}</span>
            </>
          ) : <span className="shrink-0 text-[12.5px] text-text-muted">统计待恢复</span>}
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
