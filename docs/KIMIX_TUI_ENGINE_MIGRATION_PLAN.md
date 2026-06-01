# Kimix TUI 引擎迁移计划（修订版）

> 本文档于 2026-06-01 基于官方 Kimi Code 文档与本地 kimi 0.6.0 二进制实测重写。
> 旧版计划是“先做隐藏 TUI 原型”的探索路线，已经走通原型并接入 v2.8.215。
> 本修订版改为“以官方真实能力为准、逐功能收口、全功能不丢失”的落地路线。

---

## 0. 一句话目标

把 Kimix 的执行层从 prompt-mode 彻底迁移到隐藏的真实 Kimi Code 交互式 TUI，
**保留 Kimix 全部既有功能**，**接入官方新版本暴露的全部能力**，**界面保持干净美观**。

不替换 Electron/React 壳，不替换 Kimix 的界面、会话、插件、设置、视觉体系，
只把“谁在执行”从 Kimix 伪造的 prompt-mode 换成官方 TUI。

---

## 1. 架构原则（不可动摇）

```text
React UI （Kimix 自己的界面 / 会话 / 设置 / 视觉）
  ↓ 输入接管
KimiTuiHost（electron/tuiHost.ts，隐藏 PTY/ConPTY 启动真实 kimi）
  ↓
真实 kimi 0.6.0 交互式 TUI
  ↓ 两条回流通道（职责严格分离）
  ├─ agents/main/wire.jsonl  →  正式消息（唯一真相源）
  └─ screen / xterm 镜像      →  只用于菜单 / 模型 / 插件 / Plan / 权限 / 调试
```

### 1.1 消息源唯一性（最重要的纪律）

| 通道 | 用途 | 绝不允许 |
|---|---|---|
| `wire.jsonl` semantic 事件 | 正式消息正文、思考、工具调用、审批、变更 | —— |
| 正文 `content.part(type="text")` | 正式消息正文 | 混入 screen/status |
| 思考 `content.part(type="think")` | thinking 折叠区 | 混入 Kimix 合成状态 |
| screen / xterm | 菜单、模型选单、插件选单、Plan、权限 mirror、调试诊断 | 进入正式消息正文或思考 |

**永不进入正式消息的内容**：welcome 横幅、prompt box、status line、
Ctrl+S/Ctrl+O 提示、菜单文本、Kimix 自己合成的“【实时状态】/尚未实时写出思考正文”。

### 1.2 wire 优先于 screen-scraping

screen 文本解析（正则匹配 `● Using Bash`、`Select a model` 等）脆弱，随官方 UI 文案变化会回归。
凡 wire 已覆盖的语义（正文/思考/工具/审批/变更），**一律以 wire 为准**；
screen 解析只保留 wire 暂未覆盖的菜单/选单/状态 mirror。

---

## 2. 关键技术事实（官方文档 + 本地 0.6.0 实测）

### 2.1 kimi 命令行（`kimi --help` 实测）

```text
kimi [options]
  -S, --session [id]      恢复会话（带 id 恢复指定，不带交互选择）
  -C, --continue          继续当前工作目录上一个会话
  -y, --yolo              自动批准所有动作
  --auto                  以 auto 权限模式启动
  -m, --model <model>     指定模型
  -p, --prompt <prompt>   非交互单轮（prompt-mode，迁移后废弃为主链路）
  --output-format text|stream-json
  --skills-dir <dir>      指定 skills 目录（可重复）
  --plan                  以 plan 模式启动
commands: export [sessionId] / migrate
```

### 2.2 会话与 wire 真实路径（实测，**修正旧实现**）

```text
~/.kimi-code/
  config.toml                       默认模型 / 模型能力 / Kimix 托管模型段
  credentials                       登录凭证
  sessions/
    wd_<name>_<sha256前12>/         工作目录桶
      session_<uuid>/               ← 旧实现缺这一层！
        agents/main/wire.jsonl      正式语义事件（protocol_version 1.3）
        logs/kimi-code.log
        state.json
  session_index.jsonl               全局会话索引
  plugins/  logs/  telemetry/  user-history/
```

