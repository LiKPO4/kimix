# Kimix vs Kimi CLI 官方功能缺口分析

> 生成时间：2026-05-24
> 基于 Kimi CLI 文档版本：~0.71+（Wire 协议 1.10）

---

## 一、已完整接入（✅）

### 1. Session 核心生命周期
| 功能 | Kimix 实现 | 说明 |
|------|-----------|------|
| `createSession` + Wire 启动 | `kimi:startSession` | 通过 SDK 创建会话，注入 `--wire` |
| `prompt` / `sendPrompt` | `kimi:sendPrompt` | 发送用户消息，启动 Agent 轮次 |
| `steer` / `steerPrompt` | `kimi:steerPrompt` | 轮次中追加用户输入 |
| `cancel` / `stopTurn` | `kimi:stopTurn` | 停止当前轮次 |
| `closeSession` | `kimi:closeSession` | 关闭会话 |
| `set_plan_mode` | `kimi:setPlanMode` | 切换 Plan 模式 |
| `approve` | `kimi:approveRequest` | 审批请求（approve / approve_for_session / reject） |
| `respondQuestion` | `kimi:respondQuestion` | 响应结构化问答 |
| `replay` / `loadSession` | `kimi:loadSession` | 加载并回放会话历史 |

### 2. 配置与启动参数
| CLI 参数 | Kimix 实现 | 说明 |
|----------|-----------|------|
| `--model` | ✅ | 通过 `model` 传入 |
| `--work-dir` / `-w` | ✅ | 通过 `workDir` 传入 |
| `--add-dir` | ✅ | 通过 `KIMIX_KIMI_ADD_DIRS` 环境变量注入 |
| `--yolo` / `--yes` / `--auto-approve` | ✅ | 通过 `yoloMode` 传入 |
| `--afk` | ✅ | 通过 `KIMIX_KIMI_AFK` 环境变量注入 |
| `--plan` | ✅ | 通过 `planMode` 传入 |
| `--thinking` / `--no-thinking` | ✅ | 通过 `thinking` 传入 |
| `--skills-dir` | ✅ | 通过 `skillsDir` 传入 |
| `--agent-file` | ✅ | 通过 `agentFile` 传入 |
| `--wire` | ✅ | SDK 内部默认使用 |

### 3. CLI 管理
| 功能 | Kimix 实现 | 说明 |
|------|-----------|------|
| `kimi --version` | `kimi:checkCli` | 检查 CLI 版本 |
| CLI 自动安装 | `kimi:installCli` | Windows/Mac/Linux 自动安装脚本 |
| CLI 更新检查 | `kimi:checkCliUpdate` | 从 PyPI 检查版本 |
| CLI 自动更新 | `kimi:updateCli` | `uv tool upgrade` 或重装 |

### 4. SDK 流事件处理（已映射到 Renderer）
- `TurnBegin`, `TurnEnd`
- `ContentPart`（text / think）
- `ToolCall`, `ToolCallPart`, `ToolResult`（含 diff / todo / shell display blocks）
- `SteerInput`
- `ApprovalRequest`, `ApprovalResponse`
- `QuestionRequest`
- `StatusUpdate`（token_usage / context_usage）
- `TurnChanges`（Git 变更统计）
- `HookTriggered`, `HookResolved`
- `CompactionBegin`, `CompactionEnd`
- `SubagentEvent`
- `PlanDisplay`
- `BtwBegin`, `BtwEnd`

### 5. 项目/应用层功能
- 项目打开、目录选择、Git 信息
- 最近项目列表管理
- 文件搜索、文本文件读取
- 技能扫描、启用、导入、Superpowers 安装
- 长程任务（BIGPLAN）管理
- Hooks 规则生成
- 应用设置、更新检查/下载
- 窗口控制（最小化/最大化/缩放/全屏）

---

## 二、SDK 有但 UI / 功能层未暴露（⚠️ 半接入）

以下功能 `@moonshot-ai/kimi-agent-sdk` 已提供 API，但 Kimix 没有在 IPC / Preload / Renderer 层暴露给用户使用。

