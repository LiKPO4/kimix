# Kimix TUI 引擎迁移计划

## 背景

Kimix 近期适配 Kimi Code 0.6.0 后，主执行链路从原先更结构化的 SDK / wire 能力退到了 `kimi -p --output-format stream-json` prompt-mode。这个模式能让基础对话继续可用，但它不是官方交互式 TUI 的等价替代：

- `stream-json` 不包含真实 thinking。
- prompt-mode 没有活跃 `Turn`，无法使用 SDK 风格的 steer / approve / respondQuestion。
- prompt-mode 的图片、视频、多模态能力不等同于 TUI 粘贴附件能力。
- prompt-mode 续会话依赖官方内部上下文，容易遇到工具调用链断裂。
- Kimix 当前为了补齐能力，已经开始旁路读取 `agents/main/wire.jsonl`、`logs/kimi-code.log`、`state.json` 等官方副产物。

这些补丁能短期缓解问题，但长期会持续制造新的状态同步边界。下一阶段目标不是继续修补 prompt-mode，而是迁移到隐藏启动真实 Kimi Code TUI 的架构。

## 总目标

把 Kimix 从“模拟 Kimi Code 能力”的外壳，改造成“接管并镜像真实 Kimi Code TUI”的 GUI。

新的主架构：

```text
React UI
  ↓
Kimix Session Controller
  ↓
KimiTuiHost
  ↓
hidden PTY / Windows ConPTY
  ↓
真实 kimi 交互式 TUI
```

迁移完成后：

- Kimi Code 自己负责真实会话、工具调用、审批、图片 / 视频、插件、模型、权限、Plan、续聊。
- Kimix 负责项目管理、输入接管、显示接管、状态镜像、搜索、归档、设置外壳和更好的 GUI。
- prompt-mode 只保留为临时 fallback，最终删除。

## 保留与废弃

### 保留

- Electron / React 桌面壳。
- 项目侧栏、会话侧栏、设置页、插件页、Hooks 页、长程任务页的产品外壳。
- 当前会话数据类型作为过渡层。
- 现有视觉体系和 Kimix UI 留白规则。
- 旧会话只读查看、导出、搜索能力。

### 废弃

- `kimi -p --output-format stream-json` 作为主执行链路。
- prompt-mode 图片落盘提示作为主多模态链路。
- prompt-mode thinking 轮询。
- prompt-mode log fallback 作为运行过程核心。
- SDK `Turn.steer()` 与 prompt-mode 混用。
- Kimix 自己伪造官方会话生命周期。
- 大量 internal session 过滤补丁。
- 对 `wire.jsonl` / `state.json` 的运行态强依赖。

## 新核心模块

### `KimiTuiHost`

主进程中的新执行引擎，负责真实 TUI 进程生命周期。

职责：

- 在指定 `workDir` 启动隐藏 `kimi` TUI。
- 基于 PTY / ConPTY 发送输入。
- 捕获 ANSI 输出。
- 管理进程状态：启动、运行、停止、退出、错误。
- 暴露事件流给 renderer。
- 关闭会话时清理所有子进程。

建议接口：

```ts
interface KimiTuiHost {
  start(options: StartTuiSessionOptions): Promise<TuiSessionInfo>;
  input(sessionId: string, text: string): Promise<void>;
  key(sessionId: string, key: TuiKey): Promise<void>;
  paste(sessionId: string, text: string): Promise<void>;
  stop(sessionId: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  close(sessionId: string): Promise<void>;
}
```

### `TuiScreenBuffer`

负责把 PTY 的 ANSI 输出还原为屏幕状态和 scrollback。

职责：

- 解析 ANSI escape sequence。
- 维护当前屏幕 buffer。
- 维护 scrollback。
- 标记 dirty 区域，减少 renderer 更新。
- 给调试面板提供原始终端镜像。

第一版可以使用成熟库，不要手写完整终端解析器。

候选：

- `node-pty`：提供 PTY / ConPTY。
- `xterm-headless`：终端 buffer 和 ANSI 解析。
- `xterm`：renderer 调试视图。

### `TuiSemanticParser`

负责从终端镜像中提取 Kimix 原生 UI 能理解的语义事件。

第一阶段不要求完美。原则是：

- 终端镜像是真相。
- 语义解析是增强。
- 解析失败时回退终端镜像，不丢信息。

目标事件：

- 用户消息。
- agent 正文。
- thinking / process 区域。
- tool call。
- approval request。
- question request。
- error。
- model / plugin / permission 状态。

### `TuiEngineSession`

Kimix 自己的会话控制层，负责 UI 会话和真实 TUI 会话的映射。

状态机：

```text
idle
starting
running
awaiting_approval
awaiting_question
compacting
completed
interrupted
error
exited
```

原则：

- 运行态以真实 TUI / PTY 为准。
- UI 会话 id 与官方 session id 分离。
- renderer 不直接猜测官方会话是否运行。
- 终态必须统一清理 pending / running / input 状态。

## 阶段计划

### 阶段 0：冻结旧逻辑

目标：

