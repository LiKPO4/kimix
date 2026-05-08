# Kimix 长程任务状态

## 当前目标
先完成 Codex 风格 UI Shell 重建与输入框问题修复，再继续 v0.1 MVP 联调验证。

## 已完成
- [x] Phase 0：项目初始化（Electron + React + TS + Tailwind）
- [x] Phase 1：最小 Kimi 会话
  - [x] `electron/kimiBridge.ts` — SDK 封装（createSession/sendPrompt/stopTurn/approveRequest）
  - [x] `electron/projectService.ts` — 项目目录选择 + 最近项目存储（~/.kimix/projects.json）
  - [x] `electron/main.ts` — 完整 IPC handlers（project/kimi/app）
  - [x] `src/utils/eventMapper.ts` — SDK StreamEvent → TimelineEvent 映射 + 流式合并
  - [x] `src/stores/appStore.ts` / `sessionStore.ts` — 状态管理
  - [x] `src/components/layout/Sidebar.tsx` — 项目选择 + 最近项目列表
  - [x] `src/components/chat/Composer.tsx` — 输入框 + 发送/停止 + 权限模式显示
  - [x] `src/App.tsx` — IPC 事件监听连接
- [x] Phase 2：工具调用可视化
  - [x] `ToolCard.tsx` — 工具调用/结果卡片
  - [x] `FileCard.tsx` — 文件引用卡片
  - [x] `ChangeCard.tsx` — 文件变更摘要卡片（+N -M）
  - [x] `TodoCard.tsx` — Todo 列表 + 进度条
  - [x] `StatusCard.tsx` — 状态更新条
  - [x] `ErrorCard.tsx` — 错误卡片
- [x] Phase 3：权限审批系统
  - [x] `ApprovalCard.tsx` — 审批请求卡片（允许一次/本会话允许/拒绝）
  - [x] IPC `kimi:approveRequest` — 主进程审批回调
  - [x] Composer 权限模式选择器 UI
- [x] UI 接手与阶段性重建
  - [x] `plan.md` 新增 Codex 参考图 UI 修复执行计划
  - [x] `AppShell.tsx` / `Sidebar.tsx` / `Composer.tsx` 做过一轮最小 Shell 重建
  - [x] `MessageBubble.tsx` 移除点赞/点踩，只保留复制；思考折叠到同一条 assistant 消息内
  - [x] `sessionStore.ts` 将排队消息升级为结构化队列，支持修改/删除/上移/下移/提升队首
  - [x] `index.css` 局部移除 Composer 蓝色 focus outline
  - [x] 多次 `pnpm build` 已通过（需先补 PATH）

## 未完成
- [ ] 输入框真实输入起始位置仍然错误：即使内层输入区 padding 增大到 `px-10/sm:px-12`，文字仍从外层最左侧开始显示。
- [ ] 继续重建 `ChatThread + MessageBubble`，让消息区也统一到 Codex 风格。
- [ ] 接入应用图标 `Kimix.png`：目前根目录图标没有接到 `BrowserWindow.icon` / `electron-builder.yml`。
- [ ] 端到端联调验证（实际运行 Kimi 会话）
- [ ] Diff 详情展开（v0.1 只显示摘要）
- [ ] 会话历史恢复（Phase 5）
- [ ] 设置页持久化（Phase 10）

## 阻塞
- 输入框起始位置问题尚未定位根因。用户截图显示输入文本仍从底部输入框最左侧开始，疑似并非普通 padding 问题。下一步不要继续盲调 padding，需要检查是否存在 textarea 绝对定位、CSS 被覆盖、父层宽度/transform、浏览器 autofill/selection 或其它元素叠加。
- 本机 shell 默认 PATH 缺少 Node/pnpm，需要每次命令前执行：`set "PATH=C:\Program Files\nodejs;C:\Users\lijialin08\AppData\Roaming\npm;%PATH%"`。
- Kimi CLI 当前运行报错：`CLI process error: spawn kimi ENOENT`，说明当前环境找不到 `kimi` 可执行文件。

## 关键文件
- `src/components/chat/Composer.tsx` — 当前输入框问题核心文件
- `src/components/layout/AppShell.tsx` — 主框架与 Composer 区域包裹
- `src/components/layout/Sidebar.tsx` — 侧栏重建文件
- `src/components/chat/ChatThread.tsx` / `MessageBubble.tsx` — 下一阶段重建对象
- `src/stores/sessionStore.ts` — 结构化排队队列
- `src/App.tsx` — IPC 事件监听、排队自动续发
- `src/index.css` — 全局样式与 Composer focus 覆盖
- `electron/main.ts` — 后续接入 `Kimix.png` 图标需改 `BrowserWindow.icon`
- `electron-builder.yml` — 后续打包图标配置

## 已知问题
- `electron-store` v10+ 为纯 ESM，与 CJS 主进程不兼容，已改用 `fs` 手写存储（`~/.kimix/projects.json`）
- Windows `network_change_notifier_win.cc` 非致命警告
- Electron dev 可能出现 cache 权限警告：`Unable to move the cache: 拒绝访问`，目前未阻塞构建
- `build/icon.ico` 当前在 Git 状态中显示删除，Windows 打包图标需要处理

## 下一步最小行动
1. 先停止/关闭当前 dev 窗口，确保不是旧窗口。
2. 不再继续盲调 padding；打开 DevTools 或临时用 JS/CSS 定位 `textarea` 实际盒模型，确认为什么文本无视内层 padding。
3. 修复输入起始位置后运行：`set "PATH=C:\Program Files\nodejs;C:\Users\lijialin08\AppData\Roaming\npm;%PATH%" && pnpm build`。
4. 构建通过后主动启动：`pnpm dev`，供用户截图验收。