| SDK API | 功能 | 当前状态 |
|---------|------|---------|
| `login()` | 登录 Kimi 账号（OAuth） | ❌ 未暴露 |
| `logout()` | 登出 Kimi 账号 | ❌ 未暴露 |
| `isLoggedIn()` | 检查登录状态 | ❌ 未暴露 |
| `parseConfig()` | 解析 `~/.kimi/config.toml` | ❌ 未暴露 |
| `saveDefaultModel()` | 保存默认模型配置 | ❌ 未暴露 |
| `getModelById()` / `getModelThinkingMode()` / `isModelThinking()` | 模型信息查询 | ❌ 未暴露 |
| `createKimiPaths()` / `KimiPaths` | Kimi 数据路径管理 | ❌ 未暴露 |
| `getRegisteredWorkDirs()` | 获取注册的工作目录 | ❌ 未暴露 |
| `listSessionsForWorkspace()` | 跨工作目录列会话 | ❌ 未暴露 |
| `deleteSession()` | 删除指定会话 | ❌ 未暴露 |
| `forkSession()` | Fork 会话（从某轮次分支） | ❌ 未暴露 |
| `parseSessionEvents()` | 解析会话事件文件 | ❌ 未暴露 |
| `authMCP()` | MCP OAuth 授权 | ❌ 未暴露 |
| `resetAuthMCP()` | 重置 MCP OAuth | ❌ 未暴露 |
| `testMCP()` | 测试 MCP 服务器连接 | ❌ 未暴露 |
| `createExternalTool()` | 注册自定义外部工具 | ❌ 未暴露 |
| `prompt()` (一次性) | Print 模式单次查询 | ❌ 未暴露 |
| `enableLogs()` / `disableLogs()` / `setLogSink()` | SDK 日志控制 | ❌ 未暴露 |
| `ProtocolClient` Hook 订阅 | Wire Hook 客户端订阅 | ⚠️ 部分（Kimix 用 shell hook，未用 Wire Hook） |

---

## 三、完全未接入（❌）

### 高优先级（建议尽快接入）

#### 1. MCP 管理
| 官方功能 | CLI 命令 | Kimix 状态 | 价值 |
|---------|---------|-----------|------|
| MCP 服务器配置管理 | `kimi mcp add/remove/list/auth/reset-auth/test` | ❌ | 🔥 极高，MCP 是当前扩展生态的核心 |
| MCP 配置文件加载 | `--mcp-config-file`, `--mcp-config` | ❌ | 🔥 极高 |
| 会话中查看 MCP 状态 | `/mcp` 斜杠命令 | ❌ | 高 |

#### 2. 会话生命周期增强
| 官方功能 | CLI 命令 / SDK API | Kimix 状态 | 价值 |
|---------|-------------------|-----------|------|
| 删除会话 | `deleteSession()` | ❌ | 高 |
| Fork 会话（分支） | `forkSession()` | ❌ | 高 |
| 跨工作目录列会话 | `listSessionsForWorkspace()` | ❌ | 中 |
| 继续最近会话 | `--continue` / `-C` | ❌ | 中 |
| 恢复指定会话 | `--session ID` / `--resume ID` | ❌ | 中（有 loadSession 但无恢复并继续运行） |

#### 3. 认证管理
| 官方功能 | CLI 命令 | Kimix 状态 | 价值 |
|---------|---------|-----------|------|
| 登录 | `kimi login` | ❌ | 🔥 高 |
| 登出 | `kimi logout` | ❌ | 🔥 高 |
| 检查登录状态 | `isLoggedIn()` | ❌ | 高 |

#### 4. 信息查询
| 官方功能 | CLI 命令 | Kimix 状态 | 价值 |
|---------|---------|-----------|------|
| CLI 版本/协议信息 | `kimi info [--json]` | ❌ | 低（有 --version 但无协议信息） |
| 查看/设置会话标题 | `/title` | ❌ | 中 |
| 配置读取 | `parseConfig()` | ❌ | 中 |

### 中优先级（有价值但非紧急）

#### 5. 会话导出/导入
| 官方功能 | CLI 命令 | Kimix 状态 | 价值 |
|---------|---------|-----------|------|
| 导出会话为 ZIP | `kimi export [<session_id>] [-o]` | ❌ | 中 |
| 导出会话为 Markdown | `/export` | ❌ | 中 |
| 导入上下文 | `/import <file_path>` / `/import <session_id>` | ❌ | 中 |

#### 6. 运行时控制
| 官方功能 | CLI 命令 | Kimix 状态 | 价值 |
|---------|---------|-----------|------|
| 手动压缩上下文 | `/compact` | ❌ | 中 |
| 清空上下文 | `/clear` / `/reset` | ❌ | 低 |
| 设置外部编辑器 | `/editor` | ❌ | 低 |
| 重新加载配置 | `/reload` | ❌ | 低 |
| 调试信息 | `/debug` | ❌ | 低 |

#### 7. 主题与模型
| 官方功能 | CLI 命令 | Kimix 状态 | 价值 |
|---------|---------|-----------|------|
| 切换主题 | `/theme dark/light` | ❌ | 低 |
| 切换模型（交互式） | `/model` | ❌ | 中（Kimix 有 model 参数但无交互式切换） |

### 低优先级（Kimix 作为 GUI 替代，很多不需要）

#### 8. 子命令（与 Kimix 定位重叠或不需要）
| 官方功能 | CLI 命令 | Kimix 状态 | 说明 |
|---------|---------|-----------|------|
| ACP 服务器 | `kimi acp` | ❌ | Kimix 本身就是 GUI 客户端，不需要 ACP |
| Toad 终端 UI | `kimi term` | ❌ | Kimix 已经是 GUI，不需要终端 UI |
| Web UI 服务器 | `kimi web` | ❌ | Kimix 本身就是 Web UI 的桌面封装 |
| Agent Tracing Visualizer | `kimi vis` | ❌ | 技术预览，可视化追踪 |
| 插件管理 | `kimi plugin` | ❌ | Beta 功能 |