> **修正项**：`electron/tuiHost.ts` 的 `getKimiWireFile` / `findKimiSessionDir`
> 需按 `wd_*/session_<uuid>/agents/main/wire.jsonl` 两层定位，
> 并优先用屏幕提取的 `officialSessionId` 精确锁定 `session_<uuid>`，
> 否则取 mtime 最新的 `session_*` 目录。

### 2.3 wire 事件类型（已接入，保持）

```text
turn.prompt                                 -> TurnBegin
turn.cancel                                 -> TurnCancel
context.append_loop_event:
  content.part(type=text)                   -> ContentPart 正文
  content.part(type=think)                  -> ContentPart 思考
  tool.call                                 -> ToolCall
  tool.result                               -> ToolResult
step.end(finishReason=end_turn)             -> TurnEnd
step.end(finishReason=tool_use)             -> 不结束 turn（已修过，保持）
```

### 2.4 交互与输入能力（官方 interaction 文档实测）

| 键 | 行为 | Kimix 迁移用途 |
|---|---|---|
| `Enter` | 运行中排队，空框按 ↑ 召回上一条队列 | **普通发送 = 排队**（已是当前逻辑） |
| **`Ctrl+S`** | **立即注入运行中 turn，模型立刻看到** | **steer / 引导当前任务**（待接入 UI 动作） |
| `Ctrl+C` | 立即中断 | 停止生成 |
| `Ctrl+J` / `Alt+Enter` | 插入换行 | 多行输入 |
| **`Ctrl+V`** | **粘贴剪贴板文本/图片/视频** | **图片/视频原生入口（见 2.5）** |
| `Ctrl+O` | 外部编辑器 | 调试 mirror |
| `Ctrl+E` | 全屏 pager 展开 | 折叠块展开 |
| `Shift+Tab` | 切换 plan 模式 | Plan 入口备选 |
| `@` 路径补全 | 引用工程文件 | 文件引用入口 |

### 2.5 图片/视频原生入口（**修正核心方向**）

官方机制：剪贴板含图片时，`Ctrl+V` 会把图片**缓存到磁盘**并在输入框显示 `[image:…]` 占位，
发送后模型经 `ReadMediaFile` 看到图片；视频则把文件路径作为文本插入。
模型需具备 `image_in` / `video_in` 能力——本地 `kimi-for-coding` 已具备（config.toml 实测）。

```text
不接受：Kimix 自己拼“图片附件：<路径>”提示词，让模型靠路径猜。
正确做法：Kimix 把图片写入系统剪贴板（clipboard.writeImage），
         再向 hidden TUI 发送 Ctrl+V，走官方缓存 + ReadMediaFile。
过渡态（v2.8.215 现状）：直接把本地图片路径发给 TUI，已实测触发官方 ReadMediaFile，
         可用但非最终态，待 Ctrl+V 探针验证后切换。
```

### 2.6 Slash 命令全集（官方 reference 实测，无 `/auto`）

```text
帮助/信息 : /help /version /changelog /feedback /debug /usage(/status)
账户/配置 : /login(/setup) /logout /model /editor /theme /reload /mcp /hooks
会话管理 : /new /sessions(/resume) /title(/rename) /undo /fork /clear(/reset) /compact
导入导出 : /export /import
技能流程 : /skill:<name> /flow:<name>
工作区   : /add-dir
权限自动 : /yolo（自动批准） /afk（自动批准+自动消除 AskUserQuestion）
计划     : /plan /plan on|off|view|clear
任务     : /task（后台任务三栏浏览器）
侧问题   : /btw
项目     : /init（生成 AGENTS.md）
界面     : /web /vis
```

---

## 3. 功能保留矩阵（迁移后每个功能怎么实现）

> 目标：**旧版本有的，迁移后一个都不能丢**；**官方新版本有的，全部接进来**。
> 状态：✅ 已走 TUI ｜ 🟡 部分/过渡 ｜ ⬜ 待接入 TUI（当前仅 prompt-mode）。

