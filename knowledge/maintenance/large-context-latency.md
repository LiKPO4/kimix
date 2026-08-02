---
type: Concept
title: Large-Context Session Latency Runbook
description: Diagnosing "model responds after a minute / stalls mid-turn" reports — how to prove with wire.jsonl timing data that the bottleneck is giant context times provider round-trip, not Kimix's own pipeline.
tags: [performance, latency, context, compaction, runbook, kimi-code]
timestamp: "2026-08-02T22:00:00+08:00"
---

# Large-Context Session Latency Runbook

Reports like "the model takes ~1 minute to respond and stalls mid-turn" are usually not a Kimix pipeline defect. Prove it with the session's own `wire.jsonl` before touching renderer code.

# Measurement Recipe

1. Locate the session wire: `~/.kimi-code/sessions/wd_<project>_<hash>/session_<id>/agents/main/wire.jsonl` (Windows user home; honor `KIMI_CODE_HOME`).
2. Parse timed events and compute three gaps per turn:
   - `turn.prompt → llm.request`: Kimix/SDK pre-prompt overhead. Healthy value is ~0 s.
   - `llm.request → first context.append_loop_event(content.part)`: provider time-to-first-token (TTFT). This is where user-perceived waiting lives.
   - `tool.result → next llm.request`: tool-loop overhead. Healthy value is ~0 s.
3. Read `usage.record` for per-step `inputOther + inputCacheRead + inputCacheCreation` (total context tokens) and `llm.request` for `messageCount`, `thinkingEffort`, `maxTokens`, `provider`, `model`.
4. Check `full_compaction.*` events to see whether compaction ran, completed, or was cancelled.

# 2026-08-02 Verified Baseline (grok-4.5 via third-party openai-compatible relay)

- Kimix pipeline overhead was 0 s on every measured turn (prompt and llm.request share the same second).
- TTFT ranged 17–123 s (median ~23 s) while per-step input was ~400k–786k tokens across 459+ messages with `thinking=high` and `maxTokens=65536`.
- A completed manual compaction halved context (~786k → ~400k); auto compactions were cancelled by turn boundaries.
- Renderer silence logs (`[live] silence` in `diag.log`) show thinking deltas still streaming during "stalls" — the turn is alive, just slow.

# Remediation Order

1. Compact the session (manual compaction works; auto compaction is cancelled when a turn interrupts it) or start/fork a fresh session once context passes a few hundred thousand tokens.
2. Lower thinking effort and `maxTokens` for relay providers — long thinking inflates TTFT before any visible token.
3. Do not add renderer-side fixes (progress spinners, re-renders, reconciliation changes) for this class of report; they cannot reduce provider TTFT and they add risk to the event pipeline.

# Sources

- Session wire analysis for `session_336f7ae6-2570-4b6e-924f-cb49500ba901` (2026-08-02), method preserved in `TASK_STATE.md` entry of the same date.
- Related event-pipeline evidence method: [/architecture/runtime-routing.md](/architecture/runtime-routing.md).
