import { describe, it, expect } from "vitest";
import { alignSessionDiffsToGitStatus, buildUnifiedDiff, collectSessionDiffs, countUnifiedDiffChanges } from "../diff";
import type { TimelineEvent } from "@/types/ui";

describe("buildUnifiedDiff", () => {
  it("returns empty for identical text", () => {
    expect(buildUnifiedDiff("hello", "hello")).toEqual([
      { kind: "same", oldNumber: 1, newNumber: 1, text: "hello" },
    ]);
  });

  it("detects added line", () => {
    expect(buildUnifiedDiff("a", "a\nb")).toEqual([
      { kind: "same", oldNumber: 1, newNumber: 1, text: "a" },
      { kind: "added", newNumber: 2, text: "b" },
    ]);
  });

  it("detects removed line", () => {
    expect(buildUnifiedDiff("a\nb", "a")).toEqual([
      { kind: "same", oldNumber: 1, newNumber: 1, text: "a" },
      { kind: "removed", oldNumber: 2, text: "b" },
    ]);
  });

  it("handles multi-line changes", () => {
    const oldText = "line1\nline2\nline3";
    const newText = "line1\nmodified\nline3";
    const diff = buildUnifiedDiff(oldText, newText);
    expect(diff.some((d) => d.kind === "removed")).toBe(true);
    expect(diff.some((d) => d.kind === "added")).toBe(true);
    expect(diff.some((d) => d.kind === "same")).toBe(true);
  });

  it("handles empty strings", () => {
    expect(buildUnifiedDiff("", "")).toEqual([{ kind: "same", oldNumber: 1, newNumber: 1, text: "" }]);
  });

  it("handles new file (empty to content)", () => {
    const diff = buildUnifiedDiff("", "new");
    expect(diff.some((d) => d.kind === "added" && d.text === "new")).toBe(true);
  });
});

describe("countUnifiedDiffChanges", () => {
  it("counts an equal-line replacement as one addition and one deletion", () => {
    expect(countUnifiedDiffChanges("before", "after")).toEqual({ additions: 1, deletions: 1 });
  });

  it("does not count unchanged context around a replacement", () => {
    expect(countUnifiedDiffChanges("a\nbefore\nc", "a\nafter\nc")).toEqual({ additions: 1, deletions: 1 });
  });

  it("keeps exact statistics for a small edit inside a large file", () => {
    const oldLines = Array.from({ length: 5000 }, (_, index) => `line-${index}`);
    const newLines = [...oldLines];
    newLines[2500] = "changed";
    expect(countUnifiedDiffChanges(oldLines.join("\n"), newLines.join("\n"))).toEqual({ additions: 1, deletions: 1 });
  });

  it("falls back to linear region counts for a wholesale large rewrite", () => {
    const oldText = Array.from({ length: 6000 }, (_, index) => `old-${index}`).join("\n");
    const newText = Array.from({ length: 6000 }, (_, index) => `new-${index}`).join("\n");
    const startedAt = performance.now();
    const stats = countUnifiedDiffChanges(oldText, newText);
    const elapsedMs = performance.now() - startedAt;
    // No shared lines: the linear fallback is still exact here, and must not
    // pay the O(distance^2) Myers cost (~2.4s measured for 6000 replaced lines).
    expect(stats).toEqual({ additions: 6000, deletions: 6000 });
    expect(elapsedMs).toBeLessThan(1000);
  });

  it("reports an oversized partially-shared region as a wholesale replacement", () => {
    const oldMiddle = Array.from({ length: 2100 }, (_, index) => `o-${index}`);
    const newMiddle = Array.from({ length: 2150 }, (_, index) => `n-${index}`);
    // Shared lines deep inside the region cannot be trimmed from either edge.
    oldMiddle.splice(1000, 75, ...Array.from({ length: 75 }, (_, index) => `shared-${index}`));
    newMiddle.splice(1200, 75, ...Array.from({ length: 75 }, (_, index) => `shared-${index}`));
    const oldText = ["head", ...oldMiddle, "tail"].join("\n");
    const newText = ["head", ...newMiddle, "tail"].join("\n");
    // 2100 + 2150 exceeds the exact-search budget, so the whole region counts
    // as replaced (exact Myers would credit the 75 shared lines instead).
    expect(countUnifiedDiffChanges(oldText, newText)).toEqual({ additions: 2150, deletions: 2100 });
  });
});