| 功能 | TUI 引擎下的实现方式 | 状态 |
|---|---|---|
| 普通消息对话 | `sendTuiInput` → 真实 TUI；正文来自 wire `content.part(text)` | ✅ |
| thinking | wire `content.part(think)`，reducer 分离，折叠区展示 | ✅ |
| 消息队列 | 普通发送 = Enter 排队；Kimix pending queue + `TurnEnd & input idle` 自动 flush | ✅ |
| **队列引导 / steer** | **运行中“立即注入”按钮 → 发送 `Ctrl+S` + 文本**（区别于 Enter 排队） | ⬜ 待接入 |
| 发送图片 | clipboard.writeImage + `Ctrl+V`（目标）；路径直发触发 ReadMediaFile（过渡） | 🟡 |
| 发送视频 | `Ctrl+V` 粘贴视频→官方插入路径；或 `@` 路径引用 | ⬜ 待探针 |
| 多消息并行推进 | 每会话独立 hidden TUI 进程 + 独立 wire tail；`activeSessions` Map | ✅ |
| skills | `--skills-dir` 启动注入 + `/skill:<name>` 加载；SkillsPanel 经 screen mirror 导航 | 🟡 |
| 插件 plugin | `/plugins` / 官方 marketplace；screen 解析 trustLevel/skills/MCP/version 只读镜像 | 🟡 |
| mcp | `/mcp` 查看；官方 `kimi mcp` 子命令 / `~/.kimi/mcp.json`；McpPanel 镜像 | 🟡 |
| 登录 / 登出 | `/login` / `/logout` 经 TUI；或 Kimix 直接管理 `~/.kimi-code/credentials` | 🟡 |
| 模型切换 | `/model`（先刷新平台模型列表，再选）；screen 解析模型选单 mirror | 🟡 |
| 权限审批 | wire 审批事件 → 审批卡 → `sendTuiInput`/方向键回应；`/yolo` `/afk` 自动批准 | ✅ |
| Plan 模式 | `/plan` / `/plan on|off|view|clear` 或 `Shift+Tab`；启动可 `--plan` | 🟡 |
| 导出 | `/export [path]`（slash 候选可直发）或 `kimi export <sessionId>`（ZIP） | 🟡 候选可直发 |
| 导入 | `/import <file>` / `/import <sessionId>`（slash 候选可直发） | 🟡 候选可直发 |
| 会话恢复 | `kimi -S <id>`：持久化 officialSessionId，重启后发消息自动 `-S` 恢复，失败无参兜底 | ✅ 已实现 |
| 会话分叉 | `/fork`（slash 候选可直发） | 🟡 候选可直发 |
| 撤销重试 | `/undo`（slash 候选可直发） | 🟡 候选可直发 |
| 压缩上下文 | `/compact [指令]`（slash 候选可直发） | 🟡 候选可直发 |
| 侧问题 | `/btw <question>`（隔离上下文、禁用工具；slash 候选可直发） | 🟡 候选可直发 |
| 标题/重命名 | `/title` `/rename`（slash 候选可直发） | 🟡 候选可直发 |
| 工作区目录 | `/add-dir <path>`（slash 候选可直发） | 🟡 候选可直发 |
| 用量配额 | `/usage`（仅 Kimi Code 平台；slash 候选可直发） | 🟡 候选可直发 |
| Hooks 页 | 官方 `/hooks` 查看；Kimix UserPromptSubmit hooks 已在 TUI `sendTuiInput` 注入前执行 | ✅ |
| 长程任务页 | 官方 `/task` 后台任务浏览器；Kimix LongTasksPanel 当前仍走 prompt-mode | ⬜ 待迁移 |
| 搜索 | Kimix 自有 `project:searchFiles`，覆盖 legacy + official sessions | ✅ |
| 设置页 | Kimix 自有，写 config.toml 托管段 + settings.json | ✅ |
| 文件引用 | `@` 路径补全 | ⬜ 新增 |
| 主题 | `/theme dark|light`（可选镜像，Kimix 有自己视觉体系） | 可选 |

---

## 4. 官方新能力接入清单（旧版本没有、本次要补）

按价值优先级：

