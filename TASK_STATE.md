# Kimix 长程任务状态

## 当前目标
v2.3.3 主内容会话工具栏修正后等待用户截图验收：顶部工具栏和工作区下拉继续放松，减少贴边和拥挤感。

## 当前版本
**v2.3.3** — 三处同步：`package.json` + `src/components/layout/Sidebar.tsx` + `src/components/settings/SettingsPanel.tsx`。

## 已完成
- v2.0.0：即时计时、上下文百分比/详细显示、工具命令聚合、空会话输入自动建会话。
- v2.1.0：
  - 移除 Kimi bridge 45 秒“无正文”中断，不再把慢响应判为错误，继续等待 SDK turn。
  - 输入框支持粘贴图片和拖拽图片，按官方 SDK `ContentPart[]` 传 `{ type: "image_url", image_url: { url: dataUrl } }`。
  - 图片粘贴后在输入框上方显示缩略图，可移除；纯图片也可发送。
  - 工具组聚合 key 改为第一条命令 id，展开后后续新增命令不再导致整组自动收起。
  - `BrowserWindow.icon` 指向项目根 `Kimix.png`，并将 `build/icon.png` 覆盖为同一张图。
  - 顶部菜单和思考模式菜单按权限菜单方法加宽、加高、加内边距。
  - 重写 `AppShell.tsx` 为有效 UTF-8，修复顶部菜单乱码文案。
- v2.2.0：
  - 空会话/无当前会话界面显示中心引导和项目相关建议。
  - 建议项会从当前项目历史会话和本地持久化记录中恢复，点击后可直接创建/复用会话发送。
  - 项目、本地模式、分支、导出从内容顶部移到输入区下方的底部状态栏。
  - 重写 `EmptyState.tsx`、`ContextBar.tsx` 为有效 UTF-8，修复本轮可见乱码。
- v2.2.1：
  - 当前会话存在但只有不可见事件或空 assistant 占位时，也回到空状态建议页，避免启动第一眼主区空白。
- v2.2.2：
  - 历史记录里存在 SDK 原始事件（如 `TurnBegin`）时，不再把这些未知事件当作可见内容，避免空白消息列表挡住空状态。
- v2.2.3：
  - 空状态建议列表从 620px 收窄到 460px，使建议项在标题下方和内容中心区域对齐。
- v2.2.4：
  - 空状态标题下方间距从 `mb-6` 增加到 `mb-9`，避免标题和建议项贴得太近。
- v2.2.5：
  - 标题与建议列表间距改用 inline `style={{ gap: 56 }}` 过正验证，绕开 Tailwind spacing 类不生效的问题。
- v2.2.6：
  - 标题与建议列表间距从 56px 回撤到 28px。
- v2.3.0：
  - 主内容区顶部补充 Codex 风格会话工具栏：左侧会话标题/更多，右侧运行、工作区、终端、面板图标按钮。
- v2.3.1：
  - 去掉系统标题栏中间的会话标题，避免和主内容工具栏重复。
  - 主内容工具栏左右内边距放大，标题从左边缘后移。
  - 工作区按钮点击打开项目根目录，右侧下拉提供资源管理器、VS Code、Trae、Coder 打开选项。
  - 终端按钮会在项目根目录打开终端，侧栏按钮切换侧边栏。
- v2.3.2：
  - 侧栏切换移到窗口左上角按钮。
  - 右上角最右按钮恢复为审查/Diff 面板占位，暂不实现实际动作。
  - 工作区按钮从紧凑小方块改为更宽松的分段胶囊，下拉菜单加宽、加行高、补图标和更接近 Codex 的排序。
- v2.3.3：
  - 主内容顶部工具栏高度从 48px 增加到 56px，左右内边距增加到 30px。
  - 工作区按钮加宽，右侧按钮组间距增加。
  - 工作区下拉菜单从 260px 增加到 288px，行高和左右内边距继续放松。

## 未完成
- 等待 v2.3.3 截图验收。
- 后续继续做 ChatThread + MessageBubble Codex 风格细化、应用图标打包 ico 完善、端到端 Kimi 会话联调、Diff 详情、会话历史、设置持久化完善。

## 阻塞/注意
- 构建前 PATH 必须包含：`C:\Program Files\nodejs;C:\Users\lijialin08\AppData\Roaming\npm`。
- 截图版本号不对时必须让用户重发，不基于错图推理。
- UI 数值改动若反馈无效，按 AGENTS.md 的“矫枉必须过正”流程处理。

## 关键文件
- `electron/kimiBridge.ts`：不再有 45 秒无正文超时；`sendPrompt` 支持 string / SDK `ContentPart[]`。
- `electron/main.ts`：图片 data URL 转官方 SDK `ContentPart[]`；窗口图标指向 `Kimix.png`。
- `src/components/chat/Composer.tsx`：图片粘贴/拖拽、缩略图、发送图片。
- `src/components/chat/ChatThread.tsx`：工具组稳定 key，避免展开状态被新增命令重置。
- `src/components/chat/EmptyState.tsx`：项目相关空状态建议、建议本地持久化、点击建议直接发送。
- `src/components/chat/ContextBar.tsx`：底部状态栏，包含项目、本地模式、分支、导出。
- `src/components/layout/AppShell.tsx`：顶部菜单文案、主内容会话工具栏、项目/终端/侧栏按钮。
- `src/components/settings/SettingsPanel.tsx`：版本号 v2.3.3。

## 下一步最小行动
让用户回传 v2.3.3 截图，优先核对：顶部右侧图标是否不再贴边、工作区按钮和下拉菜单宽松度是否接近 Codex 图3。
