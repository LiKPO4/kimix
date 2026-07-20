# 性能基线：流式输出时滚动（Phase 0）

> 日期：2026-07-20  
> 构建：开发机 production 对比请在 PR-A1 落地后补录  
> 说明：本文件先记录**改前机制基线**与埋点约定；完整 Performance 数字需在生产 build 上对同一会话复测后填入下表。

## 操作路径（固定）

1. 打开 ≥30 轮、含多工具调用的长会话  
2. 贴底跟随，让 Agent 持续输出约 30s  
3. 向上滚动阅读历史约 30s（保持不贴底）  
4. 回到底部恢复跟随  

## 改前机制基线（代码核验，非 Profiler 数字）

| 项 | 改前 |
|----|------|
| 事件 flush | 固定 80ms |
| 流式 Markdown | 全量 remark-gfm + math + katex + highlight |
| 流式分块 | 全文 `Lexer.lex` |
| 滚动活跃信号 | 仅时间戳分散让路，无统一 `isUserScrollActive` |
| 导航轨 measure | 每次 ChatThread 重渲都 schedule（无依赖 layoutEffect） |
| 历史轮 completed cache | 投影 spread 导致引用失效（A4 后续修） |

## 埋点开关

- `localStorage.kimix_perf_diag = "1"`：开启计数  
- `localStorage.kimix_streaming_plain_markdown = "0"`：关闭流式轻 Markdown  
- `localStorage.kimix_scroll_yield = "0"`：关闭滚动让路增强  

读取：`getPerfDiagSnapshot()`（devtools 控制台可调）。

## 改后复测表（待填）

| 指标 | 基线 | PR-A1 后 |
|------|------|----------|
| 上滚 30s 期间 scrollTop 程序写入 |  |  |
| 流式路径是否含 katex/hljs | 是 | 否（plain） |
| 体感滚动跟手 | 卡 |  |

## 结论

PR-A1 先交付机制侧可观测改动；完整数字对照在用户/开发者生产 build 复测后回填本文件。
