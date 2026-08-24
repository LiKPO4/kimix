# 用户图片占位符事件快照

## 问题样本

- 会话：`session_4ed631a2-9f51-4e8b-82d0-0fd04b78e0f3`
- 原始记录：官方 Kimi Code `agents/main/wire.jsonl` 第 10 行
- 事件：`turn.prompt`
- agent scope：`main`
- 时间戳：`1787541924975`
- 输入：3 个 content part，依次为 1 个 text（长度 12529）和 2 个 `image_url`
- 两个图片 URL 均为独立的 `kimi-file://<file-id>` 引用；原始 text part 末尾没有 `[图片]`

随后第 11 行的 `context.append_message` 仍保留同样的 `text + image_url + image_url` 结构。这证明官方协议把图片作为结构化 content part 保存，而不是向用户正文追加占位文本。

## Kimix 协议投影

Server 历史快照会把已上传图片表示为以下等价形态：

```json
[
  { "type": "text", "text": "<用户原文>" },
  { "type": "image", "source": { "kind": "file", "file_id": "file-image-1" } },
  { "type": "image", "source": { "kind": "file", "file_id": "file-image-2" } }
]
```

修复前 `extractUserMessage()` 对每个没有 base64/data URL 的 image part 同时执行：

1. 向 `images` 添加结构化附件；
2. 向 `textParts` 添加一行 `[图片]`。

因此 UI 层收到的 `user_message` 投影为：

```json
{
  "type": "user_message",
  "content": "<用户原文>\n[图片]\n[图片]",
  "images": ["<image-1>", "<image-2>"]
}
```

`MessageBubble` 直接渲染 `event.content`，所以两个由 Kimix 人工生成的占位符出现在正文末尾；它们不来自模型、官方协议或 Markdown 渲染器。

## 修复边界

只取消结构化 image part 到正文占位符的二次投影，保留 `images` 附件数组。不要全局替换用户真实输入中的 `[图片]`，也不要改动无视觉模型使用的具名降级文本 `[图片: 文件名]`。
