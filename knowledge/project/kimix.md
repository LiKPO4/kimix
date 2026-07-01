---
type: Product
title: Kimix
description: Codex-style Electron desktop interface that exposes official Kimi Code capabilities through a project-aware graphical workflow.
resource: https://github.com/LiKPO4/kimix
tags: [kimix, electron, kimi-code, desktop]
timestamp: "2026-07-01T22:45:00+08:00"
---

# Kimix

Kimix is an Electron application with a React renderer and a Node-based main process. It provides project-aware conversations, streamed Markdown, approval and question cards, session history, local Skills, MCP visibility, and cross-platform packaging.

# Boundaries

* The renderer lives under `src/` and communicates with privileged capabilities through the preload bridge.
* The Electron main process lives under `electron/` and owns filesystem, settings, session, runtime, and IPC integration.
* Kimi Code is the authoritative agent runtime. Kimix presents and adapts its APIs; it does not define a second agent protocol.
* Assistant process rendering preserves the official step timeline. Local wire history must retain `tool.call` and `tool.result` nested inside `context.append_loop_event`; thinking parts before and after those calls remain separate phases, a think part sharing the tool timestamp is ordered before that tool, and each collapsed phase uses its final natural paragraph as the summary title.
* Persisted Kimi history carries a Kimix mapping-version marker. When the mapping changes, the active or selected stale cache is reloaded once from official history and replaced when the canonical timeline contains richer process events; non-empty cached messages alone must not permanently block history repair.
* Chat auto-follow distinguishes browser scroll events from user intent. Content shrink, history replacement, Markdown settlement, and browser scroll clamping may move `scrollTop` upward without user input and must not disable the session-open bottom-settle window. Only recent wheel, touch, middle-button autoscroll, or scrollbar-drag intent may hand scrolling control to the user.
* Theme presets imported from the active Kimi Code `themes` directory are a cached filesystem projection. A rescan must reconcile additions, updates, and deletions from that directory while preserving presets owned by other sources. Removing a Kimix record and deleting its source are separate actions; source deletion requires confirmation and a main-process path guard restricted to direct JSON children of the active themes directory.
* Stable runtime choices are described by [Runtime Routing](/architecture/runtime-routing.md).
* Operational MCP behavior is described by [MCP and Plugin Lifecycle](/operations/mcp-and-plugin-lifecycle.md).

# Sources

* [Project README](https://github.com/LiKPO4/kimix/blob/master/README.md)
* [Package manifest](https://github.com/LiKPO4/kimix/blob/master/package.json)
