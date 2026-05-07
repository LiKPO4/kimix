import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { Sparkles, MessageSquare, Code2, Lightbulb } from "lucide-react";

export function EmptyState() {
  const project = useAppStore((s) => s.currentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const isRunning = useAppStore((s) => s.isRunning);
  const setIsRunning = useAppStore((s) => s.setIsRunning);
  const updateSession = useSessionStore((s) => s.updateSession);

  const suggestions = [
    { icon: Code2, text: "分析代码结构并提出改进建议" },
    { icon: MessageSquare, text: "解释这个项目的架构设计" },
    { icon: Lightbulb, text: "帮我实现一个新功能" },
  ];

  const handleSuggestion = async (text: string) => {
    if (!currentSession || isRunning) return;
    const userEvent = {
      id: Math.random().toString(36).substring(2, 11),
      type: "user_message" as const,
      timestamp: Date.now(),
      content: text,
    };
    const thinkingPlaceholder = {
      id: Math.random().toString(36).substring(2, 11),
      type: "assistant_message" as const,
      timestamp: Date.now(),
      content: "",
      isThinking: true,
      isComplete: false,
    };
    updateSession(currentSession.id, (session) => ({
      ...session,
      events: [...session.events, userEvent, thinkingPlaceholder],
      title: text.slice(0, 30) + (text.length > 30 ? "..." : ""),
      updatedAt: Date.now(),
    }));
    setIsRunning(true);
    try {
      await window.api.sendPrompt({ sessionId: currentSession.id, content: text });
    } catch (err) {
      console.error("Send failed:", err);
      setIsRunning(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <div className="flex flex-col items-center gap-6 max-w-md">
        <div className="w-14 h-14 rounded-2xl bg-accent-blue/10 flex items-center justify-center">
          <Sparkles size={28} className="text-accent-blue" />
        </div>
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold text-text-primary">
            要在 {project?.name ?? "项目"} 中构建什么？
          </h1>
          <p className="text-sm text-text-muted">
            向 Kimi 描述你的需求，它会帮你分析、规划和实现
          </p>
        </div>

        {project && (
          <div className="w-full space-y-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => handleSuggestion(s.text)}
                disabled={isRunning}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border-default bg-bg-elevated hover:bg-bg-secondary hover:border-border-strong transition-all text-left group disabled:opacity-50"
              >
                <s.icon size={18} className="text-text-muted group-hover:text-accent-blue transition-colors shrink-0" />
                <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors">
                  {s.text}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
