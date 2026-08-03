# 快照：跨客户端同步多轮合并、用户消息只剩最早一条（2026-08-03）

## 现象

Kimi Code Web 与 Kimix 同时运行同一会话时，Kimix 把多轮内容混合到一轮渲染，用户消息只显示最早的一条。用户截图（安装版 v2.20.159 侧栏）：会话仅一条用户气泡「快速全面了解一下当前项目，注意用子智能体探索」，后续第二轮的 thinking/工具调用/正文全部无边界地串在同一流程里。

## 证据

1. **静态代码路径（三处独立复核一致）**：实时帧入口 `src/App.tsx:2644` 调 `mapKimiCodeEvent`（`src/utils/kimiCodeEventMapper.ts:385-762`），switch 无 `TurnBegin` case，落 `default: return null`（759-760）→ `App.tsx:2645 if (!mapped) return` 静默丢弃。`turn.started` 同样在 398-399 行返回 null。
2. **对比历史路径**：`mapStreamEvent`（`src/utils/eventMapper.ts:1566-1603`）有 `TurnBegin → user_message` 映射——只有整载官方历史才看得到 user 边界；实时同步路径没有。
3. **渲染分组**：`ChatThread.tsx:1310-1334` 中 `user_message` 是唯一硬 turn 边界（agentTurnId 软边界对同步事件无效——`flattenServerEvent` 不注入 turnId）。user 边界缺失 → 后续所有轮次事件累积进同一个 turnBody。
4. **live IndexedDB 导出（CDP 127.0.0.1:9222，dev 实例）**：当前会话 `session_c0197cc1-…-e8d14aa0` 共 136 事件、`user_message` 2 条（12:22:16「快速全面了解…」、12:28:59「有时候不是消息处理中…」）——本地发送的消息经乐观回显存在；而截图实例（另一客户端，经实时同步接收）只剩最早一条，证实丢失发生在同步映射层而非渲染分组层。
5. **diag.log**：帧诊断只记录 assistant.delta / turn.ended / prompt.completed 类型，无 TurnBegin 记录（logger 不覆盖该类型，非证据缺失）。

## 根因

设计假设「user 消息永远由本地发送方乐观回显」在跨客户端场景断链：web 端（或另一客户端）发起的轮次，其 user 消息唯一实时载体是 Server 快照/回放帧里的 `TurnBegin`（`electron/kimiCodeServerClient.ts:2126-2141`，history 消息）与 `turn.started`（in-flight 消息，2138-2140），两者在渲染层映射器均被丢弃 → 无 turn 边界 → 多轮合并 + 用户消息只剩最早一条（本地发的那条）。

## 次要风险（同族）

- `mergeEvents` 的 identity-less 10 秒同内容去重（`eventMapper.ts:1981-2008`）可误杀快速连续相同内容消息。
- in-flight 轮次（turn.started）与完成后 TurnBegin 回放之间的去重依赖稳定身份（snapshotMessageId），修复时必须对齐，否则长轮次会重复出气泡。

## 修复方向

`mapKimiCodeEvent` 增加 `TurnBegin`（及携带 user_input 的 `turn.started`）→ `user_message` 映射，用 snapshotMessageId 生成稳定 id 以对齐 mergeEvents 去重语义；最小复现单测先行。
