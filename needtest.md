# 测试文档
将需要测试的内容按顺序整理在下方，用户会在回来后依次进行测试。

---

## 基础功能测试

### 1. 项目选择与会话创建
- [ ] 点击"打开项目"（Sidebar 项目标题旁的小箭头），选择本地项目目录
- [ ] 项目出现在左侧 Sidebar 的"项目"列表中
- [ ] 自动创建 Kimi 会话，输入框解锁
- [ ] ContextBar 显示项目名称、本地模式、分支名

### 2. 基本对话流程
- [ ] 输入消息，点击发送（或按 Enter）
- [ ] 消息**立即**出现在右侧气泡中（不等 SDK 返回）
- [ ] 左侧立即显示"思考中..."动画占位符
- [ ] SDK 返回后，AI 回复逐步填充占位符

### 3. Markdown 渲染
- [ ] AI 回复包含 `# 标题`、`**粗体**`、`- 列表` 时正确渲染
- [ ] 代码块显示语法高亮（有语言标签和深色背景）
- [ ] 表格正确渲染为 HTML 表格
- [ ] 引用块（`> `）显示为左侧灰色竖线引用

### 4. 排队发送
- [ ] 当 AI 正在回复时（isRunning=true），输入框**仍然可用**
- [ ] 运行时发送消息，消息立即显示在聊天流中
- [ ] Composer 上方显示"排队中: N 条消息"
- [ ] 当前回复完成后，自动发送队列中的下一条
- [ ] 多次排队后，消息按顺序逐一发送

### 5. 停止生成
- [ ] AI 回复过程中，点击灰色停止按钮（Square 图标）
- [ ] 或按 Escape 键，停止当前生成

### 6. 消息操作
- [ ] 悬停用户消息，显示复制和重新发送按钮
- [ ] 点击复制，剪贴板中有消息内容
- [ ] 点击重新发送，重新触发 AI 回复
- [ ] 悬停 AI 消息，显示复制按钮
- [ ] 悬停 AI 消息，显示反应按钮（赞/踩/分享）
- [ ] 点击赞/踩，按钮高亮显示

---

## UI & 交互测试

### 7. 侧边栏
- [ ] Sidebar 顶部有 4 个导航项：新对话、搜索、技能、自动化
- [ ] "搜索、技能、自动化"显示为灰色禁用状态，hover 提示"即将上线"
- [ ] 项目列表可展开/折叠
- [ ] 点击项目展开显示该项目下的所有会话
- [ ] 会话显示相对时间（刚刚/47分/2小时/1周）
- [ ] 点击会话切换到该会话
- [ ] 悬停会话显示删除按钮（垃圾桶图标），点击删除
- [ ] 删除当前会话后，聊天区回到空状态
- [ ] 点击"新对话"为当前项目创建新会话
- [ ] 点击"设置"打开设置面板
- [ ] 点击侧边栏外的小箭头（折叠态）展开侧边栏
- [ ] Cmd/Ctrl+B 切换侧边栏展开/折叠

### 8. 设置面板
- [ ] 点击"设置"打开弹窗
- [ ] 切换主题：浅色 / 深色 / 跟随系统
- [ ] 切换权限模式：手动审批 / 本会话允许 / 完全访问
- [ ] 点击弹窗外区域关闭面板
- [ ] 重启应用后，主题和权限模式保持上次设置（持久化到文件）

### 9. 空状态交互
- [ ] 选择项目后，空状态显示"要在 {项目名} 中构建什么？"
- [ ] 下方显示 4 条建议（带图标）
- [ ] 点击建议，直接发送该消息
- [ ] 发送后空状态消失，显示聊天流

### 10. 快捷键
- [ ] `Enter` = 发送消息
- [ ] `Shift+Enter` = 换行
- [ ] `Esc` = 停止生成
- [ ] `Cmd/Ctrl+B` = 切换侧边栏
- [ ] `Cmd/Ctrl+K` = 聚焦输入框

