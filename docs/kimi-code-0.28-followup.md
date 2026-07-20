# Kimi Code 0.28.0 跟进记录

日期：2026-07-20  
本机 CLI：`kimi --version` → `0.28.0`  
当前 vendored SDK：仍钉在 `0.27.0` / commit `5cc1949`（node-sdk 0.13.4）

## 官方变更摘要（对照）

| 项 | 上游变更 | Kimix 影响 | 本轮处理 |
|---|---|---|---|
| `#1826` Server 命令树 | `kimi server …` 废弃并 exit 1；前台入口改为 `kimi web`；同 home 可多实例占下一空闲端口；`kimi web kill/ps/rotate-token` | **P0**：`KimiCodeServerHost` managed 启动仍 spawn `server run --foreground`，在 0.28 上必失败并整路 SDK fallback | **已修**：改为 `web --no-open --port …` |
| `#1933` Thinking effort | 仅持久化低于模型最高档（max）的 effort | 观察：Kimix 只转发 `setThinking(level)`，不自建 effort 持久层；重启后顶档可能被上游吞掉 | 文档记录，暂不改代码 |
| `#1867` YOLO / Auto 文案 | YOLO=自动批工具但仍可提问；Auto=完全自主不再提问 | Composer / 设置 / 加 Agent 弹窗文案与官方语义相反或含糊 | **已修**文案 |
| `#1843` AGENTS.md 符号链接 | Web 后端加载 AGENTS.md / 读文件时跟进 symlink | Kimix 自己读 AGENTS.md 走 Node `readFile`（默认跟随链接）；主路径依赖官方 Server | **无需 Kimix 改** |
| `#1940` 模型/思考切换缓存提示 | Web 模型切换器提示会失效 prompt cache | Kimix 模型菜单无此说明 | P2：可选 tooltip，未做 |
| Patch MCP afk→auto | 内置 skill 文案 | Kimix 产品面已无 afk | **无需** |

## P0 详情：managed Server 启动

### 根因

`electron/kimiCodeServerHost.ts` 在无可用 attach 实例时：

```text
spawn(kimi, ["server", "run", "--foreground", "--port", port, ...])
```

0.28 实测：

```text
`kimi server` has been deprecated and no longer works.
Use `kimi web` instead …
exit=1
```

结果：冷启动无法拉起官方 Server → 能力门失败 → 永久/长期 SDK fallback，丢失 Server 优先路由。

### 修复

- 新增 `buildManagedKimiServerArgs(port)` → `["web", "--no-open", "--port", port, "--log-level", "warn"]`
- attach 既有 lock 实例逻辑保留（0.28 仍可用；多实例时优先连锁上的健康实例）
- 打开官方 Web UI 的 `kimi-code:openWebServer` 本来就走 `kimi web`，无断代

### 未做（后续）

- 多实例“下一空闲端口”策略：Kimix 仍偏好固定 `58627` / env 指定端口；端口占用时的自动换端口未做
- `kimi web kill` / `ps` / `rotate-token` 未接入桌面 UI（运维向）
- lock 文件 schema 若 0.28 有多实例字段扩展，需再探针确认

## P1 权限文案（已做）

官方语义（0.28）：

- **YOLO / 完全访问**：自动批准工具操作，Agent **仍可能提问**
- **Auto / 自动权限**：完全自主，**不再向用户提问**

已同步：

- `src/components/chat/Composer.tsx`
- `src/components/settings/SettingsPanel.tsx`
- `src/components/chat/AddRoomAgentDialog.tsx`

底层 `manual` / `auto` / `yolo` 枚举与 Server `permission_mode` 映射不变。

## P1 未做：vendored SDK → 0.28

惯例完整升级仍需：

1. 从 tag `@moonshot-ai/kimi-code@0.28.0` 重打 `vendor/kimi-code-sdk`
2. 保留 MCP 4s startup 补丁
3. 跑 `scripts/probe-kimi-code-server.mjs` + subagent 探针
4. 宿主 turn / cancel / skill 冒烟
5. 更新 `vendor/kimi-code-sdk/README.md` 与 knowledge 不变量 39

本轮只修 **CLI Server 启动断代** 与 **权限文案**，不阻塞在 SDK 重打包。

## P2 观察项

1. **Thinking effort 顶档不持久化**：切换到模型 max 后重启会话，UI 是否被官方 status 拉回次高档；若用户抱怨再做 status 对齐或提示
2. **模型切换失效 cache**：底部模型菜单可加一句“切换模型或思考强度会使当前 prompt cache 失效”
3. **多实例 home**：Kimix 与用户手动 `kimi web` 并存时的端口/token 选择策略
4. **rotate-token**：用户旋转 token 后 Kimix 需重读 `server.token` 并重连 WS（现有读文件逻辑大多即时；需确认缓存）

## 验证

- 本机 `kimi server run …` → exit 1 + deprecation（对照）
- `kimi web --help` 含 `kill` / `ps` / `rotate-token` / `--no-open`
- 单元：`buildManagedKimiServerArgs` 回归
- 全量测试 / typecheck（见本轮 commit 说明）

## 回滚

- Server 启动：恢复 `server run --foreground` 即可（仅适用于 ≤0.27）
- 文案：revert 三处 permission 字符串
