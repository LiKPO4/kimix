import { ChevronDown, ChevronRight, ChevronUp, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
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
          backgroundColor: isRemoved ? "#fff1ed" : isAdded ? "#ecf8ef" : isBlank ? "#faf8f4" : "transparent",
          color: isRemoved ? "#8f321f" : isAdded ? "#1f6f35" : "#5f564d",
        }}
      >
        <span className="select-none text-right text-[#aaa49a]" style={{ paddingRight: 10 }}>
          {isBlank ? "" : index + 1}
        </span>
        <span className="whitespace-pre-wrap break-words" style={{ paddingLeft: 8, paddingRight: 8 }}>
          {isBlank ? " " : text || " "}
        </span>
      </div>
    );
  });
}

export function ChangeCard({ changes, event }: ChangeCardProps) {
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
    const diffExpanded = Boolean(expandedDiffs[key]);
    const diffLines = oldText !== undefined || newText !== undefined ? buildLineDiff(oldText, newText) : [];
    return (
      <div key={file.path} className="border-b border-[#f0ece5] last:border-b-0">
        <div className="flex min-h-11 items-center" style={{ paddingLeft: 18, paddingRight: 18, gap: 12 }}>
          <button
            type="button"
            onClick={() => setExpandedDiffs((state) => ({ ...state, [key]: !state[key] }))}
            className="flex min-w-0 flex-1 items-center rounded-lg text-left transition-colors hover:bg-[#faf8f4]"
            style={{ gap: 8, padding: "6px 8px" }}
            title="展开查看 diff"
          >
            {diffExpanded ? <ChevronDown size={14} className="shrink-0 text-[#8a847a]" /> : <ChevronRight size={14} className="shrink-0 text-[#8a847a]" />}
            <span className="min-w-0 flex-1 truncate text-[14px] text-[#24211d]">{file.path}</span>
          </button>
          <span className="shrink-0 text-[13.5px] text-[#009a44]">+{file.additions ?? 0}</span>
          <span className="shrink-0 text-[13.5px] text-[#d83b01]">-{file.deletions ?? 0}</span>
          <button
            type="button"
            onClick={() => void handleRevert([file])}
            disabled={!projectPath || reverting}
            className="flex h-8 shrink-0 items-center rounded-md text-[12.5px] text-[#8a847a] transition-colors hover:bg-[#f3f1ec] hover:text-[#3a362f] disabled:cursor-not-allowed disabled:opacity-45"
            style={{ gap: 6, paddingLeft: 10, paddingRight: 10 }}
            title="撤销此文件"
          >
            <span>{reverting ? "撤销中" : "撤销"}</span>
            <RotateCcw size={13} />
          </button>
        </div>
        {diffExpanded && (
          <div className="bg-[#fbfaf7]" style={{ padding: "0 18px 14px 40px" }}>
            {oldText !== undefined || newText !== undefined ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="overflow-hidden rounded-lg border border-[#f0d3ca] bg-white">
                  <div style={{ padding: "10px 12px" }} className="border-b border-[#f3ded8] text-[12px] font-medium leading-5 text-[#a15b42]">修改前</div>
                  <div className="max-h-72 overflow-auto" style={{ paddingTop: 8, paddingBottom: 8 }}>
                    {renderDiffColumn(diffLines, "old")}
                  </div>
                </div>
                <div className="overflow-hidden rounded-lg border border-[#cfe8d4] bg-white">
                  <div style={{ padding: "10px 12px" }} className="border-b border-[#dceedd] text-[12px] font-medium leading-5 text-[#328144]">修改后</div>
                  <div className="max-h-72 overflow-auto" style={{ paddingTop: 8, paddingBottom: 8 }}>
                    {renderDiffColumn(diffLines, "new")}
                  </div>
                </div>
                {/* keep old pre blocks unavailable: colored line diff above is the source of truth */}
                {false && (
                  <div className="rounded-lg border border-[#eee4d8] bg-white" style={{ padding: "12px 12px" }}>
                  <div className="text-[12px] font-medium leading-5 text-[#a15b42]">修改前</div>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-5 text-[#6f6258]">{oldText || "空"}</pre>
                  </div>
                )}
                {false && (
                  <div className="rounded-lg border border-[#dcebdc] bg-white" style={{ padding: "12px 12px" }}>
                  <div className="text-[12px] font-medium leading-5 text-[#328144]">修改后</div>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-5 text-[#4f6f58]">{newText || "空"}</pre>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[#e8e3da] bg-white text-[13px] leading-6 text-[#8a847a]" style={{ padding: "12px 13px" }}>
                当前事件只提供了文件汇总，暂时没有结构化 diff；可以打开右侧差异面板查看已捕获的详细 diff。
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full overflow-hidden rounded-[14px] border border-[#e8e3da] bg-white">
      <div className="flex min-h-14 items-center border-b border-[#eee9e1]" style={{ paddingLeft: 18, paddingRight: 18, gap: 12 }}>
        <button
          type="button"
          onClick={() => canExpand && setExpanded((value) => !value)}
          disabled={!canExpand}
          className="flex h-8 min-w-0 items-center rounded-lg text-[15px] leading-6 text-[#24211d] transition-colors hover:bg-[#f3f1ec] disabled:cursor-default disabled:hover:bg-transparent"
          style={{ gap: 8, paddingLeft: canExpand ? 4 : 0, paddingRight: 8 }}
        >
          {canExpand && (expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
          <span className="truncate">{files.length} 个文件已更改</span>
          <span className="shrink-0 text-[#009a44]">+{additions}</span>
          <span className="shrink-0 text-[#d83b01]">-{deletions}</span>
        </button>
        <div className="min-w-0 flex-1" />
        {files.length > 1 && (
          <button
            type="button"
            onClick={() => void handleRevert(files)}
            disabled={!projectPath || reverting}
            className="flex h-8 shrink-0 items-center rounded-md text-[12.5px] text-[#8a847a] transition-colors hover:bg-[#f3f1ec] hover:text-[#3a362f] disabled:cursor-not-allowed disabled:opacity-45"
            style={{ gap: 6, paddingLeft: 10, paddingRight: 10 }}
            title="撤销全部文件"
          >
            <span>{reverting ? "撤销中" : "全部撤销"}</span>
            <RotateCcw size={13} />
          </button>
        )}
      </div>
      <div>
        {visibleFiles.map((file) => renderFileRow(file))}
        {hiddenFileCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex min-h-10 w-full items-center border-b border-[#f0ece5] text-left text-[13.5px] text-[#706b63] transition-colors hover:bg-[#faf8f4]"
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
            className="flex min-h-10 w-full items-center text-left text-[13.5px] text-[#706b63] transition-colors hover:bg-[#faf8f4]"
            style={{ paddingLeft: 26, paddingRight: 18, gap: 8 }}
          >
            <ChevronUp size={14} />
            <span>收起 {collapsibleFileCount} 个文件</span>
          </button>
        )}
      </div>
      {error && (
        <div className="border-t border-[#f0ece5] text-[13px] leading-5 text-[#b42318]" style={{ padding: "10px 22px" }}>
          撤销失败：{error}
        </div>
      )}
    </div>
  );
}
