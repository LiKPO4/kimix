# Kimi Workbench 开发计划

> 目标：做一个类似 Codex 交互体验的 Kimi Code CLI / Kimi Coding Plan 可视化桌面客户端。  
> 核心原则：不要一开始做完整 IDE，先做一个“可视化 Agent 壳”。Kimi 负责执行，UI 负责展示、审批、Diff、会话管理和任务过程。

---

## 1. 项目定位

项目暂定名：

- Kimix

推荐定位：

> 一个面向 Kimi Code CLI 的 Codex 风格桌面客户端。

英文定位：

> A Codex-style desktop UI for Kimi Code CLI.

---

## 2. 核心目标

本项目不是重新实现一个 AI 编程模型，也不是重新做一个完整 IDE。

真正要做的是：

```text
Kimi CLI / Kimi Agent SDK 作为执行内核
        ↓
Electron + React 作为桌面 UI
        ↓
Codex 风格交互：
会话流 + 工具卡片 + Diff 审核 + 权限审批 + 项目侧边栏
```

最终希望实现：

1. 可以选择本地项目目录
2. 可以创建 Kimi 会话
3. 可以像 Codex 一样输入任务
4. 可以实时看到 Kimi 的输出
5. 可以看到工具调用过程
6. 可以看到 Shell 命令、文件读写、Todo、状态变化
7. 可以处理权限审批
8. 可以查看文件 Diff
9. 可以恢复历史会话
10. 可以做长期项目开发

---

## 3. 技术选型

### 3.1 桌面框架

使用：

```text
Electron
```

原因：

- 适合 Windows 桌面端
- 可以调用本机 Node.js 能力
- 方便接入 Kimi Agent SDK
- 方便做文件系统、项目目录、Shell、Git、终端面板

### 3.2 前端框架

使用：

```text
React + TypeScript
```

推荐配套：

```text
Vite
Tailwind CSS
shadcn/ui
lucide-react
zustand
@monaco-editor/react
```

### 3.3 Agent 内核

首选：

```text
@moonshot-ai/kimi-agent-sdk
```

不要优先解析终端 stdout。

正确方式是：

```text
Kimi Agent SDK 结构化事件流
        ↓
Electron main process
        ↓
IPC
        ↓
React UI 状态管理
        ↓
Codex 风格界面展示
```

---

## 4. 总体架构

```text
kimi-workbench/
├─ package.json
├─ electron/
│  ├─ main.ts
│  ├─ preload.ts
│  ├─ kimiBridge.ts
│  ├─ projectService.ts
│  ├─ sessionService.ts
│  └─ gitService.ts
├─ src/
│  ├─ App.tsx
│  ├─ main.tsx
│  ├─ styles.css
│  ├─ components/
│  │  ├─ layout/
│  │  │  ├─ AppShell.tsx
│  │  │  ├─ Sidebar.tsx
│  │  │  ├─ TopBar.tsx
│  │  │  └─ RightPanel.tsx
│  │  ├─ chat/
│  │  │  ├─ ChatThread.tsx
│  │  │  ├─ Composer.tsx
│  │  │  ├─ MessageBubble.tsx
│  │  │  ├─ ToolCard.tsx
│  │  │  ├─ ApprovalCard.tsx
│  │  │  ├─ StatusCard.tsx
│  │  │  └─ TodoCard.tsx
│  │  ├─ diff/
│  │  │  ├─ DiffPanel.tsx
│  │  │  └─ FileChangeList.tsx
│  │  ├─ terminal/
│  │  │  └─ TerminalPanel.tsx
│  │  └─ common/
│  │     ├─ EmptyState.tsx
│  │     ├─ IconButton.tsx
│  │     └─ CommandPalette.tsx
│  ├─ stores/
│  │  ├─ appStore.ts
│  │  ├─ sessionStore.ts
│  │  └─ projectStore.ts
│  ├─ types/
│  │  ├─ kimi.ts
│  │  ├─ session.ts
│  │  └─ ui.ts
│  └─ utils/
│     ├─ eventMapper.ts
│     └─ formatters.ts
└─ README.md
```