describe("collectSessionDiffs", () => {
  it("extracts diff events", () => {
    const events: TimelineEvent[] = [
      {
        id: "d1",
        type: "diff",
        timestamp: 1000,
        filePath: "src/app.ts",
        oldText: "const x = 1;",
        newText: "const x = 2;",
      },
    ];
    const diffs = collectSessionDiffs(events);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].filePath).toBe("src/app.ts");
    expect(diffs[0].additions).toBe(1);
    expect(diffs[0].deletions).toBe(1);
  });

  it("ignores non-diff events", () => {
    const events: TimelineEvent[] = [
      { id: "1", type: "user_message", timestamp: 1, content: "hi" },
      { id: "2", type: "assistant_message", timestamp: 2, content: "hello", isThinking: false, isComplete: true },
    ];
    expect(collectSessionDiffs(events)).toHaveLength(0);
  });

  it("counts additions and deletions correctly", () => {
    const events: TimelineEvent[] = [
      {
        id: "d1",
        type: "diff",
        timestamp: 1000,
        filePath: "a.ts",
        oldText: "line1",
        newText: "line1\nline2\nline3",
      },
    ];
    const diffs = collectSessionDiffs(events);
    expect(diffs[0].additions).toBe(2);
    expect(diffs[0].deletions).toBe(0);
  });

  it("sorts by timestamp descending", () => {
    const events: TimelineEvent[] = [
      { id: "d1", type: "diff", timestamp: 100, filePath: "a.ts", oldText: "", newText: "" },
      { id: "d2", type: "diff", timestamp: 300, filePath: "b.ts", oldText: "", newText: "" },
      { id: "d3", type: "diff", timestamp: 200, filePath: "c.ts", oldText: "", newText: "" },
    ];
    const diffs = collectSessionDiffs(events);
    expect(diffs.map((d) => d.filePath)).toEqual(["b.ts", "c.ts", "a.ts"]);
  });
});

describe("alignSessionDiffsToGitStatus", () => {
  it("aligns a stale first path segment to the current git status path", () => {
    const diffs = [{
      id: "d1",
      filePath: "v_browser/android/app/src/main/kotlin/com/linjianglu/tvbrowser/MainActivity.kt",
      timestamp: 100,
      oldText: "",
      newText: "",
      additions: 0,
      deletions: 0,
    }];
    const gitStatus = " M tv_browser/android/app/src/main/kotlin/com/linjianglu/tvbrowser/MainActivity.kt";

    expect(alignSessionDiffsToGitStatus(diffs, gitStatus)[0].filePath).toBe(
      "tv_browser/android/app/src/main/kotlin/com/linjianglu/tvbrowser/MainActivity.kt",
    );
  });

  it("handles a porcelain status line whose leading status column was trimmed by an older build", () => {
    const diffs = [{
      id: "d1",
      filePath: "v_browser/android/app/src/main/kotlin/com/linjianglu/tvbrowser/MainActivity.kt",
      timestamp: 100,
      oldText: "",
      newText: "",
      additions: 0,
      deletions: 0,
    }];
    const gitStatus = "M tv_browser/android/app/src/main/kotlin/com/linjianglu/tvbrowser/MainActivity.kt";

    expect(alignSessionDiffsToGitStatus(diffs, gitStatus)[0].filePath).toBe(
      "tv_browser/android/app/src/main/kotlin/com/linjianglu/tvbrowser/MainActivity.kt",
    );
  });

  it("keeps the original diff path when git status has no unique match", () => {
    const diffs = [{
      id: "d1",
      filePath: "src/app.ts",
      timestamp: 100,
      oldText: "",
      newText: "",
      additions: 0,
      deletions: 0,
    }];

    expect(alignSessionDiffsToGitStatus(diffs, "")[0].filePath).toBe("src/app.ts");
  });
});
