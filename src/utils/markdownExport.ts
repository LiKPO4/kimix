import type { Session, TimelineEvent } from "@/types/ui";
import { restoreAssistantProgressParagraphs } from "./assistantParagraphs";

export function formatEventAsMarkdown(event: TimelineEvent): string {
  if (event.type === "user_message") {
    const imageLines = event.images?.length
      ? `\n\n${event.images.map((image) => `![${image.name}](${image.dataUrl ?? image.name})`).join("\n")}`
      : "";
    return `## 用户\n\n${event.content || "[图片]"}${imageLines}`;
  }
  if (event.type === "steer_message") return `## 用户引导\n\n${event.content}`;
  if (event.type === "assistant_message") {
    const thinking = event.thinking ? `\n\n<details>\n<summary>思考</summary>\n\n${event.thinking}\n\n</details>` : "";
    return `## Kimi\n\n${restoreAssistantProgressParagraphs(event.content || "")}${thinking}`;
  }
  if (event.type === "tool_call") return `> 命令：${event.toolName}\n>\n> ${event.rawArguments ?? JSON.stringify(event.arguments)}`;
  if (event.type === "status_update") return `> 状态：${event.message ?? "处理中"}`;
  if (event.type === "change_summary") return `> 已更改 ${event.files.length} 个文件，+${event.additions} -${event.deletions}`;
  if (event.type === "file_artifact") return `> 文件：${event.filePath}`;
  if (event.type === "error") return `> 错误：${event.message}`;
  if (event.type === "todo") return `> TodoList：${event.items.length} 项`;
  if (event.type === "session_recommendation") return `> 会话建议：已进行 ${event.turnCount} 轮，推荐上限 ${event.turnLimit} 轮。`;
  if (event.type === "compaction") return event.summary
    ? `> 上下文压缩${event.phase === "begin" ? "开始" : "完成"}\n\n${event.summary}`
    : `> 上下文压缩${event.phase === "begin" ? "开始" : "完成"}`;
  if (event.type === "diff") return `> Diff：${event.filePath}`;
  if (event.type === "approval_request") return `> 审批请求：${event.description}`;
  if (event.type === "question_request") return `> 需求澄清：${event.questions.map((question) => question.question).join(" / ")}`;
  if (event.type === "tool_result") return `> 工具结果：${event.toolName}`;
  if (event.type === "subagent") return `> 子任务：${event.agentName} ${event.status}`;
  return "";
}

export function sessionToMarkdown(session: Session): string {
  const header = `# ${session.title}\n\n- 会话 ID：${session.id}\n- 工作目录：${session.projectPath}\n`;
  const body = session.events.map(formatEventAsMarkdown).filter(Boolean).join("\n\n---\n\n");
  return `${header}\n${body}\n`;
}
