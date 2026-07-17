/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";
import {
  getSidebarProjectClickAction,
  persistSidebarExpandedProjectPaths,
  readSidebarExpandedProjectPaths,
  SIDEBAR_EXPANDED_PROJECT_PATHS_KEY,
} from "../sidebarProjectExpansion";

describe("sidebar project expansion persistence", () => {
  beforeEach(() => localStorage.clear());

  it("distinguishes a first launch from an explicitly collapsed sidebar", () => {
    expect(readSidebarExpandedProjectPaths()).toMatchObject({ hasSavedState: false });

    persistSidebarExpandedProjectPaths([]);

    const restored = readSidebarExpandedProjectPaths();
    expect(restored.hasSavedState).toBe(true);
    expect([...restored.paths]).toEqual([]);
  });

  it("persists normalized project paths without duplicates", () => {
    persistSidebarExpandedProjectPaths([
      "D:\\WORKS\\ProjectA\\",
      "D:/WORKS/ProjectA",
      "D:/WORKS/ProjectB/",
    ]);

    const restored = readSidebarExpandedProjectPaths();
    expect(restored.hasSavedState).toBe(true);
    expect([...restored.paths]).toEqual([
      "d:/works/projecta",
      "d:/works/projectb",
    ]);
  });

  it("treats malformed saved data as an unavailable preference", () => {
    localStorage.setItem(SIDEBAR_EXPANDED_PROJECT_PATHS_KEY, "not-json");

    expect(readSidebarExpandedProjectPaths()).toMatchObject({
      hasSavedState: false,
    });
  });

  it("creates a conversation when a clicked project has no available sessions", () => {
    expect(getSidebarProjectClickAction(0, false)).toBe("create-session");
    expect(getSidebarProjectClickAction(0, true)).toBe("create-session");
    expect(getSidebarProjectClickAction(1, false)).toBe("expand");
    expect(getSidebarProjectClickAction(1, true)).toBe("collapse");
  });
});