1. **steer（Ctrl+S 立即注入）** —— 当前最缺的明确动作，必须与 Enter 排队区分。
2. **图片 Ctrl+V 原生粘贴** —— 替换路径包装，走官方 ReadMediaFile。
3. `/task` 后台任务 —— 对接 Kimix 长程任务页，替换 prompt-mode 编排。
4. `/fork` `/undo` `/compact` `/import` —— 会话生命周期补全。
5. `/btw` 侧问题 —— 不打断主对话的快速提问。
6. `/usage` `/add-dir` `/title` —— 状态与工作区管理。
7. `/yolo` `/afk` —— 自动批准模式（替代 Kimix 自拼 flag）。

---

## 5. UI 整洁规则（界面不出现奇怪显示）

- 正式消息页**只渲染 wire semantic** 产出的气泡，screen/status 一律不混入。
- thinking 折叠区**只渲染官方 think**，不渲染 Kimix 合成状态。
- 菜单/选单/Plan/权限只在**专门的 mirror 区或调试页**展示，不进消息流。
- 占位提示（welcome/prompt box/status line/快捷键提示）在进 timeline 前过滤掉。
- spacing 遵守 Kimix 留白规则：小浮层、列表、按钮、边框容器 **优先 inline style**。
- 解析不确定的内容宁可不显示，也不要污染正文。

---

## 6. 分阶段计划（修订）

原型阶段（旧计划 0–2）已完成并接入 v2.8.215。后续按以下顺序，每轮一个可验证最小增量。

### 阶段 A：wire 路径与 session 锁定修正 —— ✅ 已核实，无需改动
- 经真实文件系统验证：`getKimiWireFile`/`findKimiSessionDir` **已正确**按
  `wd_*/session_<uuid>/agents/main/wire.jsonl` 两层定位，并用 screen `officialSessionId`
  精确锁定、回退 mtime 最新。bucket 计算与真实目录完全匹配，93 个 session 全部解析到 wire。
- 旧稿“缺 session_<uuid> 层”为误判，已撤销。本阶段不改代码。

### 阶段 B：steer 明确动作（Ctrl+S） —— ✅ 已实现（v2.8.216，待实机验收）
- Composer 运行中、TUI 引擎、有输入时，停止按钮左侧出现「引导」按钮。
- 该按钮 → `sendTuiInput({submit:"steer"})`，后端以 `Ctrl+S`(\x13) 注入，**不走 Enter 排队**。
- 普通 Enter 仍只排队。两者 UI/行为严格分离。
- 验收：见 docs/WORKLOG_TUI_MIGRATION.md「B. steer 引导」。

### 阶段 C：图片 Ctrl+V 原生粘贴探针 + 切换 —— 🟡 探针已实现（v2.8.216，待实机验收）
- 探针已落地（零破坏，不动现有路径直发主链路）：TUI 调试页「剪贴板图片探针」按钮，
  `clipboard.writeImage` + 发 `Ctrl+V`(\x16)，验证官方 `[image:…]` / wire `ReadMediaFile`。
- 待实机判定：成功则下一轮切主链路到剪贴板粘贴；失败保留路径直发过渡态，再探其它入口，绝不回退 prompt 包装。
- 验收：见 docs/WORKLOG_TUI_MIGRATION.md「C. 剪贴板图片探针」。

### 阶段 D：会话生命周期接入
- **D-1 slash 补全候选 —— ✅ 已实现（v2.8.217，待实机验收）**
  - TUI 引擎会话原先把 slash 补全菜单直接清空（`listSlashCommands` 仅服务 SDK 会话）。
  - 现改为注入官方 slash 全集静态候选（`Composer.tsx` `tuiSlashItems`，源自 2.6 节）：
    `/fork /undo /compact /import /export /title /rename /add-dir /new /sessions /clear /btw`
    及 `/plan /yolo /afk /task /model /mcp /hooks /skill: /flow:` 等。
  - 机制：TUI 引擎下 slash 不被前端拦截（`shouldBlock` 恒 false），选中候选插入文本，
    Enter 经 `sendTuiInput` 原样透传真实 TUI。零破坏纯增量。
  - 验收：TUI 会话输入框打 `/` → 出现官方候选；选 `/fork` 等 → 插入后发送透传 TUI。
