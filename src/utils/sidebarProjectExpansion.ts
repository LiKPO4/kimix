import { normalizePathForComparison } from "./pathCase";

export const SIDEBAR_EXPANDED_PROJECT_PATHS_KEY = "kimix_sidebar_expanded_project_paths";

export type RestoredSidebarProjectExpansion = {
  hasSavedState: boolean;
  paths: Set<string>;
};

export function readSidebarExpandedProjectPaths(): RestoredSidebarProjectExpansion {
  try {
    const raw = localStorage.getItem(SIDEBAR_EXPANDED_PROJECT_PATHS_KEY);
    if (raw === null) return { hasSavedState: false, paths: new Set() };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { hasSavedState: false, paths: new Set() };
    const paths = parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => normalizePathForComparison(item))
      .filter(Boolean);
    return { hasSavedState: true, paths: new Set(paths) };
  } catch {
    return { hasSavedState: false, paths: new Set() };
  }
}

export function persistSidebarExpandedProjectPaths(paths: Iterable<string>) {
  try {
    const normalized = Array.from(new Set(Array.from(paths)
      .map((item) => normalizePathForComparison(item))
      .filter(Boolean)))
      .slice(-100);
    localStorage.setItem(SIDEBAR_EXPANDED_PROJECT_PATHS_KEY, JSON.stringify(normalized));
  } catch {
    // Sidebar expansion is a convenience preference; keep the in-memory state usable.
  }
}
