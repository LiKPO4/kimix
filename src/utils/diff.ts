import type { TimelineEvent } from "@/types/ui";

export type DiffLine = {
  kind: "same" | "added" | "removed";
  oldNumber?: number;
  newNumber?: number;
  text: string;
};

export type SessionDiffEntry = {
  id: string;
  filePath: string;
  timestamp: number;
  oldText: string;
  newText: string;
  additions: number;
  deletions: number;
};

function countDiffLines(value: string) {
  if (!value.trim()) return 0;
  return value.split("\n").length;
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^"|"$/g, "");
}

function stripFirstPathSegment(value: string) {
  const normalized = normalizePath(value);
  const index = normalized.indexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1);
}

function parseGitStatusPaths(status: string) {
  return status
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const rawPath = line[2] === " " ? line.slice(3).trim() : line.slice(2).trim();
      const pathPart = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() ?? rawPath : rawPath;
      return normalizePath(pathPart);
    })
    .filter(Boolean);
}

function alignPathToGitStatus(filePath: string, gitStatusPaths: string[]) {
  const normalized = normalizePath(filePath);
  if (gitStatusPaths.includes(normalized)) return normalized;

  const innerPath = stripFirstPathSegment(normalized);
  const sameInnerPathMatches = gitStatusPaths.filter((path) => stripFirstPathSegment(path) === innerPath);
  if (sameInnerPathMatches.length === 1) return sameInnerPathMatches[0];

  const suffixMatches = gitStatusPaths.filter((path) => path.endsWith(normalized) || normalized.endsWith(path));
  return suffixMatches.length === 1 ? suffixMatches[0] : normalized;
}

export function buildUnifiedDiff(oldText = "", newText = ""): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const rows = oldLines.length + 1;
  const cols = newLines.length + 1;
  const table = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      table[i][j] = oldLines[i] === newLines[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const diff: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      diff.push({ kind: "same", oldNumber: oldIndex + 1, newNumber: newIndex + 1, text: oldLines[oldIndex] });
      oldIndex += 1;
      newIndex += 1;
    } else if (table[oldIndex + 1][newIndex] >= table[oldIndex][newIndex + 1]) {
      diff.push({ kind: "removed", oldNumber: oldIndex + 1, text: oldLines[oldIndex] });
      oldIndex += 1;
    } else {
      diff.push({ kind: "added", newNumber: newIndex + 1, text: newLines[newIndex] });
      newIndex += 1;
    }
  }
  while (oldIndex < oldLines.length) {
    diff.push({ kind: "removed", oldNumber: oldIndex + 1, text: oldLines[oldIndex] });
    oldIndex += 1;
  }
  while (newIndex < newLines.length) {
    diff.push({ kind: "added", newNumber: newIndex + 1, text: newLines[newIndex] });
    newIndex += 1;
  }
  return diff;
}

export function collectSessionDiffs(events: TimelineEvent[]): SessionDiffEntry[] {
  return events
    .filter((event): event is Extract<TimelineEvent, { type: "diff" }> => event.type === "diff")
    .map((event) => ({
      id: event.id,
      filePath: event.filePath,
      timestamp: event.timestamp,
      oldText: event.oldText,
      newText: event.newText,
      additions: Math.max(0, countDiffLines(event.newText) - countDiffLines(event.oldText)),
      deletions: Math.max(0, countDiffLines(event.oldText) - countDiffLines(event.newText)),
    }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

export function alignSessionDiffsToGitStatus(diffs: SessionDiffEntry[], gitStatus: string): SessionDiffEntry[] {
  const gitStatusPaths = parseGitStatusPaths(gitStatus);
  if (gitStatusPaths.length === 0) return diffs;
  return diffs.map((diff) => ({
    ...diff,
    filePath: alignPathToGitStatus(diff.filePath, gitStatusPaths),
  }));
}
