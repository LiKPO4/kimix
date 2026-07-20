# Kimi Code 0.28.0 跟进记录

日期：2026-07-20  
本机 CLI：`kimi --version` → `0.28.0`  
当前 vendored SDK：`0.28.0` / commit `a05228c6`（node-sdk 0.13.4，2026-07-20 已重打）

## 官方变更摘要（对照）

| 项 | 上游变更 | Kimix 影响 | 本轮处理 |
|---|---|---|---|
| `#1826` Server 命令树 | `kimi server …` 废弃并 exit 1；前台入口改为 `kimi web`；同 home 可多实例占下一空闲端口；`kimi web kill/ps/rotate-token` | **P0**：managed 启动与多实例端口 | **已修**：`web --no-open` + `server/instances` 发现 + 端口递增 |
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
- 打开官方 Web UI 的 `kimi-code:openWebServer` 本来就走 `kimi web`，无断代

### 多实例端口（已做）

0.28 注册表：`~/.kimi-code/server/instances/*.json`（字段含 `server_id/pid/host/port/started_at/heartbeat_at/host_version`），并兼容旧 `server/lock`。

启动顺序：

1. 探测配置 endpoint（默认 `127.0.0.1:58627` 或 env）
2. 读取 instances + legacy lock，优先 **配置端口** 的健康实例，否则 **启动最早** 的健康实例并 attach
3. 若无可 attach：从偏好端口起最多 20 个端口，先 probe 再 `kimi web --no-open --port N` spawn
4. 成功后把 `status.endpoint` 写成实际端口

未做（运维向）：桌面 UI 接入 `kimi web kill/ps/rotate-token`。

## P1 权限文案（已做）

官方语义（0.28）：

- **YOLO / 完全访问**：自动批准工具操作，Agent **仍可能提问**
- **Auto / 自动权限**：完全自主，**不再向用户提问**

已同步：

- `src/components/chat/Composer.tsx`
- `src/components/settings/SettingsPanel.tsx`
- `src/components/chat/AddRoomAgentDialog.tsx`

底层 `manual` / `auto` / `yolo` 枚举与 Server `permission_mode` 映射不变。

## P1 vendored SDK → 0.28（已做）

1. tag `@moonshot-ai/kimi-code@0.28.0` / commit `a05228c6` 重打 `vendor/kimi-code-sdk`
2. MCP 4s startup 补丁仍在（`KIMIX_KIMI_CODE_MCP_STARTUP_TIMEOUT_MS`）
3. bundle 回归：中断工具补齐、FetchURL 安全跳转、vendor bundle 测试
4. README + knowledge 不变量 39 已更新

可选后续：完整 `probe-kimi-code-server.mjs` / subagent / host 冒烟（需本机无冲突 Server 窗口时跑）。

## P2 观察项

1. **Thinking effort 顶档不持久化**：切换到模型 max 后重启会话，UI 是否被官方 status 拉回次高档
2. **模型切换失效 cache**：底部模型菜单可加 cache 失效提示
3. **rotate-token**：旋转 token 后是否需强制重连 WS

## 验证

- 本机 `kimi server run …` → exit 1 + deprecation（对照）
- `kimi web --help` 含 `kill` / `ps` / `rotate-token` / `--no-open`
- 单元：`buildManagedKimiServerArgs`、instances 解析、端口递增、vendor 0.28 bundle
- 全量 106 文件 917 项；typecheck；OKF

## 回滚

- Server 启动/多实例：revert `electron/kimiCodeServerHost.ts`
- SDK：恢复上一版 `vendor/kimi-code-sdk`
- 文案：revert 三处 permission 字符串
