import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ThemeProvider } from "@/components/common/ThemeProvider";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { mapStreamEvent, mergeEvents } from "@/utils/eventMapper";

function App() {
  const setTheme = useAppStore((s) => s.setTheme);
  const setIsRunning = useAppStore((s) => s.setIsRunning);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const triggerFocusInput = useAppStore((s) => s.triggerFocusInput);
  const updateSession = useSessionStore((s) => s.updateSession);
  const setRecentProjects = useSessionStore((s) => s.setRecentProjects);
  const currentSession = useAppStore((s) => s.currentSession);

  useEffect(() => {
    // Load settings
    window.api.getSettings().then((res) => {
      if (res.success) {
        setTheme(res.data.theme);
      }
    });

    // Load recent projects
    window.api.listRecentProjects().then((res) => {
      if (res.success) {
        setRecentProjects(res.data);
      }
    });

    // Load persisted sessions
    const stored = localStorage.getItem("kimix_sessions");
    if (stored) {
      try {
        const sessions = JSON.parse(stored);
        useSessionStore.setState({ sessions });
      } catch {
        // ignore parse error
      }
    }

    // Save sessions before unload
    const handleBeforeUnload = () => {
      const state = useSessionStore.getState();
      localStorage.setItem("kimix_sessions", JSON.stringify(state.sessions));
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    // Listen for Kimi events
    const unsubscribeEvent = window.api.onKimiEvent((payload) => {
      if (!payload.event) return;
      const mapped = mapStreamEvent(payload.event);
      if (mapped) {
        updateSession(payload.sessionId, (session) => {
          const events = mergeEvents(session.events, mapped);
          // Auto-update session title from first user message
          const title = session.title === "新会话" && mapped.type === "user_message"
            ? mapped.content.slice(0, 30) + (mapped.content.length > 30 ? "..." : "")
            : session.title;
          return { ...session, events, title, updatedAt: Date.now() };
        });
      }
    });

    const unsubscribeStatus = window.api.onKimiStatus((payload) => {
      if (payload.status === "running") {
        setIsRunning(true);
      } else if (["completed", "error", "interrupted"].includes(payload.status)) {
        setIsRunning(false);
        // 自动发送排队中的下一条消息
        if (payload.status === "completed") {
          const next = useSessionStore.getState().shiftPendingMessage();
          if (next) {
            // 先添加思考中占位符
            updateSession(payload.sessionId, (session) => ({
              ...session,
              events: [...session.events, {
                id: Math.random().toString(36).substring(2, 11),
                type: "assistant_message" as const,
                timestamp: Date.now(),
                content: "",
                isThinking: true,
                isComplete: false,
              }],
              updatedAt: Date.now(),
            }));
            setTimeout(() => {
              window.api.sendPrompt({ sessionId: payload.sessionId, content: next });
            }, 300);
          }
        }
      }
    });

    // Global keyboard shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Escape: stop generation
      if (e.key === "Escape") {
        if (currentSession) {
          window.api.stopTurn({ sessionId: currentSession.id }).catch(() => {});
        }
        return;
      }

      // Cmd/Ctrl+B: toggle sidebar
      if (isMod && e.key === "b") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Cmd/Ctrl+K: focus input
      if (isMod && e.key === "k") {
        e.preventDefault();
        triggerFocusInput();
        return;
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      unsubscribeEvent();
      unsubscribeStatus();
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [setTheme, setIsRunning, toggleSidebar, triggerFocusInput, updateSession, setRecentProjects, currentSession]);

  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}

export default App;
