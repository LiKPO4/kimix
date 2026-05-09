# Kimix 长程任务状态

## 当前目标
v1.0.2 视觉修复后等待用户回传截图验收（侧栏内容裁切、输入框贴底、左侧贴边、布局留白）。
验收通过后，继续 Codex 风格 UI 重建（ChatThread + MessageBubble）与 v0.1 MVP 端到端联调。

## 当前版本
**v1.0.2** — 三处同步：`package.json` + `src/components/layout/Sidebar.tsx`（设置按钮右侧）+ `src/components/settings/SettingsPanel.tsx`（底部说明行）。

## 已完成（累计）
- [x] Phase 0：项目初始化（Electron + React + TS + Tailwind）
- [x] Phase 1：最小 Kimi 会话（IPC / eventMapper / stores / Sidebar / Composer / App）
- [x] Phase 2：工具调用可视化（ToolCard / FileCard / ChangeCard / TodoCard / StatusCard / ErrorCard）
- [x] Phase 3：权限审批系统（ApprovalCard + IPC + 权限模式选择器）
- [x] UI Shell 阶段性重建（AppShell / Sidebar / Composer 最小 Shell）
- [x] MessageBubble 清理（只保留复制、思考并入 assistant 消息）
- [x] 排队消息结构化（修改/删除/上移/下移/提升队首）
- [x] Git 分支整理（远程 `master` 已吸收原 `UI` 分支，后续只在 master 工作）
- [x] Composer 输入起点修复（内层输入区 + 自绘 placeholder + textarea p-0）
- [x] Composer forwardRef 化：新建 `src/components/chat/ComposerInput.tsx`，暴露 `focus()` / `reset()` 命令式句柄
- [x] 统一横向内边距：新增 `.kimix-content-x`（24/40px 响应式），`ChatThread` / `EmptyState` / AppShell Composer 包裹层全部改用该类
- [x] Tailwind JIT 动态类名问题定位：`px-16` / `pb-8` / `pt-10` 等 spacing scale 类在当前配置下会不生成，已改为 inline `style` 兜底
- [x] v1.0.0 诊断（红色粗边框 + 浅红背景）确认 inline style 生效链路
- [x] v1.0.1 Composer 回撤到目标值：`paddingLeft/Right:20, paddingTop:14, paddingBottom:10`
- [x] v1.0.2 三项修复
  - AppShell 主区：`paddingBottom: 28, paddingRight: 10`
  - AppShell composer 包裹层：`kimix-content-x shrink-0 bg-white pb-8 pt-2`
  - Sidebar 外层：`style={{ paddingLeft: 12, paddingRight: 10 }}`，移除 `pl-1 pr-2`
  - 三处版本号同步 bump 到 v1.0.2
- [x] `AGENTS.md` 增补「视觉改动方法论」章节（矫枉必过正 + Tailwind JIT 回避 + 进程清理 + 版本号锚定 + 图片系统协议 + PATH 前缀）

## 未完成
- [ ] **等待 v1.0.2 截图验收**（侧栏内容是否还裁切、输入框是否还贴底、左侧是否还贴边）
- [ ] 如侧栏时间戳仍截断：考虑把 `w-[320px]` 放到 340–360 或压缩时间戳格式
- [ ] 权限菜单弹出仍被 `main` 的 `overflow-hidden` 裁切（本轮未动）
- [ ] 继续重建 `ChatThread + MessageBubble` 到 Codex 风格
- [ ] 接入应用图标 `Kimix.png`（`BrowserWindow.icon` + `electron-builder.yml`）
- [ ] 端到端联调验证（实际运行 Kimi 会话）
- [ ] Diff 详情展开（v0.1 只显示摘要）
- [ ] 会话历史恢复（Phase 5）
- [ ] 设置页持久化（Phase 10）

## 阻塞
- 本机 cmd 默认 PATH 缺少 Node/pnpm，每次构建前必须前置：
  `set "PATH=C:\Program Files\nodejs;C:\Users\lijialin08\AppData\Roaming\npm;%PATH%"`
- Kimi CLI 运行报错：`spawn kimi ENOENT`，当前环境找不到 `kimi` 可执行文件（不影响 UI 验收）
- 图片传输系统偶发延迟，看到截图版本号不对时**必须立刻让用户重发**，不要基于错图推理

## 关键文件
- `AGENTS.md` — 已落盘"视觉改动方法论"章节，下一个 agent 必读
- `src/components/chat/Composer.tsx` — 外层 inline style padding 20/20/14/10，使用 `ComposerInput`
- `src/components/chat/ComposerInput.tsx` — forwardRef，暴露 `focus()` / `reset()`
- `src/components/layout/AppShell.tsx` — 主区 `paddingBottom:28, paddingRight:10`，composer 包裹用 `kimix-content-x`
- `src/components/layout/Sidebar.tsx` — 外层 `paddingLeft:12, paddingRight:10`，设置按钮显示 v1.0.2
- `src/components/settings/SettingsPanel.tsx` — 版本号文案 v1.0.2
- `src/components/chat/ChatThread.tsx` — 用 `kimix-content-x` 统一横向留白
- `src/components/chat/EmptyState.tsx` — 用 `kimix-content-x`，卡片 `max-w-[560px]`
- `src/index.css` — 定义 `.kimix-content-x`（24/40px 响应式）+ Composer focus 覆盖
- `tailwind.config.ts` — content 已含 `./src/**/*.{js,ts,jsx,tsx}`，但 spacing scale 类仍会缺失
- `package.json` — version 1.0.2
- `electron/main.ts` — 后续接图标要改 `BrowserWindow.icon`
- `electron-builder.yml` — 后续打包图标配置

## 已知问题 / 反模式
- **Tailwind 反模式**：调 padding / margin / spacing 数值时**不要**用 `px-*` / `pb-*` / `pt-*` 类，优先 inline `style` 或 `[padding-left:20px]` 任意值语法。
- **图片延迟反模式**：用户截图延迟经常出现，看到版本号不对**必须先让用户重发**，不要硬猜。
- **进程残留反模式**：旧 `electron.exe` / `node.exe` 不杀干净会导致 dev 看起来"没生效"。
- `electron-store` v10+ 为纯 ESM，主进程 CJS 不兼容，已改用 `fs` 手写 `~/.kimix/projects.json`
- Windows `network_change_notifier_win.cc` 非致命警告
- Electron dev 偶发 `Unable to move the cache: 拒绝访问`，目前未阻塞构建
- `build/icon.ico` 当前在 Git 状态中显示删除，Windows 打包图标需要处理

## 下一步最小行动
1. **等待用户回传 v1.0.2 截图**：核对版本号 → 核对侧栏内容完整 / 输入框不贴底 / 左侧有留白。
2. 若版本号不对：立即让用户重发，不要基于错图推理。
3. 若验收通过：进入 `ChatThread + MessageBubble` Codex 风格重建。
4. 若验收仍有问题：遵循"矫枉必过正"——先 ×3 放大问题数值，看是否生效；生效后再回撤到目标值。
5. 每次改动后标准流程：
   - `taskkill /F /IM electron.exe /T & taskkill /F /IM node.exe /T`
   - 清 `out/` + `node_modules\.vite` + `node_modules\.cache`
   - `set "PATH=..." && pnpm build`（看新 hash）→ 后台 `pnpm dev`
   - 三处版本号同步 bump（差距要大，例如 v1.0.2 → v1.1.0）
