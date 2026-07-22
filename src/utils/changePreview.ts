import type { ChangeSummaryFile, TimelineEvent } from "@/types/ui";
import { normalizePathForComparison } from "./pathCase";

function normalizePath(value: string, projectPath?: string) {
  const path = value.trim().replace(/^['"]|['"]$/g, "").replace(/\\/g, "/");
  if (!projectPath || /^(?:[a-z]:\/|\/)/i.test(path)) return normalizePathForComparison(path);
  return normalizePathForComparison(`${projectPath.replace(/[\\/]+$/, "")}/${path}`);
}

export function findDiffForChangeFile(
  events: TimelineEvent[],
  summary: Extract<TimelineEvent, { type: "change_summary" }>,
  file: ChangeSummaryFile,
  projectPath?: string,
) {
  if (file.diffEventId) {
    const exact = events.find((event): event is Extract<TimelineEvent, { type: "diff" }> => (
      event.type === "diff" && event.id === file.diffEventId
    ));
    if (exact) return exact;
  }

  const normalizedFile = normalizePath(file.path, projectPath);
  const candidates = events.filter((event): event is Extract<TimelineEvent, { type: "diff" }> => {
    if (event.type !== "diff" || event.timestamp !== summary.timestamp) return false;
    if (summary.agentTurnId && event.agentTurnId && summary.agentTurnId !== event.agentTurnId) return false;
    return normalizePath(event.filePath, projectPath) === normalizedFile;
  });
  return candidates.length === 1 ? candidates[0] : null;
}
