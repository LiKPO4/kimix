# Kimix 长程任务状态

## 当前目标
完成 v0.1 MVP 联调验证：实际运行 Kimi 会话，确认流式回复、工具卡片、审批系统正常工作。

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

## 未完成
- [ ] 端到端联调验证（实际运行 Kimi 会话）
- [ ] Diff 详情展开（v0.1 只显示摘要）
- [ ] 会话历史恢复（Phase 5）
- [ ] 设置页持久化（Phase 10）

## 阻塞
无

## 关键文件
- `electron/kimiBridge.ts` — Kimi SDK 核心封装
- `electron/main.ts` — IPC 路由
- `src/utils/eventMapper.ts` — 事件映射与合并逻辑
- `src/components/chat/` — 所有聊天组件
- `src/stores/` — zustand 状态管理

## 已知问题
- `electron-store` v10+ 为纯 ESM，与 CJS 主进程不兼容，已改用 `fs` 手写存储（`~/.kimix/projects.json`）
- Windows `network_change_notifier_win.cc` 非致命警告

## 下一步最小行动
启动 `pnpm dev`，选择项目目录，输入测试 Prompt，验证 Kimi 流式回复 + 工具卡片 + 审批系统端到端工作。
