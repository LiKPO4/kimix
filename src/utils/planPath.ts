import type { TimelineEvent } from "@/types/ui";

const KIMI_PLAN_PATH_PATTERN = /(?:[A-Za-z]:\\[^\r\n"'<>|]*?\.kimi(?:-code)?\\plans\\[^\s"'<>|]+\.md|\/[^\s"'<>]*?\.kimi(?:-code)?\/plans\/[^\s"'<>|]+\.md|\.kimi(?:-code)?[\\/]+plans[\\/]+[^\s"'<>|]+\.md)/gi;

export function cleanPlanPath(pathValue: string) {
  return pathValue.trim().replace(/[),.;，。；）]+$/u, "");
}

export function extractPlanPathFromText(text: string) {
  const matches = text.match(KIMI_PLAN_PATH_PATTERN);
  return matches?.map(cleanPlanPath).find(Boolean) ?? null;
}

export function findSessionPlanPath(events: TimelineEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "change_summary") {
      for (let fileIndex = event.files.length - 1; fileIndex >= 0; fileIndex -= 1) {
        const planPath = extractPlanPathFromText(event.files[fileIndex].path);
        if (planPath) return planPath;
      }
    }
    if (event.type === "assistant_message" || event.type === "user_message" || event.type === "steer_message") {
      const planPath = extractPlanPathFromText(event.content);
      if (planPath) return planPath;
    }
    if (event.type === "question_request") {
      for (const question of event.questions) {
        const planPath = extractPlanPathFromText([
          question.header,
          question.question,
          ...question.options.flatMap((option) => [option.label, option.description]),
        ].filter(Boolean).join("\n"));
        if (planPath) return planPath;
      }
    }
  }
  return null;
}

export function hasSessionPlanSignal(events: TimelineEvent[]) {
  return events.some((event) => {
    if (event.type === "question_request") {
      return event.questions.some((question) => (
        /plan/i.test(question.header ?? "") ||
        /approve this plan|reject and exit/i.test([
          question.question,
          ...question.options.flatMap((option) => [option.label, option.description ?? ""]),
        ].join("\n"))
      ));
    }
    if (event.type === "change_summary") {
      return event.files.some((file) => /[\\/]?\.kimi(?:-code)?[\\/]plans[\\/].+\.md/i.test(file.path));
    }
    return false;
  });
}
