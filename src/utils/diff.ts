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

// Beyond this many lines in the changed region, the Myers search below costs
// O(distance^2): a Write/big-Edit rewriting thousands of lines with few shared
// lines blocked the UI for seconds. Larger regions are reported as a wholesale
// replacement (linear) instead of exact statistics.
const MAX_EXACT_DIFF_REGION_LINES = 4000;

export function countUnifiedDiffChanges(oldText = "", newText = "") {
  const toLines = (value: string) => {
    if (!value) return [];
    const lines = value.replace(/\r\n/g, "\n").split("\n");
    if (lines.at(-1) === "") lines.pop();
    return lines;
  };
  const oldLines = toLines(oldText);
  const newLines = toLines(newText);
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  if (oldCount === 0) return { additions: newCount, deletions: 0 };
  if (newCount === 0) return { additions: 0, deletions: oldCount };

  // Strip the common prefix/suffix: exact for the shared runs, and shrinks the
  // region the quadratic search below has to inspect.
  let prefix = 0;
  const maxShared = Math.min(oldCount, newCount);
  while (prefix < maxShared && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < maxShared - prefix && oldLines[oldCount - 1 - suffix] === newLines[newCount - 1 - suffix]) {
    suffix += 1;
  }

  const oldMiddle = oldLines.slice(prefix, oldCount - suffix);
  const newMiddle = newLines.slice(prefix, newCount - suffix);
  const oldMiddleCount = oldMiddle.length;
  const newMiddleCount = newMiddle.length;
  if (oldMiddleCount === 0) return { additions: newMiddleCount, deletions: 0 };
  if (newMiddleCount === 0) return { additions: 0, deletions: oldMiddleCount };
  if (oldMiddleCount + newMiddleCount > MAX_EXACT_DIFF_REGION_LINES) {
    return { additions: newMiddleCount, deletions: oldMiddleCount };
  }

  // Myers shortest-edit-path: exact line statistics without the O(n*m)
  // matrix used by the small visual diff renderer.
  const furthest = new Map<number, number>([[1, 0]]);
  const maxDistance = oldMiddleCount + newMiddleCount;
  for (let distance = 0; distance <= maxDistance; distance += 1) {
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const down = diagonal === -distance
        || (diagonal !== distance && (furthest.get(diagonal - 1) ?? -1) < (furthest.get(diagonal + 1) ?? -1));
      let oldIndex = down
        ? furthest.get(diagonal + 1) ?? 0
        : (furthest.get(diagonal - 1) ?? 0) + 1;
      let newIndex = oldIndex - diagonal;
      while (oldIndex < oldMiddleCount && newIndex < newMiddleCount && oldMiddle[oldIndex] === newMiddle[newIndex]) {
        oldIndex += 1;
        newIndex += 1;
      }
      furthest.set(diagonal, oldIndex);
      if (oldIndex >= oldMiddleCount && newIndex >= newMiddleCount) {
        const delta = newMiddleCount - oldMiddleCount;
        return {
          additions: (distance + delta) / 2,
          deletions: (distance - delta) / 2,
        };
      }
    }
  }
  return { additions: newMiddleCount, deletions: oldMiddleCount };
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
      ...countUnifiedDiffChanges(event.oldText, event.newText),
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
