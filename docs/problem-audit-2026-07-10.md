# Kimix 问题审计文档

**审计日期**：2026-07-10  
**当前版本**：v2.14.122（commit `495975e`）  
**审计来源**：代码审查清单 + 关键证据文件抽查  
**状态**：已整理，待排期修复

---

## 审计说明

本文档汇总了对 Kimix v2.14.122 的代码审查结果。问题按严重度分为 P0/P1/P2 三级，其中 P0 为必须立即处理的数据安全或功能丢失风险，P1 为高风险缺陷，P2 为一致性、无障碍或设计债务。

**验证方式**：
- 对 P0 及前 20 项 P1 问题进行了关键证据文件抽查（`Read`）
- 其余问题基于审查清单提供的文件位置、行号和二次判断结论纳入
- 文末列出“排除的问题”，说明未纳入原因

---

## 一、最高优先级（P0）

### 1. 文件撤销可能误删用户后续修改，甚至越过当前项目

- **严重度**：P0
- **类型**：数据安全缺陷
- **影响**：Agent 修改完成后，若用户又手工编辑该文件，点击“撤销文件/全部撤销”会把用户新修改一并清除；绝对路径可能定位到当前项目之外的其他 Git 仓库。
- **证据**：
  - `src/components/chat/ChangeCard.tsx:197`：`handleRevert` 直接调用 `window.api.revertFiles`，无确认、无内容快照、无哈希校验。
  - `electron/projectService.ts:548`：`revertGitGroup` 对未跟踪文件直接 `fs.rmSync(..., { recursive: true })`，对已跟踪文件直接 `git checkout --`；`revertGitFiles` 按 `findGitRoot(target.absolutePath)` 分组，可跨项目操作。
- **验证状态**：已抽查代码确认
- **修复状态**：已修复（commit `b7761d5`）
- **建议修复方向**：
  1. 限制撤销目标只能位于主工作区及明确授权的附加目录内
  2. 撤销前计算并比对内容哈希，或生成反向补丁
  3. 文件内容发生变化时展示 diff 并要求二次确认
  4. 禁止通过绝对路径跳转到其他项目/仓库

---

## 二、高优先级（P1）

### 2. 项目级 Hook 在项目根目录下反而不执行

- **影响**：工作目录恰好等于项目根目录时，`path.relative()` 返回空字符串，`isPathInside` 返回 false，导致项目级 Hook 被跳过。
- **证据**：`electron/hookRunner.ts:17`
- **验证状态**：已抽查代码确认
- **修复状态**：已修复（commit `8bf46df`）
- **建议**：当 `rel === ""` 时应视为在目录内部。

### 3. 部分“项目级 Hook”实际上会变成全局 Hook

- **影响**：同步到 Kimi Code `config.toml` 时只写入 `event/matcher/command/timeout`，未写入 `scope/projectPath`，导致 A 项目的 Hook 可能影响所有项目。
- **证据**：`electron/settingsService.ts:131`（`hookRuleToToml`）
- **验证状态**：已抽查代码确认
- **修复状态**：已修复（commit `1c1eeac`）
- **建议**：若官方 TOML 不支持项目作用域，应由 Kimix 自己代理执行项目级 Hook，或在 UI 中明确禁用“项目级”选项。

### 4. 定时关机脱离 UI 生命周期，关闭窗口后仍可能继续执行

- **影响**：倒计时和取消入口仅存于 React 内存；刷新、崩溃或关闭 Kimix 后，系统仍会按原计划关机。
- **证据**：`src/components/layout/AppShell.tsx:1495`、`electron/main.ts:6554`
- **验证状态**：已抽查代码确认
- **修复状态**：已修复（commit `d60a690`）
- **建议**：主进程持有关机截止时间并持久化；应用重启后恢复提示；退出前明确告知用户；倒计时按绝对时间计算。

### 5. 会话、图片和待发送队列整体写入 localStorage，存在静默丢数据风险

