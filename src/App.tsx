import { useEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ThemeProvider } from "@/components/common/ThemeProvider";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { mapStreamEvent, mergeEvents } from "@/utils/eventMapper";

function App() {
  const setTheme = useAppStore((s) => s.setTheme);
  const setIsRunning = useAppStore((s) => s.setIsRunning);
  const updateSession = useSessionStore((s) => s.updateSession);
  const setRecentProjects = useSessionStore((s) => s.setRecentProjects);

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

    // Listen for Kimi events
    const unsubscribeEvent = window.api.onKimiEvent((payload) => {
      if (!payload.event) return;
      const mapped = mapStreamEvent(payload.event);
      if (mapped) {
        updateSession(payload.sessionId, (session) => {
          const events = mergeEvents(session.events, mapped);
          return { ...session, events, updatedAt: Date.now() };
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

    return () => {
      unsubscribeEvent();
      unsubscribeStatus();
    };
  }, [setTheme, setIsRunning, updateSession, setRecentProjects]);

  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}

export default App;