---

## 5. UI 信息架构

目标布局：

```text
┌─────────────────────────────────────────────────────────────┐
│ 顶部：项目名 / 模型 / Thinking / 权限模式 / Token 状态          │
├───────────────┬───────────────────────────┬─────────────────┤
│ 左侧 Sidebar  │ 中间 Agent Timeline        │ 右侧 Diff/Review │
│               │                           │                 │
│ 项目列表       │ 用户输入                   │ 文件变更          │
│ 会话列表       │ AI 回复                    │ Diff 对比         │
│ 历史任务       │ 工具调用卡片                │ 审批详情          │
│               │ Todo / Status / Shell      │                 │
├───────────────┴───────────────────────────┴─────────────────┤
│ 底部 Composer：输入任务 / 附加文件 / Slash 命令 / 运行按钮       │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. Codex 风格核心交互

要学习的是 Codex 的交互模型，不是直接复制皮肤。

重点是：

1. 一个项目可以有多个 Thread
2. 每个 Thread 是一个可恢复任务流
3. Agent 每一步都有状态展示
4. 工具调用可见
5. 文件修改进入 Diff 面板
6. 危险操作需要审批
7. 可以中断任务
8. 可以恢复历史任务
9. 可以查看终端输出
10. 可以基于 Git 做回滚和审查

---

## 7. Kimi 事件到 UI 的映射

| Kimi 事件 | UI 展示 |
|---|---|
| TurnBegin | 用户任务卡片 |
| ContentPart:text | AI 回复气泡 |
| ContentPart:think | 可折叠思考区域 |
| ToolCall | 工具调用卡片 |
| ToolCallPart | 工具参数流式展开 |
| ToolResult | 工具结果卡片 |
| ToolResult.display.diff | 右侧 Diff 面板 |
| ToolResult.display.todo | Todo 进度卡片 |
| ApprovalRequest | 权限审批卡片 |
| StatusUpdate | Token / Context 状态条 |
| SubagentEvent | 子 Agent 状态卡片 |
| CompactionBegin | 上下文压缩开始提示 |
| CompactionEnd | 上下文压缩完成提示 |
| TurnEnd | 任务结束状态 |

---

## 8. 权限模式设计

顶部放一个权限模式选择器：

```text
权限模式：
[手动审批] [本会话自动同意] [YOLO / 全自动]
```

审批卡片样式：

```text
工具请求：执行 Shell 命令

命令：
flutter test --no-pub

风险：
中等

按钮：
[允许一次] [本会话都允许] [拒绝]
```

第一版先不要默认 YOLO。

推荐默认：

```text
手动审批
```

后面再加：

```text
approve_for_session
yoloMode
```

---

# 9. 开发阶段规划

---

## Phase 0：项目初始化

### 目标

搭建 Electron + React + TypeScript 基础项目。

### 任务

1. 创建项目目录
2. 初始化 Vite React TS
3. 安装 Electron
4. 安装 Kimi Agent SDK
5. 安装基础 UI 依赖
6. 跑通桌面窗口

### 命令参考

```powershell
mkdir kimi-workbench
cd kimi-workbench

pnpm create vite . --template react-ts

pnpm add @moonshot-ai/kimi-agent-sdk zod
pnpm add electron electron-vite concurrently
pnpm add zustand lucide-react
pnpm add @monaco-editor/react
pnpm add -D typescript @types/node
```

### 验收标准

1. 可以启动 Electron 桌面窗口
2. React 页面正常显示
3. 没有 TypeScript 报错

---

## Phase 1：最小可用 Kimi 会话

### 目标

实现最小版：

```text
选择项目目录 → 输入 Prompt → 创建 Kimi Session → 流式显示回复
```

### 功能

1. 选择本地项目目录
2. 输入任务
3. 创建 Kimi session
4. 调用 Kimi Agent SDK
5. 流式返回事件
6. 在 UI 中显示 AI 输出
7. 支持停止任务

### 后端核心文件

```text
electron/kimiBridge.ts
```

### 示例逻辑

```ts
import { createSession } from "@moonshot-ai/kimi-agent-sdk";

