export type OfficialCompactionTerminal = {
  type: "full_compaction.complete" | "full_compaction.cancel";
  time: number;
  [key: string]: unknown;
};

export type OfficialCompactionResult = {
  terminal: OfficialCompactionTerminal;
  usage?: Record<string, unknown>;
};

export function findOfficialCompactionResult(
  content: string,
  startedAt: number,
): OfficialCompactionResult | null {
  const lines = content.split(/\r?\n/);
  let terminal: OfficialCompactionTerminal | null = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      if (!terminal) {
        if (record.type !== "full_compaction.complete" && record.type !== "full_compaction.cancel") continue;
        if (typeof record.time !== "number" || record.time < startedAt) continue;
        terminal = record as OfficialCompactionTerminal;
        if (terminal.type === "full_compaction.cancel") return { terminal };
        continue;
      }
      if (
        record.type === "usage.record" &&
        record.usageScope === "session" &&
        typeof record.time === "number" &&
        record.time >= startedAt &&
        record.time <= terminal.time
      ) {
        return { terminal, usage: record };
      }
    } catch {
      continue;
    }
  }
  return terminal ? { terminal } : null;
}