- **D-2 会话恢复 `-S`/`-C` —— ✅ 已实现（v2.8.219，待实机验收）**
  - 新增 `Session.officialSessionId`（`types/ui.ts`），onTuiEvent 持续从 `payload.session.officialSessionId`
    捕获写回（App.tsx 三处 patch），经现有 localStorage 持久化自动落盘。
  - 重启 load 时清空 TUI 会话的死 `runtimeSessionId`（App.tsx），使下次发消息走重建分支。
  - `sendPromptContent` 无存活 runtime 时：有 `officialSessionId` 则 `startTuiSession({args:["-S",id]})`，
    启动失败（官方 session 文件已删等）无参重试兜底（Composer.tsx）。
  - **默认路径不变性**：无 officialSessionId 时不传 args，后端 `args=[]`，spawn 与今天逐字节一致。
  - **UI 重复护栏**：tuiHost `event.time < startedAt-5000` 已丢弃旧 wire 重放，恢复不产生重复气泡。
  - 验收：重启 Kimix → 切回旧 TUI 会话发消息 → 上下文延续、无重复气泡、侧栏会话带官方 sessionId。
- **D-3 友好 UI 入口（可选）** —— 会话级 fork/undo/rename 按钮，复用现有"按钮→sendTuiInput slash"范式。
- 验收：分叉/撤销/导入各跑通一次，侧栏恢复会话带官方 sessionId。

### 阶段 E：长程任务迁移到 /task —— ⚠️ 前提修正，待重定方向
- **官方文档核实（2026-06-01，slash-commands 参考页）**：官方 `/task`（=`/tasks`）仅为后台任务
  **浏览器**——"浏览后台任务列表"，随时可用。**官方未提供创建/编排/取输入输出/编程接口。**
- 因此原计划"用官方 `/task` 替换 prompt-mode longTaskService 编排"**前提不成立**：
  Kimix 长程任务是 executor+reviewer 双会话、多轮、带状态机的自有编排，官方 `/task` 覆盖不了。
- **重定方向（待用户拍板，不在夜间无验收时改 19 文件的在用功能）**：
  - 选项 1：保留 Kimix 自有 longTaskService 编排，仅把其底层每轮执行从 prompt-mode 换成 hidden TUI 发送（与主链路同源），`/task` 仅作官方侧只读浏览镜像。
  - 选项 2：维持现状（长程任务继续走 prompt-mode），等官方暴露后台任务编排 API 再迁。
- 验收：方向确定后另行制定。

### 阶段 F：Hooks 迁移 —— ✅ 已实现（v2.8.220，待实机验收）
- Kimix UserPromptSubmit hooks 现已在 TUI 发送链路 `sendTuiInput` 注入前执行：
  - `applyPromptSubmitHooks`（kimiBridge.ts）由 SDK/prompt-mode 私有改为 `export`，三链路同源复用。
  - 新增 IPC `hooks:applyPromptSubmit`（main.ts）+ preload + 类型（ipc.ts）+ 浏览器 stub（main.tsx）。
  - Composer TUI 分支在 `sendTuiInput` 前调用，hook 改写文本后再发；hook 阻断（action=block 或 exit 2）
    抛错由现有 TUI try/catch 承接写错误卡。
- **纯加性不变性**：无匹配 UserPromptSubmit 规则时 `applyPromptSubmitHooks` 原样返回文本（kimiBridge.ts:995），
  发送链路逐字节不变；hook 卡片经 `kimi:event`+`resolveUiSessionId`（runtimeSessionId 匹配）路由到 TUI 会话时间线。
- 查看仍可接官方 `/hooks`（slash 候选已在 D-1 提供）。
- 验收：在设置启用一个 UserPromptSubmit hook → TUI 会话发消息 → hook 命令执行、输出注入 prompt；
  block 规则触发时发送中止并显示错误卡。