export async function runKimiTask({
  workDir,
  prompt,
  sendToRenderer,
}: {
  workDir: string;
  prompt: string;
  sendToRenderer: (event: any) => void;
}) {
  const session = createSession({
    workDir,
    model: "kimi-latest",
    thinking: true,
  });

  const turn = session.prompt(prompt);

  for await (const event of turn) {
    sendToRenderer(event);
  }

  const result = await turn.result;

  sendToRenderer({
    type: "RunResult",
    payload: result,
  });

  await session.close();
}
```

### UI 组件

```text
Composer.tsx
ChatThread.tsx
MessageBubble.tsx
StatusCard.tsx
```

### 验收标准

1. 可以选择项目目录
2. 可以输入任务
3. Kimi 可以返回内容
4. 内容能实时显示在 UI
5. 任务结束后 UI 状态恢复
6. 可以手动停止任务

---

## Phase 2：工具调用可视化

### 目标

让用户看懂 Agent 正在干什么。

### 功能

1. 显示 ToolCall
2. 显示 ToolResult
3. 显示 Shell 命令
4. 显示文件读取
5. 显示文件写入
6. 显示 Todo
7. 显示 StatusUpdate
8. 显示 SubagentEvent

### UI 卡片

```text
ToolCard.tsx
TodoCard.tsx
StatusCard.tsx
TerminalPanel.tsx
```

### 工具卡片样式

```text
[工具调用] Shell

命令：
flutter analyze --no-pub

状态：
运行中 / 成功 / 失败

输出：
...
```

### 验收标准

1. Kimi 调用工具时有卡片显示
2. Shell 命令能单独展示
3. 工具成功/失败状态清晰
4. Todo 能显示为列表
5. 用户不会感觉 Agent “卡住没反馈”

---

## Phase 3：权限审批系统

### 目标

实现 Codex 风格权限交互。

### 功能

1. 监听 ApprovalRequest
2. UI 弹出审批卡片
3. 支持允许一次
4. 支持本会话允许
5. 支持拒绝
6. 支持中断任务
7. 支持顶部权限模式切换

### UI 组件

```text
ApprovalCard.tsx
PermissionModeSelector.tsx
```

### 审批状态

```text
pending
approved_once
approved_for_session
rejected
```

### 验收标准

1. 遇到危险操作时不会静默执行
2. UI 能显示请求内容
3. 点击允许后任务继续
4. 点击拒绝后任务能收到拒绝结果
5. 本会话允许可以减少重复弹窗

---

## Phase 4：Diff 面板

### 目标

实现右侧代码变更审查面板。

### 功能

1. 收集 ToolResult.display.diff
2. 按文件聚合变更
3. 右侧展示文件列表
4. 点击文件显示 Diff
5. 支持 Monaco Diff Editor
6. 支持打开文件
7. 支持刷新 Git 状态

### UI 组件

```text
DiffPanel.tsx
FileChangeList.tsx
```

### 布局

```text
右侧面板：
- Changed Files
- 当前文件 Diff
- 操作按钮：
  [打开文件] [复制路径] [查看 Git 状态]
