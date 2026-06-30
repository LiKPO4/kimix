import { useEffect, useMemo, useRef, useState } from "react";
import { Bug, GitBranch, ListChecks, Sparkles } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Session, TimelineEvent } from "@/types/ui";
import { isKimiActiveTurnError, sendKimiCodePromptWithRetry } from "@/utils/kimiCodeSendRetry";
import { kimiCodeRouteStatus } from "@/utils/kimiCodeRouteStatus";
import { displayProjectName } from "@/utils/projectDisplay";
import { normalizeAdditionalWorkDirs } from "@/utils/additionalWorkDirs";

const FALLBACK_SUGGESTIONS = [
  { icon: Sparkles, text: "分析项目结构，找出 3 个最该优先处理的问题" },
  { icon: ListChecks, text: "读取最近会话和 Git 改动，整理待办与下一步" },
  { icon: GitBranch, text: "检查未提交改动风险，给出代码审查意见" },
  { icon: Bug, text: "定位最影响使用的问题，给出复现步骤" },
];

function genId(): string {
  return Math.random().toString(36).substring(2, 11);
}

async function getDefaultKimiModel() {
  try {
    const res = await window.api.getKimiModelConfig();
    if (res.success) return res.data.defaultModel?.trim() || "kimi-for-coding";
  } catch {
    // Keep the official built-in default.
  }
  return "kimi-for-coding";
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
  const permissionMode = useAppStore((s) => s.permissionMode);
  const additionalWorkDirs = useAppStore((s) => s.additionalWorkDirs);
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
      lastUserMessage?.type === "user_message" ? `继续：${lastUserMessage.content.slice(0, 28)}` : "",
      "读取最近会话和 Git 改动，整理待办与下一步",
      "检查未提交改动风险，给出代码审查意见",
      "分析项目结构，找出 3 个最该优先处理的问题",
    ].filter(Boolean);

    const unique = Array.from(new Set(dynamic)).slice(0, 4);
    const icons = [ListChecks, GitBranch, Bug, Sparkles];
    return unique.map((text, index) => ({ icon: icons[index] ?? Sparkles, text }));
  }, [project, savedSuggestions, sessions]);

  const ensureSession = async (): Promise<Session | null> => {
    if (currentSession) return currentSession;
    if (!project) return null;

    const session: Session = {
      id: crypto.randomUUID(),
      engine: "kimi-code",
      model: await getDefaultKimiModel(),
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
      const linkStatusEvent: TimelineEvent = {
        id: genId(),
        type: "status_update",
        timestamp: Date.now(),
        message: "消息发送中",
        source: "ipc",
        tone: "info",
        parentEventId: userEvent.id,
      };

      updateSession(targetSession.id, (session) => ({
        ...session,
        events: [...session.events, userEvent, linkStatusEvent, responsePlaceholder],
        title: session.title === "新会话" ? text.slice(0, 30) + (text.length > 30 ? "..." : "") : session.title,
        updatedAt: Date.now(),
      }));

      setRunningSessionId(targetSession.id);
      const updateLinkStatus = (message: string, tone: Extract<TimelineEvent, { type: "status_update" }>["tone"] = "info") => {
        const timestamp = Date.now();
        if (!targetSession) return;
        updateSession(targetSession.id, (session) => ({
          ...session,
          events: session.events.map((event) => event.id === linkStatusEvent.id
            ? { ...event, timestamp, message, tone }
            : event
          ),
          updatedAt: timestamp,
        }));
      };
      let runtimeSessionId = targetSession.runtimeSessionId ?? targetSession.officialSessionId;
      if (!runtimeSessionId) {
        updateLinkStatus("消息发送中", "info");
        const createRes = await window.api.createKimiCodeSession({
          workDir: targetSession.projectPath,
          permission: permissionMode,
          planMode: defaultPlanMode,
          additionalWorkDirs: normalizeAdditionalWorkDirs(additionalWorkDirs),
        });
        if (!createRes.success) throw new Error(createRes.error);
        runtimeSessionId = createRes.data.sessionId;
        updateSession(targetSession.id, (session) => ({
          ...session,
          engine: "kimi-code",
          runtimeSessionId,
          officialSessionId: runtimeSessionId,
          updatedAt: Date.now(),
        }));
        targetSession = {
          ...targetSession,
          engine: "kimi-code",
          runtimeSessionId,
          officialSessionId: runtimeSessionId,
        };
        setCurrentSession(targetSession);
        updateLinkStatus("消息发送中", "info");
      } else {
        updateLinkStatus("消息发送中", "info");
      }
      const dispatchStartedAt = Date.now();
      updateSession(targetSession.id, (session) => ({
        ...session,
        events: session.events.map((event) => event.id === responsePlaceholder.id
          ? { ...event, timestamp: dispatchStartedAt }
          : event
        ),
        updatedAt: dispatchStartedAt,
      }));
      updateLinkStatus("消息发送中", "info");
      const sendRes = await sendKimiCodePromptWithRetry({
        sessionId: runtimeSessionId,
        content: text,
        images: [],
      });
      if (!sendRes.success) throw new Error(sendRes.error);
      updateLinkStatus(kimiCodeRouteStatus(sendRes.data.route), "success");
    } catch (err) {
      console.error("Send failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      setRunningSessionId(null);
      if (targetSession) {
        if (isKimiActiveTurnError(message)) {
          setRunningSessionId(targetSession.id);
          updateSession(targetSession.id, (session) => ({
            ...session,
            events: session.events.filter((event) => (
              event.id !== userEvent.id &&
              event.id !== responsePlaceholder.id &&
              event.id !== linkStatusEvent.id
            )),
            updatedAt: Date.now(),
          }));
          const updated = useSessionStore.getState().sessions.find((session) => session.id === targetSession?.id);
          if (updated) setCurrentSession(updated);
          window.dispatchEvent(new CustomEvent("kimix:toast", {
            detail: "上一轮仍在运行，请等待或停止后再发送。",
          }));
          return;
        }
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

  const titleProjectName = displayProjectName(project, "当前项目");
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
              className={`flex w-full items-center rounded-lg text-left text-[15px] leading-6 transition-colors hover:bg-bg-hover hover:text-text-primary disabled:cursor-not-allowed ${pendingSuggestion === suggestion.text ? "bg-surface-hover text-text-primary opacity-100" : "text-text-secondary disabled:opacity-50"}`}
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
