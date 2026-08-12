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

function indexNumstat(entries: GitNumstatEntryLike[]): Map<string, GitNumstatEntryLike> {
  return new Map(entries.map((entry) => [normalizeGitPath(entry.path), entry]));
}

/**
 * 比较轮次开始与结束时的累计 Git numstat，只保留本轮造成净变化的路径。
 * 对已有脏文件使用计数差值，避免把会话开始前的整份改动量归给当前轮次。
 */
export function diffGitNumstatBaseline(
  baseline: GitNumstatEntryLike[],
  current: GitNumstatEntryLike[],
): GitNumstatEntryLike[] {
  const before = indexNumstat(baseline);
  const after = indexNumstat(current);
  const changed: GitNumstatEntryLike[] = [];
  const paths = new Set([...before.keys(), ...after.keys()]);
  for (const normalizedPath of paths) {
    const previous = before.get(normalizedPath);
    const entry = after.get(normalizedPath);
    if (!previous) {
      if (entry) changed.push(entry);
      continue;
    }
    if (!entry) {
      changed.push({ path: previous.path, added: previous.removed, removed: previous.added });
      continue;
    }
    if (previous.added === entry.added && previous.removed === entry.removed) continue;
    changed.push({
      path: entry.path,
      // 累计 numstat 可能因本轮“恢复”而下降：removed 下降等价于净新增，
      // added 下降等价于净删除。这里表达端点间净变化，而非重复展示 HEAD 总量。
      added: Math.max(0, entry.added - previous.added) + Math.max(0, previous.removed - entry.removed),
      removed: Math.max(0, entry.removed - previous.removed) + Math.max(0, previous.added - entry.added),
    });
  }
  return changed;
}

/** 统一路径书写差异（反斜杠、`./` 前缀），避免同一文件因写法不同被重复统计。 */
export function normalizeGitPath(filePath: string): string {
  let normalized = filePath.replace(/\\/g, "/");
  while (normalized.startsWith("./")) normalized = normalized.slice(2);
  normalized = normalized.replace(/\/{2,}/g, "/");
  return normalized;
}

/**
 * 收集事件里所有已由 change_summary / diff 事件记录过的文件路径（全量历史，跨轮去重）。
 * git numstat 是相对 HEAD 的累计快照：同一未提交文件在后续轮次会继续出现在 numstat，
 * 若去重窗口只切本轮，该文件会跨轮重复进变更卡。按路径做全量去重后，一个文件在
 * 未提交窗口内只出现一次变更卡（代价：连续两轮 Bash 改同一未提交文件时第二轮不重复显示）。
 */
export function collectRecordedChangePaths(events: TimelineEvent[]): Set<string> {
  const paths = new Set<string>();
  for (const event of events) {
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
  numstat: GitNumstatEntryLike[],
  baseline: GitNumstatEntryLike[],
): GitFallbackPlan | null {
  const recorded = collectRecordedChangePaths(events);
  const turnChanges = diffGitNumstatBaseline(baseline, numstat);
  const files: GitFallbackPlan["files"] = [];
  let additions = 0;
  let deletions = 0;
  for (const entry of turnChanges) {
    if (recorded.has(normalizeGitPath(entry.path))) continue;
    files.push({ path: entry.path, additions: entry.added, deletions: entry.removed });
    additions += entry.added;
    deletions += entry.removed;
  }
  if (files.length === 0) return null;
  return { files, additions, deletions };
}
