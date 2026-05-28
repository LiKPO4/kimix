import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, MessageSquare, Search, X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Session, TimelineEvent } from "@/types/ui";
import { mapHistoryEvents } from "@/utils/eventMapper";
import { deriveSessionTitle } from "@/utils/sessionTitle";
import { isHiddenInternalSession } from "@/utils/internalSessions";

type SearchMatch = {
  session: Session;
  kind: string;
  text: string;
  timestamp: number;
};

function eventText(event: TimelineEvent): { kind: string; text: string }[] {
  if (event.type === "user_message") return [{ kind: "用户消息", text: event.content }];
  if (event.type === "steer_message") return [{ kind: "引导消息", text: event.content }];
  if (event.type === "assistant_message") {
    return [
      { kind: "回复", text: event.content },
      { kind: "思考", text: event.thinking ?? "" },
    ];
  }
  if (event.type === "tool_call") return [{ kind: "工具", text: `${event.toolName} ${event.rawArguments ?? JSON.stringify(event.arguments)}` }];
  if (event.type === "status_update") return [{ kind: "状态", text: event.message ?? "" }];
  if (event.type === "error") return [{ kind: "错误", text: event.message }];
  if (event.type === "todo") return [{ kind: "Todo", text: event.items.map((item) => item.content).join("\n") }];
  if (event.type === "diff") return [{ kind: "变更", text: `${event.filePath}\n${event.oldText}\n${event.newText}` }];
  return [];
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const currentProject = useAppStore((s) => s.currentProject);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const sessions = useSessionStore((s) => s.sessions);
  const addSession = useSessionStore((s) => s.addSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const [query, setQuery] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open || !currentProject) return;
    let cancelled = false;
    void window.api.listSessions({ workDir: currentProject.path }).then((res) => {
      if (cancelled || !res.success) return;
      const knownIds = new Set(useSessionStore.getState().sessions.map((session) => session.id));
      for (const item of res.data) {
        if (isHiddenInternalSession(item)) continue;
        if (knownIds.has(item.id)) continue;
        addSession({
          id: item.id,
          title: item.brief || "历史对话",
          projectPath: item.workDir || currentProject.path,
          createdAt: item.updatedAt,
          updatedAt: item.updatedAt,
          events: [],
          isLoading: false,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, currentProject?.path, addSession]);

  useEffect(() => {
    if (!open || !currentProject) return;
    const unloaded = sessions
      .filter((session) => session.projectPath === currentProject.path && session.events.length === 0)
      .filter((session) => !isHiddenInternalSession(session))
      .slice(0, 12);
    if (unloaded.length === 0) return;
    let cancelled = false;
    setLoadingHistory(true);
    Promise.all(unloaded.map(async (session) => {
      const loaded = await window.api.loadSession({ workDir: session.projectPath, sessionId: session.id });
      if (!loaded.success || cancelled) return;
      const events = mapHistoryEvents(Array.isArray(loaded.data.events) ? loaded.data.events : []);
      if (isHiddenInternalSession({ ...session, events })) return;
      updateSession(session.id, (current) => ({
        ...current,
        events,
        title: deriveSessionTitle(events, current.title),
        isLoading: false,
        updatedAt: Date.now(),
      }));
    })).finally(() => {
      if (!cancelled) setLoadingHistory(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, currentProject?.path, sessions, updateSession]);

  const projectSessions = useMemo(() => {
    return sessions
      .filter((session) => !session.archivedAt && (!currentProject || session.projectPath === currentProject.path))
      .filter((session) => !isHiddenInternalSession(session))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [sessions, currentProject]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all: SearchMatch[] = [];
    for (const session of projectSessions) {
      if (!q) {
        all.push({ session, kind: "最近对话", text: session.title, timestamp: session.updatedAt });
        continue;
      }
      if (session.title.toLowerCase().includes(q)) {
        all.push({ session, kind: "标题", text: session.title, timestamp: session.updatedAt });
      }
      for (const event of session.events) {
        for (const item of eventText(event)) {
          const text = compact(item.text);
          if (text && text.toLowerCase().includes(q)) {
            all.push({ session, kind: item.kind, text, timestamp: event.timestamp });
          }
        }
      }
    }
    return all.slice(0, 24);
  }, [projectSessions, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[85] flex items-start justify-center bg-black/20 px-5" style={{ paddingTop: 86 }} onMouseDown={onClose}>
      <div className="w-full max-w-[720px] overflow-hidden rounded-[18px] border border-border-default bg-surface-elevated shadow-floating-token" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex h-14 items-center border-b border-border-subtle" style={{ gap: 12, paddingLeft: 20, paddingRight: 16 }}>
          <Search size={18} className="shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "Enter" && matches[0]) {
                setCurrentSession(matches[0].session);
                onClose();
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-[16px] text-text-primary outline-none placeholder:text-text-muted"
            placeholder="搜索对话、回复、思考、工具和状态"
          />
          <button className="flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover" onClick={onClose} aria-label="关闭搜索">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[560px] overflow-y-auto" style={{ padding: 12 }}>
          <div className="px-2 pb-2 text-[13px] text-text-muted">
            {loadingHistory ? "正在补充加载最近历史..." : query.trim() ? `${matches.length} 条匹配` : "最近对话"}
          </div>
          {matches.length > 0 ? matches.map((match, index) => (
            <button
              key={`${match.session.id}-${match.kind}-${match.timestamp}-${index}`}
              onClick={() => {
                setCurrentSession(match.session);
                onClose();
              }}
              className="flex min-h-12 w-full items-center rounded-xl text-left transition-colors hover:bg-surface-hover"
              style={{ gap: 12, paddingLeft: 14, paddingRight: 14, paddingTop: 9, paddingBottom: 9 }}
            >
              {match.kind === "最近对话" || match.kind === "标题" ? <MessageSquare size={16} className="shrink-0 text-text-muted" /> : <FileText size={16} className="shrink-0 text-text-muted" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] text-text-primary">{match.session.title}</span>
                <span className="mt-1 block truncate text-[13px] text-text-muted">{match.kind} · {match.text}</span>
              </span>
              <span className="shrink-0 text-[12px] text-text-muted">Ctrl+{Math.min(index + 1, 9)}</span>
            </button>
          )) : (
            <div className="rounded-xl bg-surface-base text-center text-[14px] text-text-muted" style={{ padding: 28 }}>
              没有找到匹配内容
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
