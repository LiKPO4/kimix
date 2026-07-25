export type OfficialCompactionTerminal = {
  type: "full_compaction.complete" | "full_compaction.cancel";
  time: number;
  [key: string]: unknown;
};

export function findOfficialCompactionTerminal(
  content: string,
  startedAt: number,
): OfficialCompactionTerminal | null {
  const lines = content.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      if (record.type !== "full_compaction.complete" && record.type !== "full_compaction.cancel") continue;
      if (typeof record.time !== "number" || record.time < startedAt) continue;
      return record as OfficialCompactionTerminal;
    } catch {
      continue;
    }
  }
  return null;
}
