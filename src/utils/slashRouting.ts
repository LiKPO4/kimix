export const KIMIX_LOCAL_SLASH_COMMANDS = new Set([
  "theme",
  "custom-theme",
  "import-from-cc-codex",
]);

export const KIMIX_FALLBACK_SLASH_COMMANDS = new Set([
  "goal",
  "compact",
  "plan",
  "btw",
  "undo",
  "swarm",
  "reload",
  "status",
  "usage",
]);

export type SlashRoutingDecision = "local" | "official-first" | "passthrough";

export function classifySlashCommand(name: string): SlashRoutingDecision {
  const normalized = name.trim().toLowerCase();
  if (!normalized || normalized.startsWith("skill:")) return "passthrough";
  if (KIMIX_LOCAL_SLASH_COMMANDS.has(normalized)) return "local";
  if (KIMIX_FALLBACK_SLASH_COMMANDS.has(normalized)) return "official-first";
  return "passthrough";
}