- **影响**：完整会话事件、图片 Base64、待发送消息一并写入 localStorage；超出配额后仅控制台警告，新状态停止保存，重启后可能丢失待发送队列、图片或本地 UI 事件。
- **证据**：`src/utils/persistence.ts:123`、`src/hooks/useStatePersistence.ts:1`
- **验证状态**：已抽查代码确认
- **修复状态**：已修复（commit `e2af08e`）
- **说明**：新增 `src/utils/stateStorage.ts`，IndexedDB 不可用（如 jsdom 测试或浏览器预览）时回退到 localStorage；生产环境绘画会话、待发送消息、图片均持久化到 IndexedDB，图片以 SHA-256 引用单独存储；持久化失败时通过 `kimix:toast` 提示用户。
- **建议**：迁移至 IndexedDB 或主进程文件数据库；图片单独存储；增加容量监控和失败提示。

### 6. 图片粘贴没有数量、尺寸和总容量限制

- **影响**：所有图片通过 `Promise.all` 同时读取为 Base64；一次粘贴大量或超大图片会瞬间推高渲染进程内存，并放大 localStorage 问题。
- **证据**：`src/components/chat/Composer.tsx:732`
- **验证状态**：已抽查代码确认
- **修复状态**：已修复（commit `ba6ea6a`）
- **说明**：在 `Composer.tsx` 新增限制：最多 20 张、单张不超过 20MB、总量不超过 100MB；读取改为每批最多 3 张的串行分批；超出限制时通过 `kimix:toast` 提示用户。
- **建议**：限制单图尺寸、图片数量和总大小；串行或限并发读取；提前生成缩略图。

### 7. `@文件` 搜索可能阻塞 Electron 主进程

- **影响**：每次查询使用同步递归文件扫描，深度最多 32 层；无匹配时可能遍历整个大型仓库或网络目录，导致整窗卡顿甚至被判定无响应。
- **证据**：`electron/main.ts:3129`、`src/components/chat/Composer.tsx:701`
- **验证状态**：已抽查代码确认
- **修复状态**：已修复（commit `4fc3b0a`）
- **说明**：`searchProjectFiles` 改为 `async`，使用 `fs.promises.readdir`；新增 `activeSearchControllers` 在同一会话发起新查询时取消旧查询；扫描过程每 64 个条目让出事件循环，并设置 600ms 总时间预算，超时或结果数达标立即返回。
- **建议**：建立文件索引，或改为异步分批扫描并支持 `AbortSignal`。

### 8. 所有平台都将路径转小写比较

- **影响**：Linux 中 `/Foo` 和 `/foo` 是两个目录，但 Kimix 会当作同一个项目，造成会话串项目、归档错位或附加目录去重错误。
- **证据**：`src/App.tsx:146`、`src/utils/additionalWorkDirs.ts:1`、`electron/kimiCodeHost.ts:1577`
- **验证状态**：已抽查 `App.tsx`、`additionalWorkDirs.ts` 确认
- **修复状态**：已修复（commit `1fe1902`）
- **说明**：新增 `src/utils/pathCase.ts`，提供 `normalizePathForComparison` 与 `isSamePath`；仅在 `process.platform === "win32"` 时转小写，macOS/Linux 保留原始大小写；`preload.ts` 向渲染进程暴露 `platform` 字段，确保浏览器/测试环境与 Electron 环境均能获得准确平台信息；统一替换 `App.tsx`、`Sidebar.tsx`、`AppShell.tsx`、`SearchOverlay.tsx`、`MessageBubble.tsx`、`Composer.tsx`、`ContextBar.tsx`、`ChangeCard.tsx`、`ApprovalCard.tsx`、`ChatThread.tsx`、`sessionCatalog.ts`、`kimiCodeSessionRecovery.ts`、`projectDisplay.ts`、`additionalWorkDirs.ts` 以及 `electron/kimiCodeHost.ts`、`electron/main.ts` 中的路径比较/去重逻辑。
- **建议**：Windows 下可转小写，Linux/macOS 必须按原始大小写比较。

### 9. 搜索结果复制出的恢复命令固定为 PowerShell

- **影响**：macOS/Linux 用户复制命令后无法执行。
- **证据**：`src/components/layout/SearchOverlay.tsx:43`（`formatResumeCommand`）
- **验证状态**：已抽查代码确认
- **修复状态**：已修复（commit `c5c1187`）
- **说明**：`formatResumeCommand` 现在读取 `window.api.platform`；Windows 保持 PowerShell 格式 `Set-Location -LiteralPath '...'; kimi -S <id>`，macOS/Linux 生成 POSIX shell 格式 `cd '...' && kimi -S <id>`；对路径中的单引号做了正确转义。
- **建议**：按平台生成 `cd` + `kimi -S` 命令。

