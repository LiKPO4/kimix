/**
 * Archived-session list helpers for the settings archive panel: search,
 * sort modes, workspace grouping, and dedupe counting. Pure functions so the
 * panel logic stays testable (official kimi-web borrowed UX).
 */

export type ArchivedSortMode = "archived" | "created" | "alpha";

export type ArchivedListItem = {
  id: string;
  title: string;
  projectPath: string;
  /** NOTE: may be a fallback of updatedAt — the Server API exposes no archived_at. */
  archivedAt: string;
  updatedAt: string;
  createdAt: string;
};

export const OTHER_WORKSPACE_KEY = "__other__";
export const OTHER_WORKSPACE_LABEL = "其他";

function parseTime(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Sort/restore display time: archivedAt with updatedAt→createdAt fallback. */
export function archivedTimeMs(item: Pick<ArchivedListItem, "archivedAt" | "updatedAt" | "createdAt">): number {
  return parseTime(item.archivedAt) || parseTime(item.updatedAt) || parseTime(item.createdAt);
}

export function filterArchivedSessions<T extends ArchivedListItem>(
  items: readonly T[],
  query: string,
  workspace: string,
): T[] {
  const normalizedQuery = query.trim().toLowerCase();
  return items.filter((item) => {
    if (workspace !== "all" && (item.projectPath || OTHER_WORKSPACE_KEY) !== workspace) return false;
    if (!normalizedQuery) return true;
    return item.title.toLowerCase().includes(normalizedQuery) ||
      item.projectPath.toLowerCase().includes(normalizedQuery);
  });
}

export function sortArchivedSessions<T extends ArchivedListItem>(
  items: readonly T[],
  mode: ArchivedSortMode,
): T[] {
  const sorted = [...items];
  if (mode === "alpha") {
    sorted.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"));
    return sorted;
  }
  if (mode === "created") {
    sorted.sort((a, b) => parseTime(b.createdAt) - parseTime(a.createdAt));
    return sorted;
  }
  sorted.sort((a, b) => archivedTimeMs(b) - archivedTimeMs(a));
  return sorted;
}

export type ArchivedWorkspaceGroup<T extends ArchivedListItem> = {
  workspaceKey: string;
  workspaceLabel: string;
  items: T[];
};

/**
 * Group by projectPath; groups ordered by their latest item's archive time,
 * the no-path "其他" group always last. Item order within a group is kept
 * (the caller sorts first).
 */
export function groupArchivedSessionsByWorkspace<T extends ArchivedListItem>(
  items: readonly T[],
): ArchivedWorkspaceGroup<T>[] {
  const groups = new Map<string, ArchivedWorkspaceGroup<T>>();
  for (const item of items) {
    const key = item.projectPath || OTHER_WORKSPACE_KEY;
    const label = item.projectPath || OTHER_WORKSPACE_LABEL;
    const group = groups.get(key);
    if (group) group.items.push(item);
    else groups.set(key, { workspaceKey: key, workspaceLabel: label, items: [item] });
  }
  return [...groups.values()].sort((a, b) => {
    if (a.workspaceKey === OTHER_WORKSPACE_KEY) return 1;
    if (b.workspaceKey === OTHER_WORKSPACE_KEY) return -1;
    const aTime = Math.max(0, ...a.items.map(archivedTimeMs));
    const bTime = Math.max(0, ...b.items.map(archivedTimeMs));
    return bTime - aTime;
  });
}

/** Distinct workspace options for the filter dropdown, ordered by latest activity, "其他" last. */
export function archivedWorkspaceOptions<T extends ArchivedListItem>(
  items: readonly T[],
): { key: string; label: string }[] {
  return groupArchivedSessionsByWorkspace(items).map((group) => ({
    key: group.workspaceKey,
    label: group.workspaceLabel,
  }));
}

/** Dedupe the badge count: official and local records overlap for sessions archived locally. */
export function dedupeArchivedCount(officialIds: readonly string[], localIds: readonly string[]): number {
  return new Set([...officialIds, ...localIds]).size;
}

/** Absolute local time label matching the official panel ("2026-07-25 20:07"). */
export function formatArchivedTime(ms: number): string {
  if (!ms) return "";
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