```

### 验收标准

1. Kimi 修改文件后右侧出现变更
2. 可以看到 old_text / new_text
3. 可以按文件查看 Diff
4. Diff 不阻塞聊天流
5. UI 体验接近 Codex / VS Code

---

## Phase 5：会话历史与恢复

### 目标

实现 Thread 式会话管理。

### 功能

1. 左侧显示历史会话
2. 创建新会话
3. 恢复旧会话
4. 根据第一条用户输入生成标题
5. 删除会话
6. 显示会话最后更新时间
7. 支持继续上一轮任务

### UI 组件

```text
Sidebar.tsx
SessionList.tsx
SessionItem.tsx
```

### 数据来源

优先使用 Kimi Agent SDK 的会话能力：

```text
listSessions(workDir)
parseSessionEvents(workDir, sessionId)
createSession({ sessionId })
```

### 验收标准

1. 同一个项目下可以看到多个会话
2. 点击历史会话可以恢复聊天内容
3. 可以继续对旧会话提问
4. 不会丢失上下文

---

## Phase 6：项目管理

### 目标

做出 Codex App 那种项目入口体验。

### 功能

1. 最近项目列表
2. 打开项目目录
3. 移除项目记录
4. 显示项目 Git 分支
5. 显示项目路径
6. 快速打开 VS Code
7. 快速打开终端

### UI 组件

```text
ProjectList.tsx
ProjectHeader.tsx
OpenProjectButton.tsx
```

### 验收标准

1. 启动后能看到最近项目
2. 能快速打开之前的项目
3. 项目切换后会话列表跟着变化
4. 不同项目的会话不混在一起

---

## Phase 7：Git / Worktree / 回滚能力

### 目标

让长期开发更安全。

### 功能

1. 显示 git status
2. 显示当前分支
3. 支持创建任务分支
4. 支持创建 worktree
5. 支持查看变更文件
6. 支持回滚单个文件
7. 支持回滚全部未提交修改
8. 支持一键复制 commit message

### 注意

这部分不要太早做。

先保证 Kimi 可视化、审批、Diff 稳定，再做 Git 深度能力。

### 验收标准

1. 能看到当前 Git 状态
2. Kimi 改动后能明确看到哪些文件变化
3. 可以安全回滚
4. 不会误删用户已有修改

---

## Phase 8：Slash 命令与快捷入口

### 目标

提升交互效率。

### 功能

Composer 支持：

```text
/init
/compact
/web
/status
/test
/analyze
/commit-message
/explain-changes
```

### 自定义快捷任务

```text
Flutter 项目快捷任务：
- 运行 flutter analyze --no-pub
- 运行 flutter test --no-pub
- 解释当前报错
- 扫描项目结构
- 生成 AGENTS.md
```

### 验收标准

1. 输入 `/` 弹出命令菜单
2. 可以键盘选择命令
3. 命令能转换成实际 Prompt 或工具动作
4. 常用任务不需要重复输入长 Prompt

---

## Phase 9：终端面板

### 目标

让 Shell 输出更像 Codex / IDE 内置终端。

### 功能

1. 底部可折叠 Terminal Panel
2. 展示 Agent 执行过的命令
3. 展示命令输出
4. 支持复制命令
5. 支持重新运行命令
6. 支持清空输出

### 验收标准

1. 用户能知道执行过哪些命令
2. 命令失败时能看到错误
3. 长输出不会污染聊天流
4. 终端面板可以折叠

---

## Phase 10：设置页

### 目标

把模型、权限、UI、项目行为集中管理。

### 设置项

```text
模型设置：
- model
- thinking
- max turns
- context compaction

权限设置：
- 手动审批
- 本会话自动同意
- yoloMode

UI 设置：
- 深色 / 浅色
- 字体大小
- 是否显示思考内容
- 是否默认展开工具调用

