import type { TimelineEvent } from "@/types/ui";

/** git numstat 结果条目（与 electron `GitNumstatEntry` 结构一致）。 */
export interface GitNumstatEntryLike {
  path: string;
  added: number;
  removed: number;
}

export interface GitFallbackPlan {
  files: { path: string; additions: number; deletions: number }[];
  additions: number;
  deletions: number;
}

/** 统一路径书写差异（反斜杠、`./` 前缀），避免同一文件因写法不同被重复统计。 */
export function normalizeGitPath(filePath: string): string {
  let normalized = filePath.replace(/\\/g, "/");
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  return normalized;
}

/**
 * 收集 eventStartIndex 之后已由 change_summary / diff 事件记录过的文件路径。
 * 用于轮次完成时把 git 变更里「未出现过的」文件补齐到文件变更卡。
 */
export function collectRecordedChangePaths(events: TimelineEvent[], eventStartIndex: number): Set<string> {
  const paths = new Set<string>();
  for (const event of events.slice(eventStartIndex)) {
    if (event.type === "change_summary") {
      for (const file of event.files) paths.add(normalizeGitPath(file.path));
    } else if (event.type === "diff") {
      paths.add(normalizeGitPath(event.filePath));
    }
  }
  return paths;
}

/**
 * 从 git numstat 结果中挑出本轮尚未被记录的文件并汇总行数。
 * 返回 null 表示没有需要补齐的变更（或全部已被记录）。
 */
export function planGitFallbackChanges(
  events: TimelineEvent[],
  eventStartIndex: number,
  numstat: GitNumstatEntryLike[],
): GitFallbackPlan | null {
  const recorded = collectRecordedChangePaths(events, eventStartIndex);
  const files: GitFallbackPlan["files"] = [];
  let additions = 0;
  let deletions = 0;
  for (const entry of numstat) {
    if (recorded.has(normalizeGitPath(entry.path))) continue;
    files.push({ path: entry.path, additions: entry.added, deletions: entry.removed });
    additions += entry.added;
    deletions += entry.removed;
  }
  if (files.length === 0) return null;
  return { files, additions, deletions };
}
