import type { SlashCommandInfo } from "./types/ipc";

export type KimiCodeSlashRuntime = "server" | "sdk";

const COMMON_SLASH_COMMANDS: SlashCommandInfo[] = [
  { name: "theme", description: "打开 Kimix 主题设置；官方终端主题仅供参考", aliases: [] },
  { name: "custom-theme", description: "调用官方内置 Skill 创建或修改自定义主题", aliases: [] },
  { name: "custom-theme 做一套低饱和绿色主题", description: "调用官方内置 Skill 设计自定义主题", aliases: [] },
  { name: "import-from-cc-codex", description: "调用官方内置 Skill 导入 Claude Code / Codex 配置", aliases: [] },
  { name: "mcp-config", description: "调用官方内置 Skill 配置 MCP", aliases: [] },
  { name: "write-goal", description: "调用官方内置 Skill，为 /goal 起草规范目标", aliases: [] },
  { name: "write-goal 修复已知的会话显示问题并完成验证", description: "带意图模板：起草规范 Goal 目标", aliases: [] },
  { name: "update-config", description: "调用官方内置 Skill 查看或编辑 config.toml / tui.toml", aliases: [] },
  { name: "check-kimi-code-docs", description: "调用官方内置 Skill，依据官方文档回答 Kimi Code 问题", aliases: [] },
  { name: "sub-skill", description: "调用官方内置 Skill，将本地 skill 库重组为分层子 skill 包", aliases: [] },
  { name: "sub-skill.review", description: "sub-skill 只读提案：审查分层重组方案", aliases: [] },
  { name: "sub-skill.consolidate", description: "sub-skill 执行：按方案重组 skill 库", aliases: [] },
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
  { name: "reload", description: "重载当前会话配置和 Skill 视图", aliases: [] },
  { name: "skill:", description: "通过官方链路调用 Skill", aliases: [] },
  { name: "new", description: "开启全新会话，丢弃当前上下文", aliases: ["clear"] },
  { name: "fork", description: "基于当前会话派生新会话，保留完整历史", aliases: [] },
  { name: "title", description: "查看或设置当前会话标题", aliases: ["rename"] },
  { name: "model", description: "打开模型选择", aliases: [] },
  { name: "settings", description: "打开 Kimix 设置", aliases: ["config"] },
  { name: "provider", description: "打开模型与供应商管理", aliases: [] },
  { name: "mcp", description: "打开 MCP 管理面板", aliases: [] },
  { name: "plugins", description: "打开插件管理面板", aliases: [] },
  { name: "permission", description: "打开权限模式选择", aliases: [] },
  { name: "yolo", description: "切换完全访问模式（on/off）", aliases: ["yes"] },
  { name: "auto", description: "切换自动权限模式（on/off）", aliases: [] },
  { name: "tasks", description: "打开长程任务面板", aliases: ["task"] },
  { name: "export-md", description: "导出当前会话为 Markdown", aliases: ["export"] },
  { name: "copy", description: "复制最后一条 AI 回复", aliases: [] },
  { name: "help", description: "显示可用斜杠命令", aliases: ["h"] },
  { name: "version", description: "显示 Kimix 版本号", aliases: [] },
  { name: "exit", description: "关闭 Kimix 窗口", aliases: ["quit", "q"] },
  { name: "init", description: "分析当前代码库并生成 AGENTS.md", aliases: [] },
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
];

export function listKimiCodeSlashCommands(runtime: KimiCodeSlashRuntime): SlashCommandInfo[] {
  return runtime === "sdk"
    ? [...SDK_ONLY_SLASH_COMMANDS, ...COMMON_SLASH_COMMANDS]
    : [...COMMON_SLASH_COMMANDS];
}
