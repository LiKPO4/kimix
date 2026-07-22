import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import { findDiffForChangeFile } from "../changePreview";

const diffs: TimelineEvent[] = [
  { id: "diff-old", type: "diff", timestamp: 10, filePath: "src/app.ts", oldText: "a", newText: "b", agentTurnId: "turn-old" },
  { id: "diff-new", type: "diff", timestamp: 20, filePath: "src/app.ts", oldText: "b", newText: "c", agentTurnId: "turn-new" },
];

describe("findDiffForChangeFile", () => {
  it("uses the explicit diff identity instead of a later diff for the same path", () => {
    const summary: Extract<TimelineEvent, { type: "change_summary" }> = {
      id: "summary-old",
      type: "change_summary",
      timestamp: 10,
      files: [{ path: "src/app.ts", diffEventId: "diff-old" }],
      additions: 1,
      deletions: 1,
    };
    expect(findDiffForChangeFile(diffs, summary, summary.files[0])?.id).toBe("diff-old");
  });

  it("only falls back to an unambiguous diff from the same timestamp and turn", () => {
    const summary: Extract<TimelineEvent, { type: "change_summary" }> = {
      id: "summary-old",
      type: "change_summary",
      timestamp: 10,
      agentTurnId: "turn-old",
      files: [{ path: "src/app.ts" }],
      additions: 1,
      deletions: 1,
    };
    expect(findDiffForChangeFile(diffs, summary, summary.files[0])?.id).toBe("diff-old");
  });

  it("does not borrow a later turn diff merely because the path matches", () => {
    const summary: Extract<TimelineEvent, { type: "change_summary" }> = {
      id: "summary-missing",
      type: "change_summary",
      timestamp: 15,
      files: [{ path: "src/app.ts" }],
      additions: 0,
      deletions: 0,
    };
    expect(findDiffForChangeFile(diffs, summary, summary.files[0])).toBeNull();
  });
});
