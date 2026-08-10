# 旧会话切换模型后消息头仍显示旧模型：事件与渲染快照

日期：2026-08-10

## 现场

- 用户打开旧会话后，把当前模型从 `k3` 切换为 `qwen3.8-max`。
- 底部模型选择器显示 `qwen3.8-max`，新一轮过程头却显示 `k3 · 等待模型输出`。
- 该状态发生在正文输出前，属于本轮占位 Assistant 的消息头投影，不是历史正文回放。

## 主进程事件路径

`electron/kimiCodeHost.ts` 的 `sendPrompt` 将 Renderer 传入的 `expectedModel` 解析为本轮
不可变 `promptModel`，必要时先执行 `setModel`，随后在真正 prompt 前发出：

```text
kimix.turn.model { model: "qwen3.8-max", phase: "dispatch" }
```

因此 Host 的本轮模型意图是新模型；错误发生在 dispatch 信号到达前的空占位窗口，以及
Renderer 对主 Agent 名称和本轮模型的优先级判断。

## UI events / renderItems 最小快照

```json
{
  "primaryAgent": { "displayName": "k3", "modelAlias": "qwen3.8-max" },
  "assistant": { "type": "assistant_message", "content": "", "model": "qwen3.8-max", "isComplete": false },
  "oldHeaderProjection": "k3",
  "expectedHeaderProjection": "qwen3.8-max"
}
```

旧会话转成 collaboration state 时，主 Agent 的 `displayName` 由当时模型生成并持久化；
后续模型切换只更新 `modelAlias`，不会改用户可编辑的 Agent 名。旧
`resolveTurnHeaderModelName` 看到 `displayName !== compact(modelAlias)` 后，把旧 `k3`
误判为自定义身份并压过本轮 `assistant.model`。

## 修复边界

1. 主 Agent 过程头以本轮 `assistant.model` 为权威；历史轮仍显示各自的 turn model。
2. 次级 Agent 的自定义名称仍是身份，不被模型名替换。
3. 正常发送与本地排队补发在创建空占位 Assistant 时立即冻结所选模型，消除 Host
   dispatch 信号到达前的旧名称闪现窗口。
