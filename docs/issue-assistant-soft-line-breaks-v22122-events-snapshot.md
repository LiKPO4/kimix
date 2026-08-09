# v2.21.22 Assistant 单换行折叠：事件快照

## 现场

- UI 版本：`v2.21.21`
- Server 会话：`session_92f64e31-f132-4c3a-b39e-8bee8b00269f`
- 官方消息：`msg_session_92f64e31-f132-4c3a-b39e-8bee8b00269f_000007`

## 主进程与落库

用户明确要求“一行两句”。官方 `/messages` 中 Assistant 已正确落库为一个 text part、162 字、12 个换行：标题后空一行，随后每一行都是两句诗。主进程 `[live] display` 最终投影同为 162 字，证明 Provider、Server、完成回放和事件合并均未删除换行。

## UI 投影

截图中的标题仍单独成段（双换行形成 paragraph），11 行诗却视觉合并为一段。`MarkdownRenderer` 的流式 plain 路径已经将普通正文单换行转为 `<br>`；settled/rich ReactMarkdown 只有 `remark-gfm` 与 `remark-math`，CommonMark 把 paragraph 内 soft break 折叠为空格。红灯测试对同一两行 fixture 查询不到任何 `<br>`，稳定复现该差异。

## 修复不变量

- Assistant 普通文本节点中的源单换行必须成为视觉换行，streaming 与 settled 结果一致。
- 不使用容器级 `white-space: pre-wrap`；ReactMarkdown 生成的段落和 loose list 分隔空白不能叠加成视觉空行。
- 只转换 mdast `text` 节点；fenced/inline code、表格、列表结构和段落边界保留原生 Markdown 语义。
