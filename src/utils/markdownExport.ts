import type { Session, TimelineEvent } from "@/types/ui";
import { restoreAssistantProgressParagraphs } from "./assistantParagraphs";
import { getRoomAgent } from "@/utils/collaborationRooms";
import { projectCollaborationTimeline } from "@/utils/collaborationTimeline";

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
  if (event.type === "change_summary") {
    const statsKnown = event.files.every((file) => file.additions !== undefined && file.deletions !== undefined);
    return statsKnown
      ? `> 已更改 ${event.files.length} 个文件，+${event.files.reduce((sum, file) => sum + (file.additions ?? 0), 0)} -${event.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)}`
      : `> 已更改 ${event.files.length} 个文件，增删统计未知`;
  }
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
  if (session.collaboration) return collaborationRoomToMarkdown(session);
  const header = `# ${session.title}\n\n- 会话 ID：${session.id}\n- 工作目录：${session.projectPath}\n`;
  const body = session.events.map(formatEventAsMarkdown).filter(Boolean).join("\n\n---\n\n");
  return `${header}\n${body}\n`;
}

function markdownTableCell(value: string | null | undefined) {
  return (value?.trim() || "—").replace(/\|/g, "\\|").replace(/\s+/g, " ");
}

function roomAgentLabel(session: Session, roomAgentId?: string) {
  const agent = roomAgentId ? getRoomAgent(session, roomAgentId) : undefined;
  if (!agent) return { name: "未知 Agent", model: "模型未知" };
  return {
    name: agent.displayName,
    model: agent.modelLabelSnapshot || agent.modelAlias || "模型未知",
  };
}

function formatRoomEventAsMarkdown(session: Session, event: TimelineEvent): string {
  if (event.type === "user_message") {
    const recipients = (event.recipientAgentIds ?? [])
      .map((roomAgentId) => roomAgentLabel(session, roomAgentId).name)
      .join("、") || "未标注接收者";
    const imageLines = event.images?.length
      ? `\n\n${event.images.map((image) => `![${image.name}](${image.dataUrl ?? image.name})`).join("\n")}`
      : "";
    return `## 用户 → ${recipients}\n\n${event.content || "[图片]"}${imageLines}`;
  }
  const actor = roomAgentLabel(session, event.roomAgentId);
  if (event.type === "assistant_message") {
    const thinking = event.thinking ? `\n\n<details>\n<summary>思考</summary>\n\n${event.thinking}\n\n</details>` : "";
    return `## ${actor.name} · ${actor.model}\n\n${restoreAssistantProgressParagraphs(event.content || "")}${thinking}`;
  }
  const markdown = formatEventAsMarkdown(event);
  return markdown ? markdown.replace(/^> /, `> ${actor.name} · `) : "";
}

export function collaborationRoomToMarkdown(session: Session): string {
  if (!session.collaboration) return sessionToMarkdown({ ...session, collaboration: undefined });
  const agents = session.collaboration.agents;
  const agentRows = agents.map((agent) => (
    `| ${markdownTableCell(agent.displayName)} | @${markdownTableCell(agent.mentionName)} | ${markdownTableCell(agent.providerLabelSnapshot)} | ${markdownTableCell(agent.modelLabelSnapshot || agent.modelAlias)} | ${agent.removedAt ? "已移出" : agent.archivedAt ? "已归档" : "活跃"} |`
  ));
  const header = [
    `# ${session.title}`,
    "",
    `- 房间 ID：${session.id}`,
    `- 工作目录：${session.projectPath}`,
    `- Agent 数量：${agents.length}`,
    "",
    "## 参与 Agent",
    "",
    "| Agent | Mention | Provider | 模型 | 状态 |",
    "| --- | --- | --- | --- | --- |",
    ...agentRows,
  ].join("\n");
  const body = projectCollaborationTimeline(session)
    .map((event) => formatRoomEventAsMarkdown(session, event))
    .filter(Boolean)
    .join("\n\n---\n\n");
  return `${header}\n\n${body}\n`;
}