### 阶段 G：删除 prompt-mode 主链路
- 删 `buildPromptModeArgs`/`runPromptModeTurn`/`readPromptModeThinkingEvents`/合成 think 占位。
- 删 `eventMapper.isKimixSyntheticThinking` 等残留。
- 保留 wire 解析（历史只读复用）。
- 验收：主链路搜不到 `--output-format stream-json`、搜不到合成思考占位；全功能走 TUI。

---

## 7. 技术风险与缓解

| 风险 | 缓解 |
|---|---|
| Windows hidden ConPTY（中文/ANSI/resize/隐藏窗口） | 保留 pipe fallback；保留原始 ANSI 日志；resize clamp |
| Ctrl+V 剪贴板注入不等价 | 阶段 C 先探针后切换；失败保留路径过渡态，绝不回退 prompt 包装 |
| screen-scraping 随官方文案变化回归 | wire 优先；screen 只做菜单 mirror；解析失败不阻塞 |
| 多会话多 hidden TUI 资源占用 | 默认只保活当前会话；非活跃休眠/关闭；恢复经官方 session |
| 官方 0.6.0 升级改 wire/slash | 集中 wire 解析与 slash 常量，单点维护 |

---

## 8. 验收矩阵（迁移完成前必须全绿）

```text
普通文本对话            长 thinking             关闭 thinking
工具调用                审批                    错误恢复
停止生成                运行中排队（Enter）     立即注入 steer（Ctrl+S）
图片 Ctrl+V 粘贴        视频                    队列带图自动发送
模型切换 /model         插件 marketplace        mcp /mcp
权限 /yolo /afk         Plan /plan              /fork /undo /compact
导出 /export            导入 /import            /btw 侧问题
/task 后台任务          /add-dir 工作区         /usage 用量
登录 /login             登出 /logout            会话恢复 -S/-C
历史 legacy 只读        搜索                    窗口关闭进程清理
正式消息页无污染        thinking 区无 Kimix 合成状态
```

---

## 9. 版本号同步（硬规则）

有实际改动必须同步三处：
- `package.json`（`version`）
- `src/components/layout/Sidebar.tsx`
- `src/components/settings/SettingsPanel.tsx`

> 注：盘点发现 Sidebar.tsx 当前未硬编码版本号字符串，提交前需确认其版本展示方式
> （可能动态取 `app:getInfo`），按实际情况同步。

---

## 10. 新窗口开工提示词

```text
接手 Kimix TUI 引擎迁移（修订版计划）。

项目目录：D:\WORKS\Android Project\kimix

必守：
- 始终中文，每轮第一句“你好霖江路”。
- 开工先执行 git status --short。
- 未验收不提交不推送；不回滚用户历史；只 stage 本轮相关文件。
- 有实际改动同步版本号三处：package.json、Sidebar.tsx、SettingsPanel.tsx。
- UI spacing 遵守 Kimix 留白规则，小浮层/列表/按钮/边框容器优先 inline style。
- 每轮只做一个可验证最小增量。

先读：
- docs/KIMIX_TUI_ENGINE_MIGRATION_PLAN.md（本文件）
- electron/tuiHost.ts
- src/utils/tuiSemanticReducer.ts、src/utils/eventMapper.ts
- src/App.tsx（onTuiEvent / 队列 / active turn 锁）
- src/components/chat/Composer.tsx

核心纪律：
- 正式消息只来自 wire semantic（text/think）；screen 只做菜单/调试 mirror。
- 普通发送 = Enter 排队；steer = Ctrl+S 立即注入（两者严格分离）。
- 图片走官方 Ctrl+V 原生粘贴（剪贴板+Ctrl+V），不要 prompt 包装路径。
- 旧功能一个都不能丢，官方新 slash 能力按矩阵逐个接入。

下一最小行动：见计划第 6 节阶段 A（修正 wire 路径 session_<uuid> 两层定位）。

验收命令：
$env:PATH='C:\Program Files\nodejs;C:\Users\Administrator\AppData\Roaming\npm;C:\Users\lijialin08\AppData\Roaming\npm;' + $env:PATH
pnpm test:run -- src/utils/__tests__/tuiSemanticReducer.test.ts
pnpm build
git diff --check
```