- 不再继续扩展 prompt-mode。
- 新建 TUI engine 实验路径。
- 保持旧链路可回退。

任务：

- 增加内部 engine 标记：`prompt` / `tui`。
- 默认仍使用旧链路。
- 设置页或 dev flag 增加实验开关。
- 文档标记 prompt-mode 为 deprecated。

验收：

- 不影响当前用户使用。
- 打开实验开关后能走新建空壳路径。
- 关闭开关后完全回到旧链路。

### 阶段 1：隐藏 TUI 原型

目标：

- 证明 Windows 下可以隐藏启动真实 `kimi` TUI 并双向通信。

任务：

- 引入 PTY 层。
- 在 Electron main 中启动 `kimi`。
- 捕获 stdout / screen。
- 支持写入文本和 Enter。
- 支持 Ctrl-C / kill。
- 增加调试 IPC，不接入正式聊天流。

验收：

```text
1. 点击测试按钮启动 hidden kimi。
2. 发送“只回复 OK”。
3. 调试面板能看到 TUI 输出 OK。
4. 停止按钮能中断当前请求。
5. 关闭调试会话后不残留 kimi.exe。
```

### 阶段 2：终端镜像面板

目标：

- 不急着还原聊天气泡，先把真实 TUI 画面稳定镜像到 Kimix。

任务：

- 使用 `xterm-headless` 或等价方案维护 screen buffer。
- renderer 新增 TUI debug / mirror panel。
- 支持 resize。
- 支持 scrollback。
- 支持复制原始输出。
- 保留 ANSI 原始日志导出。

验收：

- Kimix 中看到的内容与真实 TUI 输出一致。
- 长 thinking、工具调用、审批、错误至少能在镜像里看到。
- 镜像面板不会卡主 UI。

### 阶段 3：输入接管

目标：

- 用户仍使用 Kimix 输入框，但底层输入真实送入 TUI。

任务：

- 普通文本发送到 TUI 输入框。
- 多行文本安全粘贴。
- 运行中追加输入遵循 TUI 实际能力。
- 不支持 steer 时自动入队，不显示失败引导。
- 图片 / 视频优先接入官方 TUI 粘贴路径。
- `/` 命令直接发送给 TUI。

验收：

- 普通消息可发送。
- 多行内容不乱序。
- 运行中输入不再出现 `No active turn`。
- 图片 / 视频由官方多模态处理，而不是 Kimix 提示模型读本地路径。

### 阶段 4：状态机重做

目标：

- 彻底解决发送 / 停止按钮、运行态残留、错误态卡住等问题。

任务：

- 新增 `TuiSessionState`。
- 所有运行态来自 `KimiTuiHost`。
- `Composer` 不再靠未完成 assistant 占位判断按钮。
- 终态统一清理 pending、queue、open assistant、running id。
- 错误时保留终端镜像和原始日志。

验收：

- 运行中显示停止。
- 完成后恢复发送。
- 错误后恢复发送。
- 停止后恢复发送。
- 切换会话不串状态。

### 阶段 5：语义化聊天视图

目标：

- 在保留终端镜像真相的同时，把常见输出解析为 Kimix 原生聊天卡片。

任务：

- 解析用户消息边界。
- 解析 agent 正文边界。
- 解析工具调用块。
- 解析审批块。
- 解析 thinking / process 区域。
- 解析错误块。
- 解析文件变更摘要。
- 提供“查看原始 TUI”入口。

验收：

- 普通问答能显示为气泡。
- 工具调用能显示为工具卡。
- 审批能显示为审批卡。
- 解析失败时原始镜像仍完整。

### 阶段 6：官方能力 GUI 化

目标：

- Kimix UI 不再自己复刻官方能力，而是遥控官方 TUI。

模型：

- UI 按钮触发 `/model` 或读取官方状态。
- 当前对话模型来自官方会话。
- 不再用默认模型冒充当前对话模型。

插件：

- UI 按钮触发 `/plugins`。
- 官方 plugin marketplace 作为主入口。
- Kimix 只做快捷入口和状态镜像。

权限：

- UI 按钮触发官方权限模式。
- 不再自己拼 prompt-mode flag。

导出：

- 使用官方 `/export-md`、`/export-debug-zip` 或 `kimi export`。

验收：

- Kimix 显示状态和官方 TUI 一致。
- 变更模型 / 插件 / 权限后，新会话行为符合官方规则。

### 阶段 7：历史与会话迁移

目标：

- 旧 Kimix 会话只读保留，新会话完全走官方 TUI 会话。

任务：

- 旧会话标记为 legacy。
- legacy 会话可查看、搜索、导出，不继续运行。
- 新会话保存官方 session id、工作目录、标题、更新时间。
- 侧栏列表逐步切到官方 session 索引。
- 搜索覆盖 legacy + official sessions。

验收：

- 老会话不丢。
- 新会话恢复走官方会话。
- 内部系统对话不再混入用户列表。

### 阶段 8：删除旧引擎

目标：

- 正式进入 Kimix 3 TUI 架构。

删除：