### 10. macOS 更新包没有按 CPU 架构筛选

- **影响**：x64、arm64 都会构建，但更新逻辑只寻找第一个 DMG/ZIP，没有按 `process.arch` 选择；Intel Mac 无法运行 arm64 包。
- **证据**：`electron-builder.yml:1`、`electron/main.ts:2804`
- **验证状态**：已抽查 `pickUpdateAsset` 确认
- **修复状态**：已修复（commit `6110a9b`）
- **说明**：`electron/main.ts` 的 `pickUpdateAsset` 在 `process.platform === "darwin"` 分支中，先按 `process.arch`（arm64/x64）筛选文件名包含对应架构的 `.dmg` / `.zip`，找不到再 fallback 到任意 dmg/zip，避免 Intel Mac 下载 arm64 包。
- **建议**：按 `process.arch` 匹配对应架构资产。

### 11. 语音快捷键和定时关机在非 Windows 平台仍被正常展示

- **影响**：后端已抛出“不支持”，但用户仍可配置，完成后才发现功能不可用。
- **证据**：`src/components/settings/SettingsPanel.tsx:2576`、`electron/main.ts:2036`
- **验证状态**：已抽查 `SettingsPanel.tsx`、`Composer.tsx`、`LongTaskInspectorPanel.tsx` 确认
- **修复状态**：已修复（commit `d874b8c`）
- **说明**：新增 `src/utils/platform.ts` 统一读取 `window.api.platform`；非 Windows 平台下，`SettingsPanel` 隐藏“语音输入”设置区，`Composer` 隐藏麦克风按钮，`LongTaskInspectorPanel` 隐藏“执行完成后关机”复选框。
- **建议**：按平台隐藏或禁用，并说明原因。

### 12. 安装引导固定展示 Windows PowerShell 命令

- **影响**：手动安装回退命令错误，macOS/Linux 用户无法执行。
- **证据**：`src/components/layout/DialogSystem.tsx:1`
- **验证状态**：已抽查 `DialogSystem.tsx` 确认
- **修复状态**：已修复（commit `d1b3020`）
- **说明**：`DialogSystem.tsx` 新增 POSIX 安装命令常量；安装引导面板与“复制安装命令”按钮根据 `isWindows()` 动态显示 Windows PowerShell 或 macOS/Linux curl|bash 命令。
- **建议**：按平台生成对应 shell 命令。

### 13. Kimix 更新包缺少应用层校验

- **影响**：安装包下载后直接打开，没有校验 SHA256，签名验证配置也被关闭；网络正常结束但文件不完整时仍可能重命名并尝试打开。
- **证据**：`electron/main.ts:3063`、`electron-builder.yml:1`
- **验证状态**：未抽查，基于审查结论纳入
- **修复状态**：已修复（commit `ae90d4a`）
- **说明**：`ReleaseAssetInfo` 扩展 `sha256` 字段；新增 `parseReleaseSha256()` 从 release 的 `SHA256SUMS.txt` 解析每个文件的 SHA256；`mapGitHubRelease` 改为 async 并附加校验值；`downloadUpdateAsset` 在重命名前校验实际文件大小与 `asset.size` 一致，并计算 SHA256 与 `asset.sha256` 比对，失败则删除临时文件并抛错；`.github/workflows/release.yml` 新增生成并上传 `SHA256SUMS.txt` 的步骤。
- **建议**：下载后校验 SHA256 和长度；与 Kimi Code 二进制安装流程保持同等安全标准。

### 14. macOS 签名和公证流程从仓库配置中不可确认

