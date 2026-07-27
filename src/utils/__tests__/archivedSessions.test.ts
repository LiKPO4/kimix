import { describe, expect, it } from "vitest";
import {
  archivedTimeMs,
  archivedWorkspaceOptions,
  dedupeArchivedCount,
  filterArchivedSessions,
  formatArchivedTime,
  groupArchivedSessionsByWorkspace,
  OTHER_WORKSPACE_KEY,
  sortArchivedSessions,
  type ArchivedListItem,
} from "../archivedSessions";

function item(id: string, patch: Partial<ArchivedListItem> = {}): ArchivedListItem {
  return {
    id,
    title: id,
    projectPath: "D:/proj/a",
    archivedAt: "2026-07-20T10:00:00+08:00",
    updatedAt: "2026-07-20T10:00:00+08:00",
    createdAt: "2026-07-01T10:00:00+08:00",
    ...patch,
  };
}

describe("archivedTimeMs", () => {
  it("prefers archivedAt and falls back to updatedAt then createdAt", () => {
    expect(archivedTimeMs(item("x", { archivedAt: "2026-07-25T10:00:00+08:00" }))).toBe(Date.parse("2026-07-25T10:00:00+08:00"));
    expect(archivedTimeMs(item("x", { archivedAt: "", updatedAt: "2026-07-21T10:00:00+08:00" }))).toBe(Date.parse("2026-07-21T10:00:00+08:00"));
    expect(archivedTimeMs(item("x", { archivedAt: "", updatedAt: "", createdAt: "2026-07-02T10:00:00+08:00" }))).toBe(Date.parse("2026-07-02T10:00:00+08:00"));
    expect(archivedTimeMs(item("x", { archivedAt: "", updatedAt: "", createdAt: "" }))).toBe(0);
  });
});

describe("filterArchivedSessions", () => {
  const items = [
    item("a", { title: "修复尸气反噬", projectPath: "D:/proj/a" }),
    item("b", { title: "New Session", projectPath: "C:/Users/x/RemoveBlack" }),
    item("c", { title: "无路径会话", projectPath: "" }),
  ];

  it("matches title and project path case-insensitively", () => {
    expect(filterArchivedSessions(items, "尸气", "all").map((i) => i.id)).toEqual(["a"]);
    expect(filterArchivedSessions(items, "removeblack", "all").map((i) => i.id)).toEqual(["b"]);
    expect(filterArchivedSessions(items, "", "all")).toHaveLength(3);
  });

  it("filters by workspace with the no-path group under 其他", () => {
    expect(filterArchivedSessions(items, "", "D:/proj/a").map((i) => i.id)).toEqual(["a"]);
    expect(filterArchivedSessions(items, "", OTHER_WORKSPACE_KEY).map((i) => i.id)).toEqual(["c"]);
  });
});

describe("sortArchivedSessions", () => {
  const items = [
    item("b", { title: "乙", archivedAt: "2026-07-20T10:00:00+08:00", createdAt: "2026-07-02T10:00:00+08:00" }),
    item("a", { title: "甲", archivedAt: "2026-07-25T10:00:00+08:00", createdAt: "2026-07-01T10:00:00+08:00" }),
  ];

  it("sorts by archive time, creation time, and alphabet", () => {
    expect(sortArchivedSessions(items, "archived").map((i) => i.id)).toEqual(["a", "b"]);
    expect(sortArchivedSessions(items, "created").map((i) => i.id)).toEqual(["b", "a"]);
    expect(sortArchivedSessions(items, "alpha").map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("groupArchivedSessionsByWorkspace", () => {
  it("orders groups by latest archive time and keeps 其他 last", () => {
    const items = [
      item("a", { projectPath: "", archivedAt: "2026-07-26T10:00:00+08:00" }),
      item("b", { projectPath: "D:/proj/old", archivedAt: "2026-07-20T10:00:00+08:00" }),
      item("c", { projectPath: "D:/proj/new", archivedAt: "2026-07-25T10:00:00+08:00" }),
      item("d", { projectPath: "D:/proj/new", archivedAt: "2026-07-24T10:00:00+08:00" }),
    ];
    const groups = groupArchivedSessionsByWorkspace(items);
    expect(groups.map((g) => g.workspaceKey)).toEqual(["D:/proj/new", "D:/proj/old", OTHER_WORKSPACE_KEY]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["c", "d"]);
    expect(groups[2].workspaceLabel).toBe("其他");
  });

  it("derives workspace options the same way", () => {
    const options = archivedWorkspaceOptions([item("a", { projectPath: "D:/proj/a" }), item("b", { projectPath: "" })]);
    expect(options).toEqual([
      { key: "D:/proj/a", label: "D:/proj/a" },
      { key: OTHER_WORKSPACE_KEY, label: "其他" },
    ]);
  });
});

describe("dedupeArchivedCount", () => {
  it("counts the union of official and local ids", () => {
    expect(dedupeArchivedCount(["a", "b", "c"], ["b", "d"])).toBe(4);
  });
});

describe("formatArchivedTime", () => {
  it("formats absolute local time like the official panel", () => {
    expect(formatArchivedTime(Date.parse("2026-07-25T20:07:00+08:00"))).toMatch(/^2026-07-25 20:07$/);
    expect(formatArchivedTime(0)).toBe("");
  });
});
