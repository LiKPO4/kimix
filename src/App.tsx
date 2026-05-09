import { useEffect, useRef } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ThemeProvider } from "@/components/common/ThemeProvider";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { PendingMessage } from "@/stores/sessionStore";
import type { TimelineEvent } from "@/types/ui";
import { mapStreamEvent, mergeEvents } from "@/utils/eventMapper";

function App() {
  const setTheme = useAppStore((s) => s.setTheme);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const setDefaultThinking = useAppStore((s) => s.setDefaultThinking);
  const setDetailedContext = useAppStore((s) => s.setDetailedContext);
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

  useEffect(() => {
    window.api.getSettings().then((res) => {
      if (res.success) {
        setTheme(res.data.theme);
        setPermissionMode(res.data.defaultPermissionMode);
        setDefaultThinking(res.data.defaultThinking);
        setDetailedContext(res.data.detailedContext);
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
        const latest = res.data[0];
        const startRes = await window.api.startSession({
          workDir: payload.project.path,
          sessionId: latest?.id,
          thinking: useAppStore.getState().defaultThinking,
          yoloMode: useAppStore.getState().permissionMode === "yolo",
        });
        if (!startRes.success || !latest) return;

        const loaded = await window.api.loadSession({
          workDir: payload.project.path,
          sessionId: latest.id,
        });
        if (!loaded.success) return;

        const session = {
          id: startRes.data.sessionId,
          title: latest.brief || "新会话",
          projectPath: payload.project.path,
          createdAt: latest.updatedAt,
          updatedAt: latest.updatedAt,
          events: (Array.isArray(loaded.data.events) ? loaded.data.events : []) as TimelineEvent[],
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
          useSessionStore.setState({ sessions: parsed });
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
      localStorage.setItem("kimix_sessions", JSON.stringify(state.sessions));
      localStorage.setItem("kimix_pending", JSON.stringify(state.pendingMessages));
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    const unsubscribeEvent = window.api.onKimiEvent((payload) => {
      if (!payload.event) return;
      const mapped = mapStreamEvent(payload.event);
      if (mapped) {
        updateSession(payload.sessionId, (session) => {
          const events = mergeEvents(session.events, mapped);
          const title = session.title === "新会话" && mapped.type === "user_message"
            ? mapped.content.slice(0, 30) + (mapped.content.length > 30 ? "..." : "")
            : session.title;
          return { ...session, events, title, updatedAt: Date.now() };
        });
      }
    });

    const unsubscribeStatus = window.api.onKimiStatus((payload) => {
      if (payload.status === "running") {
        setRunningSessionId(payload.sessionId);
        return;
      }

      if (!["completed", "error", "interrupted"].includes(payload.status)) {
        return;
      }

      setRunningSessionId(null);

      if (payload.status === "error" || payload.status === "interrupted") {
        updateSession(payload.sessionId, (session) => ({
          ...session,
          events: session.events.filter((event) => !(event.type === "assistant_message" && !event.isComplete)),
          updatedAt: Date.now(),
        }));
      }

      if (payload.status === "completed") {
        const next = useSessionStore.getState().shiftPendingMessage();
        if (next) {
          const placeholderId = Math.random().toString(36).substring(2, 11);
          updateSession(payload.sessionId, (session) => ({
            ...session,
            events: [
              ...session.events,
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
          const timer = setTimeout(() => {
            window.api.sendPrompt({
              sessionId: payload.sessionId,
              content: next.content,
              thinking: defaultThinking,
              yoloMode: permissionMode === "yolo",
            }).catch(() => {
              updateSession(payload.sessionId, (session) => ({
                ...session,
                events: session.events.filter((event) => event.id !== placeholderId),
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
        const cs = currentSessionRef.current;
        if (cs) {
          window.api.stopTurn({ sessionId: cs.id }).catch(() => {});
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
      if (state.theme !== prev.theme || state.permissionMode !== prev.permissionMode || state.defaultThinking !== prev.defaultThinking || state.detailedContext !== prev.detailedContext) {
        window.api.saveSettings({
          theme: state.theme,
          defaultPermissionMode: state.permissionMode,
          defaultThinking: state.defaultThinking,
          detailedContext: state.detailedContext,
        }).catch(() => {});
      }
    });

    return () => {
      unsubscribeEvent();
      unsubscribeStatus();
      unsubscribeBootstrap();
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      unsubSettings();
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [setTheme, setPermissionMode, setDefaultThinking, setDetailedContext, setRunningSessionId, toggleSidebar, triggerFocusInput, updateSession, setRecentProjects, defaultThinking, permissionMode]);

  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}

export default App;
