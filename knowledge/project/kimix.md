---
type: Product
title: Kimix
description: Codex-style Electron desktop interface that exposes official Kimi Code capabilities through a project-aware graphical workflow.
resource: https://github.com/LiKPO4/kimix
tags: [kimix, electron, kimi-code, desktop]
timestamp: "2026-06-30T15:50:00+08:00"
---

# Kimix

Kimix is an Electron application with a React renderer and a Node-based main process. It provides project-aware conversations, streamed Markdown, approval and question cards, session history, local Skills, MCP visibility, and cross-platform packaging.

# Boundaries

* The renderer lives under `src/` and communicates with privileged capabilities through the preload bridge.
* The Electron main process lives under `electron/` and owns filesystem, settings, session, runtime, and IPC integration.
* Kimi Code is the authoritative agent runtime. Kimix presents and adapts its APIs; it does not define a second agent protocol.
* Theme presets imported from the active Kimi Code `themes` directory are a cached filesystem projection. A rescan must reconcile additions, updates, and deletions from that directory while preserving presets owned by other sources. Removing a Kimix record and deleting its source are separate actions; source deletion requires confirmation and a main-process path guard restricted to direct JSON children of the active themes directory.
* Stable runtime choices are described by [Runtime Routing](/architecture/runtime-routing.md).
* Operational MCP behavior is described by [MCP and Plugin Lifecycle](/operations/mcp-and-plugin-lifecycle.md).

# Sources

* [Project README](https://github.com/LiKPO4/kimix/blob/master/README.md)
* [Package manifest](https://github.com/LiKPO4/kimix/blob/master/package.json)
