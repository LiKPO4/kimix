export function normalizeAdditionalWorkDirs(dirs: readonly string[] | undefined | null): string[] {
  if (!Array.isArray(dirs)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const dir of dirs) {
    const trimmed = dir.trim();
    if (!trimmed) continue;
    const key = trimmed.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
