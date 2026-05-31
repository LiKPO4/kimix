# Kimix Kimi Code 0.6.0 能力补齐 P0-P7 验收需求报告

版本锚点：v2.8.124

## 验收范围

本报告覆盖 `TASK_STATE.md` 中“下一阶段官方 Kimi Code 能力补齐计划”的 P0 到 P7：

- P0：其他模型 API 接入配置
- P1：Plugin 从 GitHub URL 安装
- P2：Plugin 自带 MCP Server 管理
- P3：后台 Agent 状态恢复提示
- P4：模型错误恢复与重试提示
- P5：套餐用量展示对齐官方新体验
- P6：官方 `/export-md` 导出入口边界
- P7：Write / Edit 审批 diff 与全屏查看增强

## 已完成代码验证

- 已通过 `pnpm build`。
- 已通过 `git diff --check`，仅有 Git 的 LF/CRLF warning。
- 三处版本号同步到 `v2.8.124`：`package.json`、`src/components/layout/Sidebar.tsx`、`src/components/settings/SettingsPanel.tsx`。
- 当前工作区仍有大量未提交改动，未执行提交、推送或 `git add .`。

## P0：其他模型 API 接入配置

### 验收目标

Kimix 能读取、展示、测试和保存 OpenAI-compatible Provider 配置，并让新会话尊重 Kimi Code `config.toml` 的默认模型。

### 代码侧完成项

- 设置页新增模型配置区，读取 Kimi Code `config.toml` 的默认模型、Provider 摘要和模型别名摘要。
- 支持新增 OpenAI-compatible Provider：`base_url`、`api_key`、`model`、模型别名、context、是否设为默认。
- 支持连接测试，测试时通过临时模型环境变量执行 Kimi Code 请求。
- 保存前备份 `config.toml`，写入 Kimix managed models 区块。
- 新会话不再硬编码 `kimi-code/kimi-for-coding`，让 `config.toml default_model` 生效。
- 模型相关错误归一为 API Key、Base URL、模型名、登录过期等可读中文摘要。

### 用户验收步骤

1. 打开设置页，确认版本显示 `v2.8.124`。
2. 在“模型配置 / OpenAI-compatible Provider”里填写一个可用 Provider。
3. 点击“测试”，预期显示测试通过或明确的失败原因。
4. 勾选“保存后设为默认模型”并保存。
5. 重开设置页，确认默认模型和模型别名仍保留。
6. 新建会话发送简单问题，确认使用默认模型链路；如配置错误，错误卡应提示 key、base URL 或模型名等具体方向。

## P1：Plugin 从 GitHub URL 安装

### 验收目标

Kimix 提供 GitHub URL 安装 plugin 的入口；安装成功后刷新插件列表；失败时展示可操作错误。

### 代码侧完成项

- 插件页新增 GitHub URL 输入框和安装按钮。
- 后端新增 `project:installKimiPlugin`，校验 GitHub URL 后调用 `kimi plugin install <url>`。
- 安装成功后刷新本地插件列表。
- 当前本机 Kimi Code 0.6.0 未暴露 plugin install 命令时，会返回明确错误，不吞 CLI 输出。
- 保留官方 / 精选 / 第三方 / 本地信任徽章。

### 用户验收步骤

1. 打开插件页，找到 GitHub URL 安装入口。
2. 输入一个公开 plugin 仓库 URL，点击安装。
3. 如果当前 Kimi CLI 支持 plugin install，预期安装成功后列表刷新并出现该 plugin。
4. 如果当前 Kimi CLI 不支持，预期展示清晰错误，能看出是 CLI 能力不可用，而不是 Kimix 卡死或无响应。

## P2：Plugin 自带 MCP Server 管理

### 验收目标

Kimix 能发现 plugin manifest 里的 MCP server，并将其桥接到现有 MCP 管理能力中。

### 代码侧完成项

- 扫描 `$KIMI_CODE_HOME/plugins/managed`、`.kimi-code/plugins`、旧 `.kimi/plugins`。
- 识别 `plugin.json`、`kimi.plugin.json`、`.kimi-plugin/plugin.json` 中的 `mcpServers`。
- MCP 面板新增“Plugin 随带 MCP”只读分区，展示来源 plugin、传输方式、启用态和命令 / URL 摘要。
- 新增“加入配置”按钮，把 plugin 随带 MCP 安全写入 Kimi `mcp.json`。
- 写入前备份配置；导入后复用普通 MCP 卡片的测试、授权、重置授权链路。

### 用户验收步骤

1. 准备一个 manifest 内含 `mcpServers` 的 plugin。
2. 打开 MCP 面板，确认“Plugin 随带 MCP”分区能识别该 server。
3. 点击“加入配置”，确认普通 MCP 列表出现对应条目。
4. 对导入后的 MCP 执行测试 / 授权 / 重置授权，确认不破坏原 plugin 文件。

## P3：后台 Agent 状态恢复提示

### 验收目标

长程任务失败、中断、暂停时，Kimix 能在顶部、右侧栏和恢复动作上给出一致提示。

### 代码侧完成项

- 长程任务新增持久化 `recovery` 元信息。
- 执行 / 审查 agent 失败或中断时记录原因、建议动作和更新时间。
- 手动暂停也写入可恢复说明。
- 顶部长程任务状态按钮显示“可恢复 · 失败 / 中断 / 暂停”。
- 右侧栏展示恢复状态块、下一步建议、“继续”和“复制 prompt”。
- 点击继续 / 开始执行会清理 `recovery` 并提示“已继续长程任务”。

### 用户验收步骤

