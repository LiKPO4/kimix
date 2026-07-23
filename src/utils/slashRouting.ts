export const KIMIX_LOCAL_SLASH_COMMANDS = new Set([
  "theme",
  // 会话管理
  "new", "clear",
  "fork",
  "title", "rename",
  // 面板与模式
  "model",
  "settings", "config",
  "provider",
  "mcp",
  "plugins",
  "permission",
  "yolo", "yes",
  "auto",
  "tasks", "task",
  // 输出与信息
  "export-md", "export",
  "copy",
  "help", "h",
  "version",
  "exit", "quit", "q",
  "init",
]);

/** 斜杠命令解析：名称允许字母/数字/下划线/冒号/连字符/点号（子 Skill 点分命令）。 */
export const slashCommandPattern = /^\/([a-zA-Z][\w:.-]*)(?:\s+([\s\S]*))?$/;

export const KIMI_BUILTIN_SKILL_SLASH_COMMANDS = new Set([
  "custom-theme",
  "import-from-cc-codex",
  "mcp-config",
  "write-goal",
  "update-config",
  "check-kimi-code-docs",
  "sub-skill",
  "sub-skill.review",
  "sub-skill.consolidate",
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