### 11. 文件拖放
- [ ] 从文件管理器拖文件到 Composer 区域
- [ ] 显示"释放以添加附件"的蓝色覆盖层
- [ ] 释放后，文件路径自动附加到输入框中

### 12. 导出聊天记录
- [ ] 有活跃会话时，ContextBar 显示"导出"按钮
- [ ] 点击导出，下载 `.md` 文件
- [ ] 文件内容包含所有消息（用户/AI/工具/错误）

### 13. 聊天线程 Header
- [ ] 聊天区域顶部显示会话标题
- [ ] 右侧有"更多操作"按钮（三个点）

---

## 高级功能测试

### 14. Diff 查看器
- [ ] AI 修改代码后，显示"N 个文件已更改"卡片
- [ ] 点击文件行，展开 side-by-side 代码对比
- [ ] 旧版本左侧红色标记删除行
- [ ] 新版本右侧绿色标记新增行

### 15. 工具调用卡片
- [ ] AI 调用工具时，显示工具名称和状态（运行中/成功/失败）
- [ ] 点击工具卡片可展开/折叠详情
- [ ] 显示工具参数（JSON 格式）

### 16. 审批卡片
- [ ] AI 请求审批时，显示审批卡片
- [ ] 显示工具描述
- [ ] 点击"允许一次" / "本会话允许" / "拒绝"
- [ ] 审批后卡片状态更新为"已批准"或"已拒绝"

### 17. Todo 卡片
- [ ] AI 创建任务时，显示任务列表卡片
- [ ] 显示进度条（完成数/总数）
- [ ] 任务状态图标：待办 / 进行中 / 已完成

### 18. 状态更新卡片
- [ ] 显示 token 使用数、上下文大小

### 19. 错误处理
- [ ] AI 出错时，显示红色错误卡片
- [ ] 错误卡片可点击 X 关闭

---

## 持久化测试

### 20. 会话持久化
- [ ] 关闭应用前有多条聊天记录
- [ ] 重新打开应用，`pnpm dev`
- [ ] 之前的会话和消息自动恢复（从 localStorage 读取）
- [ ] Sidebar 中的会话列表仍然存在

### 21. 设置持久化
- [ ] 切换主题后，重启应用，主题保持一致
- [ ] 切换权限模式后，重启应用，权限模式保持一致

---

## End-to-End 完整流程

### 22. 完整工作流
- [ ] 打开项目 → 创建会话 → 发送消息 → AI 回复
- [ ] AI 调用工具 → 显示工具卡片 → 请求审批 → 用户批准
- [ ] AI 继续执行 → 显示代码 Diff → 用户查看对比
- [ ] 用户排队发送下一条消息 → AI 完成后自动回复
- [ ] 导出聊天记录为 Markdown 文件
- [ ] 关闭应用 → 重新打开 → 聊天记录恢复
- [ ] 切换主题 → 重启 → 主题保持

---

## UI 细节比对（与 Codex 参考图）

### 23. 整体配色
- [ ] Sidebar 背景为暖米色（#f7f5f2），不是冷灰色
- [ ] 主区域背景为白色（#ffffff）
- [ ] 边框为暖色调（#e8e6e1）
- [ ] 强调色为微软蓝（#0078d4）

### 24. 消息气泡
- [ ] 用户消息：蓝色背景（#0078d4），白色文字，无头像
- [ ] AI 消息：白色背景，深色文字，无头像
- [ ] 圆角大（20px），用户消息右下小圆角，AI 消息左下小圆角
- [ ] 消息间距大（space-y-6）

### 25. Composer
- [ ] 大圆角胶囊状（rounded-[24px]）
- [ ] 有阴影
- [ ] 发送按钮为灰色圆形（hover 变黑）
- [ ] 模型选择器显示在输入框内右侧
- [ ] 权限模式显示在输入框内左侧（橙色）

