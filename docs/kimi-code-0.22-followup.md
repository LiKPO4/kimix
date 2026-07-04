# Kimi Code 0.22.x 跟进记录

日期：2026-07-04

## 当前官方版本

- 本机 `kimi --version`：`0.22.2`
- npm `@moonshot-ai/kimi-code` latest：`0.22.2`
- Kimix vendored SDK 仍可用作 0.22.x 能力探针入口。

## 已确认可直接复用的能力

### Plugin manifest commands

Kimi Code 0.22.x SDK 已提供：

- `session.listPluginCommands()`
- `session.activatePluginCommand(pluginId, commandName, args)`

本轮将 `scripts/probe-kimi-code-plugins.mjs` 改成隔离 fixture：

- 使用临时 `KIMI_CODE_HOME`，不污染真实用户插件目录。
- 创建本地测试插件，manifest 写法为 `commands: "./commands/"`。
- 创建临时 session 后可读取到 `commandCount: 1`。
- `listPluginCommands()` 返回 `pluginId/name/description/path/body`。
- `activatePluginCommand()` 成功触发：
  - `plugin_command.activated`
  - `turn.started`
  - `turn.ended`
  - `session.meta.updated`

结论：这条能力适合作为下一步接入候选。Kimix 可把官方 plugin commands 合并进 slash 补全，并用官方 `activatePluginCommand()` 激活，减少自建 slash 兼容逻辑。

边界：本轮只验证 SDK/RPC 路径；Server REST 是否有等价 endpoint 尚未确认，不能直接假设 Server route 同样支持。

### 图片压缩函数

vendored SDK 导出：

- `compressImageForModel`
- `compressBase64ForModel`

临时探针确认函数存在；小 PNG 和非图片输入会安全 passthrough。下一步可用大图样本验证压缩比例、MIME 保真和失败回退，再决定是否替换 Kimix 现有图片预处理。

## 暂不建议立即删除的 Kimix 兼容层

- Skill 缺失刷新：Server REST 仍未确认有公开 reload endpoint，`skill-*` fork fallback 仍需保留。
- 历史修复/中断修复：官方 0.22.2 有相关修正，但 Kimix 需要用本地历史样本回归后再删。
- OpenAI-compatible model overrides：Kimix 已读取/写入 `overrides.max_output_size` 等字段；是否能删掉自动补写逻辑，需要先跑模型配置探针。

## 下一步建议

1. 接入 plugin commands 的只读列表：先在主进程暴露 SDK session 的 `listPluginCommands()`，仅 SDK route 显示。
2. 增加 plugin command 激活入口：匹配 `/<pluginId>:<commandName> args` 后调用 `activatePluginCommand()`。
3. Server route 暂时不接同名命令，避免把 Server 会话强行降级或重新引入隐藏分支。
4. 另起一轮用大图样本验证官方图片压缩，再评估替换 Kimix 图片链路。
