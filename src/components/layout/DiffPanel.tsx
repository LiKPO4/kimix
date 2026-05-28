import { X } from "lucide-react";
import { formatReleaseDate } from "@/utils/format";
import { buildUnifiedDiff, type SessionDiffEntry } from "@/utils/diff";

function renderUnifiedDiff(oldText: string, newText: string) {
  const diff = buildUnifiedDiff(oldText, newText);
  if (diff.length === 0) {
    return (
      <div className="text-[12.5px] leading-6 text-text-muted" style={{ padding: "12px 14px" }}>
        没有可展示的文本差异。
      </div>
    );
  }
  return diff.map((line, index) => {
    const isAdded = line.kind === "added";
    const isRemoved = line.kind === "removed";
    const sign = isAdded ? "+" : isRemoved ? "-" : " ";
    return (
      <div
        key={`${line.kind}-${line.oldNumber ?? ""}-${line.newNumber ?? ""}-${index}`}
        className="grid min-w-0 grid-cols-[20px_42px_1fr] font-mono text-[12px] leading-5"
        style={{
          backgroundColor: isAdded ? "var(--accent-success-light)" : isRemoved ? "var(--accent-danger-light)" : "transparent",
          color: isAdded ? "var(--accent-success)" : isRemoved ? "var(--accent-danger)" : "var(--text-secondary)",
          padding: "3px 8px",
        }}
      >
        <span className="select-none text-center font-semibold">{sign}</span>
        <span className="select-none text-right text-text-muted" style={{ paddingRight: 10 }}>
          {line.newNumber ?? line.oldNumber ?? ""}
        </span>
        <span className="min-w-0 whitespace-pre-wrap break-words">
          {line.text || " "}
        </span>
      </div>
    );
  });
}

interface DiffPanelProps {
  width: number;
  diffs: SessionDiffEntry[];
  onClose: () => void;
  onOpenFile: (filePath: string) => void;
}

export function DiffPanel({ width, diffs, onClose, onOpenFile }: DiffPanelProps) {
  return (
    <aside style={{ width, backgroundColor: "var(--surface-base)" }} className="kimix-diff-panel flex h-full shrink-0 flex-col overflow-hidden rounded-[20px] border border-border-subtle shadow-[0_1px_2px_rgba(25,23,20,0.04)]">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle" style={{ paddingLeft: 18, paddingRight: 14 }}>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold leading-5 text-text-primary">差异面板</div>
          <div className="mt-0.5 truncate text-[12.5px] leading-5 text-text-muted">
            {diffs.length > 0 ? `${diffs.length} 条最近变更` : "当前会话还没有 diff 记录"}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="kimix-muted-action flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          aria-label="关闭差异面板"
          title="关闭"
        >
          <X size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ paddingLeft: 18, paddingRight: 18, paddingTop: 12, paddingBottom: 18 }}>
        {diffs.length > 0 ? (
          <div className="flex flex-col" style={{ gap: 14 }}>
            {diffs.map((diff) => (
              <section key={diff.id} className="kimix-soft-card rounded-xl" style={{ padding: "16px 16px 18px" }}>
                <div className="flex items-start justify-between" style={{ gap: 10 }}>
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-medium leading-5 text-text-primary">{diff.filePath}</div>
                    <div className="mt-1 text-[12px] leading-5 text-text-muted">
                      +{diff.additions} / -{diff.deletions} · {formatReleaseDate(new Date(diff.timestamp).toISOString())}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenFile(diff.filePath)}
                    className="kimix-icon-text-button kimix-muted-action is-compact shrink-0"
                  >
                    打开
                  </button>
                </div>
                <div className="mt-4 overflow-hidden rounded-lg border border-border-subtle bg-surface-elevated">
                  <div className="flex items-center justify-between border-b border-border-subtle bg-surface-base text-[12px] font-medium leading-5 text-text-secondary" style={{ gap: 10, padding: "10px 12px" }}>
                    <span>行级差异</span>
                    <span className="shrink-0 text-text-muted">+{diff.additions} / -{diff.deletions}</span>
                  </div>
                  <div className="max-h-[520px] overflow-auto" style={{ paddingTop: 8, paddingBottom: 8 }}>
                    {renderUnifiedDiff(diff.oldText, diff.newText)}
                  </div>
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="kimix-soft-card rounded-xl text-[13.5px] leading-6" style={{ padding: "18px 16px" }}>
            当工具调用返回结构化 diff 后，这里会按时间展示文件变更明细。
          </div>
        )}
      </div>
    </aside>
  );
}