- prompt-mode 主执行链路。
- prompt-mode 图片落盘主链路。
- prompt-mode thinking / log fallback。
- SDK activeTurns / steer 混合逻辑。
- 大量为 prompt-mode 状态补丁而写的兼容代码。

验收：

```text
1. 主链路搜索不到 --output-format stream-json。
2. 主链路搜索不到 No active turn 处理补丁。
3. 图片、工具、审批、模型、插件均走 TUI。
4. 旧引擎只在 legacy fallback 中存在，或完全删除。
```

## 第一轮最小行动

下一窗口建议只做一个原型，不改正式聊天流。

目标：

```text
Electron main 启动隐藏 PTY 中的 kimi，并把 ANSI 输出实时推给 renderer。
```

建议文件：

- `electron/tuiHost.ts`
- `electron/types/ipc.ts`
- `electron/preload.ts`
- `electron/main.ts`
- `src/components/layout/TuiDebugPanel.tsx`
- `src/types/ui.ts`

验收标准：

```text
1. Kimix dev 启动后可打开 TUI Debug Panel。
2. 点击“启动 TUI”后，后台出现真实 kimi 进程。
3. 输入“只回复 OK”并发送，调试面板能看到输出。
4. 点击“停止”能 Ctrl-C 或 kill 当前 TUI。
5. 关闭调试面板 / 应用后不残留 kimi.exe。
6. 不影响现有 prompt-mode 主链路。
```

## 技术风险

### Windows hidden PTY 稳定性

风险：

- ConPTY 在隐藏窗口、中文输入、ANSI 绘制、resize 上可能有坑。

缓解：

- 第一轮只做调试面板。
- 保留原始日志。
- 不立刻替换主链路。

### TUI 解析不稳定

风险：

- 官方 TUI UI 文案或布局变化会影响语义解析。

缓解：

- 终端镜像永远作为真相。
- 语义解析只做增强。
- 解析失败不阻塞使用。

### 图片 / 视频粘贴

风险：

- 官方 Windows TUI 支持 Alt-V 粘贴图片，但 PTY 注入剪贴板和快捷键不一定等价。

缓解：

- 单独做附件验证阶段。
- 必要时使用系统剪贴板 + 发送 Alt-V。
- 若不可控，保留官方文件路径兜底，但不作为主路径。

### 多会话资源管理

风险：

- 每个会话一个 hidden TUI 会占用进程和内存。

缓解：

- 默认只保持当前活跃会话。
- 非活跃会话休眠 / 关闭。
- 恢复时通过官方 session 恢复。

## 验收矩阵

迁移完成前必须覆盖：

```text
普通文本对话
长 thinking
关闭 thinking
工具调用
审批
错误恢复
停止生成
运行中追加输入 / 排队
图片粘贴
视频粘贴
模型切换
插件 marketplace
权限模式切换
Plan 模式
导出 Markdown
Debug ZIP
历史恢复
搜索
旧会话只读
窗口关闭进程清理
```

## 判断是否需要从头重写

保留现有壳的条件：

- hidden PTY 原型稳定。
- 终端镜像不卡 UI。
- 输入接管可控。
- 旧 UI 可以逐步挂到新 engine。

从头做 Kimix Next 的触发条件：

- Windows hidden PTY 长期不稳定。
- xterm/headless 无法可靠镜像 Kimi TUI。
- 现有 session store / render pipeline 迁移成本超过重建。
- 新 engine 与旧 UI 状态模型冲突过多。

如果触发从头重写，仍建议复用：

- 视觉语言。
- 项目 / 会话概念。
- 设置项语义。
- 已验证的 UI 交互经验。

但新项目应以 `KimiTuiHost` 为第一原则，而不是先做聊天 UI。

## 新窗口开工提示

```text
接手 Kimix TUI 引擎迁移。

项目目录：D:\WORKS\Android Project\kimix

必守：
- 始终中文，每轮第一句“你好霖江路”。
- 开工先执行 git status --short。
- 当前工作区大量未提交改动，不回滚，不 git add .，未验收不提交不推送。
- 有实际改动必须同步版本号三处：package.json、src/components/layout/Sidebar.tsx、src/components/settings/SettingsPanel.tsx。
- UI spacing 遵守 Kimix 留白规则，小浮层 / 列表 / 按钮 / 边框容器优先 inline style。
- 每轮只做一个可验证最小增量。

先读：
- docs/KIMIX_TUI_ENGINE_MIGRATION_PLAN.md
- TASK_STATE.md
- electron/kimiBridge.ts
- electron/main.ts
- src/components/chat/Composer.tsx
- src/App.tsx

当前迁移目标：
不要继续扩展 prompt-mode。先做隐藏 TUI 原型。

第一轮最小行动：
新增 KimiTuiHost 调试原型，只验证 Electron main 能隐藏启动真实 kimi TUI、发送“只回复 OK”、实时回传 ANSI 输出、停止并清理进程。不要替换现有聊天主链路。

验收命令：
$env:PATH='C:\Program Files\nodejs;C:\Users\Administrator\AppData\Roaming\npm;C:\Users\lijialin08\AppData\Roaming\npm;' + $env:PATH
git diff --check
pnpm build
```