### 26. Sidebar
- [ ] 顶部有图标导航（新对话、搜索、技能、自动化）
- [ ] 项目分组有"项目"标题
- [ ] 会话显示相对时间
- [ ] 底部只有"设置"按钮

---

## Round 5 审查修复

### 主进程（Critical + High）
- [ ] **CSP 安全策略** - 生产/开发环境分别配置了 Content-Security-Policy
- [ ] **单实例锁** - 应用启动时检查 `requestSingleInstanceLock()`，重复启动会聚焦已有窗口
- [ ] **URL 解析安全** - `setWindowOpenHandler` 和 `app:openExternal` 都包裹了 try-catch
- [ ] **closeSession 异常阻断** - 先从 Map 删除再调用 `session.close()`，异常不阻塞后续清理
- [ ] **startSession 竞态** - 先 `activeSessions.delete()` 再 `await existing.close()`
- [ ] **Zod 输入校验** - `project:addRecent` 和 `app:saveSettings` 使用 Zod Schema 校验
- [ ] **sendPrompt try-catch 简化** - 移除了永远不会执行的外层 catch

### 主进程（Medium）
- [ ] **readProjects JSON 校验** - 解析后检查 `Array.isArray` 并过滤字段类型
- [ ] **loadSettings JSON 校验** - 解析后检查是否为对象，防止 `null` 展开报错
- [ ] **writeProjects/saveSettings 错误处理** - 磁盘写入异常会抛出并打印日志
- [ ] **sendEvent/sendStatus 日志** - 非窗口销毁异常会打印到控制台
- [ ] **before-quit 可靠关闭** - 有活跃 session 时 `preventDefault()`，等待全部关闭后再退出
- [ ] **Renderer 崩溃处理** - 监听 `render-process-gone`，崩溃时自动重启
- [ ] **未捕获异常日志** - 主进程顶部添加 `unhandledRejection` / `uncaughtException` 处理器
- [ ] **project:open defaultPath 校验** - 检查类型为字符串后再传入对话框

### 前端（High）
- [ ] **ChatThread `lastEventId` 崩溃** - `session?.events[session?.events.length - 1]?.id` 改为 `.at(-1)?.id`
- [ ] **MarkdownRenderer `components` useMemo** - 自定义组件对象缓存，避免流式输出时频繁卸载/挂载
- [ ] **App.tsx setTimeout 泄漏** - 使用 `timersRef` 收集 timer ID，cleanup 时统一 `clearTimeout`
- [ ] **ChangeCard 嵌套交互元素** - 外层改为 `<div role="button">`，内部恢复为真实 `<button>`

### 前端（Medium）
- [ ] **eventMapper 运行时守卫** - `isRecord`/`isString`/`isNumber` 替代裸 `as` 断言
- [ ] **localStorage 运行时校验** - 解析后检查 `Array.isArray`
- [ ] **IPC Promise rejection** - `getSettings`/`listRecentProjects` 添加 `.catch(() => {})`
- [ ] **Escape 快捷键排除输入框** - 在 `<textarea>`/`<input>`/contentEditable 中按 Escape 不触发 stopTurn
- [ ] **sessionStore shiftPendingMessage** - 改为 `set` 回调内部读取 state，消除循环引用
- [ ] **ContextBar revokeObjectURL** - 延迟 1 秒释放，避免下载启动前 URL 失效
- [ ] **main.tsx 非空断言** - `document.getElementById("root")!` 改为显式空检查

---

## Round 6 审查修复

### 主进程（Critical + High）
- [ ] **before-quit 递归** - 添加 `isQuitting` 锁 + `Promise.race` 10 秒超时
- [ ] **project:removeRecent 校验** - 校验 `typeof id === "string"`
- [ ] **kimi:sendPrompt 校验** - 校验 request 为对象且包含 string 类型的 sessionId/content
- [ ] **shell.openExternal 拒绝捕获** - `.catch(() => {})` 处理 Promise 拒绝
- [ ] **will-navigate 拦截** - 阻止窗口导航到外部 URL
- [ ] **render-process-gone 开发模式** - 开发模式仅记录日志，不自动重启
- [ ] **kimiBridge startSession 竞态** - 关闭旧会话后再次检查 `activeSessions.has()`
- [ ] **sendEvent/sendStatus 提前检查** - `mainWindow` 为 null 或已销毁时直接返回

