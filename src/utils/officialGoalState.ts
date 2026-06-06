import type { OfficialGoalSnapshot, TimelineEvent } from "@/types/ui";

function normalizeStatus(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isTerminalGoalStatus(status: unknown) {
  return ["complete", "completed", "cancelled", "canceled"].includes(normalizeStatus(status));
}

export function reconcileOfficialGoalSnapshot(
  incoming: OfficialGoalSnapshot | null,
  current: OfficialGoalSnapshot | null | undefined,
) {
  if (!current || !isTerminalGoalStatus(current.status)) return incoming;
  if (!incoming) return current;
  if (isTerminalGoalStatus(incoming.status)) return incoming;
  if (incoming.objective.trim() !== current.objective.trim()) return incoming;
  return current;
}

export function inferTerminalGoalFromEvent(
  event: TimelineEvent,
  current: OfficialGoalSnapshot | null | undefined,
): OfficialGoalSnapshot | null {
  if (event.type !== "tool_call" && event.type !== "tool_result") return null;
  if (!/updategoal/i.test(event.toolName)) return null;
  if (event.type === "tool_call" && event.status !== "success") return null;
  const evidence = [
    event.type === "tool_call" ? event.rawArguments : "",
    event.type === "tool_call" ? JSON.stringify(event.arguments) : "",
    String(event.result ?? ""),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  if (!/"status"\s*:\s*"complete"|goal marked complete|marked complete/.test(evidence)) return null;
  if (!current) return null;
  return {
    ...current,
    status: "complete",
    terminalReason: typeof event.result === "string" && event.result.trim() ? event.result.trim() : current.terminalReason,
  };
}
