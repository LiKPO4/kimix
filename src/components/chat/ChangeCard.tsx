import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { useState } from "react";
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

function countLines(value?: string) {
  if (!value) return 0;
  return value.split("\n").filter(Boolean).length;
}

export function ChangeCard({ changes, event }: ChangeCardProps) {
  const currentSession = useAppStore((s) => s.currentSession);
  const project = useAppStore((s) => s.currentProject);
  const updateSession = useSessionStore((s) => s.updateSession);
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const files = event?.files ?? (changes ?? []).map((change) => ({
    path: change.path,
    additions: change.additions ?? Math.max(0, countLines(change.newText) - countLines(change.oldText)),
    deletions: change.deletions ?? Math.max(0, countLines(change.oldText) - countLines(change.newText)),
  }));
  const additions = event?.additions ?? files.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const deletions = event?.deletions ?? files.reduce((sum, file) => sum + (file.deletions ?? 0), 0);
  const projectPath = event?.projectPath ?? project?.path;

  const handleRevert = async () => {
    if (!projectPath || files.length === 0 || reverting) return;
    setReverting(true);
    setError("");
    const res = await window.api.revertFiles({ projectPath, files: files.map((file) => file.path) });
    setReverting(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    if (currentSession && event) {
      updateSession(currentSession.id, (session) => ({
        ...session,
        events: session.events.filter((item) => item.id !== event.id),
        updatedAt: Date.now(),
      }));
    }
  };

  const renderFileRow = (file: { path: string; additions?: number; deletions?: number }, showChevron = true) => (
    <div
      key={file.path}
      className="flex min-h-11 items-center border-b border-[#f0ece5] last:border-b-0"
      style={{ paddingLeft: 22, paddingRight: 30 }}
    >
      <span className="min-w-0 flex-1 truncate text-[14.5px] text-[#24211d]">{file.path}</span>
      <span className="shrink-0 text-[14px] text-[#009a44]">+{file.additions ?? 0}</span>
      <span className="shrink-0 text-[14px] text-[#d83b01]" style={{ marginLeft: 10 }}>-{file.deletions ?? 0}</span>
      {showChevron && <ChevronDown size={15} className="shrink-0 text-[#8f887e]" style={{ marginLeft: 18 }} />}
    </div>
  );

  return (
    <div className="w-full overflow-hidden rounded-[14px] border border-[#e8e3da] bg-white">
      <div className="flex min-h-12 items-center border-b border-[#eee9e1]" style={{ paddingLeft: 22, paddingRight: 30 }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex h-8 items-center rounded-lg text-[15px] leading-6 text-[#24211d] transition-colors hover:bg-[#f3f1ec]"
          style={{ gap: 8, paddingLeft: 4, paddingRight: 8 }}
        >
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <span>{files.length} 个文件已更改</span>
          <span className="text-[#009a44]">+{additions}</span>
          <span className="text-[#d83b01]">-{deletions}</span>
        </button>
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          onClick={handleRevert}
          disabled={!projectPath || reverting}
          className="flex h-8 shrink-0 items-center rounded-lg text-[13px] text-[#8a847a] transition-colors hover:bg-[#f3f1ec] hover:text-[#3a362f] disabled:cursor-not-allowed disabled:opacity-45"
          style={{ gap: 7, paddingLeft: 10, paddingRight: 12 }}
        >
          <span>{reverting ? "撤销中" : "撤销"}</span>
          <RotateCcw size={14} />
        </button>
      </div>
      <div>
        {expanded ? (
          files.map((file) => renderFileRow(file))
        ) : (
          <>
            {files.length > 0 && renderFileRow(files[0])}
            {files.length > 1 && (
              <div
                className="flex min-h-11 items-center border-b border-[#f0ece5] last:border-b-0"
                style={{ paddingLeft: 22, paddingRight: 30 }}
              >
                <span className="text-[14.5px] text-[#8a847a]">……</span>
              </div>
            )}
          </>
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