项目设置：
- 默认打开目录
- 是否自动读取 AGENTS.md
- 是否自动显示 Git 状态
```

### 验收标准

1. 设置可以保存
2. 重启应用后设置不丢
3. 不同项目可以有独立配置

---

## 10. 第一版 MVP 只做这些

不要贪多。

v0.1 只需要实现：

```text
1. Electron 桌面窗口
2. 选择项目目录
3. 输入任务
4. 创建 Kimi session
5. 流式显示回复
6. 展示工具调用
7. 处理 ApprovalRequest
8. 支持停止任务
```

只要这 8 个完成，就已经是一个有价值的 Kimi 可视化客户端。

---

## 11. 不建议第一版做的东西

暂时不要做：

```text
1. 完整代码编辑器
2. 插件市场
3. 云端同步
4. 多模型 Marketplace
5. 多 Agent 编排
6. 复杂工作流引擎
7. 自动发布
8. 用户系统
9. 账号体系
10. 过度仿制 Codex 视觉
```

原因：

```text
这些都会拖慢 MVP。
真正的核心是：把 Kimi 的 Agent 过程可视化。
```

---

## 12. 开发顺序建议

严格按这个顺序：

```text
第 1 步：跑通 Electron + React
第 2 步：跑通 Kimi Agent SDK
第 3 步：把事件打印到 UI
第 4 步：把文本事件做成聊天流
第 5 步：把工具事件做成卡片
第 6 步：把审批事件做成按钮
第 7 步：把 Diff 事件做成右侧面板
第 8 步：做会话列表
第 9 步：做项目列表
第 10 步：做 Git / worktree
```

---

## 13. UI 风格参考

整体感觉：

```text
现代
克制
高信息密度
像 Codex
像 VS Code
像 Linear
不要花哨
不要游戏化
不要赛博朋克
```

关键词：

```text
左侧导航
中间时间线
右侧审查
底部输入框
工具卡片
折叠详情
清晰状态
柔和边框
深色主题优先
```

---

## 14. 最小状态模型

前端 store 可以先这样设计：

```ts
type AppState = {
  currentProject?: Project;
  currentSession?: Session;
  permissionMode: "manual" | "approve_for_session" | "yolo";
  rightPanel: "diff" | "terminal" | "none";
  isRunning: boolean;
};

type Project = {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number;
};

type Session = {
  id: string;
  title: string;
  projectPath: string;
  createdAt: number;
  updatedAt: number;
  events: TimelineEvent[];
};

type TimelineEvent =
  | UserMessageEvent
  | AssistantMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequestEvent
  | StatusUpdateEvent
  | DiffEvent
  | TodoEvent
  | ErrorEvent;
```

---

## 15. IPC 设计

Electron 主进程负责调用 Kimi，前端只通过 IPC 交互。

建议 IPC 名称：

```text
project:open
project:listRecent
project:removeRecent

kimi:startSession
kimi:sendPrompt
kimi:stopTurn
kimi:approveRequest
kimi:listSessions
kimi:loadSession

git:status
git:diff
git:checkoutFile
git:openInVSCode
```

前端不要直接访问 Node API。

---

## 16. 安全原则

因为这是编程 Agent UI，安全很重要。

默认策略：

```text
1. 默认手动审批
2. 不默认开启 yoloMode
3. Shell 命令必须清晰展示
4. 删除、覆盖、git reset、rm、format、清理缓存等命令要高亮风险
5. 拒绝按钮必须明显
6. 允许一次和本会话允许要区分
7. 所有修改必须进入 Diff
8. 用户已有未提交修改要提示
```

危险命令关键词：

```text
rm
del
rmdir
format
git reset
git clean
git checkout .
git restore .
npm publish
flutter clean
powershell -ExecutionPolicy Bypass
curl | bash
Invoke-Expression
```

注意：不是一律禁止，而是 UI 要高亮提醒。

---

## 17. 针对 Flutter / Android 项目的内置模板

因为当前主要做 Flutter / Android 游戏项目，可以内置几个快捷任务。

### 项目扫描

```text
请阅读当前 Flutter 项目，输出：
1. 项目入口
2. 主要目录结构
3. 状态管理方式
4. 构建方式
5. 测试方式
6. 可能的风险点
不要修改代码。
```

### 生成 AGENTS.md

```text
请为当前项目生成简洁的 AGENTS.md，包含：
1. 项目简介
2. 常用命令
3. 代码风格
4. 测试方式
5. 修改注意事项
6. 不要触碰的文件
先给计划，再修改。
```

### 分析错误

```text
请根据当前报错分析原因，优先给出最小修改方案。
不要直接大范围重构。
```

### 跑测试

```text
请运行：
flutter analyze --no-pub
flutter test --no-pub

