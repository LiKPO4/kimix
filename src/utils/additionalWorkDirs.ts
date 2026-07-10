import { normalizePathForComparison } from "./pathCase";

export function normalizeAdditionalWorkDirs(dirs: readonly string[] | undefined | null): string[] {
  if (!Array.isArray(dirs)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const dir of dirs) {
    const trimmed = dir.trim();
    if (!trimmed) continue;
    const key = normalizePathForComparison(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
