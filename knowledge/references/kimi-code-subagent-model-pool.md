---
type: Standard
title: Kimi Code Subagent Model Pool
description: Pinned facts about the official 0.36.0 declarative subagent model pool ([secondary_model] config), its validation rules, and Kimix integration caveats.
tags: [kimi-code, secondary-model, subagent, config, upstream]
timestamp: "2026-08-13T16:15:00+08:00"
---

# Kimi Code Subagent Model Pool

Official Kimi Code 0.36.0 (PR #2700) replaces the experimental single secondary model with a declarative subagent model pool. Facts below are pinned from the merged PR; verify against the official config docs before relying on them for new work.

## Config Shape (`config.toml`)

- `[secondary_model]` owns the pool. `default_model` picks the spawn model when the caller passes none; a pool-less `default_model` forms an implicit single-entry pool.
- `[secondary_model.models]` maps `[models]` alias ids to selection hints (description text) rendered into the Agent/AgentSwarm tool `model` parameter description, so the main agent picks per spawn.
- `force = true` removes the per-spawn choice entirely: the tools stop advertising `model`, every spawn binds `default_model`, and explicit choices (including `primary`) are rejected. Requires `default_model` and forbids a `models` table.
- `primary` is a reserved alias for the caller's own model; only it inherits the caller's thinking level. Pool entries can be per-alias thinking variants via `default_effort` overrides.
- Gated by the `secondary-model` experiment (`KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL=1` or the master flag). With the flag off, pool keys stay inert and spawns inherit the caller's model. The v1 engine ignores the keys at runtime but round-trips them in config.

## Runtime Mechanics

- The Agent/AgentSwarm `model` tool parameter becomes a free-form alias string, stripped entirely when no pool is configured. Descriptions are caller-aware: `primary (alias) [main model]`, with `[default]` marking the pool default.
- Validation fails fast with CONFIG_INVALID at session create/resume/fork (lifecycle preflight plus a Session-scope backstop) on a missing/invalid `default_model` or unresolvable pool alias. A broken pool therefore blocks ALL session lifecycles, not just spawns.
- Cascade protection (`cascadeSubagentModelPool`): provider deletion/rename, model-table rewrites, and background catalog refreshes filter dangling pool entries and drop the section when its effective default dangles. Kimix's own provider/model deletion UI must apply the same cascade or users end up with a config that refuses every session.
- SDK contract carries the pool on the `secondaryModel` field; kap-server `/api/v1/config` reads/writes it directly. TUI command `/secondary-model` (alias `/subagent-model`).
- The intermediate `[subagent]`-section keys from PR drafts never shipped; no migration path exists or is needed.

## Kimix Integration Notes

- Kimix already injects `KIMI_CODE_EXPERIMENTAL_SECONDARY_MODEL=1` for managed Servers and wires the pre-pool single secondary model (`saveKimiSecondaryModel`). The pool is the feature's shipped form; a pool editor UI (alias + hint + default + force) is the natural upgrade for the settings secondary-model field.
- Requires the vendored SDK bump to the 0.36.0 tag; the bump also picks up the strict-OpenAI-compatible interrupted-thinking 400 fix (#2819) and the plugin-root Markdown skill misidentification fix (#2847).

# Sources

- [PR #2700: replace the secondary-model experiment with a declarative subagent model pool](https://github.com/MoonshotAI/kimi-code/pull/2700)
- [Release @moonshot-ai/kimi-code@0.36.0](https://github.com/MoonshotAI/kimi-code/releases/tag/%40moonshot-ai%2Fkimi-code%400.36.0)
