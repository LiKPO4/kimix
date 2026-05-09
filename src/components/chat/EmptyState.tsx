import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import { CloudOff, GitBranch, Bug, Puzzle } from "lucide-react";

export function EmptyState() {
  const project = useAppStore((s) => s.currentProject);
  const currentSession = useAppStore((s) => s.currentSession);
  const isRunning = useAppStore((s) => s.isRunning);
  const setIsRunning = useAppStore((s) => s.setIsRunning);
  const updateSession = useSessionStore((s) => s.updateSession);

  const suggestions = [
    { icon: CloudOff, text: "补在线更新失败提示" },
    { icon: GitBranch, text: "审查我最近的提交记录是否存在正确性风险和可维护性隐患" },
    { icon: Bug, text: "帮我处理最近一个未合并 PR 卡住的问题" },
    { icon: Puzzle, text: "将你常用的应用连接到 Kimi" },
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
    <div className="kimix-content-x flex h-full w-full items-center justify-center">
      <div className="flex w-full flex-col items-center">
        <h1 className="mb-6 text-[28px] font-normal text-text-primary">
          要在 {project?.name ?? "项目"} 中构建什么？
        </h1>

        {project && (
          <div className="w-full max-w-[560px] space-y-0">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => handleSuggestion(s.text)}
                disabled={isRunning}
                className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
              >
                <s.icon size={18} className="text-text-muted shrink-0" />
                <span>{s.text}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
