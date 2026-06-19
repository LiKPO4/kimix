type ActiveProcessTimingInput = {
  eventTimestamp: number;
  statusTimestamp?: number;
  thinkingTimestamps?: number[];
  runningToolTimestamps?: number[];
  runningSubagentTimestamps?: number[];
  hasContent: boolean;
};

function earliest(values: number[]) {
  return values.length > 0 ? Math.min(...values) : undefined;
}

export function activeProcessPhaseStartedAt(input: ActiveProcessTimingInput) {
  const subagentStartedAt = earliest(input.runningSubagentTimestamps ?? []);
  if (subagentStartedAt !== undefined) return subagentStartedAt;

  const toolStartedAt = earliest(input.runningToolTimestamps ?? []);
  if (toolStartedAt !== undefined) return toolStartedAt;

  const thinkingTimestamps = input.thinkingTimestamps ?? [];
  if (input.hasContent) {
    return thinkingTimestamps.length > 0
      ? Math.max(...thinkingTimestamps)
      : input.statusTimestamp ?? input.eventTimestamp;
  }
  return earliest(thinkingTimestamps) ?? input.statusTimestamp ?? input.eventTimestamp;
}
