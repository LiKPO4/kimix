import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardCopy, FileText, Globe2, MessageSquare, Search, X } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Session, TimelineEvent } from "@/types/ui";
import type { KimiCodeSessionSummary } from "../../../electron/types/ipc";
import { mapHistoryEvents } from "@/utils/eventMapper";
import { deriveSessionTitle } from "@/utils/sessionTitle";
import { isHiddenInternalSession } from "@/utils/internalSessions";
import { getRuntimeSessionId } from "@/utils/runtimeSession";

type SearchMatch = {
  session: Session;
  kind: string;
  text: string;
  timestamp: number;
  eventId?: string;
  searchText?: string;
};

type SearchScope = "project" | "all";

type GlobalSessionMatch = {
  session: KimiCodeSessionSummary;
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

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function formatResumeCommand(session: KimiCodeSessionSummary): string {
  return `Set-Location -LiteralPath ${quotePowerShellLiteral(session.workDir)}; kimi -S ${session.id}`;
}

function loadWithTimeout(session: Session, timeoutMs = 8000) {
  return Promise.race([
    window.api.loadKimiCodeSession({ workDir: session.projectPath, sessionId: getRuntimeSessionId(session) ?? session.id }),
    new Promise<Awaited<ReturnType<typeof window.api.loadKimiCodeSession>>>((resolve) => {
      window.setTimeout(() => resolve({ success: false, error: "加载超时" }), timeoutMs);
    }),
  ]);
}

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const currentProject = useAppStore((s) => s.currentProject);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const sessions = useSessionStore((s) => s.sessions);
  const addSession = useSessionStore((s) => s.addSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("project");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyLoadMessage, setHistoryLoadMessage] = useState("");
  const [searchOnlySessions, setSearchOnlySessions] = useState<Session[]>([]);
  const attemptedHistoryLoadIdsRef = useRef<Set<string>>(new Set());
  const [loadingGlobalSessions, setLoadingGlobalSessions] = useState(false);
  const [globalSessions, setGlobalSessions] = useState<KimiCodeSessionSummary[]>([]);
  const [copyMessage, setCopyMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setScope("project");
    setCopyMessage("");
    setHistoryLoadMessage("");
    attemptedHistoryLoadIdsRef.current.clear();
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    setSearchOnlySessions([]);
    attemptedHistoryLoadIdsRef.current.clear();
  }, [currentProject?.path]);

  useEffect(() => {
    if (!open || !currentProject) return;
    if (scope !== "project") return;
    let cancelled = false;
    void window.api.listKimiCodeHistorySessions({ workDir: currentProject.path }).then((res) => {
      if (cancelled || !res.success) return;
      setSearchOnlySessions((current) => {
        const knownIds = new Set([
          ...useSessionStore.getState().sessions.map((session) => session.id),
          ...current.map((session) => session.id),
        ]);
        const additions = res.data
          .filter((item) => !knownIds.has(item.id) && !isHiddenInternalSession(item))
          .map((item): Session => ({
            id: item.id,
            title: item.brief || "历史对话",
            projectPath: item.workDir || currentProject.path,
            createdAt: item.updatedAt,
            updatedAt: item.updatedAt,
            events: [],
            isLoading: false,
          }));
        return additions.length > 0 ? [...additions, ...current] : current;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open, currentProject?.path, scope]);

  useEffect(() => {
    if (!open || scope !== "all" || globalSessions.length > 0) return;
    let cancelled = false;
    setLoadingGlobalSessions(true);
    void window.api.listKimiCodeSessions({}).then((res) => {
      if (cancelled) return;
      if (res.success) {
        setGlobalSessions(res.data.filter((item) => !item.archived).sort((a, b) => b.updatedAt - a.updatedAt));
      }
    }).finally(() => {
      if (!cancelled) setLoadingGlobalSessions(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, scope, globalSessions.length]);

  const searchableSessions = useMemo(() => {
    const storeIds = new Set(sessions.map((session) => session.id));
    return [
      ...sessions,
      ...searchOnlySessions.filter((session) => !storeIds.has(session.id)),
    ];
  }, [sessions, searchOnlySessions]);

  useEffect(() => {
    if (!open || !currentProject) return;
    if (scope !== "project") return;
    const unloaded = searchableSessions
      .filter((session) => session.projectPath === currentProject.path && session.events.length === 0)
      .filter((session) => !isHiddenInternalSession(session))
      .filter((session) => !attemptedHistoryLoadIdsRef.current.has(`${session.projectPath}::${session.id}`))
      .slice(0, 12);
    if (unloaded.length === 0) {
      if (loadingHistory) setLoadingHistory(false);
      return;
    }
    for (const session of unloaded) {
      attemptedHistoryLoadIdsRef.current.add(`${session.projectPath}::${session.id}`);
    }
    let cancelled = false;
    let loadedCount = 0;
    let failedCount = 0;
    setLoadingHistory(true);
    setHistoryLoadMessage("");
    Promise.all(unloaded.map(async (session) => {
      const loaded = await loadWithTimeout(session);
      if (!loaded.success || cancelled) {
        failedCount += 1;
        return;
      }
      const events = mapHistoryEvents(Array.isArray(loaded.data.events) ? loaded.data.events : []);
      if (isHiddenInternalSession({ ...session, events })) return;
      loadedCount += 1;
      const isStoreSession = useSessionStore.getState().sessions.some((item) => item.id === session.id);
      if (isStoreSession) {
        updateSession(session.id, (current) => ({
          ...current,
          events,
          title: current.titleLocked ? current.title : deriveSessionTitle(events, current.title),
          isLoading: false,
        }));
        return;
      }
      setSearchOnlySessions((current) => current.map((item) => (
        item.id === session.id
          ? { ...item, events, title: item.titleLocked ? item.title : deriveSessionTitle(events, item.title), isLoading: false }
          : item
      )));
    })).finally(() => {
      if (!cancelled) {
        setLoadingHistory(false);
        const message = failedCount > 0
          ? `已补充 ${loadedCount} 条历史，${failedCount} 条加载失败`
          : `已补充 ${loadedCount} 条历史`;
        setHistoryLoadMessage(message);
        window.setTimeout(() => setHistoryLoadMessage(""), 2200);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, currentProject?.path, scope, searchableSessions, updateSession]);

  const projectSessions = useMemo(() => {
    return searchableSessions
      .filter((session) => !session.archivedAt && (!currentProject || session.projectPath === currentProject.path))
      .filter((session) => !isHiddenInternalSession(session))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [searchableSessions, currentProject]);

  const openSession = (session: Session, targetEventId?: string, searchText?: string) => {
    const current = useSessionStore.getState().sessions.find((item) => item.id === session.id);
    if (!current) addSession(session);
    setCurrentSession(current ?? session);
    onClose();
    if (targetEventId) {
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("kimix:focus-timeline-event", {
          detail: { sessionId: session.id, eventId: targetEventId, searchText },
        }));
      }, 160);
    }
  };

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
            all.push({ session, kind: item.kind, text, timestamp: event.timestamp, eventId: event.id, searchText: query.trim() });
          }
        }
      }
    }
    return all.slice(0, 24);
  }, [projectSessions, query]);

  const globalMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all: GlobalSessionMatch[] = [];
    for (const session of globalSessions) {
      const title = session.title || session.lastPrompt || "历史对话";
      const text = compact([session.lastPrompt, session.workDir].filter(Boolean).join(" · "));
      const haystack = `${title}\n${text}\n${session.id}`.toLowerCase();
      if (!q || haystack.includes(q)) {
        all.push({
          session,
          kind: q ? "官方会话" : "最近官方会话",
          text: text || session.workDir,
          timestamp: session.updatedAt,
        });
      }
    }
    return all.slice(0, 40);
  }, [globalSessions, query]);

  const copyResumeCommand = async (session: KimiCodeSessionSummary) => {
    await navigator.clipboard?.writeText(formatResumeCommand(session));
    setCopyMessage("已复制恢复命令");
    window.setTimeout(() => setCopyMessage(""), 1800);
  };

  if (!open) return null;

  return (
    <div className="kimix-modal-overlay fixed inset-0 z-[85] flex items-start justify-center px-5" style={{ paddingTop: 86 }} onMouseDown={onClose}>
      <div className="w-full max-w-[720px] overflow-hidden rounded-[18px] border border-[var(--kimix-panel-border-soft)] bg-surface-elevated shadow-floating-token" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex h-14 items-center border-b border-border-subtle" style={{ gap: 12, paddingLeft: 20, paddingRight: 16 }}>
          <Search size={18} className="shrink-0 text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "Enter" && scope === "project" && matches[0]) {
                openSession(matches[0].session, matches[0].eventId, matches[0].searchText);
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-[16px] text-text-primary outline-none placeholder:text-text-muted"
            placeholder="搜索对话、回复、思考、工具和状态"
          />
          <button className="kimix-inline-icon-action is-roomy text-text-muted hover:bg-surface-hover hover:text-text-primary" onClick={onClose} aria-label="关闭搜索">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[560px] overflow-y-auto" style={{ padding: 12 }}>
          <div className="flex items-center" style={{ gap: 8, paddingLeft: 8, paddingRight: 8, paddingBottom: 10 }}>
            <button
              className={`kimix-icon-text-button ${scope === "project" ? "bg-surface-hover text-text-primary" : "text-text-muted hover:bg-surface-hover"}`}
              style={{ minHeight: 32, paddingLeft: 12, paddingRight: 12 }}
              onClick={() => setScope("project")}
            >
              <MessageSquare size={14} />
              当前项目
            </button>
            <button
              className={`kimix-icon-text-button ${scope === "all" ? "bg-surface-hover text-text-primary" : "text-text-muted hover:bg-surface-hover"}`}
              style={{ minHeight: 32, paddingLeft: 12, paddingRight: 12 }}
              onClick={() => setScope("all")}
            >
              <Globe2 size={14} />
              全部工作目录
            </button>
            {copyMessage && <span className="ml-auto text-[12px] text-text-muted">{copyMessage}</span>}
          </div>
          <div className="px-2 pb-2 text-[13px] text-text-muted">
            {scope === "all"
              ? loadingGlobalSessions ? "正在读取官方全会话..." : query.trim() ? `${globalMatches.length} 条匹配` : "官方全会话"
              : loadingHistory ? "正在补充加载最近历史..." : historyLoadMessage || (query.trim() ? `${matches.length} 条匹配` : "最近对话")}
          </div>
          {scope === "all" ? (
            globalMatches.length > 0 ? globalMatches.map((match) => (
              <div
                key={match.session.id}
                className="grid min-h-14 w-full items-center rounded-xl text-left transition-colors hover:bg-surface-hover"
                style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, padding: "10px 14px" }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] text-text-primary">{match.session.title || match.session.lastPrompt || "历史对话"}</span>
                  <span className="mt-1 block truncate text-[13px] text-text-muted">{match.kind} · {match.text}</span>
                </span>
                <button
                  className="kimix-icon-text-button text-text-muted hover:bg-surface-hover"
                  style={{ minHeight: 32, paddingLeft: 12, paddingRight: 12 }}
                  onClick={() => void copyResumeCommand(match.session)}
                  title={formatResumeCommand(match.session)}
                >
                  <ClipboardCopy size={14} />
                  复制命令
                </button>
              </div>
            )) : (
              <div className="rounded-xl border border-dashed border-[var(--kimix-panel-border-soft)] bg-surface-base text-center text-[14px] text-text-muted" style={{ padding: 28 }}>
                没有找到官方会话
              </div>
            )
          ) : matches.length > 0 ? matches.map((match, index) => (
            <button
              key={`${match.session.id}-${match.kind}-${match.timestamp}-${index}`}
              onClick={() => {
                openSession(match.session, match.eventId, match.searchText);
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
            <div className="rounded-xl border border-dashed border-[var(--kimix-panel-border-soft)] bg-surface-base text-center text-[14px] text-text-muted" style={{ padding: 28 }}>
              没有找到匹配内容
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
