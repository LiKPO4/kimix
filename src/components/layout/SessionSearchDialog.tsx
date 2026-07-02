import { useEffect, useMemo, useRef, useState } from "react";
import { Folder, Search, X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import { searchSessions } from "@/utils/sessionSearch";

function projectName(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

function relativeTime(timestamp: number) {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时`;
  return new Date(timestamp).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export function SessionSearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sessions = useSessionStore((state) => state.sessions);
  const recentProjects = useSessionStore((state) => state.recentProjects);
  const currentSession = useAppStore((state) => state.currentSession);
  const setCurrentProject = useAppStore((state) => state.setCurrentProject);
  const setCurrentSession = useAppStore((state) => state.setCurrentSession);
  const setWorkspaceView = useAppStore((state) => state.setWorkspaceView);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const results = useMemo(() => searchSessions(
    sessions.filter((session) => !isHiddenInternalSession(session)),
    query,
  ), [query, sessions]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIndex(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(0, results.length - 1)));
  }, [results.length]);

  if (!open) return null;

  const select = (index: number) => {
    const target = results[index]?.session;
    if (!target) return;
    const project = recentProjects.find((item) => item.path.toLocaleLowerCase() === target.projectPath.toLocaleLowerCase()) ?? {
      id: target.projectPath,
      name: projectName(target.projectPath),
      path: target.projectPath,
      lastOpenedAt: Date.now(),
    };
    setCurrentProject(project);
    setCurrentSession(target);
    setWorkspaceView("chat");
    onClose();
  };

  const move = (delta: number) => {
    if (!results.length) return;
    const next = (selectedIndex + delta + results.length) % results.length;
    setSelectedIndex(next);
    window.setTimeout(() => listRef.current?.querySelector<HTMLElement>(`[data-session-index="${next}"]`)?.scrollIntoView({ block: "nearest" }), 0);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/20" style={{ padding: "12vh 20px 20px" }} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-label="搜索会话" aria-modal="true" role="dialog" className="w-full max-w-[680px] overflow-hidden rounded-lg border border-[var(--kimix-panel-border)] bg-[var(--kimix-panel-bg)] shadow-2xl">
        <div className="grid items-center border-b border-[var(--kimix-panel-divider)]" style={{ gridTemplateColumns: "20px minmax(0, 1fr) 34px", columnGap: 12, padding: "16px 18px" }}>
          <Search size={18} className="text-[var(--kimix-panel-text-muted)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0); }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
              else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
              else if (event.key === "Enter") { event.preventDefault(); select(selectedIndex); }
              else if (event.key === "Escape") { event.preventDefault(); onClose(); }
            }}
            placeholder="搜索标题、项目或最近提示词"
            className="min-w-0 border-0 bg-transparent text-[16px] text-[var(--kimix-panel-text)] outline-none placeholder:text-[var(--kimix-panel-text-muted)]"
          />
          <button type="button" title="关闭" onClick={onClose} className="flex h-[34px] w-[34px] items-center justify-center rounded-md text-[var(--kimix-panel-text-muted)] hover:bg-[var(--kimix-panel-hover)] hover:text-[var(--kimix-panel-text)]">
            <X size={16} />
          </button>
        </div>

        <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: 460, padding: "12px 12px" }}>
          {results.length ? (
            <div className="flex flex-col" style={{ gap: 8 }}>
              {results.map(({ session, lastPrompt }, index) => (
                <button
                  key={session.id}
                  data-session-index={index}
                  type="button"
                  onMouseMove={() => setSelectedIndex(index)}
                  onClick={() => select(index)}
                  className={`grid w-full rounded-md border text-left transition-colors ${index === selectedIndex ? "border-[var(--kimix-panel-border)] bg-[var(--kimix-panel-hover)]" : "border-transparent bg-transparent hover:bg-[var(--kimix-panel-soft-bg)]"}`}
                  style={{ gridTemplateColumns: "minmax(0, 1fr) auto", columnGap: 16, padding: "11px 14px" }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium leading-5 text-[var(--kimix-panel-text)]">{session.title || "新会话"}</span>
                    {lastPrompt && <span className="mt-1 block truncate text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">{lastPrompt}</span>}
                    <span className="mt-1 flex min-w-0 items-center text-[11.5px] leading-5 text-[var(--kimix-panel-text-muted)]" style={{ gap: 6 }}>
                      <Folder size={13} className="shrink-0" />
                      <span className="truncate">{projectName(session.projectPath)}</span>
                    </span>
                  </span>
                  <span className="self-start whitespace-nowrap pt-[1px] text-[11.5px] tabular-nums text-[var(--kimix-panel-text-muted)]">{currentSession?.id === session.id ? "当前" : relativeTime(session.updatedAt)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex h-[180px] items-center justify-center text-[13px] text-[var(--kimix-panel-text-muted)]">没有匹配的会话</div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--kimix-panel-divider)] text-[11.5px] text-[var(--kimix-panel-text-muted)]" style={{ minHeight: 42, padding: "8px 18px" }}>
          <span>↑↓ 选择 · Enter 打开</span>
          <span>{results.length} 个会话</span>
        </div>
      </section>
    </div>
  );
}
