import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "@/types/ui";
import {
  collectRecordedChangePaths,
  normalizeGitPath,
  planGitFallbackChanges,
} from "./gitFallbackChanges";

function changeSummaryEvent(id: string, paths: string[]): TimelineEvent {
  return {
    id,
    type: "change_summary",
    timestamp: 1000,
    files: paths.map((path) => ({ path, additions: 1, deletions: 0 })),
    additions: paths.length,
    deletions: 0,
  };
}

function diffEvent(id: string, filePath: string): TimelineEvent {
  return { id, type: "diff", timestamp: 1000, filePath, oldText: "a", newText: "b" };
}

describe("normalizeGitPath", () => {
  it("统一反斜杠与正斜杠", () => {
    expect(normalizeGitPath("src\\App.tsx")).toBe("src/App.tsx");
    expect(normalizeGitPath("src/App.tsx")).toBe("src/App.tsx");
  });

  it("去掉 ./ 前缀", () => {
    expect(normalizeGitPath("./src/App.tsx")).toBe("src/App.tsx");
    expect(normalizeGitPath("././src/App.tsx")).toBe("src/App.tsx");
  });
});

describe("collectRecordedChangePaths", () => {
  it("收集全量历史事件（跨轮去重），change_summary 与 diff 都算", () => {
    const events: TimelineEvent[] = [
      changeSummaryEvent("a", ["src/before.ts"]),
      diffEvent("b", "src/diffed.ts"),
      changeSummaryEvent("c", ["src/recorded.ts", "src/other.ts"]),
    ];
    const paths = collectRecordedChangePaths(events);
    expect([...paths].sort()).toEqual(["src/before.ts", "src/diffed.ts", "src/other.ts", "src/recorded.ts"]);
  });

  it("对反斜杠路径同样去重", () => {
    const events: TimelineEvent[] = [changeSummaryEvent("c", ["src\\recorded.ts"])];
    const paths = collectRecordedChangePaths(events);
    expect(paths.has("src/recorded.ts")).toBe(true);
  });
});

describe("planGitFallbackChanges", () => {
  const events: TimelineEvent[] = [
    changeSummaryEvent("a", ["src/recorded.ts"]),
    diffEvent("b", "src/diffed.ts"),
  ];

  it("过滤已记录文件并汇总行数", () => {
    const plan = planGitFallbackChanges(events, [
      { path: "src/recorded.ts", added: 10, removed: 2 },
      { path: "src/diffed.ts", added: 1, removed: 1 },
      { path: "src/untracked-new.ts", added: 3, removed: 0 },
      { path: "src/from-bash.ts", added: 5, removed: 4 },
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.files).toEqual([
      { path: "src/untracked-new.ts", additions: 3, deletions: 0 },
      { path: "src/from-bash.ts", additions: 5, deletions: 4 },
    ]);
    expect(plan!.additions).toBe(8);
    expect(plan!.deletions).toBe(4);
  });

  it("全部已记录时返回 null", () => {
    const plan = planGitFallbackChanges(events, [
      { path: "src/recorded.ts", added: 1, removed: 0 },
      { path: "src/diffed.ts", added: 1, removed: 0 },
    ]);
    expect(plan).toBeNull();
  });

  it("空 numstat 返回 null", () => {
    expect(planGitFallbackChanges(events, [])).toBeNull();
  });

  it("历史已记录的未提交文件在后续轮次不重复（跨轮去重）", () => {
    // 上一轮 Bash 改了 src/recorded.ts 未提交，fallback 已生成 change_summary；
    // 本轮 numstat 仍含该路径（累计快照），应被全量历史去重排除。
    const plan = planGitFallbackChanges(events, [
      { path: "src/recorded.ts", added: 9, removed: 0 },
      { path: "src/from-bash-new.ts", added: 2, removed: 0 },
    ]);
    expect(plan).not.toBeNull();
    expect(plan!.files).toEqual([{ path: "src/from-bash-new.ts", additions: 2, deletions: 0 }]);
  });
});