根据结果给出结论。
没有证据不要声称修复完成。
```

---

## 18. v0.1 里程碑

目标：

```text
做出一个能用的 Kimi 可视化客户端雏形。
```

必须完成：

```text
[ ] Electron 桌面窗口
[ ] React 主界面
[ ] 项目目录选择
[ ] Prompt 输入框
[ ] Kimi SDK 调用
[ ] 流式消息显示
[ ] 工具调用卡片
[ ] 审批卡片
[ ] 停止按钮
[ ] 错误展示
```

暂不做：

```text
[ ] Git worktree
[ ] 历史会话恢复
[ ] Monaco Diff
[ ] 设置页
[ ] 插件系统
[ ] 多 Agent
```

---

## 19. v0.1 验收 Prompt

开发完成后，用这些 Prompt 测试。

### 测试 1：只读项目

```text
请阅读当前项目结构，告诉我这个项目是做什么的。不要修改任何文件。
```

期望：

```text
1. 能返回项目分析
2. 能看到读取文件等工具调用
3. 没有文件修改
```

### 测试 2：生成计划

```text
请分析当前 Flutter 项目，并给出一个最小修复计划。只输出计划，不要修改代码。
```

期望：

```text
1. 能持续流式输出
2. 工具调用卡片正常显示
3. 不需要审批或只需要低风险审批
```

### 测试 3：触发命令审批

```text
请运行 flutter analyze --no-pub，并根据结果总结问题。
```

期望：

```text
1. UI 弹出 Shell 审批
2. 点击允许后继续执行
3. 命令输出可见
4. 结果能总结
```

### 测试 4：触发文件修改

```text
请在当前项目根目录创建一个 TEST_KIMI_WORKBENCH.md，内容为 hello kimi workbench。
```

期望：

```text
1. UI 弹出文件写入或相关工具调用
2. 修改后能看到结果
3. 后续版本可在 Diff 面板看到变化
```

---

## 20. 后续增强方向

当 v0.1 稳定后，再考虑：

```text
1. 会话历史恢复
2. Monaco Diff
3. Git status
4. Git 回滚
5. Worktree 隔离
6. VS Code 打开文件
7. Terminal Panel
8. Slash 命令
9. 自定义 Prompt 模板
10. 多模型 / ACP 支持
```

---

## 21. 最重要的判断

这个项目能不能做成，关键不在于 UI 多漂亮。

关键在于：

```text
Kimi 事件流是否完整可视化
权限审批是否顺手
Diff 是否清晰
Agent 是否有持续反馈
用户是否知道它正在干什么
```

只要这几个做好，就已经具备 Codex 风格体验。

---

## 22. 当前最佳路线总结

最终推荐路线：

```text
Electron + React + TypeScript
        ↓
Kimi Agent SDK
        ↓
结构化事件流
        ↓
Codex 风格 UI
        ↓
Diff / 审批 / 会话 / 项目管理
```

第一阶段不要碰 ACP。

原因：

```text
Kimi Agent SDK 更适合做专属 Kimi UI。
ACP 更适合做通用 Agent IDE 客户端。
```

等专属 UI 跑通后，再考虑增加：

```text
kimi acp
claude code
codex
qwen code
gemini cli
```

---

## 23. 下一步执行清单

马上开始做：

```text
[ ] 创建 kimi-workbench 项目
[ ] 跑通 Electron + React
[ ] 安装 @moonshot-ai/kimi-agent-sdk
[ ] 写 electron/kimiBridge.ts
[ ] 写最简 ChatThread
[ ] 写最简 Composer
[ ] 把 Kimi 事件 JSON 先打印到 UI
[ ] 再逐步美化成 Codex 风格卡片
```

第一天目标：

```text
能打开桌面窗口，选项目目录，输入一句话，让 Kimi 返回内容。
```

第一周目标：

```text
能看到工具调用、审批请求和任务过程。
```

第一个可发布版本目标：

```text
一个 Codex 风格的 Kimi Code CLI 可视化客户端。
```