### 前端（Critical + High）
- [ ] **MarkdownRenderer link 引用计数** - 模块级 refCount，防止多实例 unmount 时样式丢失
- [ ] **App.tsx useRef currentSession** - 从 useEffect 依赖中移除 `currentSession`，消除订阅间隙
- [ ] **MarkdownRenderer code inline prop** - 使用 react-markdown 的 `inline` 参数判断，而非 `className`
- [ ] **ChangeCard DiffViewer 提取** - 提取到模块顶层 + `useMemo` 缓存 diff 结果
- [ ] **SettingsPanel ARIA** - 添加 `role="dialog"`、`aria-modal`、`aria-labelledby`、关闭按钮 `aria-label`
- [ ] **App.tsx Escape 模态框检查** - 存在 `[aria-modal="true"]` 时不触发 stopTurn

### 前端（Medium）
- [ ] **MarkdownRenderer remarkPlugins/rehypePlugins useMemo** - 缓存插件数组
- [ ] **MarkdownRenderer safeHref** - 非法链接渲染为 `<span>` 而非 `<a href="#">`
- [ ] **Sidebar 重复项目** - 打开已存在路径的项目时复用现有 `id`
- [ ] **eventMapper as string** - `item.status` 使用 `isString` 守卫
- [ ] **Composer 类型断言** - 拖放文件 `path` 运行时检查
- [ ] **App.tsx pendingMessages 持久化** - `beforeunload` 时一并保存到 localStorage

---

## 已知问题 / 待优化

1. **Windows GPU 缓存警告** - 非致命，可忽略
2. **搜索/技能/自动化功能** - UI 占位，功能未实现，显示禁用状态
3. **语音输入按钮** - 有 UI 占位，功能未实现
4. **文件附件** - 拖放后只显示路径文本，未真正上传到 Kimi
5. **会话标题** - 仅截取前 30 字符，未来可让 AI 自动生成摘要标题
6. **代码 Diff 算法** - 当前是简单行对比，非真正的 LCS diff
7. **模型选择器** - 下拉功能已实现（当前仅 kimi-latest 可用）
8. **权限模式下拉** - 下拉切换功能已实现
9. **ContextBar 项目选择** - 点击可打开项目对话框，模式和分支为占位
10. **ChatThread Header 更多操作** - 按钮存在，下拉菜单未实现
11. **FileCard** - 组件存在但未在事件流中渲染（缺少对应事件类型）
12. **深色模式代码高亮** - 已修复为根据主题动态切换 github/github-dark.css

---

## 打包与发布测试

### 27. 本地打包
- [ ] 执行 `pnpm dist:win` 成功生成 `.exe` 安装包和便携版
- [ ] 安装包大小约 80-90MB（包含 Electron 运行时）
- [ ] 安装包能正常安装并启动应用
- [ ] 便携版 `Kimix x.x.x.exe` 无需安装可直接运行

### 28. GitHub Actions CI/CD
- [ ] 推送 `v*` 标签触发 Release workflow
- [ ] Windows runner 成功构建 `.exe`
- [ ] macOS runner 成功构建 `.dmg` + `.zip`
- [ ] Linux runner 成功构建 `.AppImage` + `.deb`
- [ ] 所有产物自动上传到 GitHub Release
- [ ] Release 页面显示正确的版本号和更新日志

### 29. 首次安装体验
- [ ] 安装后桌面出现快捷方式
- [ ] 开始菜单出现 Kimix 条目
- [ ] 首次启动正常加载，无白屏
- [ ] 能正常选择项目、创建会话、发送消息
