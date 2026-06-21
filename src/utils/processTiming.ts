type AssistantTurnTimingInput = {
  turnStartedAt?: number;
  eventTimestamp: number;
};

export function assistantTurnStartedAt(input: AssistantTurnTimingInput) {
  return input.turnStartedAt ?? input.eventTimestamp;
}
