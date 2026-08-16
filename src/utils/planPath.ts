import type { TimelineEvent } from "@/types/ui";

const KIMI_PLAN_PATH_PATTERN = /(?:[A-Za-z]:\\[^\r\n"'<>|]*?\.kimi(?:-code)?\\plans\\[^\s"'<>|]+\.md|\/[^\s"'<>]*?\.kimi(?:-code)?\/plans\/[^\s"'<>|]+\.md|\.kimi(?:-code)?[\\/]+plans[\\/]+[^\s"'<>|]+\.md)/gi;

export function cleanPlanPath(pathValue: string) {
  return pathValue.trim().replace(/[),.;，。；）]+$/u, "");
}

export function extractPlanPathFromText(text: string) {
  const matches = text.match(KIMI_PLAN_PATH_PATTERN);
  return matches?.map(cleanPlanPath).find(Boolean) ?? null;
}

export type SessionPlanSignal = {
  path: string | null;
  content: string | null;
  source: "exit_plan_mode" | "plan_review" | "plan_file" | "plan_question";
};

function planPathFromValue(value: unknown) {
  if (typeof value !== "string") return null;
  return extractPlanPathFromText(value);
}

function planContentFromValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function isExitPlanModeTool(toolName: string) {
  return toolName.split(/[.:/]/u).at(-1)?.replace(/[_-]/gu, "").toLowerCase() === "exitplanmode";
}

/**
 * 对齐 Kimi Code Web 0.36 的 sessionPlans 来源：优先读取 ExitPlanMode / plan_review
 * 事件里随会话保存的计划正文，其次兼容历史计划文件与提问信号。
 */
export function findSessionPlanSignal(events: TimelineEvent[]): SessionPlanSignal | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "approval_request" && event.display) {
      const content = planContentFromValue(event.display.plan);
      const path = planPathFromValue(event.display.path) ?? planPathFromValue(event.display.plan);
      if (event.display.kind === "plan_review" || content || path) {
        return { path, content, source: "plan_review" };
      }
    }
    if (event.type === "tool_call" && isExitPlanModeTool(event.toolName)) {
      const content = planContentFromValue(event.arguments.plan);
      const path = planPathFromValue(event.arguments.path) ?? planPathFromValue(event.rawArguments ?? "");
      return { path, content, source: "exit_plan_mode" };
    }
    if (event.type === "change_summary") {
      for (let fileIndex = event.files.length - 1; fileIndex >= 0; fileIndex -= 1) {
        const path = extractPlanPathFromText(event.files[fileIndex].path);
        if (path) return { path, content: null, source: "plan_file" };
      }
    }
    if (event.type === "assistant_message" || event.type === "user_message" || event.type === "steer_message") {
      const path = extractPlanPathFromText(event.content);
      if (path) return { path, content: null, source: "plan_file" };
    }
    if (event.type === "question_request") {
      for (const question of event.questions) {
        const questionText = [
          question.header,
          question.question,
          ...question.options.flatMap((option) => [option.label, option.description]),
        ].filter(Boolean).join("\n");
        const path = extractPlanPathFromText(questionText);
        if (
          path ||
          /plan/i.test(question.header ?? "") ||
          /approve this plan|reject and exit/i.test(questionText)
        ) {
          return { path, content: null, source: "plan_question" };
        }
      }
    }
  }
  return null;
}

export function findSessionPlanPath(events: TimelineEvent[]) {
  return findSessionPlanSignal(events)?.path ?? null;
}

export function hasSessionPlanSignal(events: TimelineEvent[]) {
  return findSessionPlanSignal(events) !== null;
}