#### 9. Print 模式（非交互式）
| 官方功能 | CLI 参数 | Kimix 状态 | 说明 |
|---------|---------|-----------|------|
| Print 模式 | `--print` | ❌ | 非交互式，适合脚本 |
| Quiet 模式 | `--quiet` | ❌ | `--print --output-format text --final-message-only` |
| JSON 输入/输出 | `--input-format`, `--output-format` | ❌ | 程序化集成 |
| 仅输出最终结果 | `--final-message-only` | ❌ | 配合 Print 模式 |
| 单次查询 | `--prompt` / `--command` | ❌ | 不进入交互模式 |

#### 10. 循环控制
| 官方功能 | CLI 参数 | Kimix 状态 | 说明 |
|---------|---------|-----------|------|
| 单轮最大步数 | `--max-steps-per-turn` | ❌ | 覆盖配置文件 |
| 单步最大重试 | `--max-retries-per-step` | ❌ | 覆盖配置文件 |
| Ralph 循环 | `--max-ralph-iterations` | ❌ | 实验性功能 |

#### 11. 其他 CLI 参数
| 官方功能 | CLI 参数 | Kimix 状态 | 说明 |
|---------|---------|-----------|------|
| 详细日志 | `--verbose` | ❌ | 输出详细运行信息 |
| 调试日志 | `--debug` | ❌ | 记录到 `~/.kimi/logs/kimi.log` |
| 内置 Agent | `--agent NAME` (default/okabe) | ❌ | 与 `--agent-file` 互斥 |
| 配置字符串 | `--config STRING` | ❌ | TOML/JSON |
| 配置文件 | `--config-file PATH` | ❌ | 覆盖默认 `~/.kimi/config.toml` |

#### 12. 斜杠命令（Shell 模式特有，Kimix 不需要）
- `/help`, `/version`, `/changelog`, `/feedback`
- `/new`, `/sessions`, `/undo`, `/fork`
- `/skill:<name>`, `/flow:<name>`
- `/init`
- `/task`（后台任务浏览器）
- `/web`, `/vis`
- `/btw`（侧问——但 Wire 有 `BtwBegin`/`BtwEnd` 事件）

---

## 四、接入优先级建议

### P0 — 马上做（对 Kimix 价值极高）

1. **MCP 管理面板**
   - 在设置中增加 MCP 服务器配置页面
   - 接入 `authMCP`, `resetAuthMCP`, `testMCP`
   - 显示已配置 MCP 服务器连接状态
   - 这是目前社区最热需求，直接扩展 AI 能力边界

2. **登录/认证管理**
   - 接入 `login()`, `logout()`, `isLoggedIn()`
   - 在 Sidebar 或 Settings 中显示登录状态
   - 未登录时引导用户登录

### P1 — 近期做（提升基础体验）

3. **会话管理增强**
   - 接入 `deleteSession()` — 删除历史会话
   - 接入 `forkSession()` — 从某轮次分支会话
   - 接入 `listSessionsForWorkspace()` — 跨目录查看会话
   - 会话标题查看/设置 (`/title`)

4. **kimi info**
   - 接入 `kimi info --json`
   - 在设置中显示 CLI 版本、Wire 协议版本、Python 版本

### P2 — 有空做（锦上添花）

5. **会话导出/导入**
   - 接入 `kimi export` / `/export`
   - 接入 `/import`

6. **模型管理**
   - 接入 `parseConfig()`, `saveDefaultModel()`
   - 交互式模型切换

7. **日志控制**
   - 接入 `enableLogs()` / `disableLogs()` / `setLogSink()`
   - 方便排查 SDK 问题

### P3 — 暂不做（与 Kimix 定位重叠）

8. `kimi acp`, `kimi term`, `kimi web`, `kimi vis`
9. Print 模式相关（`--print`, `--quiet`, `--prompt`）
10. 终端主题切换（`/theme`）
11. 外部编辑器设置（`/editor`）
12. 插件管理（`kimi plugin`）

---

## 五、关键文件对照

| 功能 | Kimix 实现文件 | 官方 CLI 对应 |
|------|--------------|--------------|
| Session 核心 | `electron/kimiBridge.ts` | `kimi --wire` |
| Session IPC | `electron/main.ts` (~2470 行起) | SDK `createSession` |
| 事件映射 | `src/utils/eventMapper.ts` | Wire `event` |
| 项目服务 | `electron/projectService.ts` | 文件系统工具 |
| 长程任务 | `electron/longTaskService.ts` | 子 Agent |
| Hooks | `electron/main.ts` (~2359 行起) | `hooks:generateRule` + shell exec |
| MCP | ❌ 无 | `kimi mcp` |
| 认证 | ❌ 无 | `kimi login/logout` |
