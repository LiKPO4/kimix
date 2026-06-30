import type { SlashCommandInfo } from "./types/ipc";

export type KimiCodeSlashRuntime = "server" | "sdk";

const COMMON_SLASH_COMMANDS: SlashCommandInfo[] = [
  { name: "theme", description: "打开 Kimix 主题设置；官方终端主题仅供参考", aliases: [] },
  { name: "custom-theme", description: "调用官方内置 Skill 创建或修改自定义主题", aliases: [] },
  { name: "custom-theme 做一套低饱和绿色主题", description: "调用官方内置 Skill 设计自定义主题", aliases: [] },
  { name: "import-from-cc-codex", description: "调用官方内置 Skill 导入 Claude Code / Codex 配置", aliases: [] },
  { name: "mcp-config", description: "调用官方内置 Skill 配置 MCP", aliases: [] },
  { name: "compact", description: "静默压缩当前上下文，可附带保留指令", aliases: [] },
  { name: "compact 保留本轮测试结果和待办", description: "带保留指令模板：压缩当前上下文", aliases: [] },
  { name: "plan", description: "切换 Plan 模式", aliases: [] },
  { name: "plan on", description: "开启 Plan 模式", aliases: [] },
  { name: "plan off", description: "关闭 Plan 模式", aliases: [] },
  { name: "status", description: "显示当前 Kimi Code 会话状态", aliases: [] },
  { name: "usage", description: "显示当前 Kimi Code 会话用量", aliases: [] },
  { name: "btw", description: "侧问，不影响主轮次", aliases: [] },
  { name: "btw 这个函数是谁调用的", description: "带问题模板：侧问，不影响主轮次", aliases: [] },
  { name: "undo", description: "撤回最近一次官方历史", aliases: [] },
  { name: "undo 1", description: "带次数模板：撤回最近 1 次官方历史", aliases: [] },
  { name: "skill:", description: "通过官方链路调用 Skill", aliases: [] },
];

const SDK_ONLY_SLASH_COMMANDS: SlashCommandInfo[] = [
  { name: "goal", description: "兼容 Goal 入口", aliases: [] },
  { name: "goal status", description: "查看当前 Goal 状态", aliases: [] },
  { name: "goal show", description: "显示当前 Goal 状态", aliases: [] },
  { name: "goal start", description: "启动一个新 Goal", aliases: [] },
  { name: "goal start 修复已知问题并完成验证", description: "带目标模板：启动一个新 Goal", aliases: [] },
  { name: "goal replace", description: "替换当前 Goal", aliases: [] },
  { name: "goal replace 完成当前任务并输出验证证据", description: "带目标模板：替换当前 Goal", aliases: [] },
  { name: "goal pause", description: "暂停当前 Goal", aliases: [] },
  { name: "goal resume", description: "继续已暂停/受阻 Goal", aliases: [] },
  { name: "goal cancel", description: "取消并清除当前 Goal", aliases: [] },
  { name: "goal next", description: "排队后续 Goal", aliases: [] },
  { name: "goal next 继续收尾并整理剩余风险", description: "带目标模板：排队后续 Goal", aliases: [] },
  { name: "swarm", description: "兼容 Swarm 入口", aliases: [] },
  { name: "swarm 并行检查最近改动并给出修复建议", description: "通过兼容链路发起 Swarm 任务", aliases: [] },
  { name: "swarm on", description: "开启 Swarm 模式", aliases: [] },
  { name: "swarm off", description: "关闭 Swarm 模式", aliases: [] },
  { name: "reload", description: "重载当前会话配置", aliases: [] },
];

export function listKimiCodeSlashCommands(runtime: KimiCodeSlashRuntime): SlashCommandInfo[] {
  return runtime === "sdk"
    ? [...SDK_ONLY_SLASH_COMMANDS, ...COMMON_SLASH_COMMANDS]
    : [...COMMON_SLASH_COMMANDS];
}
