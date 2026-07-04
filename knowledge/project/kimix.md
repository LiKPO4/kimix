---
type: Product
title: Kimix
description: Codex-style Electron desktop interface that exposes official Kimi Code capabilities through a project-aware graphical workflow.
resource: https://github.com/LiKPO4/kimix
tags: [kimix, electron, kimi-code, desktop]
timestamp: "2026-07-04T12:22:00+08:00"
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
* Once user intent takes manual control of the chat viewport, layout-only mutations must preserve a rendered message anchor instead of trusting raw scroll offsets or browser anchoring. Permission controls, footer/menu resize, runtime status snapshots, and deferred Markdown settlement can all submit layout after the user scrolls; `ChatThread` must capture the visible message key during idle scroll frames and restore that anchor across those commits.
* Startup and session switching use bottom-first rendering. Persisted restoration must mark the active official session `isLoading` before it enters the session store; a bootstrap-only gate is too late and can expose a stale tail. The startup canonical load is the sole history writer for that active session, while background repair must exclude it. Kimix shows a centered synchronization state until the canonical load completes, then renders the eager tail once. Server snapshot replay propagates each message's official `created_at` to every derived frame and never treats protocol sequence numbers as wall-clock timestamps; SDK wrapped wire messages likewise preserve message-level or outer-record time. The eager tail uses a bounded context window rather than a fixed raw-item slice: trailing unanswered user turns may extend the window backward to retain recent completed Assistant answers, but the window remains capped and never invents absent replies. After the small tail paints, the first visible batch is prepended while the bottom-origin coordinate system remains active, so background growth extends upward without moving the bottom viewport. Initial-tail completion never depends on whether any items were hidden: short conversations can contain a single extremely tall Markdown answer and must still leave reverse coordinates. Before user interaction, Kimix switches to normal scroll coordinates in a layout effect and sets the real bottom in the same frame. Loading history beyond the first batch remains explicit; a rendered message key and viewport offset preserve position instead of a raw `scrollHeight` delta.
* Markdown prose never expands the main chat viewport horizontally. Paragraphs, list items, quotes, headings, and inline code use visual-only emergency wrapping for long paths and identifiers; copied source text remains unchanged. Fenced code blocks, tables, and display math own any necessary local horizontal scrolling, while the chat scroll container itself hides horizontal overflow.
* Sidebar recency means conversation activity, not generic session metadata mutation. Once timeline bodies are available, the displayed time comes from the latest user, steer, or Assistant message; official catalog `updated_at` is only a fallback for lightweight entries because runtime resume and metadata synchronization may also change it.
* Official session catalog titles prefer a non-default official title over first/last prompt fallbacks, so lazy history hydration cannot visibly rename the row. A transient `isLoading` flag belongs only to the currently loading view; non-current rows show a spinner only for genuine runtime activity.
* Official empty-session visibility is shared by the shell and sidebar. A default-title Kimi session older than the creation grace period with no user or steer content stays hidden even before asynchronous project catalog reconciliation completes; freshly created sessions and sessions with real user content remain visible.
* Kimi placeholder titles are bilingual: both `New Session` and `新会话` are defaults even when legacy or fork metadata marks them custom. Catalog and live metadata paths reject either placeholder and fall back to meaningful prompt text instead of renaming only after history hydration.
* Active project/session persistence is written by store changes and flushed again on the real `beforeunload` boundary. React effect cleanup must never write active context because Strict Mode and HMR run cleanup before startup restoration and can replace a valid saved session with `null`.
* Theme presets imported from the active Kimi Code `themes` directory are a cached filesystem projection. A rescan must reconcile additions, updates, and deletions from that directory while preserving presets owned by other sources. Removing a Kimix record and deleting its source are separate actions; source deletion requires confirmation and a main-process path guard restricted to direct JSON children of the active themes directory.
* Stable runtime choices are described by [Runtime Routing](/architecture/runtime-routing.md).
* Operational MCP behavior is described by [MCP and Plugin Lifecycle](/operations/mcp-and-plugin-lifecycle.md).

# Sources

* [Project README](https://github.com/LiKPO4/kimix/blob/master/README.md)
* [Package manifest](https://github.com/LiKPO4/kimix/blob/master/package.json)
