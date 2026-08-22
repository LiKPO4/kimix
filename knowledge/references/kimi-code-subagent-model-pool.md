---
type: Standard
title: Kimi Code Subagent Model Pool
description: Pinned facts about the official declarative subagent model pool ([secondary_model] config), its validation rules, and Kimix integration caveats through 0.38.0.
tags: [kimi-code, secondary-model, subagent, config, upstream]
timestamp: "2026-08-22T17:35:00+08:00"
---

# Kimi Code Subagent Model Pool

Official Kimi Code 0.36.0 (PR #2700) replaces the experimental single secondary model with a declarative subagent model pool. Facts below are pinned from the merged PR; verify against the official config docs before relying on them for new work.

## Config Shape (`config.toml`)

- `[secondary_model]` owns the pool. `default_model` picks the spawn model when the caller passes none; a pool-less `default_model` forms an implicit single-entry pool.
- `[secondary_model.models]` maps `[models]` alias ids to selection hints (description text) rendered into the Agent/AgentSwarm tool `model` parameter description, so the main agent picks per spawn.
- `force = true` removes the per-spawn choice entirely: the tools stop advertising `model`, every spawn binds `default_model`, and explicit choices (including `primary`) are rejected. Requires `default_model` and forbids a `models` table. When a `models` table exists, `default_model` is required and MUST be a pool key — a pool-less or out-of-pool default fails validation for every session lifecycle.
- `primary` is a reserved alias for the caller's own model; only it inherits the caller's thinking level. A pool-bound spawn carries NO thinking level from the pool — v2 `resolveSubagentBinding` returns only the alias, so the subagent's effort comes from that alias's own `default_effort` in `[models.<alias>]`. Kimix exposes this as a per-entry thinking select in the pool editor (v2.21.69, `kimi:setModelDefaultEffort`), which is the same mechanism the official web UI's combined model·effort picker uses.
- Gated by the `secondary-model` experiment (`KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL=1` or the master flag). With the flag off, pool keys stay inert and spawns inherit the caller's model. The v1 engine ignores the keys at runtime but round-trips them in config.

## Runtime Mechanics

- The Agent/AgentSwarm `model` tool parameter becomes a free-form alias string, stripped entirely when no pool is configured. Descriptions are caller-aware: `primary (alias) [main model]`, with `[default]` marking the pool default.
- Validation fails fast with CONFIG_INVALID at session create/resume/fork (lifecycle preflight plus a Session-scope backstop) on a missing/invalid `default_model` or unresolvable pool alias. A broken pool therefore blocks ALL session lifecycles, not just spawns.
- Cascade protection (`cascadeSubagentModelPool`): provider deletion/rename, model-table rewrites, and background catalog refreshes filter dangling pool entries and drop the section when its effective default dangles. Kimix's own provider/model deletion UI must apply the same cascade or users end up with a config that refuses every session.
- SDK contract carries the pool on the `secondaryModel` field; kap-server `/api/v1/config` reads/writes it directly. TUI command `/secondary-model` (alias `/subagent-model`).
- The intermediate `[subagent]`-section keys from PR drafts never shipped; no migration path exists or is needed.

## Kimix Integration Notes

- Kimix already injects `KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL=1` for managed Servers and wires the pre-pool single secondary model (`saveKimiSecondaryModel`). Since v2.21.66 the settings Subagents page carries a pool editor (default model, force lock, alias+hint entries) writing `[secondary_model]` directly; provider/model deletion in Kimix applies the official cascade semantics (filter dangling entries, drop the section when its effective default dangles) so a broken pool can never block every session lifecycle.
- The vendored SDK first moved to the 0.36.0 tag in v2.21.68 (`b6144f94`, node-sdk 0.17.0), making the pool live. It advanced to the official 0.38.0 tag in v2.21.101 (`0999454b`, node-sdk 0.19.1); the pool contract remains active alongside the newer prompt-id, multi-Skill, and unified MCP registry behavior.

# Sources

- [PR #2700: replace the secondary-model experiment with a declarative subagent model pool](https://github.com/MoonshotAI/kimi-code/pull/2700)
- [Release @moonshot-ai/kimi-code@0.36.0](https://github.com/MoonshotAI/kimi-code/releases/tag/%40moonshot-ai%2Fkimi-code%400.36.0)
- [Release @moonshot-ai/kimi-code@0.38.0](https://github.com/MoonshotAI/kimi-code/releases/tag/%40moonshot-ai%2Fkimi-code%400.38.0)
