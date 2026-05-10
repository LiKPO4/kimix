import { useEffect, useRef } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ThemeProvider } from "@/components/common/ThemeProvider";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { PendingMessage } from "@/stores/sessionStore";
import type { Session, TimelineEvent } from "@/types/ui";
import { mapHistoryEvents, mapStreamEvent, mergeEvents } from "@/utils/eventMapper";
import { deriveSessionTitle } from "@/utils/sessionTitle";
import { countUserTurns, shouldRecommendNewSession } from "@/utils/sessionMetrics";

const HANDOFF_PROMPT = `请查看agent文档，给出用于交接下一个agent的提示词，注意回复内容中应该仅仅包含这段提示词。如果没有agent.md文档，请根据以下形式总结并给出提示词
- 项目背景
- 当前目标
- 已完成
- 未完成
- 阻塞
- 关键文件/命令
- 下一步最小行动`;

interface HandoffJob {
  sourceSessionId: string;
  runtimeSessionId: string;
  projectPath: string;
  recommendationEventId: string;
  events: TimelineEvent[];
}

interface StartHandoffDetail {
  sourceSessionId: string;
  projectPath: string;
  recommendationEventId: string;
}

function settleInactiveEvents(events: TimelineEvent[]): TimelineEvent[] {
  const settled = events.flatMap((event) => {
    if (event.type === "subagent") {
      return event.status === "running" ? [{ ...event, status: "completed" as const }] : [event];
    }
    if (event.type !== "assistant_message" || event.isComplete) return [event];
    const hasContent = event.content.trim().length > 0;
    const hasThinking = Boolean(event.thinking?.trim());
    if (!hasContent && !hasThinking) return [];
    return [{ ...event, isComplete: true, isThinking: false, durationMs: event.durationMs ?? 0 }];
  });
  return closeOpenCompaction(settled);
}

function closeOpenCompaction(events: TimelineEvent[]): TimelineEvent[] {
  const lastCompaction = [...events].reverse().find((event) => event.type === "compaction");
  if (!lastCompaction || lastCompaction.type !== "compaction" || lastCompaction.phase !== "begin") {
    return events;
  }
  return [
    ...events,
    {
      id: Math.random().toString(36).substring(2, 11),
      type: "compaction",
      timestamp: Date.now(),
      phase: "end",
    },
  ];
}

function appendSessionRecommendationIfNeeded(events: TimelineEvent[], enabled: boolean, turnLimit: number): TimelineEvent[] {
  const sessionLike = {
    id: "",
    title: "",
    projectPath: "",
    createdAt: 0,
    updatedAt: 0,
    events,
    isLoading: false,
  };
  if (!shouldRecommendNewSession(sessionLike, enabled, turnLimit)) return events;
  const turnCount = countUserTurns(events);
  const latest = events.at(-1);
  if (
    latest?.type === "session_recommendation" &&
    latest.reason === "turn_limit" &&
    latest.turnCount === turnCount &&
    latest.turnLimit === turnLimit
  ) {
    return events;
  }
  return [
    ...events,
    {
      id: crypto.randomUUID(),
      type: "session_recommendation",
      timestamp: Date.now(),
      reason: "turn_limit",
      turnCount,
      turnLimit,
    },
  ];
}

function updateRecommendationEvent(sessionId: string, eventId: string, patch: Partial<Extract<TimelineEvent, { type: "session_recommendation" }>>) {
  useSessionStore.getState().updateSession(sessionId, (session) => ({
    ...session,
    events: session.events.map((event) => (
      event.type === "session_recommendation" && event.id === eventId
        ? { ...event, ...patch }
        : event
    )),
    updatedAt: Date.now(),
  }));
}

function extractAssistantContent(events: TimelineEvent[]): string {
  const assistant = [...settleInactiveEvents(events)]
    .reverse()
    .find((event): event is Extract<TimelineEvent, { type: "assistant_message" }> => event.type === "assistant_message" && event.content.trim().length > 0);
  return assistant?.content.trim() ?? "";
}

