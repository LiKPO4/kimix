export const KIMIX_LOCAL_SLASH_COMMANDS = new Set([
  "theme",
]);

export const KIMI_BUILTIN_SKILL_SLASH_COMMANDS = new Set([
  "custom-theme",
  "import-from-cc-codex",
  "mcp-config",
]);

export const KIMI_DIRECT_SLASH_COMMANDS = new Set([
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

export type SlashRoutingDecision = "local" | "official-skill-first" | "direct" | "passthrough";

export function shouldActivateSkillBeforePrompt(name: string): boolean {
  return name.trim().toLowerCase().startsWith("skill:");
}

export function classifySlashCommand(name: string): SlashRoutingDecision {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return "passthrough";
  if (KIMIX_LOCAL_SLASH_COMMANDS.has(normalized)) return "local";
  if (KIMI_BUILTIN_SKILL_SLASH_COMMANDS.has(normalized)) return "official-skill-first";
  if (shouldActivateSkillBeforePrompt(normalized)) return "direct";
  if (KIMI_DIRECT_SLASH_COMMANDS.has(normalized)) return "direct";
  return "passthrough";
}