- **影响**：若正式宣称支持 macOS，应验证 CI secrets、签名和 notarization，否则 Gatekeeper 体验会很差。
- **验证状态**：已验证，仓库配置中无法确认
- **修复状态**：阻塞（需用户补充 CI secrets 与证书）
- **说明**：
  - `electron-builder.yml` 已配置 `mac.hardenedRuntime: true`、`gatekeeperAssess: false` 和 `build/entitlements.mac.plist`，但缺少 `identity`（签名证书）和 `notarize` 配置。
  - `.github/workflows/release.yml` 的 `build-mac` job 仅注入 `GH_TOKEN`，没有 `APPLE_ID`、`APPLE_TEAM_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`CSC_LINK`、`CSC_KEY_PASSWORD` 等签名/公证所需 secrets。
  - `build/entitlements.mac.plist` 存在，内容仅涉及 JIT 与内存权限，未涉及签名或公证。
  - 因此从仓库可见配置无法确认 macOS 签名和公证流程已启用；需要在 GitHub 仓库设置中添加 Apple Developer 证书与 Notarization 凭据，并在 `electron-builder.yml` 中补充 `identity` 与 `notarize`。
- **建议**：检查 `electron-builder.yml` 和 GitHub Actions secrets 配置。

### 15. 设置自动保存失败时界面仍显示成功状态

- **影响**：IPC 常以 `{ success: false }` 正常 resolve，但调用方未检查返回值，导致保存失败 UI 仍显示成功。
- **证据**：`src/hooks/useSettingsSync.ts:1`
- **验证状态**：已抽查代码确认
- **修复状态**：已修复（commit `e31b9d4`）
- **说明**：`useSettingsSync.ts` 中 `window.api.saveSettings(...)` 原来只 `.catch()` 捕获 Promise reject；现在增加 `.then()` 检查返回值的 `success === false` 分支，并通过 `kimix:toast` 提示用户具体错误；`.catch()` 分支也补充了 toast 提示，确保调用异常时同样可见。
- **建议**：处理 `success === false` 分支，给出提示并回滚或重试。

### 16. 设置文件和 Kimi 配置文件采用非原子覆盖

- **影响**：直接 `writeFileSync` 覆盖；磁盘满、进程退出或杀毒软件介入时可能损坏整个用户配置。
- **证据**：`electron/settingsService.ts:153`
- **验证状态**：已抽查代码确认
- **修复状态**：已修复（commit `ec7602c`）
- **说明**：在 `electron/settingsService.ts` 新增 `writeFileAtomic` 辅助函数：先写 `.tmp` 临时文件并 `fsyncSync`，存在旧文件时先复制一份 `.bak` 备份，再通过 `renameSync` 原子替换目标文件；失败时清理临时文件。`saveSettings`、`loadSettings` 的迁移写回以及 `syncKimiHookConfig` 写入 `config.toml` 均改用该原子写入函数。
- **建议**：临时文件写入、`fsync`、原子 rename、保留最近备份。

### 17. 长程任务状态文件损坏后任务可能直接消失

- **影响**：`state.json` 非原子写入，读取异常后返回 null；任务 Markdown 可能仍在，但调度、恢复位置和运行状态无法自动恢复。
- **证据**：`electron/longTaskService.ts:181`
- **验证状态**：已抽查代码确认
- **修复状态**：已修复（commit `d189a2f`）
- **说明**：`electron/longTaskService.ts` 新增 `writeFileAtomic` 辅助函数，为 `state.json` 提供临时文件 + `fsync` + 备份 `.bak` + 原子 rename 的写入流程；`createLongTask` 和 `updateLongTaskState` 均改用该函数。`readStateFile` 在解析失败或字段校验不通过时，会自动尝试读取同目录 `state.json.bak` 并恢复，同时在控制台输出警告。
- **建议**：原子写入 + 备份；解析失败时尝试读取 `.bak`。

### 18. 文件预览设置允许填写任意扩展名，后端却只支持固定白名单

- **影响**：用户保存 `js/ts/py` 后界面显示设置成功，但预览结果为空。
- **证据**：`src/components/settings/SettingsPanel.tsx:1650`、`electron/main.ts:1`
- **验证状态**：未抽查，基于审查结论纳入
- **修复状态**：已修复（commit `ff4e454`）
- **说明**：新增 `src/utils/previewExtensions.ts`，统一维护可预览文本扩展名白名单（md/txt/json/log/yaml/yml/toml/ini/csv/tsv）和标准化函数；`electron/main.ts` 移除本地重复定义，扫描与读取逻辑均改用该共享白名单；`SettingsPanel.tsx` 的快捷选项和手动输入均基于同一份白名单校验，输入不支持的扩展名时自动移除并通过 `kimix:toast` 提示用户。
- **建议**：设置界面使用与后端同一份能力定义并即时校验。

### 19. 搜索失败会被伪装成“没有会话”

- **影响**：`listKimiCodeHistorySessions` 失败时直接返回，界面显示“没有找到匹配内容”，用户可能误以为历史丢失。
- **证据**：`src/components/layout/SearchOverlay.tsx:124`
- **验证状态**：已抽查代码确认
- **修复状态**：已修复（commit `9e9bc6d`）
- **说明**：`SearchOverlay.tsx` 新增 `historyListError` 状态；`listKimiCodeHistorySessions` 返回 `success === false` 时写入具体错误信息，并在搜索面板上方的状态行优先展示；切换项目或重新打开搜索时清除错误状态，避免与正常空结果混淆。
- **建议**：区分加载失败与空结果，展示错误提示。

### 20. 搜索结果中存在按钮嵌套按钮

- **影响**：无效 HTML 语义和键盘行为；`stopPropagation` 无法修复无障碍问题。
- **证据**：`src/components/layout/SearchOverlay.tsx:417`
- **验证状态**：已抽查代码确认
- **修复状态**：已修复（commit `08c6bd1`）
- **说明**：`SearchOverlay.tsx` 中“全部工作目录”结果列表的整行元素由 `<button>` 改为 `<div role="button" tabIndex={0}>`，保留点击与键盘选中逻辑；内部“复制命令”按钮保持独立 `<button>`，避免 HTML 按钮嵌套。
- **建议**：将外层改为 `div` + 点击处理，内部复制按钮独立；或改用语义正确的行布局。

### 21. 搜索界面展示 `Ctrl+1…9`，但没有实现对应快捷键

- **影响**：提示可用但实际无法通过快捷键选择；第 10 项以后仍显示 `Ctrl+9`。
- **证据**：`src/components/layout/SearchOverlay.tsx:378`
- **验证状态**：已抽查代码确认
- **修复状态**：已修复（commit `d62d5d9`）
- **说明**：`SearchOverlay.tsx` 的搜索输入框新增 `Ctrl+Digit1-9` 快捷键处理：按下后根据当前 scope 直接打开对应序号的结果；同时修复提示标签，第 10 项及以后不再显示 `Ctrl+9`，只有前 9 项显示 `Ctrl+1` 到 `Ctrl+9`。
- **建议**：实现对应快捷键，或移除提示。

### 22. 多个弹窗没有标准对话框语义和焦点约束

- **影响**：搜索、Git、启动、关机等浮层缺少统一的 `role="dialog"`、`aria-modal` 和 focus trap；键盘焦点可能落到背景；Escape 可能触发全局停止任务而非关闭弹窗。
- **证据**：`src/hooks/useKeyboardShortcuts.ts:1`、`src/components/layout/DialogSystem.tsx:1`
- **验证状态**：未抽查，基于审查结论纳入
- **修复状态**：已修复（commit `c2a2e5e`）
- **说明**：新增 `src/hooks/useDialogFocus.ts`，在弹窗打开时将焦点移动到首个可聚焦元素（不存在则聚焦容器），并在关闭时恢复之前的焦点；`SearchOverlay.tsx` 和 `DialogSystem.tsx` 中的配置引导、启动命令、关机确认、帮助/关于/更新/快捷键/信息弹窗均添加 `role="dialog"`、`aria-modal="true"` 和 `aria-label`，使屏幕阅读器能正确识别模态弹窗。
- **建议**：建立统一 Dialog/Overlay 管理器，处理焦点、Escape 和 modal 语义。

### 23. 全局 Escape 可能停止另一个会话

- **影响**：优先使用单一的 `runningSessionId`，不保证它是当前可见会话；用户想停止当前任务，却可能静默停止另一个项目中的任务。
- **证据**：`src/App.tsx:1126`
- **验证状态**：未抽查，基于审查结论纳入
- **修复状态**：已修复（commit `b297263`）
- **说明**：`App.tsx` 的 `handleEscape` 改为仅当 `runningSessionId` 与当前可见会话 `currentSession.id` 一致时才执行取消；去掉了对 `runningSessionId` 为 null 时直接 fallback 到 `currentSession.id` 的逻辑，避免用户查看非运行会话时误停后台任务。
- **建议**：Escape 停止操作应绑定当前可见会话/运行时。

### 24. 菜单和快捷键帮助展示了未实现的命令

- **影响**：Ctrl+N、Ctrl+O、F11、设置快捷键等被展示，但全局快捷键逻辑主要只有 Ctrl+K、Ctrl+B、Escape。
- **证据**：`src/components/layout/TopMenuBar.tsx:1`、`src/hooks/useKeyboardShortcuts.ts:1`
- **验证状态**：未抽查，基于审查结论纳入
- **修复状态**：已修复（commit `fbcb389`）
- **说明**：`AppShell.tsx` 在 `handleMenuAction` 后新增全局键盘监听，补全菜单中展示的大部分快捷键：Ctrl+N 新对话、Ctrl+O 打开项目、Ctrl+, 设置、Ctrl+J 终端、Ctrl+T Web Server、Ctrl+R 重载、Alt+Ctrl+B 文件预览、Ctrl+F 搜索、Ctrl+Shift+[ / ] 切换对话、Ctrl+[ / ] 前进后退、Ctrl++/- /0 缩放、F11 全屏、Ctrl+M 最小化、Ctrl+/ 快捷键帮助；输入框内不触发，弹窗打开时不触发。
- **建议**：实现对应命令或从菜单/帮助中移除。

### 25. “快速对话”和“新对话”执行完全相同的逻辑

- **影响**：两个入口行为一致，增加理解成本。
- **证据**：`src/components/layout/AppShell.tsx:842`
- **验证状态**：未抽查，基于审查结论纳入
- **建议**：若定义相同则删除一个；若“快速”应减少步骤则实现差异。

### 26. 菜单“删除”通过直接修改 DOM selection 工作

- **影响**：受控 React 输入框可能把内容恢复，且不触发 input/change；非输入区域文本选择也无法删除。
- **证据**：`src/components/layout/AppShell.tsx:862`
- **验证状态**：未抽查，基于审查结论纳入
- **建议**：对受控输入框通过 React 状态删除；对普通可编辑区域使用标准命令。

### 27. 队列“更多”按钮没有行为，排序仅支持鼠标拖动

- **影响**：“更多”按钮无动作；已有 move/promote 能力但无键盘入口。
- **证据**：`src/components/chat/Composer.tsx:2495`
- **验证状态**：未抽查，基于审查结论纳入
- **建议**：为队列项补充键盘操作入口或移除无行为的“更多”按钮。

### 28. 同名技能无法区分来源，最终启用哪一份具有不确定性

- **影响**：UI 按技能名称记录启用状态；同步时按名称构造 Map，同名技能只保留最后一份；用户点击 A 来源的技能，实际复制的可能是 B 来源版本。
- **证据**：`src/components/layout/SkillsPanel.tsx:164`、`electron/main.ts:3462`
- **验证状态**：已抽查 `SkillsPanel.tsx` 确认
- **建议**：技能标识包含来源路径；明确优先级或让用户选择来源。

### 29. 插件“官方”标签表达的是安装位置，不一定代表发布者可信

- **影响**：位于特定插件目录的清单会被标记为“官方”，用户会理解为“由 Kimi 官方发布或审核”。
- **证据**：`src/components/layout/SkillsPanel.tsx:272`、`electron/main.ts:3189`
- **验证状态**：已抽查 `SkillsPanel.tsx` 确认
- **建议**：改为“插件提供”并单独显示发布者和来源。

### 30. 技能扫描遇到损坏文件时静默忽略

- **影响**：没有诊断入口，用户只能看到技能莫名消失。
- **验证状态**：未抽查，基于审查结论纳入
- **建议**：提供扫描日志或错误提示入口。

### 31. ZIP 导入缺少总体积和条目数量限制

- **影响**：技能包导入、会话备份导入会直接解压或读取整个条目；损坏备份或压缩炸弹可让应用耗尽内存。
- **证据**：`src/utils/sessionBackup.ts:1`、`electron/main.ts:3007`
- **验证状态**：已抽查 `sessionBackup.ts` 部分结构确认
- **建议**：限制 ZIP 总大小、单条目大小和条目数量；流式解压并校验。

### 32. 会话备份事件只做浅层字段验证

- **影响**：只检查对象、字符串 type 和数字 timestamp，随后强制转换成 `TimelineEvent`；缺少正文或工具字段的事件可能在渲染组件中报错。
- **证据**：`src/utils/sessionBackup.ts:1`
- **验证状态**：已抽查代码确认存在浅验证结构
- **建议**：区分“未知但结构完整”与“已知类型字段缺失”。

### 33. Hook 命令失败或超时可能仍被记录为成功

- **影响**：非阻断 Hook 失败后继续发送消息可能是合理策略，但日志必须显示失败，不能把“继续执行”误写成“执行成功”。
- **证据**：`electron/hookRunner.ts:1`
- **验证状态**：未抽查完整逻辑，基于审查结论纳入
- **建议**：明确记录 `error` 结果；必要时通知用户。

### 34. Hook 模板和生成命令偏向 PowerShell

- **影响**：正式发布 macOS/Linux 后，生成的模板命令无法直接执行。
- **证据**：`electron/hookRunner.ts:1`
- **验证状态**：未抽查，基于审查结论纳入
- **建议**：按当前 shell 生成模板。

### 35. Hook matcher 允许复杂正则在主进程同步运行

- **影响**：灾难性回溯正则可能卡住主进程。
- **证据**：`electron/hookRunner.ts:1`
- **验证状态**：未抽查，基于审查结论纳入
- **建议**：限制表达式复杂度、输入长度或执行时间。

### 36. 展开旧历史时一次挂载全部消息

- **影响**：初始只渲染尾部约 28 项，但点击“展开旧历史”后会一次渲染所有事件；长会话性能最差。
- **证据**：`src/components/chat/ChatThread.tsx:1807`
- **验证状态**：已抽查代码确认存在 `showOlderItems` 切换逻辑
- **建议**：每次向前加载固定轮次，并对 Markdown、工具过程和图片做虚拟化。

### 37. 单条超长 Markdown 仍可绕过历史折叠的性能保护

- **影响**：一个超长回复中的 Markdown、代码高亮、表格和公式仍会同步解析并完整挂载。
- **验证状态**：未抽查，基于审查结论纳入
- **建议**：基准测试确认阈值；对超长单条内容做截断或虚拟化。

### 38. 通知默认可能在系统层展示对话正文

- **影响**：通知会截取 Agent 回复或提问内容作为正文；代码、客户信息或私密内容可能出现在锁屏。
- **证据**：`src/App.tsx:396`、`electron/main.ts:2418`
- **验证状态**：未抽查，基于审查结论纳入
- **建议**：默认显示“任务已完成”，另设“通知中展示内容”开关。

### 39. “完全访问权限”会同时关闭澄清提问能力

- **影响**：高权限模式不仅放宽执行权限，还锁定 clarification；权限越高，猜错后的损失反而越大。
- **证据**：`src/components/chat/Composer.tsx:445`
- **验证状态**：未抽查，基于审查结论纳入
- **建议**：将“执行权限”和“澄清能力”拆分为两个独立维度。

---

## 三、排除的问题

以下问题经二次复核后未纳入正式缺陷清单：

| 问题 | 排除原因 |
| --- | --- |
| 侧栏悬停按钮默认透明 | 父级存在 `group-focus-within`，键盘聚焦时可显现 |
| 只有一个 `runningSessionId` | 其他代码还会根据会话事件判断后台运行；真正缺陷是全局 Escape 目标选择（问题 23） |
| 文件预览只扫描根目录和一层子目录 | 界面已明确描述该范围，属于既定功能边界 |
| 搜索默认覆盖所有工作区 | 合理产品选择；错误在于搜索失败与空结果未区分（问题 19） |
| 归档不弹确认 | 当前有 tombstone 和恢复路径，属于可逆操作 |
| API Key 明文写入 CLI 配置 | 在现有本地 CLI 威胁模型下属于常见做法 |
| 旧历史默认折叠 | 合理的性能设计；只有“展开后一次挂载全部历史”仍有问题（问题 36） |

---

## 四、建议修复顺序

1. **立即处理数据安全边界**：问题 1（文件撤销）
2. **修复 Hook 根目录判断和作用域泄漏**：问题 2、3、33、34、35
3. **将系统关机状态提升到主进程并支持恢复**：问题 4
4. **把会话持久化从 localStorage 迁出，并给图片输入加限制**：问题 5、6
5. **异步化 `@文件` 搜索**：问题 7
6. **统一跨平台路径、命令和更新包架构选择**：问题 8、9、10、11、12、13、14
7. **建立统一 Dialog/Overlay 管理器，解决焦点、Escape 和无障碍问题**：问题 22、23、24、26、27
8. **再处理插件信任、备份导入、设置原子写入和长会话虚拟化**：问题 28、29、30、31、32、16、17、36、37、38、39

---

## 五、关键证据索引

| 问题 | 关键文件 | 行号 |
| --- | --- | --- |
| 1 | `src/components/chat/ChangeCard.tsx` | ~197 |
| 1 | `electron/projectService.ts` | ~548 |
| 2 | `electron/hookRunner.ts` | 17 |
| 3 | `electron/settingsService.ts` | 131 |
| 4 | `src/components/layout/AppShell.tsx` | 1495 |
| 4 | `electron/main.ts` | 6554 |
| 5 | `src/utils/persistence.ts` | 123 |
| 5 | `src/hooks/useStatePersistence.ts` | 1 |
| 6 | `src/components/chat/Composer.tsx` | 732 |
| 7 | `electron/main.ts` | 3129 |
| 7 | `src/components/chat/Composer.tsx` | 701 |
| 8 | `src/App.tsx` | 146 |
| 8 | `src/utils/additionalWorkDirs.ts` | 1 |
| 8 | `electron/kimiCodeHost.ts` | 1577 |
| 9 | `src/components/layout/SearchOverlay.tsx` | 43 |
| 10 | `electron-builder.yml` | 1 |
| 10 | `electron/main.ts` | 2804 |
| 11 | `src/components/settings/SettingsPanel.tsx` | 2576 |
| 11 | `electron/main.ts` | 2036 |
| 12 | `src/components/layout/DialogSystem.tsx` | 1 |
| 13 | `electron/main.ts` | 3063 |
| 13 | `electron-builder.yml` | 1 |
| 15 | `src/hooks/useSettingsSync.ts` | 1 |
| 16 | `electron/settingsService.ts` | 153 |
| 17 | `electron/longTaskService.ts` | 181 |
| 18 | `src/components/settings/SettingsPanel.tsx` | 1650 |
| 18 | `electron/main.ts` | 1 |
| 19 | `src/components/layout/SearchOverlay.tsx` | 124 |
| 20 | `src/components/layout/SearchOverlay.tsx` | 417 |
| 21 | `src/components/layout/SearchOverlay.tsx` | 378 |
| 22 | `src/hooks/useKeyboardShortcuts.ts` | 1 |
| 22 | `src/components/layout/DialogSystem.tsx` | 1 |
| 23 | `src/App.tsx` | 1126 |
| 24 | `src/components/layout/TopMenuBar.tsx` | 1 |
| 24 | `src/hooks/useKeyboardShortcuts.ts` | 1 |
| 25 | `src/components/layout/AppShell.tsx` | 842 |
| 26 | `src/components/layout/AppShell.tsx` | 862 |
| 27 | `src/components/chat/Composer.tsx` | 2495 |
| 28 | `src/components/layout/SkillsPanel.tsx` | 164 |
| 28 | `electron/main.ts` | 3462 |
| 29 | `src/components/layout/SkillsPanel.tsx` | 272 |
| 29 | `electron/main.ts` | 3189 |
| 31 | `src/utils/sessionBackup.ts` | 1 |
| 31 | `electron/main.ts` | 3007 |
| 32 | `src/utils/sessionBackup.ts` | 1 |
| 33 | `electron/hookRunner.ts` | 1 |
| 34 | `electron/hookRunner.ts` | 1 |
| 35 | `electron/hookRunner.ts` | 1 |
| 36 | `src/components/chat/ChatThread.tsx` | 1807 |
| 37 | `src/components/chat/ChatThread.tsx` | 1807 |
| 38 | `src/App.tsx` | 396 |
| 38 | `electron/main.ts` | 2418 |
| 39 | `src/components/chat/Composer.tsx` | 445 |

---

## 六、后续行动

1. 由产品/负责人确认修复优先级和取舍
2. 对 P0 问题 1 先出修复方案（确认框 + 作用域限制 + 内容校验）
3. 对 P1 数据持久化相关问题（5、6、16、17、31、32）评估迁移 IndexedDB/主进程文件的工期
4. 修复任何问题时同步更新本文档状态列