function getHiddenHandoffSessionIds(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem("kimix_hidden_handoff_sessions") ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function rememberHiddenHandoffSession(sessionId: string) {
  const ids = Array.from(new Set([...getHiddenHandoffSessionIds(), sessionId]));
  localStorage.setItem("kimix_hidden_handoff_sessions", JSON.stringify(ids.slice(-50)));
}

function eventToHandoffLine(event: TimelineEvent): string | null {
  if (event.type === "user_message") return `用户：${event.content || "[图片]"}`;
  if (event.type === "steer_message") return `用户引导：${event.content}`;
  if (event.type === "assistant_message") return event.content.trim() ? `助手：${event.content.trim()}` : null;
  if (event.type === "tool_call") return `执行命令：${event.toolName} ${event.rawArguments ?? JSON.stringify(event.arguments)}`;
  if (event.type === "change_summary") {
    const files = event.files.map((file) => `${file.path} (+${file.additions ?? 0}/-${file.deletions ?? 0})`).join("；");
    return `文件变更：${files}`;
  }
  if (event.type === "file_artifact") return `文件：${event.filePath}`;
  if (event.type === "todo") return `TodoList：${event.items.map((item) => `${item.status} ${item.content}`).join("；")}`;
  if (event.type === "error") return `错误：${event.message}`;
  return null;
}

function buildHandoffPrompt(sourceSession: Session | undefined): string {
  const visibleHistory = sourceSession?.events
    .map(eventToHandoffLine)
    .filter((line): line is string => Boolean(line?.trim()))
    .slice(-80)
    .join("\n\n") || "当前没有可用的可见聊天记录。";
  return `${HANDOFF_PROMPT}

下面是 Kimix 当前窗口中可见的会话记录。请只基于这些记录生成交接提示词，不要把这次交接生成任务本身写进交接内容，不要输出解释。

会话标题：${sourceSession?.title ?? "未知会话"}
工作目录：${sourceSession?.projectPath ?? "未知目录"}

--- 可见会话记录开始 ---
${visibleHistory}
--- 可见会话记录结束 ---`;
}

function resolveUiSessionId(sessionId: string): string {
  const owner = useSessionStore.getState().sessions.find((session) => session.runtimeSessionId === sessionId);
  return owner?.id ?? sessionId;
}

function resolveRuntimeSessionId(sessionId: string): string {
  const owner = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
  return owner?.runtimeSessionId ?? sessionId;
}

async function createSessionAndSendPrompt(projectPath: string, content: string) {
  const appState = useAppStore.getState();
  const sessionStore = useSessionStore.getState();
  const sessionRes = await window.api.startSession({
    workDir: projectPath,
    model: "kimi-code/kimi-for-coding",
    thinking: appState.defaultThinking,
    yoloMode: appState.permissionMode === "yolo",
  });
  if (!sessionRes.success) throw new Error(sessionRes.error);

  const session = {
    id: sessionRes.data.sessionId,
    title: "交接新会话",
    projectPath,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    events: [] as TimelineEvent[],
    isLoading: false,
  };
  sessionStore.addSession(session);
  appState.setCurrentSession(session);

  const userEvent: TimelineEvent = {
    id: crypto.randomUUID(),
    type: "user_message",
    timestamp: Date.now(),
    content,
  };
  const responsePlaceholder: TimelineEvent = {
    id: crypto.randomUUID(),
    type: "assistant_message",
    timestamp: Date.now(),
    content: "",
    isThinking: appState.defaultThinking,
    isComplete: false,
  };
  useSessionStore.getState().updateSession(session.id, (current) => ({
    ...current,
    events: [userEvent, responsePlaceholder],
    updatedAt: Date.now(),
  }));
  useAppStore.getState().setRunningSessionId(session.id);
  await window.api.sendPrompt({
    sessionId: session.id,
    content,
    thinking: appState.defaultThinking,
    yoloMode: appState.permissionMode === "yolo",
  });
}

function App() {
  const setTheme = useAppStore((s) => s.setTheme);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const setDefaultThinking = useAppStore((s) => s.setDefaultThinking);
  const setDetailedContext = useAppStore((s) => s.setDetailedContext);
  const setStatusUpdateDisplay = useAppStore((s) => s.setStatusUpdateDisplay);
  const setSessionRecommendationEnabled = useAppStore((s) => s.setSessionRecommendationEnabled);
  const setSessionRecommendationTurnLimit = useAppStore((s) => s.setSessionRecommendationTurnLimit);
  const setHandoffSessionId = useAppStore((s) => s.setHandoffSessionId);
  const setRunningSessionId = useAppStore((s) => s.setRunningSessionId);
  const defaultThinking = useAppStore((s) => s.defaultThinking);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const triggerFocusInput = useAppStore((s) => s.triggerFocusInput);
  const updateSession = useSessionStore((s) => s.updateSession);
  const setRecentProjects = useSessionStore((s) => s.setRecentProjects);
  const currentSession = useAppStore((s) => s.currentSession);
  const currentSessionRef = useRef(currentSession);
  currentSessionRef.current = currentSession;
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const bootstrapDoneRef = useRef(false);
  const handoffJobRef = useRef<HandoffJob | null>(null);

  useEffect(() => {
    window.api.getSettings().then((res) => {
      if (res.success) {
        setTheme(res.data.theme);
        setPermissionMode(res.data.defaultPermissionMode);
        setDefaultThinking(res.data.defaultThinking);
        setDetailedContext(res.data.detailedContext);
        setStatusUpdateDisplay(res.data.statusUpdateDisplay);
        setSessionRecommendationEnabled(res.data.sessionRecommendationEnabled);
        setSessionRecommendationTurnLimit(res.data.sessionRecommendationTurnLimit);
      }
    }).catch(() => {});

    window.api.listRecentProjects().then((res) => {
      if (res.success) setRecentProjects(res.data);
    }).catch(() => {});

    const unsubscribeBootstrap = window.api.onBootstrap((payload) => {
      if (bootstrapDoneRef.current) return;
      bootstrapDoneRef.current = true;
      useAppStore.setState({ currentProject: payload.project });

      window.api.listRecentProjects().then((res) => {
        if (res.success) setRecentProjects(res.data);
      }).catch(() => {});

      window.api.listSessions({ workDir: payload.project.path }).then(async (res) => {
        if (!res.success) return;
        const hiddenHandoffSessionIds = new Set(getHiddenHandoffSessionIds());
        const latest = res.data.find((session) => !hiddenHandoffSessionIds.has(session.id));
        const runtimeOwner = latest
          ? useSessionStore.getState().sessions.find((session) => session.runtimeSessionId === latest.id)
          : undefined;
        const startRes = await window.api.startSession({
          workDir: payload.project.path,
          sessionId: latest?.id,
          thinking: useAppStore.getState().defaultThinking,
          yoloMode: useAppStore.getState().permissionMode === "yolo",
        });
        if (!startRes.success || !latest) return;
        if (runtimeOwner) {
          const session = { ...runtimeOwner, runtimeSessionId: startRes.data.sessionId, isLoading: false };
          useSessionStore.setState((state) => ({
            sessions: state.sessions.map((item) => (item.id === session.id ? session : item)),
          }));
          useAppStore.setState({ currentSession: session });
          setRunningSessionId(null);
          return;
        }

        const loaded = await window.api.loadSession({
          workDir: payload.project.path,
          sessionId: latest.id,
        });
        if (!loaded.success) return;
        const events = settleInactiveEvents(mapHistoryEvents(Array.isArray(loaded.data.events) ? loaded.data.events : []));

        const session = {
          id: startRes.data.sessionId,
          title: deriveSessionTitle(events, latest.brief || "新会话"),
          projectPath: payload.project.path,
          createdAt: latest.updatedAt,
          updatedAt: latest.updatedAt,
          events,
          isLoading: false,
        };

        useSessionStore.setState((state) => ({
          sessions: state.sessions.some((item) => item.id === session.id)
            ? state.sessions.map((item) => (item.id === session.id ? session : item))
            : [session, ...state.sessions],
        }));
        useAppStore.setState({ currentSession: session });
        setRunningSessionId(null);
      }).catch(() => {});
    });

    const storedSessions = localStorage.getItem("kimix_sessions");
    if (storedSessions) {
      try {
        const parsed = JSON.parse(storedSessions);
        if (Array.isArray(parsed)) {
          useSessionStore.setState({
            sessions: parsed.map((session) => ({
              ...session,
              events: Array.isArray(session.events) ? settleInactiveEvents(session.events) : [],
              isLoading: false,
            })),
          });
        }
      } catch {
        // ignore parse error
      }
    }

    const storedPending = localStorage.getItem("kimix_pending");
    if (storedPending) {
      try {
        const parsed = JSON.parse(storedPending);
        if (Array.isArray(parsed)) {
          const pendingMessages = parsed
            .map((item) => {
              if (typeof item === "string") {
                return { id: crypto.randomUUID(), content: item, createdAt: Date.now() };
              }
              if (item && typeof item === "object" && typeof item.id === "string" && typeof item.content === "string" && typeof item.createdAt === "number") {
                return item;
              }
              return null;
            })
            .filter((item): item is PendingMessage => item !== null);
          useSessionStore.setState({ pendingMessages });
        }
      } catch {
        // ignore
      }
    }

    const handleBeforeUnload = () => {
      const state = useSessionStore.getState();
      localStorage.setItem("kimix_sessions", JSON.stringify(state.sessions.map((session) => ({
        ...session,
        events: session.id === useAppStore.getState().runningSessionId
          ? session.events
          : settleInactiveEvents(session.events),
      }))));
      localStorage.setItem("kimix_pending", JSON.stringify(state.pendingMessages));
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    const finishHandoffJob = async (job: HandoffJob, status: "completed" | "error" | "interrupted") => {
      handoffJobRef.current = null;
      void window.api.closeSession({ sessionId: job.runtimeSessionId }).catch(() => {});
      if (status !== "completed") {
        setHandoffSessionId(null);
        setRunningSessionId(null);
        updateRecommendationEvent(job.sourceSessionId, job.recommendationEventId, {
          handoffStatus: "error",
          handoffError: status === "interrupted" ? "交接生成被中断" : "交接生成失败",
        });
        return;
      }
      const content = extractAssistantContent(job.events);
      if (!content) {
        setHandoffSessionId(null);
        setRunningSessionId(null);
        updateRecommendationEvent(job.sourceSessionId, job.recommendationEventId, {
          handoffStatus: "error",
          handoffError: "未生成可用交接内容",
        });
        return;
      }
      try {
        await createSessionAndSendPrompt(job.projectPath, content);
        setHandoffSessionId(null);
        updateRecommendationEvent(job.sourceSessionId, job.recommendationEventId, { handoffStatus: "completed" });
      } catch (err) {
        setHandoffSessionId(null);
        setRunningSessionId(null);
        updateRecommendationEvent(job.sourceSessionId, job.recommendationEventId, {
          handoffStatus: "error",
          handoffError: err instanceof Error ? err.message : String(err),
        });
      }
    };

    const handleStartHandoff = (event: Event) => {
      const detail = (event as CustomEvent<StartHandoffDetail>).detail;
      if (!detail?.sourceSessionId || !detail.projectPath || !detail.recommendationEventId) return;
      if (handoffJobRef.current) return;
      setHandoffSessionId(detail.sourceSessionId);
      setRunningSessionId(detail.sourceSessionId);
      updateRecommendationEvent(detail.sourceSessionId, detail.recommendationEventId, {
        handoffStatus: "running",
        handoffError: undefined,
      });
      const sourceSession = useSessionStore.getState().sessions.find((session) => session.id === detail.sourceSessionId);
      void (async () => {
        const startRes = await window.api.startSession({
          workDir: detail.projectPath,
          model: "kimi-code/kimi-for-coding",
          thinking: useAppStore.getState().defaultThinking,
          yoloMode: useAppStore.getState().permissionMode === "yolo",
        });
        if (!startRes.success) throw new Error(startRes.error);
        rememberHiddenHandoffSession(startRes.data.sessionId);
        handoffJobRef.current = {
          sourceSessionId: detail.sourceSessionId,
          runtimeSessionId: startRes.data.sessionId,
          projectPath: detail.projectPath,
          recommendationEventId: detail.recommendationEventId,
          events: [],
        };
        const prompt = buildHandoffPrompt(sourceSession);
        const sendRes = await window.api.sendPrompt({
          sessionId: startRes.data.sessionId,
          content: prompt,
          thinking: useAppStore.getState().defaultThinking,
          yoloMode: useAppStore.getState().permissionMode === "yolo",
        });
        if (!sendRes.success) throw new Error(sendRes.error);
      })().catch((err) => {
        const job = handoffJobRef.current;
        handoffJobRef.current = null;
        setHandoffSessionId(null);
        setRunningSessionId(null);
        if (job?.runtimeSessionId) void window.api.closeSession({ sessionId: job.runtimeSessionId }).catch(() => {});
        updateRecommendationEvent(detail.sourceSessionId, detail.recommendationEventId, {
          handoffStatus: "error",
          handoffError: err instanceof Error ? err.message : String(err),
        });
      });
    };
    window.addEventListener("kimix:startHandoff", handleStartHandoff);

    const unsubscribeEvent = window.api.onKimiEvent((payload) => {
      if (!payload.event) return;
      const mapped = mapStreamEvent(payload.event);
      if (mapped) {
        const handoffJob = handoffJobRef.current;
        if (handoffJob?.runtimeSessionId === payload.sessionId) {
          handoffJob.events = mergeEvents(handoffJob.events, mapped);
          return;
        }
        const uiSessionId = resolveUiSessionId(payload.sessionId);
        updateSession(uiSessionId, (session) => {
          const events = mergeEvents(session.events, mapped);
          const title = deriveSessionTitle(events, session.title);
          return { ...session, events, title, updatedAt: Date.now() };
        });
      }
    });

    const unsubscribeStatus = window.api.onKimiStatus((payload) => {
      const handoffJob = handoffJobRef.current;
      if (handoffJob?.runtimeSessionId === payload.sessionId) {
        if (payload.status === "running") {
          setRunningSessionId(handoffJob.sourceSessionId);
          return;
        }
        if (["completed", "error", "interrupted"].includes(payload.status)) {
          void finishHandoffJob(handoffJob, payload.status as "completed" | "error" | "interrupted");
          return;
        }
      }

      if (payload.status === "running") {
        setRunningSessionId(resolveUiSessionId(payload.sessionId));
        return;
      }

      if (!["completed", "error", "interrupted"].includes(payload.status)) {
        return;
      }

      const uiSessionId = resolveUiSessionId(payload.sessionId);
      setRunningSessionId(null);

      if (payload.status === "error" || payload.status === "interrupted") {
        updateSession(uiSessionId, (session) => ({
          ...session,
          events: closeOpenCompaction(session.events.filter((event) => !(event.type === "assistant_message" && !event.isComplete))),
          updatedAt: Date.now(),
        }));
      }

      if (payload.status === "completed") {
        updateSession(uiSessionId, (session) => ({
          ...session,
          events: appendSessionRecommendationIfNeeded(
            settleInactiveEvents(session.events),
            useAppStore.getState().sessionRecommendationEnabled,
            useAppStore.getState().sessionRecommendationTurnLimit,
          ),
          updatedAt: Date.now(),
        }));

        const next = useSessionStore.getState().shiftPendingMessage();
        if (next) {
          const userEventId = Math.random().toString(36).substring(2, 11);
          const placeholderId = Math.random().toString(36).substring(2, 11);
          updateSession(uiSessionId, (session) => ({
            ...session,
            events: [
              ...session.events,
              {
                id: userEventId,
                type: "user_message" as const,
                timestamp: Date.now(),
                content: next.content,
              },
              {
                id: placeholderId,
                type: "assistant_message" as const,
                timestamp: Date.now(),
                content: "",
                isThinking: defaultThinking,
                isComplete: false,
              },
            ],
            updatedAt: Date.now(),
          }));
          setRunningSessionId(uiSessionId);
          const timer = setTimeout(() => {
            const runtimeSessionId = resolveRuntimeSessionId(uiSessionId);
            window.api.sendPrompt({
              sessionId: runtimeSessionId,
              content: next.content,
              thinking: defaultThinking,
              yoloMode: permissionMode === "yolo",
            }).then((res) => {
              if (res.success) return;
              throw new Error(res.error);
            }).catch(() => {
              updateSession(uiSessionId, (session) => ({
                ...session,
                events: session.events.filter((event) => event.id !== placeholderId && event.id !== userEventId),
                updatedAt: Date.now(),
              }));
              setRunningSessionId(null);
            });
          }, 300);
          timersRef.current.push(timer);
        }
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return;

      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      const isMod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") {
        const sessionId = useAppStore.getState().runningSessionId ?? currentSessionRef.current?.id;
        if (sessionId) {
          setRunningSessionId(null);
          window.api.stopTurn({ sessionId: resolveRuntimeSessionId(sessionId) }).catch(() => {});
        }
        return;
      }
      if (isMod && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (isMod && e.key === "k") {
        e.preventDefault();
        triggerFocusInput();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    const unsubSettings = useAppStore.subscribe((state, prev) => {
      if (
        state.theme !== prev.theme ||
        state.permissionMode !== prev.permissionMode ||
        state.defaultThinking !== prev.defaultThinking ||
        state.detailedContext !== prev.detailedContext ||
        state.statusUpdateDisplay !== prev.statusUpdateDisplay ||
        state.sessionRecommendationEnabled !== prev.sessionRecommendationEnabled ||
        state.sessionRecommendationTurnLimit !== prev.sessionRecommendationTurnLimit
      ) {
        window.api.saveSettings({
          theme: state.theme,
          defaultPermissionMode: state.permissionMode,
          defaultThinking: state.defaultThinking,
          detailedContext: state.detailedContext,
          statusUpdateDisplay: state.statusUpdateDisplay,
          sessionRecommendationEnabled: state.sessionRecommendationEnabled,
          sessionRecommendationTurnLimit: state.sessionRecommendationTurnLimit,
        }).catch(() => {});
      }
    });

    return () => {
      unsubscribeEvent();
      unsubscribeStatus();
      unsubscribeBootstrap();
      window.removeEventListener("kimix:startHandoff", handleStartHandoff);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      unsubSettings();
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [setTheme, setPermissionMode, setDefaultThinking, setDetailedContext, setStatusUpdateDisplay, setSessionRecommendationEnabled, setSessionRecommendationTurnLimit, setHandoffSessionId, setRunningSessionId, toggleSidebar, triggerFocusInput, updateSession, setRecentProjects, defaultThinking, permissionMode]);

  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}

export default App;