1. 创建或打开一个长程任务。
2. 触发暂停、失败或中断场景。
3. 确认顶部状态按钮和右侧栏都出现可恢复提示。
4. 点击“复制 prompt”，确认剪贴板内容可用于下一步恢复。
5. 点击“继续”，确认恢复提示被清理，任务进入继续执行状态。

## P4：模型错误恢复与重试提示

### 验收目标

常见模型错误不再只显示原始栈或英文，错误卡提供安全下一步动作。

### 代码侧完成项

- `ErrorCard` 识别登录、模型配置、Token / 额度、上下文溢出、压缩失败、请求终止和泛型错误。
- 登录错误可直接打开 Kimi 登录。
- 模型 / API Key / Base URL / Token / 上下文类错误可打开模型配置。
- 所有错误可复制详情。
- 仅请求中断和泛型临时错误显示“重试上一条”。
- 重试时复用最后一条 user / steer 消息，只追加新的 assistant 占位，不重复插入用户消息。

### 用户验收步骤

1. 用错误 API Key 或错误 Base URL 触发一次模型错误。
2. 确认错误卡给出中文标题、建议和“打开模型配置”等动作。
3. 触发登录失效场景，确认错误卡显示登录动作。
4. 触发请求中断或临时错误，确认才显示“重试上一条”。
5. 点击重试，确认不会重复插入同一条用户消息。

## P5：套餐用量展示对齐官方新体验

### 验收目标

套餐用量浮层显示官方来源、5 小时和本周用量、刷新时间、登录过期引导和服务端错误摘要。

### 代码侧完成项

- 底部“套餐用量”入口展示官方来源和更新时间。
- 保留 5小时 / 本周两段进度与刷新时间。
- 用量接口失败时带出服务端响应摘要。
- 401 / 登录过期时提供“重新登录”按钮，登录后自动刷新用量。
- OAuth refresh token 请求已改为官方需要的 `application/x-www-form-urlencoded`。

### 用户验收步骤

1. 点击底部“套餐用量”。
2. 确认浮层显示 5 小时和本周两个周期。
3. 点击刷新，确认加载态、更新时间和数据能更新。
4. 在登录过期时确认出现重新登录入口。
5. 服务端异常时确认错误摘要可读，而不是空白失败。

## P6：官方 `/export-md` 导出入口边界

### 验收目标

Kimix 提供独立 Markdown 导出入口，并与 Kimi Debug ZIP 导出分开。由于当前本机 Kimi Code 0.6.0 `kimi export --help` 仅暴露 ZIP 导出，未暴露 `export-md` 参数，本轮实现使用 Kimix 当前会话事件生成 Markdown，同时保留后续接官方 `/export-md` 的入口边界。

### 代码侧完成项

- 侧栏会话行新增“导出 Markdown”按钮。
- 该入口与“导出 Kimi Debug ZIP”分开。
- 主进程新增 `project:exportMarkdown`。
- 导出成功后保存 `.md` 并打开所在位置。
- 当前官方 CLI 不支持 `export-md` 时，不影响现有本地 Markdown 导出能力。

### 用户验收步骤

1. 在侧栏选中一个已有会话。
2. 点击该会话的“导出 Markdown”。
3. 选择保存位置后，确认生成 `.md` 文件。
4. 打开文件，确认包含用户消息、assistant 回复、审批 / 错误等关键会话事件摘要。
5. 同时确认 Debug ZIP 导出入口仍可独立使用。

## P7：Write / Edit 审批 diff 与全屏查看增强

### 验收目标

一次 Write / Edit 审批能在 Kimix 内看清工具、风险、涉及文件、详情和 diff 预览；全屏查看不遮挡主操作；接受和拒绝状态回写准确。

### 代码侧完成项

- 审批卡解析 JSON / 文本详情中的文件路径。
- 展示工具名、风险级别、操作摘要和涉及文件。
- 原始详情保留预览，并新增全屏查看浮层。
- 全屏浮层支持复制详情。
- `ChatThread` 将同轮结构化 `diff` 事件传给审批卡。
- 审批卡按涉及文件关联 diff，最多展示 2 个文件的紧凑增删预览和 +/- 统计。
- 接受 / 拒绝仍沿用原 `approveRequest` 链路，状态回写不变。
- 现有变更卡撤销能力保留。

### 用户验收步骤

1. 在手动审批模式下触发一次 Write 或 Edit 文件操作。
2. 审批卡出现后，确认能看到工具名、风险级别、摘要和涉及文件。
3. 如果同轮有结构化 diff，确认审批卡内显示 Diff 预览。
4. 点击“全屏查看”，确认详情浮层完整显示，不影响关闭后继续审批。
5. 点击“允许一次”或“拒绝”，确认审批状态变为“已批准”或“已拒绝”。
6. 对已有变更卡执行撤销，确认撤销能力仍可用。

## 总体验收结论模板

请按下面格式回传验收结果：

```text
Kimix v2.8.124 P0-P7 验收结果：
- P0：通过 / 不通过，备注：
- P1：通过 / 不通过，备注：
- P2：通过 / 不通过，备注：
- P3：通过 / 不通过，备注：
- P4：通过 / 不通过，备注：
- P5：通过 / 不通过，备注：
- P6：通过 / 不通过，备注：
- P7：通过 / 不通过，备注：
- 需要补充截图：有 / 无
- 是否允许进入提交准备：是 / 否
```

## 已知边界

- P1 的真实安装成功依赖当前 Kimi Code CLI 是否暴露 `plugin install`。
- P6 当前不是官方 `export-md` CLI 参数调用，因为本机 Kimi Code 0.6.0 尚未暴露该参数；当前实现是 Kimix 本地 Markdown 导出，并保留官方入口边界。
- UI 视觉验收由用户截图或实机操作确认；本轮只声明代码自查、构建和空白检查通过。
