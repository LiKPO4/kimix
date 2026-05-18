import { useEffect, useMemo, useRef, useState } from "react";
import { Bug, GitBranch, ListChecks, Sparkles } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Session, TimelineEvent } from "@/types/ui";

const FALLBACK_SUGGESTIONS = [
  { icon: Sparkles, text: "分析一下当前项目，并告诉我最应该先处理什么" },
  { icon: ListChecks, text: "找出上次未完成的工作，整理下一步行动" },
  { icon: GitBranch, text: "检查最近改动是否有风险，并给出验证建议" },
  { icon: Bug, text: "帮我定位当前应用最可能影响使用的问题" },
];

function genId(): string {
  return Math.random().toString(36).substring(2, 11);
}

function storageKey(projectPath: string): string {
  return `kimix_project_suggestions:${projectPath}`;
}

function loadProjectSuggestions(projectPath: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(projectPath));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function saveProjectSuggestions(projectPath: string, items: string[]) {
  try {
    localStorage.setItem(storageKey(projectPath), JSON.stringify(items.slice(0, 4)));
  } catch {
    // localStorage can fail in restricted environments; suggestions still work with defaults.
  }
}

export function EmptyState() {
  const project = useAppStore((s) => s.currentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const runningSessionId = useAppStore((s) => s.runningSessionId);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const defaultPlanMode = useAppStore((s) => s.defaultPlanMode);
  const defaultAfkMode = useAppStore((s) => s.defaultAfkMode);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const updateSession = useSessionStore((s) => s.updateSession);
  const addSession = useSessionStore((s) => s.addSession);
  const sessions = useSessionStore((s) => s.sessions);
  const [savedSuggestions, setSavedSuggestions] = useState<string[]>([]);
  const [pendingSuggestion, setPendingSuggestion] = useState<string | null>(null);
  const suggestionLockRef = useRef(false);

  useEffect(() => {
    if (!project) {
      setSavedSuggestions([]);
      return;
    }
    setSavedSuggestions(loadProjectSuggestions(project.path));
  }, [project?.path]);

  const derivedSuggestions = useMemo(() => {
    if (!project) return FALLBACK_SUGGESTIONS;

    const lastUserMessage = sessions
      .filter((session) => session.projectPath === project.path)
      .flatMap((session) => session.events.filter((event) => event.type === "user_message"))
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    const dynamic = [
      ...savedSuggestions,
      lastUserMessage?.type === "user_message" ? `接着上次这件事继续：${lastUserMessage.content.slice(0, 42)}` : "",
      "找出上次未完成的工作，整理下一步行动",
      "检查最近改动是否有风险，并给出验证建议",
      "分析一下当前项目，并告诉我最应该先处理什么",
    ].filter(Boolean);

    const unique = Array.from(new Set(dynamic)).slice(0, 4);
    const icons = [ListChecks, GitBranch, Bug, Sparkles];
    return unique.map((text, index) => ({ icon: icons[index] ?? Sparkles, text }));
  }, [project, savedSuggestions, sessions]);

  const ensureSession = async (): Promise<Session | null> => {
    if (currentSession) return currentSession;
    if (!project) return null;

    const sessionRes = await window.api.startSession({
      workDir: project.path,
      model: "kimi-code/kimi-for-coding",
      thinking: defaultThinking,
      yoloMode: permissionMode === "yolo",
      planMode: defaultPlanMode,
      afkMode: defaultAfkMode,
    });
    if (!sessionRes.success) return null;

    const session: Session = {
      id: sessionRes.data.sessionId,
      title: "新会话",
      projectPath: project.path,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      events: [],
      isLoading: false,
    };
    addSession(session);
    setCurrentSession(session);
    return session;
  };

  const handleSuggestion = async (text: string) => {
    let targetSession: Session | null = null;
    try {
      if (suggestionLockRef.current) return;
      if (runningSessionId) return;
      suggestionLockRef.current = true;
      setPendingSuggestion(text);

      targetSession = await ensureSession();
      if (!targetSession || useAppStore.getState().runningSessionId) return;

      if (project) {
        const nextSaved = Array.from(new Set([text, ...savedSuggestions])).slice(0, 4);
        setSavedSuggestions(nextSaved);
        saveProjectSuggestions(project.path, nextSaved);
      }

      const userEvent: TimelineEvent = {
        id: genId(),
        type: "user_message",
        timestamp: Date.now(),
        content: text,
      };
      const responsePlaceholder: TimelineEvent = {
        id: genId(),
        type: "assistant_message",
        timestamp: Date.now(),
        content: "",
        isThinking: defaultThinking,
        isComplete: false,
      };

      updateSession(targetSession.id, (session) => ({
        ...session,
        events: [...session.events, userEvent, responsePlaceholder],
        title: session.title === "新会话" ? text.slice(0, 30) + (text.length > 30 ? "..." : "") : session.title,
        updatedAt: Date.now(),
      }));

      setRunningSessionId(targetSession.id);
      const sendRes = await window.api.sendPrompt({
        sessionId: targetSession.id,
        content: text,
        thinking: defaultThinking,
        yoloMode: permissionMode === "yolo",
        planMode: defaultPlanMode,
        afkMode: defaultAfkMode,
      });
      if (!sendRes.success) throw new Error(sendRes.error);
    } catch (err) {
      console.error("Send failed:", err);
      setRunningSessionId(null);
      if (targetSession) {
        updateSession(targetSession.id, (session) => ({
          ...session,
          events: session.events.filter((event) => !(event.type === "assistant_message" && !event.isComplete)),
          updatedAt: Date.now(),
        }));
      }
    } finally {
      suggestionLockRef.current = false;
      setPendingSuggestion(null);
    }
  };

  if (!project) {
    return (
      <div className="kimix-content-x flex h-full w-full items-center justify-center">
        <div className="text-center">
          <h1 className="text-[26px] font-normal text-text-primary">正在准备默认项目</h1>
          <p className="mt-3 text-sm text-text-secondary">准备好后就可以直接开始对话。</p>
        </div>
      </div>
    );
  }

  const titleProjectName = project.name || "当前项目";
  const isSending = Boolean(runningSessionId || pendingSuggestion);

  return (
    <div className="kimix-content-x flex h-full w-full items-center justify-center">
      <div className="flex w-full flex-col items-center" style={{ gap: 14 }}>
        <h1 className="text-center text-[28px] font-normal leading-tight text-text-primary">
          要在 {titleProjectName} 中构建什么？
        </h1>

        <div className="flex w-full max-w-[460px] flex-col" style={{ gap: 3 }}>
          {derivedSuggestions.map((suggestion) => (
            <button
              key={suggestion.text}
              onClick={() => handleSuggestion(suggestion.text)}
              disabled={isSending}
              className={`flex w-full items-center rounded-lg text-left text-[15px] leading-6 transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed ${pendingSuggestion === suggestion.text ? "bg-[#f1eee8] text-text-primary opacity-100" : "text-text-secondary disabled:opacity-50"}`}
              style={{ gap: 12, paddingLeft: 16, paddingRight: 16, paddingTop: 6, paddingBottom: 6 }}
            >
              <suggestion.icon size={18} className="shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1">{suggestion.text}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
