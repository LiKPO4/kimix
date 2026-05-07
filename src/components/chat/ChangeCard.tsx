import { Undo2, ExternalLink, ChevronDown, FileCode, Plus, Minus } from "lucide-react";
import { useState } from "react";

interface Change {
  path: string;
  oldText?: string;
  newText?: string;
}

interface ChangeCardProps {
  changes: Change[];
}

function DiffViewer({ oldText, newText }: { oldText?: string; newText?: string }) {
  if (!oldText && !newText) return null;

  const oldLines = (oldText ?? "").split("\n");
  const newLines = (newText ?? "").split("\n");

  // Simple line-by-line diff
  const diffLines: { type: "same" | "removed" | "added"; oldLine?: string; newLine?: string }[] = [];

  let oldIdx = 0, newIdx = 0;
  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    const o = oldLines[oldIdx];
    const n = newLines[newIdx];
    if (o === n) {
      diffLines.push({ type: "same", oldLine: o, newLine: n });
      oldIdx++;
      newIdx++;
    } else if (oldIdx < oldLines.length && (newIdx >= newLines.length || oldLines.slice(oldIdx).indexOf(n) === -1)) {
      diffLines.push({ type: "removed", oldLine: o });
      oldIdx++;
    } else {
      diffLines.push({ type: "added", newLine: n });
      newIdx++;
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-border-default overflow-hidden bg-bg-primary">
      <div className="flex text-xs">
        <div className="flex-1 border-r border-border-default">
          <div className="px-3 py-1.5 bg-bg-tertiary text-text-muted font-medium border-b border-border-default">旧版本</div>
          <div className="font-mono text-xs leading-5">
            {diffLines.map((line, i) => (
              <div
                key={`old-${i}`}
                className={`px-3 ${line.type === "removed" ? "bg-accent-red/5 text-accent-red" : line.type === "same" ? "text-text-secondary" : "text-text-muted/30"}`}
              >
                {line.oldLine !== undefined ? line.oldLine : " "}
              </div>
            ))}
          </div>
        </div>
        <div className="flex-1">
          <div className="px-3 py-1.5 bg-bg-tertiary text-text-muted font-medium border-b border-border-default">新版本</div>
          <div className="font-mono text-xs leading-5">
            {diffLines.map((line, i) => (
              <div
                key={`new-${i}`}
                className={`px-3 ${line.type === "added" ? "bg-accent-green/5 text-accent-green" : line.type === "same" ? "text-text-secondary" : "text-text-muted/30"}`}
              >
                {line.newLine !== undefined ? line.newLine : " "}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChangeCard({ changes }: ChangeCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [showDiff, setShowDiff] = useState<Record<number, boolean>>({});

  const totalAdditions = changes.filter((c) => c.newText && (!c.oldText || c.newText.length > c.oldText.length)).length;
  const totalDeletions = changes.filter((c) => c.oldText && (!c.newText || c.oldText.length > c.newText.length)).length;

  return (
    <div className="flex justify-center">
      <div className="max-w-[95%] w-full rounded-xl border border-border-default bg-bg-secondary overflow-hidden">
        {/* Header */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-tertiary/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <FileCode size={16} className="text-accent-blue" />
            <span className="text-sm font-medium text-text-primary">{changes.length} 个文件已更改</span>
            <div className="flex items-center gap-1.5 text-xs">
              {totalAdditions > 0 && (
                <span className="flex items-center gap-0.5 text-accent-green">
                  <Plus size={12} />{totalAdditions}
                </span>
              )}
              {totalDeletions > 0 && (
                <span className="flex items-center gap-0.5 text-accent-red">
                  <Minus size={12} />{totalDeletions}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-bg-tertiary text-xs text-text-secondary transition-colors"
            >
              <Undo2 size={12} />
              <span>撤销</span>
            </button>
            <button
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-bg-tertiary text-xs text-text-secondary transition-colors"
            >
              <ExternalLink size={12} />
              <span>审核</span>
            </button>
            <ChevronDown size={14} className={`text-text-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
          </div>
        </button>

        {/* File list */}
        {expanded && (
          <div className="px-4 pb-3 space-y-2">
            {changes.map((change, i) => (
              <div key={i} className="space-y-1">
                <button
                  onClick={() => setShowDiff((prev) => ({ ...prev, [i]: !prev[i] }))}
                  className="w-full flex items-center justify-between py-1.5 text-xs hover:bg-bg-tertiary/30 rounded-lg px-2 transition-colors"
                >
                  <span className="text-text-secondary truncate font-mono">{change.path}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {change.newText && (!change.oldText || change.newText.length > (change.oldText?.length ?? 0)) && (
                      <span className="text-accent-green font-medium">+{change.newText.split("\n").length}</span>
                    )}
                    {change.oldText && (!change.newText || (change.oldText?.length ?? 0) > change.newText.length) && (
                      <span className="text-accent-red font-medium">-{change.oldText.split("\n").length}</span>
                    )}
                    <ChevronDown size={12} className={`text-text-muted transition-transform ${showDiff[i] ? "rotate-180" : ""}`} />
                  </div>
                </button>
                {showDiff[i] && <DiffViewer oldText={change.oldText} newText={change.newText} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
